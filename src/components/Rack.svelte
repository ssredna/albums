<script lang="ts">
  import type { Album } from '../lib/spotify';
  import Spine from './Spine.svelte';
  import { playAlbum } from '../lib/player.svelte';

  type Sort = 'added' | 'artist' | 'title' | 'year';

  let { albums, onsignout }: { albums: Album[]; onsignout: () => void } = $props();

  const SORT_KEY = 'rack:sort';
  let sort = $state<Sort>(readSort());
  let openId = $state<string | null>(null);

  function readSort(): Sort {
    try {
      const saved = localStorage.getItem(SORT_KEY);
      if (saved === 'added' || saved === 'artist' || saved === 'title' || saved === 'year') return saved;
    } catch {}
    return 'added';
  }

  $effect(() => {
    try {
      localStorage.setItem(SORT_KEY, sort);
    } catch {}
  });

  // Record-store convention: "The Beatles" files under B.
  const sortName = (artist: string) => artist.replace(/^the\s+/i, '');
  const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

  const comparators: Record<Sort, (a: Album, b: Album) => number> = {
    added: (a, b) => b.addedAt.localeCompare(a.addedAt),
    artist: (a, b) => compare(sortName(a.artists), sortName(b.artists)) || a.year.localeCompare(b.year),
    title: (a, b) => compare(a.name, b.name),
    year: (a, b) => b.year.localeCompare(a.year) || compare(sortName(a.artists), sortName(b.artists)),
  };

  const sorted = $derived([...albums].sort(comparators[sort]));

  // Shelves are packed once for the current width, so pulling a record out only nudges its own
  // shelf-mates (off the edge of the screen) and never reflows the other shelves.
  type Item = { album: Album; width: number; side: 'left' | 'right' };

  const GAP = 1;
  // Thicker spines for longer records, like a real shelf.
  const spineWidth = (album: Album) => Math.min(46, Math.max(24, 20 + album.tracks * 1.2));

  let available = $state(0);
  const shelves = $derived(pack(sorted, available));

  function pack(albums: Album[], available: number): Item[][] {
    if (!available) return [];
    const shelves: Album[][] = [];
    let shelf: Album[] = [];
    let used = 0;
    for (const album of albums) {
      const width = spineWidth(album);
      if (shelf.length && used + GAP + width > available) {
        shelves.push(shelf);
        shelf = [];
        used = 0;
      }
      used += (shelf.length ? GAP : 0) + width;
      shelf.push(album);
    }
    if (shelf.length) shelves.push(shelf);
    return shelves.map((shelf, i) => layout(shelf, available, i < shelves.length - 1));
  }

  // Full shelves are stretched slightly so every shelf ends flush with the edge.
  function layout(shelf: Album[], available: number, stretch: boolean): Item[] {
    const natural = shelf.reduce((sum, album) => sum + spineWidth(album), 0);
    const scale = stretch ? (available - GAP * (shelf.length - 1)) / natural : 1;
    let x = 0;
    return shelf.map((album) => {
      const width = spineWidth(album) * scale;
      const side = x + width / 2 < available / 2 ? 'right' : 'left';
      x += width + GAP;
      return { album, width, side };
    });
  }

  // A record in the right half swings out to the left: shift the shelf left by as much as the
  // record grows, so everything to its right stays put.
  function shift(shelf: Item[]) {
    const item = shelf.find((i) => i.album.id === openId);
    return item?.side === 'left' ? `translateX(calc(${item.width}px - var(--h)))` : undefined;
  }

  function closeOnOutsideClick(e: MouseEvent) {
    if (openId && !(e.target as Element).closest('.slot')) openId = null;
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (openId = null)} onclick={closeOnOutsideClick} />

<header>
  <h1>Albums <span class="muted">{albums.length}</span></h1>
  <div class="controls">
    <label>
      <span class="visually-hidden">Sort by</span>
      <select bind:value={sort}>
        <option value="added">Recently added</option>
        <option value="artist">Artist</option>
        <option value="title">Title</option>
        <option value="year">Release year</option>
      </select>
    </label>
    <button class="link" onclick={onsignout}>Sign out</button>
  </div>
</header>

{#if albums.length === 0}
  <main class="center"><p class="muted">No saved albums yet. Save some in Spotify and come back.</p></main>
{:else}
  <main class="rack">
    <div class="measure" bind:clientWidth={available}></div>
    {#each shelves as shelf}
      <div class="shelf">
        <div class="clip">
          <div class="row" role="list" style:transform={shift(shelf)}>
            {#each shelf as { album, width, side } (album.id)}
              <Spine
                {album}
                {width}
                {side}
                open={openId === album.id}
                ontoggle={() => (openId = openId === album.id ? null : album.id)}
                onplay={(from) => {
                  playAlbum(album, from);
                  openId = null;
                }}
              />
            {/each}
          </div>
        </div>
      </div>
    {/each}
  </main>
{/if}

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 28px var(--gutter) 8px;
  }

  h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  h1 .muted {
    font-weight: 400;
    margin-left: 6px;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  select {
    font: inherit;
    font-size: 0.875rem;
    color: var(--text);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 5px 8px;
  }

  .rack {
    padding: 40px 0 160px; /* room for the player dock */
  }

  .measure {
    height: 0;
    margin: 0 var(--gutter);
  }

  .shelf {
    position: relative;
    margin-bottom: 64px;
  }

  /* The board runs the full width of the window, as if the shelf carries on past it. */
  .shelf::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    height: 14px;
    background: linear-gradient(var(--board-top) 0 2px, var(--board-face) 2px);
    box-shadow: 0 10px 14px -8px var(--board-shadow);
  }

  /* Records pushed past the window edge disappear, without clipping the lift above the shelf. */
  .clip {
    overflow-x: clip;
  }

  .row {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: var(--h);
    padding: 0 var(--gutter);
    transition: transform var(--turn) var(--ease);
  }
</style>
