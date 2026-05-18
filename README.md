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

Image quality rule: source images are screened before card rendering. Obvious icons, logos, avatars, tracking pixels, placeholders, SVG/GIF remotes, and URL/metadata dimensions below about 600px wide are skipped. Homepage/display cards use a stricter 1200px-wide target; if a remote image is known to be smaller than that, the display card falls back to branded art instead of stretching a thumbnail. Unknown dimensions are allowed when the URL is otherwise credible so valid article images are not rejected just because metadata is missing. Generated fallback SVGs are requested/written at 1600×900 for large classroom-display cards.

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

## Private draft review workflow

Generated article drafts belong in `content/drafts/*.md`. That directory is gitignored, and drafts are not read by the public article routes, RSS feed, article sitemap/RSS, or generated site sitemap. The review inbox is built at `/review/`, intentionally omitted from the sitemap, marked `noindex`, and protected in production by Cloudflare Pages Functions middleware.

Run the local review inbox:

```sh
npm run dev
```

Then visit:

```text
http://localhost:8888/review/
```

Production review URL:

```text
https://robot.thefactorysignal.com/
```

Cloudflare Pages setup after Wes provides credentials:

1. Add `robot.thefactorysignal.com` as a Cloudflare Pages custom domain for the same Pages project that serves `thefactorysignal.com`.
2. Point the `robot` DNS record/CNAME at the Cloudflare Pages project as instructed by Cloudflare.
3. Add production environment variables/secrets in Cloudflare Pages:
   - `FS_REVIEW_USERNAME`
   - `FS_REVIEW_PASSWORD`
4. Deploy the Pages project.
5. Verify:
   - `https://robot.thefactorysignal.com/` prompts for Basic Auth.
   - Wrong credentials are rejected.
   - Correct credentials show the draft review inbox.
   - Missing credentials fail closed with a 503 instead of exposing drafts.
   - `https://thefactorysignal.com/` remains public and unaffected.

Middleware behavior:

- `robot.thefactorysignal.com` requires Basic Auth for every path on that host.
- After login, non-asset paths on `robot.thefactorysignal.com` are rewritten to the built `/review/` page so the robot subdomain does not expose the normal public homepage.
- `/review/` on the main domain remains protected as a compatibility fallback, but the intended public review URL is `https://robot.thefactorysignal.com/`.
- Credentials are read only from `FS_REVIEW_USERNAME` and `FS_REVIEW_PASSWORD`; real credentials must not be committed.

Approval workflow:

1. Review the draft at `https://robot.thefactorysignal.com/` after logging in.
2. If approved, move/rename the Markdown file from `content/drafts/` into `content/articles/`. You can do this manually or run:

   ```sh
   node scripts/publish-draft.mjs <draft-slug-or-file>
   ```

3. Run `npm run build` and deploy when ready.

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
