#!/bin/bash
# Build the site. Double-click it, or run ./build.sh from a terminal.
#
# Uses the standalone binary if it is present (no Node, no npm, no
# node_modules), and falls back to npx eleventy if it isn't.
cd "$(dirname "$0")" || exit 1

if [ -x ./encyclopedia-linux-x64 ]; then
    ./encyclopedia-linux-x64 "$@"
elif [ -x ./node_modules/.bin/eleventy ]; then
    echo "encyclopedia-linux-x64 not found — falling back to local Eleventy."
    ./node_modules/.bin/eleventy "$@"
else
    echo "Nothing to build with." >&2
    echo "Either compile the binary (eleventy_binary/compile.sh) or run 'npm install'." >&2
    exit 1
fi

status=$?
echo
if [ $status -eq 0 ]; then
    echo "Done. Open content/index.html in a browser."
    echo "Then run ./healthcheck.sh to check links and file sizes."
fi
exit $status
