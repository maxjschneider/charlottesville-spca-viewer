export type Route =
  | { view: 'list'; shelterId: string }
  | { view: 'animal'; shelterId: string; uniqueId: string }

/**
 * Hash-based routing — GitHub Pages can't rewrite request paths to
 * index.html, so SPA routes live after `#`.
 *
 *   #/                              -> CASPCA list (default shelter)
 *   #/fspca                         -> Fluvanna list
 *   #/animal/CHO-A-19267            -> detail (default shelter, legacy form)
 *   #/caspca/animal/CHO-A-19267     -> detail
 *   #/fspca/animal/FLVA-A-2042      -> detail
 */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '')
  const segments = path.split('/').filter(Boolean)

  const animalIdx = segments.indexOf('animal')
  if (animalIdx !== -1 && segments[animalIdx + 1]) {
    const uniqueId = decodeURIComponent(segments[animalIdx + 1])
    return { view: 'animal', shelterId: segments[animalIdx - 1] ?? 'caspca', uniqueId }
  }
  if (segments.length === 1) {
    return { view: 'list', shelterId: segments[0] }
  }
  return { view: 'list', shelterId: 'caspca' }
}

export function listHref(shelterId: string): string {
  return shelterId === 'caspca' ? '#/' : `#/${shelterId}`
}

export function animalHref(shelterId: string, uniqueId: string): string {
  return `${listHref(shelterId)}/animal/${encodeURIComponent(uniqueId)}`
}
