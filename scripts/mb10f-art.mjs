#!/usr/bin/env node
/**
 * MB-10F art processing: takes the AI-painted sources in art-gen/, keys out the
 * painted background (checkerboard greys or white), crops to content, and emits
 * game sprites into src/assets/game/. Pure-JS PNG codec (no deps).
 *
 * Run: node scripts/mb10f-art.mjs
 * (Replaces this script's original placeholder generator — the painted set shipped
 * for MB-10F; names must stay because sprites.ts keys by file basename.)
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'art-gen');
const OUT = join(ROOT, 'src/assets/game');

// ---------- tiny PNG codec ----------
function crc32(buf) {
  let t = crc32.t;
  if (!t) {
    t = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let pos = 8, w = 0, h = 0, depth = 0, color = 0;
  const idat = [];
  let plte = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error('only 8-bit pngs supported (depth ' + depth + ')');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!channels) throw new Error('unsupported color type ' + color);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = new Uint8ClampedArray(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = new Uint8Array(raw.buffer, raw.byteOffset + y * (stride + 1) + 1, stride).slice();
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      if (f === 1) row[x] = (row[x] + a) & 255;
      else if (f === 2) row[x] = (row[x] + b) & 255;
      else if (f === 3) row[x] = (row[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    prev = row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, j = x * channels;
      if (color === 6) { px[i] = row[j]; px[i + 1] = row[j + 1]; px[i + 2] = row[j + 2]; px[i + 3] = row[j + 3]; }
      else if (color === 2) { px[i] = row[j]; px[i + 1] = row[j + 1]; px[i + 2] = row[j + 2]; px[i + 3] = 255; }
      else if (color === 0) { px[i] = px[i + 1] = px[i + 2] = row[j]; px[i + 3] = 255; }
      else if (color === 4) { px[i] = px[i + 1] = px[i + 2] = row[j]; px[i + 3] = row[j + 1]; }
      else if (color === 3) {
        const idx = row[j];
        px[i] = plte[idx * 3]; px[i + 1] = plte[idx * 3 + 1]; px[i + 2] = plte[idx * 3 + 2];
        px[i + 3] = trns ? (trns[idx] ?? 255) : 255;
      }
    }
  }
  return { w, h, px };
}
function encodePng(w, h, px) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = px[y * stride + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- image ops ----------
/**
 * Key out the painted background. Two detectors, whichever is stronger:
 *  1. neutral+bright rule   — checkerboard tiles / white blow-outs (unsaturated AND light)
 *  2. corner-distance rule  — pixels close to the image's own corner colour
 * Warm/wood/iron pixels (saturated or dark) are protected by both rules.
 */
function keyBackground(img, { minLuma = 118, satTol = 15, soft = 26 } = {}) {
  const { w, h, px } = img;
  // corner reference: median-ish of the four 8x8 corner patches
  const corners = [0, 0, 0];
  let n = 0;
  for (const [cx, cy] of [[4, 4], [w - 4, 4], [4, h - 4], [w - 4, h - 4]]) {
    corners[0] += px[(cy * w + cx) * 4]; corners[1] += px[(cy * w + cx) * 4 + 1]; corners[2] += px[(cy * w + cx) * 4 + 2];
    n++;
  }
  const ref = corners.map((v) => v / n);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
    const sat = maxc - minc;
    const luma = (maxc + minc) / 2;
    const satD = Math.max(0, Math.min(1, (satTol - sat) / satTol));
    const lumD = Math.max(0, Math.min(1, (luma - minLuma) / soft));
    const dist = Math.abs(r - ref[0]) + Math.abs(g - ref[1]) + Math.abs(b - ref[2]);
    // saturated pixels can sit near a grey corner colour by accident — damp the rule there
    const distD = Math.max(0, Math.min(1, (44 - dist) / 18)) * (sat < 22 ? 1 : Math.max(0.2, 1 - (sat - 22) / 30));
    const bgness = Math.max(satD * lumD, distD * 0.9);
    const a = px[i * 4 + 3];
    px[i * 4 + 3] = Math.round(a * (1 - Math.min(1, bgness)));
  }
}
/** 1px erosion of the alpha edge to swallow keying halos. */
function erodeAlpha(img) {
  const { w, h, px } = img;
  const src = px.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] < 220) continue;
      let min = 255;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = src[((y + oy) * w + x + ox) * 4 + 3];
        if (a < min) min = a;
      }
      if (min < 200) px[i + 3] = min;
    }
  }
}
function bbox(img, minAlpha = 24) {
  const { w, h, px } = img;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > minAlpha) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
  return { x0, y0, x1, y1 };
}
function crop(img, x0, y0, x1, y1) {
  const nw = Math.round(x1 - x0), nh = Math.round(y1 - y0);
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const si = ((y + Math.round(y0)) * img.w + x + Math.round(x0)) * 4;
      for (let k = 0; k < 4; k++) out[(y * nw + x) * 4 + k] = img.px[si + k];
    }
  }
  return { w: nw, h: nh, px: out };
}
/** Center square crop. */
function square(img) {
  const side = Math.min(img.w, img.h);
  return crop(img, (img.w - side) / 2, (img.h - side) / 2, (img.w + side) / 2, (img.h + side) / 2);
}
/** Bilinear downscale. */
function resize(img, nw, nh) {
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const sy = (y + 0.5) * img.h / nh - 0.5;
    const y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(img.h - 1, y0 + 1), fy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < nw; x++) {
      const sx = (x + 0.5) * img.w / nw - 0.5;
      const x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(img.w - 1, x0 + 1), fx = Math.min(1, Math.max(0, sx - x0));
      for (let k = 0; k < 4; k++) {
        const a = img.px[(y0 * img.w + x0) * 4 + k], b = img.px[(y0 * img.w + x1) * 4 + k];
        const c = img.px[(y1 * img.w + x0) * 4 + k], d = img.px[(y1 * img.w + x1) * 4 + k];
        out[(y * nw + x) * 4 + k] = Math.round((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy);
      }
    }
  }
  return { w: nw, h: nh, px: out };
}
function save(img, name) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), encodePng(img.w, img.h, img.px));
  console.log(`wrote ${name} ${img.w}x${img.h}`);
}
const load = (name) => decodePng(readFileSync(join(SRC, name)));

