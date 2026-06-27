# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static personal portfolio site for kwlew (Kaleo Soares) hosted on GitHub Pages. No framework, no bundler, no build step — edit HTML/CSS/JS directly and push.

## Development

Open any `.html` file in a browser. There is no local server required, but one is useful for testing absolute asset paths (`/assets/...`). A quick option:

```
python -m http.server 8080
```

No build, lint, or test commands exist.

## Deployment

Pushing to `main` deploys automatically via GitHub Pages. The `CNAME` file sets the custom domain (`kwlew.dev`).

## Architecture

### Shared assets
All pages reference the same two files:
- `/assets/css/main.css?v=5` — single stylesheet for the entire site
- `/assets/js/particles.js?v=2` — animated canvas particle background

**When either file changes, bump the version query string** (`?v=5` → `?v=6`, etc.) in every HTML file that references it, otherwise visitors get stale cached versions.

### Page structure
- `index.html` — main landing page; a single-page-style layout with four sections (Projects, Docs, Achievements, Contact) that are shown/hidden by toggling a CSS `.active` class via inline JS. Hash-based routing (`#projects`, `#docs`, etc.) is handled in the same inline script.
- `robotics.html`, `plugins/ksethome.html`, `plugins/kmoney.html`, `docs/ksethome.html`, `docs/kmoney.html` — standalone sub-pages. Each includes the particles canvas and a `.home-btn` fixed-position anchor back to `/`.

### CSS design tokens
All colours, radii, easing curves, and transition durations are CSS custom properties defined in the `:root` block at the top of `main.css`. Edit values there rather than inline in rules.

### Achievement tabs (index.html)
The Achievements section has inner tabs ("Personal" / "ByteVoltaTeam"). JS toggles `[hidden]` on `.ach-panel` elements and adds the `panel-entering` class to trigger the re-entry animation via a forced reflow (`void p.offsetWidth`).

### Content reference files
- `PLUGIN.md` — authoritative reference for all kMoney plugin commands, permissions, storage, sounds, and placeholders. Used when updating `plugins/kmoney.html` or `docs/kmoney.html`.
- `medalhas.md` — raw list of competition results used as reference when updating the Achievements section of `index.html`.

These files are not rendered on the site; they exist as source-of-truth documents.
