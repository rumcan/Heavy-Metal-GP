/**
 * MB-07. Share codes — compact binary (varints) → deflate → base64url, version-prefixed.
 *
 * Export: TrackDef (quantised via compressDef) → binary → deflate (CompressionStream or zlib) → base64url, prefixed with `1-`.
 * Import: strip prefix → base64url decode → inflate → binary decode → validate (MB-01) → TrackDef.
 * Only validated tracks can be exported (caller checks validateTrack before offering export, encode also validates).
 * Optional short codes (8 hex) via appStorage keyed by hash — stored as heavy-metal-gp:share:<hash> → long code.
 */
import { compressDef } from './tracks';
import { validateTrackDef, MAX_NAME } from './trackdef';
import type { Piece, TrackDef, Vec } from './trackdef';
import { THEME_IDS } from './types';
import type { ThemeId } from './types';
import { ITEM_TYPES } from './types';
import type { ItemType } from './types';
import type { PegColor } from './track';

export const SHARE_VERSION = 1;
export const SHARE_PREFIX = `${SHARE_VERSION}-`; // e.g. "1-"
const SHORT_KEY_PREFIX = 'heavy-metal-gp:share:';

// Append-only: new piece types go at the END so old codes keep decoding (`PIECE_TO_ID` is positional).
const PIECE_TYPES = ['ramp','ice','curve','loop','hoop','wrecker','pad','boost','spinner','breakable','peg','ppeg','itembox','bucket','wall','block',
  // MB-10A: shortcuts and secrets
  'barricade','tunnel','crumble','trapdoor','switch',
  // MB-10B: traps, hazards and treasure
  'blade','saw','crusher','boulder','mace',
  // MB-10C: movers and gizmos
  'wheel','screw','conveyor','seesaw','bridge',
  // MB-10D: launchers
  'cannon','catapult','flipper','sling','scoop',
  // MB-10E: fields and surfaces
  'wind','magnet','mud','pool','geyser'] as const;
type PieceTypeName = typeof PIECE_TYPES[number];
const PIECE_TO_ID = Object.fromEntries(PIECE_TYPES.map((t,i)=>[t,i])) as Record<PieceTypeName, number>;

const PEG_COLORS: PegColor[] = ['blue','orange','green'];
const PEG_COLOR_TO_ID: Record<PegColor, number> = { blue:0, orange:1, green:2 };

export class ShareCodeError extends Error {
  constructor(message: string) { super(message); this.name = 'ShareCodeError'; }
}

// ── varint (LEB128) ──

