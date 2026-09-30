// Covers are decoded ahead of time and kept referenced, so a record turning round doesn't have to
// decode its cover mid-animation, and the browser doesn't throw the decoded image away again.
const covers = new Map<string, HTMLImageElement>();

export function preloadCover(url: string) {
  if (!url || covers.has(url)) return;
  const img = new Image();
  img.src = url;
  img.decode().catch(() => covers.delete(url));
  covers.set(url, img);
}
