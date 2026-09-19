#!/usr/bin/env node
/**
 * MB-10F placeholder art. Five icons for the big set pieces: trampoline frame,
 * turnstile, pinbank, vortex bowl, ferry platform. Same tiny software raster as
 * mb10e. Real goblin-carnival art replaces these before the epic ships; names stay.
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



// ---------- trampoline.png (96x48): stretched net on a wooden frame ----------
{
  const r = new Raster(96, 48);
  r.fillRect(6, 8, 10, 30, col('#78350f'));
  r.fillRect(80, 8, 10, 30, col('#78350f'));
  r.line(16, 10, 48, 24, 3, col('#d4a04a'));
  r.line(80, 10, 48, 24, 3, col('#d4a04a'));
  for (const x of [26, 38, 58, 70]) {
    r.line(x, 9, 48, 23, 1, col('#b45309'));
    r.line(48, 23, x, 9, 1, col('#b45309'));
  }
  r.save('trampoline.png');
}

// ---------- turnstile.png (80x80): iron hub with wooden blades ----------
{
  const r = new Raster(80, 80);
  for (let a = 0; a < 4; a++) {
    const ang = (a * Math.PI) / 2 + Math.PI / 4;
    r.line(40, 40, 40 + Math.cos(ang) * 30, 40 + Math.sin(ang) * 30, 8, col('#8a5a2e'));
  }
  r.fillCircle(40, 40, 9, col('#44403c'));
  r.fillCircle(40, 40, 4, col('#b45309'));
  r.save('turnstile.png');
}

// ---------- targets.png (112x30): a bank of red pins ----------
{
  const r = new Raster(112, 30);
  for (let k = 0; k < 4; k++) {
    const x = 10 + k * 25;
    r.fillRect(x, 8, 17, 16, col('#b91c1c'));
    r.fillRect(x, 8, 17, 4, col('#fde68a'));
  }
  r.fillRect(6, 24, 100, 4, col('#334155'));
  r.save('targets.png');
}

// ---------- vortex.png (120x90): spiral bowl with a drain ring ----------
{
  const r = new Raster(120, 90);
  r.ring(60, 45, 40, 7, col('#7d3c98'));
  r.ring(60, 45, 28, 5, col('#38bdf8'));
  r.fillCircle(60, 45, 10, col('#0c0a09'));
  r.ring(60, 45, 13, 3, col('#e8813a'));
  r.save('vortex.png');
}

// ---------- platform.png (140x40): chained ferry pad ----------
{
  const r = new Raster(140, 40);
  for (const x of [30, 100]) {
    r.line(x, 4, x + 6, 16, 2, col('#57534e'));
  }
  r.fillRect(10, 16, 120, 12, col('#8a5a2e'));
  r.fillRect(10, 16, 120, 4, col('#b45309'));
  r.fillRect(10, 28, 120, 3, col('#3f2a14'));
  r.save('platform.png');
}

console.log('MB-10F placeholder art done — real art replaces these before the epic ships; names stay.');
