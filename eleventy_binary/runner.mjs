// Standalone build runner for the encyclopaedia generator.
//
// Compiled by Bun into encyclopedia-linux-x64 / encyclopedia-win-x64.exe (see
// compile.sh). The executable bundles Eleventy AND eleventy.config.js with
// everything it requires (markdown-it + plugins, KaTeX, gray-matter), so no
// node_modules and no Node.js are needed at run time.
//
// Templates, includes and your markdown are still read from disk normally —
// editing content never needs a recompile. Recompile only when the config or
// lib/ changes, or when Eleventy is upgraded (see README.md in this folder).
//
// Usage:
//   ./encyclopedia-linux-x64                 build ./content
//   ./encyclopedia-linux-x64 ~/MyBundle      build another bundle
//   ./encyclopedia-linux-x64 --quiet
//
// A "bundle" is a folder containing input_markdown/. The generated HTML is
// written into that same folder, because media is linked rather than copied
// and those links are relative.

import path from "node:path";
import fs from "node:fs";
// Side-effect import, and it must stay ABOVE the Eleventy import: it repairs an
// fs.existsSync bug in Bun's Windows build that otherwise makes the .exe write
// zero pages while still exiting 0. See the file for the full explanation.
import "./win-fs-shim.mjs";
import Eleventy from "@11ty/eleventy";

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`usage: encyclopedia [bundle-folder] [--quiet]

  bundle-folder   a folder containing input_markdown/ (default: ./content)
  --quiet         only print the summary line

Builds index.html, page/ and assets/ inside the bundle folder. Your markdown
and media are read, never modified, and never copied.

Afterwards, run healthcheck.sh (or healthcheck.bat) to check links and file
sizes, and open <bundle>/page/status.html to see what was built and what
metadata was guessed.`);
  process.exit(0);
}

if (args.includes("--serve") || args.includes("--watch")) {
  console.error("This binary only builds the site.");
  console.error("For a live-reloading dev server use: npm start");
  process.exit(1);
}

const quiet = args.includes("--quiet");
const target = args.find((a) => !a.startsWith("-"));

// Resolve the bundle BEFORE the config is imported: eleventy.config.js and
// _data/library.js both read this variable while they are being evaluated.
if (target) {
  const bundle = path.resolve(target);
  const markdown = path.join(bundle, "input_markdown");

  if (!fs.existsSync(bundle)) {
    console.error(`No such folder: ${bundle}`);
    process.exit(1);
  }
  if (!fs.existsSync(markdown)) {
    // Creating it is friendlier than refusing: the site builds empty and its
    // homepage tells you where to put your files.
    try {
      fs.mkdirSync(markdown, { recursive: true });
      console.log(`Created ${markdown} — put your markdown project in there.`);
    } catch (err) {
      console.error(`Could not create ${markdown}: ${err.message}`);
      process.exit(1);
    }
  }
  process.env.ENCYCLOPEDIA_BUNDLE = bundle;
}

// The binary carries the CONFIG, not the templates: pages/, eleventy_settings/,
// css/, fonts/ and the rest are still read from the working directory. Run it
// somewhere without them — which the README's own "give a bundle its own name
// and icons" advice invites — and Eleventy finds nothing to render, does not
// consider that an error, and writes zero files while exiting 0. build.sh then
// prints "Done. Open content/index.html in a browser." and there is no
// index.html. Say so instead.
for (const dir of ["pages", "eleventy_settings"]) {
  if (!fs.existsSync(path.resolve(process.cwd(), dir))) {
    console.error(`No ${dir}/ in ${process.cwd()}`);
    console.error("This binary reads its templates from the working directory, so it has to");
    console.error("be run from the project folder (the one holding pages/ and eleventy_settings/).");
    console.error("Point it at a bundle instead of moving it:  encyclopedia <bundle-folder>");
    process.exit(1);
  }
}

const { default: configFn } = await import("../eleventy.config.js");

// Eleventy's programmatic API runs the config function but IGNORES its return
// object (dir, templateFormats, engines) — see the TODO in Eleventy.js. So we
// capture the return value and re-apply each setting through supported APIs.
let fileConfig = {};

const elev = new Eleventy(".", ".", {
  // Never look for eleventy.config.js on disk — the bundled copy is the config.
  configPath: false,
  quietMode: quiet,
  config: (eleventyConfig) => {
    fileConfig = configFn(eleventyConfig) || {};
    if (fileConfig.templateFormats) {
      eleventyConfig.setTemplateFormats(fileConfig.templateFormats);
    }
    const dir = fileConfig.dir || {};
    if (dir.input) eleventyConfig.setInputDirectory(dir.input);
    if (dir.includes) eleventyConfig.setIncludesDirectory(dir.includes);
    if (dir.layouts) eleventyConfig.setLayoutsDirectory(dir.layouts);
    if (dir.data) eleventyConfig.setDataDirectory(dir.data);
    if (dir.output) eleventyConfig.setOutputDirectory(dir.output);
  },
});

// Root-level return values have no setter API; they can only be injected as
// root-config overrides via initializeConfig(). Getters are required here:
// they are read (Object.assign in appendToRootConfig) only AFTER the config
// callback above has populated fileConfig.
await elev.initializeConfig({
  get markdownTemplateEngine() {
    return fileConfig.markdownTemplateEngine ?? "liquid";
  },
  get htmlTemplateEngine() {
    return fileConfig.htmlTemplateEngine ?? "liquid";
  },
});

try {
  // write() resolves to [passthroughCopyResults, templateResults] — a pair, so
  // its own length is always 2 and never says anything about the build. The
  // template list is the half that matters.
  const [, templates] = (await elev.write()) ?? [];
  // Belt and braces for the same failure as the guard above: a build that
  // renders nothing is never a success, and exiting 0 on it is how an empty
  // bundle gets shipped without anyone noticing.
  if (Array.isArray(templates) && templates.length === 0) {
    console.error("Nothing was written — no templates were found to render.");
    console.error(`Run this from the project folder, not from ${process.cwd()}.`);
    process.exit(1);
  }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
