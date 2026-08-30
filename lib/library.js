/**
 * library.js — the single global data source for every page on the site.
 *
 * Runs the scan once, then flattens the tree into the page lists that the
 * templates paginate over. Templates stay dumb: they render a list, they never
 * work out where a file lives or what its URL should be.
 *
 * This lives in lib/ rather than _data/ on purpose. Eleventy loads _data/ files
 * from disk at run time, so their require()s would still need node_modules —
 * which would defeat the standalone binary. Reached through the config instead,
 * it gets compiled into the executable along with gray-matter, markdown-it and
 * KaTeX, and the binary needs nothing installed at all.
 */

const { scan, PAGE_URL_ROOT, THUMBNAIL_BUDGET_KB } = require("./scan");
const { ensureMarkdownDir } = require("./bundle");
const { slugify, SITE_PAGE_URLS } = require("./paths");
const { readTestReport } = require("./testreport");
const loadSite = require("./site");
const {
  render, addAnchors, toc, setMathCollector, setRenderCollector, setDemotedCollector,
} = require("./markdown");



/**
 * The pages that exist whatever the content is. Listed rather than counted, so
 * that adding a template and forgetting this line is a one-word fix instead of
 * a number nobody can trace. webmanifest.njk and search-index.njk are assets,
 * not pages, and are deliberately not here.
 *
 * Now kept in lib/paths.js, because the same list also decides which slugs a
 * document may not claim — a note called all.md used to take /page/all.html
 * away from all.njk and abort the entire build. Two copies of this list is
 * precisely how that happened, so there is one.
 */
const SITE_PAGES = SITE_PAGE_URLS;

/**
 * Severity ranking for the status page. Nothing here stops a build, so the
 * rank is not "how upset was the generator" — it is how visible the problem is
 * in the finished site:
 *
 *   high   output is visibly broken, or content is silently missing
 *   medium the site works, but a reader sees something wrong or pays for it
 *   low    invisible to a reader; housekeeping at the source
 *
 * The marker doubles the colour so the ranking survives colour-blindness,
 * greyscale printing and forced-colours mode.
 */
const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };
const SEVERITY_MARKS = { low: "●", medium: "●●", high: "●●●" };

/** Worst level in a list, or "low" when the list is empty. */
function worstOf(levels) {
  return levels.reduce(
    (worst, level) =>
      SEVERITY_RANK[level] > SEVERITY_RANK[worst] ? level : worst,
    "low",
  );
}

/** Attach { severity, mark } to a plain object without mutating the original. */
function withSeverity(obj, level) {
  return { ...obj, severity: level, mark: SEVERITY_MARKS[level] };
}

/**
 * Split a list into pages. Page 1 keeps the clean URL; later pages get a -N
 * suffix. Because every folder is a real directory now, "index-2.html" can't
 * collide with a sibling the way v13's flat "topic-1-2.html" could.
 */
function paginate(items, baseUrl, extra, perPage) {
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const suffixed = (n) =>
    n === 1 ? baseUrl : baseUrl.replace(/\.html$/, `-${n}.html`);

  const pages = [];
  for (let i = 0; i < totalPages; i++) {
    const pageNumber = i + 1;
    pages.push({
      ...extra,
      items: items.slice(i * perPage, (i + 1) * perPage),
      totalItems: items.length,
      pageNumber,
      totalPages,
      url: suffixed(pageNumber),
      permalink: suffixed(pageNumber),
      prevUrl: pageNumber > 1 ? suffixed(pageNumber - 1) : null,
      nextUrl: pageNumber < totalPages ? suffixed(pageNumber + 1) : null,
    });
  }
  return pages;
}

