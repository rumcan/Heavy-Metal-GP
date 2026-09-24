/** Workshop groups: a multi-selection rotates about its shared box centre and scales about the opposite corner. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGroupHandle, unionBox } from '../src/components/editor/group';
import { buildEditorTrack } from '../src/components/editor/build';
import { validateTrackDef } from '../src/game/trackdef';
import type { Piece, TrackDef } from '../src/game/trackdef';
import { blankTemplate } from '../src/game/templates';

const SECTION: Piece[] = [
  { t: 'ramp', a: [200, 400], b: [400, 460] },
  { t: 'curve', a: [400, 460], c: [500, 480], b: [560, 560] },
  { t: 'ice', a: [560, 560], b: [700, 600] },
  { t: 'wall', x: 300, y: 560, w: 20, h: 120 },
  { t: 'boost', x: 620, y: 520, len: 80, thick: 14, dir: [1, 0] },
  { t: 'peg', x: 450, y: 600, r: 8 },
];

function built(pieces: Piece[]) {
  const def: TrackDef = { ...blankTemplate(), height: 3000, pieces };
  const b = buildEditorTrack(def);
  assert.equal(b.error, null);
  return b;
}
const size = (bx: { min: { x: number; y: number }; max: { x: number; y: number } }) => ({ w: bx.max.x - bx.min.x, h: bx.max.y - bx.min.y });
const centre = (bx: { min: { x: number; y: number }; max: { x: number; y: number } }) => ({ x: (bx.min.x + bx.max.x) / 2, y: (bx.min.y + bx.max.y) / 2 });

test('group: a quarter turn swaps the shared box and keeps its centre', () => {
  const box = unionBox(built(SECTION).pieceBounds)!;
  const c = centre(box);
  // pointer straight right of the centre = the rotate pad (top) swung to 3 o'clock = +90°
  const turned = applyGroupHandle(SECTION, 'grp-rot', { x: c.x + 200, y: c.y }, box, false);
  const after = unionBox(built(turned).pieceBounds)!;
  const s0 = size(box), s1 = size(after);
  assert.ok(Math.abs(s1.w - s0.h) < 30 && Math.abs(s1.h - s0.w) < 30, `box ${s0.w}x${s0.h} -> ${s1.w}x${s1.h}`);
  const c1 = centre(after);
  assert.ok(Math.hypot(c1.x - c.x, c1.y - c.y) < 25, 'turned about the box centre');
});

test('group: dragging a corner scales every piece about the opposite corner', () => {
  const box = unionBox(built(SECTION).pieceBounds)!;
  const s0 = size(box);
  // drag the SE corner out so the diagonal doubles
  const to = { x: box.max.x + s0.w, y: box.max.y + s0.h };
  const scaled = applyGroupHandle(SECTION, 'grp-se', to, box, false);
  const after = unionBox(built(scaled).pieceBounds)!;
  const s1 = size(after);
  // Rails keep their plank thickness while their lengths double, so the box grows a little under 2x.
  assert.ok(s1.w / s0.w > 1.8 && s1.w / s0.w < 2.05 && s1.h / s0.h > 1.8 && s1.h / s0.h < 2.05, `x${(s1.w / s0.w).toFixed(2)} y${(s1.h / s0.h).toFixed(2)}`);
  assert.ok(Math.abs(after.min.x - box.min.x) < 30 && Math.abs(after.min.y - box.min.y) < 30, `NW corner stays put: ${JSON.stringify(box.min)} -> ${JSON.stringify(after.min)}`);
  const peg = scaled.find((p) => p.t === 'peg') as Extract<Piece, { t: 'peg' }>;
  assert.equal(peg.r, 16);
  const wall = scaled.find((p) => p.t === 'wall') as Extract<Piece, { t: 'wall' }>;
  assert.equal(wall.h, 240);
});

test('group: the group id survives a save and load', () => {
  const def: TrackDef = { ...blankTemplate(), height: 3000, pieces: SECTION.map((p) => ({ ...p, grp: 3 })) };
  const parsed = validateTrackDef(JSON.parse(JSON.stringify(def)));
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  assert.ok(parsed.ok && parsed.def.pieces.every((p) => p.grp === 3));
});

test('a curve slides up to the wall: its bend handle may go past the edge, the rail may not', async () => {
  const { movePiece } = await import('../src/components/editor/handles');
  const { validateTrackDef: check } = await import('../src/game/trackdef');
  const { W } = await import('../src/game/track');
  // A bend towards the right wall: the rail's rightmost point is halfway between the chord and the handle.
  const curve: Piece = { t: 'curve', a: [500, 400], c: [700, 500], b: [500, 600] };
  const moved = movePiece(curve, 1000, 0) as Extract<Piece, { t: 'curve' }>;
  const railRight = 0.25 * moved.a[0] + 0.5 * moved.c[0] + 0.25 * moved.b[0];
  assert.ok(Math.abs(railRight - W) < 1, `rail reaches the wall (right edge ${railRight})`);
  assert.ok(moved.c[0] > W, 'the handle may sit past the wall');
  const def: TrackDef = { ...blankTemplate(), height: 3000, pieces: [moved] };
  assert.ok(check(def).ok, 'still a saveable map');
  // Much further bent: the handle would pass the saveable range, so the curve stops short of the wall.
  const deep: Piece = { t: 'curve', a: [300, 400], c: [700, 500], b: [300, 600] };
  const deepMoved = movePiece(deep, 1000, 0) as Extract<Piece, { t: 'curve' }>;
  assert.ok(deepMoved.c[0] <= W + 200, `handle kept saveable (${deepMoved.c[0]})`);
});
