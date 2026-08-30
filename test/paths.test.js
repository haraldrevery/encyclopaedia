const test = require("node:test");
const assert = require("node:assert");
const {
  slugify, uniqueSlug, encodeSegment, relTo, isMarkdown, isImage, classifyFiles,
} = require("../lib/paths");

test("slugify never returns an empty string", () => {
  for (const input of ["", null, undefined, "---", "!!!", "   "]) {
    assert.ok(slugify(input).length > 0, `empty slug for ${JSON.stringify(input)}`);
  }
});

test("slugify folds accents and drops emoji", () => {
  assert.strictEqual(slugify("Café Naïve"), "cafe-naive");
  assert.strictEqual(slugify("café 😀 test"), "cafe-test");
});

test("slugify keeps non-latin scripts", () => {
  assert.strictEqual(slugify("漢字"), "漢字");
});

test("slugify caps length at 180 bytes so writes cannot fail with ENAMETOOLONG", () => {
  assert.ok(Buffer.byteLength(slugify("x".repeat(300)), "utf8") <= 180);
  // A CJK name runs out of bytes ~3x sooner than it runs out of characters.
  assert.ok(Buffer.byteLength(slugify("漢".repeat(200)), "utf8") <= 180);
});

test("slugify does not cap names that already build", () => {
  assert.strictEqual(slugify("cedarwood pieces perplexity v1"), "cedarwood-pieces-perplexity-v1");
});

test("slugify suffixes Win32 reserved device names", () => {
  for (const name of ["con", "PRN", "aux", "NUL", "com1", "lpt9"]) {
    assert.notStrictEqual(slugify(name), name.toLowerCase(), `${name} would fail to write on Windows`);
  }
  assert.strictEqual(slugify("con"), "con-file");
  assert.strictEqual(slugify("console"), "console");   // only the exact name is reserved
});

test("uniqueSlug suffixes collisions in a stable order", () => {
  const used = new Set();
  assert.strictEqual(uniqueSlug(used, "x"), "x");
  assert.strictEqual(uniqueSlug(used, "x"), "x-2");
  assert.strictEqual(uniqueSlug(used, "x"), "x-3");
});

test("encodeSegment survives an unpaired surrogate instead of throwing", () => {
  assert.doesNotThrow(() => encodeSegment("bad\uD800.png"));
  assert.strictEqual(encodeSegment("bad\uD800.png"), "bad%EF%BF%BD.png");
});

test("encodeSegment still encodes valid surrogate pairs correctly", () => {
  assert.strictEqual(encodeSegment("\u{1F600}.png"), encodeURIComponent("\u{1F600}.png"));
  assert.strictEqual(encodeSegment("a b.png"), "a%20b.png");
});

test("relTo produces a path relative to the page", () => {
  assert.strictEqual(relTo("/page/a/b.html", "/assets/x.css"), "../../assets/x.css");
});

test("extension helpers are case-insensitive", () => {
  assert.ok(isMarkdown("A.MD"));
  assert.ok(isImage("photo.JPG"));
});

// ── classifyFiles ───────────────────────────────────────────────────────────
// The partition is the one thing standing between a file and silent deletion
// from the site, so the property that matters is tested directly rather than
// through any single example.

/** Every bucket, flattened — what the site can still see. */
const accountedFor = (k) =>
  [...k.markdown, ...(k.thumbnail ? [k.thumbnail] : []),
   ...k.images, ...k.videos, ...k.audios, ...k.downloads];

test("classifyFiles accounts for every file exactly once", () => {
  const files = [
    "note.md", "thumbnail.jpg", "a.jpg", "clip.mp4", "song.mp3", "data.zip",
    "thumbnail.mp4", "thumbnail.txt", "thumbnail.md", "no-extension",
    "UPPER.PNG", "archive.tar.gz",
  ];
  const seen = accountedFor(classifyFiles(files));
  assert.deepStrictEqual([...seen].sort(), [...files].sort());
  assert.strictEqual(seen.length, new Set(seen).size, "a file landed in two buckets");
});

test("classifyFiles only lets an IMAGE become the card image", () => {
  // The bug this partition exists to prevent: a thumbnail.* that is not an
  // image used to be claimed as the card thumbnail and then vanish from every
  // media list, from the health report, and from the site.
  assert.strictEqual(classifyFiles(["thumbnail.jpg"]).thumbnail, "thumbnail.jpg");

  for (const [file, bucket] of [
    ["thumbnail.mp4", "videos"], ["thumbnail.mp3", "audios"],
    ["thumbnail.txt", "downloads"], ["thumbnail.md", "markdown"],
  ]) {
    const kinds = classifyFiles([file]);
    assert.strictEqual(kinds.thumbnail, null, `${file} was claimed as the card image`);
    assert.deepStrictEqual(kinds[bucket], [file], `${file} should be a ${bucket} entry`);
  }
});

test("classifyFiles keeps the card image out of the gallery", () => {
  const kinds = classifyFiles(["thumbnail.jpg", "a.jpg", "b.jpg"]);
  assert.strictEqual(kinds.thumbnail, "thumbnail.jpg");
  assert.deepStrictEqual(kinds.images, ["a.jpg", "b.jpg"]);
});

test("classifyFiles sends an unrecognised extension to downloads, never nowhere", () => {
  const kinds = classifyFiles(["mystery.qqq", "no-extension"]);
  assert.deepStrictEqual(kinds.downloads, ["mystery.qqq", "no-extension"]);
});

test("classifyFiles handles an empty or missing list", () => {
  for (const input of [[], null, undefined]) {
    const kinds = classifyFiles(input);
    assert.strictEqual(kinds.thumbnail, null);
    assert.strictEqual(accountedFor(kinds).length, 0);
  }
});
