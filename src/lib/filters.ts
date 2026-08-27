/**
 * Persist list-view filter state for the browser session so navigating to a
 * detail page (which unmounts the ListView) doesn't reset the user's
 * filters. sessionStorage keeps it private per tab.
 */

const KEY_PREFIX = 'caspca-viewer:filters'

export interface ViewFilters {
  species: string
  age: string
  search: string
  sort: string
}

export function loadFilters(shelterId: string): Partial<ViewFilters> {
  try {
    const raw = sessionStorage.getItem(`${KEY_PREFIX}:${shelterId}`)
    return raw ? (JSON.parse(raw) as Partial<ViewFilters>) : {}
  } catch {
    return {}
  }
}

export function saveFilters(shelterId: string, filters: ViewFilters): void {
  try {
    sessionStorage.setItem(
      `${KEY_PREFIX}:${shelterId}`,
      JSON.stringify(filters),
    )
  } catch {
    // Caching is an optimization, never a requirement.
  }
}