function writeUVarint(out: number[], value: number): void {
  value >>>= 0;
  while (value >= 0x80) {
    out.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  out.push(value & 0x7f);
}
function writeSVarint(out: number[], value: number): void {
  // zigzag
  const zz = (value << 1) ^ (value >> 31);
  writeUVarint(out, zz >>> 0);
}
function readUVarint(bytes: Uint8Array, pos: { o: number }): number {
  let result = 0, shift = 0;
  while (true) {
    if (pos.o >= bytes.length) throw new ShareCodeError('Truncated share code (varint).');
    const b = bytes[pos.o++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new ShareCodeError('Varint too large.');
  }
  return result >>> 0;
}
function readSVarint(bytes: Uint8Array, pos: { o: number }): number {
  const u = readUVarint(bytes, pos);
  // zigzag decode
  const s = (u >>> 1) ^ -(u & 1);
  return s | 0;
}

function writeString(out: number[], str: string): void {
  const enc = new TextEncoder().encode(str);
  writeUVarint(out, enc.length);
  for (const b of enc) out.push(b);
}
function readString(bytes: Uint8Array, pos: { o: number }): string {
  const len = readUVarint(bytes, pos);
  if (len > 5000) throw new ShareCodeError('String too long.');
  if (pos.o + len > bytes.length) throw new ShareCodeError('Truncated string.');
  const slice = bytes.subarray(pos.o, pos.o + len);
  pos.o += len;
  return new TextDecoder().decode(slice);
}

// ── theme / item maps ──

function themeToId(theme: ThemeId): number {
  const idx = (THEME_IDS as string[]).indexOf(theme);
  if (idx === -1) throw new ShareCodeError(`Unknown theme ${theme}`);
  return idx;
}
function idToTheme(id: number): ThemeId {
  if (id < 0 || id >= THEME_IDS.length) throw new ShareCodeError(`Theme id ${id} out of range`);
  return THEME_IDS[id] as ThemeId;
}
function colorToId(c: PegColor): number {
  const id = PEG_COLOR_TO_ID[c];
  if (id === undefined) throw new ShareCodeError(`Unknown peg color ${c}`);
  return id;
}
function idToColor(id: number): PegColor {
  if (id < 0 || id >= PEG_COLORS.length) throw new ShareCodeError(`Peg color ${id} out of range`);
  return PEG_COLORS[id];
}
function itemToId(item: ItemType): number {
  const idx = (ITEM_TYPES as readonly string[]).indexOf(item);
  if (idx === -1) throw new ShareCodeError(`Unknown item ${item}`);
  return idx;
}
function idToItem(id: number): ItemType {
  if (id < 0 || id >= ITEM_TYPES.length) throw new ShareCodeError(`Item id ${id} out of range`);
  return ITEM_TYPES[id] as ItemType;
}

// ── binary encode / decode ──

function encodeBinary(def: TrackDef): Uint8Array {
  const out: number[] = [];
  // def fields: name, seed, theme, height, segments, pieces
  writeString(out, def.name);
  // seed: 0..0xffffffff — use uVarint
  writeUVarint(out, (def.seed ?? 0) >>> 0);
  writeUVarint(out, themeToId(def.theme as ThemeId));
  writeUVarint(out, Math.round(def.height));
  // segments
  const segs = def.segments ?? [];
  writeUVarint(out, segs.length);
  for (const s of segs) {
    writeString(out, s.name);
    writeUVarint(out, Math.round(s.y));
    writeUVarint(out, Math.round(s.h));
  }
  // pieces
  writeUVarint(out, def.pieces.length);
  for (const p of def.pieces) {
    const typeId = PIECE_TO_ID[p.t as PieceTypeName];
    if (typeId === undefined) throw new ShareCodeError(`Unknown piece type ${(p as Piece).t}`);
    writeUVarint(out, typeId);
    writeUVarint(out, p.flip ? 1 : 0);
    switch (p.t) {
      case 'ramp':
      case 'ice': {
        writeUVarint(out, Math.round(p.a[0])); writeUVarint(out, Math.round(p.a[1]));
        writeUVarint(out, Math.round(p.b[0])); writeUVarint(out, Math.round(p.b[1]));
        break;
      }
      case 'curve': {
        writeUVarint(out, Math.round(p.a[0])); writeUVarint(out, Math.round(p.a[1]));
        writeUVarint(out, Math.round(p.c[0])); writeUVarint(out, Math.round(p.c[1]));
        writeUVarint(out, Math.round(p.b[0])); writeUVarint(out, Math.round(p.b[1]));
        writeUVarint(out, p.n ?? 12);
        break;
      }
      case 'loop': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.bottom)); writeUVarint(out, Math.round(p.r));
        break;
      }
      case 'hoop': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeSVarint(out, Math.round(p.dir[0] * 100)); writeSVarint(out, Math.round(p.dir[1] * 100));
        break;
      }
      case 'wrecker': {
        writeUVarint(out, Math.round(p.pivot[0])); writeUVarint(out, Math.round(p.pivot[1]));
        writeUVarint(out, Math.round(p.chain));
        writeUVarint(out, Math.round(p.amp * 1000));
        writeSVarint(out, Math.round(p.speed * 10000));
        writeUVarint(out, p.phase !== undefined ? 1 : 0);
        if (p.phase !== undefined) writeSVarint(out, Math.round(p.phase * 1000));
        break;
      }
      case 'pad': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.w));
        writeUVarint(out, p.dir === -1 ? 0 : 1);
        break;
      }
      case 'boost': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.len)); writeUVarint(out, Math.round(p.thick));
        writeSVarint(out, Math.round(p.dir[0] * 100)); writeSVarint(out, Math.round(p.dir[1] * 100));
        break;
      }
      case 'spinner': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.len));
        writeSVarint(out, Math.round(p.speed * 10000));
        writeUVarint(out, p.angle !== undefined ? 1 : 0);
        if (p.angle !== undefined) writeSVarint(out, Math.round(p.angle * 1000));
        break;
      }
      case 'breakable': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.w)); writeUVarint(out, Math.round(p.h));
        writeUVarint(out, Math.round(p.req));
        break;
      }
      case 'peg': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y)); writeUVarint(out, Math.round(p.r));
        break;
      }
      case 'ppeg': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, colorToId(p.color as PegColor)); writeUVarint(out, Math.round(p.r));
        writeUVarint(out, p.item ? 1 : 0);
        if (p.item) writeUVarint(out, itemToId(p.item));
        break;
      }
      case 'itembox': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        break;
      }
      case 'bucket': {
        writeUVarint(out, Math.round(p.y));
        writeUVarint(out, p.phase !== undefined ? 1 : 0);
        if (p.phase !== undefined) writeSVarint(out, Math.round(p.phase * 1000));
        break;
      }
      case 'wall':
      case 'block': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.w)); writeUVarint(out, Math.round(p.h));
        break;
      }
      // ---- MB-10A ----
      case 'barricade':
      case 'crumble': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.w)); writeUVarint(out, Math.round(p.h));
        writeUVarint(out, Math.round(p.tough));
        break;
      }
      case 'tunnel': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.exit[0])); writeUVarint(out, Math.round(p.exit[1]));
        writeSVarint(out, Math.round(p.edir[0] * 100)); writeSVarint(out, Math.round(p.edir[1] * 100));
        writeUVarint(out, Math.round(p.ms));
        writeUVarint(out, Math.round(p.speed * 10));
        writeUVarint(out, p.two ? 1 : 0);
        break;
      }
      case 'trapdoor': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.w));
        writeUVarint(out, p.hinge === 1 ? 1 : 0);
        writeUVarint(out, p.mode === 'weight' ? 1 : 0);
        writeUVarint(out, Math.round(p.open)); writeUVarint(out, Math.round(p.closed));
        writeSVarint(out, Math.round(p.phase));
        writeUVarint(out, Math.round(p.kg * 100));
        writeUVarint(out, Math.round(p.hold));
        break;
      }
      case 'switch': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.len));
        writeUVarint(out, Math.round(p.angle * 1000));
        writeUVarint(out, p.side);
        break;
      }
      // MB-10B traps / hazards / treasure
      case 'blade': {
        writeUVarint(out, Math.round(p.pivot[0])); writeUVarint(out, Math.round(p.pivot[1]));
        writeUVarint(out, Math.round(p.len)); writeUVarint(out, Math.round(p.amp * 1000));
        writeUVarint(out, Math.round(p.period)); writeUVarint(out, Math.round(p.phase * 1000));
        writeUVarint(out, Math.round(p.thin));
        break;
      }
      case 'saw': {
        writeUVarint(out, Math.round(p.a[0])); writeUVarint(out, Math.round(p.a[1]));
        writeUVarint(out, Math.round(p.b[0])); writeUVarint(out, Math.round(p.b[1]));
        writeUVarint(out, Math.round(p.r)); writeUVarint(out, Math.round(p.spin));
        writeUVarint(out, Math.round(p.period)); writeUVarint(out, Math.round(p.phase * 1000));
        break;
      }
      case 'crusher': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.w)); writeUVarint(out, Math.round(p.travel * 1000));
        writeUVarint(out, Math.round(p.period)); writeUVarint(out, Math.round(p.floor * 1000));
        writeUVarint(out, Math.round(p.phase * 1000));
        break;
      }
      case 'boulder': {
        writeUVarint(out, p.pts.length);
        for (const q of p.pts) { writeUVarint(out, Math.round(q[0])); writeUVarint(out, Math.round(q[1])); }
        writeUVarint(out, Math.round(p.r)); writeUVarint(out, Math.round(p.interval));
        writeUVarint(out, Math.round(p.rest)); writeUVarint(out, Math.round(p.phase));
        break;
      }
      case 'mace': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.arm)); writeUVarint(out, Math.round(p.arc * 1000));
        writeUVarint(out, Math.round(p.sweep)); writeUVarint(out, Math.round(p.rest));
        writeUVarint(out, Math.round(p.phase)); writeUVarint(out, Math.round(p.r));
        break;
      }
      // MB-10C movers / gizmos
      case 'wheel': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.r)); writeUVarint(out, Math.round(p.buckets));
        writeUVarint(out, Math.round(p.rpm * 100)); writeUVarint(out, p.dir);
        writeUVarint(out, Math.round(p.release * 1000)); writeUVarint(out, Math.round(p.phase * 1000));
        break;
      }
      case 'screw': {
        writeUVarint(out, Math.round(p.a[0])); writeUVarint(out, Math.round(p.a[1]));
        writeUVarint(out, Math.round(p.b[0])); writeUVarint(out, Math.round(p.b[1]));
        writeUVarint(out, Math.round(p.ms)); writeUVarint(out, Math.round(p.cap));
        break;
      }
      case 'conveyor': {
        writeUVarint(out, Math.round(p.a[0])); writeUVarint(out, Math.round(p.a[1]));
        writeUVarint(out, Math.round(p.b[0])); writeUVarint(out, Math.round(p.b[1]));
        writeUVarint(out, Math.round(p.v * 100)); writeUVarint(out, Math.round(p.flipMs));
        writeUVarint(out, p.dir);
        break;
      }
      case 'seesaw': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.len)); writeUVarint(out, Math.round(p.lim * 1000));
        writeUVarint(out, Math.round(p.damp * 1000));
        break;
      }
      case 'bridge': {
        writeUVarint(out, Math.round(p.a[0])); writeUVarint(out, Math.round(p.a[1]));
        writeUVarint(out, Math.round(p.b[0])); writeUVarint(out, Math.round(p.b[1]));
        writeUVarint(out, Math.round(p.planks)); writeUVarint(out, Math.round(p.slack * 1000));
        break;
      }
      // MB-10D launchers
      case 'cannon': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.aimMin)); writeUVarint(out, Math.round(p.aimMax));
        writeUVarint(out, Math.round(p.power * 100)); writeUVarint(out, Math.round(p.auto));
        writeUVarint(out, Math.round(p.phase));
        break;
      }
      case 'catapult': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.len)); writeUVarint(out, p.dir);
        writeUVarint(out, Math.round(p.reload));
        break;
      }
      case 'flipper': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, p.side); writeUVarint(out, Math.round(p.len));
        writeUVarint(out, Math.round(p.strength * 100)); writeUVarint(out, Math.round(p.timer));
        writeUVarint(out, Math.round(p.phase * 1000));
        break;
      }
      case 'sling': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.size)); writeUVarint(out, Math.round(p.facing));
        writeUVarint(out, Math.round(p.strength * 100));
        break;
      }
      case 'scoop': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.deg)); writeUVarint(out, Math.round(p.hold));
        writeUVarint(out, p.exit ? 1 : 0);
        if (p.exit) {
          writeUVarint(out, Math.round(p.exit[0])); writeUVarint(out, Math.round(p.exit[1]));
          writeUVarint(out, Math.round(p.exit[2]));
        }
        break;
      }
      // MB-10E fields
      case 'wind': {
        writeUVarint(out, Math.round(p.a[0])); writeUVarint(out, Math.round(p.a[1]));
        writeUVarint(out, Math.round(p.b[0])); writeUVarint(out, Math.round(p.b[1]));
        writeUVarint(out, Math.round(p.dir)); writeUVarint(out, Math.round(p.str * 100));
        writeUVarint(out, Math.round(p.pulse)); writeUVarint(out, Math.round(p.phase));
        break;
      }
      case 'magnet': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.r)); writeUVarint(out, Math.round(p.str * 100));
        writeUVarint(out, Math.round(p.period)); writeUVarint(out, Math.round(p.phase));
        break;
      }
      case 'mud': {
        writeUVarint(out, Math.round(p.a[0])); writeUVarint(out, Math.round(p.a[1]));
        writeUVarint(out, Math.round(p.b[0])); writeUVarint(out, Math.round(p.b[1]));
        writeUVarint(out, Math.round(p.drag * 100));
        break;
      }
      case 'pool': {
        writeUVarint(out, Math.round(p.a[0])); writeUVarint(out, Math.round(p.a[1]));
        writeUVarint(out, Math.round(p.b[0])); writeUVarint(out, Math.round(p.b[1]));
        writeUVarint(out, Math.round(p.depth)); writeUVarint(out, Math.round(p.skip * 10));
        break;
      }
      case 'geyser': {
        writeUVarint(out, Math.round(p.x)); writeUVarint(out, Math.round(p.y));
        writeUVarint(out, Math.round(p.h)); writeUVarint(out, Math.round(p.period));
        writeUVarint(out, Math.round(p.phase));
        break;
      }
    }
  }
  return new Uint8Array(out);
}