// ---------- trampoline: poster + two end posts ----------
{
  const img = load('trampoline-src.png');
  keyBackground(img);
  erodeAlpha(img);
  const bb = bbox(img);
  // poster icon: full net region
  const poster = crop(img, bb.x0 - 6, bb.y0 - 10, bb.x1 + 6, bb.y1 + 6);
  save(resize(poster, 192, 96), 'trampoline.png');
  // left post, cropped tight; the right post is its mirror so the frame reads symmetrical
  const lw = (bb.x1 - bb.x0) * 0.10;
  const left = crop(img, bb.x0 - 4, bb.y0 - 8, bb.x0 + lw, bb.y1 + 4);
  const lbb = bbox(left);
  const post = resize(crop(left, lbb.x0, lbb.y0, lbb.x1 + 1, lbb.y1 + 1), 64, 96);
  save(post, 'trampoline-post-l.png');
  const flip = { w: post.w, h: post.h, px: new Uint8ClampedArray(post.px.length) };
  for (let y = 0; y < post.h; y++) {
    for (let x = 0; x < post.w; x++) {
      const si = (y * post.w + post.w - 1 - x) * 4, di = (y * post.w + x) * 4;
      for (let k = 0; k < 4; k++) flip.px[di + k] = post.px[si + k];
    }
  }
  save(flip, 'trampoline-post-r.png');
}

// ---------- turnstile: square rotor ----------
{
  const img = load('turnstile-src.png');
  keyBackground(img);
  erodeAlpha(img);
  const bb = bbox(img);
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
  const side = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) + 20;
  save(resize(crop(img, cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2), 160, 160), 'turnstile.png');
}

// ---------- targets: 4-pin strip poster + single standing pin ----------
{
  const img = load('targets-src.png');
  keyBackground(img);
  erodeAlpha(img);
  const bb = bbox(img);
  save(resize(crop(img, bb.x0 - 8, bb.y0 - 8, bb.x1 + 8, bb.y1 + 8), 224, 60), 'targets.png');
}
{
  const img = load('target-pin-src.png');
  keyBackground(img);
  erodeAlpha(img);
  const bb = bbox(img);
  // keep the plank + a hint of the iron base
  save(resize(crop(img, bb.x0 - 6, bb.y0 - 4, bb.x1 + 6, bb.y1 + 4), 48, 64), 'target-pin.png');
}

// ---------- vortex bowl ----------
{
  const img = load('vortex-src.png');
  keyBackground(img);
  erodeAlpha(img);
  save(resize(square(img), 240, 240), 'vortex.png');
}

// ---------- ferry platform ----------
{
  const img = load('platform-src.png');
  keyBackground(img);
  erodeAlpha(img);
  const bb = bbox(img);
  save(resize(crop(img, bb.x0 - 4, bb.y0 - 4, bb.x1 + 4, bb.y1 + 4), 280, 120), 'platform.png');
}

console.log('MB-10F painted sprites shipped.');
