const test = require("node:test");
const assert = require("node:assert");
const { parseFrontmatter, stripFrontmatterBlock } = require("../lib/frontmatter");

test("parseFrontmatter reads ordinary YAML", () => {
  const out = parseFrontmatter("---\ntitle: Axe\n---\n\nBody");
  assert.strictEqual(out.data.title, "Axe");
  assert.strictEqual(out.content.trim(), "Body");
});

test("parseFrontmatter refuses executable front matter engines", () => {
  // gray-matter would otherwise eval() this during the build.
  for (const tag of ["js", "javascript", "coffee", "toml"]) {
    assert.throws(
      () => parseFrontmatter(`---${tag}\nmodule.exports={title:"x"}\n---\nBody`),
      undefined,
      `---${tag} was not refused`,
    );
  }
});

test("stripFrontmatterBlock drops a block that failed to parse", () => {
  const raw = '---\ntitle: "unterminated\ntags: [a\n---\n\n# Real\n\nBody';
  assert.strictEqual(stripFrontmatterBlock(raw), "# Real\n\nBody");
});

test("stripFrontmatterBlock leaves an unterminated block alone", () => {
  // With no closing delimiter there is no way to tell frontmatter from body.
  const raw = "---\ntitle: bad\n\n# no closing delimiter";
  assert.strictEqual(stripFrontmatterBlock(raw), raw);
});

test("stripFrontmatterBlock leaves a plain document alone", () => {
  assert.strictEqual(stripFrontmatterBlock("# Title\n\nBody"), "# Title\n\nBody");
  assert.strictEqual(stripFrontmatterBlock(""), "");
});
