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
/**
 * Percent-encode one path segment without ever throwing.
 *
 * encodeURIComponent() raises URIError on an unpaired surrogate, and both NTFS
 * and ext4 allow filenames that decode to one. Left unguarded that aborted the
 * whole build over a single oddly-named file, so the character that cannot be
 * represented is replaced and the reference is left for the health check to
 * report as broken — a bad link on one page instead of no site at all.
 */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function encodeSegment(segment) {
  const text = String(segment == null ? "" : segment);
  try {
    return encodeURIComponent(text);
  } catch {
    return encodeURIComponent(text.replace(LONE_SURROGATE, "\uFFFD"));
  }
}

/**
 * Filesystems cap a name at 255 BYTES, not characters, so a CJK name runs out
 * at ~85 characters. A slug over the limit used to reach fs.writeFileSync and
 * fail the build with ENAMETOOLONG. The cap is deliberately generous — far
 * longer than any name that builds today — so it only ever fires where the
 * build would otherwise have died, and never changes a URL that already works.
 */
const SLUG_MAX_BYTES = 180;

function capBytes(slug) {
  if (Buffer.byteLength(slug, "utf8") <= SLUG_MAX_BYTES) return slug;
  let out = slug;
  while (out && Buffer.byteLength(out, "utf8") > SLUG_MAX_BYTES) out = out.slice(0, -1);
  // Prefer a word boundary, but only if one survives reasonably far in.
  const dash = out.lastIndexOf("-");
  if (dash > SLUG_MAX_BYTES * 0.6) out = out.slice(0, dash);
  return out.replace(/-+$/, "") || "untitled";
}

/**
 * Win32 refuses these names whatever the extension, so `con.md` would fail to
 * write as CON.html. Suffixed rather than replaced, so the page keeps a name a
 * reader recognises.
 */
const WIN32_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function slugify(input) {
  const slug = String(input == null ? "" : input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")   // strip combining accents
    .toLowerCase()
    .replace(/['\u2019]/g, "")              // apostrophes join words, not split them
    .replace(/[^\p{L}\p{N}]+/gu, "-")  // keep letters/numbers in any script
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const capped = capBytes(slug || "untitled");
  return WIN32_RESERVED.test(capped) ? `${capped}-file` : capped;
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

/**
 * A file named thumbnail.* CLAIMS to be the card image. Whether it gets to be
 * one is decided by classifyFiles() below, which only honours the claim for a
 * file that is actually an image — see the note there.
 */
const isThumbnail = (file) => /^thumbnail\.[^.]+$/i.test(String(file || ""));

/**
 * Sort one directory's files into buckets — the single partition every
 * consumer reads.
 *
 * This exists because there used to be four of them. scan.js derived the
 * markdown list, the media buckets, the "loose files" count and the
 * unreferenced-media check by filtering the same array four separate times
 * with four different predicates, and nothing ever reconciled the results. So
 * a file could be dropped by one filter and stay invisible to the one whose
 * whole job is noticing dropped files: `thumbnail.mp4` was claimed as the card
 * image, removed from the list before the media buckets were built, and then
 * skipped by the orphan check too — it appeared on the site as a broken <img>,
 * in no Video or Files list, and on no health report. `thumbnail.txt` and
 * `thumbnail.md` went the same way.
 *
 * Two properties fix that class of bug rather than that one instance:
 *
 * TOTAL. Every file lands in exactly one bucket. `downloads` is the catch-all,
 * so an unrecognised extension is a download rather than a file that quietly
 * stops existing. There is no step that removes a file before bucketing, which
 * is the only way the old bug could happen.
 *
 * THE CARD IMAGE IS A ROLE, NOT A REMOVAL. `thumbnail` is chosen FROM the
 * image bucket, so a thumbnail.* that is not an image cannot take a file out
 * of circulation — thumbnail.mp4 stays in `videos` where it belongs. It is
 * moved out of `images` because the gallery should not show the card image
 * twice, and that is the one exclusion, stated in one place.
 *
 * Callers must not re-derive any of this with isThumbnail() or isMarkdown().
 * Read the buckets — that is what makes the partition worth having.
 */
function classifyFiles(files) {
  const markdown = [], images = [], videos = [], audios = [], downloads = [];

  for (const file of files || []) {
    if (isMarkdown(file)) markdown.push(file);
    else if (isImage(file)) images.push(file);
    else if (isVideo(file)) videos.push(file);
    else if (isAudio(file)) audios.push(file);
    else downloads.push(file);
  }

  // The card image, and the gallery with it taken out. Anything named
  // thumbnail.* that is not an image never reaches this line and keeps the
  // bucket its extension earned it.
  const thumbnail = images.find(isThumbnail) || null;

  return {
    markdown,
    thumbnail,
    images: thumbnail ? images.filter((f) => f !== thumbnail) : images,
    videos,
    audios,
    downloads,
  };
}

/** Editor droppings and OS noise that should never reach the site. */
const isHidden = (name) =>
  String(name || "").startsWith(".") ||
  /^(Thumbs\.db|desktop\.ini)$/i.test(String(name || ""));

const videoMime = (file) => VIDEO_MIME[ext(file)] || "video/mp4";
const audioMime = (file) => AUDIO_MIME[ext(file)] || "audio/mpeg";

module.exports = {
  fnv1a,
  slugify, uniqueSlug, humanise, relTo, encodeSegment,
  ext, isMarkdown, isImage, isVideo, isAudio, isMedia, isThumbnail, isHidden,
  classifyFiles,
  videoMime, audioMime,
  IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS,
  RESERVED_PAGE_SLUG, RESERVED_DIR_SLUGS,
  SITE_PAGE_URLS, reservedPageSlugs,
};
