/**
 * site.js — site-wide settings.
 *
 * The values live in site_settings.json at the project root; this file holds
 * the defaults, the validation and the documentation JSON cannot carry.
 *
 *   site_settings.json        edit this to rebrand — no recompile needed
 *   lib/site.js               defaults + validation (compiled into the binary)
 *
 * Read with fs.readFileSync from the WORKING DIRECTORY, never require()d. Two
 * reasons, and both of them bite:
 *
 *   - require() would let Bun inline the file's contents at compile time, so
 *     the standalone binary would carry a frozen copy of whatever the settings
 *     said on the day it was compiled and ignore every later edit. The whole
 *     point of a settings file is that it works without a recompile.
 *   - __dirname inside the compiled binary points into Bun's bundled
 *     filesystem, not at the project. process.cwd() is the same directory
 *     Eleventy resolves its passthrough-copy paths against, so this file and
 *     the build agree about where the project is.
 *
 * This is the same discipline staticsDir() follows in lib/statics.js, for the
 * same reason — see the long note there.
 *
 * Nothing here throws. A missing file is the normal case and is silent; a
 * malformed one falls back to the defaults and reports itself on the status
 * page. A typo in JSON must never cost someone their build.
 */

const fs = require("fs");
const path = require("path");

const FILE_NAME = "site_settings.json";

/**
 * What the site is when nothing says otherwise.
 *
 * lang is "en-GB" rather than "en" because it feeds BOTH <html lang> and the
 * date formatter: "en" would render 26 Aug 2026 as "Aug 26, 2026". The colours
 * are the existing backdrop tokens from theme.css, not new ones.
 */
const DEFAULTS = {
  name: "Encyclopaedia",
  shortName: "Encyclopaedia",
  description: "An offline-first reference generated from a folder of markdown.",

  // Empty means "this site has no canonical home". Left empty, base.njk emits
  // no canonical link and no Open Graph tags at all, and every URL on the site
  // stays relative — which is what lets the output work from a file:// path.
  url: "",

  lang: "en-GB",
  themeColor: "#000000",        // --color-backdrop-dark-start
  backgroundColor: "#ffffff",   // --color-backdrop-light-center

  // Cards per folder page and per facet page. /page/all.html is deliberately
  // never paginated — find-in-page over the lot is the point of it.
  maxPostsPerPage: 60,

  // Rendered in the desktop bar AND the mobile menu. Links are site-absolute:
  // they go through the `rel` filter, which rewrites them relative to whatever
  // page is being written. An http(s):// link is passed through untouched and
  // opens in a new tab.
  nav: [
    { label: "Home", link: "/index.html", order: 1 },
    { label: "Index", link: "/page/all.html", order: 2 },
  ],

  // A separate list from nav on purpose: the footer has always carried more
  // than the bar does, and folding them together would lose that.
  footerLinks: [
    { label: "Home", link: "/index.html", order: 1 },
    { label: "Full index", link: "/page/all.html", order: 2 },
    { label: "About", link: "/about.html", order: 3 },
    { label: "Legal", link: "/legal.html", order: 4 },
    { label: "Status", link: "/page/status.html", order: 5 },
  ],
};

/** Where the settings file is looked for. Exported so the config can watch it. */
function settingsFile() {
  return path.resolve(process.cwd(), FILE_NAME);
}

// ── Field validation ────────────────────────────────────────────────────────

/**
 * Run one settings field through one check.
 *
 * `check` must return `{ ok: value }` or `{ reason: "…" }`, optionally
 * `{ ok: value, warn: "…" }` for a value that was accepted but adjusted. There
 * is deliberately no fourth shape and no way to return nothing: a check cannot
 * accept a value without either passing it or saying why it didn't.
 *
 * That used to be a convention described in a comment here, and the two
 * validators that did not follow it were exactly the two that went wrong.
 * takePerPage() called Number() itself rather than checking the type, so `true`
 * became 1 and `2.5` became 2, both silently; takeLang() asked a question
 * (does toLocaleDateString throw?) that "qq-XX" and "not-a-language" both pass.
 * A bad value in a settings file must never be indistinguishable from a good
 * one — the whole point of the status page is that it says what it did.
 *
 * A field that is simply ABSENT is not a warning: partial files are a
 * supported way to use this — override the name and inherit the rest.
 */
function take(field, raw, fallback, warnings, check) {
  if (raw === undefined) return fallback;

  const verdict = check(raw) || {};
  if (!Object.prototype.hasOwnProperty.call(verdict, "ok")) {
    warnings.push({ field, message: verdict.reason || "could not be used — using the default" });
    return fallback;
  }
  if (verdict.warn) warnings.push({ field, message: verdict.warn });
  return verdict.ok;
}

