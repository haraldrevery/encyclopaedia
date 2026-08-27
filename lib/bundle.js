/**
 * bundle.js — where the content bundle lives.
 *
 * A "bundle" is the folder you distribute: it holds input_markdown/ (yours),
 * plus index.html, page/ and assets/ (generated). It defaults to ./content,
 * and the standalone binary can point at another one so you can keep several
 * projects side by side:
 *
 *   ./encyclopedia-linux-x64 ~/Notes/CookingBundle
 *
 * The path is deliberately the BUNDLE, not a bare markdown folder. Media is
 * linked rather than copied, and those links are relative — which only works
 * if the markdown sits inside the folder the HTML is written to.
 */

const path = require("path");
const fs = require("fs");

const DEFAULT_BUNDLE = "content";
const MARKDOWN_SUBDIR = "input_markdown";

/**
 * Absolute path to the bundle root.
 *
 * Resolved against the working directory, not __dirname — same reason as
 * staticsDir() in statics.js. Inside the compiled binary __dirname points into
 * Bun's bundled filesystem, so the default read from ../content found nothing
 * while bundleOutputDir() below (a relative path, resolved by Eleventy against
 * the working directory) still wrote into the real ./content: the binary built
 * an empty site next to the markdown it had failed to read. Both now resolve
 * from one place and cannot drift apart again.
 */
function bundleDir() {
  const override = process.env.ENCYCLOPEDIA_BUNDLE;
  if (override) return path.resolve(override);
  return path.resolve(process.cwd(), DEFAULT_BUNDLE);
}

/** The bundle path as Eleventy wants it: relative to the project root. */
function bundleOutputDir() {
  const override = process.env.ENCYCLOPEDIA_BUNDLE;
  return override ? path.resolve(override) : DEFAULT_BUNDLE;
}

/** Absolute path to the markdown the site is generated from. */
function markdownDir() {
  return path.join(bundleDir(), MARKDOWN_SUBDIR);
}

/**
 * Create the markdown folder if the bundle exists but it doesn't. Pointing the
 * binary at a fresh directory should produce an empty site that tells you where
 * to put your files, not an error.
 */
function ensureMarkdownDir() {
  const dir = markdownDir();
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* read-only location — scan() reports the missing folder instead */
    }
  }
  return dir;
}

module.exports = { bundleDir, bundleOutputDir, markdownDir, ensureMarkdownDir, MARKDOWN_SUBDIR };
