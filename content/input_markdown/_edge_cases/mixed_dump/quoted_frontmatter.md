---
title: "Quoted Frontmatter"
tags: "[gas giant, storms, moons]"
date: "2026-03-08"
description: "Every field re-quoted, as a web clipper or export script leaves them."
author: "Test"
version: "1"
category: "[Testing, Planetary Science]"
---

Some extractors quote every frontmatter value, which turns YAML's own inline
sequence into a plain string. The tags and categories above must come out
identical to the unquoted form — no stray `[` or `]` welded onto the first and
last item — and the facet links must land on the same pages as any other file
tagged `storms` or filed under `Testing`.
