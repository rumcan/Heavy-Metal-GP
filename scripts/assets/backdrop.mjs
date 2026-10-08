// The owner's painted backdrop strip (assets/new-art/reapeatable_bg3.png: the sky band with the floating islands) for
// the platformer's sky (render.ts, the top band). The game repeats it sideways, so its two ends are made to meet: the
// last BAND px are cross-faded over the first BAND px (the strip gets BAND px shorter). Kept at the painting's full size,
// lightly compressed (the owner: the old one was "a bit too optimised").
// Run: node scripts/assets/backdrop.mjs
import sharp from 'sharp';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = process.env.BACKDROP_SRC ?? join(ROOT, '..', '..', 'assets', 'new-art', 'reapeatable_bg3.png'); // the main checkout keeps the owner's art (git-ignored)
const OUT = join(ROOT, 'src', 'assets', 'game', 'platformer', 'sky-islands.webp');
const BAND = 200;

const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const w = W - BAND;
const out = Buffer.alloc(w * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3, a = (y * W + x) * 3;
    if (x >= BAND) { out[o] = data[a]; out[o + 1] = data[a + 1]; out[o + 2] = data[a + 2]; continue; }
    // the strip's end fades into its start: at x = 0 it is the end's next column, at x = BAND the start itself
    const t = x / BAND, s = t * t * (3 - 2 * t), b = (y * W + w + x) * 3;
    for (let c = 0; c < 3; c++) out[o + c] = Math.round(data[b + c] * (1 - s) + data[a + c] * s);
  }
}
const res = await sharp(out, { raw: { width: w, height: H, channels: 3 } }).webp({ quality: 88, effort: 6 }).toFile(OUT);
console.log(`sky-islands.webp ${res.width}x${res.height} ${(res.size / 1024).toFixed(0)} KB`);
