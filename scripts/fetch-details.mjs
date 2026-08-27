/**
 * Fetches every available animal's detail page (bio, adoption fee, weight,
 * videos) for all shelters and bakes the results into
 * src/lib/details.{shelter}.json, which the app imports at build time.
 *
 * Why build-time? Detail data isn't reachable from browsers (Shelterluv
 * detail pages send no CORS headers; the RescueGroups toolkit serves only
 * server-rendered HTML fragments with no JSON API), but GitHub Actions
 * runners (and your machine) have no such restriction.
 *
 * Run manually via `npm run fetch-details` — the deploy workflow runs it
 * before every build (push-triggered and cron-refreshed).
 *
 * Politeness: bounded concurrency (4) and one retry per page. Roughly 130
 * requests per run for the Shelterluv shelters plus one list page per ~24
 * animals and one detail page per animal for Nelson, a few runs per day
 * at most.
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SHELTERLUV_BASE = 'https://new.shelterluv.com'
const RG_TOOLKIT_BASE = 'https://toolkit.rescuegroups.org/j/3'
const SHELTERS = [
  { id: 'caspca', kind: 'shelterluv', gid: 2783 },
  { id: 'fspca', kind: 'shelterluv', gid: 4193 },
  {
    id: 'nspca',
    kind: 'rescuegroups',
    toolkitKey: 'yjYRO6T3',
    toolkitKeyID: '8754',
  },
]
const CONCURRENCY = 4
const RETRY_DELAY_MS = 1500
/** Attempts per HTTP request, for transient flakes (ECONNRESET, 5xx, 429). */
const FETCH_ATTEMPTS = 3
/** Some middleboxes reset connections from default client UAs; identify honestly. */
const USER_AGENT = 'charlottesville-spca-viewer/1.0 (unofficial adoption viewer)'
const RG_PAGE_SIZE = 24
const RG_MAX_PAGES = 25

const OUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/lib',
)

/** Decode HTML entities (no DOM available in Node). */
function decodeEntities(s) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
    if (code[0] === '#') {
      const isHex = code[1] === 'x' || code[1] === 'X'
      const n = parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isSafeInteger(n) ? String.fromCodePoint(n) : m
    }
    return named[code.toLowerCase()] ?? m
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Network/socket errors and 4xx/5xx statuses worth one more attempt. */
function isTransient(err) {
  const codes = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'EPIPE',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
  ]
  const code = err?.cause?.code ?? err?.code
  if (code && codes.includes(code)) return true
  if (err?.transient) return true
  return /fetch failed|socket hang up|network/i.test(err?.message ?? '')
}

