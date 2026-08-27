/**
 * normalise.js — the metadata safety net.
 *
 * Turns whatever YAML a file happens to have (or doesn't) into a complete,
 * predictable record. Nothing in here throws and nothing returns undefined:
 * an empty file and a fully-specified one produce the same shape.
 *
 * Every time a fallback fires it appends to `warnings`. That array is the only
 * source the status page reads from, so a fallback that doesn't record itself
 * is a fallback that silently lies to the reader.
 */

const NO_TITLE = "-no title-";
const UNKNOWN = "Unknown";
const MISC = "Misc.";

// ── Body-text extraction helpers ────────────────────────────────────────────

/** Strip fenced code blocks so headings/prose inside them are never picked up. */
function stripFences(body) {
  return body.replace(/^```[\s\S]*?^```\s*$/gm, "").replace(/^~~~[\s\S]*?^~~~\s*$/gm, "");
}

/** Remove markdown emphasis/link/code syntax from a line of heading or prose. */
function stripInline(text) {
  return text
    .replace(/!\[\[[^\]]*\]\]/g, "")             // Obsidian embeds
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")        // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")     // links → label
    // Wikilinks → the text a reader actually sees. `[[target|alias]]` renders
    // as the alias in Obsidian, so the alias is the label, not the target.
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target, alias) => alias || target)
    .replace(/`([^`]*)`/g, "$1")                 // inline code
    .replace(/\$\$[^$]*?\$\$/g, "")            // display math
    // Inline math, not currency. The old rule treated any two `$` as
    // delimiters, so "Price: $5 to $10 today" became "Price: 10 today" —
    // silently, in a title. TeX never opens on a space or closes on one, and a
    // closing delimiter followed by a digit is a second price, not an end.
    .replace(/\$(?!\s)[^$\n]*?(?<!\s)\$(?!\d)/g, "")
    .replace(/<[^>]+>/g, "")                     // raw html
    .replace(/[*~]{1,3}/g, "")                   // emphasis markers
    // Underscores only where markdown would read them as emphasis. Intraword
    // `_` is literal in markdown, so snake_case names keep their shape.
    .replace(/(?<![\p{L}\p{N}])_{1,3}|_{1,3}(?![\p{L}\p{N}])/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * First "# H1", else first "## H2". Deliberately stops there — an h3 buried
 * deep in a document is far more likely to be a subsection than a title.
 */
function titleFromBody(body) {
  const clean = stripFences(body);
  for (const level of [/^#\s+(.+)$/m, /^##\s+(.+)$/m]) {
    const hit = clean.match(level);
    if (hit) {
      const text = stripInline(hit[1]);
      if (text) return text;
    }
  }
  return null;
}

/**
 * Drop a leading `# Title` from the body when it just repeats the page title.
 *
 * Most authors open a document with its own title, and the page prints one
 * above the body — so it appears twice. v13's README asked people not to do
 * that; asking is not a solution when the whole point is that any folder of
 * markdown works. Only a heading that comes before any prose and matches the
 * title is removed, so a document that genuinely opens on a different heading
 * keeps it.
 */
