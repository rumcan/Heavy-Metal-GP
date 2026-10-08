// Every picture the game draws on its race canvas is made here, so that all of them can be decoded ahead of time
// (preload.ts). A browser otherwise decodes a picture the first time it is drawn, which is a hitch in the middle of a
// race the first time a big tree line, island or backdrop comes on screen (the owner: smooth as possible).

/** Load order for the warm-up: what a race needs first. */
export type ArtPriority = 0 | 1 | 2;

const registry: { img: HTMLImageElement; priority: ArtPriority }[] = [];

/** A picture for the canvas (null outside a browser: node tests). `priority` 0 is decoded first, 2 last. */
export function artImage(src: string, priority: ArtPriority = 1): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  registry.push({ img, priority });
  return img;
}

/** Every registered picture, most urgent first. */
export function registeredArt(): HTMLImageElement[] {
  return [...registry].sort((a, b) => a.priority - b.priority).map((r) => r.img);
}

/** Is this picture loaded and decodable (a canvas can draw it)? */
export const artReady = (img: HTMLImageElement | null | undefined): img is HTMLImageElement => !!img && img.complete && img.naturalWidth > 0;