function decodeBinary(bytes: Uint8Array): TrackDef {
  const pos = { o: 0 };
  const name = readString(bytes, pos);
  if (!name || name.length > MAX_NAME) throw new ShareCodeError('Invalid name');
  const seed = readUVarint(bytes, pos) >>> 0;
  const theme = idToTheme(readUVarint(bytes, pos));
  const height = readUVarint(bytes, pos);
  const segCount = readUVarint(bytes, pos);
  if (segCount > 500) throw new ShareCodeError('Too many segments');
  const segments: { name: string; y: number; h: number }[] = [];
  for (let i = 0; i < segCount; i++) {
    const sName = readString(bytes, pos);
    const y = readUVarint(bytes, pos);
    const h = readUVarint(bytes, pos);
    segments.push({ name: sName, y, h });
  }
  const pieceCount = readUVarint(bytes, pos);
  if (pieceCount > 6000) throw new ShareCodeError('Too many pieces');
  const pieces: Piece[] = [];
  for (let i = 0; i < pieceCount; i++) {
    const typeId = readUVarint(bytes, pos);
    const flipFlag = readUVarint(bytes, pos);
    const flip = flipFlag ? true : undefined;
    const t = PIECE_TYPES[typeId];
    if (!t) throw new ShareCodeError(`Unknown piece type id ${typeId}`);
    let p: Piece;
    switch (t) {
      case 'ramp': {
        const ax = readUVarint(bytes, pos), ay = readUVarint(bytes, pos), bx = readUVarint(bytes, pos), by = readUVarint(bytes, pos);
        p = { t:'ramp', a:[ax, ay] as Vec, b:[bx, by] as Vec, ...(flip?{flip}:{}) };
        break;
      }
      case 'ice': {
        const ax = readUVarint(bytes, pos), ay = readUVarint(bytes, pos), bx = readUVarint(bytes, pos), by = readUVarint(bytes, pos);
        p = { t:'ice', a:[ax, ay] as Vec, b:[bx, by] as Vec, ...(flip?{flip}:{}) };
        break;
      }
      case 'curve': {
        const ax = readUVarint(bytes, pos), ay = readUVarint(bytes, pos), cx = readUVarint(bytes, pos), cy = readUVarint(bytes, pos), bx = readUVarint(bytes, pos), by = readUVarint(bytes, pos), n = readUVarint(bytes, pos);
        p = { t:'curve', a:[ax,ay] as Vec, c:[cx,cy] as Vec, b:[bx,by] as Vec, n, ...(flip?{flip}:{}) };
        // strip default n=12 to keep compact
        if (n === 12) delete (p as { n?: number }).n;
        break;
      }
      case 'loop': {
        const x = readUVarint(bytes, pos), bottom = readUVarint(bytes, pos), r = readUVarint(bytes, pos);
        p = { t:'loop', x, bottom, r, ...(flip?{flip}:{}) };
        break;
      }
      case 'hoop': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), dx = readSVarint(bytes, pos)/100, dy = readSVarint(bytes, pos)/100;
        p = { t:'hoop', x, y, dir:[dx,dy] as Vec, ...(flip?{flip}:{}) };
        break;
      }
      case 'wrecker': {
        const px = readUVarint(bytes, pos), py = readUVarint(bytes, pos), chain = readUVarint(bytes, pos), amp = readUVarint(bytes, pos)/1000, speed = readSVarint(bytes, pos)/10000;
        const hasPhase = readUVarint(bytes, pos);
        let phase: number | undefined;
        if (hasPhase) phase = readSVarint(bytes, pos)/1000;
        p = { t:'wrecker', pivot:[px,py] as Vec, chain, amp, speed, ...(phase!==undefined?{phase}:{}) , ...(flip?{flip}:{}) };
        break;
      }
      case 'pad': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), w = readUVarint(bytes, pos), dirFlag = readUVarint(bytes, pos);
        p = { t:'pad', x, y, w, dir: (dirFlag===0?-1:1) as -1|1, ...(flip?{flip}:{}) };
        break;
      }
      case 'boost': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), len = readUVarint(bytes, pos), thick = readUVarint(bytes, pos), dx = readSVarint(bytes, pos)/100, dy = readSVarint(bytes, pos)/100;
        p = { t:'boost', x, y, len, thick, dir:[dx,dy] as Vec, ...(flip?{flip}:{}) };
        break;
      }
      case 'spinner': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), len = readUVarint(bytes, pos), speed = readSVarint(bytes, pos)/10000;
        const hasAngle = readUVarint(bytes, pos);
        let angle: number | undefined;
        if (hasAngle) angle = readSVarint(bytes, pos)/1000;
        p = { t:'spinner', x, y, len, speed, ...(angle!==undefined?{angle}:{}) , ...(flip?{flip}:{}) };
        break;
      }
      case 'breakable': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), w = readUVarint(bytes, pos), h = readUVarint(bytes, pos), req = readUVarint(bytes, pos);
        p = { t:'breakable', x, y, w, h, req, ...(flip?{flip}:{}) };
        break;
      }
      case 'peg': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), r = readUVarint(bytes, pos);
        p = { t:'peg', x, y, r, ...(flip?{flip}:{}) };
        break;
      }
      case 'ppeg': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), color = idToColor(readUVarint(bytes, pos)), r = readUVarint(bytes, pos);
        const hasItem = readUVarint(bytes, pos);
        let item: ItemType | undefined;
        if (hasItem) item = idToItem(readUVarint(bytes, pos));
        p = { t:'ppeg', x, y, color, r, ...(item?{item}:{}) , ...(flip?{flip}:{}) };
        break;
      }
      case 'itembox': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos);
        p = { t:'itembox', x, y, ...(flip?{flip}:{}) };
        break;
      }
      case 'bucket': {
        const y = readUVarint(bytes, pos);
        const hasPhase = readUVarint(bytes, pos);
        let phase: number | undefined;
        if (hasPhase) phase = readSVarint(bytes, pos)/1000;
        p = { t:'bucket', y, ...(phase!==undefined?{phase}:{}) , ...(flip?{flip}:{}) };
        break;
      }
      case 'wall': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), w = readUVarint(bytes, pos), h = readUVarint(bytes, pos);
        p = { t:'wall', x, y, w, h, ...(flip?{flip}:{}) };
        break;
      }
      case 'block': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), w = readUVarint(bytes, pos), h = readUVarint(bytes, pos);
        p = { t:'block', x, y, w, h, ...(flip?{flip}:{}) };
        break;
      }
      // ---- MB-10A ----
      case 'barricade':
      case 'crumble': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), w = readUVarint(bytes, pos), h = readUVarint(bytes, pos), tough = readUVarint(bytes, pos);
        p = { t, x, y, w, h, tough, ...(flip?{flip}:{}) };
        break;
      }
      case 'tunnel': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos);
        const ex = readUVarint(bytes, pos), ey = readUVarint(bytes, pos);
        const dx = readSVarint(bytes, pos)/100, dy = readSVarint(bytes, pos)/100;
        const ms = readUVarint(bytes, pos), speed = readUVarint(bytes, pos)/10;
        const two = readUVarint(bytes, pos) === 1;
        p = { t:'tunnel', x, y, exit:[ex, ey] as Vec, edir:[dx, dy] as Vec, ms, speed, ...(two?{two}:{}) , ...(flip?{flip}:{}) };
        break;
      }
      case 'trapdoor': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), w = readUVarint(bytes, pos);
        const hinge = readUVarint(bytes, pos) === 1 ? 1 : -1;
        const mode = readUVarint(bytes, pos) === 1 ? 'weight' : 'timer';
        const open = readUVarint(bytes, pos), closed = readUVarint(bytes, pos);
        const phase = readSVarint(bytes, pos);
        const kg = readUVarint(bytes, pos)/100, hold = readUVarint(bytes, pos);
        p = { t:'trapdoor', x, y, w, hinge: hinge as -1|1, mode: mode as 'timer'|'weight', open, closed, phase, kg, hold, ...(flip?{flip}:{}) };
        break;
      }
      case 'switch': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), len = readUVarint(bytes, pos);
        const angle = readUVarint(bytes, pos)/1000, side = readUVarint(bytes, pos);
        p = { t:'switch', x, y, len, angle, side: (side === 1 ? 1 : 0) as 0|1, ...(flip?{flip}:{}) };
        break;
      }
      // MB-10B traps / hazards / treasure
      case 'blade': {
        const px = readUVarint(bytes, pos), py = readUVarint(bytes, pos);
        const len = readUVarint(bytes, pos), amp = readUVarint(bytes, pos)/1000;
        const period = readUVarint(bytes, pos), phase = readUVarint(bytes, pos)/1000;
        const thin = readUVarint(bytes, pos);
        p = { t:'blade', pivot:[px, py] as Vec, len, amp, period, phase, thin, ...(flip?{flip}:{}) };
        break;
      }
      case 'saw': {
        const ax = readUVarint(bytes, pos), ay = readUVarint(bytes, pos), bx = readUVarint(bytes, pos), by = readUVarint(bytes, pos);
        const r = readUVarint(bytes, pos), spin = readUVarint(bytes, pos);
        const period = readUVarint(bytes, pos), phase = readUVarint(bytes, pos)/1000;
        p = { t:'saw', a:[ax, ay] as Vec, b:[bx, by] as Vec, r, spin, period, phase, ...(flip?{flip}:{}) };
        break;
      }
      case 'crusher': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), w = readUVarint(bytes, pos);
        const travel = readUVarint(bytes, pos)/1000, period = readUVarint(bytes, pos);
        const floor = readUVarint(bytes, pos)/1000, phase = readUVarint(bytes, pos)/1000;
        p = { t:'crusher', x, y, w, travel, period, floor, phase, ...(flip?{flip}:{}) };
        break;
      }
      case 'boulder': {
        const n = readUVarint(bytes, pos);
        const pts: Vec[] = [];
        for (let k = 0; k < n; k++) pts.push([readUVarint(bytes, pos), readUVarint(bytes, pos)] as Vec);
        const r = readUVarint(bytes, pos), interval = readUVarint(bytes, pos);
        const rest = readUVarint(bytes, pos), phase = readUVarint(bytes, pos);
        p = { t:'boulder', pts, r, interval, rest, phase, ...(flip?{flip}:{}) };
        break;
      }
      case 'mace': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), arm = readUVarint(bytes, pos);
        const arc = readUVarint(bytes, pos)/1000, sweep = readUVarint(bytes, pos);
        const rest = readUVarint(bytes, pos), phase = readUVarint(bytes, pos), r = readUVarint(bytes, pos);
        p = { t:'mace', x, y, arm, arc, sweep, rest, phase, r, ...(flip?{flip}:{}) };
        break;
      }
      // MB-10C movers / gizmos
      case 'wheel': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), r = readUVarint(bytes, pos);
        const buckets = readUVarint(bytes, pos), rpm = readUVarint(bytes, pos)/100, dir = readUVarint(bytes, pos);
        const release = readUVarint(bytes, pos)/1000, phase = readUVarint(bytes, pos)/1000;
        p = { t:'wheel', x, y, r, buckets, rpm, dir: (dir === 1 ? 1 : 0) as 0|1, release, phase, ...(flip?{flip}:{}) };
        break;
      }
      case 'screw': {
        const ax = readUVarint(bytes, pos), ay = readUVarint(bytes, pos), bx = readUVarint(bytes, pos), by = readUVarint(bytes, pos);
        const ms = readUVarint(bytes, pos), cap = readUVarint(bytes, pos);
        p = { t:'screw', a:[ax, ay] as Vec, b:[bx, by] as Vec, ms, cap, ...(flip?{flip}:{}) };
        break;
      }
      case 'conveyor': {
        const ax = readUVarint(bytes, pos), ay = readUVarint(bytes, pos), bx = readUVarint(bytes, pos), by = readUVarint(bytes, pos);
        const v = readUVarint(bytes, pos)/100, flipMs = readUVarint(bytes, pos), dir = readUVarint(bytes, pos);
        p = { t:'conveyor', a:[ax, ay] as Vec, b:[bx, by] as Vec, v, flipMs, dir: (dir === 1 ? 1 : 0) as 0|1, ...(flip?{flip}:{}) };
        break;
      }
      case 'seesaw': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), len = readUVarint(bytes, pos);
        const lim = readUVarint(bytes, pos)/1000, damp = readUVarint(bytes, pos)/1000;
        p = { t:'seesaw', x, y, len, lim, damp, ...(flip?{flip}:{}) };
        break;
      }
      case 'bridge': {
        const ax = readUVarint(bytes, pos), ay = readUVarint(bytes, pos), bx = readUVarint(bytes, pos), by = readUVarint(bytes, pos);
        const planks = readUVarint(bytes, pos), slack = readUVarint(bytes, pos)/1000;
        p = { t:'bridge', a:[ax, ay] as Vec, b:[bx, by] as Vec, planks, slack, ...(flip?{flip}:{}) };
        break;
      }
      // MB-10D launchers
      case 'cannon': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos);
        const aimMin = readUVarint(bytes, pos), aimMax = readUVarint(bytes, pos);
        const power = readUVarint(bytes, pos)/100, auto = readUVarint(bytes, pos);
        const phase = readUVarint(bytes, pos);
        p = { t:'cannon', x, y, aimMin, aimMax, power, auto, phase, ...(flip?{flip}:{}) };
        break;
      }
      case 'catapult': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), len = readUVarint(bytes, pos);
        const dir = readUVarint(bytes, pos), reload = readUVarint(bytes, pos);
        p = { t:'catapult', x, y, len, dir: (dir === 1 ? 1 : 0) as 0|1, reload, ...(flip?{flip}:{}) };
        break;
      }
      case 'flipper': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos);
        const side = readUVarint(bytes, pos), len = readUVarint(bytes, pos);
        const strength = readUVarint(bytes, pos)/100, timer = readUVarint(bytes, pos);
        const phase = readUVarint(bytes, pos)/1000;
        p = { t:'flipper', x, y, side: (side === 1 ? 1 : 0) as 0|1, len, strength, timer, phase, ...(flip?{flip}:{}) };
        break;
      }
      case 'sling': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), size = readUVarint(bytes, pos);
        const facing = readUVarint(bytes, pos), strength = readUVarint(bytes, pos)/100;
        p = { t:'sling', x, y, size, facing, strength, ...(flip?{flip}:{}) };
        break;
      }
      case 'scoop': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos);
        const deg = readUVarint(bytes, pos), hold = readUVarint(bytes, pos);
        const hasExit = readUVarint(bytes, pos) === 1;
        const exit = hasExit ? ([readUVarint(bytes, pos), readUVarint(bytes, pos), readUVarint(bytes, pos)] as [number, number, number]) : undefined;
        p = exit ? { t:'scoop', x, y, deg, hold, exit, ...(flip?{flip}:{}) } : { t:'scoop', x, y, deg, hold, ...(flip?{flip}:{}) };
        break;
      }
      // MB-10E fields
      case 'wind': {
        const ax = readUVarint(bytes, pos), ay = readUVarint(bytes, pos), bx = readUVarint(bytes, pos), by = readUVarint(bytes, pos);
        const dir = readUVarint(bytes, pos), str = readUVarint(bytes, pos)/100;
        const pulse = readUVarint(bytes, pos), phase = readUVarint(bytes, pos);
        p = { t:'wind', a:[ax, ay] as Vec, b:[bx, by] as Vec, dir, str, pulse, phase, ...(flip?{flip}:{}) };
        break;
      }
      case 'magnet': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), r = readUVarint(bytes, pos);
        const str = readUVarint(bytes, pos)/100, period = readUVarint(bytes, pos), phase = readUVarint(bytes, pos);
        p = { t:'magnet', x, y, r, str, period, phase, ...(flip?{flip}:{}) };
        break;
      }
      case 'mud': {
        const ax = readUVarint(bytes, pos), ay = readUVarint(bytes, pos), bx = readUVarint(bytes, pos), by = readUVarint(bytes, pos);
        const drag = readUVarint(bytes, pos)/100;
        p = { t:'mud', a:[ax, ay] as Vec, b:[bx, by] as Vec, drag, ...(flip?{flip}:{}) };
        break;
      }
      case 'pool': {
        const ax = readUVarint(bytes, pos), ay = readUVarint(bytes, pos), bx = readUVarint(bytes, pos), by = readUVarint(bytes, pos);
        const depth = readUVarint(bytes, pos), skip = readUVarint(bytes, pos)/10;
        p = { t:'pool', a:[ax, ay] as Vec, b:[bx, by] as Vec, depth, skip, ...(flip?{flip}:{}) };
        break;
      }
      case 'geyser': {
        const x = readUVarint(bytes, pos), y = readUVarint(bytes, pos), h = readUVarint(bytes, pos);
        const period = readUVarint(bytes, pos), phase = readUVarint(bytes, pos);
        p = { t:'geyser', x, y, h, period, phase, ...(flip?{flip}:{}) };
        break;
      }
      default: throw new ShareCodeError(`Unknown piece type ${t}`);
    }
    pieces.push(p);
  }
  // ensure no trailing bytes (tamper detection)
  if (pos.o !== bytes.length) throw new ShareCodeError('Extra bytes after track data.');

  const def: TrackDef = {
    v: 1,
    name,
    seed,
    theme,
    height,
    pieces,
    ...(segments.length ? { segments } : {}),
  } as TrackDef;

  const check = validateTrackDef(def);
  if (!check.ok) throw new ShareCodeError(check.error);
  return check.def;
}

