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

Editorial readability rule: write Factory Signal articles and drafts for a 4th-grade reading level and the average U.S. reader while keeping the manufacturing content strong. Use short words, short sentences, plain verbs, and active voice. Keep hard terms like CNC, qualification, metrology, DED, and traceability when they matter, but explain them in simple words the first time. Prefer short paragraphs. Do not use a childish tone. Avoid AI-tell contrast formulas such as “not just X but Y”; use direct claims instead.

Draft review aid: `npm run style:guard` now prints non-blocking readability advice for Markdown drafts and articles. It checks for very long sentences, long paragraphs, and dense long-word patterns. It does not fail the build for valid manufacturing terms; it tells editors where to simplify before publishing.

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
   - `FS_REVIEW_SESSION_SECRET`
   - `FS_REVIEW_PUBLISH_WEBHOOK_URL` — HTTPS receiver that Hermes/local automation will expose later.
   - `FS_REVIEW_PUBLISH_WEBHOOK_SECRET` — shared HMAC secret for signing publish requests.
4. Deploy the Pages project.
5. Verify:
   - `https://robot.thefactorysignal.com/` prompts for review login.
   - Wrong credentials are rejected.
   - Correct credentials show the draft review inbox.
   - Missing credentials fail closed with a 503 instead of exposing drafts.
   - `https://thefactorysignal.com/` remains public and unaffected.

Middleware behavior:

- `robot.thefactorysignal.com` requires the signed review login session for every path on that host.
- After login, non-asset paths on `robot.thefactorysignal.com` are rewritten to the built `/review/` page so the robot subdomain does not expose the normal public homepage.
- `/review/` on the main domain remains protected as a compatibility fallback, but the intended public review URL is `https://robot.thefactorysignal.com/`.
- `/review/publish` is also protected by the same middleware and is passed through to the Cloudflare Pages Function instead of being rewritten to the review page.
- Credentials are read only from `FS_REVIEW_USERNAME`, `FS_REVIEW_PASSWORD`, and `FS_REVIEW_SESSION_SECRET`; real credentials must not be committed.

Approval workflow:

1. Review the draft at `https://robot.thefactorysignal.com/` after logging in.
2. Optionally type personal additions in the Opening note, Mid-article note, and Closing note fields on the draft card. The receiver inserts them as Wes-authored Markdown callouts when the draft is published.
3. Use **Publish now** to request immediate publishing, or choose a `datetime-local` value and use **Schedule publish** to request a future publish. The Cloudflare Function does not publish or wait itself; it only sends a signed request to the configured receiver.
4. Keep the manual fallback command available if the webhook receiver is not connected yet:

   ```sh
   node scripts/publish-draft.mjs <draft-slug-or-file>
   ```

Publish request webhook:

- Endpoint called by the review UI: `POST /review/publish`
- Required Cloudflare environment variables:
  - `FS_REVIEW_PUBLISH_WEBHOOK_URL`
  - `FS_REVIEW_PUBLISH_WEBHOOK_SECRET`
- If either variable is missing, or if `FS_REVIEW_PUBLISH_WEBHOOK_URL` is not a valid `https://` URL, the endpoint fails closed with HTTP 503 and does not expose any secret or send a request.
- Accepted form/JSON fields:
  - `draft` (or `slug`/`file`/`filename`): conservative slug/filename identifier; letters, numbers, `.`, `_`, and `-` only; no path traversal.
  - `action`: `publish_now` or `schedule`
  - `publishAt`: required for `schedule`; accepts `datetime-local`/ISO-ish values.
  - `title`: optional display title.
  - `additionOpening`, `additionMiddle`, `additionClosing` form fields, or JSON `additions.opening`/`middle`/`closing`: optional personal notes capped at 1,200 characters each.
- Webhook payload shape sent to Hermes/local automation:

  ```json
  {
    "event": "factory_signal.review_publish_request",
    "action": "schedule",
    "draft": "example-draft-slug",
    "title": "Optional draft title",
    "publishAt": "2026-05-20T09:00",
    "additions": {
      "opening": "Why this matters right now...",
      "middle": "Practical shop-floor angle...",
      "closing": "Final takeaway..."
    },
    "requestedAt": "2026-05-18T19:30:00.000Z",
    "idempotencyKey": "example-draft-slug-schedule-<sha256-prefix>",
    "source": {
      "url": "https://robot.thefactorysignal.com/review/publish",
      "userAgent": "..."
    }
  }
  ```

