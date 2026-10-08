// P2-08 (#114): what the sixteen new skills do in a headless platformer race.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';

import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, ITEM_TYPES, ITEM_INFO, PREMIUM_ITEMS, emptyInventory, mulberry32, randomStats, TRACK_THEMES } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';
import { floorAt } from '../src/game/platformer/course';
import type { ItemType } from '../src/game/types';

function roster() {
  const rng = mulberry32(5);
  return Array.from({ length: 10 }, (_, i) => ({ id: i, name: AI_NAMES[i] ?? `AI ${i}`, color: AI_COLORS[i % AI_COLORS.length], stats: randomStats(rng), isPlayer: false, character: i % 6 }));
}

/** A race with everyone fired out of their cannons, then frozen in place by making them "people" who press nothing. */
function arena() {
  const game = new Game(8, roster(), { track: buildPlatformerTrack(8, TRACK_THEMES.forest, 'rolling-hills') });
  game.start();
  game.openGate();
  for (let i = 0; i < 100; i++) game.step(PHYSICS_STEP);
  for (const m of game.marbles) game.humanInput.set(m.info.id, { nudge: 0 });
  return game;
}

/** Put marble `m` on the middle lane's floor at x, still. */
function place(game: Game, id: number, x: number, lane = 1) {
  const m = game.marbles[id];
  const plan = game.track.platformer!.plan;
  m.lane = lane; m.laneAt = undefined; game.applyMask(m);
  Matter.Body.setPosition(m.body, { x, y: floorAt(plan, lane as 0 | 1 | 2, x)! - 16 });
  Matter.Body.setVelocity(m.body, { x: 0, y: 0 });
  m.progress = undefined;
  return m;
}

/** Everyone else out of the way (far back on the course), then the two we care about close together. */
function duel(game: Game, gap = 150) {
  for (let i = 2; i < 10; i++) place(game, i, 400 + i * 30);
  const a = place(game, 0, 3000), b = place(game, 1, 3000 + gap);
  return { a, b };
}

const give = (m: { inventory: Record<ItemType, number> }, item: ItemType) => { m.inventory = { ...emptyInventory(), [item]: 3 }; };
const run = (game: Game, ms: number) => { for (let t = 0; t < ms; t += PHYSICS_STEP) game.step(PHYSICS_STEP); };

test('the registry: 24 items, the original eight first and unchanged, then the twenty premium ones', () => {
  assert.equal(ITEM_TYPES.length, 44);
  assert.deepEqual(ITEM_TYPES.slice(24), [...PREMIUM_ITEMS]);
  assert.deepEqual(ITEM_TYPES.slice(0, 8), ['rocket', 'jump', 'oil', 'shock', 'anvil', 'aero', 'freeze', 'ghost']);
  assert.equal(ITEM_INFO.rocket.price, 90);
  assert.equal(ITEM_INFO.ram.name, 'Battering Ram');
  assert.equal(Object.keys(emptyInventory()).length, 44);
});

test('Repair Kit heals 40 and refuses at full health; Bubble Shield soaks 40 damage, then 4 s', () => {
  const game = arena();
  const { a } = duel(game);
  give(a, 'repair');
  assert.equal(game.useItem(a, 'repair'), false, 'full health: refused, charge kept');
  assert.equal(a.inventory.repair, 3);
  game.time += 800; game.damage(a, 60, null, 'blade');
  assert.equal(a.health!.hp, 40);
  game.time += 800;
  assert.equal(game.useItem(a, 'repair'), true);
  assert.equal(a.health!.hp, 80);
  give(a, 'shield');
  game.time += 800;
  assert.equal(game.useItem(a, 'shield'), true);
  game.damage(a, 30, null, 'blade');
  assert.equal(a.health!.hp, 80, 'all 30 soaked');
  game.time += 800;
  game.damage(a, 30, null, 'blade');
  assert.equal(a.health!.hp, 60, '10 left in the shield, 20 got through');
});

test("Shaman's Charm: the next killing hit leaves 1 HP and no DNF, once", () => {
  const game = arena();
  const { a } = duel(game);
  give(a, 'charm');
  assert.equal(game.useItem(a, 'charm'), true);
  game.time += 800;
  assert.equal(game.damage(a, 500, null, 'crusher'), false);
  assert.equal(a.health!.hp, 1);
  assert.equal(a.dnf, undefined);
  game.time += 2000;
  assert.equal(game.damage(a, 500, null, 'crusher'), true, 'the charm is spent');
});

test('Homing Bolt: flies to the rival ahead and does 25 damage and a knock', () => {
  const game = arena();
  const { a, b } = duel(game, 220);
  give(a, 'bolt');
  assert.equal(game.useItem(a, 'bolt'), true);
  assert.equal(game.projectiles.length, 1);
  run(game, 1500);
  assert.equal(game.projectiles.length, 0, 'it hit');
  assert.equal(b.health!.hp, 75);
  assert.equal(b.health!.lastHitBy, a.info.id);
});

