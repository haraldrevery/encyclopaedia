const test = require("node:test");
const assert = require("node:assert");
const { demoteHeadings, addAnchors, toc, render } = require("../lib/markdown");

test("demoteHeadings leaves a body with no h1 untouched", () => {
  const html = "<h2>B</h2><h3>C</h3>";
  assert.strictEqual(demoteHeadings(html), html);
});

test("demoteHeadings cascades so nesting is preserved", () => {
  assert.strictEqual(
    demoteHeadings("<h1>A</h1><h2>B</h2><h3>C</h3>"),
    "<h2>A</h2><h3>B</h3><h4>C</h4>",
  );
});

test("demoteHeadings clamps at h6 rather than emitting an h7", () => {
  assert.strictEqual(demoteHeadings("<h1>A</h1><h5>E</h5><h6>F</h6>"), "<h2>A</h2><h6>E</h6><h6>F</h6>");
});

test("demoteHeadings preserves attributes", () => {
  assert.strictEqual(demoteHeadings('<h1 class="x">A</h1>'), '<h2 class="x">A</h2>');
});

test("demoteHeadings ignores headings shown inside a code block", () => {
  // markdown-it escapes `<` inside code, so a code sample is never matched.
  const html = "<pre><code>&lt;h1&gt;sample&lt;/h1&gt;</code></pre><h1>Real</h1>";
  assert.strictEqual(demoteHeadings(html), "<pre><code>&lt;h1&gt;sample&lt;/h1&gt;</code></pre><h2>Real</h2>");
});

test("a rendered page never contains more than one h1", () => {
  // entry.njk prints the title as the page h1, so the body must contain none.
  const html = render("# Doc Title\n\n## Section\n\n### Sub", "/p.html", "/m", "f.md", {});
  assert.strictEqual((html.match(/<h1\b/g) || []).length, 0);
});

test("addAnchors gives every h2-h4 an id", () => {
  const out = addAnchors("<h2>A</h2><h3>B</h3><h4>C</h4>");
  assert.strictEqual((out.match(/ id="/g) || []).length, 3);
});

test("addAnchors respects an id the author wrote", () => {
  assert.strictEqual(addAnchors('<h2 id="mine">A</h2>'), '<h2 id="mine">A</h2>');
});

test("addAnchors never emits a duplicate id", () => {
  // "Intro" would slug to "intro", which an explicit id further down claims.
  const out = addAnchors('<h2>Intro</h2><p>x</p><h2 id="intro">Other</h2>');
  const ids = [...out.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
  assert.strictEqual(new Set(ids).size, ids.length, `duplicate id in ${out}`);
});

test("toc lists h2-h4 and stays empty when there is nothing to outline", () => {
  const out = toc(addAnchors("<h2>A</h2><h3>B</h3><h4>C</h4>"));
  assert.ok(out.includes("#a") && out.includes("#b") && out.includes("#c"));
  assert.strictEqual(toc(addAnchors("<h2>Only</h2>")), "");
});

test("render survives a filename that cannot be URL-encoded", () => {
  assert.doesNotThrow(() =>
    render("![a](bad\uD800.png)", "/p.html", "/m", "f.md", { rewriteLinks: true }));
});

test("render reports a failure instead of throwing", () => {
  assert.strictEqual(render("", "/p.html", "/m", "f.md", {}), "");
});

test("media rewriting leaves fenced code blocks alone", () => {
  // A document that documents markdown syntax must show what the author wrote.
  const html = render(
    "```\n![alt](rel.jpg)\n![[photo.png]]\n```\n",
    "/page/x.html", "/m", "f.md", { rewriteLinks: true },
  );
  assert.ok(html.includes("![alt](rel.jpg)"), html);
  assert.ok(html.includes("![[photo.png]]"), html);
  assert.ok(!html.includes("/m/rel.jpg"), "rewrote a path inside a code block");
});

test("media rewriting leaves inline code spans alone", () => {
  const html = render("Write `![a](rel.jpg)` to embed.", "/page/x.html", "/m", "f.md", { rewriteLinks: true });
  assert.ok(html.includes("<code>![a](rel.jpg)</code>"), html);
});

test("media rewriting still rewrites real images outside code", () => {
  const html = render("![a](rel.jpg)", "/page/x.html", "/m", "f.md", { rewriteLinks: true });
  assert.ok(html.includes("../m/rel.jpg"), html);
});

test("a tilde fence is closed only by a tilde fence", () => {
  const html = render("~~~\n![a](rel.jpg)\n~~~\n", "/page/x.html", "/m", "f.md", { rewriteLinks: true });
  assert.ok(html.includes("![a](rel.jpg)"), html);
});
