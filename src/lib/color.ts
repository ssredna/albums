// Spotify only provides front covers, so each spine is painted with the cover's dominant colour.

export type SpineColor = { bg: string; fg: string };

const KEY = 'spine-colors:v1';
const SAMPLE = 24;
const MAX_CONCURRENT = 6;

const cache: Record<string, SpineColor> = load();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function load(): Record<string, SpineColor> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {}
  }, 500);
}

const textFor = (r: number, g: number, b: number) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.58 ? '#1b1813' : '#f6f2ea';

/** Muted, stable colour derived from the id — used until (or if) the cover can't be sampled. */
export function placeholderColor(id: string): SpineColor {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return { bg: `hsl(${Math.abs(hash) % 360} 18% 38%)`, fg: '#f6f2ea' };
}

export const cachedColor = (id: string): SpineColor | undefined => cache[id];

// Bucket pixels by coarse colour and pick the heaviest bucket, favouring saturated colours
// so a small splash of colour on a grey cover still wins over a flat average.
function dominant(data: Uint8ClampedArray): [number, number, number] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number; weight: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(r, g, b);
    const sat = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, weight: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    bucket.weight += 1 + sat * 1.5;
    buckets.set(key, bucket);
  }
  let best = { r: 0, g: 0, b: 0, n: 1, weight: -1 };
  for (const bucket of buckets.values()) if (bucket.weight > best.weight) best = bucket;
  return [best.r / best.n, best.g / best.n, best.b / best.n].map(Math.round) as [number, number, number];
}

let canvas: HTMLCanvasElement | undefined;

function sample(src: string): Promise<SpineColor> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        canvas ??= Object.assign(document.createElement('canvas'), { width: SAMPLE, height: SAMPLE });
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
        const [r, g, b] = dominant(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data);
        resolve({ bg: `rgb(${r} ${g} ${b})`, fg: textFor(r, g, b) });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    img.src = src;
  });
}

let active = 0;
const queue: (() => void)[] = [];

function next() {
  if (active >= MAX_CONCURRENT) return;
  queue.shift()?.();
}

export function spineColor(id: string, src: string): Promise<SpineColor> {
  if (cache[id]) return Promise.resolve(cache[id]);
  return new Promise((resolve) => {
    queue.push(() => {
      active++;
      sample(src)
        .then((color) => {
          cache[id] = color;
          persist();
          resolve(color);
        })
        .catch(() => resolve(placeholderColor(id)))
        .finally(() => {
          active--;
          next();
        });
    });
    next();
  });
}