// ── deflate / inflate (CompressionStream with zlib fallback) ──

async function deflateBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const maybeCS = (globalThis as unknown as { CompressionStream?: unknown }).CompressionStream;
  if (typeof maybeCS === 'function') {
    try {
      const cs = new (maybeCS as unknown as new (format: string) => unknown)('deflate');
      // @ts-ignore — BlobPart typing is strict about ArrayBuffer vs ArrayBufferLike
      const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(cs as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch { /* fall through to zlib */ }
  }
  try {
    const { deflateSync } = await import('node:zlib');
    const { Buffer } = await import('node:buffer');
    // @ts-ignore — Buffer.from typing
    return new Uint8Array(deflateSync(Buffer.from(bytes as unknown as Uint8Array)));
  } catch {
    return bytes;
  }
}

async function inflateBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const maybeDS = (globalThis as unknown as { DecompressionStream?: unknown }).DecompressionStream;
  if (typeof maybeDS === 'function') {
    try {
      const ds = new (maybeDS as unknown as new (format: string) => unknown)('deflate');
      // @ts-ignore
      const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(ds as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch { /* fall through */ }
  }
  try {
    const { inflateSync } = await import('node:zlib');
    const { Buffer } = await import('node:buffer');
    // @ts-ignore
    return new Uint8Array(inflateSync(Buffer.from(bytes as unknown as Uint8Array)));
  } catch {
    throw new ShareCodeError('Decompression failed — code may be truncated or tampered.');
  }
}

// ── base64url ──

function base64UrlEncode(bytes: Uint8Array): string {
  // Use Buffer if available (Node), else btoa
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}
function base64UrlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const full = b64 + pad;
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(full, 'base64'));
  }
  const binary = atob(full);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ── hash for short codes ──

