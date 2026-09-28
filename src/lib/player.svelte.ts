// In-browser playback via the Spotify Web Playback SDK (Premium only).
// https://developer.spotify.com/documentation/web-playback-sdk

import { getAccessToken, hasAllScopes, login } from './auth';
import { ApiError, request, type Album } from './spotify';

type Disc = { id: string; cover: string };
type Track = { name: string; artists: string; album: string; albumId: string; image: string };
export type Flight = { album: Album; from: DOMRect };

export const player = $state({
  /** The disc sitting in the player. */
  disc: null as Disc | null,
  /** A disc on its way from the shelf to the player. */
  flight: null as Flight | null,
  /** Album we've asked Spotify to play but whose first track hasn't been reported yet. */
  pending: null as Album | null,
  track: null as Track | null,
  paused: true,
  /** False when playback has moved to another device (phone, desktop app, …). */
  active: false,
  position: 0,
  duration: 0,
  /** performance.now() when position was reported, to interpolate progress between updates. */
  updatedAt: 0,
  /** Playback can't work here (e.g. no Premium) — fall back to opening Spotify. */
  unavailable: false,
  error: null as string | null,
});

const READY_TIMEOUT_MS = 15_000;

let sdk: Spotify.Player | undefined;
let connecting: Promise<void> | undefined;
let device: string | null = null;
let waiters: { resolve: (id: string) => void; reject: (err: Error) => void }[] = [];

function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  return new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.onerror = () => reject(new Error('Could not load the Spotify player.'));
    document.head.append(script);
  });
}

function fail(message: string, fatal: boolean) {
  player.error = message;
  if (fatal) player.unavailable = true;
  for (const waiter of waiters) waiter.reject(new Error(message));
  waiters = [];
}

async function connect() {
  await loadSdk();
  sdk = new Spotify.Player({
    name: 'Album Rack',
    getOAuthToken: (cb) => void getAccessToken().then((token) => token && cb(token)),
    volume: 0.8,
  });

  sdk.addListener('ready', ({ device_id }) => {
    device = device_id;
    for (const waiter of waiters) waiter.resolve(device_id);
    waiters = [];
  });
  sdk.addListener('not_ready', () => (device = null));
  sdk.addListener('player_state_changed', onState);
  sdk.addListener('initialization_error', ({ message }) => fail(`This browser can't play Spotify: ${message}`, true));
  sdk.addListener('authentication_error', () => fail('Spotify rejected the session. Try signing in again.', false));
  sdk.addListener('account_error', () => fail('Playing here needs Spotify Premium.', true));
  sdk.addListener('playback_error', ({ message }) => (player.error = message));

  if (!(await sdk.connect())) fail('Could not connect to Spotify.', false);
}

function deviceId(): Promise<string> {
  connecting ??= connect().catch((err) => {
    connecting = undefined;
    fail(err.message, false);
  });
  return connecting.then(
    () =>
      device ??
      new Promise<string>((resolve, reject) => {
        waiters.push({ resolve, reject });
        setTimeout(() => reject(new Error("The Spotify player didn't start. Try reloading.")), READY_TIMEOUT_MS);
      }),
  );
}

/** Start the SDK early so the first press of play is instant. */
export function warmUp() {
  if (hasAllScopes()) deviceId().catch(() => {});
}

function onState(state: Spotify.PlaybackState | null) {
  if (!state) {
    // Playback was transferred to another device.
    player.active = false;
    player.paused = true;
    return;
  }
  const current = state.track_window.current_track;
  const albumId = current.album.uri.split(':').pop() ?? '';
  const image = [...current.album.images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? '';

  // Ignore stale updates about the previous album while the new one is starting.
  if (player.pending && player.pending.id !== albumId) return;
  player.pending = null;

  player.active = true;
  player.paused = state.paused;
  player.position = state.position;
  player.duration = state.duration;
  player.updatedAt = performance.now();
  player.track = {
    name: current.name,
    artists: current.artists.map((a) => a.name).join(', '),
    album: current.album.name,
    albumId,
    image,
  };
  // Playback moved on to another album (autoplay, or changed from another device): swap the disc.
  if (player.disc && player.disc.id !== albumId && !player.flight) player.disc = { id: albumId, cover: image };
}

async function startPlayback(albumId: string, retried = false): Promise<void> {
  const id = await deviceId();
  try {
    await request(`/me/player/play?device_id=${id}`, {
      method: 'PUT',
      body: JSON.stringify({ context_uri: `spotify:album:${albumId}` }),
    });
  } catch (err) {
    // A freshly connected device can take a moment before the Web API knows about it.
    if (err instanceof ApiError && err.status === 404 && !retried) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return startPlayback(albumId, true);
    }
    throw err;
  }
}

export function playAlbum(album: Album, from: DOMRect) {
  if (player.unavailable) {
    window.open(album.url, '_blank', 'noopener');
    return;
  }
  if (!hasAllScopes()) {
    // Signed in before playback existed: ask Spotify for the extra permissions.
    login();
    return;
  }
  sdk?.activateElement(); // must run inside the click for autoplay rules (Safari/iOS)

  player.error = null;
  player.pending = album;
  player.flight = { album, from };
  startPlayback(album.id).catch((err) => {
    player.pending = null;
    player.error = err instanceof Error ? err.message : 'Playback failed.';
  });
}

export function landed(flight: Flight) {
  player.disc = { id: flight.album.id, cover: flight.album.cover };
  player.flight = null;
}

export async function toggle() {
  if (!sdk) return;
  if (player.active) return sdk.togglePlay();
  // Take playback back from whichever device has it.
  const id = await deviceId();
  await request('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [id], play: true }) }).catch(
    (err) => (player.error = err.message),
  );
}

export const next = () => sdk?.nextTrack();
export const previous = () => sdk?.previousTrack();
export const seek = (ms: number) => sdk?.seek(ms);

export function disconnect() {
  sdk?.disconnect();
  sdk = undefined;
  connecting = undefined;
  device = null;
  Object.assign(player, { disc: null, flight: null, pending: null, track: null, paused: true, active: false, error: null });
}
