/**
 * paths.js — slugs, relative links and media classification.
 *
 * Single source of truth. v13 had four divergent copies of slugify() and four
 * of the extension lists, which is why an .svg counted as an image in the
 * markdown renderer but as a downloadable file in the scanner.
 *
 * Every URL the site emits is RELATIVE, computed by relTo(). That is what
 * makes the output work from a file:// path, a USB stick or a web server
 * without changing a byte.
 */

const path = require("path");

// ── Hashing ─────────────────────────────────────────────────────────────────

/**
 * FNV-1a. The generator's one source of "pick something arbitrary".
 *
 * Deterministic on purpose, and that is not a detail: this build is meant to be
 * byte-identical across runs, so `diff -r` between two builds is a real check
 * that nothing in the content pipeline has drifted. Math.random() anywhere in
 * the pipeline would make every rebuild a fresh diff, and would make the npm
 * build and the standalone binary disagree about the same folder.
 *
 * Used by scan.js to choose a card image out of a folder's images, and by
 * eleventy.config.js to scatter per-character animation delays.
 */
function fnv1a(seed) {
  const str = String(seed == null ? "" : seed);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── Slugs ───────────────────────────────────────────────────────────────────

/**
 * Folder and file names come from arbitrary user content, so this has to cope
 * with spaces, accents, emoji and CJK without ever returning "".
 */
function slugify(input) {
  const slug = String(input == null ? "" : input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")   // strip combining accents
    .toLowerCase()
    .replace(/['\u2019]/g, "")              // apostrophes join words, not split them
    .replace(/[^\p{L}\p{N}]+/gu, "-")  // keep letters/numbers in any script
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "untitled";
}

/**
 * Reserve a slug within a directory, suffixing -2, -3 … on collision.
 * Callers must feed names in a stable (sorted) order so numbering doesn't
 * shuffle between builds.
 */
function uniqueSlug(used, desired) {
  let slug = desired;
  let n = 2;
  while (used.has(slug)) slug = `${desired}-${n++}`;
  used.add(slug);
  return slug;
}

/**
 * Slugs the generator needs for pages it writes itself.
 *
 * A folder's listing page is index.html and its later pages index-2.html…, so
 * a file called index.md — the most common convention there is, and what every
 * Hugo or Obsidian folder note uses — would claim a URL Eleventy is already
 * writing. Eleventy aborts the entire build on a duplicate permalink, which is
 * exactly the failure this generator is supposed to make impossible, so the
 * file is nudged aside to index-page.html and the rename is reported.
 */
const RESERVED_PAGE_SLUG = /^index(?:-\d+)?$/;

/**
 * Directory names that share URL space with a folder's facet pages.
 *
 * `foo/tag/bees.md` renders to /page/foo/tag/bees.html, and so does the tag
 * page for "bees" on foo — the same collision, from the other direction.
 * Reserved for every folder rather than only the ones that happen to have
 * tags, so a folder's URL never depends on its siblings' frontmatter.
 */
const RESERVED_DIR_SLUGS = ["category", "tag"];

/**
 * Every page the site writes for itself, as a site-absolute URL.
 *
 * The single source of truth for two things that must never disagree: the
 * "site pages" figure on the status page, and the slugs a document is not
 * allowed to claim.
 *
 * The second one is why this lives here rather than in lib/library.js. Markdown
 * at the TOP level of input_markdown/ renders to /page/<slug>.html, and
 * /page/all.html and /page/status.html are already spoken for — so a note
 * called all.md or status.md claimed a URL Eleventy was writing anyway, and
 * Eleventy aborts the whole build on a duplicate permalink. Nothing exotic:
 * "all" and "status" are ordinary names for a note, and the failure was total
 * (zero files written) in a generator whose entire promise is that it does not
 * stop.
 *
 * RESERVED_PAGE_SLUG covers the same hazard from the folder-listing side, and
 * RESERVED_DIR_SLUGS from the facet side. This is the third face of one bug.
 */
const SITE_PAGE_URLS = [
  "/about.html",
  "/legal.html",
  "/page/all.html",
  "/page/status.html",
];

/**
 * The slugs SITE_PAGE_URLS occupies directly inside `dirUrl`.
 *
 * Derived rather than hardcoded, so adding a template to SITE_PAGE_URLS also
 * protects it — the alternative is a second list that silently falls out of
 * step, which is how this bug existed in the first place.
 *
 *   reservedPageSlugs("/page")  → ["all", "status"]
 *   reservedPageSlugs("/page/x") → []            (nothing is written there)
 */
function reservedPageSlugs(dirUrl) {
  const prefix = `${String(dirUrl || "").replace(/\/+$/, "")}/`;
  return SITE_PAGE_URLS
    .filter((url) => url.startsWith(prefix) && !url.slice(prefix.length).includes("/"))
    .map((url) => url.slice(prefix.length).replace(/\.html$/i, ""));
}

/** Folder name → human label. "Natural_Philosophy" → "Natural Philosophy". */
function humanise(name) {
  return String(name == null ? "" : name)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Untitled";
}

// ── Relative links ──────────────────────────────────────────────────────────

/**
 * Link from one site-absolute URL to another, as a relative href.
 *
 *   relTo("/page/topic-1/pencil/x.html", "/assets/main.css")
 *     → "../../../assets/main.css"
 *
 * Both arguments are site-absolute ("/…"); the result never is.
 */
function relTo(fromUrl, toUrl) {
  const from = String(fromUrl || "/");
  const to = String(toUrl || "/");

  // Leave anything already resolvable on its own alone.
  if (/^([a-z]+:|\/\/|#|mailto:|tel:)/i.test(to)) return to;

  const absFrom = from.startsWith("/") ? from : "/" + from;

  // Eleventy reports a page whose permalink ends in /index.html as the
  // directory URL "/page/thing/". A trailing slash means the URL already IS
  // the directory, so taking its dirname would climb one level too far.
  const fromDir = absFrom.endsWith("/")
    ? absFrom.replace(/\/+$/, "") || "/"
    : path.posix.dirname(absFrom);

  const target = to.startsWith("/") ? to : "/" + to;

  const rel = path.posix.relative(fromDir, target);
  return rel === "" ? "." : rel;
}

// ── Media classification ────────────────────────────────────────────────────

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg", ".bmp"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".ogv", ".mov", ".m4v"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".oga", ".ogg", ".opus"]);

const VIDEO_MIME = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/mp4",
  ".webm": "video/webm", ".ogv": "video/ogg",
};
const AUDIO_MIME = {
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac",
  ".m4a": "audio/mp4", ".aac": "audio/aac", ".oga": "audio/ogg",
  ".ogg": "audio/ogg", ".opus": "audio/ogg",
};

const ext = (file) => path.extname(String(file || "")).toLowerCase();

const isMarkdown = (file) => ext(file) === ".md";
const isImage = (file) => IMAGE_EXTS.has(ext(file));
const isVideo = (file) => VIDEO_EXTS.has(ext(file));
const isAudio = (file) => AUDIO_EXTS.has(ext(file));
const isMedia = (file) => isImage(file) || isVideo(file) || isAudio(file);

/** A file named thumbnail.* is the card image and is kept out of the gallery. */
const isThumbnail = (file) => /^thumbnail\.[^.]+$/i.test(String(file || ""));

/** Editor droppings and OS noise that should never reach the site. */
const isHidden = (name) =>
  String(name || "").startsWith(".") ||
  /^(Thumbs\.db|desktop\.ini)$/i.test(String(name || ""));

const videoMime = (file) => VIDEO_MIME[ext(file)] || "video/mp4";
const audioMime = (file) => AUDIO_MIME[ext(file)] || "audio/mpeg";

module.exports = {
  fnv1a,
  slugify, uniqueSlug, humanise, relTo,
  ext, isMarkdown, isImage, isVideo, isAudio, isMedia, isThumbnail, isHidden,
  videoMime, audioMime,
  IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS,
  RESERVED_PAGE_SLUG, RESERVED_DIR_SLUGS,
  SITE_PAGE_URLS, reservedPageSlugs,
};
