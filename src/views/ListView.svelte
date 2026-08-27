<script lang="ts">
  import type { Animal } from '../lib/types'
  import { ageInMonths, getAvailableAnimals } from '../lib/api'
  import { loadFilters, saveFilters } from '../lib/filters'
  import { listHref } from '../lib/router'
  import { COMBINED_ID, SHELTERS, type Shelter } from '../lib/shelters'
  import AnimalCard from '../components/AnimalCard.svelte'

  type SortKey = 'newest' | 'oldest' | 'name' | 'posted'

  /** An animal tagged with the shelter it came from (needed in combined view). */
  type Entry = Animal & { shelter: Shelter }

  let { shelters, scopeId }: { shelters: Shelter[]; scopeId: string } = $props()

  // Restore the user's filters for the session (list ↔ detail navigation),
  // scoped per shelter (or combined view) since species mix and counts
  // differ. App remounts this component per scope (keyed), so reading the
  // initial value here is intentional.
  // svelte-ignore state_referenced_locally
  const saved = loadFilters(scopeId)

  let animals = $state<Entry[] | null>(null)
  let error = $state<string | null>(null)
  let partialError = $state<string | null>(null)
  let speciesFilter = $state(saved.species ?? 'all')
  let ageFilter = $state(saved.age ?? 'any')
  let search = $state(saved.search ?? '')
  let sortKey = $state<SortKey>((saved.sort as SortKey) ?? 'name')

  $effect(() => {
    saveFilters(scopeId, {
      species: speciesFilter,
      age: ageFilter,
      search,
      sort: sortKey,
    })
  })

  interface AgeBucket {
    key: string
    label: string
    test: (months: number) => boolean
  }

  const ageBuckets: AgeBucket[] = [
    { key: 'any', label: 'Any age', test: () => true },
    { key: 'under1', label: 'Under 1 year', test: (m) => m < 12 },
    { key: 'y1-3', label: '1–3 years', test: (m) => m >= 12 && m < 36 },
    { key: 'y3-7', label: '3–7 years', test: (m) => m >= 36 && m < 84 },
    { key: '7plus', label: '7+ years', test: (m) => m >= 84 },
  ]

  // Same as above: component is remounted per scope by App.
  // svelte-ignore state_referenced_locally
  Promise.allSettled(shelters.map((s) => getAvailableAnimals(s)))
    .then((results) => {
      const loaded: Entry[] = []
      let failures = 0
      for (let i = 0; i < shelters.length; i++) {
        const r = results[i]
        if (r.status === 'fulfilled') {
          for (const a of r.value) loaded.push({ ...a, shelter: shelters[i] })
        } else {
          failures++
        }
      }
      if (loaded.length === 0) {
        error = 'the upstream site may be down — try reloading'
        return
      }
      // Partial failure in combined view: keep what loaded, surface a note.
      partialError =
        failures > 0
          ? `Couldn't load ${failures} of ${shelters.length} shelters — showing the rest.`
          : null
      error = null
      animals = loaded
    })

  const speciesOptions = $derived([
    'all',
    ...[...new Set((animals ?? []).map((a) => a.species))].sort(),
  ])

  const visible = $derived.by(() => {
    if (!animals) return []
    const q = search.trim().toLowerCase()
    const bucket = ageBuckets.find((b) => b.key === ageFilter)
    let out = animals.filter((a) => {
      if (speciesFilter !== 'all' && a.species !== speciesFilter) return false
      if (bucket && bucket.key !== 'any') {
        const months = ageInMonths(a)
        if (months === null || !bucket.test(months)) return false
      }
      return (
        !q ||
        a.name.toLowerCase().includes(q) ||
        (a.breed ?? '').toLowerCase().includes(q)
      )
    })
    if (sortKey === 'name') {
      out = [...out].sort((a, b) => a.name.localeCompare(b.name))
    } else if (sortKey === 'posted') {
      // nid is Shelterluv's internal, monotonically increasing record ID —
      // the only reliable signal for when an animal was added to the site
      // (intake_date is staff-entered and doesn't track listing time).
      out = [...out].sort((a, b) => b.nid - a.nid)
    } else {
      out = [...out].sort(
        (a, b) =>
          Number(b.intake_date ?? b.nid) - Number(a.intake_date ?? a.nid),
      )
      if (sortKey === 'oldest') out.reverse()
    }
    return out
  })

  function counts(list: Animal[]): Map<string, number> {
    const map = new Map<string, number>()
    for (const a of list) map.set(a.species, (map.get(a.species) ?? 0) + 1)
    return map
  }
</script>

<div class="intro">
  <nav class="shelter-tabs" aria-label="Choose shelter">
    {#each SHELTERS as s (s.id)}
      <a
        class="shelter-tab"
        class:active={scopeId === s.id}
        href={listHref(s.id)}
      >
        {s.short}
      </a>
    {/each}
    <a
      class="shelter-tab"
      class:active={scopeId === COMBINED_ID}
      href={listHref(COMBINED_ID)}
    >
      Both
    </a>
  </nav>

  <header class="page-header">
    <h1>Adoptable pets</h1>
    <p class="subtitle">
      {shelters.map((s) => s.name).join(' + ')} &middot; data via Shelterluv
    </p>
  </header>

  <section class="controls">
  <div class="chips" role="group" aria-label="Filter by species">
    {#each speciesOptions as species (species)}
      <button
        class="chip"
        class:active={speciesFilter === species}
        onclick={() => (speciesFilter = species)}
      >
        {species === 'all'
          ? `All (${animals?.length ?? 0})`
          : `${species} (${counts(animals ?? []).get(species) ?? 0})`}
      </button>
    {/each}
  </div>
  <input
    class="search"
    type="search"
    placeholder="Search name or breed…"
    bind:value={search}
    aria-label="Search by name or breed"
  />
  <select bind:value={ageFilter} aria-label="Filter by age">
    {#each ageBuckets as bucket (bucket.key)}
      <option value={bucket.key}>{bucket.label}</option>
    {/each}
  </select>
  <select bind:value={sortKey} aria-label="Sort order">
    <option value="name">Name A–Z</option>
    <option value="posted">Newest listings</option>
    <option value="newest">Newest arrivals (intake)</option>
    <option value="oldest">Longest waiting (intake)</option>
  </select>
  </section>
</div>

<div class="listings">
  {#if error}
    <p class="status error" role="alert">
      Couldn't load the animal list: {error}
    </p>
  {:else if !animals}
    <p class="status">Loading adoptable pets…</p>
  {:else}
    {#if partialError}
      <p class="status partial" role="status">{partialError}</p>
    {/if}
    {#if visible.length === 0}
      <p class="status">No pets match those filters.</p>
    {:else}
      <div class="grid">
        {#each visible as animal (animal.uniqueId)}
          <AnimalCard {animal} shelter={animal.shelter} showShelter={scopeId === COMBINED_ID} />
        {/each}
      </div>
    {/if}
  {/if}
</div>
