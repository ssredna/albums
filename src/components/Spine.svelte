<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { Album } from '../lib/spotify';
  import { canHover } from '../lib/hover';
  import { preloadCover } from '../lib/covers';
  import { cachedColor, placeholderColor, spineColor, type SpineColor } from '../lib/color';

  let {
    album,
    width,
    side,
    open,
    ontoggle,
    onplay,
  }: {
    album: Album;
    width: number;
    /** Which way the cover swings out — towards the roomier half of the shelf. */
    side: 'left' | 'right';
    open: boolean;
    ontoggle: () => void;
    /** Called with the cover's position, so the disc can fly from it to the player. */
    onplay: (from: DOMRect) => void;
  } = $props();

  // Matches --turn in app.css.
  const turnMs = () => (canHover.current ? 300 : 550);

  let slot: HTMLDivElement;
  let cover = $state<HTMLDivElement>();
  let sampled = $state<SpineColor | null>(null);
  const color = $derived(sampled ?? cachedColor(album.id) ?? placeholderColor(album.id));

  // flat:      plain spine, no 3D (cheap for a shelf of hundreds).
  // setup:     3D box posed so it looks exactly like the flat spine.
  // turned:    box rotated 90° so the cover faces out.
  // returning: rotating back; drops to flat when done.
  let phase = $state<'flat' | 'setup' | 'turned' | 'returning'>('flat');
  let timer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    if (!cachedColor(album.id) && album.thumb) spineColor(album.id, album.thumb).then((c) => (sampled = c));
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const shouldOpen = open;
    untrack(() => (shouldOpen ? turn() : putBack()));
  });

  async function turn() {
    clearTimeout(timer);
    if (phase === 'flat') {
      phase = 'setup';
      await tick();
      void slot.offsetWidth; // commit the setup pose before animating away from it
    }
    phase = 'turned';
    // Under a mouse the record is already in view; scrolling would pull the shelf from under it.
    if (!canHover.current) setTimeout(() => slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), turnMs());
  }

  function putBack() {
    if (phase === 'flat' || phase === 'returning') return;
    phase = 'returning';
    timer = setTimeout(() => (phase = 'flat'), turnMs());
  }

  const preload = () => preloadCover(album.cover);
</script>

<div
  bind:this={slot}
  class="slot {side}"
  class:three={phase !== 'flat'}
  class:anim={phase === 'turned' || phase === 'returning'}
  class:turned={phase === 'turned'}
  role="listitem"
  style:--w="{width}px"
  style:--spine-bg={color.bg}
  style:--spine-fg={color.fg}
  onpointerenter={preload}
>
  <div class="lift">
    <div class="box">
      <button
        class="spine"
        onclick={ontoggle}
        onfocus={preload}
        aria-expanded={open}
        title="{album.name} — {album.artists}"
      >
        <span class="title">{album.name}</span>
        <span class="artist">{album.artists}</span>
      </button>

      {#if phase !== 'flat'}
        <div class="cover" bind:this={cover}>
          <img src={album.cover} alt="" decoding="async" />
          <button class="put-back" onclick={ontoggle} aria-label="Put {album.name} back"></button>
          <span class="caption">
            <strong>{album.name}</strong>
            <span>{album.artists} · {album.year}</span>
          </span>
          <button class="play" onclick={() => cover && onplay(cover.getBoundingClientRect())} aria-label="Play {album.name}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .slot {
    position: relative;
    flex: none;
    width: var(--w);
    height: var(--h);
    transition: width var(--turn) var(--ease);
  }

  .slot.turned {
    width: var(--h);
  }

  .slot.three {
    z-index: 1;
  }

  /* Hover lift lives on its own element so it never interferes with the 3D turn. */
  .lift {
    position: relative;
    height: 100%;
    perspective: 1400px;
    transition: transform 0.2s ease;
  }

  .slot:hover .lift,
  .slot:focus-within .lift,
  .three .lift {
    transform: translateY(-10px);
  }

  .box {
    height: 100%;
  }

  /*
   * The record as a box: the cover is the front face (--h wide), the spine a side face (--w deep).
   * Closed, the box is rotated 90° so only the spine faces out, pushed back so it sits exactly where
   * the flat spine was. Turned, it rotates to 0° and the cover faces out instead.
   */
  .right {
    --closed-angle: 90deg; /* spine is the left face; the cover swings in from the right */
    --face-angle: -90deg;
  }

  .left {
    --closed-angle: -90deg;
    --face-angle: 90deg;
  }

  .three .box {
    position: absolute;
    top: 0;
    left: 50%;
    width: var(--h);
    margin-left: calc(var(--h) / -2);
    transform-style: preserve-3d;
    transform: translateZ(calc(var(--h) / -2)) rotateY(var(--closed-angle));
  }

  .three.anim .box {
    transition: transform var(--turn) var(--ease);
  }

  .three.turned .box {
    transform: translateZ(calc(var(--w) / -2)) rotateY(0deg);
  }

  .spine {
    all: unset;
    box-sizing: border-box;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    width: var(--w);
    height: 100%;
    padding: 12px 0;
    writing-mode: vertical-rl;
    cursor: pointer;
    color: var(--spine-fg);
    background:
      linear-gradient(
        to right,
        rgb(0 0 0 / 0.28),
        rgb(0 0 0 / 0) 18%,
        rgb(255 255 255 / 0.1) 45%,
        rgb(0 0 0 / 0) 70%,
        rgb(0 0 0 / 0.32)
      ),
      var(--spine-bg);
    border-radius: 2px 2px 0 0;
  }

  .three .spine {
    position: absolute;
    top: 0;
    left: 50%;
    margin-left: calc(var(--w) / -2);
    transform: rotateY(var(--face-angle)) translateZ(calc(var(--h) / 2));
    backface-visibility: hidden;
  }

  .spine:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .title,
  .artist {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    min-inline-size: 0;
  }

  .title {
    flex: 1 1 auto;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .artist {
    flex: 0 1 auto;
    max-inline-size: 45%;
    font-size: 10.5px;
    opacity: 0.78;
  }

  .cover {
    position: absolute;
    inset: 0;
    transform: translateZ(calc(var(--w) / 2));
    backface-visibility: hidden;
    overflow: hidden;
    border-radius: 2px;
    background: var(--spine-bg);
    box-shadow: 0 18px 40px -12px rgb(0 0 0 / 0.55);
  }

  .cover img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .put-back {
    all: unset;
    position: absolute;
    inset: 0;
    cursor: pointer;
  }

  .put-back:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -4px;
  }

  .caption {
    position: absolute;
    inset: auto 0 0 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 40px 68px 12px 14px;
    font-size: 12.5px;
    line-height: 1.35;
    color: #fff;
    background: linear-gradient(to top, rgb(0 0 0 / 0.78), rgb(0 0 0 / 0));
    pointer-events: none;
  }

  .caption strong {
    font-size: 14px;
    font-weight: 650;
  }

  .caption span {
    opacity: 0.85;
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
</style>
