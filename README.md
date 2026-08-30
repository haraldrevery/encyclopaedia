# Encyclopaedia

Drop a folder of markdown into `content/input_markdown/`, run one binary, and get
a browsable offline website out of it.

It is built to survive whatever you give it. Unsorted folders, missing YAML,
no dates, no tags, files nested eight levels deep, a folder of unrelated notes
with no titles — none of it breaks the build. You get a lot of "Unknown", and a
[status page](#status) telling you exactly where.

---

## Quick start

1. Put your project inside `content/input_markdown/`.
2. Run the binary — double-click `build.sh` (Linux) or `build.bat` (Windows).
3. Open `content/index.html`.

That's it. No Node, no npm, no `node_modules`, no server. The site works from a
`file://` path, a USB stick or a web host without changing anything.

```
./build.sh                     build content/
./encyclopedia-linux-x64       the same thing, directly
./healthcheck.sh               check links and file sizes afterwards
```

---

## What you get

```
content/
├── input_markdown/          ← YOUR PROJECT. Read, never written to.
│   └── Astronomy/
│       └── Mars/
│           ├── mars_sonnet.md
│           ├── mars_gemini.md
│           └── thumbnail.jpg
├── index.html               ← generated homepage
├── page/                    ← generated, mirroring your folders exactly
│   └── astronomy/
│       ├── index.html
│       ├── tag/water.html
│       └── mars/
│           ├── mars-sonnet.html   ← no index.html here: the folder holds
│           └── mars-gemini.html      one subject, so it IS that page
└── assets/                  ← css, fonts, favicons (from favicon/), lightbox
```

**Your media is never copied.** The generated HTML links back into
`input_markdown/` with relative paths, so a 112 MB project produces about 13 MB
of HTML rather than a 119 MB duplicate of itself. The whole `content/` folder is
one self-contained, movable thing.

---

## Starting a project

Everything below `content/input_markdown/` is yours, and there is no required
layout — the generator reads whatever it is given. This is simply the shape that
gets the most out of it.

### A worked example

```
content/input_markdown/
│
├── Topic_x/                    ← a top-level folder becomes a section
│   │                               on the homepage menu
│   ├── article_x/                     ← one folder per subject
│   │   ├── mars.md
│   │   ├── thumbnail.jpg         ← the card image for Mars (keep under 150 kB)
│   │   ├── surface.jpg           ← other images become a lightbox gallery
│   │   ├── valles.png            ←   under the article
│   │   ├── flyby.mp4             ← video and audio get players
│   │   └── dataset.zip           ← anything else becomes a download link
│   │
│   ├── article_y/                  ← three files, all titled "Jupiter":
│   │   ├── jupiter_sonnet.md     ←   one entry with three version tabs,
│   │   ├── jupiter_gemini.md     ←   labelled by their author + version
│   │   ├── jupiter_grok.md
│   │   └── thumbnail.jpg
│   │
│   └── overview.md               ← a loose file is fine — it becomes an entry
│                                   in Astronomy itself
│
├── Topic_y/                  ← spaces, accents and non-Latin names are fine
│   └── Category_A_x/
│       └── Category_B_y/
│           └── article_y/           ← nest as deep as you like; there is no limit
│               ├── aurora.md
│               └── thumbnail.jpg
│
└── scratch.md                    ← even a file at the very top level works
```

### The three things worth knowing

**One folder per subject.** Media belongs to the *folder*, not to the file, so
every entry in a folder shares its thumbnail and its gallery. Two unrelated
entries in one folder would show each other's images. Give each subject its own
folder and the question never comes up.

A folder that ends up holding exactly one subject and no subfolders doesn't get
a listing page of its own — it would be a page with a single card on it, and one
extra click between you and the article. The folder becomes the article: it
keeps its name (that is the page title and the breadcrumb), its thumbnail and
its gallery, and the parent links straight through. Eight files sharing one
`title` still count as one subject, so those folders collapse too.

**Files sharing a `title` become version tabs.** That is the only thing that
groups them — not the filename, not the folder. Eight models answering one
prompt, or a v1 and a v2, collapse into a single entry with a tab strip. Change
one file's title and it becomes its own entry instead.

**Everything else is optional.** Dates, tags, categories, thumbnails, even the
frontmatter itself. Missing fields become "Unknown" and are listed on the status
page; they never break a page.

### Naming

- **Filenames become URLs**, lowercased with spaces and punctuation turned into
  hyphens (`My Notes.md` → `my-notes.html`). They only need to be distinct
  within their own folder — two files with the same name in different folders
  are fine.
- **Folder names become breadcrumb labels**, with underscores turned into
  spaces (`Natural_Philosophy` → "Natural Philosophy"). Casing is preserved as
  you typed it.
- Sorting is by date, newest first, so filenames need no `01_`, `02_` prefixes.

### YAML to copy

The full form — every field the generator reads:

```yaml
---
title: Jupiter
tags: [gas giant, storms, moons]
date: 2026-03-08
description: The largest planet in the solar system, and its four great moons.
author: Claude Sonnet
version: 1
category: [Astronomy, Planetary Science]
---

Your markdown starts here.
```

The minimal form. This is a complete, valid file:

```markdown
# Jupiter

The largest planet in the solar system, and its four great moons.
```

It produces a page titled "Jupiter" with that first sentence as its
description, filed under "Misc.", with the author, version and date shown as
"Unknown". Add fields as you have them — there is no need to fill in a template
with placeholder values, and a field left out is better than a field filled with
"TODO".

Single values don't need brackets, and a comma-separated list works too, so all
three of these are read the same way:

```yaml
tags: [storms, moons]
tags: storms, moons
tags: storms
```

---

## Frontmatter

All seven fields are optional. This is the complete list:

```yaml
---
title: Mars
tags: [planet, water, dust storms]
date: 2026-02-14
description: The red planet — its ancient water and towering volcanoes.
author: Claude Sonnet
version: 1
category: [Astronomy, Planetary Science]
---
```

### What happens when a field is missing

| Field | If absent |
|---|---|
| `title` | the first `#` heading, else the first `##`, else `-no title-` |
| `tags` | omitted — tags are genuinely optional |
| `date` | **"Unknown"**, and the entry sorts after everything dated |
| `description` | the opening sentences of the document, trimmed to ~200 characters |
| `author` | "Unknown" |
| `version` | "Unknown" |
| `category` | "Misc." |

Every one of those fallbacks is recorded and listed on the status page. Nothing
is guessed silently.

**A missing date never becomes the build date.** This matters more than it
sounds: it is what makes two builds of the same content produce byte-identical
output.

Older files using `llm_Model` / `prompt_version` still work — they are read as
`author` / `version`. `model` is also accepted for `author`.

Fields are forgiving about shape. `tags: a, b, c` and `tags: [a, b, c]` and
`tags: single` all work; so does a scalar `category`. Malformed YAML doesn't stop
the build — the file is read as plain markdown and flagged on the status page.

---

## How your folders become the site

**Every folder becomes a page, at any depth.** There is no nesting limit and no
special meaning attached to any level. Breadcrumbs are the folder path, so they
cannot be wrong.

**Files in one folder that share a `title` become version tabs of one entry.**
Eight models answering the same prompt, or a v1 and a v2, collapse into a single
entry with a tab strip. Files with different titles stay separate entries.

Untitled files are never grouped — otherwise a folder of unlabelled notes would
collapse into a single page.

**Media beside a document is picked up automatically:**

| File | Becomes |
|---|---|
| `thumbnail.*` | the card image for that folder |
| other images | a lightbox gallery under the article |
| video / audio | players under the article |
| anything else | a download list |

**A folder with no `thumbnail.*` uses one of its own images instead.** Drop some
photographs into a folder and its cards stop being placeholders — no naming
convention required. Three things worth knowing about the choice:

- **`thumbnail.*` always wins.** Name a file that and nothing else is considered.
- **Only images under 150 kB are candidates**, the same budget an explicit
  thumbnail is held to, because a card image is loaded on every card that shows
  it and your media is linked at full size, never resized. If nothing in the
  folder is under budget the smallest image is used and the
  [status page](#status) says so.
- **The pick is arbitrary but fixed.** It is a hash of the folder path and the
  document's own name, not a random draw, so it never changes between builds and
  a folder of several documents gets several different pictures rather than the
  same one repeated.

Since media belongs to the folder rather than to any one file (see above), an
auto-picked image will not necessarily depict the document it appears on. One
folder per subject and the question doesn't come up — or add a `thumbnail.*` and
take the choice back.

Failing all of that, a folder borrows a card image from the first subfolder that
has one, so a tidy project never shows a wall of placeholders.

Images written inline in your markdown work too, including Obsidian's
`![[filename.jpg]]` embeds, and every image gets a click-to-zoom lightbox.

### Math

`$inline$` and `$$display$$` (and `\(…\)` / `\[…\]`) are rendered by KaTeX at
build time, into MathML. **No KaTeX CSS or JavaScript is served** — the equations
are just part of the HTML. Expressions KaTeX can't parse render in red and are
listed on the status page.

---

## Status

Two separate checks, because they answer different questions.

### `content/page/status.html` — your build

Generated every build; linked from the footer, not the navigation bar.

It opens with how many pages the build wrote — documents, folder listings, tag
pages and the handful of site pages — because nothing else on the page tells you
a site came out of it. Then it reports what the generator had to guess: files
whose body could not be rendered at all, settings it could not use, which files
are missing which fields, empty folders, media nothing links to, oversized
thumbnails, duplicate titles, URLs that needed renaming, and math that failed to
parse.

**Every finding that has a page to point at is a link.** Click a path and the
page it produced opens in a new tab, so you can see what a missing title or a
failed equation actually looks like instead of going hunting for it. (Settings
findings are about a file rather than a page, so those are plain text.) Findings about media open the file itself;
a folder that produces no page links to its parent, which is where the gap
shows.

None of it stops a build. It's a to-do list, ordered by how much it matters.
About and Legal are counted in the page total but not diagnosed — they are site
chrome, not your project.

### `./healthcheck.sh` / `healthcheck.bat` — your links and file sizes

Run after building. Checks the finished HTML for:

- **broken references** — every `src`, `href`, `poster`, `srcset` candidate and
  CSS `url()`, resolved against disk
- **case-only mismatches** — a path that works on Windows and 404s on a
  case-sensitive host. This is why there are two scripts rather than one: on
  NTFS the filesystem resolves the path happily, so the check has to compare
  against the real directory listing instead of asking.
- **size budgets** — card images over 150 kB (they load on every card, and are
  read from the built pages, so an auto-picked one counts too), images
  over 850 kB, and pages carrying more than 8 MB of images

```
./healthcheck.sh                    full report on content/
./healthcheck.sh --quiet            only what it found
./healthcheck.sh ~/Notes/Cooking    check a bundle somewhere else
./healthcheck.sh --help             usage and current thresholds
```

The bundle is chosen the same way the generator chooses it: the argument, then
`ENCYCLOPEDIA_BUNDLE`, then `content/`. So `./build.sh ~/Notes/Cooking` and
`./healthcheck.sh ~/Notes/Cooking` are a pair, and neither has to be told twice.

Thresholds are environment variables: `THUMB_MAX_KB=80 ./healthcheck.sh`.
It never writes, moves or deletes anything, and it exits

- `0` clean, or warnings only
- `1` errors found
- `2` it could not check — bad usage, or the bundle holds no built pages

so it can gate a deploy. Note the last one: a bundle that exists but is empty
means the site was never built, and that is reported rather than passed.

---

## Settings

`site_settings.json`, beside `build.sh`. It is read **every build**, so the
standalone binary picks up a change without being recompiled.

```json
{
  "name": "Encyclopaedia",
  "shortName": "Encyclopaedia",
  "description": "An offline-first reference generated from a folder of markdown.",

  "url": "",
  "lang": "en-GB",

  "themeColor": "#000000",
  "backgroundColor": "#ffffff",

  "maxPostsPerPage": 60,

  "nav": [
    { "label": "Home",  "link": "/index.html",    "order": 1 },
    { "label": "Index", "link": "/page/all.html", "order": 2 }
  ],

  "footerLinks": [
    { "label": "Home",       "link": "/index.html",       "order": 1 },
    { "label": "Full index", "link": "/page/all.html",    "order": 2 },
    { "label": "About",      "link": "/about.html",       "order": 3 },
    { "label": "Legal",      "link": "/legal.html",       "order": 4 },
    { "label": "Status",     "link": "/page/status.html", "order": 5 }
  ]
}
```

| Field | What it does |
|---|---|
| `name` | the `<title>`, the homepage hero, the footer, the web app manifest |
| `shortName` | the wordmark in the nav bar, and the manifest's `short_name` |
| `description` | the homepage subtitle and the `<meta name="description">` |
| `url` | **optional.** See below |
| `lang` | `<html lang>` **and the date format** |
| `themeColor` · `backgroundColor` | the manifest and the browser chrome |
| `maxPostsPerPage` | cards per folder page and per facet page (1–1000) |
| `nav` | the desktop bar and the mobile menu |
| `footerLinks` | the footer row — its own list, because it usually holds more |

**Every field is optional.** Leave one out and the built-in default is used, so
a file holding nothing but `{ "name": "My Notes" }` is perfectly valid. Delete
the file entirely and you get the defaults throughout.

**Nothing in this file can break your build.** A syntax error, a number where a
string belongs, a nav entry with no link — each falls back to its default and is
listed under *Settings* on the [status page](#status). That is the only place
you will hear about it, so it is worth a glance after an edit.

### Links

`link` is written from the root of the site, `/page/all.html` rather than
`../../page/all.html` — the generator rewrites it relative to whatever page it is
rendering, which is what lets the output work from a `file://` path. A full
`https://…` URL is left alone and opens in a new tab.

`order` sorts the list. Ties, and entries with no `order` at all, keep the order
they were written in.

### `lang` also sets the date format

`"en-GB"` gives `26 Aug 2026`; `"en-US"` gives `Aug 26, 2026`; `"de-DE"` gives
`26. Aug. 2026`. This is why the default is `en-GB` and not a bare `en`.

### `url` — only if you host it

Left empty (the default), every URL the site emits is relative and the output
works from a folder, a USB stick or a web host without a rebuild.

Set it to the address the site actually lives at and each page additionally gets
a `<link rel="canonical">` and Open Graph tags, so links preview properly when
shared. Set it to a domain that isn't yours and you are telling search engines
your pages belong to someone else — which is why it ships empty.

### Icons

The favicon and app-icon source files live in `favicon/`. Replace them in place,
keeping the filenames; they are copied to `assets/` on build. `site.webmanifest`
is **generated** from the settings above, so don't add one to that folder.

---

## Several projects at once

Point the binary at any folder containing an `input_markdown/` subfolder:

```
./encyclopedia-linux-x64 ~/Notes/CookingBundle
```

The site is written **inside that folder**, because media is linked rather than
copied and those links have to stay relative. Each bundle is independently
movable. If `input_markdown/` doesn't exist yet, it is created and you get an
empty site telling you where to put your files.

`site_settings.json`, `favicon/` and `input_about_legal/` are **not** part of a
bundle — they are read from the folder you run the binary in, so every bundle
built from here shares one name, one navigation and one set of icons.

**Run the binary from the project folder**, whichever bundle you point it at.
It carries the config, but the templates it renders — `pages/`,
`eleventy_settings/`, `css/`, `fonts/`, `svg/`, `javascript/` — are read from
the working directory, so it needs to be able to see them. Run it anywhere else
and it says so and stops. (It used to write nothing at all and exit 0, which
looked like a successful build of an empty site.)

To give a bundle its own name, navigation and icons, copy the **whole project
folder** and edit the copy's `site_settings.json`, `favicon/` and
`input_about_legal/` — not just those three files on their own.

---

## Changing the look or the logic

Run `./dev.sh` (or `dev.bat`). It starts the Tailwind watchers and a server,
and it never downloads anything — with `node_modules` present you get
Eleventy's dev server with live reload; without it, it falls back to the
standalone binary and rebuilds on change, and you refresh the browser yourself.

npm is optional here, and live reload is the only thing it buys you:

```
npm install
npm start          # dev server with live reload at localhost:8080
```

| To change | Edit | Then |
|---|---|---|
| colours, fonts, spacing | `css/theme.css` | rebuild CSS |
| layout, components | `css/input.css` | rebuild CSS |
| article typography | `css/input_prose.css` | rebuild CSS |
| page structure | `pages/*.njk`, `eleventy_settings/*.njk` | rebuild the binary |
| how content is read | `lib/*.js` | rebuild the binary |

**Rebuild CSS** (Tailwind v4 standalone binary, no npm):

```
npm run css
```

**Rebuild the binaries** (needs [Bun](https://bun.sh), compile-time only):

```
./eleventy_binary/compile.sh
```

You only need this when `eleventy.config.js`, `lib/` or a dependency changes.
Templates and content are read from disk at run time, so editing a `.njk` file
or your markdown never requires a recompile.

### Why binaries instead of npm

Borrowed wholesale from the sibling project: npm means depending on a lot of
servers and a lot of code you have not read. Compile something that works, keep
it, and only reach for npm when the logic itself needs to change.

`eleventy_binary/build.mjs` bundles Eleventy, the config, markdown-it, KaTeX and
gray-matter into one executable. There is one non-obvious piece: Eleventy locates
its own `package.json` relative to `import.meta.url`, which collapses to
`/package.json` inside a compiled bundle. A bundler plugin patches that single
lookup. Don't call `bun build --compile` directly.

---

## Design

The look is ported from `website_v3_014`, which is where the aesthetic comes
from. Every token lives in `css/theme.css`.

- One custom typeface in a single weight. **Nothing is ever bold** — emphasis is
  a thin underline.
- Uppercase, widely tracked, `1.22rem` root size.
- Percentage-width containers (88%, 75% above 900px) rather than max-widths.
- Dark mode follows `prefers-color-scheme`. There is no toggle and no `.dark`
  class.
- Motion is CSS-only and every effect has a `@supports` fallback and a
  `prefers-reduced-motion` off-switch.

### Reading width

On an entry page, move the pointer into the lower-right corner: a `><` button
fades in above the outline button. Each click narrows the article column a step
(100% → 75% → 55% → 40% → 28%); at the narrowest the glyph flips to `<>` and the
next click returns to full width. The choice is remembered as you browse.

Desktop only — it never appears on a touch device, and a width saved on a
desktop cannot follow you onto a phone. With JavaScript off the button does not
exist and the column is full width.

### Search

The box in the nav searches titles, summaries, tags, categories and authors —
not the body text, which is what Ctrl+F on the entry itself is for. Results drop
down as you type; arrow keys move through them and Enter opens one.

The index (`assets/search-index.js`, one line per entry) is not loaded with the
page. It is pulled in the first time you focus the box, as a `<script>` tag
rather than a `fetch()` — `fetch()` is blocked on `file://`, and a search that
only worked over HTTP would break the one promise the whole build is arranged
around. That is also why Pagefind, lunr and the rest are not used here: they all
fetch their index.

**With JavaScript off the box is not there at all**, and the nav is what it was
before: Home and the full index, with Ctrl+F over `page/all.html`. It is hidden
by the stylesheet and revealed only by a one-liner in the `<head>`, so it also
stays hidden when scripts are blocked by an extension or by devtools rather than
by the browser's own setting — cases a `<noscript>` rule silently misses.

The JavaScript on the site is GLightbox for image zooming, the reading-width
toggle, and search. The mobile menu, the article outline and the tag filters are
all CSS.

---

## Layout of this repo

```
lib/            the generator
  bundle.js       where the content bundle lives
  paths.js        slugs, relative links, media classification
  normalise.js    the frontmatter safety net
  scan.js         the recursive folder walk
  markdown.js     markdown-it + KaTeX + lightbox
  library.js      turns the scan into page lists
  search.js       builds the nav search index
  site.js         defaults + validation for site_settings.json
site_settings.json  name, nav, page size — the file you actually edit
favicon/        the favicon and app-icon source files
javascript/     reading_width.js, search.js, glightbox.min.js (shipped scripts)
pages/          one template per kind of page
eleventy_settings/  shared includes
css/            stylesheets
  theme.css · input.css · input_prose.css     sources
  main.css · prose.css                        compiled, published to assets/
  glightbox.min.css                           vendor
eleventy_binary/    Bun compile scripts
content/            the bundle you distribute
```

`content/input_markdown/_edge_cases/` is a deliberately awkward test corpus —
empty files, malformed YAML, six-deep nesting, unicode folder names, broken
image references. Delete it whenever you like; it exists to prove the generator
copes.

---

## Known limitations

- `healthcheck.ps1` was written to mirror `healthcheck.sh` exactly but has not
  been run on Windows.
- `healthcheck.sh` needs bash 4+ and GNU `stat`, so it runs on Linux but not on
  a stock macOS. Use `healthcheck.ps1` on Windows.
- Markdown is trusted. Front matter can no longer execute code — only YAML is
  accepted, and a `---js` header is refused, reported, and kept out of the
  rendered body — but raw HTML in a document body is still passed through to
  the page, so building a folder somebody else wrote means trusting what is in
  it. Filenames are a separate matter and are escaped: a file can be named
  anything at all without its name becoming markup.
- The homepage lists every category in the whole project. On a very large,
  very varied collection that is a long row of pills.
- A folder only publishes a tag or category page where that facet actually
  narrows something down — at least two entries, and fewer than the folder
  already lists. Anything below that is a page with one card on it, or a copy
  of the folder listing. The root is the exception and keeps a page for every
  value, so a tag pill always has somewhere to go; on an article, pills point
  at the nearest folder where the facet separates one thing from another,
  which may be several levels up.

---

## Licence

Two licences, because there are two kinds of thing in this repository.

**The code is MIT.** The generator — `lib/`, `pages/`, `eleventy_settings/`,
`eleventy.config.js`, the authored stylesheets and scripts, the build tooling —
is yours to use, modify and redistribute, commercially or not, so long as the
notice stays with it.

**The assets are not.** The HaraldRevery typefaces in `fonts/`, the artwork in
`svg/` and `favicon/`, the portrait and prose in `input_about_legal/`, and the
published writing are © 2025–2026 Harald Mark Thirslund, all rights reserved.
They are here so the site builds as designed, not to be reused.

**If you fork this, bring your own typeface.** Replace the files in `fonts/`,
then edit the two `@font-face` blocks in `css/theme.css` and the two preload
links in `eleventy_settings/base.njk`. Both stacks fall back to `sans-serif` and
`monospace`, so an unedited fork still renders — just in your browser's defaults.

See [LICENCE.md](LICENCE.md) for the full terms and
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for the open-source components
this is built from. If you distribute a compiled binary, carry that second file
with it — the executable statically embeds the whole dependency tree and the Bun
runtime.
