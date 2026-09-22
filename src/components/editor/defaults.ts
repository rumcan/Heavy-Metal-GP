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
import { fitGroupTranslation, translatePiece } from './translation';

const SNAP = 25;
const snapVal = (v: number) => Math.round(v / SNAP) * SNAP;

function snapPoint(p: Point): Point {
  return { x: snapVal(p.x), y: snapVal(p.y) };
}

/**
 * Create a fresh piece of `type` at `at` (world units).
 *
 * The click is a *centre*, not a promise: a ramp near the left wall would otherwise start at x=-125
 * and a ramp near the right wall would end at x=1025, both of which `validateTrackDef` rejects — a
 * legal click could produce an unshareable map (#71). So the generated geometry is measured and, if
 * any of it hangs outside 0..W, slid sideways by one shared delta: lengths and the offsets between
 * points survive, and the piece lands as close to the cursor as it can. Anchor-led pieces (tunnel,
 * trapdoor, boulder) turn inwards first so the clicked point stays put; the slide is the fallback
 * for everything that still overflows.
 */
export function defaultPiece(type: PieceType, at: Point, snap = false): Piece {
  const piece = buildDefault(type, at, snap);
  const dx = fitGroupTranslation([piece], 0) ?? 0;
  return dx === 0 ? piece : translatePiece(piece, dx, 0);
}

