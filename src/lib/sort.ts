import type { Album } from './spotify';

// Record-store convention: "The Beatles" files under B.
const sortName = (artist: string) => artist.replace(/^the\s+/i, '');

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

export const byArtist = (a: Album, b: Album) =>
  compare(sortName(a.artists), sortName(b.artists)) || a.year.localeCompare(b.year);

/** The divider an album files behind: its artist's initial, or # for anything that isn't a letter. */
export function letterOf(album: Album) {
  const first = sortName(album.artists).normalize('NFD').charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}
