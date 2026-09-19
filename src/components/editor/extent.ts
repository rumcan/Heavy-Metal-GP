/**
 * #71. What a piece occupies along x, and the translations that keep it inside the pipe.
 *
 * Three callers need the same answer: placement (`defaults.ts`) has to fit the geometry it just
 * generated, moving (`handles.ts`) has to translate a piece or a whole selection without reshaping
 * it, and validation (`validate.ts`) has to report coordinates that fall outside 0..W. Keeping the
 * list of stored x coordinates in one place means a new piece type cannot be fixed in one of those
 * three and forgotten in the others.
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
    case 'switch':
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
    case 'scoop': {
      const p = piece as unknown as { x: number; exit?: [number, number, number] };
      return p.exit ? [p.x, p.exit[0]] : [p.x];
    }
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
    case 'pool':
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

/** The combined extent of several pieces — what a multi-selection occupies. */
export function groupXExtent(pieces: readonly Piece[]): XExtent | null {
  return extentOf(pieces.flatMap(pieceXs));
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
 * The x translations that keep `extent` inside 0..W, or null when no translation can: a piece wider
 * than the track is out of range wherever it goes, so its shape wins and the validator reports it.
 * `0` is always inside the range of an in-range extent, so callers can lean on that.
 */
export function deltaRange(extent: XExtent | null): { lo: number; hi: number } | null {
  if (!extent) return null;
  if (extent.max - extent.min > W) return null;
  return { lo: -extent.min, hi: W - extent.max };
}

/**
 * The part of `dx` an extent can actually absorb: everything up to the wall, never more. Clamping
 * the *delta* rather than each coordinate is what keeps a moved piece the same shape it was.
 */
export function clampDeltaToExtent(extent: XExtent | null, dx: number): number {
  const range = deltaRange(extent);
  if (!range || !Number.isFinite(dx)) return dx;
  return Math.max(range.lo, Math.min(range.hi, dx));
}

/**
 * The single translation that brings an out-of-range extent back inside 0..W — the shortest one, so
 * a click near an edge nudges the piece in instead of throwing it across the track. Zero when the
 * extent already fits, and (as with `deltaRange`) no answer at all for an over-wide extent.
 */
export function fitDelta(extent: XExtent | null): number {
  if (!extent) return 0;
  if (extent.max > W) return W - extent.max;
  if (extent.min < 0) return -extent.min;
  return 0;
}
