/**
 * statics.js — the two pages that are not generated from the library.
 *
 * About and Legal are ordinary markdown, kept in input_about_legal/ at the
 * project root so their text can be edited without touching a template:
 *
 *   input_about_legal/
 *   ├── about.md      title, name, role, intro + the body prose
 *   ├── legal.md      title + the body prose
 *   └── profile.jpg   the avatar — any image file will do, see avatarFile()
 *
 * The folder sits OUTSIDE the bundle, unlike input_markdown/. These two pages
 * are site chrome rather than someone's project, so the image is copied into
 * assets/ the way the favicons are, instead of being linked in place.
 *
 * Nothing here throws. A missing folder, a missing file or unparseable YAML
 * produces a page that says so, never a failed build — the same contract the
 * scanner honours for the library itself.
 */

const fs = require("fs");
const path = require("path");
const { parseFrontmatter, stripFrontmatterBlock } = require("./frontmatter");

const { isImage, isHidden } = require("./paths");
const { stripDuplicateTitle } = require("./normalise");

const DIR_NAME = "input_about_legal";

/** Where the copied images end up inside the bundle. */
const MEDIA_URL = "/assets/about";

/**
 * Resolved against the working directory, not __dirname: Eleventy's input dir
 * is "." and passthrough-copy paths resolve the same way, so the file this
 * module reads and the file the build copies are guaranteed to be the same one
 * — including inside the compiled binary, where __dirname points into the
 * bundled filesystem rather than at the project.
 */
function staticsDir() {
  return path.resolve(process.cwd(), DIR_NAME);
}

// ── Filesystem helpers that degrade instead of throwing ─────────────────────
// Same shape as the ones in scan.js; duplicated rather than shared because
// these two files are the only readers and neither should be able to break
// the other.

function readDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Every image in the folder, sorted, so Node and Bun agree on the order. */
function imageFiles() {
  return readDir(staticsDir())
    .filter((e) => e.isFile() && !isHidden(e.name) && isImage(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * The avatar. Front matter wins if it names a file that exists; otherwise it is
 * simply the one image in the folder, so swapping profile.jpg for me.png needs
 * no edit anywhere.
 */
function avatarFile(declared) {
  const images = imageFiles();
  if (declared && images.includes(String(declared))) return String(declared);
  return images[0] || null;
}

/** A blank string is not a value — fall back rather than render an empty line. */
function text(value, fallback = "") {
  const str = value == null ? "" : String(value).trim();
  return str || fallback;
}

/**
 * One markdown file. `body` is left as raw markdown: the templates render it
 * through the `markdown` filter, which needs the URL of the page it is being
 * rendered into. `missing` is true when there was nothing to read, which is
 * what the templates show their empty state for.
 */
function readPage(filename, fallbackTitle) {
  const file = path.join(staticsDir(), filename);
  const raw = readText(file);

  if (!raw.trim()) {
    return { title: fallbackTitle, description: "", body: "", missing: true, file: filename };
  }

  let data = {};
  let content = raw;
  let parseError = null;
  try {
    // parseFrontmatter(), not matter() — about.md and legal.md are the site
    // owner's own files, but they take the same locked-down engines as
    // everything else so there is exactly one way to parse front matter here.
    const parsed = parseFrontmatter(raw);
    data = parsed.data || {};
    content = parsed.content || "";
  } catch (err) {
    // Malformed YAML: keep the prose, drop the block that would not parse, and
    // say so. The scanner records this for library files (scan.js) and these
    // two pages were the one place it happened silently.
    data = {};
    content = stripFrontmatterBlock(raw);
    parseError = err.message || String(err);
  }

  return {
    title: text(data.title, fallbackTitle),
    description: text(data.description),
    name: text(data.name),
    role: text(data.role),
    intro: text(data.intro),
    imageAlt: text(data.imageAlt, "Portrait"),
    image: text(data.image),
    // Same duplicate-title removal the library entries get; these two pages
    // print an h1 of their own in about.njk / legal.njk just like entry.njk.
    body: stripDuplicateTitle(content, text(data.title, fallbackTitle)),
    missing: false,
    file: filename,
    parseError,
  };
}

module.exports = function buildStatics() {
  const about = readPage("about.md", "About");
  const legal = readPage("legal.md", "Legal");

  return {
    about,
    legal,
    avatar: avatarFile(about.image),
    mediaUrl: MEDIA_URL,
    dirName: DIR_NAME,
  };
};

module.exports.imageFiles = imageFiles;
module.exports.staticsDir = staticsDir;
module.exports.DIR_NAME = DIR_NAME;
module.exports.MEDIA_URL = MEDIA_URL;
