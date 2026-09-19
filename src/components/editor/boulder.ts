import type { BoulderPiece } from '../../game/trackdef';

function pathLength(piece: BoulderPiece): number {
  return piece.pts.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - piece.pts[i][0], y - piece.pts[i][1]), 0);
}

export function boulderSpeed(piece: BoulderPiece): number {
  return pathLength(piece) * 1000 / Math.max(200, piece.interval - piece.rest);
}

/** Store speed using the existing cycle duration, so old maps and share codes remain compatible. */
export function setBoulderSpeed(piece: BoulderPiece, speed: number): BoulderPiece {
  const duration = pathLength(piece) * 1000 / Math.max(1, speed);
  return { ...piece, interval: Math.round(Math.max(1800, piece.rest + 200, Math.min(30000, piece.rest + duration))) };
}

/** Changing the pause preserves rolling speed within the supported cycle limits. */
export function setBoulderRest(piece: BoulderPiece, restMs: number): BoulderPiece {
  const rest = Math.round(Math.max(0, Math.min(10000, restMs)));
  return { ...piece, rest, interval: Math.max(1800, Math.min(30000, rest + Math.max(200, piece.interval - piece.rest))) };
}
