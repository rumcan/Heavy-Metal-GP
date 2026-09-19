#!/usr/bin/env node
/**
 * MB-10D art processing: launcher + pinball sprites from the AI-painted sources in
 * art-gen/ (shared pipeline: scripts/lib/png-pipe.mjs). Straight drop-ins — the skins
 * already draw these names with procedural fallbacks, so the geometry is unchanged.
 */
import { load, save, square, keyBackground, erodeAlpha, bbox, crop, resize } from './lib/png-pipe.mjs';

const job = (srcName, outName, w, h, { doSquare = false } = {}) => {
  const img = load(srcName);
  keyBackground(img);
  erodeAlpha(img);
  const bb = bbox(img);
  const cut = doSquare
    ? square(crop(img, bb.x0 - 4, bb.y0 - 4, bb.x1 + 4, bb.y1 + 4))
    : crop(img, bb.x0 - 4, bb.y0 - 4, bb.x1 + 4, bb.y1 + 4);
  save(resize(cut, w, h), outName);
};

job('cannon-src.png', 'cannon.png', 192, 48);
job('blast-src.png', 'blast.png', 96, 96, { doSquare: true });
job('catapult-src.png', 'catapult.png', 224, 64);
job('flipper-src.png', 'flipper.png', 160, 48);
job('sling-src.png', 'sling.png', 120, 136);
job('scoop-src.png', 'scoop.png', 120, 72);

console.log('MB-10D painted sprites shipped.');
