/**
 * MB-03. Building the editor's circuit and the bodyIndex → pieceIndex map.
 *
 * Hit-testing is via the physics bodies' own AABBs: the editor builds a
 * `Track` from the def, keeps `bodyToPiece[bodyIndex] = pieceIndex` (or -1
 * for the start gate, finish stub and outer walls — none of which are in
 * the def) and then selects a piece by finding which body the pointer is
 * over and reading back its piece index.  That is exactly what the spec
 * asks for: "keep a `bodyIndex → pieceIndex` map when building".
 *
 * Piece replay is shared with `buildTrackFromDef` in
 * `src/game/trackdef.ts` (MB-01) with the mapping hook added.  It stays in
 * the editor (not in `trackdef.ts`) because the race never needs the map and
 * the def loader's contract is unchanged.  Any change to the start/finish
 * geometry in `track.ts` must be mirrored here, so this file imports the
 * same helpers (`segStart`, `segFinish`, `Builder`) rather than duplicating
 * numbers.
 */
import { Builder, FINISH_H, W, meta, segFinish, segStart } from '../../game/track';
import type { Track } from '../../game/track';
import { themeFor } from '../../game/types';
import { isRetiredPieceType, replayPiece, type Piece, type TrackDef } from '../../game/trackdef';
import type Matter from 'matter-js';
import { visualBoundsForPiece, type Bounds } from './bounds';

export interface EditorBuild {
  track: Track;
  /** `bodyToPiece[bodyIndex] = pieceIndex`, or -1 for bodies that are not part of the def. */
  bodyToPiece: number[];
  /** Bounding boxes for each piece in the def, calculated from visualBoundsForPiece. */
  pieceBounds: Bounds[];
  /** The def this build came from, for reuse by the editor's React state. */
  def: TrackDef;
  /** Readable error when `def` failed validation (mirrors `buildTrackFromDef`'s throw). */
  error: string | null;
}

/**
 * Build a track and its hit-test map. Never throws: a malformed def
 * produces `{ track: null, error }` like the canvas does for MB-02.
 */
interface BuiltPiece {
  bodies: Matter.Body[]; spinners: Matter.Body[]; turnstiles: Matter.Body[]; itemBoxes: Matter.Body[];
  buckets: Matter.Body[]; decor: Builder['decor']; wreckers: Matter.Body[]; targetBanks: Builder['targetBanks'];
  pegs: { orange: number; total: number }; bounds: Bounds;
}
const EMPTY_PIECE: BuiltPiece = { bodies: [], spinners: [], turnstiles: [], itemBoxes: [], buckets: [], decor: [], wreckers: [], targetBanks: [], pegs: { orange: 0, total: 0 }, bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } } };

/** Pieces built for the previous editor build, keyed by their JSON. Only what the latest build used is kept. */
let pieceCache = new Map<string, BuiltPiece>();

function builtPiece(piece: Piece, seed: number, nextCache: Map<string, BuiltPiece>): BuiltPiece {
  const key = JSON.stringify(piece);
  // A piece listed twice with identical data would otherwise share bodies: the second copy builds its own.
  const hit = pieceCache.get(key);
  if (hit && !nextCache.has(key)) { nextCache.set(key, hit); return hit; }
  const mini = new Builder(seed);
  replayPiece(mini, piece);
  const built: BuiltPiece = {
    bodies: mini.bodies, spinners: mini.spinners, turnstiles: mini.turnstiles, itemBoxes: mini.itemBoxes,
    buckets: mini.buckets, decor: mini.decor, wreckers: mini.wreckers, targetBanks: mini.targetBanks,
    pegs: { ...mini.pegCount },
    bounds: transformedBounds(visualBoundsForPiece(piece, mini.bodies), mini.bodies[0]),
  };
  if (!nextCache.has(key)) nextCache.set(key, built);
  return built;
}