module.exports = function () {
  // Read per BUILD, not per require: `npm start` keeps this module loaded
  // across rebuilds, so a module-level constant would freeze whatever
  // site_settings.json said when the dev server started. Taken from loadSite()
  // rather than from the `site` global because global data has no guaranteed
  // evaluation order and this is needed before any template runs; the file is a
  // few hundred bytes, so reading it twice costs nothing.
  //
  // /page/all.html is deliberately NOT paginated by this — find-in-page over
  // the whole index is the point of that page.
  const settings = loadSite();
  const perPage = settings.maxPostsPerPage;

  const root = ensureMarkdownDir();
  // perPage reaches the scan because facet pages paginate to <slug>-2.html,
  // and scan.js has to reserve that whole run of filenames to keep a tag
  // literally spelled "bees 2" from colliding with page 2 of "bees".
  const result = scan(root, { perPage });

  // Settings problems ride along with the content warnings so there is one
  // place to look when the site does not come out the way it was asked for.
  result.health.settings = settings.warnings;

  // Markdown is rendered here rather than lazily from the template, for two
  // reasons: the status page has to be able to report KaTeX failures, which
  // means every document must already have been rendered before ANY page is
  // written; and it keeps template render order irrelevant to the output.
  setMathCollector(result.health.math);
  setRenderCollector(result.health.render);
  // Guarded like `checksums` below: an older scan() result has no such list.
  result.health.demoted = result.health.demoted || [];
  setDemotedCollector(result.health.demoted);
  // Every document, by its path inside input_markdown/. This is what lets
  // `[see also](other.md)` in a body link to the PAGE other.md became instead
  // of to the raw markdown file. Built before the loop because a document may
  // link forwards to one the loop has not reached yet.
  const docUrls = new Map(result.variants.map((v) => [v.relPath, v.url]));
  const resolveDoc = (relPath) => docUrls.get(relPath);
  for (const variant of result.variants) {
    variant.html = addAnchors(
      render(variant.body, variant.url, variant.folder.mediaUrl, variant.relPath, {
        rewriteLinks: true,
        resolveDoc,
      }),
    );
    variant.outline = toc(variant.html);
  }
  // Everything the report will count has now been rendered, so the collectors
  // are closed. about.njk and legal.njk render their markdown much later,
  // through the `markdown` filter at template time: left open, a KaTeX failure
  // in about.md would land in a list the report had already counted, so the
  // tile would say 0 while the section below it showed a row — and which way
  // round depended on the order Eleventy happened to render templates in, which
  // would also cost the build its byte-identical rebuild. Those two pages are
  // site chrome rather than someone's project, so their findings are dropped.
  setMathCollector([]);
  setRenderCollector([]);
  setDemotedCollector([]);

  const folderPages = [];
  const facetPages = [];

  for (const node of result.nodes) {
    // A folder page lists its own entries and its child folders — unless there
    // is nothing for it to be. A collapsed folder IS its single entry and that
    // entry already occupies this URL; a folder with no entries anywhere below
    // it has nothing to list and nothing links to it. Writing either one is how
    // the site ended up with 83 pages holding a single card and one saying
    // "Nothing here yet." Both are still reported on the status page.
    //
    // "Nothing below it" has to mean the whole subtree, not just this folder:
    // a folder of empty subfolders has no entries either, and its own parent
    // already leaves it out of the listing (`c.totalEntries > 0`), so the page
    // would exist with nothing linking to it. The root is the exception — it is
    // the homepage, and an empty project still has to get one, which is the
    // state folder.njk renders as "No markdown found in input_markdown/".
    if (node.collapsed) continue;
    if (node.depth > 0 && !node.totalEntries) continue;

    folderPages.push(...paginate(node.items, node.url, { node, facet: null }, perPage));

    // Facet pages filter the whole subtree, not just this folder — otherwise
    // clicking a tag on a section page would miss everything nested below it.
    // Matching is by slug, not by string. scan.js has already collapsed
    // alternative spellings of one tag to a single label, so an entry tagged
    // "kuiper belt" must still be found by the page for "Kuiper Belt" — an
    // exact-string filter would silently drop it from its own facet page.
    //
    // Which facets are worth a page at all is decided in scan.js by
    // assignFacets(), so the pages written here and the pills rendered by
    // filter-bar.njk come from one list and cannot disagree.
    for (const facet of node.facets) {
      facetPages.push(...paginate(
        node.allEntries
          .filter((e) => (facet.kind === "category" ? e.categories : e.tags)
            .some((v) => slugify(v) === facet.slug))
          .map(entryToItem),
        facet.url,
        { node, facet },
        perPage,
      ));
    }
  }

  const entryPages = result.variants.map((variant) => ({
    variant,
    permalink: variant.url,
  }));

  linkFindings(result);

  const report = buildHealthReport(result);

  // Deliberately date-only, not a timestamp: two builds on the same day still
  // produce byte-identical output, which is what makes `diff -r` a useful check
  // that nothing in the content pipeline has drifted.
  const buildDate = new Date();
  buildDate.setUTCHours(0, 0, 0, 0);

  const stats = {
    buildDate,
    entries: result.entries.length,
    variants: result.variants.length,
    // Folders that are actually a page. A collapsed folder is counted as the
    // entry it renders as, not as a folder, so the figure matches the site.
    folders: result.nodes.filter((n) => n.relPath && !n.collapsed).length,
    maxDepth: result.nodes.reduce((m, n) => Math.max(m, n.depth), 0),
    categories: result.root ? result.root.categories.length : 0,
    tags: result.root ? result.root.tags.length : 0,
    contentDir: root,
    settingsFile: settings.settingsFile,
    settingsFound: settings.settingsFound,
    itemsPerPage: perPage,
    // What the build actually wrote, counted off the paginated lists above
    // rather than off the model: a folder over ITEMS_PER_PAGE items produces
    // several pages, and a folder that produces none is still a node. `ok` is
    // the figure the status page leads with — a document whose body crashed the
    // renderer still produces a file, so counting it as rendered would be the
    // same silence the render section exists to break.
    pages: {
      documents: entryPages.length,
      folders: folderPages.length,
      facets: facetPages.length,
      site: SITE_PAGES.length,
      failed: result.health.render.length,
      total: entryPages.length + folderPages.length + facetPages.length + SITE_PAGES.length,
      ok: entryPages.length + folderPages.length + facetPages.length + SITE_PAGES.length
        - result.health.render.length,
    },
  };

  return {
    root: result.root,
    nodes: result.nodes,
    entries: result.entries,
    variants: result.variants,
    health: result.health,
    report,
    // The generator's own test suite, as of the last `npm test`. Read rather
    // than run: see lib/testreport.js. Everything else on the status page is
    // about the content; this is about the tool that built it.
    tests: readTestReport(),
    folderPages,
    facetPages,
    entryPages,
    allEntries: result.root ? result.root.allEntries : [],
    stats,
    pageRoot: PAGE_URL_ROOT,
    thumbnailBudgetKb: THUMBNAIL_BUDGET_KB,
  };
};

