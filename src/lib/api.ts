import detailsCaspca from './details.caspca.json'
import detailsFspca from './details.fspca.json'
import detailsNspca from './details.nspca.json'
import type { Animal, AnimalDetail, Photo } from './types'
import type { RescueGroupsShelter, Shelter, ShelterluvShelter } from './shelters'

/**
 * The only module that knows which adoption platforms exist.
 *
 * Shelterluv shelters (CASPCA, Fluvanna): animal list comes from the
 * undocumented `/api/v3/available-animals/{gid}` endpoint used by
 * Shelterluv's own embed widget. It sends `Access-Control-Allow-Origin: *`,
 * but we treat it as a scarce, best-effort resource:
 *
 *  - one request per session for the full list (no polling),
 *  - a TTL cache in sessionStorage survives reloads and route churn,
 *  - concurrent callers share a single in-flight promise (dedup).
 *
 * RescueGroups shelters (Nelson): the shelter's site embeds the Pet
 * Adoption Toolkit, whose list/detail pages are server-rendered HTML at
 * toolkit.rescuegroups.org (also CORS-open). The grid fragment only carries
 * name + photo + internal id, so the remaining summary fields (sex, breed,
 * age) come from the build-time snapshot below, rebuilt every few hours by
 * scripts/fetch-details.mjs.
 *
 * Details (bio, fee, weight): neither platform serves browsers a usable
 * JSON detail API, so scripts/fetch-details.mjs scrapes detail pages
 * server-side (locally or in the deploy workflow) and bakes them into
 * details.json, imported below — zero runtime requests. Animals added
 * since the last snapshot simply have no extra fields until the next
 * build refreshes it.
 */

/** Only detail-specific fields; everything else comes from the list fetch. */
interface DetailSnapshotEntry {
  kennel_description?: string
  adoptionFee?: string
  weight?: number | string
  weight_units?: string
  videos?: unknown[]
  /**
   * RescueGroups-only: summary fields the toolkit grid doesn't publish.
   * Merged into list results at fetch time so cards and filters work.
   */
  sex?: string
  breed?: string
  age_category?: string
  location?: string
  /** The shelter's own "Pet ID #", as opposed to our internal uniqueId. */
  rescue_id?: string
  /** Gallery URLs beyond the grid's cover photo. */
  extra_photos?: string[]
}

const DETAILS: Record<string, Record<string, DetailSnapshotEntry>> = {
  caspca: detailsCaspca,
  fspca: detailsFspca,
  nspca: detailsNspca,
}

const SHELTERLUV_BASE = 'https://new.shelterluv.com'
const RG_TOOLKIT_BASE = 'https://toolkit.rescuegroups.org/j/3'

const LIST_TTL_MS = 15 * 60 * 1000

interface CacheEnvelope<T> {
  fetchedAt: number
  data: T
}

function readCache<T>(key: string, ttlMs: number): CacheEnvelope<T> | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const env = JSON.parse(raw) as CacheEnvelope<T>
    if (Date.now() - env.fetchedAt > ttlMs) return null
    return env
  } catch {
    return null
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), data }))
  } catch {
    // Private browsing / quota: caching is an optimization, never a requirement.
  }
}

// In-flight promise dedup per shelter + in-memory fallback when
// sessionStorage is unavailable.
const listPromises = new Map<string, Promise<Animal[]>>()

/**
 * Fetch all available animals for a shelter. At most one list fetch per
 * shelter per session (RescueGroups counts paginated pages as one logical
 * fetch), refreshable at most every LIST_TTL_MS via reload.
 */
export function getAvailableAnimals(shelter: Shelter): Promise<Animal[]> {
  const cacheKey = `list:${shelter.id}`
  const cached = readCache<Animal[]>(cacheKey, LIST_TTL_MS)
  if (cached) return Promise.resolve(cached.data)

  let pending = listPromises.get(shelter.id)
  pending ??= (shelter.kind === 'shelterluv'
    ? fetchShelterluvList(shelter)
    : fetchRescueGroupsList(shelter)
  )
    .then((animals) => {
      writeCache(cacheKey, animals)
      return animals
    })
    .catch((err) => {
      // Allow a later retry; don't poison the shared promise with a failure.
      listPromises.delete(shelter.id)
      throw err
    })

  listPromises.set(shelter.id, pending)
  return pending
}

