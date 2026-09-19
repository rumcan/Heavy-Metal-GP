#!/usr/bin/env node
/**
 * MB-10D placeholder art. Simple vector-style PNGs for the five launcher machines,
 * drawn with the same tiny software raster as mb10c (no image deps — Node zlib only).
 * Real art replaces these at the end of the epic; keep names stable: the skins
 * (render.ts) and the palette reference them as src/assets/game/<name>.png.
 *
 * The skins ROTATE these into their working pose, so each is authored in its rest
 * frame: the cannon barrel points along +x, the catapult arm runs right along +x
 * with its cup at the tip, and the flipper bat lies flat pointing right.
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

// ---------- cannon.png (96x96): banded barrel pointing +x, breech at the left ----------
{
  const r = new Raster(96, 96);
  const cy = 42;
  // barrel tube
  r.fillRect(12, cy - 13, 68, 26, col('#78350f'));
  r.fillRect(12, cy - 13, 68, 5, col('#a16207')); // top light
  // bands
  for (const x of [18, 38, 58]) {
    r.fillRect(x, cy - 15, 5, 30, col('#44403c'));
    r.fillRect(x + 1, cy - 15, 2, 30, col('#78716c'));
  }
  // muzzle collar
  r.fillRect(78, cy - 17, 8, 34, col('#1c1917'));
  r.fillRect(80, cy - 17, 3, 34, col('#57534e'));
  // dark bore
  r.fillCircle(84, cy, 7, col('#0c0a09'));
  // breech cap + knob (this end anchors to the pivot)
  r.fillCircle(14, cy, 14, col('#44403c'));
  r.fillCircle(14, cy, 7, col('#a8a29e'));
  // little flame mark on the breech
  r.fillCircle(12, cy, 3, col('#fcd34d', 180));
  r.save('cannon.png');
}

// ---------- blast.png (72x72): star burst ----------
{
  const r = new Raster(72, 72);
  const c = 36;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    r.line(c + Math.cos(a) * 8, c + Math.sin(a) * 8, c + Math.cos(a) * 32, c + Math.sin(a) * 32, i % 2 ? 4 : 7, col(i % 2 ? '#fb923c' : '#fcd34d'));
  }
  r.fillCircle(c, c, 14, col('#fcd34d'));
  r.fillCircle(c, c, 7, col('#fffbeb'));
  r.save('blast.png');
}

// ---------- catapult.png (160x40): arm running +x with the spoon cup at its tip ----------
{
  const r = new Raster(160, 40);
  // arm beam
  r.fillRect(4, 14, 128, 12, col('#92610f'));
  r.fillRect(4, 14, 128, 4, col('#b4791b'));
  r.fillRect(4, 14, 128, 12, col('#92610f', 235));
  // cross pegs
  for (const x of [24, 56, 88]) r.fillCircle(x + 4, 20, 4, col('#451a03'));
  // pivot boss at the base
  r.fillCircle(12, 20, 12, col('#44403c'));
  r.fillCircle(12, 20, 5, col('#a8a29e'));
  // spoon cup at the tip (open upward)
  r.ring(140, 18, 14, 5, col('#5b3a12'));
  r.fillRect(128, 30, 26, 6, col('#5b3a12'));
  r.fillCircle(140, 18, 8, col('#2b1708', 60));
  r.save('catapult.png');
}

// ---------- flipper.png (120x16): flat bat pointing right ----------
{
  const r = new Raster(120, 16);
  // body
  for (let x = 4; x < 104; x++) {
    const taper = Math.max(2, 14 - Math.floor((x / 120) * 6));
    r.fillRect(x, 8 - taper / 2, 1, taper, col('#9f1239'));
  }
  // white tip stripe
  r.fillRect(104, 3, 10, 10, col('#fda4af'));
  r.fillRect(104, 5, 10, 3, col('#fecdd3'));
  // pivot ring at the base
  r.ring(9, 8, 8, 3, col('#b45309'));
  r.fillCircle(9, 8, 3, col('#fde68a'));
  r.save('flipper.png');
}

// ---------- sling.png (60x68): wooden wedge frame with a stretched band ----------
{
  const r = new Raster(60, 68);
  // wooden triangle frame
  r.polygon([
    { x: 6, y: 26 }, { x: 54, y: 26 }, { x: 30, y: 62 },
  ], col('#713f12'));
  r.polygon([
    { x: 10, y: 28 }, { x: 50, y: 28 }, { x: 30, y: 56 },
  ], col('#8a5a2e', 220));
  // rubber band across the face
  r.line(4, 16, 30, 24, 6, col('#dc2626'));
  r.line(30, 24, 56, 16, 6, col('#dc2626'));
  r.line(4, 16, 30, 24, 2, col('#f87171'));
  r.line(30, 24, 56, 16, 2, col('#f87171'));
  // strap pegs
  r.fillCircle(4, 16, 5, col('#44403c'));
  r.fillCircle(56, 16, 5, col('#44403c'));
  r.save('sling.png');
}

// ---------- scoop.png (40x24): dark pocket with a brass lip ----------
{
  const r = new Raster(40, 24);
  // pocket interior
  r.fillCircle(20, 10, 13, col('#0c0a09'));
  r.fillCircle(20, 12, 10, col('#1c1917'));
  // brass rim (opens upward)
  r.ring(20, 10, 16, 4, col('#b45309'));
  r.fillRect(2, 8, 36, 5, col('#0c0a09', 220)); // sink the lower rim into the floor
  r.ring(20, 10, 16, 2, col('#f59e0b', 160));
  r.save('scoop.png');
}

// ---------- arrow.png (28x28): double chevron pointing up ----------
{
  const r = new Raster(28, 28);
  for (const y of [16, 8]) {
    r.line(4, y + 4, 14, y - 4 - 0, 4, col('#fde047'));
    r.line(24, y + 4, 14, y - 4 - 0, 4, col('#fde047'));
  }
  r.save('arrow.png');
}

console.log('MB-10D placeholder art done — real art replaces these before the epic ships; names stay.');
