# Charlottesville SPCA Viewer

An unofficial, faster way to browse adoptable pets at area shelters:
the [Charlottesville-Albemarle SPCA](https://caspca.org), the
[Fluvanna SPCA](https://fluvannasPCA.org), and the
[Humane Society/SPCA of Nelson County](https://nelsonspca.org). The shelters'
own sites wrap their listing widgets with awkward navigation and no
filtering; this is a lightweight SPA that presents the same data sensibly.

## How it works

Two platforms are supported:

- **Shelterluv** (CASPCA, Fluvanna) — their adoption pages embed
  [Shelterluv](https://www.shelterluv.com), whose embed bundle revealed an
  undocumented but open JSON endpoint (per-shelter GIDs live in
  `src/lib/shelters.ts`):

  ```
  GET https://new.shelterluv.com/api/v3/available-animals/{gid}
  ```

- **RescueGroups** (Nelson) — nelsonspca.org embeds the free
  [RescueGroups.org](https://rescuegroups.org) Pet Adoption Toolkit, keyed by
  a species-scoped embed key (one key per species page; Nelson's cats key is
  in `src/lib/shelters.ts`). The toolkit serves server-rendered HTML
  fragments, no JSON:

  ```
  GET https://toolkit.rescuegroups.org/j/3/grid3_layout.php?toolkitKey={key}&toolkitKeyID={id}&page_={n}
  GET https://toolkit.rescuegroups.org/j/3/pet1_layout.php?toolkitKey={key}&toolkitKeyID={id}&animalID={id}
  ```

  The grid fragment only carries name + photo + internal animal id, so sex,
  breed, age and location are folded in from the build-time detail snapshot.

Both send `Access-Control-Allow-Origin: *`, so the app calls them directly
from the browser — there is **no backend**.

**Detail data (bios, fees, weights, extra photos) is different**: neither
platform offers browsers a usable detail API, so `scripts/fetch-details.mjs`
scrapes the detail pages server-side (concurrency-limited, one retry each)
and bakes them into `src/lib/details.{shelter}.json`, which is imported at
build time. The deploy workflow regenerates these files on every build,
including a cron rebuild every 6 hours. Animals listed since the last build
show summary-only until the next refresh (for Nelson that also means
sex/breed/age, since the grid fragment lacks them).

Two RescueGroups quirks worth knowing:

- The toolkit publishes an age *category* (Baby/Young/Adult/Senior), not a
  birthday. The app estimates a birthday at the category midpoint so card
  ages, age filters and sorting keep working; the detail view shows the
  honest category instead.
- For "newest listing" sorting, the numeric RescueGroups animal id plays the
  role of Shelterluv's `nid` (both are internally increasing).

### Being polite to upstream

The endpoints are undocumented and unauthenticated, so all fetching is designed
conservatively:

- Browser: at most one list fetch per shelter per session (Nelson's is one
  request per ~24-animal grid page), cached in `sessionStorage` for 15
  minutes; concurrent callers share one in-flight promise. No polling.
- Server-side (CI or local): detail scraping is bounded to concurrency 4
  with one retry per page — roughly 190 requests across all shelters, a few
  times per day.

## Stack

- [Svelte 5](https://svelte.dev) + TypeScript + Vite
- Hash-based routing (`#/animal/CHO-A-19267`) because GitHub Pages can't
  rewrite paths to `index.html`
- Deployed to GitHub Pages via GitHub Actions on push to `main`

## Development

```sh
npm install
npm run fetch-details  # optional: refresh the baked detail snapshots (~190 requests)
npm run dev            # dev server at http://localhost:5173
npm run check          # svelte-check + tsc typecheck
npm run smoke          # end-to-end tests of the API layer (~5 live requests)
npm run build          # production build to dist/
npm run preview        # serve dist/ exactly like GitHub Pages will
```

`npm run dev` works out of the box using the committed detail snapshots; run
`fetch-details` first if you want the freshest bios locally. Adding another
Shelterluv-powered shelter is a one-entry change in `src/lib/shelters.ts`
plus a matching entry in the fetch script. Same for a RescueGroups shelter
(find its toolkit key in the page's toolkit.js URL), as long as the key is
species-scoped so `species` can be declared per shelter.

First deploy requires enabling GitHub Pages once: Settings → Pages → Source:
"GitHub Actions". The workflow also runs on a 6-hour cron; note GitHub
auto-disables scheduled workflows after 60 days of repo inactivity.

## Fragility notes

- The Shelterluv `api/v3` endpoint is not documented or guaranteed. If it
  breaks, the fix lives entirely in `src/lib/api.ts`.
- The RescueGroups toolkit is equally undocumented, and its HTML fragments
  are parsed with regexes (duplicated in `src/lib/api.ts` and
  `scripts/fetch-details.mjs`). A toolkit redesign breaks both — the
  symptom would be an empty or sparse Nelson list; the grid fragment has
  been unchanged for years.
- The detail snapshot depends on the `<iframe-animal :animal="...">` payload
  shape and the `pet1_layout.php` markup (`scripts/fetch-details.mjs`);
  failures are per-animal and degrade gracefully to summary-only cards.
