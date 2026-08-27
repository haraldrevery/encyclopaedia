#!/bin/bash
# ---------------------------------------------------------------------------
# dev.sh - live-reloading development server.
#
# You only need this when you are changing the LOOK or the LOGIC. Editing your
# markdown never needs it: run ./build.sh (or the binary) and refresh.
#
# Starts the Tailwind watchers and a server. With node_modules present you get
# Eleventy's live-reloading dev server; without it we fall back to the
# standalone binary (rebuild-on-change + a plain static server, no live reload).
# Either way nothing is ever downloaded.
# ---------------------------------------------------------------------------
cd "$(dirname "$0")" || exit 1

TW=$(ls tailwindcss-linux-* 2>/dev/null | head -n 1)
if [ -z "$TW" ]; then
    echo "No tailwindcss-linux-* binary found - CSS will not rebuild." >&2
    echo "Download the standalone Tailwind CLI into this folder to enable it." >&2
else
    chmod +x "$TW" 2>/dev/null
    CONTENT="./pages/**/*.njk,./eleventy_settings/**/*.njk"

    # One blocking build first, so the server never starts against stale CSS.
    ./"$TW" -i css/input.css       -o css/main.css   --content "$CONTENT" --minify
    ./"$TW" -i css/input_prose.css -o css/prose.css  --content "$CONTENT" --minify

    # Tailwind's CLI exits when stdin closes, so background watchers are held
    # open with a null stdin.
    tail -f /dev/null | ./"$TW" -i css/input.css       -o css/main.css  --content "$CONTENT" --watch --minify &
    tail -f /dev/null | ./"$TW" -i css/input_prose.css -o css/prose.css --content "$CONTENT" --watch --minify &
fi

# Registered BEFORE the foreground command, or it never arms and the watchers
# survive Ctrl-C as orphans.
trap 'kill 0' EXIT INT TERM

# Never `npx eleventy`: with no node_modules that prompts to install, and the
# package it installs is the donated placeholder that only throws. The real
# package is @11ty/eleventy, and a dev server has no business hitting the
# network anyway - use what is on disk or say why we can't.
if [ -x ./node_modules/.bin/eleventy ]; then
    ./node_modules/.bin/eleventy --serve --incremental
    exit $?
fi

BIN=./encyclopedia-linux-x64
if [ ! -x "$BIN" ]; then
    echo "No node_modules and no $BIN - nothing can serve." >&2
    echo "Run 'npm install' (live reload), or compile the binary" >&2
    echo "with eleventy_binary/compile.sh (rebuild-on-change)." >&2
    exit 1
fi

echo "No node_modules - using $BIN. Rebuild-on-change, but no live reload:"
echo "refresh the browser yourself after a change."
"$BIN" || exit 1

PORT=${PORT:-8080}
if command -v python3 >/dev/null 2>&1; then
    python3 -m http.server "$PORT" --directory content --bind 127.0.0.1 &
    echo
    echo "Serving http://127.0.0.1:$PORT/  (Ctrl-C to stop)"
else
    echo
    echo "python3 not found - no server. Open content/index.html directly."
fi

# Poll instead of inotifywait, which is not installed everywhere. Only sources
# are watched: the binary writes into content/ but never into input_markdown/,
# so a build cannot retrigger itself.
STAMP=$(mktemp) || exit 1
trap 'rm -f "$STAMP"; kill 0' EXIT INT TERM
WATCH="pages eleventy_settings lib eleventy.config.js content/input_markdown"
# The inputs that live outside those folders. Eleventy's own dev server
# watches these through addWatchTarget in eleventy.config.js, but this
# fallback loop has its own list and would otherwise sit there while an
# edit to the site name changed nothing on screen.
WATCH="$WATCH site_settings.json favicon input_about_legal"

while sleep 1; do
    # shellcheck disable=SC2086
    changed=$(find $WATCH -newer "$STAMP" -print -quit 2>/dev/null)
    [ -n "$changed" ] || continue
    touch "$STAMP"
    echo
    echo "Change detected - rebuilding..."
    "$BIN" --quiet
done
