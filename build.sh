#!/bin/bash
# Build the site. Double-click it, or run ./build.sh from a terminal.
#
# Uses the standalone binary if it is present (no Node, no npm, no
# node_modules), and falls back to npx eleventy if it isn't.
cd "$(dirname "$0")" || exit 1

# Which bundle the generator will actually write to, worked out the same way it
# works it out: first non-flag argument, else ENCYCLOPEDIA_BUNDLE, else content.
# The closing message used to say "content/index.html" whatever was built.
DEFAULT_BUNDLE="content"
BUNDLE="${ENCYCLOPEDIA_BUNDLE:-$DEFAULT_BUNDLE}"
for arg in "$@"; do
    case "$arg" in
        -*) ;;
        *)  BUNDLE="$arg"; break ;;
    esac
done

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
    echo "Done. Open ${BUNDLE%/}/index.html in a browser."
    if [ "$BUNDLE" = "$DEFAULT_BUNDLE" ]; then
        echo "Then run ./healthcheck.sh to check links and file sizes."
    else
        echo "Then run ./healthcheck.sh \"$BUNDLE\" to check links and file sizes."
    fi
fi
exit $status
