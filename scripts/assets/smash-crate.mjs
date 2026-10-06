// Cuts the owner's smash crate (two stacked crates: a skull on the top one, a red SMASH on the bottom one; the end of
// the 2nd row of the sprite sheet assets/ui/c503cd05-...png) into the Infinity sprites: the whole stack, and its two
// crates on their own for the break (they fly apart when a ball rolls through).
// Run: node scripts/assets/smash-crate.mjs
import sharp from 'sharp';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(ROOT, 'assets', 'ui', 'c503cd05-4697-4fc3-ad21-7d17809098d9.png');
const OUT = join(ROOT, 'src', 'assets', 'game');

// The stack's opaque box on the 1254 px sheet, and the row of the dark seam between its two crates.
const BOX = { left: 954, top: 267, width: 230, height: 262 };
const SEAM = 399;

const parts = [
  ['smash-crate', BOX],
  ['smash-crate-top', { ...BOX, height: SEAM - BOX.top }],
  ['smash-crate-bottom', { ...BOX, top: SEAM, height: BOX.top + BOX.height - SEAM }],
];
for (const [name, box] of parts) {
  const info = await sharp(SRC).extract(box).webp({ quality: 88, alphaQuality: 90, effort: 6 }).toFile(join(OUT, `${name}.webp`));
  console.log(`${name}.webp ${info.width}x${info.height} ${(info.size / 1024).toFixed(1)} KB`);
}
