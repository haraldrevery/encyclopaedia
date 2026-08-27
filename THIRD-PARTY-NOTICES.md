# Third-party notices

This project is assembled from open-source software. This file records what is
used, at which version, under which licence, and reproduces the notices that
those licences require to travel with the code.

It is organised by *where the code ends up*, because that is what determines
your obligations:

1. **[Vendored files](#1-vendored-files)** — third-party code committed into this
   repository and served to visitors. If you host the built site, you are
   redistributing these.
2. **[Build dependencies](#2-build-dependencies)** — npm packages that run at
   build time. Their output ships; they do not.
3. **[Compiled binaries](#3-compiled-binaries)** — the standalone executables,
   which statically embed everything.

---

## 1. Vendored files

These are committed to the repository and copied into the built site.

### GLightbox 3.3.1

- Files: `javascript/glightbox.min.js`, `css/glightbox.min.css`
  (and their copies under `content/assets/`)
- Author: Biati Digital
- Home: https://github.com/biati-digital/glightbox
- Licence: MIT

The distributed files are minified and carry no banner comment, so the notice is
reproduced here and alongside the script in `javascript/glightbox.LICENSE.txt`:

```
MIT License

Copyright (c) 2019 Biati Digital

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
```

**One note on network requests.** GLightbox's bundle contains default
configuration pointing at `https://cdn.plyr.io/3.6.12/plyr.css` and
`.../plyr.js`, used only when a slide is a video or an embed. This site wires
the lightbox to images alone (`eleventy_settings/media.njk`; `<video>` and
`<audio>` are plain elements), so that path is never taken and no request to
plyr.io is made. The strings are nonetheless present in the shipped file.

### Tailwind CSS 4.3.1

- Files: `css/main.css`, `css/prose.css` — generated output, not Tailwind's own
  source. Both open with the upstream banner
  `/*! tailwindcss v4.3.1 | MIT License | https://tailwindcss.com */`.
- Author: Tailwind Labs Inc.
- Home: https://tailwindcss.com
- Licence: MIT

The Tailwind standalone CLI binaries (`tailwindcss-linux-x64`, `tw.exe`) are
used to produce those files. They are not committed — see `.gitignore`.

---

## 2. Build dependencies

Direct dependencies, as resolved in `package-lock.json`. All MIT.

| Package | Version | Licence | Copyright |
| --- | --- | --- | --- |
| `@11ty/eleventy` | 3.1.6 | MIT | © 2017–2024 Zach Leatherman |
| `markdown-it` | 14.3.0 | MIT | © 2014 Vitaly Puzrin, Alex Kocharin |
| `markdown-it-attrs` | 4.5.0 | MIT | © Arve Seljebu |
| `markdown-it-link-attributes` | 4.0.1 | MIT | © 2016 Blade Barringer |
| `markdown-it-texmath` | 1.0.0 | MIT | © 2013–17 Stefan Goessner |
| `katex` | 0.16.47 | MIT | © 2013–2020 Khan Academy and other contributors |
| `gray-matter` | 4.0.3 | MIT | © 2014–2018 Jon Schlinkert |

**KaTeX ships nothing to the browser.** `lib/markdown.js` configures it with
`output: "mathml"`, so mathematics is converted to MathML at build time. No
KaTeX stylesheet and none of the `KaTeX_*` web fonts are copied into the built
site, and none are committed here.

The full transitive tree is 136 packages. Licence distribution, from
`package-lock.json`:

| Licence | Packages |
| --- | --- |
| MIT | 112 |
| ISC | 9 |
| BSD-2-Clause | 9 |
| BSD-3-Clause | 3 |
| Python-2.0 | 2 (`argparse` 2.0.1, two copies) |
| BlueOak-1.0.0 | 1 (`minipass` 7.1.3) |

The non-MIT ones by name: `argparse`, `minipass`, `entities`,
`domelementtype`, `domhandler`, `domutils`, `esprima`, `nunjucks`, `filesize`,
`moo`, `sprintf-js`, `@11ty/recursive-copy`, `anymatch`, `glob-parent`,
`inherits`, `is-json`, `minimatch`, `semver`, `setprototypeof`, `ssri`.

All are permissive. None is copyleft. To regenerate this summary after a
dependency change:

```sh
npx license-checker-rseidelsohn --summary
```

---

## 3. Compiled binaries

`encyclopedia-linux-x64` and `encyclopedia-win-x64.exe` are produced by
`eleventy_binary/compile.sh`, which uses [Bun](https://bun.sh) (MIT) to bundle
the generator into a single executable. They are not committed to this
repository — they are roughly 100 MB each — but if you build and **distribute**
one, note what it contains:

- the whole npm dependency tree from section 2, statically embedded, under the
  licences listed there;
- the **Bun runtime**, which is MIT but which itself embeds
  **JavaScriptCore** — portions of which are under the **LGPL-2.1** and BSD
  licences — along with other third-party components.

A binary is a distribution of all of the above. Ship this file with it, and
consult Bun's own licence documentation for the runtime's complete notices.

---

*Last reviewed against `package-lock.json` on 27 August 2026.*
