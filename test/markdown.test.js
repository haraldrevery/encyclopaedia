const test = require("node:test");
const assert = require("node:assert");
const { demoteHeadings, addAnchors, toc, render, bodyImages, imageKey } = require("../lib/markdown");

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


// ── Justified image runs ────────────────────────────────────────────────────

/** Dimensions for a.jpg/b.jpg/c.jpg as if scan.js had read them. */
const DIMS = new Map([
  ["a.jpg", { width: 400, height: 200 }],   // 2.0
  ["b.jpg", { width: 300, height: 400 }],   // 0.75
  ["c.jpg", { width: 600, height: 400 }],   // 1.5
]);

const runRender = (src) =>
  render(src, "/page/x.html", "/m", "doc.md", { rewriteLinks: true, dims: DIMS });

const runCount = (html) => (html.match(/class="image-run"/g) || []).length;
const itemCount = (html) => (html.match(/class="image-run__item/g) || []).length;

test("consecutive images become one image run", () => {
  const html = runRender("![a](a.jpg)\n![b](b.jpg)\n![c](c.jpg)");
  assert.strictEqual(runCount(html), 1, html);
  assert.strictEqual(itemCount(html), 3, html);
});

test("a blank line between images does not break the run", () => {
  // Obsidian tends to write embeds with blank lines between them.
  const html = runRender("![a](a.jpg)\n\n![b](b.jpg)\n\n![c](c.jpg)");
  assert.strictEqual(runCount(html), 1, html);
  assert.strictEqual(itemCount(html), 3, html);
});

test("prose between images splits them into separate runs", () => {
  const html = runRender("![a](a.jpg)\n![b](b.jpg)\n\nWords.\n\n![a](a.jpg)\n![c](c.jpg)");
  assert.strictEqual(runCount(html), 2, html);
});

test("a lone image is not a run and opens as a gallery of one", () => {
  const html = runRender("![a](a.jpg)");
  assert.strictEqual(runCount(html), 0, html);
  assert.ok(html.includes('data-gallery="single-0"'), html);
});

test("two lone images never share a slider", () => {
  // GLightbox groups by the data-gallery string alone, wherever the elements
  // sit, so one shared name would let a figure in the middle of an article
  // arrow into an unrelated one further down.
  const html = runRender("![a](a.jpg)\n\nWords.\n\n![b](b.jpg)");
  assert.ok(html.includes('data-gallery="single-0"'), html);
  assert.ok(html.includes('data-gallery="single-1"'), html);
});

test("the same file embedded twice gets two distinct groups", () => {
  const html = runRender("![a](a.jpg)\n\nWords.\n\n![a](a.jpg)");
  assert.strictEqual((html.match(/data-gallery="single-\d+"/g) || []).length, 2, html);
  assert.ok(!html.includes('data-gallery="entry"'), html);
});

test("lone images and runs never collide on a group name", () => {
  const html = runRender("![a](a.jpg)\n![b](b.jpg)\n\nWords.\n\n![a](a.jpg)");
  const groups = html.match(/data-gallery="[^"]*"/g) || [];
  assert.strictEqual(new Set(groups).size, 2, groups.join(" "));
});

test("a paragraph that also holds text is never a run", () => {
  const html = runRender("![a](a.jpg) and ![b](b.jpg)");
  assert.strictEqual(runCount(html), 0, html);
});

test("images the author wrapped in their own links are left alone", () => {
  // The link tokens are not images, so the paragraph fails the test — and the
  // author's link must survive rather than becoming a lightbox anchor.
  const html = runRender("[![a](a.jpg)](one.html)\n[![b](b.jpg)](two.html)");
  assert.strictEqual(runCount(html), 0, html);
  assert.ok(html.includes("one.html"), html);
});

test("a fenced code block of images is never grouped", () => {
  const html = runRender("```\n![a](a.jpg)\n![b](b.jpg)\n```\n");
  assert.strictEqual(runCount(html), 0, html);
  assert.ok(html.includes("![a](a.jpg)"), html);
});

test("each item carries its real aspect ratio and pixel size", () => {
  const html = runRender("![a](a.jpg)\n![b](b.jpg)");
  assert.ok(html.includes("--ar:2.0000"), html);
  assert.ok(html.includes("--ar:0.7500"), html);
  assert.ok(html.includes('width="400" height="200"'), html);
});

test("an image with no known size falls back rather than disappearing", () => {
  const html = runRender("![a](a.jpg)\n![z](unknown.jpg)");
  assert.strictEqual(itemCount(html), 2, html);
  assert.ok(html.includes("--ar:1.5000"), html);
  // No width/height attribute may be invented for a file we never measured.
  assert.ok(!/unknown\.jpg" alt="z" width=/.test(html), html);
});

test("each run gets its own lightbox group", () => {
  const html = runRender("![a](a.jpg)\n![b](b.jpg)\n\nWords.\n\n![a](a.jpg)\n![c](c.jpg)");
  assert.ok(html.includes('data-gallery="run-0"'), html);
  assert.ok(html.includes('data-gallery="run-1"'), html);
});

test("a run emits a div and never a div inside a paragraph", () => {
  const html = runRender("![a](a.jpg)\n![b](b.jpg)");
  assert.ok(!/<p>\s*<div class="image-run"/.test(html), html);
});

test("alt text is escaped into both the title and the alt attribute", () => {
  const html = runRender('![x" onerror="alert(1)](a.jpg)\n![b](b.jpg)');
  assert.ok(!html.includes('onerror="alert'), html);
  assert.ok(html.includes("&quot;"), html);
});

test("bodyImages reports every image the body embedded, run or not", () => {
  runRender("![a](a.jpg)\n![b](b.jpg)\n\nWords.\n\n![c](c.jpg)");
  assert.deepStrictEqual([...bodyImages()].sort(), ["a.jpg", "b.jpg", "c.jpg"]);
});

test("bodyImages resolves against the document's own folder", () => {
  render("![a](a.jpg)\n![b](../shared/b.jpg)", "/page/x.html", "/m", "deep/folder/doc.md", {});
  assert.deepStrictEqual([...bodyImages()].sort(), ["deep/folder/a.jpg", "deep/shared/b.jpg"]);
});

test("bodyImages is reset per document, so it never leaks between pages", () => {
  runRender("![a](a.jpg)\n![b](b.jpg)");
  runRender("Nothing here.");
  assert.deepStrictEqual([...bodyImages()], []);
});

test("bodyImages ignores external images, which no folder owns", () => {
  runRender("![a](https://example.com/a.jpg)\n![b](b.jpg)");
  assert.deepStrictEqual([...bodyImages()], ["b.jpg"]);
});

test("imageKey agrees with the keys bodyImages produces", () => {
  // library.js filters the folder's image list with imageKey(); if the two ever
  // disagreed the bottom gallery would silently stop hiding anything.
  render("![a](a.jpg)", "/page/x.html", "/m", "deep/folder/doc.md", {});
  assert.ok(bodyImages().has(imageKey("deep/folder", "a.jpg")));
});

test("obsidian embeds group and are reported like markdown images", () => {
  const html = render("![[a.jpg]]\n![[b.jpg]]", "/page/x.html", "/m", "doc.md", { dims: DIMS });
  assert.strictEqual(runCount(html), 1, html);
  assert.deepStrictEqual([...bodyImages()].sort(), ["a.jpg", "b.jpg"]);
});
