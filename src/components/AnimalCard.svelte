<script lang="ts">
  import type { Animal } from '../lib/types'
  import { coverPhoto, formatAge } from '../lib/api'
  import { animalHref } from '../lib/router'
  import type { Shelter } from '../lib/shelters'

  let {
    animal,
    shelter,
    showShelter = false,
  }: { animal: Animal; shelter: Shelter; showShelter?: boolean } = $props()

  const photo = $derived(coverPhoto(animal))
  const age = $derived(formatAge(animal))
  const breeds = $derived(
    [animal.breed, animal.secondary_breed].filter(Boolean).join(' / '),
  )
</script>

<a class="card" href={animalHref(shelter.id, animal.uniqueId)}>
  <div class="card-photo">
    {#if photo}
      <img src={photo.url} alt={animal.name} loading="lazy" />
    {:else}
      <div class="card-no-photo" aria-hidden="true">?</div>
    {/if}
  </div>
  <div class="card-body">
    <h3>{animal.name}</h3>
    <p class="card-sub">
      {animal.species} &middot; {animal.sex}{age ? ` · ${age}` : ''}{showShelter
        ? ` · ${shelter.short}`
        : ''}
    </p>
    {#if breeds}
      <p class="card-breeds">{breeds}</p>
    {/if}
  </div>
</a>
