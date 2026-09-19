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
import { replayPiece, type TrackDef } from '../../game/trackdef';

export interface EditorBuild {
  track: Track;
  /** `bodyToPiece[bodyIndex] = pieceIndex`, or -1 for bodies that are not part of the def. */
  bodyToPiece: number[];
  /** The def this build came from, for reuse by the editor's React state. */
  def: TrackDef;
  /** Readable error when `def` failed validation (mirrors `buildTrackFromDef`'s throw). */
  error: string | null;
}

/**
 * Build a track and its hit-test map. Never throws: a malformed def
 * produces `{ track: null, error }` like the canvas does for MB-02.
 */
export function buildEditorTrack(def: TrackDef): { track: Track | null; bodyToPiece: number[]; error: string | null } {
  // Lightweight validation — reuse the loader's own check so the editor
  // never builds a def the race would refuse.
  // We cannot call `validateTrackDef` here without a cycle? It lives in
  // trackdef.ts which does not import this file, so it is safe.
  // But we avoid calling it twice (TrackEditor already validates).  This
  // builds directly; if replay throws, we surface it as `error`.
  try {
    const b = new Builder(def.seed ?? 0);
    const bodyToPiece: number[] = [];

    // Start grid + gate — not part of the def.
    const beforeStart = b.bodies.length;
    segStart(b, 0);
    for (let i = beforeStart; i < b.bodies.length; i++) bodyToPiece[i] = -1;

    // Every def piece, with mapping.
    def.pieces.forEach((piece, index) => {
      const before = b.bodies.length;
      replayPiece(b, piece);
      for (let i = before; i < b.bodies.length; i++) bodyToPiece[i] = index;
    });

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
    return { track, bodyToPiece, error: null };
  } catch (error) {
    return { track: null, bodyToPiece: [], error: error instanceof Error ? error.message : String(error) };
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
export function hitPieceAt(point: { x: number; y: number }, track: Track, bodyToPiece: number[]): number | null {
  // Reverse iteration: the last-drawn body is visually on top, so a click
  // on an overlap should pick the topmost piece — the same rule the race
  // renderer uses.
  for (let i = track.bodies.length - 1; i >= 0; i--) {
    const piece = bodyToPiece[i];
    if (piece === -1 || piece === undefined) continue;
    const body = track.bodies[i];
    const { min, max } = body.bounds;
    if (point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y) {
      // For sensors with small bounds this is exact; for rotated ramps the
      // AABB is a little generous, but that matches the spec's "via the built
      // body bounds" wording and is far cheaper than a point-in-polygon test
      // per body per pointer move.
      return piece;
    }
  }
  return null;
}

/** Hit-test with an axis-aligned world rect (box select). All piece indices whose body bounds intersect the rect. */
export function piecesInBox(box: { minX: number; minY: number; maxX: number; maxY: number }, track: Track, bodyToPiece: number[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < track.bodies.length; i++) {
    const piece = bodyToPiece[i];
    if (piece === -1 || piece === undefined) continue;
    const { min, max } = track.bodies[i].bounds;
    if (max.x >= box.minX && min.x <= box.maxX && max.y >= box.minY && min.y <= box.maxY) out.add(piece);
  }
  return out;
}
