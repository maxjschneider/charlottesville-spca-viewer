export interface Shelter {
  /** Short id used in routes and file names. */
  id: string
  name: string
  /** Compact label for tabs. */
  short: string
  /** Shelterluv GID (the /api/v3/available-animals/{gid} path segment). */
  gid: number
  /** Prefix in animal uniqueIds (CHO-A-123) and matchme form URLs. */
  prefix: string
}

export const SHELTERS: Shelter[] = [
  {
    id: 'caspca',
    name: 'Charlottesville-Albemarle SPCA',
    short: 'Charlottesville',
    gid: 2783,
    prefix: 'CHO',
  },
  {
    id: 'fspca',
    name: 'Fluvanna SPCA',
    short: 'Fluvanna',
    gid: 4193,
    prefix: 'FLVA',
  },
]

/** Pseudo-shelter id for the combined view. */
export const COMBINED_ID = 'all'

export const DEFAULT_SHELTER = SHELTERS[0]

export function shelterById(id: string | undefined | null): Shelter {
  return SHELTERS.find((s) => s.id === id) ?? DEFAULT_SHELTER
}

/** Shelters for a list-view scope: one shelter, or all of them combined. */
export function sheltersForScope(scopeId: string | undefined | null): Shelter[] {
  if (scopeId === COMBINED_ID) return SHELTERS
  return [shelterById(scopeId)]
}
