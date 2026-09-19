/**
 * Rotation for the Workshop: turn one piece or a whole selection around a centre.
 *
 * Everything here works in the piece's STORED coordinates, the same space `handlesFor` and `movePiece` use.
 * A piece with `flip` set is drawn mirrored about the centre line, and a mirror reverses the sense of a turn,
 * so `rotateSelection` negates the angle for flipped pieces to keep "clockwise" clockwise on screen.
 *
 * What a turn can change depends on what the piece stores:
 * - ramps, ice rails and curves turn freely (their end points move);
 * - boosts and fire hoops turn freely (their direction vector turns);
 * - spinners turn their starting blade angle;
 * - walls, crates and blocks are always upright boxes, so only quarter turns change them (width and height swap);
 * - round and single-point pieces (loops, pegs, bumpers, item boxes, wrecking balls) only move around the centre.
 */
import type { Piece, Vec } from '../../game/trackdef';
import { W } from '../../game/track';
import { moveHandle } from './handles';

export interface Point { x: number; y: number }

/** Snap step for keyboard/button turns and for the rotate handle when the grid is on. */
export const ROTATE_STEP_DEG = 15;

const clampX = (x: number) => Math.max(0, Math.min(W, x));
/** Keep coordinates tidy (0.01 u) so repeated turns don't pile up float noise like 450.00000000000006. */
const tidy = (v: number) => Math.round(v * 100) / 100;

/** The point a piece turns around: its move handle. */
export function pieceCentre(piece: Piece): Point {
  const move = moveHandle(piece);
  return { x: move.x, y: move.y };
}

/** Pieces with a free angle, and so a rotate handle. Boxes turn only by quarter turns, via R / the toolbar. */
export function hasFreeRotation(piece: Piece): boolean {
  return piece.t === 'ramp' || piece.t === 'ice' || piece.t === 'curve' || piece.t === 'boost' || piece.t === 'hoop' || piece.t === 'spinner';
}

/** Current on-screen angle (radians) of a freely rotating piece. */
export function pieceAngle(piece: Piece): number {
  switch (piece.t) {
    case 'ramp':
    case 'ice':
    case 'curve':
      return Math.atan2(piece.b[1] - piece.a[1], piece.b[0] - piece.a[0]);
    case 'boost':
    case 'hoop':
      return Math.atan2(piece.dir[1], piece.dir[0]);
    case 'spinner':
      return piece.angle ?? 0;
    default:
      return 0;
  }
}

function turn(p: Vec, c: Point, cos: number, sin: number): Vec {
  const dx = p[0] - c.x;
  const dy = p[1] - c.y;
  return [tidy(clampX(c.x + dx * cos - dy * sin)), tidy(c.y + dx * sin + dy * cos)];
}

function turnDir(d: Vec, cos: number, sin: number): Vec {
  return [tidy(d[0] * cos - d[1] * sin), tidy(d[0] * sin + d[1] * cos)];
}

