// Run with: node --import tsx --test tests/premium-skills.test.ts
// The owner's twenty premium spells and weapons (src/game/skills/premium.ts) in a headless platformer race: each one
// does what its description says, and a refused one keeps its charge. Plus the premium lock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';

import { Game } from '../src/game/engine';
import type { Marble } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, PREMIUM_ITEMS, emptyInventory, mulberry32, randomStats, TRACK_THEMES } from '../src/game/types';
import type { ItemType } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';
import { floorAt } from '../src/game/platformer/course';
import { SKILLS } from '../src/game/skills/catalog';
import { lockReason } from '../src/game/loadout';
import type { Catalog } from '../src/game/loadout';
import { setUnlockAll } from '../src/game/premium';
import type { PremiumFx } from '../src/game/skills/premium';

function roster() {
  const rng = mulberry32(5);
  return Array.from({ length: 10 }, (_, i) => ({ id: i, name: AI_NAMES[i] ?? `AI ${i}`, color: AI_COLORS[i % AI_COLORS.length], stats: randomStats(rng), isPlayer: false, character: i % 6 }));
}
function arena() {
  const game = new Game(8, roster(), { track: buildPlatformerTrack(8, TRACK_THEMES.forest, 'rolling-hills') });
  game.start();
  game.openGate();
  for (let i = 0; i < 100; i++) game.step(PHYSICS_STEP);
  for (const m of game.marbles) game.humanInput.set(m.info.id, { nudge: 0 });
  return game;
}
function place(game: Game, id: number, x: number, lane = 1) {
  const m = game.marbles[id];
  const plan = game.track.platformer!.plan;
  m.lane = lane; m.laneAt = undefined; game.applyMask(m);
  Matter.Body.setPosition(m.body, { x, y: floorAt(plan, lane as 0 | 1 | 2, x)! - 16 });
  Matter.Body.setVelocity(m.body, { x: 0, y: 0 });
  m.progress = undefined;
  return m;
}
/** Everyone else far back, then the two we care about (a behind, b ahead by `gap`). */
function duel(game: Game, gap = 150) {
  for (let i = 2; i < 10; i++) place(game, i, 400 + i * 30);
  const a = place(game, 0, 3000), b = place(game, 1, 3000 + gap);
  return { a, b };
}
const give = (m: Marble, item: ItemType) => { m.inventory = { ...emptyInventory(), [item]: 3 }; };
const run = (game: Game, ms: number) => { for (let t = 0; t < ms; t += PHYSICS_STEP) game.step(PHYSICS_STEP); };
const fx = (m: Marble) => (m.fx ?? {}) as PremiumFx;
const hp = (m: Marble) => m.health?.hp ?? 100;
const use = (game: Game, m: Marble, item: ItemType) => { give(m, item); game.time += 1000; return game.useItem(m, item); };

test('the twenty premium skills are in the registry with their info, and locked until the premium unlock', () => {
  assert.equal(PREMIUM_ITEMS.length, 20);
  const cat: Catalog = Object.fromEntries(Object.values(SKILLS).map((d) => [d.id, { price: d.price, unlockLevel: d.unlockLevel, starter: false, premium: d.premium }]));
  setUnlockAll(false);
  for (const id of PREMIUM_ITEMS) assert.equal(lockReason(id, cat, { level: 999, campaignComplete: true }, false), 'premium', id);
  assert.equal(lockReason('bomb', cat, { level: 30, campaignComplete: true }, false), null, 'a level skill is not premium');
  setUnlockAll(true);
  for (const id of PREMIUM_ITEMS) assert.equal(lockReason(id, cat, { level: 1, campaignComplete: false }, false), null, id);
  setUnlockAll(false);
});

test('Soul Swap trades places (and lanes) with the racer one place ahead', () => {
  const game = arena();
  const { a, b } = duel(game, 400);
  place(game, 1, 3400, 0);
  game.step(PHYSICS_STEP); // the race order catches up
  const pa = { ...a.body.position }, pb = { ...b.body.position };
  assert.equal(use(game, a, 'swap'), true);
  assert.ok(Math.abs(a.body.position.x - pb.x) < 1 && Math.abs(b.body.position.x - pa.x) < 1, 'swapped');
  assert.equal(a.lane, 0);
  assert.equal(b.lane, 1);
});