export function buildEditorTrack(def: TrackDef): { track: Track | null; bodyToPiece: number[]; pieceBounds: Bounds[]; error: string | null } {
  // Lightweight validation — reuse the loader's own check so the editor
  // never builds a def the race would refuse.
  // We cannot call `validateTrackDef` here without a cycle? It lives in
  // trackdef.ts which does not import this file, so it is safe.
  // But we avoid calling it twice (TrackEditor already validates).  This
  // builds directly; if replay throws, we surface it as `error`.
  try {
    const b = new Builder(def.seed ?? 0);
    const bodyToPiece: number[] = [];
    const pieceBounds: Bounds[] = [];

    // Start grid + gate — not part of the def.
    const beforeStart = b.bodies.length;
    segStart(b, 0);
    for (let i = beforeStart; i < b.bodies.length; i++) bodyToPiece[i] = -1;

    // Every def piece, with mapping. #99: retired types are skipped (same silent drop the
    // loader performs) so legacy workshop drafts and shared tracks still open.
    // Each piece is built once and reused while it is unchanged: an edit (every pointer move of a drag) only
    // rebuilds the pieces it touched, instead of all of them — a big map was rebuilding ~1,400 bodies per move.
    const nextCache = new Map<string, BuiltPiece>();
    def.pieces.forEach((piece, index) => {
      const before = b.bodies.length;
      const built = isRetiredPieceType(piece.t) ? EMPTY_PIECE : builtPiece(piece, def.seed ?? 0, nextCache);
      b.bodies.push(...built.bodies);
      b.spinners.push(...built.spinners);
      b.turnstiles.push(...built.turnstiles);
      b.itemBoxes.push(...built.itemBoxes);
      b.buckets.push(...built.buckets);
      b.decor.push(...built.decor);
      b.wreckers.push(...built.wreckers);
      b.targetBanks.push(...built.targetBanks);
      b.pegCount.orange += built.pegs.orange;
      b.pegCount.total += built.pegs.total;
      for (let i = before; i < b.bodies.length; i++) bodyToPiece[i] = index;
      pieceBounds[index] = built.bounds;
    });
    pieceCache = nextCache;

    // Finish stub — not part of the def.
    const finishTop = def.height - FINISH_H;
    const beforeFinish = b.bodies.length;
    segFinish(b, finishTop);
    for (let i = beforeFinish; i < b.bodies.length; i++) bodyToPiece[i] = -1;

    // Outer walls — not part of the def.
    b.flip = false;
    const beforeWalls = b.bodies.length;
    b.wall(-20, def.height / 2, 40, def.height + 400);
    b.wall(W + 20, def.height / 2, 40, def.height + 400);
    b.wall(W / 2, -30, W, 20);
    for (let i = beforeWalls; i < b.bodies.length; i++) bodyToPiece[i] = -1;

    // Fill any holes (should not happen, but keeps the array dense).
    for (let i = 0; i < b.bodies.length; i++) if (bodyToPiece[i] === undefined) bodyToPiece[i] = -1;

    const gate = b.bodies.find((body) => meta(body).kind === 'gate')!;
    const hStart = 440; // START_H — kept literal to avoid importing non-exported constant; matches track.ts
    const segments = def.segments?.length
      ? def.segments.map((s) => ({ ...s }))
      : [
          { name: 'Start', y: 0, h: hStart },
          { name: 'Custom', y: hStart, h: Math.max(1, finishTop - hStart) },
          { name: 'Finish', y: finishTop, h: FINISH_H },
        ];

    const track: Track = {
      seed: def.seed ?? 0,
      bodies: b.bodies,
      height: def.height,
      segments,
      spinners: b.spinners,
      turnstiles: b.turnstiles,
      itemBoxes: b.itemBoxes,
      ramps: b.bodies.filter((body) => !!meta(body).surface),
      buckets: b.buckets,
      pegCount: b.pegCount,
      gate,
      startY: 116, // GATE_TOP - 14
      finishY: finishTop + 40,
      theme: themeFor(def.theme),
      decor: b.decor,
      wreckers: b.wreckers,
    targetBanks: b.targetBanks,
    };
    return { track, bodyToPiece, pieceBounds, error: null };
  } catch (error) {
    return { track: null, bodyToPiece: [], pieceBounds: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Legacy shim for callers that already have a built `Track` and want the map from a def alone. */
export function bodyToPieceForDef(def: TrackDef): number[] {
  return buildEditorTrack(def).bodyToPiece;
}

/**
 * Hit-test: which piece is under `point` (world units), via body bounds.
 * Returns the piece index or null when the point is on empty space or on
 * a non-def body (the gate, a start wall, the finish).
 */
export function hitPieceAt(point: { x: number; y: number }, track: Track, bodyToPiece: number[], pieceBounds: Bounds[], locked?: ReadonlySet<number>): number | null {
  // Reverse iteration: the last-drawn body is visually on top, so a click
  // on an overlap should pick the topmost piece — the same rule the race
  // renderer uses.
  const checked = new Set<number>();
  for (let i = track.bodies.length - 1; i >= 0; i--) {
    const piece = bodyToPiece[i];
    if (piece === -1 || piece === undefined) continue;
    if (locked?.has(piece)) continue; // #99: a locked item is unselectable by click
    if (checked.has(piece)) continue;
    checked.add(piece);
    // Visual bounds (rendered world coordinates) — fall back to this body's
    // own AABB if the entry is missing, never to the un-mirrored piece numbers.
    const bounds = pieceBounds[piece] ?? track.bodies[i].bounds;
    const { min, max } = bounds;
    if (point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y) {
      return piece;
    }
  }
  return null;
}

/** Hit-test with an axis-aligned world rect (box select). All piece indices whose body bounds intersect the rect. */
export function piecesInBox(box: { minX: number; minY: number; maxX: number; maxY: number }, _track: Track, _bodyToPiece: number[], pieceBounds: Bounds[], locked?: ReadonlySet<number>): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < pieceBounds.length; i++) {
    if (!pieceBounds[i]) continue;
    if (locked?.has(i)) continue; // #99: a locked item is unselectable by box/multi-select
    const { min, max } = pieceBounds[i];
    if (max.x >= box.minX && min.x <= box.maxX && max.y >= box.minY && min.y <= box.maxY) out.add(i);
  }
  return out;
}

/** The selection box of a piece carrying a Workshop rotation/size: the AABB of its box turned and scaled. */
function transformedBounds(box: Bounds, body: import('matter-js').Body | undefined): Bounds {
  const xf = body ? meta(body).xf : undefined;
  if (!xf) return box;
  const cos = Math.cos(xf.rot), sin = Math.sin(xf.rot);
  const pts = [[box.min.x, box.min.y], [box.max.x, box.min.y], [box.min.x, box.max.y], [box.max.x, box.max.y]].map(([x, y]) => {
    const dx = (x - xf.cx) * xf.sc, dy = (y - xf.cy) * xf.sc;
    return { x: xf.cx + dx * cos - dy * sin, y: xf.cy + dx * sin + dy * cos };
  });
  return {
    min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
    max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
  };
}
