#!/usr/bin/env node
/**
 * MB-10E placeholder art. Five simple icons for the force-field kit: box fan,
 * horseshoe magnet, tar band, skimming pond, geyser vent. Drawn with the same
 * tiny software raster as mb10d (no image deps). Real art replaces these at the
 * end of the epic; keep names stable: render.ts and the palette reference them
 * as src/assets/game/<name>.png.
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


// ---------- wind.png (80x56): box fan in a tin shroud, blades mid-spin, teal swish ----------
{
  const r = new Raster(80, 56);
  // swish of carried air behind the blades
  r.line(46, 16, 74, 8, 5, col('#7dd3fc', 160));
  r.line(48, 28, 76, 28, 5, col('#7dd3fc', 120));
  r.line(46, 40, 72, 48, 5, col('#7dd3fc', 160));
  // shroud
  r.fillRect(8, 10, 40, 36, col('#57534e'));
  r.fillRect(8, 10, 40, 6, col('#78716c'));
  r.fillRect(8, 40, 40, 6, col('#292524'));
  // blades
  const cx = 28, cy = 28;
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 + 0.6;
    r.line(cx, cy, cx + Math.cos(a) * 14, cy + Math.sin(a) * 14, 6, col('#fbbf24'));
  }
  r.fillCircle(cx, cy, 5, col('#b45309'));
  // feet
  r.fillRect(12, 46, 8, 6, col('#1c1917'));
  r.fillRect(36, 46, 8, 6, col('#1c1917'));
  r.save('wind.png');
}

// ---------- magnet.png (60x56): red horseshoe, steel clamps, brass wires ----------
{
  const r = new Raster(60, 56);
  // horseshoe body: thick upside-down U
  r.ring(30, 26, 20, 8, col('#ef4444'));
  r.fillRect(8, 22, 9, 26, col('#ef4444'));
  r.fillRect(43, 22, 9, 26, col('#ef4444'));
  // steel tips
  r.fillRect(8, 40, 9, 9, col('#a8a29e'));
  r.fillRect(43, 40, 9, 9, col('#a8a29e'));
  // clamps
  r.fillRect(4, 14, 52, 6, col('#44403c'));
  // brass wire loops
  r.ring(12, 46, 5, 2, col('#fbbf24'));
  r.ring(48, 46, 5, 2, col('#fbbf24'));
  r.save('magnet.png');
}

// ---------- mud.png (96x30): tin trough spilling tar ----------
{
  const r = new Raster(96, 30);
  r.fillRect(6, 10, 84, 16, col('#78350f'));
  r.fillRect(6, 10, 84, 4, col('#a16207'));
  // glossy tar top with slow bubbles
  r.fillRect(8, 8, 80, 8, col('#1c1917'));
  r.fillCircle(30, 8, 3, col('#44403c'));
  r.fillCircle(58, 7, 2, col('#44403c'));
  // a dribble down the front
  r.fillRect(70, 16, 6, 10, col('#1c1917'));
  r.save('mud.png');
}

// ---------- pool.png (96x40): duck pond in a rough ceramic basin ----------
{
  const r = new Raster(96, 40);
  // basin
  r.fillRect(4, 10, 88, 24, col('#334155'));
  r.fillRect(4, 10, 88, 5, col('#475569'));
  // water bands
  r.fillRect(7, 12, 82, 16, col('#0369a1'));
  for (const x of [14, 34, 56, 76]) r.line(x, 16, x + 10, 16, 2, col('#7dd3fc'));
  for (const x of [22, 46, 66]) r.line(x, 22, x + 8, 22, 2, col('#38bdf8'));
  // splash arc
  r.ring(30, 12, 8, 2, col('#bae6fd'));
  r.save('pool.png');
}

// ---------- geyser.png (44x56): scrap cone vent, foamy burst ----------
{
  const r = new Raster(44, 56);
  // steam burst column
  for (const [y, w] of [[6, 6], [14, 8], [22, 10], [30, 12]]) r.fillRect(22 - w / 2, y, w, 8, col('#e2e8f0', 200));
  r.fillCircle(22, 6, 5, col('#f1f5f9'));
  r.fillCircle(16, 10, 4, col('#f1f5f9', 220));
  r.fillCircle(27, 9, 3, col('#f1f5f9', 220));
  // welded cone
  r.line(22, 36, 10, 52, 14, col('#78350f'));
  r.line(22, 36, 34, 52, 14, col('#78350f'));
  r.fillRect(8, 50, 28, 4, col('#44403c'));
  r.fillRect(14, 42, 16, 4, col('#a16207'));
  r.save('geyser.png');
}

console.log('MB-10E placeholder art done — real art replaces these before the epic ships; names stay.');
