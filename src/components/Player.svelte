<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { ARM_MS, landed, next, player, previous, toggle, warmUp, type Flight } from '../lib/player.svelte';
  import Vinyl from './Vinyl.svelte';
  import type { Album } from '../lib/spotify';

  let { albums }: { albums: Album[] } = $props();

  const FLIGHT_MS = 1200;

  // Tonearm angles (degrees, clockwise from pointing straight down), for the geometry in the SVG below:
  // resting beside the platter, at the outer groove, and at the inner groove near the label.
  const ARM_REST = 0;
  const ARM_START = 25;
  const ARM_END = 46;

  let slot = $state<HTMLDivElement>();
  let flyer = $state<HTMLDivElement>();
  let flying = $state<Flight | null>(null);
  let now = $state(performance.now());

  onMount(warmUp);

  const visible = $derived(player.disc || player.flight || player.pending);
  const playing = $derived(!player.paused && player.active);
  const title = $derived(player.pending?.name ?? player.track?.name ?? '');
  const subtitle = $derived(
    player.error ??
      (player.pending ? `${player.pending.artists} · Starting…` : player.track ? `${player.track.artists} — ${player.track.album}` : ''),
  );

  const position = $derived(
    player.paused ? player.position : Math.min(player.duration, player.position + (now - player.updatedAt)),
  );
  const library = $derived(new Map(albums.map((album) => [album.id, album])));
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  // How far through the whole record we are, by time — so track 5 of 10 sits mid-record, like a real
  // LP. Falls back to the current track alone for albums that aren't in the library.
  const recordProgress = $derived.by(() => {
    const trackProgress = player.duration ? Math.min(1, position / player.duration) : 0;
    const record = player.disc && library.get(player.disc.id);
    const index = record && player.track ? record.trackIds.findIndex((id) => player.track!.ids.includes(id)) : -1;
    if (!record || index < 0) return trackProgress;
    const before = sum(record.durations.slice(0, index));
    const current = record.durations[index] * trackProgress;
    return Math.min(1, (before + current) / sum(record.durations));
  });

  // The arm tracks through the groove as the record plays — the turntable's progress bar.
  const armAngle = $derived(
    !player.disc
      ? ARM_REST
      : player.cueing
        ? ARM_START
        : player.active && player.duration
          ? ARM_START + (ARM_END - ARM_START) * recordProgress
          : ARM_REST,
  );

  $effect(() => {
    if (!playing) return;
    const timer = setInterval(() => (now = performance.now()), 250);
    return () => clearInterval(timer);
  });

  $effect(() => {
    const flight = player.flight;
    if (flight) untrack(() => fly(flight));
  });

  // The record slides out of its sleeve, glides across the page and settles on the platter. It turns a
  // whole number of times so it lands at the same angle the platter record starts from — no jump.
  async function fly(flight: Flight) {
    player.disc = null; // lift off whatever is playing
    flying = flight;
    await tick();
    if (!slot || !flyer) return;

    const from = flight.from;
    const to = slot.getBoundingClientRect();
    const size = Math.min(from.width, from.height) * 0.96;
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
    const slide = size * 0.55 * Math.sign(dx || 1);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const animation = flyer.animate(
      [
        { transform: 'translate(0, 0) rotate(0) scale(1)', opacity: 0, easing: 'ease-out' },
        { transform: 'translate(0, 0) rotate(0) scale(1)', opacity: 1, offset: 0.08, easing: 'cubic-bezier(.3,.6,.4,1)' },
        { transform: `translate(${slide}px, 0) rotate(40deg) scale(1)`, offset: 0.36, easing: 'cubic-bezier(.5,0,.25,1)' },
        { transform: `translate(${dx}px, ${dy}px) rotate(360deg) scale(${to.width / size})` },
      ],
      { duration: reduced ? 0 : FLIGHT_MS, fill: 'forwards' },
    );
    // Animations stall in background tabs; land on time regardless so playback still starts.
    await Promise.race([animation.finished, new Promise((resolve) => setTimeout(resolve, FLIGHT_MS + 100))]);

    flying = null;
    if (player.flight === flight) landed(flight);
  }

  function onKey(e: KeyboardEvent) {
    if (e.code !== 'Space' || !visible || e.target !== document.body) return;
    e.preventDefault();
    toggle();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if flying}
  <div class="flyer" bind:this={flyer}><Vinyl cover={flying.album.cover} /></div>
{/if}

