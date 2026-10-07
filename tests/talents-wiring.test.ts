// P2-17: talents in the game — the account, the engine hook points, and the purse. P2-20: the Driver tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';

import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, emptyInventory, mulberry32, randomStats, TRACK_THEMES, ITEM_TYPES } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';
import { floorAt } from '../src/game/platformer/course';
import { createAccount, awardRaceXp, freeTalentPoints, setTalents, respec, settleRace, parseAccount } from '../src/game/economy';
import { talentEffects } from '../src/game/talents';
import { totalXpForLevel } from '../src/game/progression';

function roster() {
  const rng = mulberry32(3);
  return Array.from({ length: 10 }, (_, i) => ({ id: i, name: AI_NAMES[i] ?? `AI ${i}`, color: AI_COLORS[i % AI_COLORS.length], stats: randomStats(rng), isPlayer: i === 0, character: i % 6 }));
}
const raceWith = (talents: Record<string, number>, slots: (string | null)[] = []) =>
  new Game(2, roster(), { track: buildPlatformerTrack(2, TRACK_THEMES.forest, 'rolling-hills'), talents, slots: slots as never });
const level = (xp: number) => awardRaceXp(createAccount(), 'x', xp).account;

test('the account: points come from levels, a build is validated and saved, the first respec is free', () => {
  let acc = level(1526); // level 5: 4 points
  assert.equal(freeTalentPoints(acc), 4);
  acc = setTalents(acc, { 'heat-sink': 3, coolant: 1, turbo: 5 });
  assert.deepEqual(acc.talents, { 'heat-sink': 3, coolant: 1 }, 'turbo is a tier 2 talent: it needs level 6');
  assert.equal(freeTalentPoints(acc), 0);
  const back = parseAccount(JSON.stringify(acc));
  assert.deepEqual(back.talents, acc.talents);
  const r1 = respec(acc);
  assert.equal(r1.ok, true); assert.equal(r1.cost, 0); assert.deepEqual(r1.account.talents, {});
  const again = respec({ ...r1.account, credits: 100 });
  assert.equal(again.ok, false, 'the second respec costs 500');
  assert.equal(respec({ ...r1.account, credits: 900 }).account.credits, 400);
});

test('Chassis: Plating raises max HP, Padding takes a share off every hit, Iron Belly eats the first hazard hit', () => {
  const g = raceWith({ plating: 3, bulwark: 2, padding: 3, 'iron-belly': 1 });
  const p = g.player;
  assert.equal(p.maxHp, 150);
  assert.equal(p.health!.hp, 150);
  g.start(); g.openGate();
  assert.equal(g.damage(p, 50, null, 'wrecker'), false);
  assert.equal(p.health!.hp, 150, 'the first hazard hit does nothing');
  g.time += 800;
  g.damage(p, 50, null, 'wrecker');
  assert.equal(p.health!.hp, 150 - Math.round(50 * 0.88), 'then 12 % less damage');
  g.time += 800;
  g.damage(p, 50, 3, 'bolt');
  assert.equal(p.health!.hp, 150 - 2 * 44, 'a rival hit is reduced the same way');
});

test('Chassis: Mender and Patch-up bring health back sooner and faster', () => {
  const quick = raceWith({ 'patch-up': 3, mender: 3 }), plain = raceWith({});
  for (const g of [quick, plain]) { g.start(); g.openGate(); g.damage(g.player, 50, 3, 'bolt'); }
  // 5 s after the hit plain regen starts; patch-up x3 starts it at 2 s
  for (const g of [quick, plain]) for (let t = 0; t < 4000; t += PHYSICS_STEP) g.step(PHYSICS_STEP);
  assert.ok(quick.player.health!.hp > plain.player.health!.hp, `${quick.player.health!.hp} vs ${plain.player.health!.hp}`);
});

test('Engine: heat builds slower with Heat Sink, and Streamline raises the top speed', () => {
  const a = raceWith({ 'heat-sink': 3 }), b = raceWith({});
  for (const g of [a, b]) { g.start(); g.openGate(); g.engineHeld = true; g.nudge = 1; for (let t = 0; t < 2500; t += PHYSICS_STEP) g.step(PHYSICS_STEP); }
  assert.ok((a.player.engine?.heat ?? 0) < (b.player.engine?.heat ?? 1), 'cooler engine');
  assert.ok(raceWith({ heat: 0 as never }).speedLimit(raceWith({ heat: 0 as never }).player) > 0);
  const s = raceWith({ 'heat-sink': 1, streamline: 3 });
  assert.equal(Math.round(s.speedLimit(s.player) * 100), Math.round(raceWith({}).speedLimit(raceWith({}).player) * 1.06 * 100) || 0);
});