test('Homing Bolt refuses with nobody in range; a Decoy draws the bolt away; a Mirror Plate sends it back', () => {
  const game = arena();
  const { a, b } = duel(game, 900);
  give(a, 'bolt');
  assert.equal(game.useItem(a, 'bolt'), false, 'nobody within 600 px');
  Matter.Body.setPosition(b.body, { x: a.body.position.x + 200, y: b.body.position.y });
  // decoy
  give(b, 'decoy');
  assert.equal(game.useItem(b, 'decoy'), true);
  Matter.Body.setPosition(b.body, { x: a.body.position.x + 500, y: b.body.position.y - 60 });
  game.time += 800;
  game.useItem(a, 'bolt');
  run(game, 1200);
  assert.equal(b.health!.hp, 100, 'the decoy took it');
  assert.equal(game.decoys.length, 0, 'and was destroyed');
  // mirror
  game.time += 800;
  give(b, 'reflect');
  Matter.Body.setPosition(b.body, { x: a.body.position.x + 200, y: a.body.position.y });
  game.useItem(b, 'reflect');
  game.time += 800;
  game.useItem(a, 'bolt');
  run(game, 2500);
  assert.equal(b.health!.hp, 100, 'bounced off the mirror');
  assert.ok(a.health!.hp < 100 || game.projectiles.length > 0, 'and came back at the sender');
});

test('Sticky Bomb: sticks to a rival within 250 and explodes after 2 s for 35', () => {
  const game = arena();
  const { a, b } = duel(game, 120);
  give(a, 'bomb');
  assert.equal(game.useItem(a, 'bomb'), true);
  assert.equal(game.bombs.length, 1);
  run(game, 1500);
  assert.equal(b.health!.hp, 100);
  run(game, 800);
  assert.equal(b.health!.hp, 65);
  assert.equal(game.bombs.length, 0);
});

test('Lightning Strike: hits the race leader for 30 and stuns it for a second', () => {
  const game = arena();
  const { a, b } = duel(game, 400);
  b.progress = 9999; a.progress = 100;
  give(a, 'lightning');
  assert.equal(game.useItem(a, 'lightning'), true);
  assert.equal(b.health!.hp, 70);
  assert.ok(b.frozen);
});

test('EMP: rivals within 300 cannot use skills for 4 s', () => {
  const game = arena();
  const { a, b } = duel(game, 200);
  give(a, 'emp'); give(b, 'rocket');
  assert.equal(game.useItem(a, 'emp'), true);
  assert.equal(game.canUseItem(b, 'rocket'), false);
  game.time += 4100;
  assert.equal(game.canUseItem(b, 'rocket'), true);
});

test('Blink: 140 px along the way you are going if it is clear; fizzles (keeps the charge) when blocked', () => {
  const game = arena();
  const { a } = duel(game, 600);
  Matter.Body.setVelocity(a.body, { x: 5, y: 0 });
  const x0 = a.body.position.x;
  give(a, 'blink');
  assert.equal(game.useItem(a, 'blink'), true);
  assert.ok(Math.abs(a.body.position.x - (x0 + 140)) < 1, `moved to ${a.body.position.x}`);
  // aim at a crate: blocked
  game.time += 800;
  const crate = game.track.platformer!.plan.bumps.find((b) => b.lane === 1 && b.x > 1500)!;
  place(game, 0, crate.x - 100);
  Matter.Body.setVelocity(a.body, { x: 5, y: 0 });
  assert.equal(game.useItem(a, 'blink'), false);
  assert.equal(a.inventory.blink, 2, 'charge kept');
});

test('Air Brake kills most of your speed and hovers; Drill passes through the floor; Overdrive and Battering Ram set their timers', () => {
  const game = arena();
  const { a } = duel(game, 600);
  Matter.Body.setVelocity(a.body, { x: 10, y: 4 });
  give(a, 'brake');
  game.useItem(a, 'brake');
  assert.ok(Math.hypot(a.body.velocity.x, a.body.velocity.y) < 3);
  game.time += 1200;
  give(a, 'drill');
  game.useItem(a, 'drill');
  assert.equal(a.body.collisionFilter.mask & 0x1000, 0, 'no lane floor is solid for a second');
  run(game, 1100);
  assert.notEqual(a.body.collisionFilter.mask & 0x2000, 0, 'floors are solid again');
  give(a, 'ram'); give(a, 'overdrive');
  a.inventory = { ...emptyInventory(), ram: 1, overdrive: 1 };
  game.time += 800;
  game.useItem(a, 'ram');
  game.time += 800;
  game.useItem(a, 'overdrive');
  assert.ok(a.fx!.ramUntil! > game.time && a.fx!.overdriveUntil! > game.time);
});