async function fetchShelterluvList(shelter: ShelterluvShelter): Promise<Animal[]> {
  const res = await fetch(
    `${SHELTERLUV_BASE}/api/v3/available-animals/${shelter.gid}`,
    { headers: { Accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`Shelterluv responded ${res.status}`)
  const body = (await res.json()) as { animals: Animal[] }
  return body.animals
}

/** The toolkit's grid fragment shows 24 animals per page. */
const RG_PAGE_SIZE = 24
const RG_MAX_PAGES = 25

interface RgCell {
  /** RescueGroups internal animal id (increases as animals are added). */
  id: string
  name: string
  photo: string | null
}

/**
 * Parse one grid3_layout.php HTML fragment. Regex-based rather than
 * DOMParser because scripts/fetch-details.mjs runs the same parse in Node.
 * The markup is machine-generated and has been stable for years; each cell
 * carries the id twice (picture + name links), so dedupe by id.
 */
function rgParseGrid(html: string): { total: number; cells: RgCell[] } {
  const total = Number(
    html.match(/([\d,]+)\s+pets found/i)?.[1]?.replace(/,/g, '') ?? 0,
  )
  const cells: RgCell[] = []
  const seen = new Set<string>()
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

/**
 * Rough midpoints of the toolkit's age categories, in whole months. The
 * exact birthday isn't published; these estimates keep card ages, age
 * filters and sorting working. The detail view shows the honest category
 * (via age_group) instead of a fabricated date.
 */
const RG_AGE_MONTHS: Record<string, number> = {
  Baby: 3,
  Young: 15,
  Adult: 54,
  Senior: 96,
}

/** "Male (neutered)" / "Female (not spayed)" -> "Male" / "Female". */
function normalizeRgSex(sex: string): string {
  return sex.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function rgCellToAnimal(
  shelter: RescueGroupsShelter,
  cell: RgCell,
): Animal {
  const animal: Animal = {
    name: cell.name,
    adoptable: 1,
    breed: null,
    secondary_breed: null,
    primary_color: null,
    secondary_color: null,
    sex: '',
    species: shelter.species,
    birthday: null,
    intake_date: null,
    location: null,
    campus: null,
    weight_group: null,
    uniqueId: cell.id,
    nid: Number(cell.id),
    public_url: shelter.public_url,
    photos: cell.photo
      ? {
          '0': {
            id: 0,
            name: cell.name,
            url: cell.photo,
            isCover: true,
            order_column: 0,
          },
        }
      : {},
  }
  // The grid only publishes name + photo. Fold in whatever the snapshot
  // already knows; animals added since the last build degrade to
  // name + species + photo until the next refresh, like detail data.
  const extra = DETAILS[shelter.id]?.[cell.id]
  if (extra) {
    if (extra.sex) animal.sex = normalizeRgSex(extra.sex)
    if (extra.breed) animal.breed = extra.breed
    if (extra.location) animal.location = extra.location
    if (extra.age_category) {
      animal.age_group = {
        id: 0,
        name: extra.age_category,
        name_with_duration: extra.age_category,
      }
      const months = RG_AGE_MONTHS[extra.age_category]
      if (months) {
        animal.birthday = Math.floor(Date.now() / 1000 - months * 30.44 * 86_400)
      }
    }
  }
  return animal
}

async function fetchRescueGroupsList(
  shelter: RescueGroupsShelter,
): Promise<Animal[]> {
  const cells: RgCell[] = []
  const seen = new Set<string>()
  let total = Infinity
  for (let page = 1; cells.length < total && page <= RG_MAX_PAGES; page++) {
    const res = await fetch(
      `${RG_TOOLKIT_BASE}/grid3_layout.php?toolkitKey=${shelter.toolkitKey}` +
        `&toolkitKeyID=${shelter.toolkitKeyID}&page_=${page}`,
      { headers: { Accept: 'text/html' } },
    )
    if (!res.ok) throw new Error(`RescueGroups responded ${res.status}`)
    const parsed = rgParseGrid(await res.text())
    total = parsed.total
    for (const cell of parsed.cells) {
      if (!seen.has(cell.id)) {
        seen.add(cell.id)
        cells.push(cell)
      }
    }
  }
  return cells.map((cell) => rgCellToAnimal(shelter, cell))
}

/**
 * Merge an animal's summary record with its build-time snapshot detail
 * (bio, fee, weight, videos, gallery photos). Synchronous and network-free:
 * animals missing from the snapshot (added after the last build) fall back
 * to summary-only.
 */
export function getAnimalDetail(
  animal: Animal,
  shelterId: string,
): AnimalDetail {
  const extra = DETAILS[shelterId]?.[animal.uniqueId] ?? {}
  const photos: Record<string, Photo> = { ...animal.photos }
  const extras = extra.extra_photos ?? []
  for (let i = 0; i < extras.length; i++) {
    const url = extras[i]
    if (Object.values(photos).some((p) => p.url === url)) continue
    const id = 100 + i
    photos[id] = { id, name: `photo ${i + 1}`, url, isCover: false, order_column: id }
  }
  return {
    ...animal,
    photos,
    kennel_description: extra.kennel_description,
    adoptionFee: extra.adoptionFee ?? null,
    weight: extra.weight ?? null,
    weight_units: extra.weight_units,
    videos: extra.videos ?? [],
    rescue_id: extra.rescue_id,
  }
}

/** Pick the best display photo: marked cover first, then lowest order_column. */
export function coverPhoto(animal: Animal): Photo | null {
  const photos = Object.values(animal.photos ?? {})
  if (photos.length === 0) return null
  return (
    photos.find((p) => p.isCover) ??
    photos.reduce((a, b) => (a.order_column <= b.order_column ? a : b))
  )
}

/** Human-friendly age derived from the birthday timestamp. */
export function formatAge(animal: Animal): string {
  const birthday = Number(animal.birthday) * 1000
  if (!birthday || Number.isNaN(birthday)) return ''
  const days = Math.floor((Date.now() - birthday) / 86_400_000)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} old`
  const months = Math.floor(days / 30.44)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} old`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} old`
}

/** Age in whole months, or null when the birthday is missing/invalid. */
export function ageInMonths(animal: Animal): number | null {
  const birthday = Number(animal.birthday) * 1000
  if (!birthday || Number.isNaN(birthday)) return null
  const days = Math.floor((Date.now() - birthday) / 86_400_000)
  if (days < 0) return null
  return Math.floor(days / 30.44)
}

/** "In care since" date from an intake unix timestamp (seconds). */
export function formatDate(unixSeconds: number | string | null | undefined): string {
  const ms = Number(unixSeconds ?? 0) * 1000
  if (!ms || Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
