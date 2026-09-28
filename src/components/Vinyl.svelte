<script lang="ts">
  import { onMount, untrack } from 'svelte';

  // An LP with the album art as its centre label. It spins at 33⅓ rpm and speeds up and slows down
  // like a real platter; the reflections stay put, like real light.
  let { cover, spinning = false }: { cover: string; spinning?: boolean } = $props();

  const REVOLUTION_MS = 1800; // 33⅓ rpm

  let spinner: HTMLDivElement;
  let anim: Animation | undefined;
  let frame = 0;

  onMount(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    anim = spinner.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], {
      duration: REVOLUTION_MS,
      iterations: Infinity,
    });
    anim.playbackRate = 0;
    return () => {
      cancelAnimationFrame(frame);
      anim?.cancel();
    };
  });

  $effect(() => {
    const target = spinning ? 1 : 0;
    untrack(() => ramp(target));
  });

  function ramp(target: number) {
    if (!anim) return;
    cancelAnimationFrame(frame);
    const from = anim.playbackRate;
    const start = performance.now();
    const duration = target ? 900 : 1600;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      anim!.playbackRate = from + (target - from) * (1 - (1 - k) ** 2);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }
</script>

<div class="vinyl">
  <div class="spinner" bind:this={spinner}>
    <div class="grooves"></div>
    <div class="label" style:background-image="url({cover})"></div>
  </div>
  <div class="sheen"></div>
</div>

<style>
  .vinyl {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 50%;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.45);
  }

  .spinner,
  .grooves,
  .sheen {
    position: absolute;
    inset: 0;
    border-radius: 50%;
  }

  .grooves {
    background:
      /* the quiet bands between tracks, and the smooth run-out and edge */
      radial-gradient(
        circle,
        transparent 0 38%,
        rgb(255 255 255 / 0.05) 38% 40%,
        transparent 40% 58%,
        rgb(255 255 255 / 0.04) 58% 58.8%,
        transparent 58.8% 74%,
        rgb(255 255 255 / 0.04) 74% 74.8%,
        transparent 74.8% 95%,
        rgb(255 255 255 / 0.06) 95% 97%,
        #0a0a0a 97%
      ),
      repeating-radial-gradient(circle, #111 0 1px, #1a1a1b 1px 2px);
  }

  .label {
    position: absolute;
    inset: 32%;
    border-radius: 50%;
    background-color: #c9b99a;
    background-size: cover;
    background-position: center;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4);
  }

  /* Two soft wedges of reflected light across the grooves, as on a real record. */
  .sheen {
    background: conic-gradient(
      from 20deg,
      rgb(255 255 255 / 0) 0deg,
      rgb(255 255 255 / 0.13) 22deg,
      rgb(255 255 255 / 0) 52deg,
      rgb(255 255 255 / 0) 180deg,
      rgb(255 255 255 / 0.1) 202deg,
      rgb(255 255 255 / 0) 232deg
    );
    mask: radial-gradient(circle, transparent 0 32%, #000 32.5%);
    pointer-events: none;
  }
</style>
