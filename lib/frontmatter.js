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

/**
 * The delimiter lines, defined once because they were defined twice.
 *
 * gray-matter opens a block on `---` OPTIONALLY FOLLOWED BY A LANGUAGE TAG —
 * that is the whole mechanism this file exists to defuse — and closes it on a
 * bare `---`. stripFrontmatterBlock() below knew only the bare form, so the one
 * input that reaches the refusal path was the one input it could not clean:
 * a `---js` file had its front matter refused and then rendered as page
 * content, where markdown-it-attrs turned the JavaScript object literal into
 * attributes on a heading.
 */
const OPEN_DELIMITER = /^---(\w*)\s*$/;
const CLOSE_DELIMITER = /^---\s*$/;

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

/**
 * Drop a leading `---` delimited block from a file that failed to parse.
 *
 * When YAML is malformed both callers degrade to "no frontmatter" and keep the
 * body — but the body they kept was the *whole file*, delimiters and all, so
 * the broken YAML was rendered as page content: a stray `<hr>` followed by an
 * `<h2>` reading `title: "Unterminated quote`, which then earned an anchor id
 * and a line in the reader-facing table of contents.
 *
 * The delimiters are almost always intact — it is the YAML between them that
 * is bad — so they can be found and removed even though they cannot be parsed.
 * If there is no closing delimiter there is no way to tell frontmatter from
 * body, and the raw text is returned untouched rather than guessed at.
 */
function stripFrontmatterBlock(raw) {
  const text = String(raw == null ? "" : raw);
  const lines = text.split(/\r?\n/);
  if (!OPEN_DELIMITER.test(lines[0] || "")) return text;

  for (let i = 1; i < lines.length; i++) {
    if (CLOSE_DELIMITER.test(lines[i])) {
      return lines.slice(i + 1).join("\n").replace(/^\s*\n/, "");
    }
  }
  return text;   // unterminated — cannot tell where the body starts
}

module.exports = {
  parseFrontmatter, stripFrontmatterBlock, OPTIONS,
  OPEN_DELIMITER, CLOSE_DELIMITER,
};
