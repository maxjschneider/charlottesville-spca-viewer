/**
 * Smoke tests against the LIVE upstream list endpoints + the baked detail
 * snapshots. Run manually (`npm run smoke`), not in CI. Verifies the API
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
  nspca: JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../src/lib/details.nspca.json', import.meta.url)),
      'utf8',
    ),
  ),
}

const SHELTERS = {
  caspca: { id: 'caspca', name: 'CASPCA', kind: 'shelterluv', gid: 2783, prefix: 'CHO' },
  fspca: { id: 'fspca', name: 'Fluvanna SPCA', kind: 'shelterluv', gid: 4193, prefix: 'FLVA' },
  nspca: {
    id: 'nspca',
    name: 'Nelson County SPCA',
    kind: 'rescuegroups',
    toolkitKey: 'yjYRO6T3',
    toolkitKeyID: '8754',
    species: 'cat',
    public_url: 'https://nelsonspca.org/adopt/cats',
    adoptUrl: 'https://www.nelsonspca.org/adopt/adoption-process',
  },
}

const api = await import('./api.testable.mjs')

let fetchCount = 0
const origFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  fetchCount++
  return origFetch(url)
}

// 1. list fetch + per-shelter dedup: two passes over all shelters must
// cost exactly one logical fetch each (Nelson = one per grid page).
const lists = {}
for (const id of Object.keys(SHELTERS)) {
  lists[id] = await api.getAvailableAnimals(SHELTERS[id])
}
const afterFirstPass = fetchCount
for (const id of Object.keys(SHELTERS)) {
  await api.getAvailableAnimals(SHELTERS[id])
}
assert.equal(fetchCount, afterFirstPass, `dedup: second pass added no calls (pass 1: ${afterFirstPass})`)

const list = lists.caspca
const fspcaList = lists.fspca
const nspcaList = lists.nspca
assert.ok(Array.isArray(list) && list.length > 20, `caspca list healthy (${list.length})`)
assert.ok(Array.isArray(fspcaList) && fspcaList.length > 5, `fspca list healthy (${fspcaList.length})`)
assert.ok(Array.isArray(nspcaList) && nspcaList.length > 20, `nspca list healthy (${nspcaList.length})`)
const expectedCalls =
  2 + Math.ceil(nspcaList.length / 24) /* one request per toolkit grid page */
assert.equal(
  afterFirstPass,
  expectedCalls,
  `network budget: expected ${expectedCalls} calls for pass 1, got ${afterFirstPass}`,
)
assert.ok(
  nspcaList.every((a) => a.species === 'cat' && /^\d+$/.test(a.uniqueId)),
  'nspca records normalized (species from toolkit scoping, numeric ids)',
)

// 2. pick animals to exercise the detail paths (avoid hardcoding names —
// those specific animals may already be adopted by the time this runs)
const subject = list.find((a) => a.public_url) ?? list[0]
assert.ok(subject, 'at least one caspca animal available')
const nelsonSubject =
  nspcaList.find((a) => snapshot.nspca[a.uniqueId]?.kennel_description) ??
  nspcaList[0]
assert.ok(nelsonSubject, 'at least one nspca animal available')

// 3. details come from the build-time snapshot: NO network may occur
const detail = api.getAnimalDetail(subject, 'caspca')
assert.ok(detail.videos !== undefined, 'videos field normalized')
const nelsonDetail = api.getAnimalDetail(nelsonSubject, 'nspca')
assert.ok(
  Object.keys(nelsonDetail.photos ?? {}).length >= 1,
  'nspca detail has at least the cover photo',
)
assert.equal(fetchCount, afterFirstPass, `details must be network-free, saw ${fetchCount} calls`)

// 4. an animal known to be in each snapshot must get its fields merged in.
// Shelterluv snapshots carry the bio; RescueGroups snapshots additionally
// supply summary fields (sex/breed/age), which the list itself must
// already reflect.
for (const [shelterId, snap] of Object.entries(snapshot)) {
  const snapId = Object.keys(snap).find((id) => snap[id].kennel_description)
  if (!snapId) continue
  const shelterList = lists[shelterId]
  const known = shelterList.find((a) => a.uniqueId === snapId)
  if (!known) continue
  const merged = api.getAnimalDetail(known, shelterId)
  assert.equal(
    merged.kennel_description,
    snap[snapId].kennel_description,
    `[${shelterId}] snapshot bio must be merged verbatim`,
  )
  if (SHELTERS[shelterId].kind === 'rescuegroups') {
    assert.ok(known.breed, `[${shelterId}] snapshot breed folded into summary`)
    assert.ok(known.sex, `[${shelterId}] snapshot sex folded into summary`)
    assert.ok(known.age_group, `[${shelterId}] snapshot age folded into summary`)
  }
}

// 5. coverPhoto picks the isCover entry or falls back sanely
const cover = api.coverPhoto(subject)
assert.ok(cover && typeof cover.url === 'string', 'cover photo resolved')
const nelsonCover = api.coverPhoto(nelsonSubject)
assert.ok(nelsonCover && nelsonCover.isCover, 'nspca cover photo resolved')
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
const nelsonAge = api.formatAge(nelsonSubject)
assert.match(
  nelsonAge,
  /\d+ (day|month|year)s? old/,
  `nspca estimated age format, got "${nelsonAge}"`,
)

console.log('All smoke tests passed.')
console.log(
  `  animals: caspca ${list.length}, fspca ${fspcaList.length}, nspca ${nspcaList.length}; network calls: ${fetchCount}`,
)
console.log(`  ${subject.name} age: ${age}`)
console.log(`  ${nelsonSubject.name} (nspca) age: ${nelsonAge}`)
console.log(`  bio (from snapshot): ${detail.kennel_description ? 'yes' : 'none yet'}`)
