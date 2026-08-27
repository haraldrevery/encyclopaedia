/**
 * scan.js — walks the content folder and builds the whole site model.
 *
 * The one rule that shapes everything: EVERY directory is a node, at any depth.
 * v13 hard-coded exactly three levels (section → group → post) and silently
 * dropped anything deeper — 17 markdown files in the sample content never
 * appeared on the site at all. Here the recursion just keeps going, and a
 * node's breadcrumb is literally its ancestor chain, so there is nothing to
 * reverse-engineer from a filename.
 *
 * Nothing in this file throws on bad input. Unreadable directories, empty
 * files, folders full of media and no markdown — all of it produces a node
 * and a health warning rather than a failed build.
 */

const fs = require("fs");
const path = require("path");
const { parseFrontmatter } = require("./frontmatter");

const {
  fnv1a,
  slugify, uniqueSlug, humanise,
  isMarkdown, isImage, isVideo, isAudio, isThumbnail, isHidden,
  videoMime, audioMime,
  RESERVED_PAGE_SLUG, RESERVED_DIR_SLUGS, reservedPageSlugs,
} = require("./paths");

const { normaliseFrontmatter, byDateDesc, byVersionDesc, NO_TITLE } = require("./normalise");

const PAGE_URL_ROOT = "/page";
const MEDIA_URL_ROOT = "/input_markdown";

/** Thumbnails are loaded on every card, so an oversized one is felt sitewide. */
const THUMBNAIL_BUDGET_KB = 150;

// ── Filesystem helpers that degrade instead of throwing ─────────────────────

function readDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * gray-matter throws on malformed YAML. A single bad file must not take the
 * whole build down, so a parse failure degrades to "no frontmatter" plus a
 * warning — exactly the same path an unannotated file takes.
 *
 * parseFrontmatter(), not matter(): a `---js` header would otherwise be handed
 * to gray-matter's javascript engine and eval()'d during the build. See
 * lib/frontmatter.js. A refused engine throws, so it lands on the same warning
 * as a mis-indented list and the file is named on the status page.
 */
function parseMarkdown(file) {
  const raw = readText(file);
  try {
    const parsed = parseFrontmatter(raw);
    return { data: parsed.data || {}, content: parsed.content || "", error: null };
  } catch (err) {
    return { data: {}, content: raw, error: err.message || String(err) };
  }
}

// ── Media ───────────────────────────────────────────────────────────────────

/** The readable path of a file inside the markdown folder, for display only. */
function relPathOf(relPath, filename) {
  return relPath ? `${relPath}/${filename}` : filename;
}

function collectMedia(dir, relPath, files, mediaUrl, health) {
  const thumbnailFile = files.find(isThumbnail) || null;

  const rest = files.filter((f) => !isThumbnail(f));
  const encode = (f) => `${mediaUrl}/${encodeURIComponent(f)}`;

  // `file` is for reading and `url` is for linking, and they are NOT the same
  // string. The display path is the raw one a person would type; the href has
  // to be percent-encoded, because folder and file names are allowed spaces and
  // accents. Joining an encoded directory to a raw filename — which is what
  // this did — produced something that was neither, and only looked right
  // because no folder with an accent in it happened to hold an image.
  if (thumbnailFile) {
    const kb = Math.round(fileSize(path.join(dir, thumbnailFile)) / 1024);
    if (kb > THUMBNAIL_BUDGET_KB) {
      health.oversized.push({
        file: relPathOf(relPath, thumbnailFile),
        url: encode(thumbnailFile),
        kb, budget: THUMBNAIL_BUDGET_KB,
      });
    }
  }

  return {
    thumbnail: thumbnailFile ? { filename: thumbnailFile, url: encode(thumbnailFile) } : null,
    // `kb` is carried so pickImage() below can keep a card's image inside the
    // same budget an explicit thumbnail.* is held to. media.njk ignores it.
    images: rest.filter(isImage).map((f) => ({
      filename: f, url: encode(f), kb: Math.round(fileSize(path.join(dir, f)) / 1024),
    })),
    videos: rest.filter(isVideo).map((f) => ({ filename: f, url: encode(f), mime: videoMime(f) })),
    audios: rest.filter(isAudio).map((f) => ({ filename: f, url: encode(f), mime: audioMime(f) })),
    downloads: rest
      .filter((f) => !isMarkdown(f) && !isImage(f) && !isVideo(f) && !isAudio(f))
      .map((f) => ({
        filename: f,
        url: encode(f),
        kb: Math.round(fileSize(path.join(dir, f)) / 1024),
      })),
  };
}

