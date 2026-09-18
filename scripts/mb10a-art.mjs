#!/usr/bin/env node
/**
 * MB-10A placeholder art. Simple vector-style PNGs for the five new track pieces,
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
    const r2 = r * r, i2 = (r - thick) * (r - thick);
    for (let yy = Math.floor(cy - r); yy <= cy + r; yy++)
      for (let xx = Math.floor(cx - r); xx <= cx + r; xx++) {
        const d = (xx - cx) ** 2 + (yy - cy) ** 2;
        if (d <= r2 && d >= i2) this.blend(xx, yy, c);
      }
  }
  line(x0, y0, x1, y1, thick, c) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy), steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + dx * i / steps, y = y0 + dy * i / steps;
      this.fillCircle(x, y, thick / 2, c);
    }
  }
  polygon(points, c) {
    const ys = points.map((p) => p.y);
    const minY = Math.floor(Math.min(...ys)), maxY = Math.ceil(Math.max(...ys));
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y))
          xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.floor(xs[k]); x <= xs[k + 1]; x++) this.blend(x, y, c);
    }
  }
  save(name) {
    writeFileSync(join(OUT, name), encodePNG(this.w, this.h, this.px));
    console.log('wrote', name, `${this.w}x${this.h}`);
  }
}

const col = (hex, a = 255) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a];

mkdirSync(OUT, { recursive: true });

// ---------- barricade.png (140x60): dark opening, planks, NO ENTRY sign ----------
{
  const r = new Raster(140, 60);
  r.fillRect(0, 0, 140, 60, col('#0a0e16'));
  // planks
  for (let i = 0; i < 3; i++) {
    const y = 6 + i * 18, tone = i % 2 ? '#8a5a33' : '#a06a3c';
    r.fillRect(4, y, 132, 14, col(tone));
    r.fillRect(4, y, 132, 2, col('#503015'));
    r.fillRect(4, y + 12, 132, 2, col('#503015'));
  }
  // diagonal brace
  r.line(8, 54, 132, 6, 8, col('#7c4f2a'));
  // sign with pale field (text is drawn by the skin; keep a red slash so it reads as a stop sign)
  r.fillRect(46, 20, 48, 20, col('#f3e9cf'));
  r.ring(70, 30, 22, 0, col('#000000')); // no-op keeps padding tool sane
  r.fillRect(46, 20, 48, 3, col('#422b14'));
  r.fillRect(46, 37, 48, 3, col('#422b14'));
  r.fillRect(46, 20, 3, 20, col('#422b14'));
  r.fillRect(91, 20, 3, 20, col('#422b14'));
  // red "no" mark: circle + slash
  r.ring(58, 30, 6, 2.5, col('#b3261e'));
  r.line(54, 34, 62, 26, 2.5, col('#b3261e'));
  save: r.save('barricade.png');
}

// ---------- tunnel.png (100x100): rubble-ringed burrow ----------
{
  const r = new Raster(100, 100);
  r.fillCircle(50, 50, 47, col('#574a39'));
  // rubble bumps around the ring
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rr = 43 + (i % 3) * 2;
    r.fillCircle(50 + Math.cos(a) * rr, 50 + Math.sin(a) * rr, 6 + (i % 2) * 2, col(i % 2 ? '#655744' : '#6b5c48'));
  }
  r.fillCircle(50, 50, 38, col('#3a3128'));
  // dark mouth with slight core
  r.fillCircle(50, 50, 31, col('#04060a'));
  r.fillCircle(50, 50, 18, col('#020305'));
  // wood lintel
  r.fillRect(19, 4, 62, 10, col('#6e4a2a'));
  r.fillRect(19, 12, 62, 2, col('#503015'));
  r.save('tunnel.png');
}

// ---------- crumble.png (100x140): cracked brick courses ----------
{
  const r = new Raster(100, 140);
  const rows = 6, bh = 140 / rows, bw = 50;
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? -bw / 2 : 0;
    for (let c = 0; c < 3; c++) {
      const x = c * bw + off;
      const tone = (row + c) % 2 ? '#7d7466' : '#8d8474';
      r.fillRect(x + 2, row * bh + 2, bw - 4, bh - 4, col(tone));
      r.fillRect(x + 2, row * bh + 2, bw - 4, 2, col('#9d9484'));
      r.fillRect(x + 2, row * bh + bh - 4, bw - 4, 2, col('#4a4438'));
    }
  }
  // cracks
  r.line(30, 10, 38, 24, 2, col('#221d16'));
  r.line(38, 24, 32, 40, 2, col('#221d16'));
  r.line(70, 50, 60, 60, 2, col('#221d16'));
  r.line(60, 60, 66, 78, 2, col('#221d16'));
  r.line(20, 86, 30, 96, 2, col('#221d16'));
  r.line(60, 104, 68, 116, 2, col('#221d16'));
  r.line(68, 116, 62, 130, 2, col('#221d16'));
  r.save('crumble.png');
}

// ---------- trapdoor.png (120x28): iron grating with a hinge knob at left ----------
{
  const r = new Raster(120, 28);
  r.fillRect(2, 5, 116, 18, col('#4f5a6a'));
  r.fillRect(2, 5, 116, 3, col('#6b7a8c'));
  r.fillRect(2, 20, 116, 3, col('#20262f'));
  for (let x = 12; x < 116; x += 12) r.fillRect(x, 8, 3, 12, col('#20262f'));
  r.fillCircle(4, 13, 5, col('#20262f'));
  r.fillCircle(4, 13, 2, col('#8f9aa8'));
  r.save('trapdoor.png');
}

// ---------- switchplate.png (24x120): fork blade with route arrows ----------
{
  const r = new Raster(24, 120);
  r.polygon([{ x: 7, y: 0 }, { x: 17, y: 0 }, { x: 17, y: 112 }, { x: 12, y: 119 }, { x: 7, y: 112 }], col('#8f4f2c'));
  r.polygon([{ x: 7, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 115 }, { x: 7, y: 112 }], col('#a8673f'));
  r.polygon([{ x: 15, y: 0 }, { x: 17, y: 0 }, { x: 17, y: 112 }, { x: 12, y: 119 }, { x: 15, y: 112 }], col('#3c2412'));
  // arrows pointing down-right (route)
  for (let i = 0; i < 3; i++) {
    const y = 12 + i * 30, a = 200 - i * 45;
    r.line(12, y, 12, y + 10, 2.5, col('#ffe6b0', a));
    r.line(12, y + 10, 8, y + 5, 2.5, col('#ffe6b0', a));
    r.line(12, y + 10, 16, y + 5, 2.5, col('#ffe6b0', a));
  }
  r.save('switchplate.png');
}