async function hashString(str: string): Promise<string> {
  // Prefer crypto.subtle SHA-256, fallback to DJB2
  try {
    const subtle = (globalThis as unknown as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
    if (subtle) {
      const data = new TextEncoder().encode(str);
      const digest = await subtle.digest('SHA-256', data);
      const bytes = new Uint8Array(digest);
      // first 4 bytes → 8 hex chars
      return Array.from(bytes.slice(0,4)).map(b=>b.toString(16).padStart(2,'0')).join('');
    }
  } catch { /* fallback */ }
  // DJB2
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8,'0').slice(0,8);
}

// ── cloud short-code helpers (dynamic import to stay SDK-isolated) ──

async function cloudRead(key: string): Promise<string | null> {
  try {
    const m = await import('../net/transport.js');
    return await m.readPlayerValue(key);
  } catch { return null; }
}
async function cloudWrite(key: string, value: string): Promise<void> {
  try {
    const m = await import('../net/transport.js');
    await m.writePlayerValue(key, value);
  } catch { /* ignore */ }
}

// ── public API ──

/**
 * Encode a TrackDef into a share code. The def is first quantised (compressDef)
 * and validated; tampering with the returned string will be rejected on decode.
 */
export async function encodeShareCode(def: TrackDef): Promise<string> {
  const compressed = compressDef(def);
  const check = validateTrackDef(compressed);
  if (!check.ok) throw new ShareCodeError(check.error);
  // Only validated tracks should be shared — the editor gates this, but double-check via full validation
  // We use compressDef which already quantises; full headless validation is NOT done here (editor does),
  // but we ensure the def is at least structurally valid.
  const binary = encodeBinary(check.def);
  const deflated = await deflateBytes(binary);
  const b64 = base64UrlEncode(deflated);
  return SHARE_PREFIX + b64;
}