/** Rotate `piece` by `rad` (stored coordinates, positive = clockwise on screen since y grows downward) about `c`. */
export function rotatePiece(piece: Piece, rad: number, c: Point): Piece {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const at = (x: number, y: number) => turn([x, y], c, cos, sin);
  const quarterTurns = Math.round(rad / (Math.PI / 2));
  const isQuarter = Math.abs(rad - quarterTurns * (Math.PI / 2)) < 1e-6;
  switch (piece.t) {
    case 'ramp':
    case 'ice':
      return { ...piece, a: turn(piece.a, c, cos, sin), b: turn(piece.b, c, cos, sin) };
    case 'curve':
      return { ...piece, a: turn(piece.a, c, cos, sin), c: turn(piece.c, c, cos, sin), b: turn(piece.b, c, cos, sin) };
    case 'loop': {
      const [x, cy] = at(piece.x, piece.bottom - piece.r);
      return { ...piece, x, bottom: cy + piece.r };
    }
    case 'hoop': {
      const [x, y] = at(piece.x, piece.y);
      return { ...piece, x, y, dir: turnDir(piece.dir, cos, sin) };
    }
    case 'boost': {
      const [x, y] = at(piece.x, piece.y);
      return { ...piece, x, y, dir: turnDir(piece.dir, cos, sin) };
    }
    case 'spinner': {
      const [x, y] = at(piece.x, piece.y);
      return { ...piece, x, y, angle: (piece.angle ?? 0) + rad };
    }
    case 'wrecker':
      return { ...piece, pivot: turn(piece.pivot, c, cos, sin) };
    case 'pad': {
      const [x, y] = at(piece.x, piece.y);
      // A pad only launches left or right: a half turn swaps the side.
      return { ...piece, x, y, dir: cos < 0 ? (piece.dir === 1 ? -1 : 1) : piece.dir };
    }
    case 'breakable':
    case 'wall':
    case 'block': {
      const [x, y] = at(piece.x, piece.y);
      const swap = isQuarter && quarterTurns % 2 !== 0;
      return swap ? { ...piece, x, y, w: Math.min(W, piece.h), h: piece.w } : { ...piece, x, y };
    }
    // ---- MB-10A ----
    case 'barricade':
    case 'crumble': {
      const [x, y] = at(piece.x, piece.y);
      const swap = isQuarter && quarterTurns % 2 !== 0;
      return swap ? { ...piece, x, y, w: Math.min(W, piece.h), h: piece.w } : { ...piece, x, y };
    }
    case 'trapdoor': {
      const [x, y] = at(piece.x, piece.y);
      const swap = isQuarter && quarterTurns % 2 !== 0;
      // A half turn moves the hinge to the other side; the hatch still falls away from it.
      const hinge = (quarterTurns % 2 !== 0) ? (piece.hinge === 1 ? -1 : 1) : piece.hinge;
      return swap ? { ...piece, x, y, hinge: hinge as -1 | 1 } : { ...piece, x, y, hinge: hinge as -1 | 1 };
    }
    case 'tunnel': {
      const [x, y] = at(piece.x, piece.y);
      const [ex, ey] = at(piece.exit[0], piece.exit[1]);
      return { ...piece, x, y, exit: [ex, ey] as Vec, edir: turnDir(piece.edir, cos, sin) };
    }
    case 'switch': {
      const [x, y] = at(piece.x, piece.y);
      // A half turn swaps which side the route leans to.
      const side = (quarterTurns % 2 !== 0) ? (piece.side === 1 ? 0 : 1) : piece.side;
      return { ...piece, x, y, side: side as 0 | 1 };
    }
    // ---- MB-10B: machinery pivots move around the centre; the programs stay upright ----
    case 'blade': {
      const [x, y] = at(piece.pivot[0], piece.pivot[1]);
      return { ...piece, pivot: [x, y] as Vec };
    }
    case 'saw': {
      const a = at(piece.a[0], piece.a[1]);
      const bb = at(piece.b[0], piece.b[1]);
      return { ...piece, a: a as Vec, b: bb as Vec };
    }
    case 'crusher':
    case 'mace': {
      const [x, y] = at(piece.x, piece.y);
      return { ...piece, x, y };
    }
    case 'boulder': {
      return { ...piece, pts: piece.pts.map(([x, y]) => at(x, y) as Vec) };
    }
    // ---- MB-10C ----
    case 'wheel': {
      // Centre moves; the tip-out angle turns with the world.
      const [x, y] = at(piece.x, piece.y);
      const release = Math.max(20, Math.min(340, Math.round(piece.release + (rad * 180) / Math.PI)));
      return { ...piece, x, y, release };
    }
    case 'seesaw': {
      const [x, y] = at(piece.x, piece.y);
      return { ...piece, x, y };
    }
    case 'screw':
    case 'conveyor':
    case 'bridge': {
      const p2 = piece as unknown as { a: Vec; b: Vec };
      return { ...piece, a: turn(p2.a, c, cos, sin), b: turn(p2.b, c, cos, sin) } as Piece;
    }
    // ---- MB-10D ----
    case 'cannon': {
      // Centre moves; the whole aim fan turns with the world.
      const [x, y] = at(piece.x, piece.y);
      const d = (rad * 180) / Math.PI;
      const wrap = (v: number) => ((v % 360) + 360) % 360;
      return { ...piece, x, y, aimMin: wrap(piece.aimMin + d), aimMax: wrap(piece.aimMax + d) };
    }
    case 'catapult':
    case 'flipper': {
      const [x, y] = at(piece.x, piece.y);
      return { ...piece, x, y };
    }
    case 'sling': {
      const [x, y] = at(piece.x, piece.y);
      const facing = (((piece.facing + (rad * 180) / Math.PI) % 360) + 360) % 360;
      return { ...piece, x, y, facing };
    }
    case 'scoop': {
      const [x, y] = at(piece.x, piece.y);
      const deg = (((piece.deg + (rad * 180) / Math.PI) % 360) + 360) % 360;
      return {
        ...piece, x, y, deg,
        ...(piece.exit ? { exit: turn(piece.exit as unknown as Vec, c, cos, sin) as unknown as [number, number, number] } : {}),
      };
    }
    case 'peg':
    case 'ppeg':
    case 'itembox': {
      const [x, y] = at(piece.x, piece.y);
      return { ...piece, x, y };
    }
    case 'wind': {
      const dir = (((piece.dir + (rad * 180) / Math.PI) % 360) + 360) % 360;
      return { ...piece, a: turn(piece.a, c, cos, sin), b: turn(piece.b, c, cos, sin), dir };
    }
    case 'mud':
      return { ...piece, a: turn(piece.a, c, cos, sin), b: turn(piece.b, c, cos, sin) };
    case 'pool': {
      // The water level stays horizontal: slide the corners but keep depth vertical.
      const [ax, ay] = at(piece.a[0], piece.a[1]);
      const [bx, by] = at(piece.b[0], piece.b[1]);
      const lx = Math.min(ax, bx), hx = Math.max(ax, bx);
      const top = Math.min(ay, by);
      return { ...piece, a: [lx, top], b: [hx, top] };
    }
    case 'magnet':
    case 'geyser': {
      const [x, y] = at(piece.x, piece.y);
      return { ...piece, x, y };
    }
    case 'trampoline':
    case 'turnstile':
    case 'targets':
    case 'vortex': {
      const [x, y] = at(piece.x, piece.y);
      return { ...piece, x, y };
    }
    case 'platform': {
      const [ax, ay] = at(piece.ax, piece.ay);
      const [bx, by] = at(piece.bx, piece.by);
      return { ...piece, ax, ay, bx, by };
    }
    case 'bucket':
      // Always spans the pipe at a fixed height.
      return piece;
  }
}

