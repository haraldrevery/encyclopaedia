---
title: About
description: What this encyclopaedia is, and how it is built.
name: Harald Revery
role: Offline-first reference, generated from a folder of markdown
image: profile.jpg
imageAlt: Portrait
intro: >
  A reference you can hold. Every page here was written as a plain markdown
  file in a folder, and the whole site is generated from that folder by a
  single binary — no server, no database, no account.
---

## What this is

This site is a reading copy of a folder of notes. The source is ordinary markdown
with ordinary YAML front matter, arranged in whatever directory structure made
sense at the time. The generator walks that tree, works out what it is looking at,
and writes a browsable site beside it.

Nothing about the structure is prescribed. Unsorted folders, missing front matter,
no dates, no tags, files nested eight levels deep — none of it stops a build. Where
something could not be determined it says **Unknown** rather than guessing quietly,
and the [status page](page/status.html) lists every one of those cases so you can
decide which are worth fixing.

## How it is built

The site is static in the strict sense: it is a tree of HTML files with no
JavaScript required to read it. Two exceptions are additive rather than load-bearing
— a lightbox for image galleries, and a button that narrows the reading measure on
long articles. Turn both off and every page still reads correctly.

Mathematics is rendered to MathML at build time, so no formula library ships to
the browser. Tables of contents, heading anchors and breadcrumbs are all computed
during the build for the same reason. Media is never copied: pages link back into
the source folder with relative paths, which is why a large project produces a few
megabytes of HTML rather than a duplicate of itself.

Every link on every page is relative to the page it sits on. That is the detail
that lets the whole thing work from a `file://` path, a USB stick or a web host
without changing a single setting.

## Editing this page

The text you are reading lives in `input_about_legal/about.md`. The portrait is
whichever image sits beside it in that folder. Edit the markdown, drop in a
different image, rebuild — no template is involved.
