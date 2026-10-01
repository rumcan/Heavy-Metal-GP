// Bakes the editor's generic `rot` (degrees, clockwise on screen) into a wind
// piece's physics geometry (`dir` + axis-aligned box `a`/`b`) so that the
// physics agrees with what the renderer draws.
//
// Standalone on purpose: no imports from other project files.
// Written in an Arena code battle (P2-02, #108).

export type Vec = [number, number];
export interface WindLike { t: 'wind'; a: Vec; b: Vec; dir: number; rot?: number; flip?: boolean }

const round1 = (v: number): number => Math.round(v * 10) / 10;
const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

export function bakeWindRotation<P extends WindLike>(piece: P): P {
  if (!piece.rot) return piece;

  // A mirrored piece is drawn mirrored, so its stored turn reads the other way.
  const turn = piece.flip ? -piece.rot : piece.rot;

  const dir = norm360(piece.dir + turn);

  // Rotate the rectangle's four corners about its own centre (y-down, clockwise on screen).
  const [ax, ay] = piece.a;
  const [bx, by] = piece.b;
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  const r = (turn * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);

  const corners: Vec[] = [[ax, ay], [bx, ay], [bx, by], [ax, by]];
  const rotated: Vec[] = corners.map(([x, y]): Vec => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });

  // The physics field is always axis-aligned: take the bounding box of the turned corners.
  const xs = rotated.map((v) => v[0]);
  const ys = rotated.map((v) => v[1]);
  const a: Vec = [round1(Math.min(...xs)), round1(Math.min(...ys))];
  const b: Vec = [round1(Math.max(...xs)), round1(Math.max(...ys))];

  const out = { ...piece, dir, a, b } as P;
  delete out.rot;
  return out;
}
