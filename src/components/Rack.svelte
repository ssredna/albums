<script lang="ts">
  import type { Album } from '../lib/spotify';
  import Spine from './Spine.svelte';
  import { playAlbum } from '../lib/player.svelte';
  import { canHover } from '../lib/hover';
  import { preloadCover } from '../lib/covers';

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
  // shelf-mates and never reflows the other shelves.
  type Item = { album: Album; width: number; side: 'left' | 'right' };
  // `room` is what the closed spines of a hover shelf squeeze into while one of them is open.
  type Shelf = { items: Item[]; room: number | null };

  const GAP = 1;
  const MIN_SPINE = 24;
  // Thicker spines for longer records, like a real shelf.
  const spineWidth = (album: Album) => Math.min(46, Math.max(MIN_SPINE, 20 + album.tracks * 1.2));

  let available = $state(0);
  let coverSize = $state(0);
  const hover = $derived(canHover.current);
  const shelves = $derived(pack(sorted, available, coverSize, hover));

  // With a mouse, shelves leave room for one cover, so a record opens without pushing its
  // shelf-mates off the edge. On touch, shelves are full and the open record pushes them aside.
  function pack(albums: Album[], available: number, coverSize: number, hover: boolean): Shelf[] {
    if (!available || !coverSize) return [];
    const budget = hover ? Math.max(available - coverSize + MIN_SPINE, MIN_SPINE) : available;
    const shelves: Album[][] = [];
    let shelf: Album[] = [];
    let used = 0;
    for (const album of albums) {
      const width = spineWidth(album);
      if (shelf.length && used + GAP + width > budget) {
        shelves.push(shelf);
        shelf = [];
        used = 0;
      }
      used += (shelf.length ? GAP : 0) + width;
      shelf.push(album);
    }
    if (shelf.length) shelves.push(shelf);
    return shelves.map((shelf, i) => {
      const full = i < shelves.length - 1;
      const gaps = GAP * (shelf.length - 1);
      const natural = shelf.reduce((sum, album) => sum + spineWidth(album), 0);
      if (!hover) return { items: layout(shelf, available, full ? (available - gaps) / natural : 1, false), room: null };
      // Stretch so that opening an average record fills the shelf; `room` evens out the rest.
      const scale = full ? (available - coverSize - gaps) / (natural - natural / shelf.length) : 1;
      return { items: layout(shelf, available, scale, true), room: full ? available - coverSize - gaps : null };
    });
  }

  function layout(shelf: Album[], available: number, scale: number, hover: boolean): Item[] {
    let x = 0;
    return shelf.map((album) => {
      const width = spineWidth(album) * scale;
      // Hover shelves always open rightwards into their spare room, so the cover stays under the mouse.
      const side = hover || x + width / 2 < available / 2 ? 'right' : 'left';
      x += width + GAP;
      return { album, width, side };
    });
  }

  // While a record on a full hover shelf is open, its shelf-mates share what's left exactly.
  function widthOf(shelf: Shelf, item: Item, openAlbum: string | null) {
    const open = shelf.items.find((i) => i.album.id === openAlbum);
    if (!open || open === item || shelf.room === null) return item.width;
    const rest = shelf.items.reduce((sum, i) => sum + i.width, 0) - open.width;
    return (item.width * shelf.room) / rest;
  }

  // A record in the right half swings out to the left: shift the shelf left by as much as the
  // record grows, so everything to its right stays put.
  function shift(shelf: Shelf) {
    const item = shelf.items.find((i) => i.album.id === openId);
    return item?.side === 'left' ? `translateX(calc(${item.width}px - var(--h)))` : undefined;
  }

  // Hovering leafs through a shelf like a finger along the records. An open cover holds the mouse
  // until it crosses one of the cover's edges, which leafs on to the next record that way. A fast
  // move past the edge counts spines on the closed shelf, and the finger then steps through every
  // record on the way, one per frame, so a fast sweep flips each of them instead of skipping them.
  // A record put back by click stays shut until the mouse moves to another one.
  const LEAVE_DELAY = 250;
  const STEP_MS = 16;
  const MAX_LAG = 10; // records the finger may trail the mouse by, so it never falls far behind
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let dismissedId: string | null = null;
  let finger: { shelf: Shelf; index: number; target: number } | null = null;
  let frame = 0;
  let lastStep = 0;

  // Hover shelves are centred in the row's content box (overflowing both sides alike, as flexbox does).
  function shelfLeft(row: HTMLElement, width: number) {
    const style = getComputedStyle(row);
    const padLeft = parseFloat(style.paddingLeft);
    const content = row.clientWidth - padLeft - parseFloat(style.paddingRight);
    return row.getBoundingClientRect().left + padLeft + (content - width) / 2;
  }

  // Where record `i` starts on the closed shelf.
  function closedLeft(shelf: Shelf, row: HTMLElement, i: number) {
    const width = shelf.items.reduce((sum, i) => sum + i.width, 0) + GAP * (shelf.items.length - 1);
    let x = shelfLeft(row, width);
    for (let j = 0; j < i; j++) x += shelf.items[j].width + GAP;
    return x;
  }

  function indexAt(shelf: Shelf, row: HTMLElement, x: number) {
    let edge = closedLeft(shelf, row, 0);
    for (let i = 0; i < shelf.items.length; i++) {
      edge += shelf.items[i].width + GAP;
      if (x < edge) return i;
    }
    return shelf.items.length - 1;
  }

  // Where record `i`'s cover ends up once it has opened. Worked out rather than measured, since the
  // shelf is usually still animating.
  function coverAt(shelf: Shelf, row: HTMLElement, i: number) {
    const id = shelf.items[i].album.id;
    const widths = shelf.items.map((item, j) => (j === i ? coverSize : widthOf(shelf, item, id)));
    let left = shelfLeft(row, widths.reduce((sum, w) => sum + w, 0) + GAP * (widths.length - 1));
    for (let j = 0; j < i; j++) left += widths[j] + GAP;
    return { left, right: left + coverSize };
  }

  function hoverShelf(shelf: Shelf, e: PointerEvent & { currentTarget: HTMLElement }) {
    if (!hover || e.pointerType !== 'mouse') return;
    clearTimeout(leaveTimer);
    const row = e.currentTarget;
    const x = e.clientX;

    if (!finger || finger.shelf !== shelf || !shelf.items.some((i) => i.album.id === openId)) {
      const target = indexAt(shelf, row, x);
      const id = shelf.items[target].album.id;
      if (id === dismissedId) return;
      dismissedId = null;
      stopFinger();
      finger = { shelf, index: target, target };
      openId = id;
      return;
    }

    // Measured against where the finger is heading, so a cover still on its way isn't passed twice.
    const { left, right } = coverAt(shelf, row, finger.target);
    if (x >= left && x <= right) return;
    const past =
      x > right
        ? closedLeft(shelf, row, finger.target + 1) + (x - right)
        : closedLeft(shelf, row, finger.target) - GAP - (left - x);
    const target = indexAt(shelf, row, past);
    if (target === finger.target) return;
    finger.target = target;
    const behind = target - finger.index;
    if (Math.abs(behind) > MAX_LAG) finger.index = target - Math.sign(behind) * MAX_LAG;
    if (!frame) step(performance.now());
  }

  function step(now: number) {
    frame = 0;
    if (!finger || finger.index === finger.target) return;
    if (now - lastStep >= STEP_MS) {
      lastStep = now;
      finger.index += Math.sign(finger.target - finger.index);
      openId = finger.shelf.items[finger.index].album.id;
    }
    if (finger.index !== finger.target) frame = requestAnimationFrame(step);
  }

  function stopFinger() {
    cancelAnimationFrame(frame);
    frame = 0;
    finger = null;
  }

  function hoverOut(e: PointerEvent) {
    if (!hover || e.pointerType !== 'mouse') return;
    leaveTimer = setTimeout(() => {
      stopFinger();
      openId = null;
    }, LEAVE_DELAY);
  }

  // Fetch and decode a shelf's covers as soon as the mouse reaches it, so they're ready when it
  // leafs through.
  function preloadShelf(shelf: Shelf) {
    if (hover) for (const { album } of shelf.items) preloadCover(album.cover);
  }

  function toggle(id: string) {
    clearTimeout(leaveTimer);
    if (openId === id) {
      openId = null;
      dismissedId = id;
    } else {
      openId = id;
    }
  }

  $effect(() => () => {
    clearTimeout(leaveTimer);
    stopFinger();
  });

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
    <div class="measure cover-size" bind:clientWidth={coverSize}></div>
    {#each shelves as shelf}
      <div class="shelf">
        <div class="clip">
          <div
            class="row"
            class:centered={hover}
            role="list"
            style:transform={hover ? undefined : shift(shelf)}
            onpointerenter={() => preloadShelf(shelf)}
            onpointermove={(e) => hoverShelf(shelf, e)}
            onpointerleave={hoverOut}
          >
            {#each shelf.items as item (item.album.id)}
              {@const album = item.album}
              <Spine
                {album}
                width={widthOf(shelf, item, openId)}
                side={item.side}
                open={openId === album.id}
                ontoggle={() => toggle(album.id)}
                onplay={(from) => {
                  playAlbum(album, from);
                  openId = null;
                  dismissedId = album.id;
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
    padding: 40px 0 380px; /* room to scroll the last shelf clear of the turntable */
  }

  .measure {
    height: 0;
    margin: 0 var(--gutter);
  }

  .cover-size {
    width: var(--h);
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

  /* Hover shelves keep their spare room split evenly on both sides until a cover fills it. */
  .row.centered {
    justify-content: center;
  }
</style>
