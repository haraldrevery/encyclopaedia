#!/bin/bash
# ---------------------------------------------------------------------------
# healthcheck.sh - report-only sanity scan of the built site.
#
#   ./healthcheck.sh            full report
#   ./healthcheck.sh --quiet    only sections that found something
#   ./healthcheck.sh --help     usage and current thresholds
#
# Checks:
#   A. broken references  - src/href/poster/srcset in HTML, url() in CSS
#   B. case-only mismatch - works on Windows, 404s on a case-sensitive host
#   C. size budgets       - oversized images/svg, and per-page image weight
#
# This is the companion to content/page/status.html. That page is generated at
# build time and reports on your METADATA - fields the generator had to guess.
# This script runs afterwards against the finished HTML and reports on LINKS
# and FILE SIZES, which only exist once the site has been written.
#
# Note on B: only meaningful on a case-sensitive filesystem. On NTFS/APFS the
# reference resolves and nothing is reported - which is exactly the platform
# where wrong-cased references get created in the first place. healthcheck.ps1
# does the same check by comparing against the real directory listing.
#
# Note on C: per-page image weight is an UPPER BOUND, not real transfer size.
# Every srcset candidate is summed on top of the <img src>, and an image used
# twice on a page counts twice. Treat it as "this page is carrying too much".
#
# This script never writes, moves or deletes anything.
#   exit 0  clean (or warnings only)
#   exit 1  errors found
#   exit 2  cannot check - bad usage, or content/ holds no built pages
# ---------------------------------------------------------------------------

cd "$(dirname "$0")" || exit 2

# --- thresholds (override from the environment, e.g. IMG_MAX_KB=500 ./healthcheck.sh)
IMG_MAX_KB=${IMG_MAX_KB:-850}
SVG_MAX_KB=${SVG_MAX_KB:-500}
THUMB_MAX_KB=${THUMB_MAX_KB:-150}
PAGE_IMG_MAX_KB=${PAGE_IMG_MAX_KB:-8000}

# --- scope -----------------------------------------------------------------
# The built site is content/. Everything under content/page/ is generated, at
# any depth, so this walks recursively rather than listing pages by hand the
# way the reference site does - here the page set is not knowable in advance.
SITE_DIR="content"
CSS_FILES="content/assets/main.css content/assets/prose.css"

# Media lives in content/input_markdown/ and is linked, never copied - so it
# IS in scope for size budgets: an oversized image there still ships.
MEDIA_DIR="content/input_markdown"

# --- output helpers --------------------------------------------------------
if [ -t 1 ]; then
    RED=$'\033[31m'; YLW=$'\033[33m'; GRN=$'\033[32m'; DIM=$'\033[2m'; BLD=$'\033[1m'; RST=$'\033[0m'
else
    RED=; YLW=; GRN=; DIM=; BLD=; RST=
fi

QUIET=0
case "$1" in
    '')        ;;
    --quiet)   QUIET=1 ;;
    -h|--help)
        printf 'usage: %s [--quiet]\n\n' "${0##*/}"
        printf '  --quiet   print only the sections that found something\n'
        printf '  --help    this message\n\n'
        printf 'Thresholds can be overridden from the environment:\n'
        printf '  IMG_MAX_KB=%s  SVG_MAX_KB=%s  THUMB_MAX_KB=%s  PAGE_IMG_MAX_KB=%s\n' \
               "$IMG_MAX_KB" "$SVG_MAX_KB" "$THUMB_MAX_KB" "$PAGE_IMG_MAX_KB"
        exit 0 ;;
    *)
        printf '%s: unknown option "%s"\nusage: %s [--quiet]\n' \
               "${0##*/}" "$1" "${0##*/}" >&2
        exit 2 ;;
