/**
 * MB-03. Sensible defaults for every piece type.
 *
 * Clicking a palette tile arms it; the next click on the canvas places a
 * single piece at the cursor.  The defaults below are the sizes the
 * procedural generator actually uses (ramp 300 long at 12°, loop r=95, …)
 * so a hand-placed piece behaves like the one the generator would have put
 * there.  Callers snap the returned coordinates to the 25-unit lattice when
 * the grid toggle is on.
 */
import type { Piece } from '../../game/trackdef';
import type { PieceType } from './palette';
import type { Point } from './camera';
import { W } from '../../game/track';

const SNAP = 25;
const snapVal = (v: number) => Math.round(v / SNAP) * SNAP;

function snapPoint(p: Point): Point {
  return { x: snapVal(p.x), y: snapVal(p.y) };
}

/** Create a fresh piece of `type` at `at` (world units). */
export function defaultPiece(type: PieceType, at: Point, snap = false): Piece {
  const p = snap ? snapPoint(at) : at;
  // Clamp x inside the pipe; y is unbounded (the track grows downward).
  const cx = Math.max(0, Math.min(W, p.x));
  const cy = p.y;

  switch (type) {
    case 'ramp': {
      const len = 300;
      const ang = (12 * Math.PI) / 180;
      const dx = Math.cos(ang) * len;
      const dy = Math.sin(ang) * len;
      const ax = snap ? snapVal(cx - dx / 2) : cx - dx / 2;
      const ay = snap ? snapVal(cy - dy / 2) : cy - dy / 2;
      const bx = snap ? snapVal(cx + dx / 2) : cx + dx / 2;
      const by = snap ? snapVal(cy + dy / 2) : cy + dy / 2;
      return { t: 'ramp', a: [ax, ay], b: [bx, by] };
    }
    case 'ice': {
      const len = 300;
      const ang = (12 * Math.PI) / 180;
      const dx = Math.cos(ang) * len;
      const dy = Math.sin(ang) * len;
      const ax = snap ? snapVal(cx - dx / 2) : cx - dx / 2;
      const ay = snap ? snapVal(cy - dy / 2) : cy - dy / 2;
      const bx = snap ? snapVal(cx + dx / 2) : cx + dx / 2;
      const by = snap ? snapVal(cy + dy / 2) : cy + dy / 2;
      return { t: 'ice', a: [ax, ay], b: [bx, by] };
    }
    case 'curve': {
      // Quadratic bezier with endpoints either side of the click and a
      // control point offset downward for a visible bend.
      const a: [number, number] = [snap ? snapVal(cx - 140) : cx - 140, snap ? snapVal(cy - 60) : cy - 60];
      const b: [number, number] = [snap ? snapVal(cx + 140) : cx + 140, snap ? snapVal(cy + 80) : cy + 80];
      const c: [number, number] = [snap ? snapVal(cx) : cx, snap ? snapVal(cy + 40) : cy + 40];
      return { t: 'curve', a, c, b, n: 12 };
    }
    case 'loop': {
      const r = 95;
      // Loop's bottom sits at the cursor so the marble drops directly onto it.
      return { t: 'loop', x: snap ? snapVal(cx) : cx, bottom: snap ? snapVal(cy) : cy, r };
    }
    case 'hoop': {
      return { t: 'hoop', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, dir: [0, 1] as [number, number] };
    }
    case 'wrecker': {
      return {
        t: 'wrecker',
        pivot: [snap ? snapVal(cx) : cx, snap ? snapVal(cy) : cy],
        chain: 95,
        amp: 0.5,
        speed: 0.002,
        phase: 0,
      };
    }
    case 'pad': {
      return { t: 'pad', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, w: 100, dir: 1 };
    }
    case 'boost': {
      return {
        t: 'boost',
        x: snap ? snapVal(cx) : cx,
        y: snap ? snapVal(cy) : cy,
        len: 120,
        thick: 40,
        dir: [0, 1] as [number, number],
      };
    }
    case 'spinner': {
      return { t: 'spinner', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, len: 190, speed: 0.03 };
    }
    case 'breakable': {
      return { t: 'breakable', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, w: 30, h: 92, req: 5 };
    }
    case 'peg': {
      return { t: 'peg', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, r: 11 };
    }
    case 'ppeg': {
      return { t: 'ppeg', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, color: 'blue', r: 10 };
    }
    case 'itembox': {
      return { t: 'itembox', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy };
    }
    case 'bucket': {
      // Bucket only cares about y; x is always centre. Keep y snapped.
      return { t: 'bucket', y: snap ? snapVal(cy) : cy, phase: 0 };
    }
    case 'wall': {
      return { t: 'wall', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, w: 120, h: 24 };
    }
    case 'block': {
      return { t: 'block', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, w: 60, h: 32 };
    }
    default:
      // Exhaustiveness: TypeScript ensures all PieceType are covered.
      throw new Error(`defaultPiece: unknown piece type ${(type as string)}`);
  }
}