/**
 * Give every health finding a `url`, so the status page can link a row to the
 * thing it is complaining about instead of naming it and leaving you to search.
 *
 * Here rather than in scan.js because most of these need the FINISHED tree: a
 * document's URL belongs to a variant recorded much later than the warning, and
 * facet links are not assigned until assignFacets() has walked the whole tree
 * top-down. Findings that could only be resolved at the moment they were
 * created — a duplicate's entry, a media file's encoded URL — already carry
 * their own url from scan.js, and are left alone.
 *
 * A row that legitimately has nowhere to point keeps `url` undefined, and the
 * template renders it exactly as it does today. That is the normal case for
 * settings warnings, which are about a file rather than a page.
 */
function linkFindings(result) {
  const { health } = result;

  const byVariant = new Map(result.variants.map((v) => [v.relPath, v.url]));
  const byNode = new Map(result.nodes.map((n) => [n.relPath || "(root)", n]));

  /** A folder's page, but only if it actually publishes one. */
  const nodeUrl = (relPath) => {
    const node = byNode.get(relPath);
    if (!node) return undefined;
    // A collapsed folder has no listing page of its own, but node.url is its
    // single entry's page — which is the right place to land either way.
    if (node.depth > 0 && !node.totalEntries) return undefined;
    return node.url;
  };

  for (const row of health.metadata) row.url = byVariant.get(row.file);
  for (const row of health.math) row.url = byVariant.get(row.file);
  for (const row of health.render) row.url = byVariant.get(row.file);

  // A renamed slug is either a document or a folder, and the two resolve
  // through different maps.
  for (const row of health.collisions) {
    row.url = row.kind === "file" ? byVariant.get(row.path) : nodeUrl(row.path);
  }

  // A structure finding is a folder that produces NO page — that is the whole
  // complaint — so it cannot link to itself. It links to its parent, which is
  // both where the gap is visible and guaranteed to exist: the finding is only
  // ever pushed by a parent that has entries (or by the root), and a node with
  // children is never collapsed, so that parent always publishes a listing.
  for (const row of health.structure) {
    const parent = row.path.split("/").slice(0, -1).join("/") || "(root)";
    row.url = nodeUrl(parent);
  }

  // facetLinks resolves a tag to the nearest ancestor that still publishes a
  // page for it, and is documented as guaranteed to terminate at the root — so
  // this never points at a facet page that was not written.
  for (const row of health.facets) {
    const node = byNode.get(row.path);
    row.url = node && node.facetLinks && node.facetLinks[row.kind]
      ? node.facetLinks[row.kind][row.slug]
      : undefined;
  }
}