/**
 * Turn the pieces at `indices` by `deg` degrees (clockwise on screen) as one group. A single piece turns
 * around its own centre; a group turns around the average of its pieces' centres, so the layout stays intact.
 */
export function rotateSelection(pieces: Piece[], indices: number[], deg: number): Piece[] {
  const picked = indices.filter((i) => pieces[i]);
  if (picked.length === 0 || deg === 0) return pieces;
  // Centres in world space: a flipped piece is drawn at W - x.
  const centres = picked.map((i) => { const c = pieceCentre(pieces[i]); return pieces[i].flip ? { x: W - c.x, y: c.y } : c; });
  const c = { x: centres.reduce((s, p) => s + p.x, 0) / centres.length, y: centres.reduce((s, p) => s + p.y, 0) / centres.length };
  const rad = (deg * Math.PI) / 180;
  const next = pieces.slice();
  for (const i of picked) {
    const p = pieces[i];
    // Flipped pieces are drawn mirrored: mirror the centre and reverse the turn to match what the player sees.
    next[i] = p.flip ? rotatePiece(p, -rad, { x: W - c.x, y: c.y }) : rotatePiece(p, rad, c);
  }
  return next;
}

/** Where the rotate handle sits: `offset` world units "above" the piece, perpendicular to its angle. */
export function rotateHandlePoint(piece: Piece): Point {
  const c = pieceCentre(piece);
  const a = pieceAngle(piece);
  const halfLen = piece.t === 'ramp' || piece.t === 'ice' || piece.t === 'curve'
    ? Math.hypot(piece.b[0] - piece.a[0], piece.b[1] - piece.a[1]) / 2
    : 0;
  const offset = Math.max(56, Math.min(120, halfLen * 0.35 + 40));
  return { x: c.x + Math.sin(a) * offset, y: c.y - Math.cos(a) * offset };
}

/** Apply a rotate-handle drag: the piece turns so its handle points at `to`. Snaps to 15° when `snap`. */
export function applyRotateHandle(piece: Piece, to: Point, snap: boolean): Piece {
  const c = pieceCentre(piece);
  if (Math.hypot(to.x - c.x, to.y - c.y) < 6) return piece;
  // The handle sits at angle - 90°, so the piece's new angle is the pointer's angle + 90°.
  let target = Math.atan2(to.y - c.y, to.x - c.x) + Math.PI / 2;
  if (snap) {
    const step = (ROTATE_STEP_DEG * Math.PI) / 180;
    target = Math.round(target / step) * step;
  }
  const delta = target - pieceAngle(piece);
  return rotatePiece(piece, delta, c);
}
