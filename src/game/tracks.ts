/**
 * MB-06. Persistence — My tracks, open draft, compression.
 *
 * Stores defs through src/game/storage.ts (device cache, preloaded at boot,
 * sync reads via storage.getItem) — never localStorage — plus an optional
 * cloud copy via the SDK appStorage (transport's readPlayerValue/writePlayerValue)
 * so tracks follow the account across devices.
 *
 * - "My tracks" list: id, def (compressed), createdAt, updatedAt
 * - Open draft: the current editor def, autosaved every 10s and on exit
 * - Compression: quantise every coordinate to integers (Math.round) before
 *   stringifying — cuts ~30% without changing physics (all positions are
 *   already snapped to 25u grid in the editor).
 * - Size budget: ~80 KB per track JSON; larger tracks are refused with a
 *   readable error (keeps device cache healthy).
 */
import * as storage from './storage';
import type { TrackDef, Piece, Vec } from './trackdef';
import { validateTrackDef, MAX_NAME } from './trackdef';

// Cloud helpers live in transport (the only SDK-touching module). We dynamic-import
// them so Node tests that stub window before importing still work — a static import
// would touch the RUN SDK at import time and crash without window.
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
  } catch { /* cloud unavailable */ }
}
async function cloudClear(key: string): Promise<void> {
  try {
    const m = await import('../net/transport.js');
    await m.clearPlayerValue(key);
  } catch { /* ignore */ }
}

export const TRACKS_KEY = 'heavy-metal-gp:tracks:v1';
export const DRAFT_KEY = 'heavy-metal-gp:open-draft:v1';

// Keep parity with storage.ts preload list — add here if you add keys there.
export const SIZE_BUDGET = 80 * 1024; // 80 KB JSON per track
export const MAX_TRACKS = 50;

/** A saved track in My tracks. */
export interface SavedTrack {
  id: string;
  def: TrackDef;
  createdAt: number;
  updatedAt: number;
}



function nowMs(): number { return Date.now(); }

function genId(): string {
  try {
    // crypto.randomUUID is available in browsers and modern Node; fallback to timestamp+random.
    // Never use Math.random() for physics — this is an ID, not randomness for gameplay.
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function roundVec(v: Vec): Vec { return [Math.round(v[0]), Math.round(v[1])]; }

function compressPiece(p: Piece): Piece {
  // Shallow clone then quantise — keep `flip` and other flags as-is.
  switch (p.t) {
    case 'ramp':
    case 'ice':
      return { ...p, a: roundVec(p.a), b: roundVec(p.b) };
    case 'curve':
      return { ...p, a: roundVec(p.a), c: roundVec(p.c), b: roundVec(p.b) };
    case 'loop':
      return { ...p, x: Math.round(p.x), bottom: Math.round(p.bottom), r: Math.round(p.r) };
    case 'hoop':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y), dir: [Math.round(p.dir[0] * 100) / 100, Math.round(p.dir[1] * 100) / 100] };
    case 'wrecker':
      return { ...p, pivot: roundVec(p.pivot), chain: Math.round(p.chain), amp: Math.round(p.amp * 1000) / 1000, speed: Math.round(p.speed * 10000) / 10000, phase: p.phase !== undefined ? Math.round(p.phase * 1000) / 1000 : undefined };
    case 'pad':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w) };
    case 'boost':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y), len: Math.round(p.len), thick: Math.round(p.thick), dir: [Math.round(p.dir[0] * 100) / 100, Math.round(p.dir[1] * 100) / 100] };
    case 'spinner':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y), len: Math.round(p.len), speed: Math.round(p.speed * 10000) / 10000, angle: p.angle !== undefined ? Math.round(p.angle * 1000) / 1000 : undefined };
    case 'breakable':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h) };
    case 'peg':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(p.r) };
    case 'ppeg':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(p.r) };
    case 'itembox':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y) };
    case 'bucket':
      return { ...p, y: Math.round(p.y), phase: p.phase !== undefined ? Math.round(p.phase * 1000) / 1000 : undefined };
    case 'wall':
    case 'block':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h) };
    // ---- MB-10A ----
    case 'barricade':
    case 'crumble':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h), tough: Math.round(p.tough) };
    case 'tunnel':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y), exit: roundVec(p.exit), edir: [Math.round(p.edir[0] * 100) / 100, Math.round(p.edir[1] * 100) / 100], ms: Math.round(p.ms) };
    case 'trapdoor':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), open: Math.round(p.open), closed: Math.round(p.closed), phase: Math.round(p.phase), hold: Math.round(p.hold) };
    case 'switch':
      return { ...p, x: Math.round(p.x), y: Math.round(p.y), len: Math.round(p.len), angle: Math.round(p.angle * 1000) / 1000 };
    default:
      return p;
  }
}