/**
 * Choose a card image from the images sitting in a folder.
 *
 * A file named thumbnail.* always wins and never reaches this function — this
 * is the fallback for the far more common case of a folder that simply has
 * some pictures in it. Without it, a well-organised project of photographs
 * renders as a wall of ▦ placeholders.
 *
 * Two properties matter, and both are easy to get wrong:
 *
 * DETERMINISTIC. The pick looks arbitrary but is a hash of `seed`, so two
 * builds of the same folder choose the same picture. Math.random() here would
 * cost the build its byte-identical rebuild — see fnv1a() in paths.js.
 *
 * BUDGETED. A card image is loaded on every card that shows it, which is why
 * thumbnail.* is warned about above THUMBNAIL_BUDGET_KB. Gallery images are
 * full-size originals and are never resized (media is linked, not copied), so
 * choosing freely among them could put 8 MB on a card and a hundred megabytes
 * on one folder page. Only images inside the budget are candidates. When none
 * are, the smallest is used — that is a real cost and is reported by the
 * caller rather than passed off in silence.
 */
function pickImage(images, seed) {
  if (!images || !images.length) return null;

  const eligible = images.filter((image) => image.kb <= THUMBNAIL_BUDGET_KB);
  if (eligible.length) return eligible[fnv1a(seed) % eligible.length];

  // Strictly less-than, over a filename-sorted list: ties keep the first name
  // alphabetically rather than whichever the comparison happened to see last.
  return images.reduce((best, image) => (image.kb < best.kb ? image : best), images[0]);
}

/**
 * Report a card image that had to break the budget.
 *
 * Only fires for a PICKED image, never for an explicit thumbnail.* — that one
 * is already weighed by collectMedia() and would otherwise be counted twice.
 * Deduped by URL, because one heavy photograph in a folder of five notes is
 * one problem to fix, not five lines to read.
 */
function reportOversizedPick(chosen, media, relPath, health) {
  // Only an image picked out of THIS folder's own images qualifies. Both other
  // things that can end up in the same slot must be left alone: an explicit
  // thumbnail.*, already weighed by collectMedia(), and a cardThumbnail
  // inherited from a descendant folder, which belongs to that folder and is not
  // even measured here — neither carries a `kb`, so an unguarded comparison
  // read undefined, decided it was over budget, and reported a 0 KB file.
  if (!chosen || !media.images.includes(chosen)) return;
  if (chosen.kb <= THUMBNAIL_BUDGET_KB) return;

  // chosen.url was built by collectMedia's encode(), so it is already a correct
  // href; only the readable half has to be made here.
  const file = relPathOf(relPath, chosen.filename);
  if (health.oversized.some((o) => o.file === file)) return;

  health.oversized.push({
    file, url: chosen.url, kb: chosen.kb, budget: THUMBNAIL_BUDGET_KB,
    // Distinguishes it on the status page: nobody chose this file as a card
    // image, the generator did, because nothing smaller was available.
    picked: true,
  });
}

// ── Entries: grouping markdown files into tab sets ──────────────────────────

/**
 * Files in one folder that share a title are variants of the same entry —
 * eight models answering the same prompt, or v1/v2 of one article.
 *
 * Untitled files are deliberately NEVER grouped: if they were, dropping a
 * folder of unlabelled notes would collapse every one of them into a single
 * page. They key on their filename instead.
 */