esac
if [ $# -gt 1 ]; then
    printf '%s: too many arguments\nusage: %s [--quiet]\n' "${0##*/}" "${0##*/}" >&2
    exit 2
fi

if [ ! -d "$SITE_DIR" ]; then
    printf '%s: %s/ not found - build the site first.\n' "${0##*/}" "$SITE_DIR" >&2
    exit 2
fi

TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT

errors=0
warnings=0

# section <file> <label> <severity>  - print a findings file, or a pass line
section() {
    local f=$1 label=$2 sev=$3 n=0
    [ -s "$f" ] && n=$(wc -l < "$f")
    if [ "$n" -eq 0 ]; then
        [ "$QUIET" -eq 0 ] && printf '  %sok%s    %s\n' "$GRN" "$RST" "$label"
        return
    fi
    if [ "$sev" = error ]; then
        printf '\n  %sERROR%s %3d  %s\n' "$RED" "$RST" "$n" "$label"
        errors=$((errors + n))
    else
        printf '\n  %sWARN%s  %3d  %s\n' "$YLW" "$RST" "$n" "$label"
        warnings=$((warnings + n))
    fi
    sed 's/^/        /' "$f"
}

# ---------------------------------------------------------------------------
# Build the list of pages to scan: every .html under content/, except the
# author's own markdown folder (which holds sources, not output).
# ---------------------------------------------------------------------------
# -H so a content/ that is a SYMLINK to the real bundle is followed. Not -L:
# that would follow links inside the tree too, and a link pointing back up it
# would walk forever.
find -H "$SITE_DIR" -path "$MEDIA_DIR" -prune -o -type f -name '*.html' -print 2>/dev/null \
  | sort > "$TMP/pages"
page_count=$(wc -l < "$TMP/pages")

# A directory that exists but holds no HTML is not a clean site, it is a site
# that was never built - wrong working directory, a build that failed, a bundle
# written somewhere else. Reporting "All checks passed" and exiting 0 on that is
# the worst thing this script can do, because healthcheck.bat advertises the
# exit code as a deploy gate. Same class of usage error as a bad option, so the
# same exit code.
if [ "$page_count" -eq 0 ]; then
    printf '%s: no HTML found under %s/ - build the site first.\n' "${0##*/}" "$SITE_DIR" >&2
    printf '%s\n' "  (the folder exists, so there is nothing to check rather than nothing wrong)" >&2
    exit 2
fi

printf '\n%sEncyclopaedia - site health check%s\n' "$BLD" "$RST"
printf '%s%d pages, %s%s\n\n' "$DIM" "$page_count" "$(echo $CSS_FILES | tr ' ' ',')" "$RST"

# ---------------------------------------------------------------------------
# Extract every local reference as: file<TAB>line<TAB>url
#
# Skipped later: absolute URLs, protocol-relative, data:, mailto:, tel:,
# javascript:, bare #anchors, and url(#id) SVG gradient references.
# ---------------------------------------------------------------------------
: > "$TMP/refs"
: > "$TMP/cardrefs"
: > "$TMP/imgrefs"

while IFS= read -r f; do
    # src="...", href="..." and poster="...", both quote styles.
    grep -noE "(src|href|poster)=\"[^\"]*\"|(src|href|poster)='[^']*'" "$f" 2>/dev/null \
      | sed -E "s/:(src|href|poster)=[\"']/\t/; s/[\"']$//" \
      | awk -F'\t' -v F="$f" 'NF==2 {print F "\t" $1 "\t" $2}' >> "$TMP/refs"

    # The subset the browser actually FETCHES when the page opens: src, poster
    # and (below) srcset and CSS url(). An href is deliberately excluded — a
    # link to a photograph costs nothing until someone clicks it. Counting them
    # made the lightbox's <a href> double every gallery image, because media.njk
    # wraps each <img src> in an anchor to the same file.
    grep -noE "(src|poster)=\"[^\"]*\"|(src|poster)='[^']*'" "$f" 2>/dev/null \
      | sed -E "s/:(src|poster)=[\"']/\t/; s/[\"']$//" \
      | awk -F'\t' -v F="$f" 'NF==2 {print F "\t" $1 "\t" $2}' >> "$TMP/imgrefs"

    # srcset="a.jpg 1x, b.jpg 2x" -> one row per candidate, descriptor dropped
    grep -noE "srcset=\"[^\"]*\"|srcset='[^']*'" "$f" 2>/dev/null \
      | sed -E "s/:srcset=[\"']/\t/; s/[\"']$//" \
      | awk -F'\t' -v F="$f" 'NF==2 {
            n = split($2, parts, ",")
            for (i = 1; i <= n; i++) {
                split(parts[i], tok, " ")
                gsub(/^[ \t]+|[ \t]+$/, "", tok[1])
                if (tok[1] != "") print F "\t" $1 "\t" tok[1]
            }
        }' | tee -a "$TMP/imgrefs" >> "$TMP/refs"

    # url(...) inside inline style attributes
    grep -noE "url\(['\"]?[^)'\"]+['\"]?\)" "$f" 2>/dev/null \
      | sed -E "s/:url\(['\"]?/\t/; s/['\"]?\)$//" \
      | awk -F'\t' -v F="$f" 'NF==2 {print F "\t" $1 "\t" $2}' \
      | tee -a "$TMP/imgrefs" >> "$TMP/refs"

    # Card images, read out of the built HTML rather than guessed from a
    # filename. The generator uses a file called thumbnail.* when there is one
    # and otherwise picks an image out of the folder, so "is it named
    # thumbnail.*" stopped being the same question as "is it loaded on every
    # card" — which is the thing the budget below is actually about.
    #
    # The <img> follows the card__thumb div rather than sharing its line, so
    # this carries a flag for a few lines instead of matching one pattern.
    awk -v F="$f" '
        /class="card__thumb"/ { want = 4; next }
        want > 0 {
            if (match($0, /<img src="[^"]*"/)) {
                u = substr($0, RSTART + 10, RLENGTH - 11)
                print F "\t" NR "\t" u
                want = 0
                next
            }
            want--
        }' "$f" >> "$TMP/cardrefs"
