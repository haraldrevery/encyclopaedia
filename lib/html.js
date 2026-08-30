/**
 * html.js — the one way to put a string into generated HTML.
 *
 * Almost nothing in this project builds HTML by hand: the templates are
 * Nunjucks, which escapes `{{ value }}` automatically, and that is why the
 * media gallery renders a file called `my "quote" & <evil>.mp4` correctly
 * without anyone having had to think about it.
 *
 * The exception is lib/markdown.js, which assembles a few tags as strings
 * because they are injected into a markdown body before the renderer runs.
 * There the autoescaping is not there to be relied on, and the discipline had
 * to be remembered instead — so it wasn't. `![[my "quote" & <evil>.mp4]]` put
 * the filename straight into the player's fallback text, and the `<evil>` in
 * it became a real element in the reader's DOM, swallowing the download link.
 * A filename is not authored content: it comes off the filesystem, out of a
 * zip, out of somebody else's vault.
 *
 * Three copies of this function already existed — one in eleventy.config.js,
 * one in javascript/search.js for the client, and Nunjucks' own. This is the
 * server-side one, in a place both callers can reach, so there is no version
 * of "escape a string" that lives closer to hand than the correct one.
 *
 * Escapes the four characters that matter in both text and double-quoted
 * attribute position. Single quotes are not escaped because nothing here emits
 * single-quoted attributes; if that ever changes, escape `'` too rather than
 * writing a second function.
 */
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { escapeHtml };
