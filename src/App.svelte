<script lang="ts">
  import { parseHash, type Route } from './lib/router'
  import { shelterById, sheltersForScope } from './lib/shelters'
  import ListView from './views/ListView.svelte'
  import DetailView from './views/DetailView.svelte'

  let route = $state<Route>(parseHash(location.hash))
  let splitEl = $state<HTMLDivElement | undefined>(undefined)

  const shelter = $derived(shelterById(route.shelterId))
  const shelters = $derived(
    route.view === 'list' ? sheltersForScope(route.shelterId) : [shelter],
  )
  const scopeId = $derived(route.shelterId)

  // Breakpoint must match the `.split` media query in app.css.
  const desktop = window.matchMedia('(min-width: 64rem)')

  $effect(() => {
    const onHashChange = () => {
      route = parseHash(location.hash)
      // On mobile, entering an animal view should start at the top; on
      // desktop the list stays put while the detail pane updates.
      if (!(route.view === 'animal' && desktop.matches)) window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  })

  // On desktop, top-align the detail pane with the first row of cards (i.e.
  // below the list's header/controls, whose height varies with wrapping).
  // The offset is published as --listings-top for the CSS to consume.
  // We measure `.listings` (always rendered, unlike `.grid` which is absent
  // while loading) — its top edge coincides with the grid's when unscrolled.
  $effect(() => {
    if (route.view !== 'animal' || !splitEl) return
    const intro = splitEl.querySelector<HTMLElement>('.intro')
    const listings = splitEl.querySelector<HTMLElement>('.listings')
    if (!intro || !listings) return

    const update = () => {
      if (!splitEl) return
      const delta =
        listings.getBoundingClientRect().top - splitEl.getBoundingClientRect().top
      splitEl.style.setProperty(
        '--listings-top',
        `${Math.max(0, Math.round(delta))}px`,
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(intro)
    observer.observe(listings)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  })
</script>

<main>
  {#if route.view === 'animal'}
    <div class="split" bind:this={splitEl}>
      <section class="list-pane">
        {#key `${route.shelterId}:list`}
          <ListView {shelters} scopeId={scopeId} />
        {/key}
      </section>
      <aside class="detail-pane">
        {#key `${route.shelterId}:${route.uniqueId}`}
          <DetailView uniqueId={route.uniqueId} {shelter} />
        {/key}
      </aside>
    </div>
  {:else}
    {#key `${route.shelterId}:list`}
      <ListView {shelters} scopeId={scopeId} />
    {/key}
  {/if}
</main>

<footer class="site-footer">
  <p>
    Unofficial viewer for the
    <a href="https://caspca.org" target="_blank" rel="noreferrer"
      >Charlottesville-Albemarle SPCA</a
    >. Please
    <a href="https://caspca.org/adopt/" target="_blank" rel="noreferrer"
      >visit their site</a
    >
    to adopt or support them.
  </p>
</footer>
