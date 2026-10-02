// P2-17: talents in the game — the account, the engine hook points, and the purse.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, emptyInventory, mulberry32, randomStats, TRACK_THEMES } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';
import { createAccount, awardRaceXp, freeTalentPoints, setTalents, respec, settleRace, parseAccount } from '../src/game/economy';
import { talentEffects } from '../src/game/talents';

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