done < "$TMP/pages"

# url(...) in the compiled stylesheets - this is what catches a missing font
# or the topology svg, which no HTML file references directly.
for c in $CSS_FILES; do
    [ -f "$c" ] || continue
    grep -noE "url\(['\"]?[^)'\"]+['\"]?\)" "$c" 2>/dev/null \
      | sed -E "s/:url\(['\"]?/\t/; s/['\"]?\)$//" \
      | awk -F'\t' -v F="$c" 'NF==2 {print F "\t" $1 "\t" $2}' >> "$TMP/refs"
done

# ---------------------------------------------------------------------------
# Check A + B: resolve each reference.
# ---------------------------------------------------------------------------
: > "$TMP/missing"
: > "$TMP/case"

# resolve_ci <relative path> - echo the real on-disk path if every component
# matches case-insensitively, echo nothing otherwise.
#
# Called only after an exact -e test has already failed, so a hit means the
# reference differs from the file on disk by casing alone: fine locally, a 404
# on a case-sensitive host. Walking component by component rather than probing
# the basename is what catches a wrong-cased *directory*, which would otherwise
# be reported as a missing file and point at the wrong fix.
resolve_ci() {
    local rest=${1#./} cur=. seg hit
    while [ -n "$rest" ]; do
        seg=${rest%%/*}
        if [ "$seg" = "$rest" ]; then rest=; else rest=${rest#*/}; fi
        case "$seg" in
            ''|.) continue ;;
            ..)   cur=$cur/..; continue ;;
        esac
        hit=$(ls -A "$cur" 2>/dev/null | awk -v s="$seg" 'tolower($0) == tolower(s) { print; exit }')
        [ -z "$hit" ] && return
        cur=$cur/$hit
    done
    [ -e "$cur" ] && printf '%s\n' "$cur"
}

