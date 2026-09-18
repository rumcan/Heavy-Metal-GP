#!/usr/bin/env node
/**
 * MB-10B placeholder art. Simple vector-style PNGs for the five danger machines,
 * drawn with a tiny software raster (no image deps — Node zlib only).
 * Real art replaces these at the end of the epic; keep names stable: the skins
 * (render.ts) and palette reference them as src/assets/game/<name>.png.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/assets/game');

// ---------- minimal raster ----------
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

class Raster {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.px = Buffer.alloc(w * h * 4);
  }
  blend(x, y, [r, g, b, a]) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const na = a / 255, ia = 1 - na;
    this.px[i] = Math.round(r * na + this.px[i] * ia);
    this.px[i + 1] = Math.round(g * na + this.px[i + 1] * ia);
    this.px[i + 2] = Math.round(b * na + this.px[i + 2] * ia);
    this.px[i + 3] = Math.min(255, a + Math.round(this.px[i + 3] * ia));
  }
  fillRect(x, y, w, h, c) {
    for (let yy = Math.max(0, y | 0); yy < Math.min(this.h, y + h); yy++)
      for (let xx = Math.max(0, x | 0); xx < Math.min(this.w, x + w); xx++) this.blend(xx, yy, c);
  }
  fillCircle(cx, cy, r, c) {
    for (let yy = Math.floor(cy - r); yy <= cy + r; yy++)
      for (let xx = Math.floor(cx - r); xx <= cx + r; xx++)
        if ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) this.blend(xx, yy, c);
  }
  ring(cx, cy, r, thick, c) {
    const r2 = r * r, i2 = Math.max(0, (r - thick) * (r - thick));
    for (let yy = Math.floor(cy - r); yy <= cy + r; yy++)
      for (let xx = Math.floor(cx - r); xx <= cx + r; xx++) {
        const d = (xx - cx) ** 2 + (yy - cy) ** 2;
        if (d <= r2 && d >= i2) this.blend(xx, yy, c);
      }
  }
  line(x0, y0, x1, y1, thick, c) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy), steps = Math.max(1, Math.ceil(len * 2));
    for (let i = 0; i <= steps; i++) this.fillCircle(x0 + (dx * i) / steps, y0 + (dy * i) / steps, thick / 2, c);
  }
  polygon(points, c) {
    const ys = points.map((p) => p.y);
    const minY = Math.max(0, Math.floor(Math.min(...ys))), maxY = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y))
          xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.floor(xs[k]); x <= Math.ceil(xs[k + 1]); x++) this.blend(x, y, c);
    }
  }
  save(name) {
    writeFileSync(join(OUT, name), encodePNG(this.w, this.h, this.px));
    console.log('wrote', name, `${this.w}x${this.h}`);
  }
}

const col = (hex, a = 255) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a];

mkdirSync(OUT, { recursive: true });

// ---------- blade.png (70x170): iron arm + double axe head, pointing down ----------
{
  const r = new Raster(70, 170);
  // arm
  r.fillRect(31, 2, 8, 108, col('#4b5563'));
  r.fillRect(33, 2, 3, 108, col('#6b7280'));
  // rivets down the arm
  for (let y = 10; y < 104; y += 16) r.fillCircle(35, y, 2, col('#1f2937'));
  // axe head: two wings
  r.polygon([{ x: 35, y: 96 }, { x: 4, y: 122 }, { x: 8, y: 152 }, { x: 35, y: 132 }], col('#9ca3af'));
  r.polygon([{ x: 35, y: 96 }, { x: 66, y: 122 }, { x: 62, y: 152 }, { x: 35, y: 132 }], col('#9ca3af'));
  r.polygon([{ x: 35, y: 100 }, { x: 12, y: 124 }, { x: 14, y: 144 }, { x: 35, y: 128 }], col('#e5e7eb'));
  r.polygon([{ x: 35, y: 100 }, { x: 58, y: 124 }, { x: 56, y: 144 }, { x: 35, y: 128 }], col('#d1d5db'));
  // central spike
  r.polygon([{ x: 28, y: 128 }, { x: 42, y: 128 }, { x: 35, y: 168 }], col('#6b7280'));
  // hub
  r.fillCircle(35, 112, 9, col('#374151'));
  r.fillCircle(35, 112, 4, col('#b91c1c'));
  r.save('blade.png');
}

// ---------- saw.png (82x82): red-toothed disc, skull hub ----------
{
  const r = new Raster(82, 82);
  const cx = 41, cy = 41;
  // teeth
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const bx = cx + Math.cos(a) * 30, by = cy + Math.sin(a) * 30;
    const tx = cx + Math.cos(a + 0.16) * 40, ty = cy + Math.sin(a + 0.16) * 40;
    const cx2 = cx + Math.cos(a + 0.32) * 30, cy2 = cy + Math.sin(a + 0.32) * 30;
    r.polygon([{ x: bx, y: by }, { x: tx, y: ty }, { x: cx2, y: cy2 }], col('#dc2626'));
  }
  r.fillCircle(cx, cy, 31, col('#9ca3af'));
  r.ring(cx, cy, 31, 3, col('#4b5563'));
  // swirl
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    r.line(cx, cy, cx + Math.cos(a + 0.5) * 26, cy + Math.sin(a + 0.5) * 26, 4, col('#6b7280', 140));
  }
  // skull hub
  r.fillCircle(cx, cy, 12, col('#f3e9cf'));
  r.fillCircle(cx - 4, cy - 2, 2.5, col('#1f2937'));
  r.fillCircle(cx + 4, cy - 2, 2.5, col('#1f2937'));
  r.fillRect(cx - 3, cy + 4, 6, 3, col('#1f2937'));
  r.save('saw.png');
}

// ---------- crusher.png (150x60): iron-banded stone stamper ----------
{
  const r = new Raster(150, 60);
  r.fillRect(4, 4, 142, 52, col('#57534e'));
  // shading
  for (let y = 4; y < 56; y += 2) r.fillRect(4, y, 142, 1, col('#44403c', 90));
  // frame
  r.fillRect(4, 4, 142, 4, col('#292524'));
  r.fillRect(4, 52, 142, 4, col('#292524'));
  r.fillRect(4, 4, 4, 52, col('#292524'));
  r.fillRect(142, 4, 4, 52, col('#292524'));
  // iron bands
  r.fillRect(4, 14, 142, 7, col('#3f4653'));
  r.fillRect(4, 39, 142, 7, col('#3f4653'));
  // rivets
  for (let x = 12; x < 142; x += 17) {
    r.fillCircle(x, 17.5, 2, col('#a8a29e'));
    r.fillCircle(x, 42.5, 2, col('#a8a29e'));
  }
  // warning triangles on the face
  r.polygon([{ x: 66, y: 22 }, { x: 84, y: 22 }, { x: 75, y: 36 }], col('#eab308'));
  r.polygon([{ x: 70, y: 24 }, { x: 80, y: 24 }, { x: 75, y: 33 }], col('#1c1917'));
  r.save('crusher.png');
}

// ---------- crusher-house.png (170x46): cylinder housing the piston hangs from ----------
{
  const r = new Raster(170, 46);
  r.fillRect(6, 2, 158, 40, col('#3f4653'));
  for (let x = 6; x < 164; x += 20) r.fillRect(x, 4, 6, 36, col('#576072'));
  r.fillRect(6, 2, 158, 4, col('#1f2937'));
  r.fillRect(6, 40, 158, 4, col('#1f2937'));
  // chain stubs
  for (const x of [30, 85, 140]) {
    r.fillRect(x - 3, 0, 6, 4, col('#9ca3af'));
  }
  r.save('crusher-house.png');
}

// ---------- boulder.png (76x76): goblin-faced rock ----------
{
  const r = new Raster(76, 76);
  const cx = 38, cy = 38;
  r.fillCircle(cx, cy, 34, col('#78716c'));
  // bumps
  r.fillCircle(cx - 16, cy - 18, 9, col('#8a817c', 200));
  r.fillCircle(cx + 15, cy - 12, 7, col('#8a817c', 160));
  r.fillCircle(cx + 4, cy + 20, 8, col('#6b6360', 180));
  r.ring(cx, cy, 34, 3, col('#44403c'));
  // carve lines
  r.line(cx - 26, cy - 6, cx - 12, cy - 2, 2, col('#57534e', 170));
  r.line(cx + 12, cy + 10, cx + 26, cy + 14, 2, col('#57534e', 170));
  // face: glowing eyes + jagged grin
  r.fillCircle(cx - 11, cy - 8, 5, col('#292524'));
  r.fillCircle(cx - 11, cy - 8, 2, col('#f59e0b'));
  r.fillCircle(cx + 10, cy - 6, 4, col('#292524'));
  r.fillCircle(cx + 10, cy - 6, 1.6, col('#f59e0b'));
  // grin
  for (let i = 0; i < 6; i++) {
    const x = cx - 15 + i * 6;
    const y = cy + 12 + (i % 2) * 3;
    r.polygon([{ x, y }, { x: x + 5, y }, { x: x + 2.5, y: y + 5 }], col('#292524'));
  }
  r.save('boulder.png');
}

// ---------- mace.png (76x76): spiked iron ball ----------
{
  const r = new Raster(76, 76);
  const cx = 38, cy = 38;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const bx = cx + Math.cos(a) * 22, by = cy + Math.sin(a) * 22;
    const tx = cx + Math.cos(a + 0.13) * 36, ty = cy + Math.sin(a + 0.13) * 36;
    const cx2 = cx + Math.cos(a + 0.26) * 22, cy2 = cy + Math.sin(a + 0.26) * 22;
    r.polygon([{ x: bx, y: by }, { x: tx, y: ty }, { x: cx2, y: cy2 }], col('#6b7280'));
  }
  r.fillCircle(cx, cy, 24, col('#4b5563'));
  r.fillCircle(cx - 7, cy - 8, 10, col('#6b7280', 170));
  r.ring(cx, cy, 24, 3, col('#1f2937'));
  r.fillCircle(cx, cy, 5, col('#374151'));
  r.fillCircle(cx, cy, 2.5, col('#111827'));
  r.save('mace.png');
}

console.log('MB-10B placeholder art written to', OUT);