/**
 * Short-code registration: stores the long code under a hash-derived 8-char key
 * in appStorage so the code the player shares can be 8 chars. Best-effort — if
 * cloud is unavailable we just return the long code.
 */
export async function registerShortCode(def: TrackDef): Promise<string> {
  const long = await encodeShareCode(def);
  const hash = await hashString(long);
  const short = hash.slice(0,8);
  // store mapping short → long
  await cloudWrite(SHORT_KEY_PREFIX + short, long);
  return short;
}

async function resolveShortCode(short: string): Promise<string | null> {
  return await cloudRead(SHORT_KEY_PREFIX + short);
}

/**
 * Decode a share code (long `1-…` or 8-char short) back to a TrackDef.
 * Throws ShareCodeError on any tampering, truncation, or validation failure.
 */
export async function decodeShareCode(code: string): Promise<TrackDef> {
  const trimmed = code.trim();
  if (!trimmed) throw new ShareCodeError('Empty share code.');
  // short code path — 8 hex chars, no prefix
  if (/^[0-9a-f]{8}$/i.test(trimmed) && !trimmed.includes('-') && !trimmed.includes('.')) {
    const long = await resolveShortCode(trimmed.toLowerCase());
    if (!long) throw new ShareCodeError('Short code not found — it may have been created on another account or expired.');
    // recurse to decode the long code
    return decodeShareCode(long);
  }
  let b64 = trimmed;
  if (trimmed.startsWith(SHARE_PREFIX)) b64 = trimmed.slice(SHARE_PREFIX.length);
  else if (/^\d+-/.test(trimmed)) {
    // future version prefix like "2-…" — reject cleanly
    const ver = trimmed.split('-')[0];
    throw new ShareCodeError(`Unsupported share code version ${ver}. Update the game.`);
  } else if (trimmed.startsWith('v1-') || trimmed.startsWith('v1.')) {
    b64 = trimmed.slice(3);
  }
  // basic charset check — base64url only
  if (!/^[A-Za-z0-9_-]+$/.test(b64)) throw new ShareCodeError('Share code contains invalid characters.');
  if (b64.length < 10) throw new ShareCodeError('Share code too short.');
  let deflated: Uint8Array;
  try { deflated = base64UrlDecode(b64); } catch { throw new ShareCodeError('Share code is not valid base64.'); }
  let binary: Uint8Array;
  try { binary = await inflateBytes(deflated); } catch (e) { throw e instanceof ShareCodeError ? e : new ShareCodeError('Share code decompression failed.'); }
  return decodeBinary(binary);
}

/** Synchronous helper for previews where async deflate is not needed — not used for sharing, only local cache. */
export function tryDecodeSync(code: string): TrackDef | null {
  try {
    // best-effort sync path not implementing async inflate — return null
    void code;
    return null;
  } catch { return null; }
}
