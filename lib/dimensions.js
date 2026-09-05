/**
 * dimensions.js — intrinsic pixel size of an image, read at build time.
 *
 * The justified galleries in markdown.js lay themselves out with pure CSS, and
 * that only works if every image's aspect ratio is known before the page is
 * written. Measuring in the browser instead would mean the column paints at one
 * size and then jumps — the exact failure the <head> one-liner in base.njk
 * exists to avoid for the reading width.
 *
 * Three constraints, all inherited from the code that calls this:
 *
 *   1. scan.js is synchronous from the walk down through collectMedia(), so
 *      this reads with openSync/readSync/closeSync. image-size's own fromFile()
 *      is async and cannot be used.
 *   2. Gallery images are full-size originals — media is linked, never copied,
 *      so a folder of photographs is hundreds of megabytes. Only the HEADER is
 *      read, not the file.
 *   3. Nothing throws. An image whose size cannot be read still renders, at a
 *      declared fallback ratio, and becomes a row on the status page. Same
 *      contract as hash.js.
 */

const fs = require("fs");
const { imageSize } = require("image-size");

/**
 * 256 KiB. A JPEG's SOF marker sits after its EXIF block, and a camera JPEG
 * carrying a full-size embedded preview can push it past any small fixed
 * window — 64 KiB was not enough for two of the sample photographs. When the
 * header still does not parse within this, readSize() retries on the whole
 * file rather than giving up, so this is a fast path and not a limit.
 */
const HEADER_BYTES = 256 * 1024;

/** Reused for the life of the process, like the chunk buffer in hash.js. */
let header = null;

/**
 * EXIF orientations 5-8 rotate the image a quarter turn, which swaps what the
 * viewer sees relative to what the pixels say.
 *
 * image-size v2 reports `orientation` but deliberately does NOT apply it: the
 * width and height it returns are the stored ones. That is the right default
 * for a library and the wrong answer for a gallery — a portrait phone photo
 * stores 4032x3024 plus a flag, so trusting the raw numbers puts every rotated
 * photograph in a landscape slot and the layout is visibly wrong on exactly
 * the images people notice. The swap has to happen here.
 */
const QUARTER_TURN = new Set([5, 6, 7, 8]);

/**
 * absolute path -> { key, value }
 *
 * The same cache shape, and the same reasoning, as hash.js: content/** is in
 * .eleventyignore, so under `npm start` saving ANY markdown file re-runs the
 * whole scan. Without this, every save would re-open every image in the
 * project. Keyed on mtime + size so replacing a photo in place is picked up
 * without restarting the dev server.
 */
const cache = new Map();

/**
 * Read `file`'s intrinsic size.
 *
 * @param {string} file absolute path
 * @param {fs.Stats|null} stat the stat scan.js has already taken, or null
 * @returns {{width: number, height: number}|null} null if it could not be read
 *          or the format carries no intrinsic size (an SVG with no viewBox)
 */
function imageDimensions(file, stat) {
  const key = stat ? `${stat.mtimeMs}:${stat.size}` : null;
  const hit = cache.get(file);
  if (hit && key !== null && hit.key === key) return hit.value;

  const value = readSize(file);
  cache.set(file, { key, value });
  return value;
}

function readSize(file) {
  let fd = -1;
  try {
    fd = fs.openSync(file, "r");
    if (!header) header = Buffer.alloc(HEADER_BYTES);
    const n = fs.readSync(fd, header, 0, HEADER_BYTES, 0);
    if (!n) return null;

    let size = measure(header.subarray(0, n));
    // A header window that stopped short of the size marker, not a broken
    // file. Worth one full read: it is rare, and the alternative is a photo
    // laid out at the fallback ratio for no reason the author could act on.
    if (!size && n === HEADER_BYTES) size = measure(fs.readFileSync(file));
    return size;
  } catch {
    return null;
  } finally {
    if (fd >= 0) { try { fs.closeSync(fd); } catch { /* already gone */ } }
  }
}

/** imageSize() on bytes, normalised to oriented pixels, or null on anything odd. */
function measure(bytes) {
  let raw;
  try {
    raw = imageSize(new Uint8Array(bytes));
  } catch {
    return null;   // truncated window, or a format image-size does not know
  }
  if (!raw) return null;

  const width = Number(raw.width);
  const height = Number(raw.height);
  // An SVG with neither width/height nor viewBox parses fine and reports 0,
  // which would divide by zero in the aspect ratio. It has no intrinsic size
  // to report, so say so rather than inventing one.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  return QUARTER_TURN.has(raw.orientation)
    ? { width: height, height: width }
    : { width, height };
}

module.exports = { imageDimensions };
