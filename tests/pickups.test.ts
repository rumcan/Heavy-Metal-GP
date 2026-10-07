// Run with: node --import tsx --test tests/pickups.test.ts
// The owner: boxes and item pegs give a skill you do not have at the start, one at a time in the Tab slot; crates are
// smash crates that never slow you down; the courses carry many more boxes and some item pegs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { TRACK_THEMES, emptyInventory } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { trackFromPlan } from '../src/game/platformer/build';
import { PLATFORMER_COURSES, GP_COURSES, planOfficial } from '../src/game/platformer/course';
import type { CoursePlan, Floor } from '../src/game/platformer/course';
import { TRIAL_SKILLS } from '../src/game/engine/items';
import { SKILLS } from '../src/game/skills/catalog';

const Y = 600;
const driver: MarbleInfo = { id: 0, name: 'Tester', color: '#ff0000', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true } as MarbleInfo;
const floors: Floor[] = [0, 1, 2].map((lane) => ({ lane: lane as 0, x0: -200, y0: Y, x1: 4200, y1: Y }));
const flat = (extra: Partial<CoursePlan>): CoursePlan => ({ seed: 0, width: 3800, height: Y + 900, floors, bumps: [], gates: [], path: [{ x: 0, y: Y - 30 }, { x: 3800, y: Y - 30 }], startX: 520, startY: Y, finishX: 3500, finishY: Y, ...extra });

function roll(plan: CoursePlan, x: number, vx: number, steps: number) {
  const game = new Game(1, [driver], { track: trackFromPlan(plan, 1, TRACK_THEMES.forest), recovery: false, effects: false, aiItems: false, inventory: emptyInventory() });
  game.start();
  game.openGate();
  const m = game.player;
  m.lane = 1;
  m.cannon = undefined;
  Matter.Body.setPosition(m.body, { x, y: Y - 15 });
  Matter.Body.setVelocity(m.body, { x: vx, y: 0 });
  for (let i = 0; i < steps; i++) game.step(PHYSICS_STEP);
  return { game, m };
}

test('trial skills: every skill except the ones you start with', () => {
  assert.ok(TRIAL_SKILLS.length > 0);
  for (const id of TRIAL_SKILLS) assert.ok(SKILLS[id].unlockLevel > 1, `${id} is a starter`);
  for (const starter of ['rocket', 'jump', 'shield'] as const) assert.ok(!TRIAL_SKILLS.includes(starter));
});

test('a box fills the Tab slot with a trial skill (rolling through it); holding one, the next box is left for others', () => {
  const plan = flat({ itemBoxes: [{ lane: 1, x: 1200, y: Y - 46 }, { lane: 1, x: 1600, y: Y - 46 }] });
  const { game, m } = roll(plan, 900, 8, 160);
  assert.ok(m.pickup && TRIAL_SKILLS.includes(m.pickup), `picked up ${m.pickup}`);
  assert.equal(Object.values(m.inventory).reduce((a, b) => a + b, 0), 0, 'nothing went into your own skills');
  const first = m.pickup;
  for (let i = 0; i < 200; i++) game.step(PHYSICS_STEP);
  assert.ok(m.body.position.x > 1650, 'it rolled past the second box');
  assert.equal(m.pickup, first, 'still the first one: one at a time');
  const second = game.track.itemBoxes.find((b) => Math.abs(b.position.x - 1600) < 1)!;
  assert.equal((second.plugin as { active: boolean }).active, true, 'the second box is still there');
  game.destroy();
});

test('using the Tab slot empties it and spends none of your own charges', () => {
  const plan = flat({ itemBoxes: [{ lane: 1, x: 1200, y: Y - 46 }] });
  const { game, m } = roll(plan, 900, 8, 160);
  // a skill that needs no target or clear spot
  m.pickup = 'anvil';
  m.itemCooldownUntil = 0;
  assert.ok(game.useItem(m, 'anvil'));
  assert.equal(m.pickup, null);
  assert.equal(m.inventory.anvil, 0);
  game.destroy();
});

test('a smash crate bursts with no resistance', () => {
  const plan = flat({ smashes: [{ id: 'c0', lane: 1, x: 1300, y: Y }] });
  const { game, m } = roll(plan, 900, 8, 200);
  assert.equal(plan.smashes!.length, 0, 'it burst');
  const free = roll(flat({}), 900, 8, 200);
  assert.ok(m.body.position.x > 1500, 'it rolled on past the crate');
  assert.ok(Math.abs(m.body.velocity.x - free.m.body.velocity.x) < 0.05, `the same speed as with no crate (vx ${m.body.velocity.x.toFixed(2)} vs ${free.m.body.velocity.x.toFixed(2)})`);
  free.game.destroy();
  game.destroy();
});

test('the courses: no crates to jump, smash crates instead, lots of boxes, some item pegs', () => {
  let pegs = 0;
  for (const c of [...PLATFORMER_COURSES, ...GP_COURSES].filter((c) => c.flow)) {
    const plan = planOfficial(c);
    assert.equal(plan.bumps.length, 0, `${c.id} has a crate to jump`);
    assert.ok((plan.itemBoxes?.length ?? 0) >= plan.width / 600, `${c.id}: ${plan.itemBoxes?.length} boxes over ${plan.width} px`);
    pegs += (plan.extras ?? []).filter((e) => e.piece.t === 'ppeg' && (e.piece as { color?: string }).color === 'green').length;
  }
  assert.ok(pegs > 0, 'item pegs on the courses');
});
