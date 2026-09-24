/**
 * #71. What a piece occupies along x, and the translations that keep it inside the pipe.
 *
 * Two callers need the same answer: the handle drags in `handles.ts`, which have to slide a piece
 * without reshaping it, and validation (`validate.ts`), which has to report coordinates outside
 * 0..W. Keeping the list of stored x coordinates in one place means a new piece type cannot be
 * handled in one of them and forgotten in the other. Whole-piece and group translations — including
 * the slide a placement applies — live in `translation.ts`, which owns the coordinate mapping.
 *
 * Only the *stored* coordinates matter here — the ones `validateTrackDef` range-checks — because
 * those are what a share code carries and what the race replays. Sprite padding is a drawing
 * concern (`bounds.ts`), not a validity one.
 */
import type { Piece } from '../../game/trackdef';
import { W } from '../../game/track';

/**
 * Every stored x coordinate of `piece`, in the piece's own (stored) space. A flipped piece is drawn
 * mirrored but validated as stored, so callers never mirror these. Empty for pieces that store no x
 * at all — the bucket is centred by the track itself.
 */
export function pieceXs(piece: Piece): number[] {
  switch (piece.t) {
    case 'ring':
      return [piece.x - piece.r - piece.thick / 2, piece.x + piece.r + piece.thick / 2];
    case 'ramp':
    case 'ice':
      return [piece.a[0], piece.b[0]];
    case 'curve':
      return [piece.a[0], piece.c[0], piece.b[0]];
    case 'loop':
      return [piece.x];
    case 'hoop':
    case 'pad':
    case 'boost':
    case 'spinner':
    case 'breakable':
    case 'peg':
    case 'ppeg':
    case 'itembox':
    case 'wall':
    case 'block':
    case 'barricade':
    case 'crumble':
    case 'trapdoor':
    // ---- MB-10B ----
    case 'crusher':
    case 'mace':
      return [(piece as { x: number }).x];
    case 'blade':
      return [piece.pivot[0]];
    case 'saw':
      return [piece.a[0], piece.b[0]];
    case 'boulder':
      return piece.pts.map(([x]) => x);
    // ---- MB-10C ----
    case 'wheel':
    case 'seesaw':
      return [(piece as unknown as { x: number }).x];
    case 'screw':
    case 'conveyor':
    case 'bridge':
      return [(piece as unknown as { a: readonly [number, number] }).a[0], (piece as unknown as { b: readonly [number, number] }).b[0]];
    // ---- MB-10D ----
    case 'cannon':
    case 'catapult':
    case 'flipper':
    case 'sling':
      return [(piece as unknown as { x: number }).x];
    case 'tunnel':
      return [piece.x, piece.exit[0]];
    case 'wrecker':
      return [piece.pivot[0]];
    case 'bucket':
      // Stores no x: it hangs from the track's centre line, so nothing to keep in range.
      return [];
    // ---- MB-10E ----
    case 'wind':
    case 'mud':
      return [(piece as unknown as { a: readonly [number, number] }).a[0], (piece as unknown as { b: readonly [number, number] }).b[0]];
    case 'magnet':
    case 'geyser':
    case 'trampoline':
    case 'turnstile':
    case 'targets':
    case 'vortex':
      return [(piece as unknown as { x: number }).x];
    case 'platform':
      return [(piece as unknown as { ax: number }).ax, (piece as unknown as { bx: number }).bx];
  }
}

/** The leftmost and rightmost stored x of a piece, or null when it stores none. */
export interface XExtent { min: number; max: number }

export function xExtent(piece: Piece): XExtent | null {
  return extentOf(pieceXs(piece));
}

function extentOf(xs: readonly number[]): XExtent | null {
  let min = Infinity;
  let max = -Infinity;
  for (const x of xs) {
    if (!Number.isFinite(x)) continue;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return min === Infinity ? null : { min, max };
}

/**
 * The part of a *stored-space* delta an extent can actually absorb: everything up to the wall, never
 * more. Clamping the delta rather than each coordinate is what keeps a moved piece the same shape it
 * was. Screen-space moves (which flipped pieces reverse) go through `fitGroupTranslation`; this is
 * for the handle drags, which work in the piece's own coordinates.
 */
export function clampDeltaToExtent(extent: XExtent | null, dx: number): number {
  if (!extent || !Number.isFinite(dx)) return dx;
  if (extent.max - extent.min > W) return dx;
  return Math.max(-extent.min, Math.min(W - extent.max, dx));
}
