/**
 * hash.js — SHA-256 and SHA-512 for the files on a download list.
 *
 * Three constraints shape this file, and none of them are negotiable:
 *
 *   1. scan.js is synchronous from top to bottom. There is no async seam
 *      anywhere between the recursive walk and collectMedia(), so this reads
 *      with openSync/readSync/closeSync rather than a stream.
 *   2. A download can be an ISO. fs.readFileSync() on one either exhausts the
 *      process's memory or hits Node's buffer limit, so the file is walked in
 *      fixed chunks through a single buffer reused for the life of the process.
 *   3. Both digests come from ONE pass over the bytes. Reading a 4 GB file
 *      twice to hash it twice would double the only expensive part.
 *
 * Nothing here throws, for the same reason nothing in scan.js does: an
 * unreadable file is a row on the status page, not a failed build.
 */

const fs = require("fs");
const { createHash } = require("crypto");

/**
 * 1 MiB — large enough that a 4 GB file costs ~4000 read syscalls rather than a
 * million, small enough that the buffer never shows up in RSS.
 */
const CHUNK_BYTES = 1024 * 1024;

/**
 * One buffer for the whole process, allocated on first use so a project with no
 * downloads never pays for it. Safe to share because the read loop below is
 * synchronous — two digests are never in flight at the same time.
 */
let chunk = null;

/**
 * absolute path -> { key, value }
 *
 * Same shape and the same reasoning as the cache in site.js: `npm start` keeps
 * this module loaded across rebuilds, and content/** is in .eleventyignore, so
 * saving ANY markdown file re-runs the whole scan. Without this, every save
 * would re-read every download in the project.
 *
 * Keyed on mtime + size rather than held forever, so replacing a file in place
 * shows a new digest without restarting the dev server.
 *
 * It does not grow without bound: the keys are the download paths that exist,
 * not the builds that have run, so re-hashing a changed file replaces its entry
 * rather than adding one.
 */
const cache = new Map();

/**
 * Digests for `file`, given the fs.Stats scan.js has ALREADY taken for its size.
 * Deliberately takes the stat rather than the path alone — collectMedia stats
 * every download anyway, and a second stat per file for the cache key would be
 * a syscall paid on every build for nothing.
 *
 * @param {string} file absolute path
 * @param {fs.Stats|null} stat the stat scan.js already has, or null
 * @returns {{sha256: string, sha512: string}|null} null if it could not be read
 */
function fileHashes(file, stat) {
  // A FIFO or a device node would block readSync forever. statSync follows
  // symlinks, so a symlink to a regular file still hashes its target.
  if (!stat || !stat.isFile()) return null;

  const key = `${stat.mtimeMs}:${stat.size}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.value;

  const value = digest(file);
  // Failures are deliberately NOT cached. Fixing a file's permissions does not
  // change its mtime, so a cached null would survive the fix and the status
  // page would go on reporting a file that now reads perfectly well. Retrying
  // costs one failed openSync per build.
  if (value) cache.set(file, { key, value });
  return value;
}

/** The uncached read: one pass over the bytes, both digests. */
function digest(file) {
  if (!chunk) chunk = Buffer.allocUnsafe(CHUNK_BYTES);

  let fd = null;
  try {
    fd = fs.openSync(file, "r");
    const sha256 = createHash("sha256");
    const sha512 = createHash("sha512");

    for (;;) {
      // A null position means "carry on from where the descriptor is", which is
      // what advances the file through the loop.
      const read = fs.readSync(fd, chunk, 0, CHUNK_BYTES, null);
      if (read <= 0) break;
      // subarray, not a copy: a full chunk goes straight through, and only the
      // final short read allocates a view.
      const bytes = read === CHUNK_BYTES ? chunk : chunk.subarray(0, read);
      sha256.update(bytes);
      sha512.update(bytes);
    }

    return { sha256: sha256.digest("hex"), sha512: sha512.digest("hex") };
  } catch {
    // The same contract as the rest of the scan: an unreadable file costs you
    // its checksums, never the build.
    return null;
  } finally {
    // In a finally rather than after the return, so a read that fails partway
    // through a file cannot leak a descriptor. A dev server leaking one per
    // failed build would eventually hit EMFILE.
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already gone */ }
    }
  }
}

module.exports = { fileHashes, CHUNK_BYTES };
