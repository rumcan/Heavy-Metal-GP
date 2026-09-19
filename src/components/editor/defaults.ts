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
    // ---- MB-10A: shortcuts and secrets ----
    case 'barricade': {
      return { t: 'barricade', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, w: 120, h: 44, tough: 4 };
    }
    case 'crumble': {
      return { t: 'crumble', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, w: 56, h: 120, tough: 6 };
    }
    case 'tunnel': {
      // Entrance at the click; exit 340 units higher, shooting up and slightly right.
      const ix = snap ? snapVal(cx) : cx;
      const iy = snap ? snapVal(cy) : cy;
      return { t: 'tunnel', x: ix, y: iy, exit: [snap ? snapVal(ix + 100) : ix + 100, iy - 340] as [number, number], edir: [0.3, -0.95] as [number, number], ms: 900, speed: 7 };
    }
    case 'trapdoor': {
      const w = 110;
      const hinge = -1 as -1 | 1;
      const hx = snap ? snapVal(cx) : cx;
      const center_x = hx - hinge * w / 2;
      return { t: 'trapdoor', x: center_x, y: snap ? snapVal(cy) : cy, w, hinge, mode: 'timer' as 'timer' | 'weight', open: 1400, closed: 2800, phase: 0, kg: 2.4, hold: 300 };
    }
    case 'switch': {
      return { t: 'switch', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, len: 120, angle: 0.65, side: 0 as 0 | 1 };
    }
    // ---- MB-10B: blades and crushers ----
    case 'blade': {
      return { t: 'blade', pivot: [snap ? snapVal(cx) : cx, snap ? snapVal(cy) : cy] as [number, number], len: 160, amp: 0.9, period: 2600, phase: 0, thin: 8 };
    }
    case 'saw': {
      // Set into the track at the click; drag a slot end to make it slide.
      const x = snap ? snapVal(cx) : cx;
      const y = snap ? snapVal(cy) : cy;
      return { t: 'saw', a: [x, y] as [number, number], b: [x, y] as [number, number], r: 26, spin: 0.55, period: 3600, phase: 0 };
    }
    case 'crusher': {
      return { t: 'crusher', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, w: 130, travel: 110, period: 4200, floor: 700, phase: 0 };
    }
    case 'boulder': {
      const x = snap ? snapVal(cx) : cx;
      const y = snap ? snapVal(cy) : cy;
      return {
        t: 'boulder',
        pts: [
          [x, y] as [number, number],
          [x + 340, y + 240] as [number, number],
        ],
        r: 27, interval: 6500, rest: 1400, phase: 0,
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
      return { t: 'screw', a: [x, y] as [number, number], b: [Math.min(W - 40, x + 120), y - 190] as [number, number], ms: 3200, cap: 2 };
    }
    case 'conveyor': {
      const x = snap ? snapVal(cx) : cx;
      const y = snap ? snapVal(cy) : cy;
      return { t: 'conveyor', a: [x - 140, y] as [number, number], b: [Math.min(W - 40, x + 140), y + 60] as [number, number], v: 0.16, flipMs: 0, dir: 0 as const };
    }
    case 'seesaw': {
      return { t: 'seesaw', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, len: 300, lim: 22, damp: 0.9 };
    }
    case 'bridge': {
      const x = snap ? snapVal(cx) : cx;
      const y = snap ? snapVal(cy) : cy;
      return { t: 'bridge', a: [x - 180, y] as [number, number], b: [Math.min(W - 40, x + 180), y] as [number, number], planks: 8, slack: 34 };
    }
    // ---- MB-10D ----
    case 'cannon': {
      return { t: 'cannon', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, aimMin: 288, aimMax: 314, power: 12, auto: 1600, phase: 0 };
    }
    case 'catapult': {
      return { t: 'catapult', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, len: 230, reload: 1400, dir: 0 };
    }
    case 'flipper': {
      return { t: 'flipper', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, side: 0, len: 120, strength: 1.4, timer: 0, phase: 0 };
    }
    case 'sling': {
      return { t: 'sling', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, size: 90, facing: 245, strength: 4 };
    }
    case 'scoop': {
      return { t: 'scoop', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, deg: 270, hold: 800 };
    }
    case 'wind': {
      return { t: 'wind', a: [snap ? snapVal(cx - 110) : cx - 110, snap ? snapVal(cy - 2600 * 0.01) : cy - 260], b: [snap ? snapVal(cx + 110) : cx + 110, snap ? snapVal(cy) : cy], dir: 270, str: 0.34, pulse: 2600, phase: 0 };
    }
    case 'magnet': {
      return { t: 'magnet', x: snap ? snapVal(cx) : cx, y: snap ? snapVal(cy) : cy, r: 170, str: 5, period: 4600, phase: 0 };
    }
    case 'mud': {
      return { t: 'mud', a: [snap ? snapVal(cx - 130) : cx - 130, snap ? snapVal(cy) : cy], b: [snap ? snapVal(cx + 130) : cx + 130, snap ? snapVal(cy + 40) : cy + 40], drag: 0.26 };
    }
    case 'pool': {
      return { t: 'pool', a: [snap ? snapVal(cx - 150) : cx - 150, snap ? snapVal(cy) : cy], b: [snap ? snapVal(cx + 150) : cx + 150, snap ? snapVal(cy) : cy], depth: 96, skip: 6.5 };
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
