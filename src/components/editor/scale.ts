import { Piece } from '../../game/trackdef';
import { Point } from './camera';
import { pieceCentre } from './rotate';

export function applyScaleHandle(piece: Piece, _handleId: string, to: Point, _snap: boolean): Piece {
  const c = pieceCentre(piece);
  // Compute scale based on pointer distance from center vs piece's natural size
  const dx = Math.abs(to.x - c.x);
  const dy = Math.abs(to.y - c.y);

  // We map the drag to properties based on piece type.
  // Note: we're scaling absolutely based on `to`, so the drag remains stable.
  switch (piece.t) {
    case 'block':
    case 'wall':
    case 'barricade':
    case 'crumble':
    case 'pool':
    case 'mud':
      return { ...piece, w: Math.max(10, dx * 2), h: Math.max(10, dy * 2) } as unknown as Piece;
    case 'flipper':
    case 'seesaw':
    case 'blade':
      return { ...piece, len: Math.max(10, Math.hypot(dx, dy) * 2) } as unknown as Piece;
    case 'spinner':
    case 'wheel':
    case 'mace':
    case 'screw':
    case 'hoop':
      return { ...piece, r: Math.max(10, Math.hypot(dx, dy)) } as unknown as Piece;
    case 'ramp':
    case 'ice': {
      // Scale points a and b relative to center
      const r = Math.max(20, Math.hypot(dx, dy));
      const oldR = Math.hypot(piece.a[0] - c.x, piece.a[1] - c.y) || 1;
      const scale = r / oldR;
      return {
        ...piece,
        a: [c.x + (piece.a[0] - c.x) * scale, c.y + (piece.a[1] - c.y) * scale],
        b: [c.x + (piece.b[0] - c.x) * scale, c.y + (piece.b[1] - c.y) * scale],
      } as unknown as Piece;
    }
    case 'curve': {
      const r = Math.max(20, Math.hypot(dx, dy));
      const oldR = Math.hypot(piece.a[0] - c.x, piece.a[1] - c.y) || 1;
      const scale = r / oldR;
      return {
        ...piece,
        a: [c.x + (piece.a[0] - c.x) * scale, c.y + (piece.a[1] - c.y) * scale],
        b: [c.x + (piece.b[0] - c.x) * scale, c.y + (piece.b[1] - c.y) * scale],
        c: [c.x + (piece.c[0] - c.x) * scale, c.y + (piece.c[1] - c.y) * scale],
      } as unknown as Piece;
    }
    default:
      return piece;
  }
}
