/**
 * Fetches every available animal's detail page (bio, adoption fee, weight,
 * videos) from Shelterluv for all shelters and bakes the results into
 * src/lib/details.{shelter}.json, which the app imports at build time.
 *
 * Why build-time? The detail pages send no CORS headers, so browsers can't
 * fetch them directly; GitHub Actions runners (and your machine) have no
 * such restriction.
 *
 * Run manually via `npm run fetch-details` — the deploy workflow runs it
 * before every build (push-triggered and cron-refreshed).
 *
 * Politeness: bounded concurrency (4) and one retry per page. ~130 requests
 * per run across shelters, a few runs per day at most.
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const API_BASE = 'https://new.shelterluv.com'
const SHELTERS = [
  { id: 'caspca', gid: 2783 },
  { id: 'fspca', gid: 4193 },
]
const CONCURRENCY = 4
const RETRY_DELAY_MS = 1500

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

async function fetchText(url) {
  const res = await fetch(url, { headers: { Accept: 'text/html' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

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

async function scrapeShelter({ id, gid }) {
  console.log(`\n[${id}] Fetching animal list…`)
  const res = await fetch(`${API_BASE}/api/v3/available-animals/${gid}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`List API responded ${res.status}`)
  const { animals } = await res.json()
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

  const outFile = path.join(OUT_DIR, `details.${id}.json`)
  await writeFile(outFile, JSON.stringify(snapshot, null, 2) + '\n')
  console.log(
    `[${id}] Wrote ${Object.keys(snapshot).length}/${animals.length} details to ${path.basename(outFile)}` +
      (failed ? ` (${failed} failed)` : ''),
  )
  if (failed > animals.length / 4) {
    console.error(
      `[${id}] Too many failures (${failed}/${animals.length}) — upstream may be down; keeping existing snapshot`,
    )
    process.exitCode = 1
  }
}

async function main() {
  // Shelters sequentially: keeps peak concurrency bounded to CONCURRENCY
  // overall, rather than CONCURRENCY per shelter.
  for (const shelter of SHELTERS) {
    await scrapeShelter(shelter)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
