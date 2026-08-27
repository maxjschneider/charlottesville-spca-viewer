import detailsCaspca from './details.caspca.json'
import detailsFspca from './details.fspca.json'
import type { Animal, AnimalDetail, Photo } from './types'
import type { Shelter } from './shelters'

/**
 * The only module that knows Shelterluv exists.
 *
 * Animal list: the `/api/v3/available-animals/{gid}` endpoint is undocumented
 * and unauthenticated. It is used exclusively by Shelterluv's own embed
 * widget and sends `Access-Control-Allow-Origin: *`, but we treat it as a
 * scarce, best-effort resource:
 *
 *  - one request per session for the full list (no polling),
 *  - a TTL cache in sessionStorage survives reloads and route churn,
 *  - concurrent callers share a single in-flight promise (dedup).
 *
 * Animal details (bio, fee, weight): Shelterluv's detail pages send NO CORS
 * headers, so browsers cannot read them. Instead, `scripts/fetch-details.mjs`
 * scrapes them server-side (locally or in the deploy workflow) and bakes
 * them into `details.json`, which is imported below — zero runtime requests.
 * Animals added since the last snapshot simply have no extra fields until
 * the next build refreshes it.
 */

/** Only detail-specific fields; everything else comes from the list API. */
interface DetailSnapshotEntry {
  kennel_description?: string
  adoptionFee?: string
  weight?: number | string
  weight_units?: string
  videos?: unknown[]
}

const DETAILS: Record<string, Record<string, DetailSnapshotEntry>> = {
  caspca: detailsCaspca,
  fspca: detailsFspca,
}

const API_BASE = 'https://new.shelterluv.com'

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

const listCacheKey = (gid: number) => `sl:list:${gid}`

/**
 * Fetch all available animals for a shelter. At most one network call per
 * shelter per session, refreshable at most every LIST_TTL_MS via reload.
 */
export function getAvailableAnimals(shelter: Shelter): Promise<Animal[]> {
  const cacheKey = listCacheKey(shelter.gid)
  const cached = readCache<Animal[]>(cacheKey, LIST_TTL_MS)
  if (cached) return Promise.resolve(cached.data)

  let pending = listPromises.get(shelter.id)
  pending ??= fetch(
    `${API_BASE}/api/v3/available-animals/${shelter.gid}`,
    { headers: { Accept: 'application/json' } },
  )
    .then((res) => {
      if (!res.ok) throw new Error(`Shelterluv responded ${res.status}`)
      return res.json() as Promise<{ animals: Animal[] }>
    })
    .then((body) => {
      writeCache(cacheKey, body.animals)
      return body.animals
    })
    .catch((err) => {
      // Allow a later retry; don't poison the shared promise with a failure.
      listPromises.delete(shelter.id)
      throw err
    })

  listPromises.set(shelter.id, pending)
  return pending
}

/**
 * Merge an animal's summary record with its build-time snapshot detail
 * (bio, fee, weight, videos). Synchronous and network-free: animals missing
 * from the snapshot (added after the last build) fall back to summary-only.
 */
export function getAnimalDetail(
  animal: Animal,
  shelterId: string,
): AnimalDetail {
  const extra = DETAILS[shelterId]?.[animal.uniqueId] ?? {}
  return {
    ...animal,
    kennel_description: extra.kennel_description,
    adoptionFee: extra.adoptionFee ?? null,
    weight: extra.weight ?? null,
    weight_units: extra.weight_units,
    videos: extra.videos ?? [],
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
