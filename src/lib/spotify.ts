import { getAccessToken } from './auth';

const API = 'https://api.spotify.com/v1';

export type Album = {
  id: string;
  name: string;
  artists: string;
  year: string;
  addedAt: string;
  tracks: number;
  cover: string;
  thumb: string;
  url: string;
};

type Image = { url: string; width: number | null };

type SavedAlbumsPage = {
  items: {
    added_at: string;
    album: {
      id: string;
      name: string;
      release_date: string;
      total_tracks: number;
      images: Image[];
      artists: { name: string }[];
      external_urls: { spotify: string };
    };
  }[];
  next: string | null;
  total: number;
};

export class AuthError extends Error {}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function request(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await getAccessToken();
  if (!token) throw new AuthError('Your session expired. Please sign in again.');

  const res = await fetch(url.startsWith('https://') ? url : `${API}${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });

  if (res.status === 401 && !retried) {
    await getAccessToken(true);
    return request(url, init, true);
  }
  if (res.status === 401) throw new AuthError('Your session expired. Please sign in again.');
  if (res.status === 429) {
    await sleep(Number(res.headers.get('Retry-After') ?? 1) * 1000);
    return request(url, init, retried);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error?.message ?? `Spotify returned an error (${res.status}).`);
  }
  return res;
}

async function get<T>(url: string): Promise<T> {
  try {
    return (await request(url)).json();
  } catch (err) {
    // Development Mode apps only allow users listed under User Management in the dashboard.
    if (err instanceof ApiError && err.status === 403) {
      throw new Error("This Spotify account isn't allowed to use the app yet. Add it under User Management in the Spotify dashboard.");
    }
    throw err;
  }
}

function toAlbum({ added_at, album }: SavedAlbumsPage['items'][number]): Album {
  const images = [...album.images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return {
    id: album.id,
    name: album.name,
    artists: album.artists.map((a) => a.name).join(', '),
    year: album.release_date.slice(0, 4),
    addedAt: added_at,
    tracks: album.total_tracks,
    cover: images[0]?.url ?? '',
    thumb: images.at(-1)?.url ?? '',
    url: album.external_urls.spotify,
  };
}

export async function fetchAlbums(onProgress?: (loaded: number, total: number) => void): Promise<Album[]> {
  const albums: Album[] = [];
  let url: string | null = '/me/albums?limit=50';
  while (url) {
    const page: SavedAlbumsPage = await get(url);
    albums.push(...page.items.map(toAlbum));
    onProgress?.(albums.length, page.total);
    url = page.next;
  }
  return albums;
}