/**
 * Quantise coordinates to integers before storing. Also strips `undefined`
 * flip fields via JSON round-trip (validateTrackDef's compact does same).
 * Returns a new def — caller’s object is untouched.
 */
export function compressDef(def: TrackDef): TrackDef {
  const next: TrackDef = {
    ...def,
    name: def.name.slice(0, MAX_NAME),
    height: Math.round(def.height),
    seed: def.seed !== undefined ? Math.floor(def.seed) : undefined,
    segments: def.segments?.map((s) => ({ name: s.name, y: Math.round(s.y), h: Math.round(s.h) })),
    pieces: def.pieces.map(compressPiece),
  };
  // Drop undefined optional fields so stored JSON is minimal and round-trips clean.
  return JSON.parse(JSON.stringify(next)) as TrackDef;
}

/** JSON size of a (compressed) def. */
export function defSize(def: TrackDef): number {
  return JSON.stringify(compressDef(def)).length;
}

/** Parse and validate a stored tracks array. */
function parseTracks(raw: string | null): SavedTrack[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: SavedTrack[] = [];
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      const id = typeof rec.id === 'string' ? rec.id : null;
      const createdAt = typeof rec.createdAt === 'number' ? rec.createdAt : nowMs();
      const updatedAt = typeof rec.updatedAt === 'number' ? rec.updatedAt : createdAt;
      const defRaw = rec.def as unknown;
      const check = validateTrackDef(defRaw);
      if (!check.ok || !id) continue;
      out.push({ id, def: check.def, createdAt, updatedAt });
    }
    return out;
  } catch {
    return [];
  }
}

function parseDraft(raw: string | null): TrackDef | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const check = validateTrackDef(parsed);
    return check.ok ? check.def : null;
  } catch {
    return null;
  }
}

// ── synchronous device-cache API (used by editor mount — must not await) ──

export function loadTracksSync(): SavedTrack[] {
  return parseTracks(storage.getItem(TRACKS_KEY));
}

export function loadDraftSync(): TrackDef | null {
  return parseDraft(storage.getItem(DRAFT_KEY));
}

// ── async cloud-aware loader (call once on boot to hydrate from appStorage) ──

export async function loadTracks(): Promise<SavedTrack[]> {
  const local = loadTracksSync();
  if (local.length) return local;
  const cloud = await cloudRead(TRACKS_KEY);
  if (cloud) {
    const parsed = parseTracks(cloud);
    if (parsed.length) {
      try { storage.setItem(TRACKS_KEY, cloud); } catch { /* ignore */ }
      return parsed;
    }
  }
  return local;
}

export async function loadDraft(): Promise<TrackDef | null> {
  const local = loadDraftSync();
  if (local) return local;
  const cloud = await cloudRead(DRAFT_KEY);
  if (cloud) {
    const parsed = parseDraft(cloud);
    if (parsed) {
      try { storage.setItem(DRAFT_KEY, cloud); } catch { /* ignore */ }
      return parsed;
    }
  }
  return null;
}

// ── writers (device + cloud, best-effort) ──

