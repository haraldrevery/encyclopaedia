/**
 * search.js — builds the metadata index the nav search box scores against.
 *
 * One row per ENTRY, not per variant: two variants of "Water bottle" are one
 * thing to a reader looking for it, and the entry already carries the union of
 * its variants' tags and categories (lib/scan.js, buildEntries).
 *
 * Deliberately metadata only. Full text would be ~2.4 MB against ~68 KB here,
 * and the body of an article is already searchable the moment you are on it —
 * Ctrl+F is better at that than anything this file could ship.
 *
 * Lives in lib/ rather than _data/ for the reason given at the top of
 * library.js: _data/ is read from disk at run time, which would keep the
 * standalone binary dependent on node_modules.
 */

/** Keys are one letter because there are 220 of these and the file ships whole. */
const DESCRIPTION_MAX = 140;

/**
 * Fold a string to its searchable form: no accents, no case.
 *
 * Not slugify() from paths.js, though the first two steps are the same one.
 * slugify turns every run of punctuation into a hyphen, which would erase the
 * word boundaries the scorer uses to tell "compost" starting a word from
 * "compost" buried inside one.
 */
function normalise(input) {
  return String(input == null ? "" : input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")   // strip combining accents
    .toLowerCase();
}

/** Cut at the last space before the limit, so a card never ends mid-word. */
function truncate(text, limit) {
  const str = String(text == null ? "" : text).trim();
  if (str.length <= limit) return str;
  const cut = str.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return (space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

/**
 * @param {Array} entries library.allEntries — the flat, recursive entry list.
 * @returns {Array<{t:string,u:string,d:string,g:string,k:string}>}
 *
 * t title · u url · d description · g the folder shown beside the title ·
 * k the keyword blob (tags, categories, author) matched but never displayed.
 *
 * Order is preserved. allEntries arrives sorted newest-first, so equal scores
 * tie-break by date without the client having to carry dates at all.
 */
function buildSearchIndex(entries) {
  if (!Array.isArray(entries)) return [];

  return entries.map((entry) => {
    const folder = (entry.primary && entry.primary.folder) || null;

    // backLabel, not label: on a collapsed folder the folder IS this entry, so
    // its own name would just restate the title. backLabel names the section
    // above it, which is the context a reader is actually missing.
    const context = folder ? folder.backLabel || folder.label : "";

    return {
      // Site-absolute minus the leading slash. The index is ONE asset shared by
      // pages at every depth, so it cannot hold paths relative to any of them;
      // the client prepends the prefix the page passes it in data-root.
      u: String(entry.url || "").replace(/^\//, ""),
      t: String(entry.title || ""),
      d: truncate(entry.description, DESCRIPTION_MAX),
      g: String(context || ""),
      k: normalise(
        [...(entry.tags || []), ...(entry.categories || []), entry.author || ""]
          .join(" "),
      ),
    };
  });
}

module.exports = { buildSearchIndex, normalise, truncate, DESCRIPTION_MAX };
