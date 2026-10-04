// Cuts the owner's cloud sheets (assets/new-art/clouds_1.png, clouds_2.png) into one webp per cloud for the
// platformer's sky platforms. Each cloud is a connected blob of opaque pixels; specks (small blobs) are dropped and
// every pixel outside the cloud's own blob is cleared, so no stray colour comes along.
// Run: node scripts/assets/clouds.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(ROOT, '..', '..', 'assets', 'new-art'); // the main checkout keeps the owner's art (git-ignored)
const OUT = join(ROOT, 'src', 'assets', 'game', 'platformer', 'clouds');
mkdirSync(OUT, { recursive: true });

let n = 0;
for (const file of ['clouds_2.png', 'clouds_1.png']) {
  const { data, info } = await sharp(join(process.env.CLOUD_SRC ?? SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const opaque = (i) => data[i * 4 + 3] > 150 && data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] > 420; // white-ish cloud body
  const label = new Int32Array(W * H).fill(-1);
  const blobs = [];
  for (let start = 0; start < W * H; start++) {
    if (label[start] !== -1 || !opaque(start)) continue;
    const id = blobs.length, stack = [start];
    let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;
    label[start] = id;
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      area++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (j < 0 || j >= W * H || label[j] !== -1 || !opaque(j)) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue;
        label[j] = id; stack.push(j);
      }
    }
    blobs.push({ id, minX, minY, maxX, maxY, area });
  }
  for (const b of blobs.filter((b) => b.area > 20000).sort((p, q) => p.minY - q.minY || p.minX - q.minX)) {
    // grow the box a little so the soft edge (semi-transparent pixels next to the blob) is kept
    const pad = 14;
    const x0 = Math.max(0, b.minX - pad), y0 = Math.max(0, b.minY - pad), x1 = Math.min(W - 1, b.maxX + pad), y1 = Math.min(H - 1, b.maxY + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = (y0 + y) * W + (x0 + x), di = (y * w + x) * 4;
      // keep the pixel if it is in this blob or within `pad` of one of its pixels (cheap: a 3x3 neighbourhood scan of the label)
      let keep = label[si] === b.id;
      if (!keep && data[si * 4 + 3] > 0) {
        for (let dy = -pad; dy <= pad && !keep; dy += 2) for (let dx = -pad; dx <= pad && !keep; dx += 2) {
          const xx = x0 + x + dx, yy = y0 + y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && label[yy * W + xx] === b.id) keep = true;
        }
      }
      if (keep) data.copy(out, di, si * 4, si * 4 + 4);
    }
    const name = `cloud-${++n}.webp`;
    await sharp(out, { raw: { width: w, height: h, channels: 4 } }).resize({ width: Math.min(w, 520) }).webp({ quality: 80, alphaQuality: 90 }).toFile(join(OUT, name));
    console.log(name, w, 'x', h, 'from', file);
  }
}