function persistTracks(wire: string): void {
  storage.setItem(TRACKS_KEY, wire);
  void cloudWrite(TRACKS_KEY, wire);
}

function persistDraft(wire: string): void {
  storage.setItem(DRAFT_KEY, wire);
  void cloudWrite(DRAFT_KEY, wire);
}

export function saveTracks(tracks: SavedTrack[]): void {
  const wire = JSON.stringify(tracks.map((t) => ({ ...t, def: compressDef(t.def) })));
  // per-track budget check is done by saveTrack; total budget is implicit via MAX_TRACKS
  persistTracks(wire);
}

export function saveDraft(def: TrackDef): void {
  const compressed = compressDef(def);
  const wire = JSON.stringify(compressed);
  if (wire.length > SIZE_BUDGET * 2) {
    // Drafts are allowed to be larger than a single track (unsaved work), but warn.
    // We still persist — the acceptance is that the draft restores.
  }
  persistDraft(wire);
}

export function clearDraft(): void {
  storage.removeItem(DRAFT_KEY);
  void cloudClear(DRAFT_KEY);
}

// ── high-level My tracks ops ──

export function createTrack(def: TrackDef): SavedTrack | { error: string } {
  const compressed = compressDef(def);
  const wire = JSON.stringify(compressed);
  if (wire.length > SIZE_BUDGET) {
    return { error: `Track too large (${(wire.length / 1024).toFixed(1)} KB > ${SIZE_BUDGET / 1024} KB). Remove pieces or shorten the circuit.` };
  }
  const tracks = loadTracksSync();
  if (tracks.length >= MAX_TRACKS) {
    return { error: `Too many saved tracks (${MAX_TRACKS}). Delete one first.` };
  }
  const entry: SavedTrack = { id: genId(), def: compressed, createdAt: nowMs(), updatedAt: nowMs() };
  const next = [...tracks, entry];
  saveTracks(next);
  return entry;
}

export function updateTrack(id: string, def: TrackDef): SavedTrack | { error: string } {
  const compressed = compressDef(def);
  const wire = JSON.stringify(compressed);
  if (wire.length > SIZE_BUDGET) {
    return { error: `Track too large (${(wire.length / 1024).toFixed(1)} KB > ${SIZE_BUDGET / 1024} KB).` };
  }
  const tracks = loadTracksSync();
  const idx = tracks.findIndex((t) => t.id === id);
  if (idx === -1) return { error: 'Track not found.' };
  const next: SavedTrack = { ...tracks[idx], def: compressed, updatedAt: nowMs() };
  const out = [...tracks];
  out[idx] = next;
  saveTracks(out);
  return next;
}

export function deleteTrack(id: string): boolean {
  const tracks = loadTracksSync();
  const next = tracks.filter((t) => t.id !== id);
  if (next.length === tracks.length) return false;
  saveTracks(next);
  return true;
}

export function duplicateTrack(id: string): SavedTrack | { error: string } {
  const tracks = loadTracksSync();
  const src = tracks.find((t) => t.id === id);
  if (!src) return { error: 'Track not found.' };
  if (tracks.length >= MAX_TRACKS) return { error: `Too many saved tracks (${MAX_TRACKS}).` };
  const baseName = src.def.name;
  const copyName = `${baseName} Copy`.slice(0, MAX_NAME);
  const def = { ...compressDef(src.def), name: copyName } as TrackDef;
  const entry: SavedTrack = { id: genId(), def, createdAt: nowMs(), updatedAt: nowMs() };
  saveTracks([...tracks, entry]);
  return entry;
}

export function renameTrack(id: string, name: string): SavedTrack | { error: string } {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!trimmed) return { error: 'Name cannot be empty.' };
  const tracks = loadTracksSync();
  const idx = tracks.findIndex((t) => t.id === id);
  if (idx === -1) return { error: 'Track not found.' };
  const nextDef = { ...tracks[idx].def, name: trimmed } as TrackDef;
  return updateTrack(id, nextDef);
}
