// The owner's big cliff mountains (assets/new-art/large_cliff_{back,front}N.png, already cut out on transparency) for the
// sky behind the platformer's back track: each cropped to its own picture and written at the size the game draws it as
// src/assets/game/platformer/cliffs/cliff-{back,front}-N.webp; and the owner's cloud (clouds_3.png) that hides their feet
// as cliffs/cloud.webp.
// Run: node scripts/assets/cliffs.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = process.env.CLIFF_SRC ?? join(ROOT, '..', '..', 'assets', 'new-art'); // the main checkout keeps the owner's art (git-ignored)
const OUT = join(ROOT, 'src', 'assets', 'game', 'platformer', 'cliffs');
mkdirSync(OUT, { recursive: true });
/** The widest the game draws one (a front cliff spans about two thirds of a big screen; the back ones are smaller). */
const MAX_W = { back: 1200, front: 1400, cloud: 1000 };

const jobs = [['back', 1], ['back', 2], ['back', 3], ['front', 1], ['front', 2], ['front', 3], ['cloud', 0]];
for (const [kind, n] of jobs) {
  const file = join(SRC, kind === 'cloud' ? 'clouds_3.png' : `large_cliff_${kind}${n}.png`);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 12) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const k = Math.min(1, MAX_W[kind] / w);
  const res = await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: w, height: h })
    .resize(Math.round(w * k), Math.round(h * k))
    .webp({ quality: 70, alphaQuality: 70, effort: 6, smartSubsample: true })
    .toFile(join(OUT, kind === 'cloud' ? 'cloud.webp' : `cliff-${kind}-${n}.webp`));
  console.log(`${kind}${n} ${res.width}x${res.height} ${(res.size / 1024).toFixed(0)} KB`);
}
