const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { imageDimensions } = require("../lib/dimensions");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "encyclopedia-dims-"));
const write = (name, bytes) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, bytes);
  return file;
};
const measure = (file) => imageDimensions(file, fs.statSync(file));

/**
 * The smallest JPEG image-size will read: SOI, an APP1 EXIF block holding one
 * orientation tag, and an SOF0 carrying the stored width and height.
 *
 * Built rather than committed as a fixture because the point of the test is the
 * orientation flag, and a real photograph either has the flag you need or it
 * does not — none of the sample images carry one at all.
 */
function jpegWithOrientation(orientation, width, height) {
  const exif = Buffer.concat([
    Buffer.from("Exif\0\0", "binary"),
    Buffer.from("MM"), Buffer.from([0x00, 0x2a]),   // big-endian TIFF, magic 42
    Buffer.from([0, 0, 0, 8]),                       // IFD0 sits at offset 8
    Buffer.from([0x00, 0x01]),                       // holding one entry
    // tag 274 (orientation), type 3 (SHORT), count 1, value.
    Buffer.from([0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0, orientation, 0, 0]),
  ]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(exif.length + 2);               // the length field counts itself
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);                     // SOF0
  sof.writeUInt16BE(9, 2);
  sof.writeUInt8(8, 4);                             // sample precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, exif, sof]);
}

test("an upright photo reports the size it stores", () => {
  assert.deepStrictEqual(
    measure(write("upright.jpg", jpegWithOrientation(1, 400, 200))),
    { width: 400, height: 200 },
  );
});

test("a half-turn photo is not swapped", () => {
  // 3 is 180 degrees: rotated, but still the same shape on screen.
  assert.deepStrictEqual(
    measure(write("half.jpg", jpegWithOrientation(3, 400, 200))),
    { width: 400, height: 200 },
  );
});

test("a quarter-turn photo is swapped to the size it displays at", () => {
  // The bug this exists to catch: image-size reports `orientation` but does NOT
  // apply it, so trusting its width/height puts every rotated phone photograph
  // in a landscape slot. Both quarter turns must swap.
  for (const orientation of [5, 6, 7, 8]) {
    assert.deepStrictEqual(
      measure(write(`quarter${orientation}.jpg`, jpegWithOrientation(orientation, 400, 200))),
      { width: 200, height: 400 },
      `orientation ${orientation}`,
    );
  }
});

test("a file that is not an image reads as null rather than throwing", () => {
  assert.strictEqual(measure(write("lying.png", Buffer.from("not an image"))), null);
});

test("a truncated image reads as null rather than throwing", () => {
  const cut = jpegWithOrientation(1, 400, 200).subarray(0, 12);
  assert.strictEqual(measure(write("truncated.jpg", cut)), null);
});

test("an SVG with no intrinsic size reads as null rather than as zero", () => {
  // Zero would divide by zero building the aspect ratio; null makes the caller
  // fall back and report it.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  assert.strictEqual(measure(write("nosize.svg", Buffer.from(svg))), null);
});

test("an SVG that declares a viewBox is measured from it", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"></svg>';
  assert.deepStrictEqual(measure(write("viewbox.svg", Buffer.from(svg))), { width: 300, height: 150 });
});

test("a missing file reads as null rather than throwing", () => {
  assert.strictEqual(imageDimensions(path.join(tmp, "gone.jpg"), null), null);
});

test("a replaced file is re-read rather than served from the cache", () => {
  // The cache is keyed on mtime + size because `npm start` re-runs the whole
  // scan on every save; a stale hit would pin the old shape until restart.
  const file = write("swapped.jpg", jpegWithOrientation(1, 400, 200));
  assert.deepStrictEqual(measure(file), { width: 400, height: 200 });
  fs.writeFileSync(file, jpegWithOrientation(1, 800, 100));
  fs.utimesSync(file, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
  assert.deepStrictEqual(measure(file), { width: 800, height: 100 });
});
