import type { Piece, Vec } from '../../game/trackdef';
import { W } from '../../game/track';

/** Map positional coordinates only: never directions, dimensions or exit timing. */
function mapCoordinates(piece: Piece, point: (x: number, y: number) => Vec): Piece {
  const p = { ...piece };
  if ('x' in p) {
    if ('y' in p) [p.x, p.y] = point(p.x, p.y);
    else [p.x, p.bottom] = point(p.x, p.bottom);
  }
  if ('a' in p) p.a = point(...p.a);
  if ('b' in p) p.b = point(...p.b);
  if ('c' in p) p.c = point(...p.c);
  if ('pivot' in p) p.pivot = point(...p.pivot);
  if ('pts' in p) p.pts = p.pts.map(([x, y]) => point(x, y));
  if ('ax' in p) {
    [p.ax, p.ay] = point(p.ax, p.ay);
    [p.bx, p.by] = point(p.bx, p.by);
  }
  if (p.t === 'tunnel') p.exit = point(...p.exit);
  // Buckets have no authored x; their horizontal motion is fixed by the builder.
  if (p.t === 'bucket') p.y = point(W / 2, p.y)[1];
  return p;
}

/** Unconstrained on-screen translation, including flipped pieces. Safe for local coordinates. */
export function translatePiece(piece: Piece, dx: number, dy: number): Piece {
  return mapCoordinates(piece, (x, y) => [x + (piece.flip ? -dx : dx), y + dy]);
}

/** How far past a side edge a map may place points (the TrackDef x range is -EDGE .. W + EDGE). */
const EDGE = 200;

/** Fit authored coordinates (not sprite overhang) with ONE delta for the whole group.
 * Returns null only when the group is wider than the track plus both edge margins; never squashes geometry.
 */
export function fitGroupTranslation(pieces: readonly Piece[], dx: number): number | null {
  let minX = Infinity, maxX = -Infinity;
  for (const piece of pieces) {
    if (piece.t === 'bucket') continue;
    mapCoordinates(piece, (x, y) => {
      const worldX = piece.flip ? W - x : x;
      minX = Math.min(minX, worldX);
      maxX = Math.max(maxX, worldX);
      return [x, y];
    });
  }
  if (maxX - minX <= W) return Math.max(-minX, Math.min(W - maxX, dx));
  // Wider than the track: rails built into the side walls reach past the edges (maps allow points up to
  // EDGE outside). Such a group may use that margin too; only refuse what could never be saved.
  if (maxX - minX > W + EDGE * 2) return null;
  return Math.max(-EDGE - minX, Math.min(W + EDGE - maxX, dx));
}
