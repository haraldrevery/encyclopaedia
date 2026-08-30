/**
 * Eleventy configuration.
 *
 * Input is the project root (templates in pages/, includes in eleventy_settings/).
 * Output is content/, which is the folder you actually distribute:
 *
 *   content/input_markdown/   your project — read, never written
 *   content/index.html        the homepage
 *   content/page/…            every generated page, mirroring your folders
 *   content/assets/…          css, fonts, favicons, lightbox
 *
 * Media is not copied. Pages link back into input_markdown/ with relative
 * paths, so a 112 MB project produces a few MB of HTML instead of a 119 MB
 * duplicate of itself.
 */

const fs = require("fs");

const { relTo, slugify, humanise, fnv1a } = require("./lib/paths");
const { escapeHtml } = require("./lib/html");
const markdown = require("./lib/markdown");
const { UNKNOWN } = require("./lib/normalise");
const { bundleOutputDir, markdownDir } = require("./lib/bundle");
const buildLibrary = require("./lib/library");
const buildStatics = require("./lib/statics");
const { buildSearchIndex } = require("./lib/search");
const loadSite = require("./lib/site");

module.exports = function (eleventyConfig) {
  // ── Global data ───────────────────────────────────────────────────────────
  // Supplied here rather than from _data/ so that everything the build needs is
  // compiled into the standalone binary. See the note at the top of lib/library.js.
  eleventyConfig.addGlobalData("library", buildLibrary);
  eleventyConfig.addGlobalData("statics", buildStatics);
  // A function, not the object it returns: Eleventy re-runs global data on
  // every rebuild, which is what makes an edit to site_settings.json show up
  // in `npm start` without restarting the server.
  eleventyConfig.addGlobalData("site", loadSite);

  // ── Assets ────────────────────────────────────────────────────────────────
  // Everything lands under content/assets/ so the output root stays readable.
  //
  // The stylesheets are FLATTENED on the way out: they live in css/ in the
  // project, but publish to assets/ rather than assets/css/. That asymmetry is
  // deliberate and load-bearing. theme.css references ./fonts/… and input.css
  // references ./svg/…, Tailwind copies those url() values through verbatim,
  // and a url() resolves against the stylesheet's OWN location. Published to
  // assets/, where fonts/ and svg/ are siblings, they resolve. Published to
  // assets/css/, every font and the background map would 404.
  eleventyConfig.addPassthroughCopy({ "css/main.css": "assets/main.css" });
  eleventyConfig.addPassthroughCopy({ "css/prose.css": "assets/prose.css" });
  eleventyConfig.addPassthroughCopy({ fonts: "assets/fonts" });
  eleventyConfig.addPassthroughCopy({ svg: "assets/svg" });
  eleventyConfig.addPassthroughCopy({ javascript: "assets/javascript" });
  eleventyConfig.addPassthroughCopy({ "css/glightbox.min.css": "assets/glightbox.min.css" });
  // glightbox.min.js is NOT listed: it lives in javascript/, which the line
  // above copies wholesale, so it travels with the other scripts to
  // assets/javascript/. An explicit rule here would copy it a second time, to
  // a second location, and the two would drift the next time it is upgraded.
  // The icons live in favicon/ so the project root stays readable. Only the
  // INPUT location moved: they still land at assets/favicon.ico and friends, so
  // base.njk and the manifest are unchanged.
  //
  // Note favicon.svg and safari-pinned-tab.svg belong here and NOT in svg/ —
  // that folder is copied wholesale to assets/svg for the background map.
  //
  // site.webmanifest is NOT in this list: it is generated from lib/site.js by
  // pages/webmanifest.njk. Copying a static one here would overwrite it.
  //
  // Guarded, because Eleventy treats a passthrough source that does not exist
  // as a build error. Deleting an icon you do not want should cost you that
  // icon, not your site.
  for (const icon of [
    "favicon.ico", "favicon.svg", "favicon-96x96.png",
    "apple-touch-icon.png", "safari-pinned-tab.svg",
    "web-app-manifest-192x192.png", "web-app-manifest-512x512.png",
  ]) {
    const source = `${FAVICON_DIR}/${icon}`;
    if (!fs.existsSync(source)) {
      console.warn(`[encyclopedia] ${source} not found — skipping that icon.`);
      continue;
    }
    eleventyConfig.addPassthroughCopy({ [source]: `assets/${icon}` });
  }

  // The About portrait. Unlike everything under input_markdown/, this one is
  // copied rather than linked: input_about_legal/ sits outside the bundle, so
  // there is no relative path from a built page back to it. Registered once,
  // here — an image dropped in while `npm start` is running needs a restart.
  for (const image of buildStatics.imageFiles()) {
    eleventyConfig.addPassthroughCopy({
      [`${buildStatics.DIR_NAME}/${image}`]: `assets/about/${image}`,
    });
  }

  eleventyConfig.addWatchTarget("./lib/");
  eleventyConfig.addWatchTarget("./site_settings.json");
  // markdownDir(), not "./content/input_markdown/": the bundle is selectable
  // (ENCYCLOPEDIA_BUNDLE / `encyclopedia <folder>`), and a hardcoded path meant
  // `npm start` on any other bundle watched a folder the build never read.
  eleventyConfig.addWatchTarget(markdownDir());
  eleventyConfig.addWatchTarget("./input_about_legal/");

  // ── Links ─────────────────────────────────────────────────────────────────
  // Every href and src in every template goes through this. `this.page.url` is
  // the page being written, so the result is always relative to it — which is
  // what lets the site work from a file:// path or a USB stick.
  eleventyConfig.addFilter("rel", function (target, from) {
    return relTo(from || (this.page && this.page.url) || "/", target);
  });

  // ── Dates ─────────────────────────────────────────────────────────────────
  // A null date is a real, expected state, not an error. It renders as
  // "Unknown" everywhere rather than silently becoming the build time.
  //
  // The locale is site_settings.json's `lang`, which is why that defaults to
  // "en-GB" and not "en": "en" alone would render this as "Aug 26, 2026".
  // Read at call time rather than closed over, so the dev server picks up an
  // edit to the settings file without a restart.
  eleventyConfig.addFilter("readableDate", (date) => {
    if (!date) return UNKNOWN;
    return date.toLocaleDateString(dateLocale(), {
      year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
    });
  });
  eleventyConfig.addFilter("isoDate", (date) =>
    date ? date.toISOString().slice(0, 10) : "");
  eleventyConfig.addFilter("year", (date) => (date ? date.getUTCFullYear() : UNKNOWN));

  // ── Text ──────────────────────────────────────────────────────────────────
  // Named toSlug, not slug: Eleventy ships its own built-in `slug`/`slugify`
  // filters, and re-registers them during initializeConfig() — which runs
  // AFTER this callback in the standalone binary. A filter called `slug` is
  // therefore ours under `npx eleventy` and Eleventy's under the binary, so
  // facet links and the permalinks generated in lib/library.js would disagree
  // and every category and tag page would 404 in one of the two builds.
  eleventyConfig.addFilter("toSlug", slugify);
  eleventyConfig.addFilter("humanise", humanise);

  /** Per-character fade-in used on page headings. Sequential left to right,
   *  with deterministic jitter. The 0.012s step makes the whole spread of a
   *  13-character word under 0.2s against an 0.8s fade, so the characters
   *  overlap almost entirely and it reads as one soft shimmer — which is what
   *  a heading wants, given a facet value can run 30+ characters.
   *
   *  Not to be confused with animateChars below, which splits the same way but
   *  scatters instead of sweeping. The homepage uses that one. */
  eleventyConfig.addFilter("animateTitle", (text) =>
    String(text == null ? "" : text)
      .split("")
      .map((char, i) => {
        const delay = (((char.charCodeAt(0) * 13 + i * 7) % 9) * 0.01 + i * 0.012).toFixed(3);
        return `<span class="word_animation" style="animation-delay:${delay}s">${
          char === " " ? "&nbsp;" : escapeHtml(char)
        }</span>`;
      })
      .join(""));

  /** Per-character fade-in, scattered. The homepage title only: there the
      animation IS the entrance, so the characters arrive out of order rather
      than sweeping past. The window is narrower than animateWords' 1.3s, so
      the title settles first and the description fills in under it. */
  eleventyConfig.addFilter("animateChars", (text, spread = 0.8) =>
    String(text == null ? "" : text)
      .split("")
      .map((char, i) => {
        const delay = scatterDelay(`${char}:${i}`, spread);
        // A bare space would collapse: the spans are inline-block, so the
        // character has to survive as &nbsp; inside its own span.
        return `<span class="word_animation" style="animation-delay:${delay}s">${
          char === " " ? "&nbsp;" : escapeHtml(char)
        }</span>`;
      })
      .join(""));

  /** Per-word fade-in used on the homepage description. Scattered, not
      sequential: the words appear out of reading order the way they do on
      website_v3_014. */
  eleventyConfig.addFilter("animateWords", (text, spread = 1.3) =>
    String(text == null ? "" : text)
      .split(/\s+/)
      .filter(Boolean)
      .map((word, i) => {
        const delay = scatterDelay(`${word}:${i}`, spread);
        return `<span class="word_animation" style="animation-delay:${delay}s">${escapeHtml(word)}</span>`;
      })
      // The separator is a real space BETWEEN spans, not inside them. A span
      // is inline-block with white-space: pre, so a trailing space inside one
      // would be an unbreakable part of the word and the line would not wrap.
      .join(" "));

  /**
   * HTML-escape a value.
   *
   * NOT for use in a plain {{ }}: Nunjucks autoescaping already escapes
   * everything interpolated into a template, so piping through this as well
   * escapes twice — a folder tagged "Shelter & Sleep" reached the page as
   * "Shelter &amp;amp; Sleep" and rendered with the entity visible. Every
   * template call site was removed for exactly that reason.
   *
   * Kept registered because it is still correct inside a `| safe` chain, where
   * autoescaping is off and something has to do the escaping — which is what
   * animateChars and the markdown renderer do internally.
   */
  eleventyConfig.addFilter("escape_attr", escapeHtml);

  // ── Markdown ──────────────────────────────────────────────────────────────
  // Rendered here rather than through Eleventy's own markdown pipeline,
  // because the source files live outside the template tree and each one needs
  // the URL of the page it is being rendered into to resolve its media.
  eleventyConfig.addFilter("markdown", function (body, mediaUrl, file) {
    return markdown.render(body, (this.page && this.page.url) || "/", mediaUrl, file);
  });
  eleventyConfig.addFilter("addAnchors", markdown.addAnchors);
  eleventyConfig.addFilter("toc", markdown.toc);

  // ── Misc ──────────────────────────────────────────────────────────────────
  eleventyConfig.addFilter("take", (list, n) => (Array.isArray(list) ? list.slice(0, n) : []));
  eleventyConfig.addFilter("kb", (bytes) => `${Math.round(Number(bytes) || 0)} KB`);

  // ── Search ────────────────────────────────────────────────────────────────
  // Reshapes library.allEntries into the compact rows pages/search-index.njk
  // writes out. A filter rather than global data: it is needed by exactly one
  // template, and every other page would otherwise carry it for nothing.
  eleventyConfig.addFilter("searchIndex", buildSearchIndex);

  eleventyConfig.setQuietMode(false);

  return {
    dir: {
      input: ".",
      includes: "eleventy_settings",
      output: bundleOutputDir(),
    },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};

/** Where the favicon source files live, relative to the project root. */
const FAVICON_DIR = "favicon";

/**
 * The locale dates are formatted in — site_settings.json's `lang`.
 *
 * loadSite() has already checked Intl accepts it and fallen back with a warning
 * if not, so this cannot throw. It is also memoised on the file's mtime, which
 * matters here: this runs once per date rendered, a couple of thousand times on
 * a large site.
 */
function dateLocale() {
  return loadSite().lang;
}

/** Pseudo-random animation delay in [0.02, spread] seconds, to two decimals.
 *  Scattered rather than sequential, so the text assembles out of reading
 *  order — the website_v3_014 look. Shared by animateChars and animateWords
 *  so the title and the description land on one window. */
const MIN_DELAY = 0.02;
function scatterDelay(seed, spread) {
  const range = Math.max(1, Math.round((spread - MIN_DELAY) * 100));
  return ((fnv1a(seed) % range) / 100 + MIN_DELAY).toFixed(2);
}