function forCompare(text) {
  return stripInline(String(text))
    .toLowerCase()
    // Drop whitespace either side of punctuation, so "Mouse / Rat Traps" and
    // "Mouse/Rat traps" compare equal. Applied to both sides, and only for the
    // comparison — nothing here reaches the page.
    .replace(/\s*([^\p{L}\p{N}\s])\s*/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** A line that carries no prose, so a heading after it is still "first". */
function isLeadingNoise(line) {
  return !line || /^(-{3,}|\*{3,}|_{3,})$/.test(line) || /^<!--/.test(line);
}

function stripDuplicateTitle(body, title) {
  if (!body || !title) return body;
  const target = forCompare(title);
  if (!target) return body;

  const lines = body.split("\n");
  let inComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // An HTML comment may run over several lines; skip to its end.
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    // A thematic break, a blank line or a comment before the heading is not
    // prose — an exporter that leaves a stray `---` above the title should not
    // defeat the check the way it used to.
    if (isLeadingNoise(line)) {
      if (/^<!--/.test(line) && !line.includes("-->")) inComment = true;
      continue;
    }

    const heading = line.match(/^#{1,2}\s+(.+?)\s*#*$/);
    if (!heading) return body;   // prose came first — leave the body alone

    if (forCompare(heading[1]) !== target) return body;

    lines.splice(i, 1);
    // Removing the line can leave the blank above it sitting on the blank
    // below. Markdown does not care, but the body is also read back by
    // descriptionFromBody(), so leave it tidy.
    if (i > 0 && !lines[i - 1].trim() && !(lines[i] || "").trim()) lines.splice(i, 1);
    return lines.join("\n").replace(/^\s*\n/, "");
  }
  return body;
}

const DESCRIPTION_MAX = 200;

/**
 * First few sentences of actual prose. Skips headings, code, tables, lists,
 * blockquotes, images and math — anything that would read as noise in a card.
 */
function descriptionFromBody(body) {
  const lines = stripFences(body).split("\n");
  const prose = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (prose.length) break;   // end of the first real paragraph
      continue;
    }
    // Skip anything that isn't a plain prose line.
    if (/^(#{1,6}\s|>|\||-{3,}|={3,}|\*{3,}|\s*[-*+]\s|\s*\d+[.)]\s|<)/.test(line)) {
      if (prose.length) break;
      continue;
    }
    if (/^!\[/.test(line) || /^\$\$/.test(line)) {
      if (prose.length) break;
      continue;
    }
    const text = stripInline(line);
    if (text) prose.push(text);
    if (prose.join(" ").length > DESCRIPTION_MAX * 1.5) break;
  }

  const paragraph = prose.join(" ").trim();
  if (!paragraph) return "";

  // Take whole sentences while they fit, so we don't cut mid-thought.
  const sentences = paragraph.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [paragraph];
  let out = "";
  for (const sentence of sentences.slice(0, 3)) {
    if (out && (out + sentence).trim().length > DESCRIPTION_MAX) break;
    out += sentence;
  }
  out = out.trim();
  if (!out) out = paragraph;

  if (out.length > DESCRIPTION_MAX) {
    // Fall back to a word boundary rather than slicing a word in half.
    const cut = out.slice(0, DESCRIPTION_MAX);
    const lastSpace = cut.lastIndexOf(" ");
    out = (lastSpace > DESCRIPTION_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + "…";
  }
  return out;
}

// ── Field coercion ──────────────────────────────────────────────────────────

/**
 * Removes one matching pair of surrounding quotes. A tool that quotes each item
 * separately leaves them behind, but a tag can legitimately contain a quote —
 * he said "hi" — so only a matched pair counts as wrapping.
 */
function unquote(text) {
  const first = text[0];
  if (text.length > 1 && (first === '"' || first === "'") && text.endsWith(first)) {
    return text.slice(1, -1).trim();
  }
  return text;
}

/**
 * Accepts an array, a comma-separated string, or a single scalar.
 *
 * The string case exists because clippers and export scripts quote whole
 * fields, which turns YAML's own inline sequence into a string:
 *
 *   tags: "[gas giant, storms]"      not      tags: [gas giant, storms]
 *
 * js-yaml is right to hand that back as one string — it was quoted — but the
 * author cannot have meant a tag named `[gas giant`, so the brackets and any
 * per-item quotes come off and the file behaves like the unquoted form it was
 * meant to be. Python's str(list) and JSON dumps arrive in this shape too.
 *
 * A real YAML array takes the first branch untouched, so `tags: ["a, b"]` keeps
 * its comma — quoting inside a genuine sequence still means what it says.
 */
function toList(value) {
  if (value === null || value === undefined || value === "") return [];
  let raw;
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string") {
    const text = value.trim();
    const inner =
      text.length > 1 && text.startsWith("[") && text.endsWith("]")
        ? text.slice(1, -1)
        : text;
    raw = inner.includes(",") ? inner.split(",") : [inner];
  } else {
    raw = [value];
  }

  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (item === null || item === undefined) continue;
    const text = unquote(String(item).trim());
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/**
 * A Date only if it really is one. gray-matter already turns unquoted YAML
 * dates into Date objects; anything else gets one parse attempt and is then
 * given up on. Crucially this never falls back to "now" — v13 did, which made
 * every undated file sort to the top and made builds non-reproducible.
 */
function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const parsed = new Date(String(value).trim());
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** Numeric versions stay numeric so they sort; anything else survives as text. */
function toVersion(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : text;
}

const FIRST_PRESENT = (data, keys) => {
  for (const key of keys) {
    const value = data[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") return value;
  }
  return null;
};

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * @param {object} data   parsed YAML frontmatter (may be {})
 * @param {string} body   markdown body after the frontmatter
 * @param {object} ctx    { relPath, filename } for warning messages
 */
function normaliseFrontmatter(data, body, ctx = {}) {
  const fm = data && typeof data === "object" ? data : {};
  const text = typeof body === "string" ? body : "";
  const warnings = [];
  const warn = (field, message) =>
    warnings.push({ field, message, file: ctx.relPath || ctx.filename || "" });

  if (!Object.keys(fm).length) {
    warn("frontmatter", "no YAML frontmatter — every field below was inferred or defaulted");
  }

  // title ── frontmatter → first h1 → first h2 → placeholder
  let title = FIRST_PRESENT(fm, ["title"]);
  let titleSource = "frontmatter";
  if (title !== null) {
    title = stripInline(String(title)) || String(title).trim();
  }
  if (!title) {
    const heading = titleFromBody(text);
    if (heading) {
      title = heading;
      titleSource = "heading";
      warn("title", `no title in YAML — using the first heading, "${heading}"`);
    } else {
      title = NO_TITLE;
      titleSource = "missing";
      warn("title", "no title in YAML and no heading in the body");
    }
  }

  // tags ── optional, so an absence is not worth warning about
  const tags = toList(FIRST_PRESENT(fm, ["tags", "tag"]));

  // date ── null means "Unknown"; it never becomes build time
  const rawDate = FIRST_PRESENT(fm, ["date", "created"]);
  const date = toDate(rawDate);
  if (!date) {
    warn("date", rawDate ? `could not parse date "${rawDate}"` : "no date in YAML");
  }

  // description ── frontmatter → opening prose → empty
  let description = FIRST_PRESENT(fm, ["description", "summary"]);
  description = description === null ? "" : stripInline(String(description));
  let descriptionSource = "frontmatter";
  if (!description) {
    description = descriptionFromBody(text);
    descriptionSource = description ? "body" : "missing";
    if (description) {
      warn("description", "no description in YAML — using the opening sentences of the body");
    } else {
      warn("description", "no description in YAML and no prose in the body to fall back on");
    }
  }

  // author ── new canonical key, with the v13 names still honoured
  let author = FIRST_PRESENT(fm, ["author", "llm_Model", "llm_model", "model"]);
  if (author === null) {
    author = UNKNOWN;
    warn("author", "no author/model in YAML");
  } else {
    author = String(author).trim();
  }

  // version ── likewise
  const rawVersion = FIRST_PRESENT(fm, ["version", "prompt_version"]);
  let version = toVersion(rawVersion);
  if (version === null) {
    version = UNKNOWN;
    warn("version", "no version in YAML");
  }

  // category ── always at least one, so no entry is unfiled
  let categories = toList(FIRST_PRESENT(fm, ["category", "categories"]));
  if (!categories.length) {
    categories = [MISC];
    warn("category", `no category in YAML — filed under "${MISC}"`);
  }

  return {
    title,
    titleSource,
    tags,
    date,
    description,
    descriptionSource,
    author,
    version,
    categories,
    warnings,
    body: stripDuplicateTitle(text, title),
  };
}

// ── Shared ordering rules ───────────────────────────────────────────────────
// Used by every listing and every tab strip, so "newest first" means the same
// thing everywhere and undated content has one predictable home.

/** Dated before undated, then newest first, then title A→Z. */
function byDateDesc(a, b) {
  if (a.date && b.date) {
    const diff = b.date.getTime() - a.date.getTime();
    if (diff) return diff;
  } else if (a.date) return -1;
  else if (b.date) return 1;
  return String(a.title).localeCompare(String(b.title));
}

/** Numeric versions descending, then "Unknown"/text versions, then author A→Z. */
function byVersionDesc(a, b) {
  const aNum = typeof a.version === "number";
  const bNum = typeof b.version === "number";
  if (aNum && bNum && a.version !== b.version) return b.version - a.version;
  if (aNum !== bNum) return aNum ? -1 : 1;
  return String(a.author).localeCompare(String(b.author));
}

module.exports = {
  normaliseFrontmatter,
  stripDuplicateTitle,
  byDateDesc,
  byVersionDesc,
  toList,
  toDate,
  stripInline,
  NO_TITLE,
  UNKNOWN,
  MISC,
};