{#if visible}
  <aside class="dock" aria-label="Player" transition:fade={{ duration: 300 }}>
    {#if title}
      <div class="info" aria-live="polite">
        <div class="title">{title}</div>
        <div class="subtitle">{subtitle}</div>
      </div>
    {/if}

    <div class="turntable">
      <div class="platter">
        <div class="slot" bind:this={slot}>
          {#if player.disc}
            {#key player.disc.id}
              <div class="seated" out:scale={{ duration: 300, start: 1.08, opacity: 0 }}>
                <Vinyl cover={player.disc.cover} spinning={playing || player.cueing} />
              </div>
            {/key}
          {/if}
        </div>
        <div class="spindle"></div>
      </div>

      <svg class="arm-layer" viewBox="0 0 300 250" aria-hidden="true" style:--arm-ms="{ARM_MS}ms">
        <!-- arm rest -->
        <rect x="255" y="112" width="14" height="8" rx="2" class="dark" />
        <!-- pivot base -->
        <circle cx="262" cy="36" r="16" class="dark" />
        <g class="arm" style:transform="rotate({armAngle}deg)">
          <rect x="254" y="4" width="16" height="20" rx="3" class="metal" />
          <line x1="262" y1="24" x2="262" y2="166" class="tube" />
          <g transform="rotate(22 262 170)">
            <rect x="256" y="160" width="12" height="24" rx="2" class="metal" />
            <rect x="259" y="180" width="6" height="5" rx="1" class="dark" />
          </g>
        </g>
        <circle cx="262" cy="36" r="7" class="metal" />
      </svg>

      <div class="controls">
        <span class="led" class:on={playing}></span>
        <button onclick={previous} aria-label="Previous track">
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
    position: fixed;
    z-index: 10;
    right: 24px;
    bottom: 24px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
  }

  .info {
    max-width: 360px;
    padding: 8px 12px;
    text-align: right;
    color: var(--text);
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    backdrop-filter: blur(12px);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 8px 24px -10px rgb(0 0 0 / 0.3);
  }

  .title,
  .subtitle {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .title {
    font-size: 0.875rem;
    font-weight: 650;
  }

  .subtitle {
    font-size: 0.75rem;
    color: var(--muted);
  }

  /* Walnut plinth. Drawn at 300×250 and zoomed, so the tonearm geometry stays in one coordinate space. */
  .turntable {
    zoom: 1.2;
    position: relative;
    width: 300px;
    height: 250px;
    border-radius: 14px;
    background:
      repeating-linear-gradient(97deg, rgb(0 0 0 / 0.05) 0 2px, transparent 2px 9px),
      repeating-linear-gradient(93deg, rgb(255 255 255 / 0.03) 0 1px, transparent 1px 13px),
      linear-gradient(160deg, #7a5536, #53371f 60%, #472e1a);
    box-shadow:
      0 1px 0 rgb(255 255 255 / 0.18) inset,
      0 -2px 0 rgb(0 0 0 / 0.25) inset,
      0 24px 48px -16px rgb(0 0 0 / 0.55),
      0 4px 10px rgb(0 0 0 / 0.2);
  }

  .platter {
    position: absolute;
    left: 12px;
    top: 18px;
    width: 208px;
    height: 208px;
    border-radius: 50%;
    background: radial-gradient(circle, #2c2c2f 0 70%, #242427 70%);
    box-shadow:
      0 0 0 3px #b5b5ba,
      0 0 0 4px #6d6d72,
      0 6px 14px rgb(0 0 0 / 0.45);
  }

  /* Strobe dots around the platter rim. */
  .platter::before {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    background: repeating-conic-gradient(#d4d4d8 0 1.5deg, #8c8c92 1.5deg 3deg);
    mask: radial-gradient(circle, transparent 0 calc(50% - 3px), #000 calc(50% - 2.5px));
  }

  .slot {
    position: absolute;
    inset: 4px;
  }

  .seated {
    width: 100%;
    height: 100%;
  }

  .spindle {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 7px;
    height: 7px;
    margin: -3.5px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #fff, #8d8d92);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.5);
  }

  .arm-layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
    filter: drop-shadow(2px 5px 3px rgb(0 0 0 / 0.35));
  }

  .arm {
    transform-box: view-box;
    transform-origin: 262px 36px;
    transition: transform var(--arm-ms) cubic-bezier(0.45, 0, 0.2, 1);
  }

  .metal {
    fill: #d6d6db;
    stroke: #8f8f95;
    stroke-width: 1;
  }

  .dark {
    fill: #1d1d20;
  }

  .tube {
    stroke: #d6d6db;
    stroke-width: 4;
    stroke-linecap: round;
  }

  .controls {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .led {
    width: 6px;
    height: 6px;
    margin-right: 4px;
    border-radius: 50%;
    background: #3a2a1c;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35);
    transition: background 0.3s, box-shadow 0.3s;
  }

  .led.on {
    background: #7dff9a;
    box-shadow: 0 0 6px 1px rgb(125 255 154 / 0.7);
  }

  .controls button {
    all: unset;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    color: #e8e6e1;
    background: radial-gradient(circle at 40% 30%, #3a3a3e, #1a1a1c);
    box-shadow:
      0 1px 0 rgb(255 255 255 / 0.15) inset,
      0 2px 4px rgb(0 0 0 / 0.45);
    cursor: pointer;
  }

  .controls button:active {
    transform: translateY(1px);
  }

  .controls button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .controls .play {
    width: 36px;
    height: 36px;
  }

  .controls svg {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }

  .controls .play svg {
    width: 16px;
    height: 16px;
  }

  @media (max-width: 640px) {
    .dock {
      right: 12px;
      bottom: 12px;
    }

    .info {
      max-width: 240px;
    }

    .turntable {
      zoom: 0.8;
    }
  }
</style>