/**
 * Reshape the raw warning lists into what the status page actually renders:
 * a per-field tally so you can see at a glance which metadata is thinnest,
 * and a per-file grouping so a single unannotated file reads as one problem
 * rather than seven.
 */
function buildHealthReport(result) {
  const { health } = result;

  const fieldOrder = [
    "frontmatter-error", "frontmatter", "title", "date", "description",
    "author", "version", "category", "body",
  ];
  const fieldLabels = {
    // Two different problems, deliberately two fields: the tally below counts
    // by field, so filing "could not be parsed" under "No frontmatter at all"
    // both double-counted the file and mislabelled it.
    "frontmatter-error": "Front matter could not be read",
    frontmatter: "No frontmatter at all",
    title: "Title inferred or missing",
    date: "Date unknown",
    description: "Description inferred or missing",
    author: "Author unknown",
    version: "Version unknown",
    category: "Category defaulted to Misc.",
    body: "Empty document",
  };
  // A missing author is a shrug; a file with no frontmatter at all lost every
  // field it should have had. Same list, very different urgency.
  const fieldSeverity = {
    "frontmatter-error": "high",
    frontmatter: "high",
    body: "high",
    title: "medium",
    description: "medium",
    category: "medium",
    date: "low",
    author: "low",
    version: "low",
  };

  const byField = fieldOrder
    .map((field) =>
      withSeverity(
        {
          field,
          label: fieldLabels[field],
          count: health.metadata.filter((w) => w.field === field).length,
        },
        fieldSeverity[field],
      ))
    .filter((row) => row.count > 0);

  const files = new Map();
  for (const warning of health.metadata) {
    if (!files.has(warning.file)) files.set(warning.file, []);
    files.get(warning.file).push(withSeverity(warning, fieldSeverity[warning.field]));
  }
  const byFile = [...files.entries()]
    .map(([file, warnings]) =>
      withSeverity(
        // Every warning in the group came from the same file, so they all carry
        // the same url; the first is as good as any.
        { file, warnings, url: warnings[0] && warnings[0].url },
        worstOf(warnings.map((w) => w.severity))))
    .sort((a, b) => b.warnings.length - a.warnings.length || a.file.localeCompare(b.file));

  const orphanKb = health.unreferenced.reduce((sum, o) => sum + o.kb, 0);

  // Metadata has no fixed rank — it is only as bad as the worst field actually
  // missing, so a build whose only gripe is missing authors reads as low.
  const metadataSeverity = worstOf(byField.map((row) => row.severity));

  const sections = [
    // First, and always high: it is the only finding here that means a document
    // is missing from the site rather than merely thin.
    { key: "render", label: "Failed to render", count: health.render.length, severity: "high",
      note: "documents whose body could not be rendered" },
    // High for the same reason: a setting that did not take means the site is
    // not the site that was asked for, and nothing else would ever say so.
    { key: "settings", label: "Settings", count: (health.settings || []).length, severity: "high",
      note: "values in site_settings.json that could not be used" },
    { key: "metadata", label: "Metadata", count: byFile.length, severity: metadataSeverity,
      note: "files where at least one field was inferred or defaulted" },
    { key: "structure", label: "Structure", count: health.structure.length, severity: "high",
      note: "folders that produce nothing" },
    { key: "media", label: "Unreferenced media", count: health.unreferenced.length, severity: "low",
      note: `${orphanKb} KB no page links to` },
    { key: "oversized", label: "Oversized thumbnails", count: health.oversized.length, severity: "medium",
      note: "loaded on every card that shows them" },
    // Medium, not high: the file is still listed and still linked. But a file
    // the build could not open is usually one a reader cannot download either,
    // which is worth more than a thumbnail over budget. Guarded like
    // `settings`, because an older scan() result has no such list.
    { key: "checksums", label: "Unhashed files", count: (health.checksums || []).length, severity: "medium",
      note: "download files that could not be read" },
    { key: "duplicates", label: "Duplicate titles", count: health.duplicates.length, severity: "medium",
      note: "the same title in more than one folder" },
    { key: "collisions", label: "Renamed URLs", count: health.collisions.length, severity: "medium",
      note: "slugs that needed a numeric suffix" },
    { key: "facets", label: "Tag spellings", count: health.facets.length, severity: "low",
      note: "one tag or category written more than one way" },
    { key: "math", label: "Math errors", count: health.math.length, severity: "high",
      note: "expressions KaTeX could not parse" },
    // Low: the page is valid HTML either way, because the heading was demoted
    // rather than left to stand as a second h1. What is worth saying is that
    // the title in the YAML and the one in the body disagree.
    { key: "demoted", label: "Demoted headings", count: (health.demoted || []).length, severity: "low",
      note: "bodies whose own h1 was shifted below the page title" },
  ].map((section) => withSeverity(section, section.severity));

  // Keyed by section so health.njk can reach a level from inside its own
  // hardcoded block; same objects as above, so the two can never disagree.
  const severity = Object.fromEntries(
    sections.map((s) => [s.key, { level: s.severity, mark: s.mark }]),
  );

  const found = sections.filter((s) => s.count > 0);

  return {
    byField,
    byFile,
    sections,
    severity,
    worst: found.length ? worstOf(found.map((s) => s.severity)) : null,
    orphanKb,
    totalFindings: sections.reduce((sum, s) => sum + s.count, 0),
    cleanFiles: result.variants.length - byFile.length,
  };
}

/** Entries shown on a facet page render with the same card as everywhere else. */
function entryToItem(entry) {
  return {
    type: "entry",
    title: entry.title,
    url: entry.url,
    date: entry.date,
    description: entry.description,
    author: entry.author,
    variantCount: entry.variants.length,
    categories: entry.categories,
    tags: entry.tags,
    // The same field the folder listing uses, so an entry's card looks the same
    // wherever it appears. Reading folder.media.thumbnail here instead would
    // leave every facet-page card blank for a folder with no thumbnail.*.
    thumbnail: entry.thumbnail || null,
  };
}