function groupKey(variant) {
  if (variant.title === NO_TITLE) return ` file:${variant.filename}`;
  return variant.title.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildEntries(dir, relPath, mdFiles, pageDirUrl, health) {
  const variants = [];

  // Pages the site writes into THIS directory itself. At the top level that is
  // /page/all.html and /page/status.html, so all.md and status.md have to be
  // nudged aside exactly as index.md is — see SITE_PAGE_URLS in paths.js.
  // Everywhere below the root this is empty and costs nothing.
  const sitePageSlugs = new Set(reservedPageSlugs(pageDirUrl));

  // Sorted so slug collision suffixes (-2, -3) are stable across builds.
  for (const filename of [...mdFiles].sort()) {
    const fileRelPath = relPath ? `${relPath}/${filename}` : filename;
    const parsed = parseMarkdown(path.join(dir, filename));
    const meta = normaliseFrontmatter(parsed.data, parsed.content, { relPath: fileRelPath });

    if (parsed.error) {
      meta.warnings.unshift({
        field: "frontmatter",
        message: `YAML could not be parsed (${parsed.error}) — the file was read as plain markdown`,
        file: fileRelPath,
      });
    }
    if (!parsed.content.trim()) {
      meta.warnings.push({ field: "body", message: "file has no content", file: fileRelPath });
    }

    variants.push({
      ...meta,
      filename,
      relPath: fileRelPath,
      baseName: filename.replace(/\.md$/i, ""),
    });
  }

  // Group, preserving first-seen order.
  const groups = new Map();
  for (const variant of variants) {
    const key = groupKey(variant);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(variant);
  }

  const usedSlugs = new Set();
  const entries = [];

  for (const [key, members] of groups) {
    members.sort(byVersionDesc);

    // The canonical variant is the one a card links to: newest, then highest
    // version, then alphabetical by author. Fully deterministic — v13 picked
    // whichever model slug sorted first, which is arbitrary.
    const ordered = [...members].sort((a, b) => byDateDesc(a, b) || byVersionDesc(a, b));
    const primary = ordered[0];

    for (const variant of members) {
      // index.md would land on the folder's own listing page. See
      // RESERVED_PAGE_SLUG in paths.js — this is a build-abort, not a cosmetic
      // clash, so the file is moved rather than allowed to collide.
      let desired = slugify(variant.baseName);
      if (RESERVED_PAGE_SLUG.test(desired) || sitePageSlugs.has(desired)) desired += "-page";
      variant.slug = uniqueSlug(usedSlugs, desired);
      variant.url = `${pageDirUrl}/${variant.slug}.html`;
    }

    const categories = new Set();
    const tags = new Set();
    for (const variant of members) {
      variant.categories.forEach((c) => categories.add(c));
      variant.tags.forEach((t) => tags.add(t));
    }

    entries.push({
      key,
      title: primary.title,
      url: primary.url,
      date: primary.date,
      description: primary.description,
      author: primary.author,
      categories: [...categories].sort((a, b) => a.localeCompare(b)),
      tags: [...tags].sort((a, b) => a.localeCompare(b)),
      variants: members,
      primary,
      hasVariants: members.length > 1,
      relPath,
    });

    for (const variant of members) {
      variant.entryTitle = primary.title;
      variant.siblings = members;
    }
  }

  entries.sort(byDateDesc);

  for (const entry of entries) {
    for (const warning of entry.variants.flatMap((v) => v.warnings)) {
      health.metadata.push(warning);
    }
  }

  return entries;
}

// ── Facets ──────────────────────────────────────────────────────────────────

/**
 * Collapse a folder's categories or tags to one entry per URL.
 *
 * People spell the same tag more than one way — "Kuiper Belt" in most files
 * and "kuiper belt" in one. Both slugify to `kuiper-belt`, so both used to
 * generate a facet page at the same path and Eleventy aborted the whole build
 * on the permalink collision. A folder of real, human-written notes could
 * therefore produce no site at all, which is exactly what this generator is
 * supposed to make impossible.
 *
 * The most-used spelling wins the label, so the dominant convention in the
 * project is the one displayed; ties break alphabetically so the choice can't
 * wobble between builds. Every merge is reported on the health page — this
 * quietly unifies the site, but the underlying files are still inconsistent
 * and only the author can decide which spelling is right.
 */
function mergeBySlug(values, kind, node, ctx) {
  const groups = new Map();
  for (const raw of values) {
    const slug = slugify(raw);
    if (!groups.has(slug)) groups.set(slug, new Map());
    const counts = groups.get(slug);
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }

  const labels = [];
  for (const [slug, counts] of groups) {
    const spellings = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    labels.push(spellings[0][0]);

    if (spellings.length > 1) {
      ctx.health.facets.push({
        kind,
        path: node.relPath || "(root)",
        slug,
        kept: spellings[0][0],
        variants: spellings.map(([name, n]) => `${name} (${n})`),
      });
    }
  }
  return labels.sort((a, b) => a.localeCompare(b));
}

// ── Cards ───────────────────────────────────────────────────────────────────

/**
 * The card a parent shows for a collapsed child folder.
 *
 * The folder name is the label a human chose and the entry title comes from
 * YAML, so the title wins — except when there isn't one, where the folder name
 * is far better than "-no title-". The thumbnail is the folder's, since that is
 * where media lives.
 */
function collapsedCard(node) {
  const entry = node.entries[0];
  return {
    type: "entry",
    title: entry.title === NO_TITLE ? node.label : entry.title,
    url: entry.url,
    date: entry.date,
    description: entry.description,
    // The entry's own pick first: a collapsed folder IS its entry, so the card
    // should be the one that entry would have shown anywhere else.
    thumbnail: entry.thumbnail || node.cardThumbnail,
    author: entry.author,
    variantCount: entry.variants.length,
    categories: entry.categories,
    tags: entry.tags,
  };
}

// ── The recursive walk ──────────────────────────────────────────────────────

function walk(dir, relPath, depth, ancestors, siblingSlugs, ctx) {
  const dirents = readDir(dir);
  const names = dirents.map((d) => d.name).filter((n) => !isHidden(n));

  const childDirs = dirents
    .filter((d) => d.isDirectory() && !isHidden(d.name))
    .map((d) => d.name)
    .sort();
  // Sorted, not left in readdir order: the filesystem returns entries in an
  // arbitrary order that differs between Node and Bun, which would make the
  // npm build and the standalone binary emit image grids in different orders.
  const files = names.filter((n) => !childDirs.includes(n)).sort();
  const mdFiles = files.filter(isMarkdown);

  const name = relPath ? path.basename(relPath) : "";
  const slug = relPath ? uniqueSlug(siblingSlugs, slugify(name)) : "";

  const parentDirUrl = ancestors.length
    ? ancestors[ancestors.length - 1].dirUrl
    : PAGE_URL_ROOT;
  const dirUrl = relPath ? `${parentDirUrl}/${slug}` : PAGE_URL_ROOT;
  const mediaUrl = MEDIA_URL_ROOT + (relPath ? "/" + relPath.split("/").map(encodeURIComponent).join("/") : "");

  const node = {
    name,
    label: relPath ? humanise(name) : "Home",
    slug,
    relPath,
    depth,
    dirUrl,
    // The root folder is the site homepage and sits at content/index.html;
    // everything below it lives under page/.
    url: relPath ? `${dirUrl}/index.html` : "/index.html",
    mediaUrl,
    // Ancestor chain, stored as plain data so the model stays serialisable.
    breadcrumb: ancestors.map(({ label, url }) => ({ label, url })),
    children: [],
    entries: [],
    media: null,
  };

  node.media = collectMedia(dir, relPath, files, mediaUrl, ctx.health);
  node.entries = buildEntries(dir, relPath, mdFiles, dirUrl, ctx.health);

  // The card image for each entry, decided once here so that the folder
  // listing, a collapsed folder's card and the facet pages all read one field
  // and cannot disagree about what an entry looks like.
  //
  // Seeded per ENTRY, not per folder: a folder holding five notes and five
  // photographs gives five different cards instead of the same picture five
  // times. The images belong to the folder rather than to any one file (see
  // the README), so the pairing is arbitrary — which is exactly why it is
  // seeded and stable rather than random.
  for (const entry of node.entries) {
    entry.thumbnail =
      node.media.thumbnail ||
      pickImage(node.media.images, `${relPath}/${entry.primary.slug}`);
    reportOversizedPick(entry.thumbnail, node.media, relPath, ctx.health);
    // Entry pages read it off the variant for their og:image.
    for (const variant of entry.variants) variant.thumbnail = entry.thumbnail;
  }
  // Kept on the node because the folder itself never reports being empty — its
  // parent does, and by then this frame is gone. See "Structural health" below.
  node.looseFiles = files.filter((f) => !isMarkdown(f));

  // A folder renamed to dodge category/ or tag/ is worth telling the author
  // about: its URL no longer matches the folder name on disk.
  if (relPath && slug !== slugify(name)) {
    ctx.health.collisions.push({ path: relPath, slug, kind: "folder" });
  }

  const childAncestors = [...ancestors, { label: node.label, url: node.url, dirUrl: node.dirUrl }];
  const childSlugs = new Set(RESERVED_DIR_SLUGS);
  for (const childName of childDirs) {
    const child = walk(
      path.join(dir, childName),
      relPath ? `${relPath}/${childName}` : childName,
      depth + 1,
      childAncestors,
      childSlugs,
      ctx,
    );
    node.children.push(child);
  }

  // ── Aggregate the subtree ────────────────────────────────────────────────
  node.allEntries = [...node.entries, ...node.children.flatMap((c) => c.allEntries)]
    .sort(byDateDesc);
  node.entryCount = node.entries.length;
  node.totalEntries = node.allEntries.length;

  node.categories = mergeBySlug(node.allEntries.flatMap((e) => e.categories), "category", node, ctx);
  node.tags = mergeBySlug(node.allEntries.flatMap((e) => e.tags), "tag", node, ctx);

  node.date = node.allEntries.find((e) => e.date)?.date || null;

  // ── Leaf collapse ────────────────────────────────────────────────────────
  // A folder holding exactly one entry and no subfolders IS that entry, not a
  // place containing it. "Every directory is a node" is the right rule for the
  // tree, but applied to the layout the README itself recommends — one folder
  // per subject, so the media in it belongs to that subject — it made 83 of
  // 119 folders into a listing page with a single card on it: an extra click,
  // and a card carrying less information than the one it hides, because folder
  // cards have no description.
  //
  // Collapsed, the folder keeps everything that made it worth having (its
  // name, its thumbnail, its gallery, its place in the breadcrumb) and simply
  // stops emitting a page of its own. The entry keeps its URL inside the
  // folder directory, so every relative link into input_markdown/ still
  // resolves exactly as before.
  //
  // Note this counts ENTRIES, not files: eight models answering one prompt are
  // one entry with a tab strip, so those folders collapse too.
  node.collapsed = Boolean(relPath) && !node.children.length && node.entries.length === 1;
  if (node.collapsed) node.url = node.entries[0].url;

  // A folder card falls back to the first thumbnail found anywhere below it.
  // Top-level folders rarely carry their own thumbnail.* — without this, the
  // homepage of a perfectly well-organised project is a wall of placeholders.
  // Seeded on the folder path rather than on any entry, so a folder's own card
  // does not change when a document inside it is renamed. A picked image beats
  // a descendant's thumbnail: this folder's own pictures describe it better
  // than something three levels down.
  node.cardThumbnail =
    node.media.thumbnail ||
    pickImage(node.media.images, relPath || "(root)") ||
    node.children.map((c) => c.cardThumbnail).find(Boolean) ||
    null;
  reportOversizedPick(node.cardThumbnail, node.media, relPath, ctx.health);

  // What the listing page shows: this folder's own entries plus child folders.
  // A child with no entries anywhere below it is left out entirely — it used
  // to earn a card if it merely held a thumbnail, and that card read "0
  // entries" and led to a page saying "Nothing here yet." The folder is still
  // reported under Structure on the health page, which is where a folder that
  // produces nothing belongs.
  node.items = [
    ...node.children
      .filter((c) => c.totalEntries > 0)
      // A collapsed child is a document, so it gets a document's card: its own
      // description, author and version count, not a bare "1 entry" badge.
      .map((c) => (c.collapsed ? collapsedCard(c) : {
        type: "folder",
        title: c.label,
        url: c.url,
        date: c.date,
        description: "",
        thumbnail: c.cardThumbnail,
        count: c.totalEntries,
        categories: c.categories.slice(0, 3),
        tags: [],
      })),
    ...node.entries.map((e) => ({
      type: "entry",
      title: e.title,
      url: e.url,
      date: e.date,
      description: e.description,
      thumbnail: e.thumbnail,
      author: e.author,
      variantCount: e.variants.length,
      categories: e.categories,
      tags: e.tags,
    })),
  ].sort(byDateDesc);

  // ── Structural health ────────────────────────────────────────────────────
  // A folder that produces nothing is reported by its PARENT, never by itself.
  // Reporting from the folder could only ever see its own level, so a folder
  // holding nothing but empty subfolders went unmentioned while the subfolders
  // were listed one by one — the opposite of useful. A node that does have
  // entries below it (and the root, which always does the honours for the top
  // level) names each child whose whole subtree is empty, and those children
  // stay quiet about theirs, so one empty branch is one line.
  if (node.totalEntries || !relPath) {
    for (const child of node.children) {
      if (child.totalEntries) continue;
      ctx.health.structure.push({
        path: child.relPath,
        message: child.children.length
          ? "no markdown in this folder or in any folder below it"
          : child.looseFiles.length
            ? `folder holds ${child.looseFiles.length} file(s) but no markdown — nothing links to them`
            : "folder is empty",
      });
    }
  }

  if (relPath) {
    if (!node.entries.length && files.some((f) => !isMarkdown(f) && !isThumbnail(f))) {
      const orphans = files.filter((f) => !isMarkdown(f) && !isThumbnail(f));
      for (const file of orphans) {
        ctx.health.unreferenced.push({
          path: `${relPath}/${file}`,
          url: `${mediaUrl}/${encodeURIComponent(file)}`,
          kb: Math.round(fileSize(path.join(dir, file)) / 1024),
        });
      }
    }
  }

  ctx.nodes.push(node);

  // Each variant carries a flat copy of what its page needs from the folder.
  // Deliberately not a reference back to `node` — that would make the model
  // circular, and anything that walked or serialised it would hang.
  const parent = node.breadcrumb[node.breadcrumb.length - 1] || { label: "Home", url: "/index.html" };
  const context = {
    label: node.label,
    url: node.url,
    dirUrl: node.dirUrl,
    mediaUrl: node.mediaUrl,
    breadcrumb: node.breadcrumb,
    media: node.media,
    collapsed: node.collapsed,
    // Where "← Back" goes. On a collapsed folder there is no folder page to go
    // back to — its URL is this page — so the link has to reach past it.
    backLabel: node.collapsed ? parent.label : node.label,
    backUrl: node.collapsed ? parent.url : node.url,
    // Filled in by assignFacets() once the whole tree is known; see there.
    facetLinks: { category: {}, tag: {} },
  };
  for (const entry of node.entries) {
    ctx.entries.push(entry);
    for (const variant of entry.variants) {
      variant.folder = context;
      ctx.variants.push(variant);
    }
  }

  return node;
}

// ── Facet emission ──────────────────────────────────────────────────────────

/** How many of a node's entries carry a given category or tag. */
function facetCount(node, kind, slug) {
  return node.allEntries.filter((e) =>
    (kind === "category" ? e.categories : e.tags).some((v) => slugify(v) === slug)).length;
}

/**
 * Every filename a facet will occupy: its own, plus one per extra page.
 *
 * lib/library.js paginates a facet page to <slug>-2.html, <slug>-3.html … so a
 * facet does not own one name, it owns a run of them.
 */
function facetSlugForms(base, pageCount) {
  const forms = [base];
  for (let page = 2; page <= pageCount; page++) forms.push(`${base}-${page}`);
  return forms;
}

/**
 * Claim a filename for a facet page inside one folder's category/ or tag/.
 *
 * Facet pages paginate to <slug>-2.html, and a tag can genuinely slugify to
 * something ending in -2: a project with 61 notes tagged "bees" and one note
 * tagged "bees 2" had both writing page/tag/bees-2.html, and Eleventy aborts
 * the whole build on a duplicate permalink. Folder listings were already safe
 * from this (RESERVED_PAGE_SLUG covers index-2); facet pages were not.
 *
 * So the whole RUN of names is reserved, not just the first, and a facet that
 * cannot have the run it wants is suffixed until it can. The directory holds
 * nothing but facet pages — RESERVED_DIR_SLUGS stops a folder ever being
 * called category or tag — so this set is the complete picture.
 *
 * Only the FILENAME moves. The slug a tag is matched by is still slugify(value)
 * and is untouched, because that is what library.js filters entries with and
 * what facetLinks is keyed by; renaming that instead would have produced a page
 * that matched nothing and quietly listed zero entries.
 */
function reserveFacetSlug(used, desired, pageCount) {
  let base = desired;
  let n = 2;
  while (facetSlugForms(base, pageCount).some((form) => used.has(form))) {
    base = `${desired}-${n++}`;
  }
  for (const form of facetSlugForms(base, pageCount)) used.add(form);
  return base;
}

/**
 * Decide which folders actually publish facet pages, and where every tag or
 * category link on every page should point.
 *
 * A facet page earns its place only if it narrows something down: it has to
 * list at least two entries, and fewer than the folder already lists. Below
 * that it is either a single card — 1203 of the 1464 facet pages this
 * generator wrote were exactly that, a page whose only link was the article
 * you had just come from — or a verbatim copy of the folder listing, for a tag
 * every entry in the folder happens to share.
 *
 * The root is the deliberate exception and keeps a page for every value, however
 * rare. It is the canonical index for a tag, and it is what makes the fallback
 * below total.
 *
 * Because a facet aggregates a whole subtree, an ancestor's facet set is always
 * a superset of its descendants'. So `facetLinks` can resolve any value to the
 * nearest ancestor still publishing it, and is guaranteed to terminate at the
 * root. Tag pills on an article therefore always lead somewhere with siblings
 * to compare against, instead of to a page holding that article alone.
 */
function assignFacets(node, inherited, ctx) {
  const links = { category: { ...inherited.category }, tag: { ...inherited.tag } };
  const facets = [];

  if (!node.collapsed) {
    for (const kind of ["category", "tag"]) {
      // One namespace per folder per kind: page/<folder>/tag/ holds tag pages
      // and nothing else. Values arrive already sorted (mergeBySlug sorts by
      // localeCompare), so the numbering below cannot wobble between builds.
      const usedSlugs = new Set();

      for (const value of kind === "category" ? node.categories : node.tags) {
        const slug = slugify(value);
        const count = facetCount(node, kind, slug);
        if (node.depth > 0 && (count < 2 || count >= node.totalEntries)) continue;

        const pageCount = Math.max(1, Math.ceil(count / ctx.perPage));
        const urlSlug = reserveFacetSlug(usedSlugs, slug, pageCount);
        const url = `${node.dirUrl}/${kind}/${urlSlug}.html`;

        // A facet whose filename had to move is worth saying out loud, for the
        // same reason a renamed document is: the URL no longer matches the tag.
        if (urlSlug !== slug) {
          ctx.health.collisions.push({
            path: `${node.relPath || "(root)"} — ${kind} "${value}"`,
            slug: urlSlug,
            kind,
            url,
          });
        }

        facets.push({ kind, value, slug, urlSlug, url, count });
        links[kind][slug] = url;
      }
    }
  }

  node.facets = facets;
  node.facetLinks = links;

  // Entry pages link by way of their folder context, which was built during
  // the walk — before any of this was known. Same object, so one assignment
  // per node reaches every variant in it.
  for (const entry of node.entries) {
    for (const variant of entry.variants) variant.folder.facetLinks = links;
  }

  for (const child of node.children) assignFacets(child, links, ctx);
}

// ── Public API ──────────────────────────────────────────────────────────────

function scan(rootDir, options = {}) {
  const health = {
    metadata: [],      // fallback warnings, from normalise.js
    structure: [],     // empty folders, media with no markdown
    unreferenced: [],  // media nothing renders
    oversized: [],     // thumbnails over budget
    duplicates: [],    // same title in different folders
    collisions: [],    // slugs that needed a numeric suffix
    facets: [],        // one tag/category spelled more than one way
    math: [],          // KaTeX failures, filled in by markdown.js during render
    render: [],        // documents whose body crashed the renderer, likewise
    settings: [],      // unusable values in site_settings.json, from library.js
  };
  // perPage is only needed so assignFacets() can know how many filenames a
  // facet page will occupy once library.js paginates it. Infinity means "one
  // page each", which is what a caller that does not paginate gets.
  const perPage = Number(options.perPage) > 0 ? Number(options.perPage) : Infinity;
  const ctx = { nodes: [], entries: [], variants: [], health, perPage };

  // A missing content folder is a warning, not a failure. walk() reads an
  // absent directory as an empty one, so the site still gets a homepage that
  // says so rather than no homepage at all.
  if (!fs.existsSync(rootDir)) {
    health.structure.push({
      path: rootDir,
      message: "content folder not found — the site was built empty",
    });
  }

  const root = walk(rootDir, "", 0, [], new Set(), ctx);

  // Top-down, unlike the walk: a node's facet links depend on its ancestors,
  // which have not finished being built while the depth-first walk is inside
  // them.
  assignFacets(root, { category: {}, tag: {} }, ctx);

  // Titles repeated in different folders aren't an error, but they make an
  // index ambiguous, so they are worth surfacing.
  const byTitle = new Map();
  for (const entry of ctx.entries) {
    if (entry.title === NO_TITLE) continue;
    const key = entry.title.toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(entry);
  }
  for (const [, group] of byTitle) {
    if (group.length > 1) {
      health.duplicates.push({
        title: group[0].title,
        // Objects rather than bare strings: the folder is what identifies the
        // duplicate to a reader, but the entry's own URL is what you want to
        // open to compare the two.
        paths: group.map((e) => ({ path: e.relPath || "(root)", url: e.url })),
      });
    }
  }

  // Slugs that needed disambiguating — worth knowing, because the URL then
  // no longer matches the filename.
  for (const variant of ctx.variants) {
    if (variant.slug !== slugify(variant.baseName)) {
      health.collisions.push({ path: variant.relPath, slug: variant.slug, kind: "file" });
    }
  }

  return { root, nodes: ctx.nodes, entries: ctx.entries, variants: ctx.variants, health };
}

module.exports = { scan, PAGE_URL_ROOT, MEDIA_URL_ROOT, THUMBNAIL_BUDGET_KB };
