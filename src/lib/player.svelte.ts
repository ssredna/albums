// In-browser playback via the Spotify Web Playback SDK (Premium only).
// https://developer.spotify.com/documentation/web-playback-sdk

import { getAccessToken, hasAllScopes, login } from './auth';
import { ApiError, request, type Album } from './spotify';

type Disc = { id: string; cover: string; trackIds: string[] };
type Track = {
  /** Both the played id and, if Spotify relinked it to a regional version, the original id. */
  ids: string[];
  name: string;
  artists: string;
  album: string;
  albumId: string;
  image: string;
};
export type Flight = { album: Album; from: DOMRect };

export const player = $state({
  /** The disc sitting in the player. */
  disc: null as Disc | null,
  /** A disc on its way from the shelf to the player. */
  flight: null as Flight | null,
  /** Album on its way to playing (flying, being cued, or starting) until Spotify reports its first track. */
  pending: null as Album | null,
  /** The record has landed and the arm is swinging onto it; playback starts once it's there. */
  cueing: false,
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

/** How long the tonearm takes to swing onto the record. */
export const ARM_MS = 800;
const READY_TIMEOUT_MS = 15_000;
const PENDING_TIMEOUT_MS = 5000;
const SYNC_MS = 1000;

let sdk: Spotify.Player | undefined;
let connecting: Promise<void> | undefined;
let device: string | null = null;
let waiters: { resolve: (id: string) => void; reject: (err: Error) => void }[] = [];
/** When the play request for the pending album went out (Infinity until it has). */
let pendingSince = Infinity;
let syncTimer: ReturnType<typeof setInterval> | undefined;

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

  // State events from the SDK are occasionally missed; poll its local state as a safety net.
  syncTimer = setInterval(sync, SYNC_MS);
}

async function sync() {
  if (!sdk || !device) return;
  onState(await sdk.getCurrentState());
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
  const ids = [current.id, current.linked_from?.id].filter((id): id is string => !!id);
  const image = [...current.album.images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? '';
  const onAlbum = (album: { id: string; trackIds: string[] }) =>
    album.id === albumId || ids.some((id) => album.trackIds.includes(id));

  // While a new album is starting, ignore stale updates about the previous one, and the new one's
  // loading/paused updates before sound actually starts (they'd stop the platter for a moment).
  // Matched on track ids too, since Spotify may report a relinked (regional) album id. Gives up
  // waiting after a few seconds.
  const started = player.pending && onAlbum(player.pending) && !state.paused && !state.loading;
  if (player.pending && !started && performance.now() - pendingSince < PENDING_TIMEOUT_MS) return;
  player.pending = null;
  player.cueing = false;

  player.active = true;
  player.paused = state.paused;
  player.position = state.position;
  player.duration = state.duration;
  player.updatedAt = performance.now();
  player.track = {
    ids,
    name: current.name,
    artists: current.artists.map((a) => a.name).join(', '),
    album: current.album.name,
    albumId,
    image,
  };
  // Playback moved on to another album (autoplay, or changed from another device): swap the disc.
  if (player.disc && !onAlbum(player.disc) && !player.flight) player.disc = { id: albumId, cover: image, trackIds: [] };
}

async function startPlayback(albumId: string, retried = false): Promise<void> {
  const id = await deviceId();
  try {
    // A record plays from the first track, in order: start at track 1 explicitly, since Spotify may
    // remember shuffle for an album and otherwise pick a random opener.
    await request(`/me/player/play?device_id=${id}`, {
      method: 'PUT',
      body: JSON.stringify({ context_uri: `spotify:album:${albumId}`, offset: { position: 0 } }),
    });
    await request(`/me/player/shuffle?state=false&device_id=${id}`, { method: 'PUT' }).catch(() => {});
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

  // Lifting the needle: stop whatever is playing while the new record comes over.
  if (player.active && !player.paused) {
    player.paused = true;
    sdk?.pause();
  }

  player.error = null;
  player.pending = album;
  pendingSince = Infinity;
  player.flight = { album, from };
  deviceId().catch(() => {}); // connect while the record is in the air
}

/** The record is on the platter: swing the arm over, and start playing once the needle is down. */
export function landed(flight: Flight) {
  const { album } = flight;
  player.disc = { id: album.id, cover: album.cover, trackIds: album.trackIds };
  player.flight = null;
  player.cueing = true;

  setTimeout(() => {
    if (player.pending?.id !== album.id) return; // another record was picked meanwhile
    pendingSince = performance.now();
    startPlayback(album.id).catch((err) => {
      player.pending = null;
      player.cueing = false;
      player.error = err instanceof Error ? err.message : 'Playback failed.';
    });
  }, ARM_MS);
}

export async function toggle() {
  if (!sdk || player.pending) return; // a record is on its way; it starts by itself
  if (player.active) {
    // Show it immediately; the SDK confirms shortly after.
    const now = performance.now();
    if (!player.paused) player.position += now - player.updatedAt; // freeze where it was
    player.updatedAt = now;
    player.paused = !player.paused;
    await sdk.togglePlay();
    return sync();
  }
  // Take playback back from whichever device has it.
  const id = await deviceId();
  await request('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [id], play: true }) }).catch(
    (err) => (player.error = err.message),
  );
}

export const next = () => sdk?.nextTrack();
export const previous = () => sdk?.previousTrack();

export function disconnect() {
  clearInterval(syncTimer);
  sdk?.disconnect();
  sdk = undefined;
  connecting = undefined;
  device = null;
  Object.assign(player, {
    disc: null,
    flight: null,
    pending: null,
    cueing: false,
    track: null,
    paused: true,
    active: false,
    error: null,
  });
}
