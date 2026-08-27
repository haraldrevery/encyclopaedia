/**
 * frontmatter.js — the one safe way to call gray-matter.
 *
 * gray-matter chooses its parser from the language tag written on the opening
 * delimiter, not from the option you pass it. `---` means YAML, but `---js`
 * selects gray-matter's `javascript` engine, and that engine is a bare eval():
 *
 *   ---js
 *   { title: require('child_process').execSync('…').toString() }
 *   ---
 *
 * Left at the default that is remote code execution with the privileges of
 * whoever ran the build, triggered by a file dropped in input_markdown/. It is
 * the one thing this generator could not survive being relaxed about, because
 * the whole premise is that you point it at a folder of markdown someone else
 * wrote — a shared vault, an export, a zip from a colleague.
 *
 * YAML itself is not the problem: gray-matter parses it with js-yaml's
 * safeLoad, which has no tag-based execution. Only the language selector is.
 *
 * So the executable engines are replaced with ones that throw. A hostile file
 * then takes exactly the path a file with a stray tab in its YAML takes —
 * parseMarkdown() catches it, the body is read as plain markdown, and the
 * status page reports the file by name. Refusing loudly beats refusing
 * silently: "js front matter is not allowed" on the report is what tells
 * someone their notes contain something that was trying to run.
 *
 * TOML and CoffeeScript are listed for the same reason even though neither is
 * a code-execution risk on its own: this generator documents YAML front matter,
 * so anything else in that position is a surprise, and a surprise that parses
 * is worse than one that reports itself.
 */

const matter = require("gray-matter");

/** An engine that refuses, named so the health report says which one fired. */
const refuse = (language) => ({
  parse() {
    throw new Error(`${language} front matter is not allowed — only YAML is supported`);
  },
  stringify() {
    throw new Error(`${language} front matter is not allowed — only YAML is supported`);
  },
});

/**
 * Every non-YAML engine gray-matter ships, disabled.
 *
 * Listed by name rather than by replacing the whole `engines` object, because
 * gray-matter merges what it is given over its defaults: a wholesale
 * replacement would take `yaml` and `json` out with it, and every file on the
 * site would parse as "no frontmatter".
 */
const OPTIONS = {
  engines: {
    javascript: refuse("javascript"),
    js: refuse("js"),
    coffee: refuse("coffee"),
    coffeescript: refuse("coffeescript"),
    cson: refuse("cson"),
    toml: refuse("toml"),
  },
};

/**
 * Parse front matter. Throws on malformed YAML exactly as gray-matter does —
 * both callers already catch that and degrade to "no frontmatter" plus a
 * warning, which is where a refused engine lands too.
 */
function parseFrontmatter(raw) {
  return matter(raw, OPTIONS);
}

module.exports = { parseFrontmatter, OPTIONS };
