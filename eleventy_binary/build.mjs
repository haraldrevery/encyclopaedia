// Compiles the standalone encyclopaedia binaries. Run with:  ~/.bun/bin/bun build.mjs
// (or just ./compile.sh). Needs Bun only at compile time, never at run time.
//
// Why not a plain `bun build --compile` CLI call: Eleventy locates its own
// package.json at run time relative to import.meta.url, which inside a
// compiled bundle collapses to "/package.json" and fails. The plugin below
// patches that one lookup to return the package.json embedded at compile time.

import path from "node:path";
import { fileURLToPath } from "node:url";
import eleventyPkg from "@11ty/eleventy/package.json";

const here = path.dirname(fileURLToPath(import.meta.url));

const eleventyPkgShim = {
  name: "eleventy-pkg-shim",
  setup(build) {
    build.onLoad({ filter: /[\\/]@11ty[\\/]eleventy[\\/]src[\\/]Util[\\/]ImportJsonSync\.js$/ }, async (args) => {
      const src = await Bun.file(args.path).text();
      const marker = "function getEleventyPackageJson() {";
      if (!src.includes(marker)) {
        throw new Error("eleventy-pkg-shim: getEleventyPackageJson not found — Eleventy update changed ImportJsonSync.js, adjust this plugin.");
      }
      return {
        contents: src.replace(marker, `${marker} return ${JSON.stringify(eleventyPkg)};`),
        loader: "js",
      };
    });
  },
};

for (const [target, outfile] of [
  ["bun-linux-x64", "../encyclopedia-linux-x64"],
  ["bun-windows-x64", "../encyclopedia-win-x64.exe"],
]) {
  const result = await Bun.build({
    entrypoints: [path.join(here, "runner.mjs")],
    plugins: [eleventyPkgShim],
    compile: {
      target,
      outfile: path.join(here, outfile),
    },
  });
  if (!result.success) {
    console.error(result.logs.join("\n"));
    process.exit(1);
  }
  console.log(`Compiled ${target} -> ${path.resolve(here, outfile)}`);
}