test('Arsenal: Sharpened adds offence damage; Stockpile adds a charge to your first offence skill', () => {
  const g = raceWith({ sharpened: 3 }, ['rocket', 'oil', 'bolt']);
  assert.equal(g.player.tfx!.offenceDamagePct, 18);
  const s = raceWith({ stockpile: 1, sharpened: 3, 'quick-fuse': 3, 'heavy-hitter': 3 }, ['rocket', 'bolt', 'oil']);
  assert.equal(s.player.inventory.bolt, 1, 'Stockpile adds one charge to the first offence skill on the bar (the build was validated when it was saved)');
});

test('Tactics: Lingering stretches skills, Quick Hands can keep the charge', () => {
  const g = raceWith({ lingering: 3 });
  g.start(); g.openGate();
  for (let i = 0; i < 100; i++) g.step(PHYSICS_STEP);
  const p = g.player;
  p.inventory = { ...emptyInventory(), shield: 2 };
  assert.equal(g.useItem(p, 'shield'), true);
  assert.ok(p.fx!.shieldUntil! - g.time > 4000 * 1.2, 'shield lasts 24 % longer');
  const q = raceWith({ 'quick-hands': 1 });
  q.start(); q.openGate();
  for (let i = 0; i < 100; i++) q.step(PHYSICS_STEP);
  let kept = 0;
  for (let n = 0; n < 60; n++) {
    q.player.inventory = { ...emptyInventory(), rocket: 1 };
    q.player.rocketUntil = 0; q.player.itemCooldownUntil = 0;
    q.useItem(q.player, 'rocket');
    if (q.player.inventory.rocket === 1) kept++;
  }
  assert.ok(kept > 2 && kept < 25, `about 15 % of 60 refunds, got ${kept}`);
});

test('Fortune: Sponsor, Peg Hunter, Haggler and Lucky Goblin act on the purse', () => {
  let acc = level(140372); // max level: 29 points
  acc = setTalents(acc, { sponsor: 3, 'peg-hunter': 3, haggler: 3, 'big-sponsor': 3, 'lucky-goblin': 0 });
  assert.equal(talentEffects(acc.talents!).prizePct, 30);
  const win = settleRace({ ...acc, credits: 1000 }, 'w', { id: 0, rank: 1, time: 40000, pegs: 10, dnf: false, kos: 0 }, 1, 'quick');
  assert.equal(win.payout.placement, 650, '500 + 30 %');
  assert.equal(win.payout.pegBonus, 65, '50 + 30 %');
  const out = settleRace({ ...acc, credits: 1000 }, 'd', { id: 0, rank: 10, time: null, pegs: 0, dnf: true, kos: 0 }, 1, 'quick');
  assert.equal(out.payout.shamanFee, Math.round(100 * 0.7), 'the Shaman charges 30 % less');
});

// ─── P2-20: the sixth tree, the DRIVER ────────────────────────────────────────

test('Driver: the tree gates like the others — tier levels 1/6/11/16 and 3 points below each tier', () => {
  // Level 5, 4 points: tier 1 open, tier 2 (level 6) not.
  let acc = level(1526);
  acc = setTalents(acc, { 'quick-reflexes': 3, 'steady-hands': 3 });
  assert.deepEqual(acc.talents, { 'quick-reflexes': 3 }, 'Steady Hands needs level 6');
  // Level 15: tiers 1-3 affordable, the tier-4 capstone still locked.
  let near = level(totalXpForLevel(15));
  near = setTalents(near, { 'quick-reflexes': 3, 'steady-hands': 3, 'second-wind': 3, 'lucky-draw': 1 });
  assert.equal(near.talents['lucky-draw'], undefined, 'Lucky Draw needs level 16 and 9 points below');
  assert.equal(pointsSpentGuard(near), 9, 'the three lower tiers are maxed');
  // Level 16: the capstone opens once 9 points sit below it.
  let rich = setTalents(level(totalXpForLevel(16)), { 'quick-reflexes': 3, 'steady-hands': 3, 'second-wind': 3, 'lucky-draw': 1 });
  assert.equal(rich.talents['lucky-draw'], 1, 'the capstone opens at level 16 with 9 points below');
  assert.equal(talentEffects(rich.talents).boxLuckPct, 15);
});

