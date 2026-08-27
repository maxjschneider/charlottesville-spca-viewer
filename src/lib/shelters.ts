interface ShelterBase {
  /** Short id used in routes and file names. */
  id: string
  name: string
  /** Compact label for tabs. */
  short: string
}

export interface ShelterluvShelter extends ShelterBase {
  kind: 'shelterluv'
  /** Shelterluv GID (the /api/v3/available-animals/{gid} path segment). */
  gid: number
  /** Prefix in animal uniqueIds (CHO-A-123) and matchme form URLs. */
  prefix: string
}

/**
 * RescueGroups.org "Pet Adoption Toolkit" shelter. The toolkit is driven by
 * an embed key that RescueGroups scopes server-side — Nelson uses one key per
 * species page, so every animal from a key belongs to `species`.
 */
export interface RescueGroupsShelter extends ShelterBase {
  kind: 'rescuegroups'
  /** Toolkit embed key (e.g. yjYRO6T3), found in the page's toolkit.js URL. */
  toolkitKey: string
  /** RescueGroups internal account id, paired with the key in toolkit.js. */
  toolkitKeyID: string
  /** Lowercase species every animal from this key belongs to (e.g. 'cat'). */
  species: string
  /** The species-scoped adopt page on the shelter's own site. */
  public_url: string
  /** Adoption-process page used for the detail-view CTA. */
  adoptUrl: string
}

export type Shelter = ShelterluvShelter | RescueGroupsShelter

export const SHELTERS: Shelter[] = [
  {
    id: 'caspca',
    kind: 'shelterluv',
    name: 'Charlottesville-Albemarle SPCA',
    short: 'Charlottesville',
    gid: 2783,
    prefix: 'CHO',
  },
  {
    id: 'fspca',
    kind: 'shelterluv',
    name: 'Fluvanna SPCA',
    short: 'Fluvanna',
    gid: 4193,
    prefix: 'FLVA',
  },
  {
    id: 'nspca',
    kind: 'rescuegroups',
    name: 'Humane Society/SPCA of Nelson County',
    short: 'Nelson',
    toolkitKey: 'yjYRO6T3',
    toolkitKeyID: '8754',
    species: 'cat',
    public_url: 'https://nelsonspca.org/adopt/cats',
    adoptUrl: 'https://www.nelsonspca.org/adopt/adoption-process',
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