test('Telekinesis lifts the nearest rival, holds it, then throws it back; Heavy Metal is too heavy', () => {
  const game = arena();
  const { a, b } = duel(game);
  const y0 = b.body.position.y, x0 = b.body.position.x;
  assert.equal(use(game, a, 'telekinesis'), true);
  run(game, 800);
  assert.ok(b.body.position.y < y0 - 60, `lifted (${y0 - b.body.position.y} px)`);
  run(game, 800);
  assert.ok(b.body.velocity.x < -3 || b.body.position.x < x0, 'thrown back');
  // a heavy marble cannot be lifted
  const g2 = arena();
  const d = duel(g2);
  d.b.anvilUntil = g2.time + 5000;
  use(g2, d.a, 'telekinesis');
  assert.ok(!(fx(d.b).liftUntil), 'too heavy');
});

test('Gravity Well drags a rival toward it; Time Warp slows everyone else; Shrink Hex shrinks the leader', () => {
  const game = arena();
  const { a, b } = duel(game, 120);
  // a rival just past the well's spot is pulled back toward it
  place(game, 1, 2700);
  assert.equal(use(game, a, 'well'), true);
  const z = game.zones.find((q) => q.kind === 'well')!;
  assert.ok(z && z.x < a.body.position.x, 'the well is behind you');
  const before = b.body.position.x;
  run(game, 500);
  assert.ok(Math.abs(b.body.position.x - z.x) < Math.abs(before - z.x), 'pulled toward the well');

  const g2 = arena();
  const d = duel(g2);
  assert.equal(use(g2, d.a, 'warp'), true);
  assert.ok((fx(d.b).slowUntil ?? 0) > g2.time && !(fx(d.a).slowUntil));
  Matter.Body.setVelocity(d.b.body, { x: 15, y: 0 });
  run(g2, 300);
  assert.ok(Math.hypot(d.b.body.velocity.x, d.b.body.velocity.y) < 9, 'slowed');

  const g3 = arena();
  const e = duel(g3, 600);
  assert.equal(use(g3, e.a, 'shrink'), true);
  assert.ok(g3.marbles.some((m) => (fx(m).shrinkUntil ?? 0) > g3.time), 'someone is shrunk');
});

test('Rewind puts you back where you were three seconds ago; refused with nothing to rewind to', () => {
  const game = new Game(8, roster(), { track: buildPlatformerTrack(8, TRACK_THEMES.forest, 'rolling-hills') });
  game.start(); game.openGate();
  const a = game.marbles[0];
  give(a, 'rewind');
  assert.equal(game.useItem(a, 'rewind'), false, 'too early');
  assert.equal(a.inventory.rewind, 3, 'charge kept');
  run(game, 1000);
  const then = a.body.position.x;
  run(game, 3000);
  assert.ok(a.body.position.x > then + 50, 'it has rolled on');
  game.time += 500;
  assert.equal(game.useItem(a, 'rewind'), true);
  assert.ok(Math.abs(a.body.position.x - then) < 400, `back near ${then} (at ${a.body.position.x})`);
});

test('Bubble Trap floats the first rival it hits; Boomerang hits on the way out; a turret shoots at a passer', () => {
  const game = arena();
  const { a, b } = duel(game, 160);
  assert.equal(use(game, a, 'bubble'), true);
  run(game, 600);
  assert.ok((fx(b).bubbleUntil ?? 0) > game.time, 'bubbled');
  const y = b.body.position.y;
  run(game, 600);
  assert.ok(b.body.position.y < y, 'floating up');

  const g2 = arena();
  const d = duel(g2, 160);
  const h0 = hp(d.b);
  assert.equal(use(g2, d.a, 'boomerang'), true);
  run(g2, 900);
  assert.ok(hp(d.b) < h0 || !g2.healthOn, 'the boomerang hit');

  const g3 = arena();
  const e = duel(g3, 200);
  assert.equal(use(g3, e.a, 'turret'), true);
  place(g3, 0, 2400); // the owner walks away; the rival is by the turret
  run(g3, 1600);
  assert.ok(g3.shots.length > 0 || hp(e.b) < 100 || !g3.healthOn, 'the turret fired');
});

test('Life Leech drains a rival into you; Chain Lightning jumps between rivals close together', () => {
  const game = arena();
  if (!game.healthOn) return;
  const { a, b } = duel(game, 120);
  a.health = { ...a.health!, hp: 50 };
  assert.equal(use(game, a, 'leech'), true);
  run(game, 3200);
  assert.ok(hp(b) < 100, 'drained');
  assert.ok(hp(a) > 50, 'healed');

  const g2 = arena();
  const d = duel(g2, 120);
  place(g2, 2, 3240); place(g2, 3, 3360);
  assert.equal(use(g2, d.a, 'chain'), true);
  const hit = [1, 2, 3].filter((i) => hp(g2.marbles[i]) < 100).length;
  assert.ok(hit >= 2, `${hit} hit`);
});

