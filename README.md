# Factory Signal

Factory Signal is a static Astro publication for Cloudflare Pages.

Positioning: Daily intelligence for the future of manufacturing.

## What is included

- Static Astro site that builds to `dist/`.
- Daily briefing archive generated from Markdown in `content/briefings/`.
- Deterministic generated story-card artwork when a briefing item has no image; external story images are preserved when present.
- Original article support in `content/articles/`.
- Homepage, briefing archive, individual briefing pages, story/news archive, article archive, individual article pages, About, Privacy, Disclosure, RSS endpoint, robots.txt, sitemap, and disabled-by-default ads.txt.
- Existing `server.js` is preserved for reference/local legacy preview, but production should use Astro.

## Local development

```sh
npm install
npm run dev
```

The dev server uses port 8888 to preserve the existing local preview habit:

```text
http://localhost:8888
```

Preview a production build locally:

```sh
npm run build
npm run preview
```

## AI/generated fallback story images

Briefing story cards preserve any existing `**Image:**` URL. When a story block has no image, the build runs:

```sh
npm run generate:fallback-images
```

The script scans `content/briefings/*.md`, creates a stable SVG under `public/generated-images/`, and inserts `**Image:** /generated-images/<stable-slug>.svg` into the relevant story block. If `OPENAI_API_KEY` is set, it asks OpenAI for a safe Factory Signal editorial/manufacturing SVG using `OPENAI_IMAGE_FALLBACK_MODEL` or `gpt-5.5` by default. If the API, key, or model fails, it writes a deterministic local branded SVG instead so builds do not break. Generated SVGs include a content hash and are only overwritten when the story content changes.

The existing card placeholder remains in place for any item that still has no image.

## Sync briefings from the current generator output

The production site reads repo-local Markdown from `content/briefings/`. To refresh from the current workspace memory directory without copying logs or junk:

```sh
npm run sync:briefings
```

That script copies only files matching `YYYY-MM-DD.md` from `../memory/briefings/`. The backend/generator in `../news_briefing/` is not modified.

## Original articles

Add monetizable original editorial pieces as Markdown files in `content/articles/` with frontmatter:

```md
---
title: "Article title"
description: "SEO description"
pubDate: "2026-05-10"
author: "Factory Signal Editorial"
tags: ["automation", "CNC"]
---

Article body...
```

## Monetization placeholders

Advertising is disabled unless `ADSENSE_PUBLISHER_ID` starts with `ca-pub-` and ad slot environment variables are set. Configure these only in Cloudflare Pages environment variables or a local `.env` file, not in git.

See `.env.example` for available variables.

## Cloudflare Pages deployment

1. Push this project to a GitHub repository.
2. In Cloudflare Pages, create a project connected to that repository.
3. Set:
   - Framework preset: Astro
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node version: 22 or current Cloudflare default compatible with Astro 5
4. Add environment variables if needed:
   - `SITE_URL=https://thefactorysignal.com`
   - `CONTACT_EMAIL=hello@thefactorysignal.com`
   - Optional ad variables from `.env.example`
5. Attach the domain when ready.

## Automation note

`.github/workflows/daily-build-placeholder.yml` is a safe build-only workflow stub. It intentionally does not call the local generator because the generator is outside this app and may need secrets or workspace-specific paths. Wire generation/import later after the repository boundary is decided.
