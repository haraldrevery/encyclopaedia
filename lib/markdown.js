/**
 * markdown.js — the markdown-it stack, media rewriting and article chrome.
 *
 * Two things make this different from a stock markdown-it setup:
 *
 *   1. Media is never copied. A relative `![](photo.jpg)` in a markdown file
 *      has to become a link back into input_markdown/ from wherever the page
 *      ended up in page/. Every rewrite goes through relTo() so the result
 *      works from a file:// path as well as a server.
 *
 *   2. Math is rendered to MathML at build time, so the site ships no KaTeX
 *      CSS or JS at all. This mirrors website_v3_014.
 */

const path = require("path");
const markdownIt = require("markdown-it");
const markdownItAttrs = require("markdown-it-attrs");
const markdownItLinkAttributes = require("markdown-it-link-attributes");
const markdownItTexmath = require("markdown-it-texmath");
const katex = require("katex");

const { escapeHtml } = require("./html");

const {
  relTo, isImage, isVideo, isAudio, isMarkdown, videoMime, audioMime, encodeSegment,
} = require("./paths");

// ── KaTeX with error reporting ──────────────────────────────────────────────
// throwOnError:false silently renders broken math in red and moves on, which
// is the right behaviour for the page but useless for the author. This wrapper
// keeps that behaviour and records what failed so the status page can show it.

let mathErrors = [];

function setMathCollector(sink) {
  mathErrors = sink;
}

// A renderer crash is caught in render() below so it cannot take the build down.
// Left at that it is invisible: the page carries a "could not be rendered" note
// and the status page reports a clean build. This is the sink that makes the
// document's loss show up in the report.
let demotedHeadings = [];
/** Files whose body h1s were shifted down a level. See demoteHeadings(). */
function setDemotedCollector(sink) {
  demotedHeadings = sink;
}

let renderErrors = [];

function setRenderCollector(sink) {
  renderErrors = sink;
}

/**
 * The images the last render() embedded, as paths inside input_markdown/.
 *
 * A module-level cell rather than a second return value, for the same reason
 * `current` below is one: render() is called from one synchronous loop in
 * library.js and its signature is already load-bearing in four places. The
 * caller reads this immediately after the call that produced it.
 *
 * media.njk subtracts this from the folder's image list so a photograph shown
 * in the body is not repeated in the block underneath it. It has to stay
 * PER-DOCUMENT: folder.media is shared by every entry in the folder, so
 * removing an image from that list would hide it on a sibling page that never
 * showed it at all.
 */
let lastBodyImages = new Set();

function bodyImages() {
  return lastBodyImages;
}

const reportingKatex = {
  renderToString(tex, options) {
    try {
      return katex.renderToString(tex, { ...options, throwOnError: true });
    } catch (err) {
      mathErrors.push({
        file: reportingKatex.currentFile || "",
        tex: String(tex).trim().slice(0, 120),
        message: (err && err.message) || String(err),
      });
      return katex.renderToString(tex, { ...options, throwOnError: false });
    }
  },
  currentFile: "",
};

// ── The renderer ────────────────────────────────────────────────────────────

const md = markdownIt({ html: true, breaks: false, linkify: true })
  .use(markdownItAttrs)
  .use(markdownItLinkAttributes, {
    matcher: (href) => /^https?:\/\//.test(href),
    attrs: { target: "_blank", rel: "noopener noreferrer" },
  })
  .use(markdownItTexmath, {
    engine: reportingKatex,
    delimiters: ["dollars", "brackets"],
    katexOptions: { output: "mathml", throwOnError: false },
  });

// ── Media rewriting ─────────────────────────────────────────────────────────

/** Leave absolute URLs, protocol-relative URLs and data: URIs untouched. */
const isExternal = (src) => /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(String(src));

/**
 * Turn a media filename written relative to the markdown file into an href
 * relative to the page being generated.
 */