function takeString(raw, fallback, field, warnings, { allowEmpty = false } = {}) {
  return take(field, raw, fallback, warnings, (value) => {
    if (typeof value !== "string") {
      return { reason: `expected a string, got ${describe(value)} — using the default` };
    }
    const text = value.trim();
    if (!text && !allowEmpty) return { reason: "is empty — using the default" };
    return { ok: text };
  });
}

/**
 * A language tag, which has to satisfy two consumers at once: it is written
 * into <html lang> AND it is the locale dates are formatted in.
 *
 * Both questions have to be asked, because they are different questions:
 *
 *   STRUCTURAL — Intl.Locale throws on something that is not a language tag at
 *   all ("garbage!", "en_GB"). This is the check that matters for the build:
 *   a tag Intl rejects makes toLocaleDateString throw, and that would take a
 *   whole site down over one typo.
 *
 *   KNOWN — but structure is a low bar, and that was the bug. "qq-XX", "zz"
 *   and "not-a-language" are all perfectly well-formed BCP-47 and all name
 *   nothing, so the old check waved them through: the site got a wrong
 *   <html lang>, dates in the runtime's default locale rather than the one
 *   asked for, and no row on the status page to explain either. Asking
 *   supportedLocalesOf() is what tells a real tag from a well-formed invention.
 *
 * Node and Bun return the same answers here, which matters: `npm run build`
 * and the standalone binary must not disagree about whether a settings file
 * is valid.
 */
function takeLang(raw, fallback, warnings) {
  return take("lang", raw, fallback, warnings, (value) => {
    if (typeof value !== "string" || !value.trim()) {
      return { reason: `expected a language tag, got ${describe(value)} — using ${fallback}` };
    }
    const tag = value.trim();
    try {
      new Intl.Locale(tag);
    } catch {
      return { reason: `"${tag}" is not a language tag Intl recognises — using ${fallback}` };
    }
    if (!Intl.DateTimeFormat.supportedLocalesOf(tag).length) {
      return { reason: `"${tag}" is a well-formed tag but names no locale this build knows — using ${fallback}` };
    }
    return { ok: tag };
  });
}

/** A URL only counts if it is absolute; anything else would break every link. */
function takeUrl(raw, fallback, warnings) {
  return take("url", raw, fallback, warnings, (value) => {
    if (typeof value !== "string") {
      return { reason: `expected a string, got ${describe(value)} — using the default` };
    }
    const text = value.trim();
    // Empty is how you say "this site has no canonical home", not a mistake.
    if (!text) return { ok: "" };
    if (!/^https?:\/\//i.test(text)) {
      return {
        reason: `"${text}" is not an absolute http(s) URL — canonical and Open Graph tags were left off`,
      };
    }
    return { ok: text.replace(/\/+$/, "") };
  });
}

/** Clamped rather than rejected: 0 would divide by zero, 100000 is a typo. */
const MAX_PER_PAGE = 1000;
function takePerPage(raw, fallback, warnings) {
  return take("maxPostsPerPage", raw, fallback, warnings, (value) => {
    const whole = `expected a whole number of 1 or more, got ${describe(value)} — using ${fallback}`;

    // A JSON number is what belongs here. A numeric STRING is honoured rather
    // than rejected: "20" was accepted silently before, and turning that into
    // a rejection would quietly resize somebody's pages. It is reported, which
    // is the half that was missing.
    let n = value;
    let quoted = null;
    if (typeof value === "string" && value.trim() && Number.isInteger(Number(value))) {
      n = Number(value);
      quoted = `${JSON.stringify(value)} is text — using ${n}, but the quote marks do not belong here`;
    }

    // typeof, not Number(): Number(true) is 1 and Number("") is 0, so anything
    // that merely COERCES to a number used to be accepted as a count of cards.
    if (typeof n !== "number" || !Number.isFinite(n)) return { reason: whole };
    // 2.5 is not a count of cards either. It used to floor to 2 without a word.
    if (!Number.isInteger(n) || n < 1) return { reason: whole };

    if (n > MAX_PER_PAGE) {
      return {
        ok: MAX_PER_PAGE,
        warn: `${n} is more than the ${MAX_PER_PAGE} limit — clamped to ${MAX_PER_PAGE}`,
      };
    }
    return quoted ? { ok: n, warn: quoted } : { ok: n };
  });
}

/**
 * A list of nav links.
 *
 * Sorted by `order`, with the position in the file as the tie-break, so a file
 * that omits `order` entirely still renders in the order it was written and two
 * links sharing an order never swap between builds. A link missing its label or
 * its target is dropped rather than rendered as an empty <a>.
 */