/** The piece the click describes, before it is fitted into the track. */
function buildDefault(type: PieceType, at: Point, snap = false): Piece {
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
      // The ring bottom anchors the complete route assembled by placementPieces.
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
    // ---- MB-10A: shortcuts and secrets ----
    case 'barricade': {
      return { t: 'barricade', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, w: 120, h: 44, tough: 4 };
    }
    case 'crumble': {
      return { t: 'crumble', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, w: 56, h: 120, tough: 6 };
    }
    case 'tunnel': {
      // Entrance at the click; exit 200 units below, shooting down and towards the middle of the
      // track.  Near the right wall the ride turns left instead of punching through it (#71).
      const ix = snap ? snapVal(cx) : cx;
      const iy = snap ? snapVal(cy) : cy;
      const inward: 1 | -1 = ix + 80 > W ? -1 : 1;
      const ex = snap ? snapVal(ix + 80 * inward) : ix + 80 * inward;
      return { t: 'tunnel', x: ix, y: iy, exit: [ex, iy + 200] as [number, number], edir: [0.3 * inward, 0.95] as [number, number], ms: 900, speed: 7 };
    }
    case 'trapdoor': {
      const w = 110;
      const hx = snap ? snapVal(cx) : cx;
      // The leaf hangs off the far side of the hinge, so the hinge goes where the leaf still fits:
      // left of the click, or right of it when the click hugs the right wall (#71).
      const hinge: -1 | 1 = hx + w <= W ? -1 : 1;
      const center_x = hx - hinge * w / 2;
      return { t: 'trapdoor', x: center_x, y: snap ? snapVal(cy) : cy, w, hinge, mode: 'timer' as 'timer' | 'weight', open: 1400, closed: 2800, phase: 0, kg: 2.4, hold: 300 };
    }
    // ---- MB-10B: blades and crushers ----
    case 'blade': {
      return { t: 'blade', pivot: [snap ? snapVal(cx) : cx, snap ? snapVal(cy) : cy] as [number, number], len: 160, amp: 0.9, period: 2600, phase: 0, thin: 8 };
    }
    case 'saw': {
      // Set into the track at the click; drag a slot end to make it slide.
      const x = snap ? snapVal(cx) : cx;
      const y = snap ? snapVal(cy) : cy;
      return { t: 'saw', a: [x, y] as [number, number], b: [x, y - 100] as [number, number], r: 26, spin: 0.55, period: 3600, phase: 0 };
    }
    case 'crusher': {
      return { t: 'crusher', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, w: 130, travel: 110, period: 4200, floor: 700, phase: 0 };
    }
    case 'boulder': {
      const x = snap ? snapVal(cx) : cx;
      const y = snap ? snapVal(cy) : cy;
      // The run heads for the middle of the track and keeps its full 340 units.  Running short near
      // a wall used to shorten the route; running long made the map invalid (#71).
      const inward: 1 | -1 = x + 340 > W ? -1 : 1;
      return {
        t: 'boulder',
        pts: [
          [x, y] as [number, number],
          [x + 340 * inward, y + 240] as [number, number],
        ],
        r: 27, speed: 5, delay: 0,
      };
    }
    case 'mace': {
      return { t: 'mace', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, arm: 130, arc: 1.05, sweep: 950, rest: 750, phase: 0, r: 24 };
    }
    // ---- MB-10C: movers ----
    case 'wheel': {
      const x = snap ? snapVal(cx) : cx;
      const y = snap ? snapVal(cy) : cy;
      return { t: 'wheel', x, y, r: 110, buckets: 6, rpm: 3, dir: 0 as const, release: 105, phase: 0 };
    }
    case 'screw': {
      const x = snap ? snapVal(cx) : cx;
      const y = snap ? snapVal(cy) : cy;
      // Full 120-unit rise: a click near the wall slides the tube in (see defaultPiece) instead of
      // shortening it, which is what an independent clamp on the far end used to do (#71).
      return { t: 'screw', a: [x, y] as [number, number], b: [x + 120, y - 190] as [number, number], ms: 3200, cap: 2 };
    }
    case 'conveyor': {
      const x = snap ? snapVal(cx) : cx;
      const y = snap ? snapVal(cy) : cy;
      return { t: 'conveyor', a: [x - 140, y] as [number, number], b: [x + 140, y + 60] as [number, number], v: 0.16, flipMs: 0, dir: 0 as const };
    }
    case 'seesaw': {
      return { t: 'seesaw', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, len: 300, lim: 22, damp: 0.9 };
    }
    case 'bridge': {
      const x = snap ? snapVal(cx) : cx;
      const y = snap ? snapVal(cy) : cy;
      return { t: 'bridge', a: [x - 180, y] as [number, number], b: [x + 180, y] as [number, number], planks: 8, slack: 34 };
    }
    // ---- MB-10D ----
    case 'cannon': {
      return { t: 'cannon', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, aimMin: 288, aimMax: 314, power: 12, auto: 1600, phase: 0 };
    }
    case 'catapult': {
      return { t: 'catapult', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, len: 230, reload: 1400, dir: 0 };
    }
    case 'flipper': {
      return { t: 'flipper', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, side: 0, angle: 0, len: 120, strength: 1.4, timer: 0, phase: 0 };
    }
    case 'sling': {
      return { t: 'sling', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, size: 90, facing: 245, strength: 4 };
    }
    case 'wind': {
      return { t: 'wind', a: [snap ? snapVal(cx - 110) : cx - 110, snap ? snapVal(cy - 260) : cy - 260], b: [snap ? snapVal(cx + 110) : cx + 110, snap ? snapVal(cy) : cy], dir: 270, str: 0.34, pulse: 2600, phase: 0 };
    }
    case 'magnet': {
      return { t: 'magnet', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, r: 170, str: 5, period: 4600, phase: 0 };
    }
    case 'mud': {
      return { t: 'mud', a: [snap ? snapVal(cx - 130) : cx - 130, snap ? snapVal(cy) : cy], b: [snap ? snapVal(cx + 130) : cx + 130, snap ? snapVal(cy + 40) : cy + 40], drag: 0.26 };
    }
    case 'geyser': {
      return { t: 'geyser', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, h: 300, period: 3800, phase: 0 };
    }
    case 'trampoline':
      return { t: 'trampoline', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, w: 175, tension: 1.2 };
    case 'turnstile':
      return { t: 'turnstile', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, arms: 4, r: 78, mode: 0, period: 0, phase: 0 };
    case 'targets':
      return { t: 'targets', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, count: 4, reset: 5600 };
    case 'vortex':
      return { t: 'vortex', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, r: 175, spin: 1.4, hole: 34 };
    case 'platform':
      return { t: 'platform', ax: snap ? snapVal(cx - 70) : cx - 70, ay: snap ? snapVal(cy) : cy, bx: snap ? snapVal(cx + 70) : cx + 70, by: snap ? snapVal(cy) : cy, w: 130, travel: 2400, pause: 1600, phase: 0 };
    default:
      // Exhaustiveness: TypeScript ensures all PieceType are covered.
      throw new Error(`defaultPiece: unknown piece type ${(type as string)}`);
  }
}