- Signature headers:
  - `X-Factory-Signal-Signature: sha256=<hex hmac>` where the HMAC SHA-256 input is `<X-Factory-Signal-Timestamp>.<raw JSON body>`.
  - `X-Factory-Signal-Timestamp`
  - `X-Factory-Signal-Idempotency-Key`
  - `X-Factory-Signal-Event: factory_signal.review_publish_request`
- Idempotency keys are deterministic for the logical operation (`draft`, `action`, `publishAt` or `now`, and normalized personal additions) and do not include the request timestamp.
- Point `FS_REVIEW_PUBLISH_WEBHOOK_URL` at the local receiver exposed through an HTTPS tunnel and configure that receiver with the same `FS_REVIEW_PUBLISH_WEBHOOK_SECRET`.

Local publish receiver:

- Script: `scripts/review-publish-receiver.mjs`
- Default bind: `http://127.0.0.1:8765/factory-signal/review-publish`
- Health check: `GET /healthz`
- The receiver uses only Node stdlib and verifies:
  - `POST` to the configured route only.
  - `X-Factory-Signal-Event` equals `factory_signal.review_publish_request`.
  - `X-Factory-Signal-Timestamp` is parseable and fresh; default max skew is 300 seconds.
  - `X-Factory-Signal-Signature` is `sha256=<hex hmac>` over `<timestamp>.<raw JSON body>` using `FS_REVIEW_PUBLISH_WEBHOOK_SECRET`.
  - Draft identifiers are simple slugs/filenames only; no path separators or traversal.
  - Idempotency keys are persisted locally so duplicate webhook deliveries do not re-run publishing.
- Dry-run is the default. In dry-run mode, valid requests are authenticated, idempotency-tracked, and logged, but no draft is moved, no build runs, no git commit is created, and no deploy occurs.
- Local state is written under `.hermes/review-publish-receiver/` by default and is gitignored.
- `schedule` requests are accepted only for future `publishAt` values. They are persisted in `.hermes/review-publish-receiver/scheduled/` and armed with local timers while the receiver process is running. If the receiver restarts, future scheduled jobs are reloaded.
- Personal additions are normalized and persisted with scheduled jobs, then inserted immediately before the publish move runs.

Run locally in dry-run mode:

```sh
FS_REVIEW_PUBLISH_WEBHOOK_SECRET='<same-secret-as-cloudflare>' npm run review:publish-receiver
```

Run locally in execute mode only after verifying the tunnel, secret, and dry-run behavior:

```sh
FS_REVIEW_PUBLISH_WEBHOOK_SECRET='<same-secret-as-cloudflare>' \
FS_REVIEW_RECEIVER_EXECUTE=true \
npm run review:publish-receiver
```

Optional receiver environment variables:

- `FS_REVIEW_RECEIVER_HOST` — default `127.0.0.1`
- `FS_REVIEW_RECEIVER_PORT` — default `8765`
- `FS_REVIEW_RECEIVER_ROUTE` — default `/factory-signal/review-publish`
- `FS_REVIEW_RECEIVER_STATE_DIR` — default `.hermes/review-publish-receiver`
- `FS_REVIEW_RECEIVER_FRESHNESS_SECONDS` — default `300`
- `FS_REVIEW_RECEIVER_MAX_BODY_BYTES` — default `65536`
- `FS_REVIEW_RECEIVER_EXECUTE=true` — required to run the publish workflow

When execute mode is enabled, an accepted publish runs:

1. Insert any personal additions into the draft Markdown as `> **Wes's ... note:**` callouts.
2. `node scripts/publish-draft.mjs <draft>`
3. `npm run build`
4. `git add content/articles public/generated-images`
5. `git commit -m "Publish review draft: <draft>"`
6. `npx wrangler pages deploy dist --project-name factory-signal --branch main --commit-hash <new-commit> --commit-message "Publish review draft: <draft>"`

Receiver tests:

```sh
npm run test:review-publish-receiver
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