# norm_path <path> - collapse . and .. segments, so two references that reach
# the same file by different routes compare equal. Pure builtins, no fork: the
# same reason resolve_ci walks components by hand.
norm_path() {
    local rest=$1 seg out=
    while [ -n "$rest" ]; do
        seg=${rest%%/*}
        if [ "$seg" = "$rest" ]; then rest=; else rest=${rest#*/}; fi
        case "$seg" in
            ''|.) continue ;;
            ..)   out=${out%/*} ;;
            *)    out=$out/$seg ;;
        esac
    done
    printf '%s\n' "${out#/}"
}

# URLs are percent-encoded in the HTML (folder names may contain spaces or
# accents), so they have to be decoded before they can be tested against disk.
#
# Everything in this loop is a shell builtin. With tens of thousands of
# references, one fork per iteration - a $(dirname) or a $(urldecode) - is the
# difference between two seconds and twenty minutes. `printf -v` assigns
# without a subshell; `${f%/*}` is dirname without a subshell.
while IFS=$'\t' read -r f line url; do
    [ -z "$url" ] && continue
    case "$url" in
        http://*|https://*|//*|data:*|mailto:*|tel:*|javascript:*|\#*|'') continue ;;
    esac

    clean=${url%%\#*}          # drop #fragment
    clean=${clean%%\?*}        # drop ?query
    [ -z "$clean" ] && continue
    printf -v clean '%b' "${clean//%/\\x}"

    if [ "${clean#/}" != "$clean" ]; then
        path="./${SITE_DIR}${clean}"   # site-absolute (shouldn't occur, but be safe)
    else
        path="${f%/*}/${clean}"        # relative to the containing file
    fi

    [ -e "$path" ] && continue

    # Exists under different casing? Fine on Windows, 404 on a Linux host.
    # One line per finding - section() counts with wc -l, so a two-line entry
    # would be reported and charged to the error count twice.
    hit=$(resolve_ci "$path")
    if [ -n "$hit" ]; then
        printf '%s:%s  %s  ->  exists as %s\n' "$f" "$line" "$url" "${hit#./}" >> "$TMP/case"
    else
        printf '%s:%s  %s\n' "$f" "$line" "$url" >> "$TMP/missing"
    fi
done < "$TMP/refs"

sort -u -o "$TMP/missing" "$TMP/missing"
sort -u -o "$TMP/case" "$TMP/case"

# ---------------------------------------------------------------------------
# Check C: size budgets, over the media folder.
# ---------------------------------------------------------------------------
: > "$TMP/big_img"
: > "$TMP/big_svg"
: > "$TMP/big_thumb"

if [ -d "$MEDIA_DIR" ]; then
    find -H "$MEDIA_DIR" -type f \
        \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.gif' -o -iname '*.webp' \) \
        -size +$((IMG_MAX_KB))k -print 2>/dev/null \
      | while IFS= read -r img; do
            printf '%6d KB  %s\n' "$(( $(stat -c%s "$img") / 1024 ))" "$img" >> "$TMP/big_img"
        done

    find -H "$MEDIA_DIR" -type f -iname '*.svg' -size +$((SVG_MAX_KB))k -print 2>/dev/null \
      | while IFS= read -r s; do
            printf '%6d KB  %s\n' "$(( $(stat -c%s "$s") / 1024 ))" "$s" >> "$TMP/big_svg"
        done

fi

# A card image loads on every card that shows it, so its budget is far tighter
# than a full-size image opened on demand.
#
# Driven off $TMP/cardrefs — what the pages actually reference — not off files
# named thumbnail.*. Since the generator falls back to any image in the folder,
# the filename test missed every auto-picked card image, which is now the common
# case rather than the exception.
#
# Deduped by resolved path: one image can be the card for dozens of pages, and
# it is one file to fix.
declare -A card_seen=()
while IFS=$'\t' read -r cf cline curl; do
    case "$curl" in
        http://*|https://*|//*|data:*|'') continue ;;
    esac
    c=${curl%%\#*}; c=${c%%\?*}
    [ -z "$c" ] && continue
    printf -v c '%b' "${c//%/\\x}"
    if [ "${c#/}" != "$c" ]; then cp_="./${SITE_DIR}${c}"; else cp_="${cf%/*}/${c}"; fi
    # Normalised before the dedupe, or the same image reached from two folder
    # depths counts twice and the list reads far worse than the truth.
    cp_=$(norm_path "$cp_")
    [ -n "${card_seen[$cp_]+set}" ] && continue
    card_seen[$cp_]=1
    [ -f "$cp_" ] || continue
    ckb=$(( $(stat -c%s "$cp_") / 1024 ))
    [ "$ckb" -gt "$THUMB_MAX_KB" ] && printf '%6d KB  %s\n' "$ckb" "$cp_" >> "$TMP/big_thumb"
done < "$TMP/cardrefs"

sort -rn -o "$TMP/big_img"   "$TMP/big_img"   2>/dev/null
sort -rn -o "$TMP/big_svg"   "$TMP/big_svg"   2>/dev/null
sort -rn -o "$TMP/big_thumb" "$TMP/big_thumb" 2>/dev/null

# Per-page total image weight.
#
# One pass over the reference list, accumulating into an associative array,
# rather than re-reading the whole list once per page. With 784 pages and
# 40k references the nested form is 31 million iterations; this is 40 thousand.
#
# Reads $TMP/imgrefs, not $TMP/refs: only what the browser fetches on load
# counts as page weight. See the note where imgrefs is built.
: > "$TMP/heavy"
declare -A page_bytes=()
declare -A file_size=()
declare -A page_seen=()

while IFS=$'\t' read -r rf rline rurl; do
    case "$rurl" in
        http://*|https://*|//*|data:*|mailto:*|tel:*|javascript:*|\#*|'') continue ;;
    esac
    # Strip #fragment/?query first, then match the extension case-
    # insensitively: mixed-case extensions are real in user content.
    c=${rurl%%\#*}; c=${c%%\?*}
    case "${c##*.}" in
        [jJ][pP][gG]|[jJ][pP][eE][gG]|[pP][nN][gG]|[gG][iI][fF]|[wW][eE][bB][pP]|[sS][vV][gG]) ;;
        *) continue ;;
    esac
    printf -v c '%b' "${c//%/\\x}"
    if [ "${c#/}" != "$c" ]; then p="./${SITE_DIR}${c}"; else p="${rf%/*}/${c}"; fi

    # stat() each distinct file once; the same image recurs on many pages.
    if [ -z "${file_size[$p]+set}" ]; then
        if [ -f "$p" ]; then file_size[$p]=$(stat -c%s "$p"); else file_size[$p]=0; fi
    fi
    # ...and charge it to a page only once. The browser downloads a given URL
    # once however many times the page names it.
    [ -n "${page_seen[$rf$'\t'$p]+set}" ] && continue
    page_seen[$rf$'\t'$p]=1
    page_bytes[$rf]=$(( ${page_bytes[$rf]:-0} + ${file_size[$p]} ))
done < "$TMP/imgrefs"

for pg in "${!page_bytes[@]}"; do
    kb=$(( page_bytes[$pg] / 1024 ))
    [ "$kb" -gt "$PAGE_IMG_MAX_KB" ] && printf '%6d KB  %s\n' "$kb" "$pg" >> "$TMP/heavy"
done
sort -rn -o "$TMP/heavy" "$TMP/heavy" 2>/dev/null

# ---------------------------------------------------------------------------
# Report.
# ---------------------------------------------------------------------------
printf '%sReferences%s\n' "$BLD" "$RST"
section "$TMP/missing" "broken references (missing file)"                error
section "$TMP/case"    "case-only mismatch (breaks on a case-sensitive host)" error

printf '\n%sSize budgets%s\n' "$BLD" "$RST"
section "$TMP/big_thumb" "card images over ${THUMB_MAX_KB} kB (loaded on every card)" warn
section "$TMP/big_img"   "images over ${IMG_MAX_KB} kB"                              warn
section "$TMP/big_svg"   "svg over ${SVG_MAX_KB} kB"                                 warn
section "$TMP/heavy"     "pages referencing over ${PAGE_IMG_MAX_KB} kB of images"    warn

printf '\n%s---%s\n' "$DIM" "$RST"
if [ "$errors" -gt 0 ] || [ "$warnings" -gt 0 ]; then
    printf '%d error(s), %d warning(s)\n' "$errors" "$warnings"
    printf '%scontent/page/ and content/index.html are build output - fix findings there\n' "$DIM"
    printf 'in content/input_markdown/, pages/ or eleventy_settings/, then rebuild.\n'
    printf 'Missing media usually means a markdown file names a file that is not beside it.\n'
    printf 'For metadata problems see content/page/status.html.%s\n' "$RST"
else
    printf '%sAll checks passed.%s\n' "$GRN" "$RST"
fi

[ "$errors" -gt 0 ] && exit 1
exit 0
