<script module lang="ts">
  /** How long the crate takes to unpack when opened, and to pack away again. */
  export const UNPACK_MS = 340;
  /** The same ease as the crate's own (cubicInOut), for whatever moves with it. */
  export const SLIDE_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';
</script>

<script lang="ts">
  import { cubicInOut } from 'svelte/easing';
  import type { Album } from '../lib/spotify';
  import { letterOf } from '../lib/sort';
  import { preloadCover } from '../lib/covers';
  import { canHover } from '../lib/hover';

  let {
    albums,
    open,
    receiving,
    draggingId,
    dropzone = $bindable(),
    onopen,
    onclose,
    onpickup,
    onplay,
  }: {
    /** What's still to be sorted, alphabetical. */
    albums: Album[];
    open: boolean;
    /** A record from a shelf is held over the crate, ready to go back in. */
    receiving: boolean;
    draggingId: string | null;
    /** Where a record dropped goes back in the crate: the open crate, or the closed one. */
    dropzone?: HTMLElement;
    onopen: () => void;
    onclose: () => void;
    onpickup: (e: PointerEvent) => void;
    onplay: (album: Album, from: DOMRect) => void;
  } = $props();

  // Flipping through the crate like a record-store bin: the front record stands up showing its
  // cover, and the tops of the next few show behind it. The ones already flipped past fall forward
  // out of view.
  const BEHIND = 10;
  const FLIP_DISTANCE = 50; // wheel travel per record
  const SETTLE_MS = 180; // how long after the last bit of scrolling the front record settles back
  const SWIPE = 30;

  let front = $state(0);
  // When records are taken out, the next one along comes to the front.
  const at = $derived(Math.min(front, Math.max(albums.length - 1, 0)));
  const cards = $derived(
    albums
      .slice(Math.max(at - 2, 0), at + BEHIND + 2)
      .map((album, i) => ({ album, depth: i + Math.max(at - 2, 0) - at })),
  );
  const showing = $derived(albums[at]);

  const letters = $derived([...new Set(albums.map(letterOf))]);
  // Where each divider stands: in front of the first record filed under its letter.
  const dividers = $derived.by(() => {
    const first = new Map<string, string>();
    let previous = '';
    for (const album of albums) {
      const letter = letterOf(album);
      if (letter !== previous) first.set(album.id, letter);
      previous = letter;
    }
    return first;
  });

  function flip(by: number) {
    front = Math.min(Math.max(at + by, 0), albums.length - 1);
  }

  function jump(letter: string) {
    const i = albums.findIndex((a) => letterOf(a) === letter);
    if (i >= 0) front = i;
  }

  $effect(() => {
    for (const { album, depth } of cards) if (depth >= 0 && depth < 3) preloadCover(album.cover);
  });

  // Scrolling short of a whole record still gives: the front record tips just a touch towards the
  // way it's being flipped (-1 to 1 of the way there), and settles back when the scrolling stops.
  let nudge = $state(0);

  let bin = $state<HTMLElement>();
  $effect(() => {
    if (!bin) return;
    let travel = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      travel += e.deltaMode === 1 ? delta * 30 : delta;
      const steps = Math.trunc(travel / FLIP_DISTANCE);
      travel -= steps * FLIP_DISTANCE;
      nudge = travel / FLIP_DISTANCE;
      if (steps) flip(steps);
      clearTimeout(settle);
      settle = setTimeout(() => (travel = nudge = 0), SETTLE_MS);
    };
    bin.addEventListener('wheel', wheel, { passive: false });
    return () => {
      clearTimeout(settle);
      bin?.removeEventListener('wheel', wheel);
    };
  });

  function onkeydown(e: KeyboardEvent) {
    const by: Record<string, number> = {
      ArrowDown: 1,
      ArrowRight: 1,
      ArrowUp: -1,
      ArrowLeft: -1,
      PageDown: 10,
      PageUp: -10,
      Home: -Infinity,
      End: Infinity,
    };
    if (!(e.key in by)) return;
    e.preventDefault();
    flip(Math.max(Math.min(by[e.key], albums.length), -albums.length));
  }

  // A finger flips with a quick swipe up or down; holding still picks the record up instead.
  let swipe: { id: number; y: number } | null = null;

  function press(e: PointerEvent) {
    onpickup(e);
    if (e.pointerType !== 'mouse') swipe = { id: e.pointerId, y: e.clientY };
  }

  // A finger on its way to a swipe tips the front record the same way scrolling does.
  function feel(e: PointerEvent) {
    if (!swipe || e.pointerId !== swipe.id) return;
    nudge = draggingId ? 0 : Math.max(-1, Math.min(1, (swipe.y - e.clientY) / SWIPE));
  }

  function lift(e: PointerEvent) {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dy = e.clientY - swipe.y;
    swipe = null;
    nudge = 0;
    if (!draggingId && Math.abs(dy) > SWIPE) flip(dy < 0 ? 1 : -1);
  }

  let panel = $state<HTMLElement>();
  let closed = $state<HTMLElement>();
  $effect(() => {
    dropzone = open ? panel : closed;
  });

  // Opening, the crate lifts out of its corner and unpacks into the bin: the panel grows out of where
  // the closed crate stands, with its front wall over the crate's own, while the rest of the panel
  // fades in around it. Closing packs it back the same way.
  function unpack(node: HTMLElement) {
    if (!closed || matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };
    const from = closed.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const wall = node.querySelector('.wall')?.getBoundingClientRect() ?? box;
    const scale = from.width / wall.width;
    const originX = wall.left + wall.width / 2 - box.left;
    const originY = wall.bottom - box.top;
    const dx = from.left + from.width / 2 - (box.left + originX);
    const dy = from.bottom - (box.top + originY);
    return {
      duration: UNPACK_MS,
      easing: cubicInOut,
      css: (t: number, u: number) =>
        `transform-origin: ${originX}px ${originY}px;` +
        `transform: translate(${dx * u}px, ${dy * u}px) scale(${scale + (1 - scale) * t});` +
        `--chrome: ${t * t * t};`,
    };
  }