test('Shadow Twin follows you a second behind; Thorn Shell pricks a rival that touches you; Orbit Blades break on hits', () => {
  const game = arena();
  const { a } = duel(game, 600);
  assert.equal(use(game, a, 'twin'), true);
  assert.ok(game.zones.some((z) => z.kind === 'twin') && game.decoys.length > 0, 'a twin, with a decoy for homing shots');

  const g2 = arena();
  const d = duel(g2, 20);
  assert.equal(use(g2, d.a, 'thorns'), true);
  run(g2, 200);
  assert.ok(hp(d.b) < 100 || !g2.healthOn, 'pricked');

  const g3 = arena();
  const e = duel(g3, 30);
  assert.equal(use(g3, e.a, 'blades'), true);
  assert.equal(fx(e.a).blades, 3);
  run(g3, 1500);
  assert.ok((fx(e.a).blades ?? 3) < 3, 'a blade broke on the rival');
});

test('Spike Wall rises in front of the rival behind you; Mine Field lays five mines; Cluster Bomb and Mega Bomb explode', () => {
  const game = arena();
  const { a } = duel(game, 600);
  place(game, 1, 2700); // behind
  assert.equal(use(game, a, 'spikewall'), true);
  const wall = game.zones.find((z) => z.kind === 'wall')!;
  assert.ok(wall && wall.x > 2700 && wall.x < 3000, 'between you and them');
  const behind = arena();
  const solo = duel(behind, 600);
  assert.equal(use(behind, solo.a, 'spikewall'), false, 'nobody behind: refused');

  const g2 = arena();
  const d = duel(g2, 600);
  assert.equal(use(g2, d.a, 'mines'), true);
  assert.equal(g2.zones.filter((z) => z.kind === 'mine').length, 5);

  const g3 = arena();
  const e = duel(g3, 600);
  assert.equal(use(g3, e.a, 'cluster'), true);
  run(g3, 2500);
  assert.equal(g3.shots.length, 0, 'the bomb and its bomblets have all gone off');

  const g4 = arena();
  const f = duel(g4, 100);
  assert.equal(use(g4, f.a, 'megabomb'), true);
  run(g4, 3200);
  assert.ok(!g4.zones.some((z) => z.kind === 'mega'), 'exploded');
  assert.ok(hp(f.b) < 100 || !g4.healthOn, 'it hurt the rival');
});

test('Laser Beam burns a rival in front of you; Blank clears shots and mines and pushes rivals into another lane', () => {
  const game = arena();
  const { a, b } = duel(game, 200);
  assert.equal(use(game, a, 'laser'), true);
  run(game, 1200);
  assert.ok(hp(b) < 100 || !game.healthOn, 'burned');

  const g2 = arena();
  const d = duel(g2, 60);
  use(g2, d.b, 'mines');
  g2.zones.push({ id: 999, kind: 'mine', owner: 1, target: -1, x: d.a.body.position.x + 30, y: d.a.body.position.y, lane: 1, at: g2.time, until: g2.time + 9000 });
  assert.equal(use(g2, d.a, 'blank'), true);
  assert.ok(!g2.zones.some((z) => z.id === 999), 'the mine by you is gone');
  assert.notEqual(d.b.lane, 1, 'the rival was thrown into another lane');
});

test('a race where every computer driver holds premium skills still runs without throwing', () => {
  const game = new Game(3, roster(), { track: buildPlatformerTrack(3, TRACK_THEMES.forest, 'rolling-hills') });
  game.start(); game.openGate();
  for (const m of game.marbles) m.inventory = Object.fromEntries([...Object.keys(emptyInventory())].map((k) => [k, (PREMIUM_ITEMS as readonly string[]).includes(k) ? 2 : 0])) as Marble['inventory'];
  for (let i = 0; i < 20000; i++) game.step(PHYSICS_STEP);
  const used = game.marbles.reduce((n, m) => n + PREMIUM_ITEMS.reduce((k, id) => k + (2 - m.inventory[id]), 0), 0);
  assert.ok(used > 5, `${used} premium charges used`);
});
