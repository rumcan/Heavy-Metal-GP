#!/usr/bin/env node
/**
 * MB-10E art processing: field/surface sprites from the AI-painted sources in art-gen/.
 * Geyser keeps its placeholder for now (source generation is a follow-up); the rest
 * ship painted. Mud/pool are ellipse-masked rather than colour-keyed so the pale
 * foam/sheen rims survive — the skins underlay the animated strokes with this art.
 */
import { load, save, keyBackground, erodeAlpha, bbox, crop, resize, ellipseMask } from './lib/png-pipe.mjs';

const job = (srcName, outName, w, h) => {
  const img = load(srcName);
  keyBackground(img);
  erodeAlpha(img);
  const bb = bbox(img);
  save(resize(crop(img, bb.x0 - 4, bb.y0 - 4, bb.x1 + 4, bb.y1 + 4), w, h), outName);
};

job('wind-src.png', 'wind.png', 80, 56);
job('magnet-src.png', 'magnet.png', 120, 112);

for (const [srcName, outName] of [['mud-src.png', 'mud.png'], ['pool-src.png', 'pool.png']]) {
  const img = load(srcName);
  ellipseMask(img);      // cut the backdrop; keep every drop of sheen inside the blob
  const bb = bbox(img);
  save(resize(crop(img, bb.x0 - 4, bb.y0 - 4, bb.x1 + 4, bb.y1 + 4), 160, 56), outName);
}

console.log('MB-10E painted sprites shipped (geyser follows with its source).');
