<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { landed, next, player, previous, seek, toggle, warmUp, type Flight } from '../lib/player.svelte';
  import Disc from './Disc.svelte';

  const FLIGHT_MS = 1100;

  let tray = $state<HTMLDivElement>();
  let flyer = $state<HTMLDivElement>();
  let flying = $state<Flight | null>(null);
  let now = $state(performance.now());

  onMount(warmUp);

  const visible = $derived(player.disc || player.flight || player.pending);
  const title = $derived(player.pending?.name ?? player.track?.name ?? '');
  const subtitle = $derived(
    player.pending
      ? `${player.pending.artists} · Starting…`
      : player.track
        ? `${player.track.artists} — ${player.track.album}`
        : '',
  );
  const position = $derived(
    player.paused ? player.position : Math.min(player.duration, player.position + (now - player.updatedAt)),
  );
  const progress = $derived(player.duration ? (position / player.duration) * 100 : 0);

  $effect(() => {
    if (player.paused) return;
    let frame = requestAnimationFrame(function loop(t) {
      now = t;
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    const flight = player.flight;
    if (flight) untrack(() => fly(flight));
  });

  // The disc slides out of its case, spins across the page and drops into the tray.
  async function fly(flight: Flight) {
    player.disc = null; // eject whatever is playing
    flying = flight;
    await tick();
    if (!tray || !flyer) return;

    const from = flight.from;
    const to = tray.getBoundingClientRect();
    const size = Math.min(from.width, from.height) * 0.92;
    const startX = from.left + from.width / 2;
    const startY = from.top + from.height / 2;
    Object.assign(flyer.style, {
      left: `${startX - size / 2}px`,
      top: `${startY - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
    });

    const dx = to.left + to.width / 2 - startX;
    const dy = to.top + to.height / 2 - startY;
    const slide = size * 0.42 * Math.sign(dx || 1);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    await flyer.animate(
      [
        { transform: 'translate(0, 0) rotate(0) scale(0.96)', opacity: 0, easing: 'ease-out' },
        { transform: 'translate(0, 0) rotate(0) scale(1)', opacity: 1, offset: 0.1, easing: 'cubic-bezier(.3,.6,.4,1)' },
        { transform: `translate(${slide}px, ${-size * 0.06}px) rotate(80deg) scale(1)`, offset: 0.34, easing: 'cubic-bezier(.5,0,.3,1)' },
        { transform: `translate(${dx}px, ${dy}px) rotate(360deg) scale(${to.width / size})`, opacity: 1 },
      ],
      { duration: reduced ? 0 : FLIGHT_MS, fill: 'forwards' },
    ).finished;

    flying = null;
    if (player.flight === flight) landed(flight);
  }

  function formatTime(ms: number) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function seekTo(e: MouseEvent) {
    const bar = e.currentTarget as HTMLElement;
    seek(((e.clientX - bar.getBoundingClientRect().left) / bar.offsetWidth) * player.duration);
  }

  function onKey(e: KeyboardEvent) {
    if (e.code !== 'Space' || !visible || e.target !== document.body) return;
    e.preventDefault();
    toggle();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if flying}
  <div class="flyer" bind:this={flyer}><Disc cover={flying.album.cover} /></div>
{/if}

{#if visible}
  <aside class="dock" aria-label="Player" transition:fade={{ duration: 250 }}>
    <div class="tray" bind:this={tray}>
      {#if player.disc}
        {#key player.disc.id}
          <div class="seated" out:scale={{ duration: 250, start: 0.8 }}>
            <Disc cover={player.disc.cover} spinning={!player.paused && player.active} />
          </div>
        {/key}
      {/if}
    </div>

    <div class="info">
      <div class="title">{title}</div>
      <div class="subtitle">{player.error ?? subtitle}</div>
      <button class="progress" onclick={seekTo} aria-label="Seek" disabled={!player.duration}>
        <span class="bar" style:width="{progress}%"></span>
      </button>
      <div class="times">
        <span>{formatTime(position)}</span>
        <span>{formatTime(player.duration)}</span>
      </div>
    </div>

    <div class="controls">
      <button class="prev" onclick={previous} aria-label="Previous track">
        <svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
      </button>
      <button class="play" onclick={toggle} aria-label={player.paused ? 'Play' : 'Pause'}>
        {#if player.paused}
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        {:else}
          <svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        {/if}
      </button>
      <button onclick={next} aria-label="Next track">
        <svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
      </button>
    </div>
  </aside>
{/if}

<style>
  .flyer {
    position: fixed;
    z-index: 20;
    pointer-events: none;
    will-change: transform;
  }

  .dock {
    --tray: 104px;
    position: fixed;
    z-index: 10;
    left: 0;
    right: 0;
    bottom: 16px;
    margin: 0 auto;
    width: min(640px, calc(100% - 32px));
    display: grid;
    grid-template-columns: var(--tray) 1fr auto;
    align-items: center;
    gap: 18px;
    padding: 12px 18px 12px 16px;
    color: var(--text);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(16px) saturate(1.4);
    border: 1px solid var(--line);
    border-radius: 16px;
    box-shadow: 0 14px 40px -12px rgb(0 0 0 / 0.35);
  }

  /* The disc sits proud of the dock, like a CD resting in an open tray. */
  .tray {
    width: var(--tray);
    height: var(--tray);
    margin: -44px 0 -4px;
  }

  .info {
    min-width: 0;
  }

  .title,
  .subtitle {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .title {
    font-weight: 650;
    font-size: 0.95rem;
  }

  .subtitle {
    font-size: 0.8rem;
    color: var(--muted);
  }

  .progress {
    all: unset;
    display: block;
    width: 100%;
    height: 4px;
    margin-top: 10px;
    border-radius: 2px;
    background: var(--line);
    cursor: pointer;
    position: relative;
  }

  .progress:disabled {
    cursor: default;
  }

  .progress:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }

  .bar {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: var(--text);
  }

  .times {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .controls button {
    all: unset;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    color: var(--text);
    cursor: pointer;
  }

  .controls button:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .controls button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .controls .play {
    width: 46px;
    height: 46px;
    color: var(--bg);
    background: var(--text);
  }

  .controls .play:hover {
    background: var(--text);
    filter: brightness(1.15);
  }

  svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }

  .play svg {
    width: 24px;
    height: 24px;
  }

  @media (max-width: 640px) {
    .dock {
      --tray: 76px;
      gap: 12px;
      padding: 10px 12px;
    }

    .tray {
      margin-top: -32px;
    }

    .prev {
      display: none !important;
    }
  }
</style>
