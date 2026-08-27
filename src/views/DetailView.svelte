<script lang="ts">
  import type { Animal, AnimalDetail } from '../lib/types'
  import { formatDate, formatAge, getAnimalDetail, getAvailableAnimals } from '../lib/api'
  import type { Shelter } from '../lib/shelters'
  import Lightbox from '../components/Lightbox.svelte'

  let { uniqueId, shelter }: { uniqueId: string; shelter: Shelter } = $props()

  let lightboxAt = $state<number | null>(null)

  let summary = $state<Animal | null>(null)
  let detail = $state<AnimalDetail | null>(null)
  let loadError = $state<string | null>(null)

  // detail.photos is the summary's photos plus any extra gallery URLs the
  // build-time snapshot scraped from the animal's detail page.
  const photos = $derived(
    detail
      ? Object.values(detail.photos ?? {}).sort(
          (a, b) => Number(b.isCover) - Number(a.isCover) || a.order_column - b.order_column,
        )
      : [],
  )

  // Bios are plain text rendered with escaping (never {@html}); the only tag
  // upstream uses is <br>, which we translate to a newline for pre-line.
  const bioHtml = $derived(
    (detail?.kennel_description ?? '').replace(/<br\s*\/?>/gi, '\n'),
  )

  const colors = $derived(
    [summary?.primary_color, summary?.secondary_color].filter(Boolean).join(' / '),
  )

  const fee = $derived.by(() => {
    const raw = detail?.adoptionFee
    if (raw == null || raw === '') return ''
    const text = String(raw)
    return text.startsWith('$') ? text : `$${text}`
  })

  const intakeDate = $derived(formatDate(summary?.intake_date))

  // videos entries have no documented shape; accept url-bearing objects or
  // bare URL strings and skip anything we can't interpret.
  function videoId(v: unknown): string | null {
    let url: string | undefined
    if (typeof v === 'string') url = v
    else if (v && typeof v === 'object' && 'url' in v && typeof v.url === 'string')
      url = v.url
    else if (
      v &&
      typeof v === 'object' &&
      'video_url' in v &&
      typeof v.video_url === 'string'
    )
      url = v.video_url
    if (!url) return null
    return (
      url.match(/youtube\.com\/(?:watch\?v=|embed\/)([\w-]+)/)?.[1] ??
      url.match(/youtu\.be\/([\w-]+)/)?.[1] ??
      null
    )
  }

  const videoIds = $derived((detail?.videos ?? []).map(videoId).filter(Boolean))

  async function load(): Promise<void> {
    try {
      const list = await getAvailableAnimals(shelter)
      const found = list.find((a) => a.uniqueId === uniqueId) ?? null
      if (!found) {
        loadError =
          'That animal is no longer in the available list — it may have found a home!'
        return
      }
      summary = found
      detail = getAnimalDetail(found, shelter.id)
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err)
    }
  }

  // Refetch when navigating between animals without unmounting.
  $effect(() => {
    uniqueId
    summary = null
    detail = null
    loadError = null
    void load()
  })
</script>

{#if loadError}
  <p class="status error" role="alert">{loadError}</p>
  <a class="back" href="#/">← Back to all pets</a>
{:else if !summary}
  <p class="status">Loading…</p>
{:else}
  <a class="back" href="#/">← Back to all pets</a>

  <article class="detail">
    <header>
      <h1>{summary.name}</h1>
      <p class="detail-sub">
        {[
          summary.species,
          summary.sex,
          summary.breed,
          summary.secondary_breed,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </header>

    <div class="detail-facts">
      {#if summary.age_group?.name_with_duration}
        <span>{summary.age_group.name_with_duration}</span>
      {:else if formatAge(summary)}
        <span>{formatAge(summary)}</span>
      {/if}
      {#if colors}
        <span>Color: {colors}</span>
      {/if}
      {#if detail?.weight != null && detail.weight !== ''}
        <span>
          Weight:
          {detail.weight}{detail.weight_units ? ` ${detail.weight_units}` : ''}
        </span>
      {:else if summary.weight_group}
        <span>{summary.weight_group}</span>
      {/if}
      {#if summary.location}<span>Location: {summary.location}</span>{/if}
      {#if summary.campus && summary.campus !== 'Main Campus'}
        <span>Campus: {summary.campus}</span>
      {/if}
      {#if fee}
        <span>Adoption fee: {fee}</span>
      {/if}
      {#if intakeDate}
        <span>In care since {intakeDate}</span>
      {/if}
    </div>

    <p class="kennel-id">Shelter ID: {detail?.rescue_id ?? summary.uniqueId}</p>

    {#if photos.length > 0}
      <div class="gallery">
        {#each photos as photo, i (photo.id)}
          <button
            class="gallery-thumb"
            type="button"
            onclick={() => (lightboxAt = i)}
            aria-label={`View photo ${i + 1} of ${summary.name} full size`}
          >
            <img src={photo.url} alt={`${summary.name} — ${photo.name}`} loading="lazy" />
          </button>
        {/each}
      </div>
    {/if}

    {#if videoIds.length > 0}
      <div class="video-grid">
        {#each videoIds as id (id)}
          <iframe
            src={`https://www.youtube.com/embed/${id}`}
            title="Video of {summary.name}"
            allowfullscreen
            loading="lazy"
          ></iframe>
        {/each}
      </div>
    {/if}

    {#if bioHtml}
      <!-- API returns plain text with occasional HTML entities; svelte escapes it. -->
      <p class="bio">{bioHtml}</p>
    {/if}

    <div class="cta-row">
      {#if shelter.kind === 'shelterluv'}
        <a
          class="adopt-cta"
          href={`https://new.shelterluv.com/matchme/adopt/${shelter.prefix}/${encodeURIComponent(summary.species)}`}
          target="_blank"
          rel="noreferrer"
        >
          Fill out the adoption interest form ↗
        </a>
      {:else}
        <a
          class="adopt-cta"
          href={shelter.adoptUrl}
          target="_blank"
          rel="noreferrer"
        >
          Adoption process ↗
        </a>
      {/if}
      <a class="adopt-cta" href={summary.public_url} target="_blank" rel="noreferrer">
        Original listing ↗
      </a>
    </div>
  </article>

  {#if lightboxAt !== null}
    <Lightbox
      {photos}
      startAt={lightboxAt}
      alt={summary.name}
      onclose={() => (lightboxAt = null)}
    />
  {/if}
{/if}