/** Fetch with bounded retries; throws the last error if all attempts fail. */
async function fetchWithRetry(url, parse) {
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
      })
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`)
        // Rate limiting and server errors usually clear on retry; client
        // errors (403 bot-block, 404) won't — fail fast on those.
        err.transient = res.status === 429 || res.status >= 500
        throw err
      }
      return await parse(res)
    } catch (err) {
      if (attempt === FETCH_ATTEMPTS || !isTransient(err)) throw err
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }
}

function fetchText(url) {
  return fetchWithRetry(url, (res) => res.text())
}

function fetchJson(url) {
  return fetchWithRetry(url, (res) => res.json())
}

// ---------------------------------------------------------------------------
// Shelterluv
// ---------------------------------------------------------------------------

/** Returns the detail fields for one animal, or null if extraction fails. */
async function scrapeAnimal(animal) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const html = await fetchText(animal.public_url)
      const match = html.match(/<iframe-animal\s[^>]*?:animal="([^"]*)"/)
      if (!match) throw new Error('animal payload not found in page')

      const parsed = JSON.parse(decodeEntities(match[1]))
      // The bio is entity-encoded twice upstream.
      const bio = parsed.kennel_description
        ? decodeEntities(decodeEntities(parsed.kennel_description))
        : undefined
      return {
        kennel_description: bio || undefined,
        adoptionFee: parsed.adoptionFee || undefined,
        weight: parsed.weight ?? undefined,
        weight_units: parsed.weight_units || undefined,
        videos: Array.isArray(parsed.videos) ? parsed.videos : [],
      }
    } catch (err) {
      if (attempt === 2) {
        console.warn(`  ! ${animal.uniqueId}: ${err.message}`)
        return null
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }
}

async function scrapeShelterluv({ id, gid }) {
  console.log(`\n[${id}] Fetching animal list…`)
  const { animals } = await fetchJson(
    `${SHELTERLUV_BASE}/api/v3/available-animals/${gid}`,
  )
  console.log(`[${id}] Found ${animals.length} animals. Fetching details…`)

  const snapshot = {}
  let done = 0
  let failed = 0
  const queue = [...animals]

  async function worker() {
    while (queue.length > 0) {
      const animal = queue.shift()
      const detail = await scrapeAnimal(animal)
      if (detail) snapshot[animal.uniqueId] = detail
      else failed++
      done++
      if (done % 10 === 0) console.log(`  [${id}] ${done}/${animals.length}`)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  await writeSnapshot(id, snapshot, animals.length, failed)
}

// ---------------------------------------------------------------------------
// RescueGroups Pet Adoption Toolkit
//
// The grid fragment (grid3_layout.php) only publishes name + photo + internal
// animal id, so the snapshot here also carries summary fields (sex, breed,
// age, location) that src/lib/api.ts folds into list results. The regexes
// mirror rgParseGrid / the pet1 extraction in api.ts — the markup is
// machine-generated and stable, but a toolkit redesign breaks both.
// ---------------------------------------------------------------------------

/** Parse one grid3_layout.php fragment into { total, cells } (see api.ts). */
function parseToolkitGrid(html) {
  const total = Number(
    html.match(/([\d,]+)\s+pets found/i)?.[1]?.replace(/,/g, '') ?? 0,
  )
  const cells = []
  const seen = new Set()
  for (const chunk of html.split('<td class="rgtkSearchResultsCell">').slice(1)) {
    const id = chunk.match(/toolkitFocusPet_\(,\s*(\d+),/)?.[1]
    if (!id || seen.has(id)) continue
    seen.add(id)
    cells.push({
      id,
      name:
        chunk.match(/rgtkSearchPetName[^>]*><a[^>]*>([^<]+)<\/a>/)?.[1]?.trim() ??
        'Unnamed',
      photo: chunk.match(/rgtkSearchPetPicImg"\s+src="([^"]+)"/)?.[1] ?? null,
    })
  }
  return { total, cells }
}

/** Pull the human description out of the pet1 fragment as plain text. */
function extractToolkitDescription(html) {
  const block = html.match(
    /rgtkPetFieldDescription[^>]*>([\s\S]*?)<div class="rgtkPetMoreabout/,
  )?.[1]
  if (!block) return undefined
  // The toolkit wraps the bio in rgHeader/rgFooter scaffolding; keep the
  // description body when present.
  const desc = block.match(/<div class="rgDescription">([\s\S]*?)<\/div>/)?.[1] ?? block
  return (
    decodeEntities(
      desc
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ''),
    )
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() || undefined
  )
}

/** Returns the snapshot entry for one animal, or null if extraction fails. */
async function scrapeToolkitAnimal(cell, shelter) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const html = await fetchText(
        `${RG_TOOLKIT_BASE}/pet1_layout.php?toolkitKey=${shelter.toolkitKey}` +
          `&toolkitKeyID=${shelter.toolkitKeyID}&animalID=${cell.id}`,
      )
      const text = (cls) =>
        html.match(new RegExp(`${cls}[^>]*>([^<]+)<`))?.[1]?.trim()
      // The primary photo link repeats the grid's cover image; keep only
      // the additional gallery entries.
      const gallery = [
        ...html.matchAll(/href="([^"]+)"[^>]*rel="prettyPhoto\[pp_gal\]"/g),
      ]
        .map((m) => m[1])
        .filter((url, i, all) => url !== cell.photo && all.indexOf(url) === i)
      return {
        sex: text('rgtkPetDetailsSex'),
        breed: text('rgtkPetDetailsBreed'),
        age_category: text('rgtkPetDetailsAge'),
        location: text('rgtkPetFieldLocation'),
        rescue_id: text('rgtkPetFieldRescueID')?.replace(/^Pet ID #\s*/, ''),
        kennel_description: extractToolkitDescription(html),
        extra_photos: gallery,
        videos: [],
      }
    } catch (err) {
      if (attempt === 2) {
        console.warn(`  ! ${cell.id}: ${err.message}`)
        return null
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }
}

async function scrapeRescueGroups(shelter) {
  console.log(`\n[${shelter.id}] Fetching animal list…`)
  const cells = []
  const seen = new Set()
  let total = Infinity
  for (let page = 1; cells.length < total && page <= RG_MAX_PAGES; page++) {
    const html = await fetchText(
      `${RG_TOOLKIT_BASE}/grid3_layout.php?toolkitKey=${shelter.toolkitKey}` +
        `&toolkitKeyID=${shelter.toolkitKeyID}&page_=${page}`,
    )
    const parsed = parseToolkitGrid(html)
    total = parsed.total
    for (const cell of parsed.cells) {
      if (!seen.has(cell.id)) {
        seen.add(cell.id)
        cells.push(cell)
      }
    }
  }
  console.log(`[${shelter.id}] Found ${cells.length} animals. Fetching details…`)

  const snapshot = {}
  let done = 0
  let failed = 0
  const queue = [...cells]

  async function worker() {
    while (queue.length > 0) {
      const cell = queue.shift()
      const detail = await scrapeToolkitAnimal(cell, shelter)
      if (detail) snapshot[cell.id] = detail
      else failed++
      done++
      if (done % 10 === 0) console.log(`  [${shelter.id}] ${done}/${cells.length}`)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  await writeSnapshot(shelter.id, snapshot, cells.length, failed)
}

// ---------------------------------------------------------------------------

/** Sort keys (numerically for id-only snapshots) so re-runs diff cleanly
 * instead of churning key order with the upstream list's ordering. */
function sortSnapshot(snapshot) {
  return Object.fromEntries(
    Object.keys(snapshot)
      .sort((a, b) =>
        Number(a) && Number(b) ? a - b : a.localeCompare(b),
      )
      .map((k) => [k, snapshot[k]]),
  )
}

async function writeSnapshot(id, snapshot, count, failed) {
  const outFile = path.join(OUT_DIR, `details.${id}.json`)
  await writeFile(outFile, JSON.stringify(sortSnapshot(snapshot), null, 2) + '\n')
  console.log(
    `[${id}] Wrote ${Object.keys(snapshot).length}/${count} details to ${path.basename(outFile)}` +
      (failed ? ` (${failed} failed)` : ''),
  )
  if (failed > count / 4) {
    console.error(
      `[${id}] Too many failures (${failed}/${count}) — upstream may be down; keeping existing snapshot`,
    )
    process.exitCode = 1
  }
}

async function main() {
  // Shelters sequentially: keeps peak concurrency bounded to CONCURRENCY
  // overall, rather than CONCURRENCY per shelter. A failure on one shelter
  // (upstream outage) doesn't stop the others from refreshing — the failed
  // shelter's committed snapshot is kept and the run exits non-zero so the
  // failure is visible.
  let failed = false
  for (const shelter of SHELTERS) {
    try {
      if (shelter.kind === 'shelterluv') await scrapeShelterluv(shelter)
      else await scrapeRescueGroups(shelter)
    } catch (err) {
      failed = true
      console.error(
        `[${shelter.id}] Scraping failed after retries — keeping existing snapshot:`,
        err?.message ?? err,
      )
    }
  }
  if (failed) {
    console.error('One or more shelters failed to refresh.')
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
