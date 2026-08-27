# Charlottesville SPCA Viewer

An unofficial, faster way to browse adoptable pets at the
[Charlottesville-Albemarle SPCA](https://caspca.org). The shelter's own site
wraps a Shelterluv iframe with awkward navigation and no filtering; this is a
lightweight SPA that presents the same data sensibly.

## How it works

Two shelters are supported — Charlottesville-Albemarle SPCA (CASPCA) and
Fluvanna SPCA. Both embed [Shelterluv](https://www.shelterluv.com) on their
adoption pages, and Shelterluv's embed bundle revealed an undocumented but
open JSON endpoint (per-shelter GIDs live in `src/lib/shelters.ts`):

```
GET https://new.shelterluv.com/api/v3/available-animals/{gid}
```

It returns every available animal (summary data + photos) and sends
`Access-Control-Allow-Origin: *`, so the app calls it directly from the
browser — there is **no backend**.

**Detail data (bios, fees, weights) is different**: Shelterluv's per-animal
pages send no CORS headers, so browsers can't read them at all. Instead,
`scripts/fetch-details.mjs` scrapes them server-side (concurrency-limited,
one retry each) and bakes them into `src/lib/details.{shelter}.json`, which
is imported at build time. The deploy workflow regenerates these files on
every build, including a cron rebuild every 6 hours. Animals listed since the
last build show summary-only until the next refresh.

### Being polite to upstream

The endpoint is undocumented and unauthenticated, so all fetching is designed
conservatively:

- Browser: at most one list request per shelter per session, cached in
  `sessionStorage` for 15 minutes; concurrent callers share one in-flight
  promise. No polling.
- Server-side (CI or local): detail scraping is bounded to concurrency 4
  with one retry per page — roughly 125 requests across both shelters, a few
  times per day.

## Stack

- [Svelte 5](https://svelte.dev) + TypeScript + Vite
- Hash-based routing (`#/animal/CHO-A-19267`) because GitHub Pages can't
  rewrite paths to `index.html`
- Deployed to GitHub Pages via GitHub Actions on push to `main`

## Development

```sh
npm install
npm run fetch-details  # optional: refresh the baked detail snapshot (~80 requests)
npm run dev            # dev server at http://localhost:5173
npm run check          # svelte-check + tsc typecheck
npm run smoke          # end-to-end tests of the API layer (1 live request)
npm run build          # production build to dist/
npm run preview        # serve dist/ exactly like GitHub Pages will
```

`npm run dev` works out of the box using the committed detail snapshots; run
`fetch-details` first if you want the freshest bios locally. Adding another
Shelterluv-powered shelter is a one-entry change in `src/lib/shelters.ts`
plus a matching entry in the fetch script.

First deploy requires enabling GitHub Pages once: Settings → Pages → Source:
"GitHub Actions". The workflow also runs on a 6-hour cron; note GitHub
auto-disables scheduled workflows after 60 days of repo inactivity.

## Fragility notes

- The `api/v3` endpoint is not documented or guaranteed. If it breaks, the fix
  lives entirely in `src/lib/api.ts`.
- The detail snapshot depends on the `<iframe-animal :animal="...">` payload
  shape (`scripts/fetch-details.mjs`); failures are per-animal and degrade
  gracefully to summary-only cards.
