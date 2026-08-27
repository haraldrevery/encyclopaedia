// Repairs fs.existsSync on the Windows build. Imported for its side effect,
// and imported BEFORE Eleventy so the patch is in place no matter when
// Eleventy first calls it.
//
// Bun's Windows target (1.3.14) answers ENOENT for the paths that resolve to
// the working directory ITSELF with a trailing separator — "./", ".\", "././"
// — while statSync on those very same paths succeeds. "..", "../", "pages/"
// and absolute paths are all reported correctly; it is only the bare
// self-reference that is wrong.
//
// That one lie is enough to produce a silent, empty build. Eleventy asks
// TemplatePath.convertToRecursiveGlobSync(".") for its template glob; that
// helper appends "**" only if isDirectorySync("./") — i.e. existsSync("./") —
// says the path is a directory. Told it is not, it hands back "./" unchanged
// and the search glob degrades from "./**/*.njk" to ".//*.njk". Passthrough
// copy still runs (it globs real subdirectory names), so the exe copies its 26
// assets, matches no template, and writes zero pages.
//
// Deleting this file is safe once Bun fixes the underlying bug; nothing else
// depends on it.

import fs from "node:fs";

if (process.platform === "win32") {
  const nativeExistsSync = fs.existsSync;
  fs.existsSync = function existsSync(p) {
    if (nativeExistsSync(p)) return true;
    // statSync is not subject to the same bug, so it settles the disagreement.
    try {
      fs.statSync(p);
      return true;
    } catch {
      return false;
    }
  };
}