function takeLinks(raw, fallback, field, warnings) {
  if (raw === undefined) return fallback;
  if (!Array.isArray(raw)) {
    warnings.push({ field, message: `expected a list of links, got ${describe(raw)} — using the default` });
    return fallback;
  }

  const links = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      warnings.push({ field, message: `item ${index + 1} is ${describe(item)}, not a link — skipped` });
      return;
    }
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const link = typeof item.link === "string" ? item.link.trim() : "";
    if (!label || !link) {
      warnings.push({
        field,
        message: `item ${index + 1} needs both a label and a link — skipped`,
      });
      return;
    }
    const order = Number(item.order);
    links.push({
      label,
      link,
      order: Number.isFinite(order) ? order : index,
      index,
      // Worked out here rather than in the template: relTo() already passes an
      // absolute URL through untouched, but only the link itself knows whether
      // it should open in a new tab.
      external: /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(link),
    });
  });

  return links.sort((a, b) => a.order - b.order || a.index - b.index);
}

/**
 * The defaults go through takeLinks too, so a default link and a configured one
 * are the same shape — `external` in particular, which the templates read.
 * Warnings are discarded: the defaults are ours and are known to be valid.
 */
function defaultLinks(list, field) {
  return takeLinks(list, [], field, []);
}

/** Readable type name for a warning message. */
function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return `a ${typeof value}`;
}

/** The defaults, with their link lists normalised — the "nothing usable in the
 *  settings file" answer, in the same shape a good file produces. */
function withDefaultLinks() {
  return {
    ...DEFAULTS,
    nav: defaultLinks(DEFAULTS.nav, "nav"),
    footerLinks: defaultLinks(DEFAULTS.footerLinks, "footerLinks"),
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Cache, keyed on what the file looked like when it was last read.
 *
 * This is called far more often than it looks: the readableDate filter needs
 * the locale, and a large site formats a couple of thousand dates per build.
 * Reading, parsing and re-validating the file that many times made date
 * formatting one of the most expensive things in the build.
 *
 * Keyed on mtime + size rather than simply held forever, because `npm start`
 * keeps this module loaded across rebuilds and an edit to site_settings.json
 * has to show up without restarting the dev server. Touching the file changes
 * the key, so the next call re-reads it.
 */
let cache = null;      // { key, value }

/** Identity of the file as it is right now, or null if there isn't one. */
function fileKey(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

/**
 * Read, validate and return the settings.
 *
 * Called from three places — eleventyConfig.addGlobalData("site", …), the
 * readableDate filter, and lib/library.js, which needs maxPostsPerPage before
 * any template runs. Global data evaluation order is not guaranteed, so
 * library.js calls this itself rather than assuming the global already exists.
 */
module.exports = function loadSite() {
  const file = settingsFile();

  const key = fileKey(file);
  if (cache && cache.key === key) return cache.value;

  const value = readSettings(file);
  cache = { key, value };
  return value;
};

/** The uncached read. Everything above this line exists to call it rarely. */
function readSettings(file) {
  const warnings = [];

  let raw = null;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    // No file at all is the normal case for a fresh checkout, not a problem.
    return { ...withDefaultLinks(), settingsFile: file, settingsFound: false, warnings };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    warnings.push({
      field: FILE_NAME,
      message: `could not be parsed as JSON (${err.message}) — every setting fell back to its default`,
    });
    return { ...withDefaultLinks(), settingsFile: file, settingsFound: true, warnings };
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    warnings.push({
      field: FILE_NAME,
      message: `should hold a JSON object, but holds ${describe(data)} — every setting fell back to its default`,
    });
    return { ...withDefaultLinks(), settingsFile: file, settingsFound: true, warnings };
  }

  return {
    name: takeString(data.name, DEFAULTS.name, "name", warnings),
    shortName: takeString(data.shortName, DEFAULTS.shortName, "shortName", warnings),
    description: takeString(data.description, DEFAULTS.description, "description", warnings),
    url: takeUrl(data.url, DEFAULTS.url, warnings),
    lang: takeLang(data.lang, DEFAULTS.lang, warnings),
    themeColor: takeString(data.themeColor, DEFAULTS.themeColor, "themeColor", warnings),
    backgroundColor: takeString(data.backgroundColor, DEFAULTS.backgroundColor, "backgroundColor", warnings),
    maxPostsPerPage: takePerPage(data.maxPostsPerPage, DEFAULTS.maxPostsPerPage, warnings),
    nav: takeLinks(data.nav, defaultLinks(DEFAULTS.nav, "nav"), "nav", warnings),
    footerLinks: takeLinks(
      data.footerLinks, defaultLinks(DEFAULTS.footerLinks, "footerLinks"), "footerLinks", warnings),
    settingsFile: file,
    settingsFound: true,
    warnings,
  };
}

module.exports.DEFAULTS = DEFAULTS;
module.exports.FILE_NAME = FILE_NAME;
module.exports.settingsFile = settingsFile;
