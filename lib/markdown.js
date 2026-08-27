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

function videoTag(src, name) {
  return `<video class="media-embed" controls preload="metadata" playsinline>` +
    `<source src="${src}" type="${videoMime(name)}">` +
    `Your browser cannot play this video. <a href="${src}">Download ${name}</a>.` +
    `</video>`;
}

function audioTag(src, name) {
  return `<audio class="media-embed" controls preload="metadata">` +
    `<source src="${src}" type="${audioMime(name)}">` +
    `Your browser cannot play this audio. <a href="${src}">Download ${name}</a>.` +
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
    if (isImage(name)) return `![${name}](${src})`;
    if (isVideo(name)) return `\n\n${videoTag(src, name)}\n\n`;
    if (isAudio(name)) return `\n\n${audioTag(src, name)}\n\n`;
    return `[${name}](${src})`;
  }));
}

/** Rewrite relative `![alt](photo.jpg)` targets; leave external ones alone. */
function rewriteRelativeImages(source, pageUrl, mediaUrl) {
  return outsideCode(source, (text) => text.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)([^)]*)\)/g, (whole, alt, src, tail) => {
    if (isExternal(src) || src.startsWith("/")) return whole;
    return `![${alt}](${mediaHref(pageUrl, mediaUrl, src)}${tail})`;
  }));
}

/**
 * Wrap every rendered image in a GLightbox anchor, so images written inline in
 * the markdown body zoom just like the ones in the auto-discovered gallery.
 * Images already inside a link are left alone — that link is the author's.
 */
function addLightbox(html) {
  const parts = html.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // an existing <a>…</a>, leave it
      return part.replace(/<img\b([^>]*?)\/?>/gi, (tag, attrs) => {
        const src = (attrs.match(/\ssrc\s*=\s*"([^"]*)"/i) || [])[1];
        if (!src) return tag;
        const alt = (attrs.match(/\salt\s*=\s*"([^"]*)"/i) || [])[1] || "";
        return `<a href="${src}" class="glightbox" data-gallery="entry"` +
          (alt ? ` data-title="${alt}"` : "") + `>${tag}</a>`;
      });
    })
    .join("");
}

// ── Link rewriting ──────────────────────────────────────────────────────────

/**
 * What render() is currently working on. A module-level cell, like
 * reportingKatex.currentFile above and for the same reason: markdown-it's
 * renderer rules take no per-call context of ours, and rendering is
 * synchronous and single-threaded, so a cell set immediately before md.render()
 * and cleared immediately after cannot be observed by anything else.
 */
const NO_CONTEXT = { pageUrl: "/", mediaUrl: "", relDir: "", resolveDoc: null, rewriteLinks: false };
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
 */
function render(source, pageUrl, mediaUrl, file = "", options = {}) {
  if (!source || !String(source).trim()) return "";
  reportingKatex.currentFile = file;
  current = {
    pageUrl,
    mediaUrl,
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
    const message = String((err && err.message) || err).replace(/[<>&]/g, "");
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
  md, render, addAnchors, toc, demoteHeadings,
  setMathCollector, setRenderCollector, setDemotedCollector,
  videoTag, audioTag,
};
