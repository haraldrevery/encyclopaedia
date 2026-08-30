<#
-----------------------------------------------------------------------------
healthcheck.ps1 - report-only sanity scan of the built site.

  .\healthcheck.ps1            full report
  .\healthcheck.ps1 -Quiet     only sections that found something
  .\healthcheck.ps1 C:\Notes  check a bundle somewhere else
  .\healthcheck.ps1 -Help      usage and current thresholds

The Windows twin of healthcheck.sh. Same scope, same thresholds, same
findings, same exit codes. If you change one, change the other.

Why two scripts rather than one: check B looks for references that differ from
the file on disk by casing alone. On NTFS such a reference resolves happily, so
a shell test can never see the problem - and Windows is exactly where those
references get created. This script therefore compares against the real
directory listing instead of asking the filesystem to resolve the path.

Never writes, moves or deletes anything. Exit 1 if errors found, 2 on bad usage.
Requires PowerShell 5.1 or later.
-----------------------------------------------------------------------------
#>

[CmdletBinding()]
param(
    # The folder holding input_markdown/. Mirrors healthcheck.sh: the generator
    # can be pointed at another bundle, and checking 'content' regardless meant
    # reporting on the wrong folder.
    [Parameter(Position = 0)]
    [string]$Bundle,
    [switch]$Quiet,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# --- thresholds (override from the environment, e.g. $env:IMG_MAX_KB = 500) --
function Get-Threshold($name, $fallback) {
    $v = [Environment]::GetEnvironmentVariable($name)
    if ($v -and ($v -as [int])) { return [int]$v }
    return $fallback
}
$IMG_MAX_KB      = Get-Threshold 'IMG_MAX_KB'      850
$SVG_MAX_KB      = Get-Threshold 'SVG_MAX_KB'      500
$THUMB_MAX_KB    = Get-Threshold 'THUMB_MAX_KB'    150
$PAGE_IMG_MAX_KB = Get-Threshold 'PAGE_IMG_MAX_KB' 8000

# --- scope -------------------------------------------------------------------
# Argument, then environment, then the default - the same order of precedence
# the generator itself uses.
$DEFAULT_BUNDLE = 'content'
$SITE_DIR = if ($Bundle) { $Bundle }
            elseif ($env:ENCYCLOPEDIA_BUNDLE) { $env:ENCYCLOPEDIA_BUNDLE }
            else { $DEFAULT_BUNDLE }
$SITE_DIR  = $SITE_DIR.TrimEnd('\', '/')
$MEDIA_DIR = Join-Path $SITE_DIR 'input_markdown'
$CSS_FILES = @((Join-Path $SITE_DIR 'assets\main.css'), (Join-Path $SITE_DIR 'assets\prose.css'))

# What a site-absolute reference ("/assets/main.css") resolves against. An
# absolute bundle must not get '.\' glued to the front - the same trap
# healthcheck.sh has in norm_path/SITE_ROOT.
$SITE_ROOT = if ([System.IO.Path]::IsPathRooted($SITE_DIR)) { $SITE_DIR }
             else { Join-Path '.' $SITE_DIR }

if ($Help) {
    Write-Host "usage: healthcheck.ps1 [-Quiet] [bundle]`n"
    Write-Host "  bundle   the folder holding input_markdown\ (default: $DEFAULT_BUNDLE)"
    Write-Host "  -Quiet   print only the sections that found something"
    Write-Host "  -Help    this message`n"
    Write-Host "Thresholds can be overridden from the environment:"
    Write-Host ("  IMG_MAX_KB={0}  SVG_MAX_KB={1}  THUMB_MAX_KB={2}  PAGE_IMG_MAX_KB={3}" -f `
        $IMG_MAX_KB, $SVG_MAX_KB, $THUMB_MAX_KB, $PAGE_IMG_MAX_KB)
    exit 0
}

if (-not (Test-Path -LiteralPath $SITE_DIR -PathType Container)) {
    Write-Error "healthcheck.ps1: $SITE_DIR\ not found - build the site first."
    exit 2
}

$script:errors   = 0
$script:warnings = 0

function Write-Section($findings, $label, $severity) {
    $n = @($findings).Count
    if ($n -eq 0) {
        if (-not $Quiet) { Write-Host "  ok    $label" -ForegroundColor Green }
        return
    }
    if ($severity -eq 'error') {
        Write-Host ""
        Write-Host ("  ERROR {0,3}  {1}" -f $n, $label) -ForegroundColor Red
        $script:errors += $n
    } else {
        Write-Host ""
        Write-Host ("  WARN  {0,3}  {1}" -f $n, $label) -ForegroundColor Yellow
        $script:warnings += $n
    }
    foreach ($f in $findings) { Write-Host ("        " + $f) }
}

# -----------------------------------------------------------------------------
# Pages to scan: every .html under content\, excluding the markdown source tree.
# -----------------------------------------------------------------------------
$mediaFull = (Resolve-Path -LiteralPath $MEDIA_DIR -ErrorAction SilentlyContinue)
$pages = Get-ChildItem -LiteralPath $SITE_DIR -Recurse -File -Filter '*.html' |
    Where-Object { -not ($mediaFull -and $_.FullName.StartsWith($mediaFull.Path, 'OrdinalIgnoreCase')) } |
    Sort-Object FullName

# A folder that exists but holds no HTML is not a clean site, it is a site that
# was never built - wrong working directory, a failed build, a bundle written
# somewhere else. Reporting "All checks passed" and exiting 0 on that is the
# worst thing this script can do, because healthcheck.bat advertises the exit
# code as a deploy gate. Same class of usage error as a bad switch, so the same
# exit code. Matches the bash twin.
if (@($pages).Count -eq 0) {
    Write-Error "healthcheck.ps1: no HTML found under $SITE_DIR\ - build the site first."
    Write-Host "  (the folder exists, so there is nothing to check rather than nothing wrong)"
    exit 2
}

Write-Host ""
Write-Host "Encyclopaedia - site health check"
Write-Host ("{0} pages, {1}" -f @($pages).Count, ($CSS_FILES -join ','))
Write-Host ""

# -----------------------------------------------------------------------------
# Extract every local reference. Same four sources as the bash twin:
# src/href/poster, each srcset candidate, url() in inline styles, url() in CSS.
# -----------------------------------------------------------------------------
$refs = New-Object System.Collections.Generic.List[object]

# The images the CARDS use, kept apart from $refs because they are budgeted far
# more tightly. Read out of the built HTML rather than guessed from a filename:
# the generator uses thumbnail.* when there is one and otherwise picks an image
# out of the folder, so "named thumbnail.*" is no longer the same question as
# "loaded on every card".
$cardRefs = New-Object System.Collections.Generic.List[object]

# The subset the browser actually FETCHES when the page opens: src, poster,
# srcset and CSS url(). An href is deliberately excluded - a link to a
# photograph costs nothing until someone clicks it. Counting hrefs made the
# lightbox's <a href> double every gallery image, because media.njk wraps each
# <img src> in an anchor to the same file.
$imgRefs = New-Object System.Collections.Generic.List[object]

# -Stylesheet marks a CSS file rather than a page. Its url() references are real
# references and belong in $refs, but they are NOT page weight: charging them
# would make main.css itself appear in "pages referencing over N kB of images",
# which the bash twin never does. The two scripts are meant to produce the same
# findings.
function Add-Refs($file, $text, [switch]$Stylesheet) {
    $lineNo = 0
    # The <img> follows the card__thumb div rather than sharing its line, so the
    # match carries across a few lines instead of matching one pattern.
    $cardWant = 0
    foreach ($line in ($text -split "`r?`n")) {
        $lineNo++

        if ($line -match 'class="card__thumb"') {
            $cardWant = 4
        } elseif ($cardWant -gt 0) {
            $cm = [regex]::Match($line, '<img src="([^"]*)"')
            if ($cm.Success) {
                $cardRefs.Add([pscustomobject]@{ File = $file; Line = $lineNo; Url = $cm.Groups[1].Value })
                $cardWant = 0
            } else {
                $cardWant--
            }
        }

        foreach ($m in [regex]::Matches($line, '(?:src|href|poster)\s*=\s*"([^"]*)"|(?:src|href|poster)\s*=\s*''([^'']*)''')) {
            $u = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
            if ($u) { $refs.Add([pscustomobject]@{ File = $file; Line = $lineNo; Url = $u }) }
        }

        foreach ($m in [regex]::Matches($line, '(?:src|poster)\s*=\s*"([^"]*)"|(?:src|poster)\s*=\s*''([^'']*)''')) {
            $u = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
            if ($u) { $imgRefs.Add([pscustomobject]@{ File = $file; Line = $lineNo; Url = $u }) }
        }

        foreach ($m in [regex]::Matches($line, 'srcset\s*=\s*"([^"]*)"|srcset\s*=\s*''([^'']*)''')) {
            $set = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
            foreach ($cand in ($set -split ',')) {
                $u = ($cand.Trim() -split '\s+')[0]
                if ($u) {
                    $refs.Add([pscustomobject]@{ File = $file; Line = $lineNo; Url = $u })
                    $imgRefs.Add([pscustomobject]@{ File = $file; Line = $lineNo; Url = $u })
                }
            }
        }

        foreach ($m in [regex]::Matches($line, 'url\(\s*[''"]?([^)''"]+)[''"]?\s*\)')) {
            $u = $m.Groups[1].Value
            if ($u) {
                $refs.Add([pscustomobject]@{ File = $file; Line = $lineNo; Url = $u })
                if (-not $Stylesheet) {
                    $imgRefs.Add([pscustomobject]@{ File = $file; Line = $lineNo; Url = $u })
                }
            }
        }
    }
}

foreach ($p in $pages) { Add-Refs $p.FullName (Get-Content -LiteralPath $p.FullName -Raw) }
foreach ($c in $CSS_FILES) {
    if (Test-Path -LiteralPath $c -PathType Leaf) {
        Add-Refs ((Resolve-Path -LiteralPath $c).Path) (Get-Content -LiteralPath $c -Raw) -Stylesheet
    }
}

# -----------------------------------------------------------------------------
# Check A + B.
#
# Get-DirEntries caches one listing per directory. Resolve-Ci then walks the
# path component by component against those listings, comparing ordinally.
# Never substitute Test-Path here: on NTFS it is case-insensitive, so it would
# report every wrong-cased reference as fine - which is the entire bug this
# script exists to catch.
# -----------------------------------------------------------------------------
$dirCache = @{}
function Get-DirEntries($dir) {
    if ($dirCache.ContainsKey($dir)) { return $dirCache[$dir] }
    $names = @()
    try { $names = @(Get-ChildItem -LiteralPath $dir -Force | ForEach-Object { $_.Name }) } catch { }
    $dirCache[$dir] = $names
    return $names
}

# Walk the path one component at a time against the cached listings, and report
# BOTH what is really on disk and whether every component matched ordinally.
#
# One function rather than two, and this is the whole point of the file. The
# previous split checked case with Split-Path -Leaf, which compares only the
# last component: every parent directory went unchecked, so a reference to
# ..\..\Assets\main.css resolved on NTFS, matched on the leaf "main.css" and
# was reported as fine. A wrong-cased DIRECTORY is exactly as fatal on a
# case-sensitive host as a wrong-cased file, and the bash twin catches it,
# which is what this script exists to match.
#
# Never substitute Test-Path for the ordinal comparison: on NTFS it is
# case-insensitive, so it would call every wrong-cased reference correct.
function Resolve-Ci($path) {
    $parts = $path -split '[\\/]+'
    $cur   = '.'
    $exact = $true
    foreach ($seg in $parts) {
        if ($seg -eq '' -or $seg -eq '.') { continue }
        if ($seg -eq '..') { $cur = Join-Path $cur '..'; continue }
        $entries = Get-DirEntries $cur
        # Ordinal first: a directory may legitimately hold both Foo and foo, and
        # the reference names one of them.
        $hit = $entries | Where-Object { $_ -ceq $seg } | Select-Object -First 1
        if (-not $hit) {
            $hit = $entries | Where-Object { $_ -ieq $seg } | Select-Object -First 1
            if (-not $hit) { return $null }
            $exact = $false
        }
        $cur = Join-Path $cur $hit
    }
    if (-not (Test-Path -LiteralPath $cur)) { return $null }
    return [pscustomobject]@{ Path = $cur; Exact = $exact }
}

$missing = New-Object System.Collections.Generic.List[string]
$caseBad = New-Object System.Collections.Generic.List[string]

foreach ($r in $refs) {
    $u = $r.Url
    if (-not $u) { continue }
    if ($u -match '^(https?:|//|data:|mailto:|tel:|javascript:|#)') { continue }

    $clean = ($u -split '#')[0]
    $clean = ($clean -split '\?')[0]
    if (-not $clean) { continue }
    $clean = [uri]::UnescapeDataString($clean)

    if ($clean.StartsWith('/')) {
        $path = Join-Path $SITE_ROOT $clean.TrimStart('/')
    } else {
        $path = Join-Path (Split-Path -Parent $r.File) $clean
    }

    $found = Resolve-Ci $path
    if ($found -and $found.Exact) { continue }

    $rel = Resolve-Path -LiteralPath $r.File -Relative -ErrorAction SilentlyContinue
    if (-not $rel) { $rel = $r.File }
    $rel = $rel -replace '^\.\\', ''

    if ($found) {
        # One line per finding - the counts are taken from the array length,
        # so a two-line entry would be charged to the error count twice.
        $caseBad.Add(("{0}:{1}  {2}  ->  exists as {3}" -f $rel, $r.Line, $u, ($found.Path -replace '^\.\\', '')))
    } else {
        $missing.Add(("{0}:{1}  {2}" -f $rel, $r.Line, $u))
    }
}

$missing = @($missing | Sort-Object -Unique)
$caseBad = @($caseBad | Sort-Object -Unique)

# -----------------------------------------------------------------------------
# Check C: size budgets.
# -----------------------------------------------------------------------------
$bigImg   = @()
$bigSvg   = @()
$bigThumb = @()

if (Test-Path -LiteralPath $MEDIA_DIR -PathType Container) {
    $media = Get-ChildItem -LiteralPath $MEDIA_DIR -Recurse -File

    $bigImg = @($media |
        Where-Object { $_.Extension -imatch '^\.(jpg|jpeg|png|gif|webp)$' -and $_.Length -gt ($IMG_MAX_KB * 1KB) } |
        Sort-Object Length -Descending |
        ForEach-Object { "{0,6} KB  {1}" -f [int]($_.Length / 1KB), (Resolve-Path -LiteralPath $_.FullName -Relative) })

    $bigSvg = @($media |
        Where-Object { $_.Extension -ieq '.svg' -and $_.Length -gt ($SVG_MAX_KB * 1KB) } |
        Sort-Object Length -Descending |
        ForEach-Object { "{0,6} KB  {1}" -f [int]($_.Length / 1KB), (Resolve-Path -LiteralPath $_.FullName -Relative) })

}

# A card image loads on every card that shows it, so its budget is far tighter
# than a full-size image opened on demand.
#
# Deduped on the RESOLVED path: one image can be the card for dozens of pages
# and is reached by a different number of ../ from each depth, so without
# normalising, one file to fix reads as a dozen findings.
$cardSeen = @{}
$cardRows = New-Object System.Collections.Generic.List[object]
foreach ($r in $cardRefs) {
    $u = $r.Url
    if (-not $u) { continue }
    if ($u -match '^(https?:|//|data:)') { continue }
    $clean = ($u -split '#')[0]; $clean = ($clean -split '\?')[0]
    if (-not $clean) { continue }
    $clean = [uri]::UnescapeDataString($clean)

    if ($clean.StartsWith('/')) {
        $path = Join-Path $SITE_ROOT $clean.TrimStart('/')
    } else {
        $path = Join-Path (Split-Path -Parent $r.File) $clean
    }
    try { $full = [System.IO.Path]::GetFullPath($path) } catch { continue }
    if ($cardSeen.ContainsKey($full)) { continue }
    $cardSeen[$full] = $true
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    $len = (Get-Item -LiteralPath $full).Length
    if ($len -gt ($THUMB_MAX_KB * 1KB)) {
        $shown = Resolve-Path -LiteralPath $full -Relative -ErrorAction SilentlyContinue
        if (-not $shown) { $shown = $full }
        $cardRows.Add([pscustomobject]@{ Len = $len; Text = ("{0,6} KB  {1}" -f [int]($len / 1KB), ($shown -replace '^\.\\', '')) })
    }
}
$bigThumb = @($cardRows | Sort-Object Len -Descending | ForEach-Object { $_.Text })

# Per-page image weight. One pass over the references, accumulating per page;
# each distinct file is measured once because the same image recurs on many.
$pageBytes = @{}
$fileSize  = @{}
$pageSeen  = @{}
foreach ($r in $imgRefs) {
    $u = $r.Url
    if (-not $u -or $u -match '^(https?:|//|data:|mailto:|tel:|javascript:|#)') { continue }
    $clean = ($u -split '#')[0]; $clean = ($clean -split '\?')[0]
    if ($clean -notmatch '\.(jpg|jpeg|png|gif|webp|svg)$') { continue }
    $clean = [uri]::UnescapeDataString($clean)

    if ($clean.StartsWith('/')) {
        $path = Join-Path $SITE_ROOT $clean.TrimStart('/')
    } else {
        $path = Join-Path (Split-Path -Parent $r.File) $clean
    }

    if (-not $fileSize.ContainsKey($path)) {
        $size = 0
        try { if (Test-Path -LiteralPath $path -PathType Leaf) { $size = (Get-Item -LiteralPath $path).Length } } catch { }
        $fileSize[$path] = $size
    }
    # Charge each distinct file to a page once: the browser downloads a given
    # URL once however many times the page names it.
    $seenKey = "$($r.File)`t$path"
    if ($pageSeen.ContainsKey($seenKey)) { continue }
    $pageSeen[$seenKey] = $true
    if (-not $pageBytes.ContainsKey($r.File)) { $pageBytes[$r.File] = 0 }
    $pageBytes[$r.File] += $fileSize[$path]
}

$heavy = @($pageBytes.GetEnumerator() |
    Where-Object { ($_.Value / 1KB) -gt $PAGE_IMG_MAX_KB } |
    Sort-Object Value -Descending |
    ForEach-Object {
        $rel = Resolve-Path -LiteralPath $_.Key -Relative -ErrorAction SilentlyContinue
        if (-not $rel) { $rel = $_.Key }
        "{0,6} KB  {1}" -f [int]($_.Value / 1KB), ($rel -replace '^\.\\', '')
    })

# -----------------------------------------------------------------------------
# Report.
# -----------------------------------------------------------------------------
Write-Host "References"
Write-Section $missing "broken references (missing file)"                     'error'
Write-Section $caseBad "case-only mismatch (breaks on a case-sensitive host)" 'error'

Write-Host ""
Write-Host "Size budgets"
Write-Section $bigThumb "card images over $THUMB_MAX_KB kB (loaded on every card)" 'warn'
Write-Section $bigImg   "images over $IMG_MAX_KB kB"                              'warn'
Write-Section $bigSvg   "svg over $SVG_MAX_KB kB"                                 'warn'
Write-Section $heavy    "pages referencing over $PAGE_IMG_MAX_KB kB of images"    'warn'

Write-Host ""
Write-Host "---"
if ($script:errors -gt 0 -or $script:warnings -gt 0) {
    Write-Host ("{0} error(s), {1} warning(s)" -f $script:errors, $script:warnings)
    Write-Host "$SITE_DIR\page\ and $SITE_DIR\index.html are build output - fix findings there"
    Write-Host "in $MEDIA_DIR\, pages\ or eleventy_settings\, then rebuild."
    Write-Host "Missing media usually means a markdown file names a file that is not beside it."
    Write-Host "For metadata problems see $SITE_DIR\page\status.html."
} else {
    Write-Host "All checks passed." -ForegroundColor Green
}

if ($script:errors -gt 0) { exit 1 }
exit 0
