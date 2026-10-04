// Run with: node --import tsx --test tests/platformer-all-pieces.test.ts
// P2-26: the platformer Workshop has every piece of the drop-track Workshop. Each tile places a piece that survives
// validation and the share code, is built by the classic Builder in its own lane, and a race over a course with all
// of them runs without crashing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, TRACK_THEMES, mulberry32, randomStats } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { validateTrackDef } from '../src/game/trackdef';
import type { Piece } from '../src/game/trackdef';
import { decodeShareCode, encodeShareCode } from '../src/game/sharecode';
import { trackFromPlan } from '../src/game/platformer/build';
import { laneCategory } from '../src/game/lanes';
import { meta } from '../src/game/track';
import { PF_START_END, PF_START_Y, newPlatformerDef, planFromTrackDef } from '../src/game/platformer/def';
import { PALETTE, PLATFORMER_PALETTE } from '../src/components/editor/palette';
import { defaultPiece } from '../src/components/editor/defaults';

const Y = PF_START_Y;
const field = (): MarbleInfo[] => {
  const rng = mulberry32(31);
  return Array.from({ length: 6 }, (_, i) => ({ id: i, name: AI_NAMES[i] ?? `AI ${i}`, color: AI_COLORS[i % AI_COLORS.length], stats: randomStats(rng), isPlayer: false, character: i % 6 }));
};

test('every drop-track tile is also a platformer tile', () => {
  const side = new Set(PLATFORMER_PALETTE.flatMap((g) => g.tiles.map((t) => t.t)));
  const missing = PALETTE.flatMap((g) => g.tiles.map((t) => t.t)).filter((t) => !side.has(t) && t !== 'bucket'); // the minecart has no sideways meaning
  assert.deepEqual([...new Set(missing)], []);
  const ids = PLATFORMER_PALETTE.flatMap((g) => g.tiles.map((t) => t.id));
  assert.equal(new Set(ids).size, ids.length, 'tile ids are unique');
});

/** One of every classic piece, spaced along a long flat course, alternating lanes. */
function allPieces(): Piece[] {
  const own = new Set(['ramp', 'curve', 'ice', 'loop', 'bridge', 'ledge', 'gate', 'kicker', 'pad', 'boost', 'itembox', 'block', 'wrecker']);
  const types = [...new Set(PLATFORMER_PALETTE.flatMap((g) => g.tiles.map((t) => t.t)))].filter((t) => !own.has(t));
  return types.map((t, i) => ({ ...defaultPiece(t, { x: 1600 + i * 700, y: Y - 160 }), lane: ((i % 3) as 0 | 1 | 2) } as Piece));
}

test('a course with every classic piece validates, survives a share code, and builds each piece in its own lane', async () => {
  const width = 1600 + 60 * 700;
  const pieces: Piece[] = [{ t: 'ramp', a: [PF_START_END, Y], b: [width, Y] }, { t: 'ramp', a: [PF_START_END, Y], b: [width, Y], lane: 0 }, { t: 'ramp', a: [PF_START_END, Y], b: [width, Y], lane: 2 }, ...allPieces()];
  const check = validateTrackDef({ ...newPlatformerDef('All pieces', width), pieces });
  assert.ok(check.ok, check.ok ? '' : check.error);
  if (!check.ok) return;
  const back = await decodeShareCode(await encodeShareCode(check.def));
  assert.equal(back.pieces.length, check.def.pieces.length);
  const plan = planFromTrackDef(back);
  assert.ok((plan.extras?.length ?? 0) >= 30, `${plan.extras?.length} extra pieces`);
  const track = trackFromPlan(plan, 3, TRACK_THEMES.forest);
  const classic = track.bodies.filter((b) => (meta(b) as { classic?: boolean }).classic);
  assert.ok(classic.length >= 30);
  for (const b of classic) {
    const lane = (meta(b) as { lane: number }).lane;
    const lanes = [0, 1, 2].filter((l) => (b.collisionFilter.mask! & laneCategory(l)) !== 0);
    assert.deepEqual(lanes, [lane], `${meta(b).kind} meets only lane ${lane}`);
  }
  const game = new Game(3, field(), { track });
  game.start();
  game.openGate();
  for (let t = 0; t < 60000; t += PHYSICS_STEP) game.step(PHYSICS_STEP);
  assert.ok(game.marbles.every((m) => Number.isFinite(m.body.position.x) && Number.isFinite(m.body.position.y)), 'every marble is still somewhere');
});

test('computer drivers get past classic hazards and solid pieces on their lane', () => {
  const width = 9000;
  const pieces: Piece[] = [
    ...[0, 1, 2].map((lane) => ({ t: 'ramp', a: [PF_START_END, Y], b: [width, Y], lane } as Piece)),
    { t: 'breakable', x: 2400, y: Y - 30, w: 50, h: 60, req: 9, lane: 1 } as Piece,
    { ...defaultPiece('saw', { x: 3800, y: Y - 40 }), lane: 1 } as Piece,
    { ...defaultPiece('blade', { x: 5200, y: Y - 200 }), lane: 1 } as Piece,
  ];
  const check = validateTrackDef({ ...newPlatformerDef('Hazards', width), pieces });
  assert.ok(check.ok, check.ok ? '' : check.error);
  if (!check.ok) return;
  const game = new Game(4, field(), { track: trackFromPlan(planFromTrackDef(check.def), 4, TRACK_THEMES.forest) });
  game.start();
  game.openGate();
  let t = 0;
  for (; t < 240000 && !game.allFinished(); t += PHYSICS_STEP) game.step(PHYSICS_STEP);
  assert.ok(game.finishOrder.length >= 5, `${game.finishOrder.length}/6 finished after ${Math.round(t / 1000)} s`);
});
