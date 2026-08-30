/**
 * health.js — the findings the status page is built from.
 *
 * Every bucket used to be a bare array that anything could push onto, and that
 * had one consequence worth a module of its own: whether a finding could be
 * reported twice was a property of the CALL SITE, remembered or forgotten one
 * push at a time. Exactly one of the twelve remembered — reportOversizedPick()
 * in scan.js carried a hand-written `.some(o => o.file === file)` guard, added
 * after a bug — and the ones that forgot showed it:
 *
 *   - a tag spelled two ways in one deep folder was reported once by that
 *     folder AND once by every folder above it, because a facet aggregates its
 *     whole subtree. Four rows on the status page for one thing to fix.
 *   - a file whose YAML would not parse produced two findings on the same
 *     `frontmatter` field, so the "No frontmatter at all" tally read 4 for two
 *     files.
 *
 * So the bucket is no longer something you push onto. add() takes a KEY, and a
 * finding whose key has already been seen in that bucket is dropped. Passing
 * `null` as the key means "this can genuinely happen more than once, append
 * it" — which makes the decision explicit at each call site rather than
 * implicit in whether somebody thought about it.
 *
 * The buckets themselves stay plain arrays: library.js replaces two of them
 * outright (`settings`, `demoted`) and hands three more to markdown.js by
 * reference as live collectors, and the templates iterate them. `add` is
 * defined non-enumerably so none of that can see it.
 */

/**
 * The finding buckets, in the order the status page presents them.
 *
 * Adding one here is the whole job — `add()` accepts any name in this list and
 * rejects anything else, so a typo in a bucket name is a build-time error
 * rather than a finding that silently goes nowhere.
 */
const BUCKETS = {
  metadata: "fallback warnings, from normalise.js",
  structure: "empty folders, media with no markdown",
  unreferenced: "media nothing renders",
  oversized: "thumbnails over budget",
  checksums: "download files that could not be hashed",
  duplicates: "same title in more than one folder",
  collisions: "slugs that needed a numeric suffix",
  facets: "one tag/category spelled more than one way",
  math: "KaTeX failures, filled in by markdown.js during render",
  render: "documents whose body crashed the renderer, likewise",
  settings: "unusable values in site_settings.json, from library.js",
};

function createHealth() {
  const health = {};
  for (const name of Object.keys(BUCKETS)) health[name] = [];

  const seen = new Set();

  Object.defineProperty(health, "add", {
    /**
     * Record a finding.
     *
     * @param {string} bucket one of BUCKETS
     * @param {string|null} key identity of the finding within that bucket.
     *        Null appends unconditionally — use it only where a repeat is a
     *        genuinely separate finding.
     * @param {object} row the finding itself
     * @returns {boolean} false if it was a duplicate and was dropped
     */
    value(bucket, key, row) {
      if (!Object.prototype.hasOwnProperty.call(BUCKETS, bucket)) {
        throw new Error(`unknown health bucket "${bucket}"`);
      }
      if (key !== null && key !== undefined) {
        // Joined on NUL, which cannot occur in a path, a slug or a tag, so
        // two different keys can never collide by concatenation.
        const id = `${bucket}\u0000${key}`;
        if (seen.has(id)) return false;
        seen.add(id);
      }
      health[bucket].push(row);
      return true;
    },
    enumerable: false,
  });

  return health;
}

module.exports = { createHealth, BUCKETS };
