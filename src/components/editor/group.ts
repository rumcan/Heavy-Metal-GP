/**
 * Group transform: a selection of two or more items gets one shared box with a rotate stalk and four corner
 * dots. Rotating turns every item about the box centre; a corner drag scales the whole set about the opposite
 * corner (positions, lengths and sizes), so a built section of ramps, curves, walls and pegs keeps its shape.
 *
 * Everything works from the pieces as they were when the drag started (pure: start pieces in, new pieces out).
 */
import type { Piece, Vec } from '../../game/trackdef';
import { W } from '../../game/track';
import { pieceCentre, rotatePiece, ROTATE_STEP_DEG } from './rotate';
import { translatePiece } from './translation';
import { BASE_STALK } from './handles';

type Point = { x: number; y: number };
export type GroupBox = { min: Point; max: Point };

export const GROUP_HANDLE_IDS = ['grp-rot', 'grp-nw', 'grp-ne', 'grp-sw', 'grp-se'] as const;

/** The shared box's handles: rotate pad above the top edge, a dot on each corner. */
export function groupHandles(box: GroupBox): { id: string; x: number; y: number; cursor: string; label: string }[] {
  const midX = (box.min.x + box.max.x) / 2;
  return [
    { id: 'grp-rot', x: midX, y: box.min.y - BASE_STALK, cursor: 'grab', label: 'Rotate group' },
    { id: 'grp-nw', x: box.min.x, y: box.min.y, cursor: 'nwse-resize', label: 'Scale group' },
    { id: 'grp-ne', x: box.max.x, y: box.min.y, cursor: 'nesw-resize', label: 'Scale group' },
    { id: 'grp-sw', x: box.min.x, y: box.max.y, cursor: 'nesw-resize', label: 'Scale group' },
    { id: 'grp-se', x: box.max.x, y: box.max.y, cursor: 'nwse-resize', label: 'Scale group' },
  ];
}

/** Union of boxes (the selection's shared box). */
export function unionBox(boxes: (GroupBox | undefined)[]): GroupBox | null {
  let out: GroupBox | null = null;
  for (const b of boxes) {
    if (!b) continue;
    if (!out) out = { min: { ...b.min }, max: { ...b.max } };
    else {
      out.min.x = Math.min(out.min.x, b.min.x); out.min.y = Math.min(out.min.y, b.min.y);
      out.max.x = Math.max(out.max.x, b.max.x); out.max.y = Math.max(out.max.y, b.max.y);
    }
  }
  return out;
}

const tidy = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Turn every piece by `rad` (clockwise on screen) about the world point `pivot`. */
export function rotateGroup(pieces: Piece[], rad: number, pivot: Point): Piece[] {
  // Flipped pieces are stored mirrored: mirror the pivot and reverse the turn, as rotateSelection does.
  return pieces.map((p) => (p.flip ? rotatePiece(p, -rad, { x: W - pivot.x, y: pivot.y }) : rotatePiece(p, rad, pivot)));
}

/** Scale one piece by `s` about the world point `anchor`: its position, length and size all follow. */
export function scalePiece(piece: Piece, s: number, anchor: Point): Piece {
  const a = piece.flip ? { x: W - anchor.x, y: anchor.y } : anchor;
  const sp = (x: number, y: number): [number, number] => [tidy(a.x + (x - a.x) * s), tidy(a.y + (y - a.y) * s)];
  const v = (p: Vec): Vec => sp(p[0], p[1]);
  switch (piece.t) {
    case 'ramp':
    case 'ice':
      return { ...piece, a: v(piece.a), b: v(piece.b) };
    case 'curve':
      return { ...piece, a: v(piece.a), c: v(piece.c), b: v(piece.b) };
    case 'wall': {
      const [x, y] = sp(piece.x, piece.y);
      return { ...piece, x, y, w: tidy(Math.max(4, piece.w * s)), h: tidy(Math.max(4, piece.h * s)) };
    }
    case 'boost': {
      const [x, y] = sp(piece.x, piece.y);
      return { ...piece, x, y, len: tidy(Math.max(10, piece.len * s)), thick: tidy(Math.max(4, piece.thick * s)) };
    }
    case 'ring': {
      const [x, y] = sp(piece.x, piece.y);
      return { ...piece, x, y, r: tidy(clamp(piece.r * s, 30, 1200)) };
    }
    case 'peg':
    case 'ppeg': {
      const [x, y] = sp(piece.x, piece.y);
      return { ...piece, x, y, r: tidy(clamp(piece.r * s, 2, 100)) };
    }
    default: {
      // Everything else: move its centre with the group and grow it through the Workshop size multiplier.
      const c = pieceCentre(piece);
      const [cx, cy] = sp(c.x, c.y);
      const moved = translatePiece(piece, cx - c.x, cy - c.y);
      const sc = Math.round(clamp((piece.sc ?? 1) * s, 0.2, 5) * 1000) / 1000;
      const out = { ...moved } as Piece;
      if (Math.abs(sc - 1) > 0.001) out.sc = sc; else delete out.sc;
      return out;
    }
  }
}

export function scaleGroup(pieces: Piece[], s: number, anchor: Point): Piece[] {
  return pieces.map((p) => scalePiece(p, s, anchor));
}

/**
 * Apply a group handle drag. `start` are the selected pieces at drag start, `box` their shared box then.
 * Rotate: the group turns so the rotate pad points at `to` (15° steps with `snap`). Corner: uniform scale
 * about the opposite corner by how far the pointer moved along the box's diagonal.
 */
export function applyGroupHandle(start: Piece[], id: string, to: Point, box: GroupBox, snap: boolean): Piece[] {
  if (id === 'grp-rot') {
    const c = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
    if (Math.hypot(to.x - c.x, to.y - c.y) < 6) return start;
    let rad = Math.atan2(to.y - c.y, to.x - c.x) + Math.PI / 2;
    if (snap) {
      const step = (ROTATE_STEP_DEG * Math.PI) / 180;
      rad = Math.round(rad / step) * step;
    }
    return rotateGroup(start, rad, c);
  }
  const corner = id.slice(4); // nw / ne / sw / se
  const cx = corner.includes('w') ? box.min.x : box.max.x;
  const cy = corner.includes('n') ? box.min.y : box.max.y;
  const anchor = { x: corner.includes('w') ? box.max.x : box.min.x, y: corner.includes('n') ? box.max.y : box.min.y };
  const dx = cx - anchor.x, dy = cy - anchor.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return start;
  let s = ((to.x - anchor.x) * dx + (to.y - anchor.y) * dy) / len2;
  s = clamp(s, 0.1, 10);
  if (snap) s = Math.max(0.1, Math.round(s * 20) / 20);
  return scaleGroup(start, s, anchor);
}
