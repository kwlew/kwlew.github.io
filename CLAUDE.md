# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static personal portfolio site for kwlew (Kaleo Soares) hosted on GitHub Pages. No framework, no bundler, no build step: edit HTML/CSS/JS directly and push.

## Writing style

**Do not use em dashes** (`—` or `&mdash;`) anywhere in site copy, comments, or commit messages. Use a colon for a label/definition, or a comma or semicolon in prose. The repo is currently free of them; keep it that way.

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
- `/assets/css/main.css?v=11` single stylesheet for the entire site
- `/assets/js/particles.js?v=3` animated canvas particle background

**When either file changes, bump the version query string** (`?v=10` to `?v=11`, etc.) in every HTML file that references it, otherwise visitors get stale cached versions.

### Fonts
Three Google Fonts families, linked identically from every page:
- **Space Grotesk** display face, used for `h1`/`h2`/`h3`, big numbers, and the brand mark
- **Inter** body face
- **JetBrains Mono** eyebrow labels, small technical labels, `code`/`pre`

### Page structure
- `index.html` marketing-style landing page. A normal scrolling document (no tab switching, no hash routing): sticky `.site-nav`, `.hero`, `.proof-bar`, then four `.section` blocks (`#work`, `#results`, `#stack`, `#contact`). An inline script highlights the nav item for the section in view, driven by scroll position rather than IntersectionObserver so it also works in throttled/background tabs.
- `achievements.html` the full competition record, moved off the landing page. Holds the `ACHIEVEMENTS` data object and the Personal/ByteVoltaTeam tab rendering.
- `robotics.html`, `plugins/ksethome.html`, `plugins/kmoney.html`, `docs/ksethome.html`, `docs/kmoney.html`, `games/tdidle.html`, `404.html` standalone sub-pages. Each includes the particles canvas and a `.home-btn` fixed-position anchor back to `/`.

The landing page links out to every sub-page; it deliberately carries no deep content of its own.

### CSS design tokens
All colours, fonts, radii, easing curves, and transition durations are CSS custom properties defined in the `:root` block at the top of `main.css`. Edit values there rather than inline in rules.

Two colour rules worth knowing:
- The **purple ramp** (`--c-purple`, `--c-violet`, and friends) is the brand accent. It drives headings, buttons, hovers, glows and the particle background.
- `--c-green` is reserved for the "available" status pill/dot, and the `--label-*` palette is a separate categorical system for tags and medal badges. Third-party brand colours (Discord, Modrinth, Instagram, Codeforces, LeetCode) are hardcoded on purpose. None of these should be swapped when the brand accent changes.

Glass surfaces use `--glass-blur` (`blur(20px) saturate(160%)`) over `--c-surface`, plus an `inset 0 1px 0` top highlight. Keep new panels on that recipe.

### Achievement tabs (achievements.html)
Inner tabs ("Personal" / "ByteVoltaTeam"). JS toggles `[hidden]` on `.ach-panel` elements and adds the `panel-entering` class to trigger the re-entry animation via a forced reflow (`void p.offsetWidth`).

### Content reference files
- `PLUGIN.md` authoritative reference for all kMoney plugin commands, permissions, storage, sounds, and placeholders. Used when updating `plugins/kmoney.html` or `docs/kmoney.html`.
- `medalhas.md` raw list of competition results, used as reference when updating `achievements.html` and the summary figures on the landing page.

These files are not rendered on the site; they exist as source-of-truth documents.

### Keeping figures honest
The landing page quotes summary numbers (medal counts, placements). They must stay consistent with the `ACHIEVEMENTS` / `PANELS` data in `achievements.html`, which is the source of truth. Do not state a derived figure (a span of years, a total) without checking it against that data first.
