#!/usr/bin/env node
/**
 * MB-10C placeholder art. Simple vector-style PNGs for the five mover machines,
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


// ---------- wheel.png (128x128): wooden water wheel with bucket boxes ----------
{
  const r = new Raster(128, 128);
  const cx = 64, cy = 64;
  // buckets: little trough boxes around the rim
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bx = cx + Math.cos(a) * 52, by = cy + Math.sin(a) * 52;
    const c = Math.cos(a), s = Math.sin(a);
    // box aligned to the radius: two cheeks + floor
    r.line(bx - s * 9, by + c * 9, bx + s * 9, by - c * 9, 4, col('#6b4423'));
    r.line(bx + c * 7 - s * 9, by + s * 7 + c * 9, bx + c * 7 + s * 9, by + s * 7 - c * 9, 3, col('#54341a'));
    r.line(bx - c * 7 - s * 9, by - s * 7 + c * 9, bx - c * 7 + s * 9, by - s * 7 - c * 9, 3, col('#54341a'));
    // water in the trough
    r.fillCircle(bx, by, 4, col('#7dd3fc', 190));
  }
  // rim band
  r.ring(cx, cy, 44, 6, col('#8a5a2e'));
  r.ring(cx, cy, 47, 2, col('#3f2a14'));
  r.ring(cx, cy, 41, 2, col('#3f2a14'));
  // spokes
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    r.line(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, cx + Math.cos(a) * 42, cy + Math.sin(a) * 42, 4, col('#6b4423'));
  }
  // hub
  r.fillCircle(cx, cy, 11, col('#44403c'));
  r.fillCircle(cx, cy, 5, col('#a8a29e'));
  r.save('wheel.png');
}

// ---------- screw.png (64x112): tube with auger helix and windows ----------
{
  const r = new Raster(64, 112);
  // tube body
  r.fillRect(14, 6, 36, 100, col('#1c2b3a', 150));
  r.fillRect(14, 6, 4, 100, col('#3f4653'));
  r.fillRect(46, 6, 4, 100, col('#3f4653'));
  // windows
  for (let y = 14; y < 100; y += 18) r.fillRect(20, y, 24, 9, col('#0e1726', 130));
  // auger: offset sine helix
  for (let y = 8; y < 106; y++) {
    const phase = (y / 14) * Math.PI;
    const x = 32 + Math.sin(phase) * 11;
    r.fillCircle(x, y, 3, col('#d97706'));
  }
  for (let y = 8; y < 106; y++) {
    const phase = (y / 14) * Math.PI + 0.4;
    const x = 32 + Math.sin(phase) * 10;
    r.fillCircle(x, y, 1.4, col('#fbbf24', 190));
  }
  // entry collar at the bottom
  r.fillRect(10, 96, 44, 10, col('#4b5563'));
  for (const x of [16, 32, 48]) r.fillCircle(x, 101, 2, col('#a8a29e'));
  r.save('screw.png');
}

// ---------- conveyor.png (132x22): dark belt, chevrons, end rollers ----------
{
  const r = new Raster(132, 22);
  r.fillRect(6, 3, 120, 16, col('#1f2937'));
  r.fillRect(6, 3, 120, 3, col('#0b1220'));
  r.fillRect(6, 16, 120, 3, col('#0b1220'));
  // chevrons inside (tile cleanly every 22px)
  for (let x = 16; x < 126; x += 22) {
    r.polygon([{ x, y: 6 }, { x: x + 9, y: 11 }, { x, y: 16 }], col('#374151'));
    r.polygon([{ x: x + 2, y: 6 }, { x: x + 11, y: 11 }, { x: x + 2, y: 16 }], col('#4b5563'));
  }
  // end rollers
  r.fillCircle(7, 11, 8, col('#6b7280'));
  r.ring(7, 11, 8, 2, col('#374151'));
  r.fillCircle(125, 11, 8, col('#6b7280'));
  r.ring(125, 11, 8, 2, col('#374151'));
  r.line(7, 5, 7, 17, 2, col('#374151'));
  r.line(125, 5, 125, 17, 2, col('#374151'));
  r.save('conveyor.png');
}

// ---------- seesaw.png (140x16): timber plank with iron straps ----------
{
  const r = new Raster(140, 16);
  r.fillRect(2, 3, 136, 10, col('#8a5a2e'));
  r.fillRect(2, 3, 136, 3, col('#a3653d'));
  r.fillRect(2, 11, 136, 2, col('#54341a'));
  // grain
  for (let x = 8; x < 136; x += 17) r.fillRect(x, 5, 9, 1, col('#6b4423', 170));
  // iron straps (tile every 32px from the ends so stretching reads as bands)
  for (let x = 6; x < 134; x += 32) {
    r.fillRect(x, 2, 5, 12, col('#44403c'));
    r.fillCircle(x + 2.5, 5, 1, col('#a8a29e'));
    r.fillCircle(x + 2.5, 11, 1, col('#a8a29e'));
  }
  // centre pin
  r.fillCircle(70, 8, 3.5, col('#a8a29e'));
  r.fillCircle(70, 8, 1.6, col('#1f2937'));
  r.save('seesaw.png');
}

// ---------- bridge.png (56x14): rope-bridge slat with rope ties ----------
{
  const r = new Raster(56, 14);
  r.fillRect(1, 4, 54, 8, col('#a3653d'));
  r.fillRect(1, 4, 54, 2, col('#c08247'));
  r.fillRect(1, 10, 54, 2, col('#51321c'));
  for (let x = 6; x < 52; x += 11) r.fillRect(x, 6, 6, 1, col('#7a4a26', 180));
  // rope ties at both ends
  for (const x of [4, 50]) {
    r.line(x, 0, x, 13, 2.4, col('#b45309'));
    r.fillCircle(x, 3, 1.6, col('#78350f'));
  }
  r.save('bridge.png');
}

console.log('MB-10C placeholder art written to', OUT);