function mediaHref(pageUrl, mediaUrl, filename) {
  const clean = String(filename).trim().replace(/^\.\//, "");
  const encoded = clean.split("/").map(encodeSegment).join("/");
  return relTo(pageUrl, `${mediaUrl}/${encoded}`);
}

/**
 * The path INSIDE input_markdown/ that a filename written in this document
 * refers to — the key both the dimension map and the used-image set are keyed
 * on. `relDir` is the document's own folder, so `photo.jpg` beside it and
 * `../shared/photo.jpg` next door both resolve to something scan.js recorded.
 */
function imageKey(relDir, target) {
  const clean = String(target).trim().replace(/^\.\//, "");
  const joined = relDir && relDir !== "." ? `${relDir}/${clean}` : clean;
  return path.posix.normalize(joined);
}

/** imageKey() against the document being rendered. */
function mediaKey(target) {
  return imageKey(current.relDir, target);
}

/**
 * Record that the body embeds `target`, and remember which key the rewritten
 * `src` came from.
 *
 * Done here, during the source rewrite, rather than by matching filenames
 * against the folder listing afterwards: this is the one point where the
 * name the AUTHOR wrote and the URL the PAGE carries are both in hand. Pairing
 * them later would mean re-deriving relTo()'s output, and a document that
 * embeds `../sibling/a.jpg` would quietly pair with this folder's own a.jpg.
 */
function noteImage(target, src) {
  const key = mediaKey(target);
  if (current.used) current.used.add(key);
  // Keyed on the decoded href: markdown-it normalises link destinations while
  // parsing, so the string a renderer rule sees is not always the byte string
  // written here.
  if (current.bysrc) current.bysrc.set(decodeTarget(src), key);
}

/**
 * `src` arrives percent-encoded from mediaHref() and is safe in an attribute.
 * `name` is the raw filename and is NOT: it is whatever the filesystem allows,
 * which on both ext4 and NTFS includes `<`, `>`, `&` and `"`. It used to be
 * interpolated as-is, so a file named `a<img src=x onerror=…>b.mp4` put a
 * working element into the fallback text of every page that embedded it. It
 * goes through escapeHtml() for the same reason media.njk is safe: there, that
 * is Nunjucks' job; here it has to be someone's.
 */
function videoTag(src, name) {
  return `<video class="media-embed" controls preload="metadata" playsinline>` +
    `<source src="${src}" type="${videoMime(name)}">` +
    `Your browser cannot play this video. <a href="${src}">Download ${escapeHtml(name)}</a>.` +
    `</video>`;
}

function audioTag(src, name) {
  return `<audio class="media-embed" controls preload="metadata">` +
    `<source src="${src}" type="${audioMime(name)}">` +
    `Your browser cannot play this audio. <a href="${src}">Download ${escapeHtml(name)}</a>.` +
    `</audio>`;
}

/**
 * Apply a rewrite to the parts of a document that are prose, not code.
 *
 * Media rewriting happens on the markdown SOURCE, before the parser runs, so
 * it has no idea what a fenced block is. Left unguarded it rewrote the sample
 * code in any document that *documents* markdown or Obsidian syntax: a fenced
 * `![alt](rel.jpg)` came out as `![alt](../input_markdown/rel.jpg)`, which is
 * not what the author wrote and not what the page is trying to teach.
 *
 * Both rewrites match single-line constructs, so working a line at a time is
 * enough and avoids having to model the document's block structure.
 */
function outsideCode(source, transform) {
  let fence = null;   // the marker that opened the current fenced block

  return String(source)
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);

      if (fence) {
        // A closing fence must use the same character and be at least as long.
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
        return line;
      }
      if (marker) {
        fence = marker[1];
        return line;   // the opening line carries only the info string
      }

      // Odd indices are inline code spans, which are left exactly as written.
      return line
        .split(/(`+[^`]*`+)/g)
        .map((part, i) => (i % 2 ? part : transform(part)))
        .join("");
    })
    .join("\n");
}

/**
 * Obsidian-style `![[file.ext]]` embeds. Images become normal markdown so they
 * flow through the renderer (and pick up the lightbox); video and audio become
 * raw HTML players.
 */
function expandWikiEmbeds(source, pageUrl, mediaUrl) {
  return outsideCode(source, (text) => text.replace(/!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g, (whole, target) => {
    const name = target.trim();
    const src = mediaHref(pageUrl, mediaUrl, name);
    if (isImage(name)) {
      noteImage(name, src);
      return `![${name}](${src})`;
    }
    if (isVideo(name)) return `\n\n${videoTag(src, name)}\n\n`;
    if (isAudio(name)) return `\n\n${audioTag(src, name)}\n\n`;
    return `[${name}](${src})`;
  }));
}

/** Rewrite relative `![alt](photo.jpg)` targets; leave external ones alone. */
function rewriteRelativeImages(source, pageUrl, mediaUrl) {
  return outsideCode(source, (text) => text.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)([^)]*)\)/g, (whole, alt, src, tail) => {
    if (isExternal(src) || src.startsWith("/")) return whole;
    // Already rewritten by expandWikiEmbeds() a moment ago. `![[a.jpg]]`
    // becomes `![a.jpg](../m/a.jpg)` in the SOURCE, so this pass sees it again
    // and used to rewrite it a second time — relTo() normalised the result back
    // to the same URL, which is why that never showed. It shows now: the second
    // pass recorded `../m/a.jpg` as an embedded image, a path no folder owns,
    // and the bottom gallery stopped hiding the file the body was displaying.
    if (current.bysrc && current.bysrc.has(decodeTarget(src))) return whole;
    const href = mediaHref(pageUrl, mediaUrl, src);
    noteImage(src, href);
    return `![${alt}](${href}${tail})`;
  }));
}

/**
 * Wrap every rendered image in a GLightbox anchor, so images written inline in
 * the markdown body zoom just like the ones in a run.
 * Images already inside a link are left alone — that link is the author's,
 * and so are the run anchors above, which are `<a>…</a>` by the time this runs.
 *
 * EVERY IMAGE HERE GETS A GALLERY OF ITS OWN. GLightbox groups purely by the
 * value of data-gallery — on a click it filters its whole element list down to
 * the ones sharing that string, wherever they sit on the page — so the single
 * name these all used to share ("entry") put every scattered figure in the
 * prose and every file in the folder block underneath into ONE slider. Opening
 * a diagram in the middle of an article and pressing right landed the reader
 * in the folder listing, and a file embedded twice appeared as two identical
 * slides.
 *
 * A unique name per image means a lone image opens as a lone image: zoomable,
 * with no arrows and nothing to arrow to. That is the same line RUN_MINIMUM
 * draws below — two adjacent images are a gallery, one image is a picture.
 */
function addLightbox(html) {
  let index = 0;   // per document: addLightbox() sees the whole body at once
  const parts = html.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // an existing <a>…</a>, leave it
      return part.replace(/<img\b([^>]*?)\/?>/gi, (tag, attrs) => {
        const src = (attrs.match(/\ssrc\s*=\s*"([^"]*)"/i) || [])[1];
        if (!src) return tag;
        const alt = (attrs.match(/\salt\s*=\s*"([^"]*)"/i) || [])[1] || "";
        return `<a href="${src}" class="glightbox" data-gallery="single-${index++}"` +
          (alt ? ` data-title="${alt}"` : "") + `>${tag}</a>`;
      });
    })
    .join("");
}

// ── Justified image runs ────────────────────────────────────────────────────
/**
 * Consecutive images become one justified grid instead of a stack.
 *
 * DETECTION IS STRUCTURAL, NOT TEXTUAL. A run is a sequence of adjacent
 * paragraphs whose inline content is nothing but images and the whitespace
 * between them. That falls straight out of the token stream — markdown-it puts
 * consecutive `![](…)` lines in one paragraph separated by softbreaks, and a
 * blank line starts the next paragraph with nothing in between — so no regex
 * over the rendered HTML is involved and a fenced code sample can never be
 * mistaken for a gallery. A paragraph that also holds a word of prose is not a
 * run, and neither is an image the author wrapped in their own link: the link
 * tokens are not images, so the paragraph simply fails the test.
 *
 * Adjacent paragraphs merge, so blank lines between embeds do not break a
 * gallery up. That is how Obsidian tends to write them.
 *
 * The run REPLACES its paragraphs rather than nesting inside them. Emitting a
 * <div> while the <p> was still open would leave the browser to close the
 * paragraph itself, which produces markup no stylesheet can hold together.
 */

/** Two. One image is a picture; the grid only means something from two up. */
const RUN_MINIMUM = 2;

/** Used when an image's real size could not be read. 3:2, the common frame. */
const FALLBACK_ASPECT = 1.5;

/**
 * Trailing flex spacers, so a short last row keeps the target row height.
 *
 * Without them the last row's items grow to fill the width like every other
 * row, and a run of four images ending in one lonely photograph renders that
 * photograph at full column width. The spacers carry the same flex sizing and
 * zero height, so they absorb the leftover and disappear; if the last row is
 * already full they wrap onto a row of their own and occupy nothing.
 */
const SPACERS = 4;

const isRunGap = (token) =>
  token.type === "softbreak" || (token.type === "text" && !token.content.trim());

/** An inline token holding at least one image and nothing but images. */
function imagesOnly(inline) {
  const children = inline.children || [];
  if (!children.length) return null;
  const images = children.filter((t) => t.type === "image");
  if (!images.length) return null;
  if (!children.every((t) => t.type === "image" || isRunGap(t))) return null;
  return images;
}

/**
 * The image-only paragraphs starting at `i`, or null.
 *
 * Same `level` throughout, so a paragraph inside a blockquote or a list item
 * cannot join a run with one outside it — those are adjacent in the flat token
 * array but nowhere near each other on the page.
 */
function collectRun(tokens, i) {
  const level = tokens[i].level;
  const images = [];
  let at = i;

  while (
    at + 2 < tokens.length
    && tokens[at].type === "paragraph_open"
    && tokens[at].level === level
    && tokens[at + 1].type === "inline"
    && tokens[at + 2].type === "paragraph_close"
  ) {
    const found = imagesOnly(tokens[at + 1]);
    if (!found) break;
    images.push(...found);
    at += 3;
  }

  return images.length ? { images, end: at } : null;
}

md.core.ruler.push("image_runs", function imageRuns(state) {
  const tokens = state.tokens;
  const out = [];
  let i = 0;
  let index = 0;   // per-document, so each run gets its own lightbox group

  while (i < tokens.length) {
    const run = tokens[i].type === "paragraph_open" ? collectRun(tokens, i) : null;
    if (run && run.images.length >= RUN_MINIMUM) {
      const token = new state.Token("image_run", "", 0);
      token.block = true;
      token.level = tokens[i].level;
      token.meta = { images: run.images, index: index++ };
      out.push(token);
      i = run.end;
      continue;
    }
    out.push(tokens[i]);
    i += 1;
  }

  state.tokens = out;
});

/** Attributes markdown-it-attrs put on the image, minus the ones we own. */
function passthroughAttrs(token) {
  const skip = new Set(["src", "alt", "width", "height", "loading", "decoding"]);
  return (token.attrs || [])
    .filter(([name]) => !skip.has(name.toLowerCase()))
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join("");
}

function renderRunItem(token, gallery) {
  const src = token.attrGet("src") || "";
  const alt = token.content || "";
  // Every string here is interpolated into an attribute, and none of them are
  // ours: `src` is a filename off the disk and `alt` is whatever was typed
  // between the brackets. Same reasoning as videoTag() above.
  const href = escapeHtml(src);
  const size = current.dims ? current.dims.get(current.bysrc && current.bysrc.get(decodeTarget(src))) : null;
  const aspect = size ? size.width / size.height : FALLBACK_ASPECT;

  return `<a class="image-run__item glightbox" href="${href}"` +
    ` data-gallery="${gallery}"` +
    (alt ? ` data-title="${escapeHtml(alt)}"` : "") +
    ` style="--ar:${aspect.toFixed(4)}">` +
    `<img src="${href}" alt="${escapeHtml(alt)}"` +
    // Declared only when they are known. A guessed width/height attribute pair
    // would tell the browser something false about a file it is about to load.
    (size ? ` width="${size.width}" height="${size.height}"` : "") +
    ` loading="lazy" decoding="async"${passthroughAttrs(token)}>` +
    `</a>`;
}

md.renderer.rules.image_run = function renderImageRun(tokens, idx) {
  const { images, index } = tokens[idx].meta;
  const gallery = `run-${index}`;
  const spacers = `<i class="image-run__spacer" aria-hidden="true"></i>`.repeat(SPACERS);
  return `<div class="image-run">${images.map((t) => renderRunItem(t, gallery)).join("")}${spacers}</div>\n`;
};

// ── Link rewriting ──────────────────────────────────────────────────────────

/**
 * What render() is currently working on. A module-level cell, like
 * reportingKatex.currentFile above and for the same reason: markdown-it's
 * renderer rules take no per-call context of ours, and rendering is
 * synchronous and single-threaded, so a cell set immediately before md.render()
 * and cleared immediately after cannot be observed by anything else.
 */
const NO_CONTEXT = {
  pageUrl: "/", mediaUrl: "", relDir: "", resolveDoc: null, rewriteLinks: false,
  // Filled in per render() and read by the image-run rules below. `used` is
  // what media.njk subtracts; `bysrc` maps the rewritten src BACK to that key,
  // because by the time a renderer rule sees an image all it has is the href.
  dims: null, used: null, bysrc: null,
};
let current = NO_CONTEXT;

/**
 * Percent-decode a link destination, tolerating a malformed one.
 *
 * markdown-it has already normalised the href by the time a renderer rule sees
 * it, so `[r](<My Report.pdf>)` arrives as "My%20Report.pdf". Decoding here and
 * re-encoding through mediaHref() is what makes a LINK behave exactly like an
 * `![](My Report.pdf)` image: the author writes the filename as it sits beside
 * the markdown, and the generator owns the encoding. Encoding the already
 * encoded string instead would turn every % into %25 and 404 on every filename
 * with a space in it.
 */
function decodeTarget(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Where a relative link in a markdown body should actually point.
 *
 * Media is linked rather than copied, so a path written beside the markdown has
 * to reach back into input_markdown/ from wherever the page ended up under
 * page/. Images have always been rewritten for this; links were not, so
 * `[The report](report.pdf)` resolved against /page/… and 404'd on every
 * single page — while the same file, listed in the auto-discovered downloads
 * block below it, linked correctly.
 *
 * A link to another markdown FILE resolves to that document's page instead of
 * to its raw source, which is almost certainly what the author meant. When the
 * target is not a document the site built, it falls through to the media path:
 * the file still ships inside the bundle, so linking to it beats 404ing, and
 * healthcheck.sh reports it if it is not there at all.
 */
function rewriteLinkHref(href) {
  // Library documents only. about.md and legal.md are site chrome: they sit in
  // input_about_legal/, only their IMAGES are copied anywhere, and they are
  // written with links relative to the page itself — about.md's
  // [status page](page/status.html) already resolves from /about.html and
  // rewriting it into /assets/about/ turns a working link into a 404.
  if (!current.rewriteLinks) return null;

  const raw = String(href || "");
  if (!raw || isExternal(raw) || raw.startsWith("/")) return null;

  // Split the fragment and query off before touching the path, and put them
  // back untouched afterwards — "#section" is the page's business, not ours.
  const match = raw.match(/^([^#?]*)([#?][\s\S]*)?$/);
  const target = decodeTarget(match[1] || "");
  const suffix = match[2] || "";
  if (!target) return null;              // a bare #anchor

  if (isMarkdown(target) && current.resolveDoc) {
    const relPath = path.posix.normalize(
      current.relDir && current.relDir !== "." ? `${current.relDir}/${target}` : target,
    );
    const url = current.resolveDoc(relPath);
    if (url) return relTo(current.pageUrl, url) + suffix;
  }

  return mediaHref(current.pageUrl, current.mediaUrl, target) + suffix;
}

// Installed AFTER markdown-it-link-attributes, so this runs first and that
// plugin sees the rewritten href. That order matters: it adds target="_blank"
// to anything matching ^https?://, and a rewritten local link must not get it.
const renderLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const at = tokens[idx].attrIndex("href");
  if (at >= 0) {
    const rewritten = rewriteLinkHref(tokens[idx].attrs[at][1]);
    if (rewritten !== null) tokens[idx].attrs[at][1] = rewritten;
  }
  return renderLinkOpen(tokens, idx, options, env, self);
};

/**
 * Render one markdown body for one page.
 *
 * @param {string} source   markdown body
 * @param {string} pageUrl  site-absolute URL of the page being written
 * @param {string} mediaUrl site-absolute URL of the folder holding its media
 * @param {string} file     source path, used in math and render error reports
 * @param {object}   [options]
 * @param {boolean}  [options.rewriteLinks] rewrite relative link destinations
 *        back into input_markdown/. True for library documents; false for
 *        about.md and legal.md, whose links are written relative to the page.
 * @param {function} [options.resolveDoc] relPath inside input_markdown/ → that
 *        document's page URL, so `[see](other.md)` links to the built page
 *        rather than to the raw file.
 * @param {Map}      [options.dims] relPath inside input_markdown/ →
 *        {width, height}, from scan.js. Image runs lay out from these; without
 *        the map every image falls back to FALLBACK_ASPECT.
 * @returns {string} the rendered HTML. The images the body embedded are left
 *        in bodyImages() for the caller — see there for why it is not returned
 *        alongside.
 */
function render(source, pageUrl, mediaUrl, file = "", options = {}) {
  if (!source || !String(source).trim()) return "";
  reportingKatex.currentFile = file;
  lastBodyImages = new Set();
  current = {
    pageUrl,
    mediaUrl,
    dims: options.dims || null,
    // Filled by noteImage() during the source rewrites below, then read by
    // renderRunItem() during md.render() — both inside this one call.
    used: lastBodyImages,
    bysrc: new Map(),
    // The folder the markdown lives in, so a relative link can be resolved
    // against it. `file` is the path inside input_markdown/, e.g. "docs/a.md".
    relDir: file ? path.posix.dirname(String(file)) : "",
    resolveDoc: options.resolveDoc || null,
    rewriteLinks: options.rewriteLinks === true,
  };

  let text = String(source);
  text = expandWikiEmbeds(text, pageUrl, mediaUrl);
  text = rewriteRelativeImages(text, pageUrl, mediaUrl);

  let html;
  try {
    html = md.render(text);
  } catch (err) {
    // A renderer crash must not take the build down with it — but the body of
    // the document is gone, which is the most serious thing that can happen to
    // a page, so it is recorded rather than only shown on the page itself.
    // Escaped, not stripped: a message that mentions a tag should say so
    // rather than silently losing the characters that made it meaningful.
    const message = escapeHtml(String((err && err.message) || err));
    renderErrors.push({ file, message });
    html = `<p class="render-error">This file could not be rendered (${message}).</p>`;
  }
  reportingKatex.currentFile = "";
  current = NO_CONTEXT;

  const lightboxed = addLightbox(html);
  const demoted = demoteHeadings(lightboxed);
  if (demoted !== lightboxed) {
    // Report what moved. The demotion makes the page valid on its own, but the
    // author is the only one who can decide whether the title in the YAML or
    // the one in the body is the one they meant.
    const found = lightboxed.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi) || [];
    demotedHeadings.push({
      file,
      count: found.length,
      headings: found.map((h) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()),
    });
  }
  return demoted;
}

// ── Heading levels ──────────────────────────────────────────────────────────

/**
 * Shift every heading down one level when the body contains an h1.
 *
 * The page already prints an h1 of its own (the frontmatter title, in
 * entry.njk), so an h1 inside the body is a second top-level heading on the
 * same page — invalid, and it makes the *less* authoritative title the larger
 * one. stripDuplicateTitle() in normalise.js removes the h1 that merely
 * repeats the title, but most of them don't repeat it: the title is a short
 * shelf label ("Binocular") and the body h1 is the document's own name
 * ("Comprehensive Guide to Binoculars"). Those are different strings, so no
 * amount of text matching reconciles them — the rule has to be structural.
 *
 * Cascading rather than demoting the h1 alone preserves relative nesting:
 * `# Title / ## Optics` becomes `## Title / ### Optics`, so Optics stays a
 * child instead of flattening into a sibling.
 *
 * A body with no h1 is returned untouched, so documents that were already
 * well-formed render byte-for-byte as before.
 */
function demoteHeadings(html) {
  if (!html || !/<h1\b/i.test(String(html))) return html || "";
  // One pass with a callback, not h5→h6 then h6→…: sequential replacements
  // would shift the same heading twice. h6 has nowhere to go, so it clamps —
  // a document nested that deeply loses the distinction between its last two
  // levels, which is rarer than the invalid outline this fixes.
  return String(html).replace(
    /<(\/?)h([1-6])\b([^>]*)>/gi,
    (_whole, slash, level, attrs) => `<${slash}h${Math.min(Number(level) + 1, 6)}${attrs}>`,
  );
}

// ── Article chrome: anchors + table of contents ─────────────────────────────
// Both run at build time on the rendered HTML, so the floating outline needs
// no JavaScript at all. Ported from website_v3_014's eleventy.config.js.

function slugForHeading(text, used) {
  const base = String(text)
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "") || "section";
  let slug = base;
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

/**
 * Give every h2-h4 an id, respecting one the author already wrote.
 *
 * h4 is included because demoteHeadings() pushes a document's h3 sections down
 * to h4; without it the outline would lose entries on exactly the pages the
 * demotion was meant to fix.
 */
function addAnchors(html) {
  if (!html) return "";
  const text = String(html);
  // Collect every id the document already carries BEFORE generating any, so a
  // slug can never collide with an id written further down. Scanning as we go
  // only saw ids that had already been passed, which let `## Intro` claim
  // "intro" ahead of an explicit `{#intro}` later in the same body.
  const used = new Set();
  for (const m of text.matchAll(/\sid\s*=\s*"([^"]*)"/gi)) used.add(m[1]);

  return text.replace(
    /<h([234])\b([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (whole, level, attrs, inner) => {
      if (/\sid\s*=\s*"/i.test(attrs)) return whole;   // author's own id wins
      return `<h${level}${attrs} id="${slugForHeading(inner, used)}">${inner}</h${level}>`;
    },
  );
}

/** Build the nested outline from the ids addAnchors just wrote. */
function toc(html) {
  if (!html) return "";
  const headings = [];
  const re = /<h([234])\b[^>]*\sid\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = re.exec(String(html))) !== null) {
    headings.push({
      level: Number(match[1]),
      id: match[2],
      text: match[3].replace(/<[^>]+>/g, "").trim(),
    });
  }
  if (headings.length < 2) return "";

  const item = (h) =>
    `<li class="article-outline-item article-outline-item--h${h.level}">` +
    `<a href="#${h.id}">${h.text}</a></li>`;

  return `<ul class="article-outline-list">${headings.map(item).join("")}</ul>`;
}

module.exports = {
  md, render, addAnchors, toc, demoteHeadings, bodyImages, imageKey,
  setMathCollector, setRenderCollector, setDemotedCollector,
  videoTag, audioTag,
};
