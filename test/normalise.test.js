const test = require("node:test");
const assert = require("node:assert");
const {
  stripInline, stripDuplicateTitle, toList, toDate, normaliseFrontmatter, NO_TITLE,
} = require("../lib/normalise");

test("stripInline keeps currency, which is not math", () => {
  assert.strictEqual(stripInline("Price: $5 to $10 today"), "Price: $5 to $10 today");
  assert.strictEqual(stripInline("Cost $5"), "Cost $5");
});

test("stripInline still removes real math", () => {
  assert.strictEqual(stripInline("Einstein $E=mc^2$ famously"), "Einstein famously");
  assert.strictEqual(stripInline("Display $$x^2$$ math"), "Display math");
});

test("stripInline keeps intraword underscores, which markdown reads as literal", () => {
  assert.strictEqual(stripInline("binocular_grok_v1"), "binocular_grok_v1");
  assert.strictEqual(stripInline("snake_case_name"), "snake_case_name");
});

test("stripInline still removes emphasis markers", () => {
  assert.strictEqual(stripInline("**bold** and ~~strike~~"), "bold and strike");
  assert.strictEqual(stripInline("_emphasis_ here"), "emphasis here");
});

test("stripInline reduces links to their label", () => {
  assert.strictEqual(stripInline("see [the docs](http://x.test)"), "see the docs");
  assert.strictEqual(stripInline("[[wiki|label]]"), "label");
});

test("stripDuplicateTitle removes a heading that repeats the title", () => {
  assert.strictEqual(stripDuplicateTitle("# Axe\n\nBody", "Axe"), "Body");
});

test("stripDuplicateTitle ignores spacing around punctuation", () => {
  assert.strictEqual(
    stripDuplicateTitle("# Mouse / Rat Traps\n\n## Overview", "Mouse/Rat traps"),
    "## Overview",
  );
});

test("stripDuplicateTitle sees past a stray rule or comment above the heading", () => {
  assert.strictEqual(stripDuplicateTitle("---\n\n# Axe\n\nBody", "Axe"), "---\n\nBody");
  assert.strictEqual(stripDuplicateTitle("<!-- gen -->\n# Axe\n\nBody", "Axe"), "<!-- gen -->\n\nBody");
});

test("stripDuplicateTitle leaves a genuinely different heading alone", () => {
  const body = "# Pencils\n\nBody";
  assert.strictEqual(stripDuplicateTitle(body, "Pencil"), body);
});

test("stripDuplicateTitle leaves the body alone when prose comes first", () => {
  const body = "Prose first\n\n# Pencil";
  assert.strictEqual(stripDuplicateTitle(body, "Pencil"), body);
});

test("toList accepts arrays, comma strings and quoted pseudo-arrays", () => {
  assert.deepStrictEqual(toList(["a", "b"]), ["a", "b"]);
  assert.deepStrictEqual(toList("a, b"), ["a", "b"]);
  assert.deepStrictEqual(toList("[gas giant, storms]"), ["gas giant", "storms"]);
  assert.deepStrictEqual(toList(null), []);
});

test("toDate never invents a date", () => {
  assert.strictEqual(toDate("not-a-date"), null);
  assert.strictEqual(toDate(""), null);
  assert.ok(toDate("2026-03-02") instanceof Date);
});

test("normaliseFrontmatter fills every field and records a warning for each fallback", () => {
  const out = normaliseFrontmatter({}, "", { relPath: "x.md" });
  assert.strictEqual(out.title, NO_TITLE);
  assert.strictEqual(out.author, "Unknown");
  assert.deepStrictEqual(out.categories, ["Misc."]);
  assert.ok(out.warnings.length > 0);
});

test("normaliseFrontmatter falls back to the first body heading for a title", () => {
  const out = normaliseFrontmatter({}, "# Cast Iron\n\nBody", { relPath: "x.md" });
  assert.strictEqual(out.title, "Cast Iron");
  assert.strictEqual(out.titleSource, "heading");
  // ...and then removes it, so the page does not print the title twice.
  assert.strictEqual(out.body, "Body");
});
