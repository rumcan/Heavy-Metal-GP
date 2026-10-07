// The owner's floating islands (assets/new-art/fireground_island_N.png) for the platformer's foreground: each cropped to
// its own picture, cut out where it came on a black backdrop (a flood fill of the near-black pixels from the edges, with
// a soft edge), and written at the size the game draws it as src/assets/game/platformer/islands/island-N.webp.
// Run: node scripts/assets/islands.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = process.env.ISLAND_SRC ?? join(ROOT, '..', '..', 'assets', 'new-art'); // the main checkout keeps the owner's art (git-ignored)
const OUT = join(ROOT, 'src', 'assets', 'game', 'platformer', 'islands');
mkdirSync(OUT, { recursive: true });
/** The longest side the game ever needs (a near island fills about half a big screen). */
const MAX_SIDE = 700;

for (let n = 1; n <= 15; n++) {
  const { data, info } = await sharp(join(SRC, `fireground_island_${n}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  // A black backdrop (no transparency at the corners): clear every near-black pixel joined to the edge.
  if (data[3] > 200) {
    const dark = (i) => Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 26;
    const seen = new Uint8Array(W * H);
    const stack = [];
    for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
    while (stack.length) {
      const i = stack.pop();
      if (seen[i] || !dark(i)) continue;
      seen[i] = 1;
      data[i * 4 + 3] = 0;
      const x = i % W;
      if (x > 0) stack.push(i - 1);
      if (x < W - 1) stack.push(i + 1);
      if (i >= W) stack.push(i - W);
      if (i < W * (H - 1)) stack.push(i + W);
    }
    // soften the cut: a pixel next to the cleared backdrop keeps alpha by how bright it is
    for (let i = 0; i < W * H; i++) {
      if (seen[i] || data[i * 4 + 3] === 0) continue;
      const x = i % W;
      const edge = (x > 0 && seen[i - 1]) || (x < W - 1 && seen[i + 1]) || (i >= W && seen[i - W]) || (i < W * (H - 1) && seen[i + W]);
      if (edge) data[i * 4 + 3] = Math.min(255, Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) * 4);
    }
  }
  // crop to the picture
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 16) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const out = join(OUT, `island-${n}.webp`);
  const res = await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: w, height: h })
    .resize(Math.round(w * k), Math.round(h * k))
    .webp({ quality: 72, alphaQuality: 85 })
    .toFile(out);
  console.log(`island-${n}.webp ${res.width}x${res.height} ${(res.size / 1024).toFixed(0)} KB`);
}
