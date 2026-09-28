import type { Album } from './spotify';

const KEY = 'albums:v1';

export function loadAlbums(): Album[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Album[]) : null;
  } catch {
    return null;
  }
}

export function saveAlbums(albums: Album[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(albums));
  } catch {
    // Storage full or blocked — the rack still works, it just reloads next visit.
  }
}

export function clearAlbums() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
