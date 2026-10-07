// Crossing tracks (Workshop): joining track pieces end to end. Dragging a ramp's or curve's end near another track end
// snaps onto it; a curve's bend can be lined up with the track it joins (no kink to bounce off); a track can be reversed
// (a rail is ridden from its start dot to its end dot, solid on the right of travel).
import type { Piece } from '../../game/trackdef';

/** Ends this close (world px) snap together. */
export const JOIN_SNAP = 16;

type Track = Extract<Piece, { t: 'ramp' } | { t: 'curve' }>;
const isTrack = (p: Piece | undefined): p is Track => p?.t === 'ramp' || p?.t === 'curve';
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Snap end `handle` of piece `index` onto the nearest other track end of its lane within JOIN_SNAP (else unchanged). */
export function snapEnd(pieces: readonly Piece[], index: number, handle: 'a' | 'b'): Piece {
  const p = pieces[index];
  if (!isTrack(p)) return p;
  const end = p[handle], lane = p.lane ?? 1;
  let best: { d: number; at: [number, number] } | null = null;
  pieces.forEach((q, j) => {
    if (j === index || !isTrack(q) || (q.lane ?? 1) !== lane) return;
    for (const at of [q.a, q.b]) {
      const d = dist(end, at);
      if (d <= JOIN_SNAP && (!best || d < best.d)) best = { d, at: [at[0], at[1]] };
    }
  });
  return best ? ({ ...p, [handle]: (best as { at: [number, number] }).at } as Piece) : p;
}

/** The same track ridden the other way. */
export function reverseTrack(p: Piece): Piece {
  return isTrack(p) ? ({ ...p, a: p.b, b: p.a } as Piece) : p;
}

/**
 * Line a curve's bend up with the track joined to its start (else to its end): its control point moves onto the line
 * the other track arrives along, keeping its distance, so the two meet without a kink.
 */
export function smoothJoins(pieces: readonly Piece[], index: number): Piece {
  const p = pieces[index];
  if (p?.t !== 'curve') return p;
  const lane = p.lane ?? 1;
  const others = pieces.filter((q, j) => j !== index && isTrack(q) && (q.lane ?? 1) === lane) as Track[];
  const unit = (from: readonly number[], to: readonly number[]) => { const l = dist(from, to) || 1; return [(to[0] - from[0]) / l, (to[1] - from[1]) / l]; };
  const r = (v: number) => Math.round(v);
  const prev = others.find((q) => dist(q.b, p.a) <= 1);
  if (prev) {
    const dir = prev.t === 'ramp' ? unit(prev.a, prev.b) : unit(prev.c, prev.b); // the way it arrives
    const len = dist(p.a, p.c);
    return { ...p, c: [r(p.a[0] + dir[0] * len), r(p.a[1] + dir[1] * len)] };
  }
  const next = others.find((q) => dist(q.a, p.b) <= 1);
  if (next) {
    const dir = next.t === 'ramp' ? unit(next.a, next.b) : unit(next.a, next.c); // the way it leaves
    const len = dist(p.b, p.c);
    return { ...p, c: [r(p.b[0] - dir[0] * len), r(p.b[1] - dir[1] * len)] };
  }
  return p;
}
