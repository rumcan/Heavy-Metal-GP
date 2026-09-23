/**
 * Workshop handle audit: for every palette item, place it on a blank track, drag its bottom-right corner dot
 * outwards and its rotate icon a quarter turn, exactly as the editor does (applyHandle on the piece as it was at
 * drag start, with the drag-start bounding box as the resize anchor), rebuild, and report what actually changed.
 *
 *   node --import tsx scripts/audit-handles.ts
 */
import type Matter from 'matter-js';
import { TILES } from '../src/components/editor/palette';
import { defaultPiece } from '../src/components/editor/defaults';
import { applyHandle } from '../src/components/editor/handles';
import { pieceAngle, pieceCentre } from '../src/components/editor/rotate';
import { buildEditorTrack } from '../src/components/editor/build';
import { blankTemplate } from '../src/game/templates';
import type { Piece, TrackDef } from '../src/game/trackdef';
import { meta } from '../src/game/track';

type Pt = { x: number; y: number };

function build(piece: Piece) {
  const def: TrackDef = { ...blankTemplate(), height: 4000, pieces: [piece] };
  const built = buildEditorTrack(def);
  if (!built.track) throw new Error(built.error ?? 'build failed');
  const bodies = built.track.bodies.filter((_, i) => built.bodyToPiece[i] === 0);
  return { bounds: built.pieceBounds[0], bodies };
}

/** Outline points of every body the piece built (circles sampled so their outline is comparable too). */
function outline(bodies: Matter.Body[]): Pt[] {
  const pts: Pt[] = [];
  for (const b of bodies) {
    const parts = b.parts.length > 1 ? b.parts.slice(1) : [b];
    // A circle's outline is the same at any angle; add one marker on its rim so a turned image registers.
    const xf = meta(b)?.xf;
    for (const p of parts) for (const v of p.vertices) {
      if (!xf) { pts.push({ x: v.x, y: v.y }); continue; }
      // as drawn: the Workshop transform (rotation + size about the piece pivot)
      const dx = (v.x - xf.cx) * xf.sc, dy = (v.y - xf.cy) * xf.sc;
      pts.push({ x: xf.cx + dx * Math.cos(xf.rot) - dy * Math.sin(xf.rot), y: xf.cy + dx * Math.sin(xf.rot) + dy * Math.cos(xf.rot) });
    }
  }
  return pts;
}

function meanNearest(a: Pt[], b: Pt[]): number {
  if (!a.length || !b.length) return Infinity;
  let sum = 0;
  for (const p of a) {
    let best = Infinity;
    for (const q of b) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
    sum += best;
  }
  return sum / a.length;
}

const rot = (p: Pt, c: Pt, rad: number): Pt => {
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(rad) - dy * Math.sin(rad), y: c.y + dx * Math.sin(rad) + dy * Math.cos(rad) };
};

const rows: string[][] = [];
for (const tile of TILES) {
  const row = [tile.id, tile.label];
  try {
    const piece = { ...defaultPiece(tile.t, { x: 450, y: 1500 }, false), ...tile.preset } as Piece;
    const before = build(piece);
    const b0 = before.bounds;
    const w0 = b0.max.x - b0.min.x, h0 = b0.max.y - b0.min.y;

    // ---- resize: drag the SE dot out by 40% of the box
    const to = { x: b0.max.x + w0 * 0.4, y: b0.max.y + h0 * 0.4 };
    const resized = applyHandle(piece, 'box-se', to, false, { min: { ...b0.min }, max: { ...b0.max } });
    const after = build(resized).bounds;
    const sx = (after.max.x - after.min.x) / (w0 || 1), sy = (after.max.y - after.min.y) / (h0 || 1);
    const grew = sx > 1.05 || sy > 1.05;
    row.push(grew ? `yes (${sx.toFixed(2)}x, ${sy.toFixed(2)}x)` : `NO (${sx.toFixed(2)}x, ${sy.toFixed(2)}x)`);

    // ---- rotate: drag the rotate icon to the right of the centre (a pointer at 0 rad => the piece aims at 90deg)
    const c = pieceCentre(piece);
    // Aim the pointer right of the centre (piece aims at 90deg); if the piece already points there, aim below
    // it instead (180deg) so the test always asks for a real turn.
    const aimRight = Math.abs(Math.PI / 2 - pieceAngle(piece)) > 0.05;
    // an odd angle (about 37deg off), not a quarter turn, so quarter-turn-only rotation is caught too
    const pointer = aimRight ? { x: c.x + 150, y: c.y + 113 } : { x: c.x - 113, y: c.y + 150 };
    const rotated = applyHandle(piece, 'box-rot', pointer, false);
    const expected = Math.atan2(pointer.y - c.y, pointer.x - c.x) + Math.PI / 2 - pieceAngle(piece);
    const p0 = outline(before.bodies);
    const p1 = outline(build(rotated).bodies);
    // Round bodies: a turned circle has the same outline, so follow a rim marker (as drawn) on its own.
    const markers = (bodies: Matter.Body[]) => bodies.filter((b) => b.circleRadius).map((b) => {
      const xf = meta(b)?.xf; const v = { x: b.position.x + b.circleRadius!, y: b.position.y };
      if (!xf) return v;
      const dx = (v.x - xf.cx) * xf.sc, dy = (v.y - xf.cy) * xf.sc;
      return { x: xf.cx + dx * Math.cos(xf.rot) - dy * Math.sin(xf.rot), y: xf.cy + dx * Math.sin(xf.rot) + dy * Math.cos(xf.rot) };
    });
    const m0 = markers(before.bodies), m1 = markers(build(rotated).bodies);
    const markerMoved = m0.length ? Math.max(...m0.map((p, i) => Math.hypot(p.x - m1[i].x, p.y - m1[i].y))) : 0;
    const moved = Math.max(meanNearest(p0, p1), markerMoved);
    const bc = { x: (b0.min.x + b0.max.x) / 2, y: (b0.min.y + b0.max.y) / 2 };
    const asExpected = Math.min(meanNearest(p0.map((p) => rot(p, c, expected)), p1), meanNearest(p0.map((p) => rot(p, bc, expected)), p1));
    const allRound = before.bodies.every((b) => b.circleRadius);
    let verdict: string;
    if (Math.abs(expected) < 0.05) verdict = 'already at 90deg (inconclusive)';
    else if (moved < 1) verdict = allRound ? 'NO (round body only; image did not turn)' : 'NO (nothing moved)';
    else if (asExpected < 4) verdict = 'yes';
    else verdict = `PARTIAL (parts moved ${moved.toFixed(0)}u but not as one rotation; off by ${asExpected.toFixed(0)}u)`;
    row.push(verdict);
  } catch (e) {
    row.push('ERROR', e instanceof Error ? e.message.slice(0, 60) : String(e));
  }
  rows.push(row);
}

const head = ['id', 'label', 'corner dot resizes', 'rotate icon rotates whole item'];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
const line = (r: string[]) => r.map((c, i) => (c ?? '').padEnd(widths[i])).join(' | ');
console.log(line(head));
console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
for (const r of rows) console.log(line(r));
const failR = rows.filter((r) => r[2]?.startsWith('NO') || r[2] === 'ERROR').length;
const failT = rows.filter((r) => !(r[3] ?? '').startsWith('yes')).length;
console.log(`\n${rows.length} items. Resize failures: ${failR}. Rotate not working: ${failT}.`);
