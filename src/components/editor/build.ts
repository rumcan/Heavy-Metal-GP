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
 * The building logic is a copy of `buildTrackFromDef` in
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
import type { Piece, TrackDef } from '../../game/trackdef';

function replayPiece(b: Builder, piece: Piece): void {
  b.flip = piece.flip === true;
  try {
    switch (piece.t) {
      case 'ramp':
        b.ramp(piece.a[0], piece.a[1], piece.b[0], piece.b[1]);
        break;
      case 'curve':
        b.curve(piece.a[0], piece.a[1], piece.c[0], piece.c[1], piece.b[0], piece.b[1], piece.n ?? 12);
        break;
      case 'ice':
        b.ice(piece.a[0], piece.a[1], piece.b[0], piece.b[1]);
        break;
      case 'loop':
        b.loop(piece.x, piece.bottom, piece.r);
        break;
      case 'hoop':
        b.hoop(piece.x, piece.y, piece.dir[0], piece.dir[1]);
        break;
      case 'wrecker':
        b.wrecker(piece.pivot[0], piece.pivot[1], piece.chain, piece.amp, piece.speed, piece.phase);
        break;
      case 'pad':
        b.pad(piece.x, piece.y, piece.w, piece.dir);
        break;
      case 'boost':
        b.boost(piece.x, piece.y, piece.len, piece.thick, piece.dir[0], piece.dir[1]);
        break;
      case 'spinner':
        b.spinner(piece.x, piece.y, piece.len, piece.speed, piece.angle);
        break;
      case 'breakable':
        b.breakable(piece.x, piece.y, piece.w, piece.h, piece.req);
        break;
      case 'peg':
        b.peg(piece.x, piece.y, piece.r);
        break;
      case 'ppeg':
        b.ppeg(piece.x, piece.y, piece.color, piece.r, piece.item);
        break;
      case 'itembox':
        b.itemBox(piece.x, piece.y);
        break;
      case 'bucket':
        b.bucket(piece.y, piece.phase ?? 0);
        break;
      case 'wall':
        b.wall(piece.x, piece.y, piece.w, piece.h);
        break;
      case 'block':
        b.block(piece.x, piece.y, piece.w, piece.h);
        break;
      // ---- MB-10A ----
      case 'barricade':
        b.barricade(piece.x, piece.y, piece.w, piece.h, piece.tough);
        break;
      case 'crumble':
        b.crumble(piece.x, piece.y, piece.w, piece.h, piece.tough);
        break;
      case 'tunnel':
        b.tunnel(piece.x, piece.y, piece.exit[0], piece.exit[1], piece.edir[0], piece.edir[1], piece.ms, piece.speed, piece.two === true);
        break;
      case 'trapdoor':
        b.trapdoor(piece.x, piece.y, piece.w, piece.hinge, piece.mode, piece.open, piece.closed, piece.phase, piece.kg, piece.hold);
        break;
      case 'switch':
        b.switchLever(piece.x, piece.y, piece.len, piece.angle, piece.side);
        break;
      // ---- MB-10B ----
      case 'blade':
        b.blade(piece.pivot[0], piece.pivot[1], piece.len, piece.amp, piece.period, piece.phase, piece.thin);
        break;
      case 'saw':
        b.saw(piece.a[0], piece.a[1], piece.r, [piece.b[0], piece.b[1]], piece.period, piece.spin, piece.phase);
        break;
      case 'crusher':
        b.crusher(piece.x, piece.y, piece.w, piece.travel, piece.period, piece.floor, piece.phase);
        break;
      case 'boulder':
        b.boulder(piece.pts.map(([x, y]) => [x, y] as [number, number]), piece.r, piece.interval, piece.rest, piece.phase);
        break;
      case 'mace':
        b.mace(piece.x, piece.y, piece.arm, piece.arc, piece.sweep, piece.rest, piece.phase, piece.r);
        break;
      // ---- MB-10C ----
      case 'wheel':
        b.waterWheel(piece.x, piece.y, piece.r, piece.buckets, piece.rpm, piece.dir, piece.release, piece.phase);
        break;
      case 'screw':
        b.screwLift(piece.a[0], piece.a[1], piece.b[0], piece.b[1], piece.ms, piece.cap);
        break;
      case 'conveyor':
        b.conveyor(piece.a[0], piece.a[1], piece.b[0], piece.b[1], piece.v, piece.flipMs || undefined, piece.dir);
        break;
      case 'seesaw':
        b.seesaw(piece.x, piece.y, piece.len, piece.lim, piece.damp);
        break;
      case 'bridge':
        b.ropeBridge(piece.a[0], piece.a[1], piece.b[0], piece.b[1], piece.planks, piece.slack);
        break;
    }
  } finally {
    b.flip = false;
  }
}

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