function pointsSpentGuard(acc: ReturnType<typeof createAccount>): number {
  return Object.values(acc.talents ?? {}).reduce((a, v) => a + v, 0);
}

test('Driver: Quick Reflexes ends a lane change sooner; without the talent the 750 ms window is untouched', async () => {
  const { switching } = await import('../src/game/engine/platformer');
  const quick = raceWith({ 'quick-reflexes': 3 }), plain = raceWith({});
  for (const g of [quick, plain]) { g.start(); g.player.laneAt = g.time; g.time += 600; }
  assert.equal(switching(quick, quick.player), false, 'rank 3 (-30 %) ends the change at 525 ms');
  assert.equal(switching(plain, plain.player), true, 'no talent: still mid-change at 600 of 750 ms');
});

test('Driver: Steady Hands keeps more roll speed through a hard landing', () => {
  const drop = (g: Game): number => {
    g.start(); g.openGate();
    for (let i = 0; i < 120; i++) g.step(PHYSICS_STEP); // out of the start cannons, as the arena tests do
    const plan = g.track.platformer!.plan;
    const floor = floorAt(plan, 1, 600);
    assert.ok(floor !== null, 'the rolling-hills middle lane has floor at x=600');
    const p = g.player;
    p.cannon = undefined; // the human's start cannon never fires itself — drop the marble free
    p.lane = 1; // the middle lane's floor is the one we aim at — take its mask, as place() does
    Matter.Body.setPosition(p.body, { x: 600, y: floor - 40 });
    Matter.Body.setVelocity(p.body, { x: 6, y: 6 });
    g.applyMask(p);
    // Read the roll speed exactly where Steady Hands works: as the first landing contact resolves.
    let atLanding: number | null = null;
    const contact = g.contactSurface.bind(g);
    (g as unknown as { contactSurface: typeof g.contactSurface }).contactSurface = (m, obstacle, pair, landing) => {
      const r = contact(m, obstacle, pair, landing);
      if (m === p && landing && atLanding === null) atLanding = m.body.velocity.x;
      return r;
    };
    for (let i = 0; i < 400 && atLanding === null; i++) g.step(PHYSICS_STEP);
    assert.ok(atLanding !== null, 'the marble landed');
    return atLanding;
  };
  const steady = drop(raceWith({ 'steady-hands': 3 }));
  const plain = drop(raceWith({}));
  assert.ok(steady > plain + 0.2, `steady hands kept more roll: ${steady.toFixed(2)} vs ${plain.toFixed(2)}`);
});

test('Driver: Second Wind brings health back sooner than the plain wait', () => {
  const quick = raceWith({ 'second-wind': 3 }), plain = raceWith({});
  for (const g of [quick, plain]) { g.start(); g.openGate(); g.damage(g.player, 50, 3, 'bolt'); }
  for (const g of [quick, plain]) for (let t = 0; t < 4000; t += PHYSICS_STEP) g.step(PHYSICS_STEP);
  assert.ok(quick.player.health!.hp > plain.player.health!.hp, `${quick.player.health!.hp} vs ${plain.player.health!.hp}`);
});

test('Driver: Lucky Draw can make an item box pay out twice', () => {
  // On a platformer course a box puts a trial skill in the Tab slot; Lucky Draw makes it two uses instead of one.
  const openOnce = (g: Game): number => {
    g.start(); g.openGate();
    const m = g.player;
    m.inventory = emptyInventory();
    const box = g.track.itemBoxes[0];
    (box.plugin as { active: boolean }).active = true;
    g.rng = () => 0; // pick index 0, then roll 0 — under any boxLuckPct, so the double fires
    g.marbleHits(m, box);
    assert.ok(m.pickup, 'the box filled the Tab slot');
    assert.equal(ITEM_TYPES.reduce((a, id) => a + m.inventory[id], 0), 0, 'and nothing went into your own skills');
    return m.pickupCharges ?? 1;
  };
  assert.equal(openOnce(raceWith({})), 1, 'no talent: one use per box');
  assert.equal(openOnce(raceWith({ 'lucky-draw': 1 })), 2, 'a 15 % roll doubles the box');
});
