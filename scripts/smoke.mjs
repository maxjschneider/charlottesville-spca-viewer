/**
 * Smoke tests against the LIVE Shelterluv list endpoint + the baked detail
 * snapshot. Run manually (`npm run smoke`), not in CI. Verifies the API
 * layer end-to-end: request dedup, snapshot merging, and helpers.
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const snapshot = {
  caspca: JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../src/lib/details.caspca.json', import.meta.url)),
      'utf8',
    ),
  ),
  fspca: JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../src/lib/details.fspca.json', import.meta.url)),
      'utf8',
    ),
  ),
}

const SHELTERS = {
  caspca: { id: 'caspca', name: 'CASPCA', gid: 2783, prefix: 'CHO' },
  fspca: { id: 'fspca', name: 'Fluvanna SPCA', gid: 4193, prefix: 'FLVA' },
}

const api = await import('./api.testable.mjs')

let fetchCount = 0
const origFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  fetchCount++
  return origFetch(url)
}

// 1. list fetch + per-shelter dedup: 5 calls across 2 shelters = 2 requests
const caspca = SHELTERS.caspca
const list = await api.getAvailableAnimals(caspca)
await Promise.all([
  api.getAvailableAnimals(caspca),
  api.getAvailableAnimals(caspca),
])
const fspcaList = await api.getAvailableAnimals(SHELTERS.fspca)
await api.getAvailableAnimals(SHELTERS.fspca)
assert.ok(Array.isArray(list) && list.length > 20, `caspca list healthy (${list.length})`)
assert.ok(Array.isArray(fspcaList) && fspcaList.length > 5, `fspca list healthy (${fspcaList.length})`)
assert.equal(fetchCount, 2, `dedup: expected 2 network calls (one per shelter), got ${fetchCount}`)

// 2. pick any animal to exercise the detail path (avoid hardcoding a name —
// that specific animal may already be adopted by the time this runs)
const subject = list.find((a) => a.public_url) ?? list[0]
assert.ok(subject, 'at least one animal available')

// 3. details come from the build-time snapshot: NO network may occur
const detail = api.getAnimalDetail(subject, caspca.id)
assert.ok(detail.videos !== undefined, 'videos field normalized')
assert.equal(fetchCount, 2, `details must be network-free, saw ${fetchCount} calls`)

// 4. an animal known to be in each snapshot must get its bio merged in
for (const [shelterId, snap] of Object.entries(snapshot)) {
  const snapId = Object.keys(snap).find((id) => snap[id].kennel_description)
  if (!snapId) continue
  const shelterList = shelterId === 'caspca' ? list : fspcaList
  const known = shelterList.find((a) => a.uniqueId === snapId)
  if (!known) continue
  const merged = api.getAnimalDetail(known, shelterId)
  assert.equal(
    merged.kennel_description,
    snap[snapId].kennel_description,
    `[${shelterId}] snapshot bio must be merged verbatim`,
  )
}

// 5. coverPhoto picks the isCover entry or falls back sanely
const cover = api.coverPhoto(subject)
assert.ok(cover && typeof cover.url === 'string', 'cover photo resolved')
const noPhotos = { ...subject, photos: {} }
assert.equal(api.coverPhoto(noPhotos), null, 'no photos -> null')

// 6. formatAge sanity (animals can be days, months, or years old)
const age = api.formatAge(subject)
if (age !== '') {
  assert.match(
    age,
    /\d+ (day|month|year)s? old/,
    `expected age format, got "${age}"`,
  )
}

console.log('All smoke tests passed.')
console.log(`  animals: ${list.length}, network calls: ${fetchCount}`)
console.log(`  ${subject.name} age: ${age}`)
console.log(`  bio (from snapshot): ${detail.kennel_description ? 'yes' : 'none yet'}`)
