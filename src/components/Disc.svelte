<script lang="ts">
  // A CD with the album art printed on it. The print spins; the reflections stay put, like real light.
  let { cover, spinning = false }: { cover: string; spinning?: boolean } = $props();
</script>

<div class="disc" class:spinning>
  <div class="print" style:background-image="url({cover})"></div>
  <div class="sheen"></div>
</div>

<style>
  .disc {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    filter: drop-shadow(0 6px 12px rgb(0 0 0 / 0.35));
  }

  .print,
  .sheen {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    /* Punch the centre hole. */
    mask: radial-gradient(circle, transparent 0 7%, #000 calc(7% + 0.5px));
  }

  .print {
    background-color: #d9d9de;
    background-size: cover;
    background-position: center;
    animation: spin 8s linear infinite;
    animation-play-state: paused;
  }

  .spinning .print {
    animation-play-state: running;
  }

  .sheen {
    background:
      /* clear hub, mirrored stacking ring, rim */
      radial-gradient(
        circle,
        rgb(225 228 236 / 0.55) 0 14.5%,
        rgb(255 255 255 / 0.85) 14.5% 15.2%,
        rgb(0 0 0 / 0.2) 15.2% 16%,
        transparent 16% 97.4%,
        rgb(255 255 255 / 0.4) 97.4% 98.6%,
        rgb(0 0 0 / 0.3) 98.6%
      ),
      /* light catching the surface */
      conic-gradient(
          from 25deg,
          rgb(255 255 255 / 0) 0deg,
          rgb(255 255 255 / 0.28) 28deg,
          rgb(255 255 255 / 0) 64deg,
          rgb(255 255 255 / 0) 190deg,
          rgb(255 255 255 / 0.2) 222deg,
          rgb(255 255 255 / 0) 258deg
        );
  }

  @keyframes spin {
    to {
      transform: rotate(1turn);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .print {
      animation: none;
    }
  }
</style>
