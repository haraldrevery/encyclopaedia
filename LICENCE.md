# Licence

This repository holds two kinds of material, under two different licences.

**The software is MIT.** Take it, fork it, sell it, no attribution ceremony beyond
keeping the notice.

**The assets are not.** The typefaces, the artwork, the marks and the writing are
the author's own work and are reserved. They are here because the site is built
from them, not because they are being given away.

Read part 2 before you fork.

---

## Part 1 — The software

MIT License

Copyright (c) 2025–2026 Harald Mark Thirslund

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### What "the Software" means here

The MIT grant above covers the parts of this repository that were written as
code for this project:

- `lib/` — the scanner, library model, markdown pipeline and helpers
- `pages/` and `eleventy_settings/` — the Nunjucks templates
- `eleventy_binary/` — the Bun compile scripts
- `eleventy.config.js`
- `css/input.css`, `css/input_prose.css`, `css/theme.css` — the authored stylesheets
- `javascript/nav_reveal.js`, `javascript/reading_width.js`, `javascript/search.js`
- the build and healthcheck scripts: `build.sh`, `build.bat`, `dev.sh`, `dev.bat`,
  `healthcheck.sh`, `healthcheck.bat`, `healthcheck.ps1`
- `README.md`

It does not cover anything listed in part 2, and it does not cover the
third-party code listed in part 3.

---

## Part 2 — The assets and the content

**Copyright © 2025–2026 Harald Mark Thirslund. All rights reserved.**

The following are *not* licensed under part 1. No permission to copy, modify,
redistribute or reuse them is granted by this file, and none is implied by their
presence in a repository whose code is MIT.

### `fonts/` — the HaraldRevery typefaces

`HaraldReveryTextFont` and `HaraldReveryMonoFont`, in all four formats
(`.woff2`, `.woff`, `.ttf`, `.otf`), are original typefaces by Harald Mark
Thirslund. They are included so that this site renders as designed, and are
licensed for display on this site only. All rights reserved. See
[`fonts/FONT-LICENSE.txt`](fonts/FONT-LICENSE.txt).

**If you fork this project, you must supply your own typeface.** Two places
need editing:

1. the two `@font-face` blocks in `css/theme.css`, and the `--font-brand` /
   `--font-mono` custom properties above them
2. the two `<link rel="preload">` tags in `eleventy_settings/base.njk`

Both fall back to `sans-serif` / `monospace`, so removing the font files without
editing anything leaves you with a working site in the browser's default faces.

### `favicon/` and `svg/`

The favicon set and `svg/mountain_topology_summer_2026.svg` are original
artwork. All rights reserved.

### `input_about_legal/`

`profile.jpg` is a personal photograph. The prose of `about.md` and `legal.md`
is the author's writing. All rights reserved. If you fork this project, replace
all three with your own — they are the site's identity, not part of its
machinery.

### `content/input_markdown/`

Whatever the site owner puts in this folder is theirs. In this repository it
holds only example and edge-case material, kept so the generator can be run and
tested straight after cloning; it is illustrative, is in places drafted with the
help of language models, and is not authoritative on any subject.

---

## Part 3 — Third-party software

Some files in this repository were written by other people and are governed by
their own licences, not by part 1:

| File | Origin | Licence |
| --- | --- | --- |
| `javascript/glightbox.min.js` | GLightbox 3.3.1, Biati Digital | MIT |
| `css/glightbox.min.css` | GLightbox 3.3.1, Biati Digital | MIT |
| `css/main.css`, `css/prose.css` | generated output of Tailwind CSS 4.3.1 | MIT |

The build also depends on Eleventy, markdown-it, KaTeX and gray-matter, and the
compiled binaries statically embed those and their full dependency trees along
with the Bun runtime.

Full notices, versions and licence texts are in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). If you redistribute a
compiled binary, that file is the one you need to carry with it.