</script>

{#if open}
  <aside class="panel" class:receiving bind:this={panel} aria-label="Crate" transition:unpack>
    <header>
      <nav class="letters" aria-label="Jump to letter">
        {#each letters as letter}
          <button class:current={letter === letterOf(showing)} onclick={() => jump(letter)}>{letter}</button>
        {/each}
      </nav>
      <button class="close" onclick={onclose} aria-label="Close the crate">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9" /></svg>
      </button>
    </header>

    {#if albums.length}

      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (the bin is flipped through with the arrow keys) -->
      <div
        class="bin"
        bind:this={bin}
        data-crate
        tabindex="0"
        role="group"
        aria-label="Records in the crate. Arrow keys flip through them."
        {onkeydown}
        onpointerdown={press}
        onpointermove={feel}
        onpointerup={lift}
        onpointercancel={() => {
          swipe = null;
          nudge = 0;
        }}
      >
        <div class="stack">
          {#each cards as { album, depth } (album.id)}
            {@const letter = dividers.get(album.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (the bin itself takes the keys) -->
            <div
              class="card"
              class:front={depth === 0}
              class:past={depth < 0}
              class:far={depth > BEHIND}
              class:held={draggingId === album.id}
              data-id={album.id}
              style:--depth={depth}
              style:--nudge={depth === 0 ? nudge : 0}
              onclick={() => depth > 0 && flip(depth)}
            >
              <img src={depth < 3 ? album.cover : album.thumb || album.cover} alt="" draggable="false" decoding="async" />
              {#if letter}
                <span class="tab" style:--slot={letters.indexOf(letter) % 5}>{letter}</span>
              {/if}
              {#if depth === 0}
                <button
                  class="play"
                  onclick={(e) => onplay(album, (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect())}
                  aria-label="Play {album.name}"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                </button>
              {/if}
            </div>
          {/each}
        </div>
        <!-- The crate's front wall, which the records stand behind. -->
        <div class="wall" aria-hidden="true"><span class="brass">To sort · {albums.length}</span></div>
      </div>

      <div class="caption" aria-live="polite">
        <strong>{showing.name}</strong>
        <span>{showing.artists} · {showing.year}</span>
      </div>
      <p class="hint">
        {canHover.current ? 'Scroll to flip through · drag a record onto a shelf' : 'Swipe to flip through · hold a record to lift it out'}
      </p>
    {:else}
      <p class="empty">All sorted. Drag a record here to put it back in the crate.</p>
    {/if}
  </aside>
{/if}

<!-- Stays in place while the crate is open, hidden, so opening and closing know where it stands. -->
<button
  class="crate"
  class:receiving
  class:unpacked={open}
  bind:this={closed}
  onclick={onopen}
  inert={open}
  aria-label="Open the crate: {albums.length} records to sort"
>
  <span class="peek" aria-hidden="true">
    {#each albums.slice(0, 5) as album, i (album.id)}
      <span class="top" style:--i={i} style:background-image={album.thumb ? `url("${album.thumb}")` : undefined}></span>
    {/each}
  </span>
  <span class="front" aria-hidden="true">
    <span class="brass">{albums.length}</span>
  </span>
</button>

<style>
  /* The closed crate, in the corner across from the turntable. */
  .crate {
    all: unset;
    position: fixed;
    z-index: 10;
    left: 24px;
    bottom: 24px;
    width: 132px;
    height: 96px;
    cursor: pointer;
  }

  /* Gone up into the open crate; it settles back once the crate is packed away again. */
  .crate {
    transition: opacity 0.1s linear 0.28s;
  }

  .crate.unpacked {
    opacity: 0;
    transition-delay: 0s;
  }

  .crate:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 4px;
    border-radius: 4px;
  }

  /* The tops of the first few records, leaning every which way. */
  .peek {
    position: absolute;
    inset: 0 10px 0;
  }

  .top {
    position: absolute;
    left: calc(4px + var(--i) * 18px);
    bottom: 20px;
    width: 40px;
    height: 70px;
    border-radius: 2px;
    background: hsl(calc(var(--i) * 67 + 20) 25% 40%) center / cover;
    box-shadow: 0 -1px 3px rgb(0 0 0 / 0.4);
    transform: rotate(calc(-8deg + var(--i) * 4deg));
    transform-origin: 50% 100%;
    transition: transform 0.25s var(--ease);
  }

  .crate:hover .top,
  .crate.receiving .top {
    transform: rotate(calc(-12deg + var(--i) * 6deg)) translateY(-6px);
  }

  .front {
    position: absolute;
    inset: auto 0 0;
    display: grid;
    place-items: center;
    height: 50px;
    border-radius: 3px;
    background:
      linear-gradient(var(--board-top) 0 3px, transparent 3px),
      repeating-linear-gradient(var(--board-face) 0 14px, var(--board-edge) 14px 16px);
    box-shadow:
      inset 0 -2px 0 var(--board-edge),
      0 10px 18px -8px var(--board-shadow);
  }

  .crate.receiving .front {
    box-shadow:
      0 0 0 2px var(--focus),
      0 10px 18px -8px var(--board-shadow);
  }

  /* Opened: a card at the side, so the rack stays in view to drag records onto. */
  .panel {
    position: fixed;
    z-index: 25;
    top: 50%;
    left: 24px;
    translate: 0 -50%;
    width: var(--crate-w);
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px 24px 22px;
    color: var(--text);
    border-radius: 14px;
    --card: min(calc(var(--crate-w) - 76px), 36vh);
    --gap: 22px; /* between the records standing in the crate */
    --wall: 44px;
    --rise: 150px; /* room for the tops of the records behind */
    user-select: none;
    -webkit-user-select: none;
  }

  /* The card around the bin, which fades in (--chrome) as the crate unpacks. */
  .panel::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset: 0;
    border-radius: inherit;
    background: var(--bg);
    border: 1px solid var(--line);
    box-shadow: 0 24px 48px -20px rgb(0 0 0 / 0.5);
    opacity: var(--chrome, 1);
  }

  .panel.receiving::before {
    box-shadow:
      inset 0 0 0 2px var(--focus),
      0 24px 48px -20px rgb(0 0 0 / 0.5);
  }

  .panel > :not(.bin) {
    opacity: var(--chrome, 1);
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .close {
    all: unset;
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin: -4px -6px 0 0;
    border-radius: 50%;
    color: var(--muted);
    cursor: pointer;
  }

  .close:hover {
    color: var(--text);
  }

  .close:focus-visible {
    outline: 2px solid var(--focus);
  }

  .close svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .letters {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }

  .letters button {
    all: unset;
    min-width: 20px;
    padding: 2px 0;
    text-align: center;
    font-size: 0.75rem;
    color: var(--muted);
    border-radius: 4px;
    cursor: pointer;
  }

  .letters button:hover,
  .letters button.current {
    color: var(--text);
  }

  .letters button.current {
    background: var(--line);
  }

  .letters button:focus-visible {
    outline: 2px solid var(--focus);
  }

  /*
   * The bin, seen from the front and a little above. The records stand in a row going back into the
   * crate, each leaning back against the next, with their bottoms hidden behind the crate's front
   * wall. The one being looked at is pulled up and stands nearly upright; the ones already flipped
   * past tip forward out of the way.
   */
  .bin {
    position: relative;
    flex: none;
    height: calc(var(--card) + var(--wall) + var(--rise));
    perspective: 700px;
    perspective-origin: 50% -90%; /* looking down into the crate */
    touch-action: none;
    outline: none;
  }

  .bin:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 6px;
    border-radius: 4px;
  }

  .stack {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    pointer-events: none; /* its plane stands in front of the records further back */
  }

  .card {
    --lean: 20deg;
    --raise: 0px;
    position: absolute;
    left: 50%;
    bottom: calc(var(--wall) * 0.4);
    width: var(--card);
    height: var(--card);
    margin-left: calc(var(--card) / -2);
    border-radius: 2px;
    background: hsl(calc(var(--depth) * 37) 15% 30%);
    box-shadow: 0 -1px 2px rgb(0 0 0 / 0.35);
    transform-origin: 50% 100%;
    transform: translateY(calc(var(--raise) * -1)) translateZ(calc(var(--depth) * var(--gap) * -1)) rotateX(var(--lean));
    transition:
      transform 0.35s var(--ease),
      opacity 0.35s var(--ease);
    pointer-events: auto;
    cursor: pointer;
  }

  /* Further back is further into the crate's shadow; the top edges catch the light. */
  .card::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background:
      linear-gradient(rgb(255 255 255 / 0.14), rgb(255 255 255 / 0) 6%),
      rgb(0 0 0 / calc(min(var(--depth), 10) * 0.05));
    pointer-events: none;
  }

  .card:not(.front):hover {
    --raise: 8px;
  }

  .card.front {
    --lean: calc(6deg - var(--nudge) * 5deg);
    --raise: calc(var(--wall) / 2);
    box-shadow:
      0 -1px 2px rgb(0 0 0 / 0.35),
      0 18px 30px -14px rgb(0 0 0 / 0.7);
    cursor: grab;
  }

  .card img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }

  /* Flipped past, tipped forward out of the bin; or still too far back to see. */
  .card.past,
  .card.far {
    opacity: 0;
    pointer-events: none;
  }

  .card.past {
    --lean: -25deg;
    transform: translateZ(16px) rotateX(var(--lean));
  }

  .card.held {
    opacity: 0.35;
  }

  .wall {
    position: absolute;
    z-index: 1;
    left: calc(50% - var(--card) / 2 - 14px);
    right: calc(50% - var(--card) / 2 - 14px);
    bottom: 0;
    display: grid;
    place-items: center;
    height: var(--wall);
    border-radius: 3px;
    background:
      linear-gradient(var(--board-top) 0 3px, transparent 3px),
      repeating-linear-gradient(var(--board-face) 0 18px, var(--board-edge) 18px 20px);
    box-shadow:
      inset 0 -2px 0 var(--board-edge),
      0 -10px 16px -10px rgb(0 0 0 / 0.7);
    pointer-events: none;
  }

  /* A cardboard divider tab, standing up in front of the first record under each letter. */
  .tab {
    position: absolute;
    top: -14px;
    left: calc(10px + var(--slot) * 18%);
    width: 26px;
    height: 14px;
    display: grid;
    place-items: center;
    font-size: 10px;
    font-weight: 700;
    color: #4a3d26;
    background: linear-gradient(#efe5cf, #d9cba9);
    border-radius: 3px 3px 0 0;
    box-shadow: 0 -1px 1px rgb(0 0 0 / 0.25);
  }

  .play {
    all: unset;
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: #111;
    background: #fff;
    box-shadow: 0 6px 16px rgb(0 0 0 / 0.35);
    cursor: pointer;
    transition: transform 0.15s ease;
  }

  .play:hover {
    transform: scale(1.08);
  }

  .play:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .play svg {
    width: 22px;
    height: 22px;
    margin-left: 2px;
    fill: currentColor;
  }

  .caption {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: 0.875rem;
  }

  .caption strong,
  .caption span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .caption span,
  .hint,
  .empty {
    color: var(--muted);
  }

  .hint,
  .empty {
    margin: 0;
    font-size: 0.8125rem;
  }


  /* On a phone the crate opens as a sheet from the bottom, under the rack. */
  @media (max-width: 640px) {
    .crate {
      left: 16px;
      bottom: 16px;
      zoom: 0.8;
    }

    .panel {
      inset: auto 0 0 0;
      translate: none;
      width: auto;
      max-height: none;
      height: min(62vh, 520px);
      gap: 10px;
      padding: 14px 16px 16px;
      border-radius: 14px 14px 0 0;
      --card: min(calc(100vw - 64px), 24vh);
      --wall: 34px;
      --rise: 76px;
    }

    .panel::before {
      border-width: 1px 0 0;
      box-shadow: 0 -12px 32px -16px rgb(0 0 0 / 0.4);
    }
  }
</style>