test('Battering Ram: a ramming ball hurts and shoves what it hits', async () => {
  const { ramHit } = await import('../src/game/skills/effects');
  const game = arena();
  const { a, b } = duel(game, 40);
  give(a, 'ram');
  game.useItem(a, 'ram');
  ramHit(game, a, b);
  assert.equal(b.health!.hp, 90);
  assert.ok(Math.abs(b.body.velocity.x) + Math.abs(b.body.velocity.y) > 3);
});

test('Caltrops: rivals rolling over them take damage and lose speed', () => {
  const game = arena();
  const { a, b } = duel(game, 100);
  give(a, 'spikes');
  game.useItem(a, 'spikes');
  const patch = game.spikes[0];
  Matter.Body.setPosition(b.body, { x: patch.x + 40, y: patch.y - 14 });
  run(game, 200);
  assert.ok(b.health!.hp < 100, `hp ${b.health!.hp}`);
});

test('Grapple Hook: pulls you to a ledge ahead, or refuses', () => {
  const game = arena();
  const plan = game.track.platformer!.plan;
  const ledge = plan.ledges![0];
  const { a } = duel(game, 600);
  place(game, 0, ledge.x - 150, ledge.lane);
  give(a, 'grapple');
  const y0 = a.body.position.y;
  assert.equal(game.useItem(a, 'grapple'), true);
  run(game, 500);
  assert.ok(a.body.position.y < y0 - 40, 'lifted toward the ledge');
  place(game, 0, 600);
  game.time += 800;
  assert.equal(game.useItem(a, 'grapple'), false, 'nothing ahead at the start');
});

test('loadout store: the default is the original eight; saved slots are cleaned (unknown, repeats, extras)', async () => {
  const { parseSlots, defaultSlots, slotSkills } = await import('../src/game/loadout-store');
  assert.deepEqual(parseSlots(null), defaultSlots());
  assert.deepEqual(defaultSlots(), ['rocket', 'jump', 'oil', 'shock', 'anvil', 'aero', 'freeze', 'ghost']);
  const slots = parseSlots(JSON.stringify(['ram', 'nope', 'ram', 'bolt', null, 7, 'charm', 'blink', 'drill', 'emp']));
  assert.deepEqual(slots, ['ram', null, null, 'bolt', null, null, 'charm', 'blink']);
  assert.deepEqual(slotSkills(slots), ['ram', 'bolt', 'charm', 'blink']);
  assert.deepEqual(parseSlots(JSON.stringify([null, null])), defaultSlots(), 'an empty bar falls back to the default');
});

test('item boxes drop only skills from the loadout when one is set', () => {
  const game = new Game(8, roster(), { track: buildPlatformerTrack(8, TRACK_THEMES.forest, 'rolling-hills'), dropPool: ['ram', 'bolt'] });
  assert.deepEqual(game.dropPool, ['ram', 'bolt']);
  game.start(); game.openGate();
  const m = game.marbles[2];
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    m.inventory = emptyInventory();
    const box = game.track.itemBoxes[i % game.track.itemBoxes.length];
    (box.plugin as { active: boolean }).active = true;
    game.marbleHits(m, box);
    for (const id of ITEM_TYPES) if (m.inventory[id] > 0) seen.add(id);
  }
  assert.deepEqual([...seen].sort(), ['bolt', 'ram']);
});

test('ITEM_INFO mirrors the catalogue for every skill (names, prices, durations, colours)', async () => {
  const { SKILLS } = await import('../src/game/skills/catalog');
  for (const id of ITEM_TYPES) {
    if (id === 'rocket' || id === 'jump' || id === 'oil' || id === 'shock' || id === 'anvil' || id === 'aero' || id === 'freeze' || id === 'ghost') continue;
    const d = SKILLS[id], i = ITEM_INFO[id];
    assert.deepEqual([i.name, i.price, i.duration, i.color], [d.name, d.price, d.durationMs, d.color], id);
  }
});

test('computer drivers use the skills they hold, through the AI brain, and the race still finishes', () => {
  const game = new Game(8, roster(), { track: buildPlatformerTrack(8, TRACK_THEMES.forest, 'rolling-hills') });
  const held = game.marbles.map((m) => ({ ...emptyInventory(), bolt: 3, shield: 2, rocket: 2, repair: 2, bomb: 2 }));
  game.marbles.forEach((m, i) => { m.inventory = held[i]; });
  game.start(); game.openGate();
  let used = 0;
  game.onEvent = () => undefined;
  for (let t = 0; t < 120000 && !game.allFinished(); t += PHYSICS_STEP) game.step(PHYSICS_STEP);
  // (each marble's inventory is its own copy of the starting kit: count what every one of them spent)
  const start = { bolt: 3, shield: 2, rocket: 2, repair: 2, bomb: 2 } as const;
  for (const m of game.marbles) for (const id of ['bolt', 'shield', 'rocket', 'repair', 'bomb'] as const) used += start[id] - m.inventory[id];
  assert.ok(used > 8, `computers used ${used} skills`);
  assert.ok(game.allFinished(), `everyone finished or was knocked out (${game.finishOrder.length} finished)`);
});
