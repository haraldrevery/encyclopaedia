const test = require("node:test");
const assert = require("node:assert");
const { slugify, uniqueSlug, encodeSegment, relTo, isMarkdown, isImage } = require("../lib/paths");

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
