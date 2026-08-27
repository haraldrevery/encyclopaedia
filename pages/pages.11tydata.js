/**
 * Directory data for pages/.
 *
 * Derives title / breadcrumb / description for each generated page from the
 * paginated item, so the templates only have to declare what KIND of page they
 * are. These have to be real functions — expressed as template strings in YAML
 * front matter, `crumbs` would arrive at the layout as "[object Object]".
 */

module.exports = {
  eleventyComputed: {
    title: (data) => {
      const item = data.item;
      switch (data.pageKind) {
        case "folder": return item.node.label;
        case "facet": return item.facet.value;
        case "entry": return item.variant.title;
        default: return data.pageTitle;
      }
    },

    /** Ancestors only — the current page is the last crumb and isn't a link. */
    crumbs: (data) => {
      const item = data.item;
      switch (data.pageKind) {
        case "folder":
          return item.node.breadcrumb;
        case "facet":
          return [...item.node.breadcrumb, { label: item.node.label, url: item.node.url }];
        case "entry": {
          const folder = item.variant.folder;
          // A collapsed folder has no page of its own — its URL is this page —
          // so it must not appear as a crumb linking to itself. The folder's
          // name is not lost: it is what the page is titled.
          if (folder.collapsed) return folder.breadcrumb;
          return [...folder.breadcrumb, { label: folder.label, url: folder.url }];
        }
        default:
          return data.crumbs || [{ label: "Home", url: "/index.html" }];
      }
    },

    description: (data) => {
      const item = data.item;
      switch (data.pageKind) {
        case "folder":
          return `${item.node.totalEntries} entries in ${item.node.label}.`;
        case "facet":
          return `${item.totalItems} entries tagged ${item.facet.value}.`;
        case "entry":
          return item.variant.description;
        default:
          return data.pageDescription || "";
      }
    },

    /**
     * The card image for this page, as a site-absolute URL, used for og:image.
     *
     * Only ever read when site_settings.json sets a `url` — base.njk gates the
     * whole Open Graph block on it — but computed unconditionally, because
     * eleventyComputed has no access to global data's `site` at this point and
     * the value costs nothing when unused.
     *
     * Entry pages read the thumbnail off the variant and folder pages off the
     * node; both were decided once in lib/scan.js, so a page's share card shows
     * the same picture its card does in the listing it came from.
     */
    ogImage: (data) => {
      const item = data.item;
      switch (data.pageKind) {
        case "entry":
          return item.variant.thumbnail ? item.variant.thumbnail.url : "";
        case "folder":
          return item.node.cardThumbnail ? item.node.cardThumbnail.url : "";
        case "facet":
          return item.node.cardThumbnail ? item.node.cardThumbnail.url : "";
        default:
          return "";
      }
    },

    // Entries always want it; any other page opts in with `wantsLightbox: true`
    // in its own front matter. It has to be a separate key — eleventyComputed
    // shadows the front-matter value of the same name, so reading
    // data.needsLightbox here would be circular.
    needsLightbox: (data) => data.pageKind === "entry" || data.wantsLightbox === true,

    // Same condition as needsLightbox today, but kept as its own flag: they
    // gate unrelated features, and folding one into the other would mean a
    // page that wants a lightbox and no width toggle can't say so.
    needsReadingWidth: (data) => data.pageKind === "entry",

    // The homepage is the one page whose nav hides until you scroll and whose
    // hero runs full-bleed under it. Same shape as the flags above: computed
    // once here, consumed with {% if %} in base.njk and nav.njk.
    //
    // The pageKind guard has to come first — data.item is undefined on
    // about.njk, legal.njk, status.njk and webmanifest.njk.
    isHome: (data) => data.pageKind === "folder" && data.item.node.depth === 0,
  },
};
