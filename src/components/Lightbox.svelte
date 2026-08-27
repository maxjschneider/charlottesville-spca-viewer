<script lang="ts">
  import type { Photo } from '../lib/types'

  let {
    photos,
    startAt,
    alt,
    onclose,
  }: {
    photos: Photo[]
    startAt: number
    alt: string
    onclose: () => void
  } = $props()

  // Capturing initial values is intentional: the lightbox is mounted fresh
  // each time it opens (App renders it under {#if}).
  // svelte-ignore state_referenced_locally
  let index = $state(Math.min(startAt, photos.length - 1))

  const photo = $derived(photos[index])

  function prev(): void {
    index = (index - 1 + photos.length) % photos.length
  }

  function next(): void {
    index = (index + 1) % photos.length
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') onclose()
    else if (e.key === 'ArrowLeft') prev()
    else if (e.key === 'ArrowRight') next()
  }

  $effect(() => {
    window.addEventListener('keydown', onKey)
    // Freeze the page behind the overlay.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeBtn?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  })

  let closeBtn = $state<HTMLButtonElement | undefined>(undefined)
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<div
  class="lightbox"
  role="dialog"
  aria-modal="true"
  aria-label="Photo gallery"
  tabindex="-1"
  onclick={(e) => e.target === e.currentTarget && onclose()}
>
  <button class="lb-close" bind:this={closeBtn} onclick={onclose} aria-label="Close">
    ×
  </button>

  {#if photos.length > 1}
    <button class="lb-nav lb-prev" onclick={prev} aria-label="Previous photo">‹</button>
    <button class="lb-nav lb-next" onclick={next} aria-label="Next photo">›</button>
  {/if}

  <figure>
    <img src={photo.url} alt={alt} />
    <figcaption>
      {alt}{photos.length > 1 ? ` · ${index + 1} / ${photos.length}` : ''}
    </figcaption>
  </figure>
</div>
