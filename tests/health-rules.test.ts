// P2-07 (#113) battle tests, job ALPHA: the pure health rules in src/game/health.ts.
// Standalone: imports only the module under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_HP, REGEN_PER_SEC, REGEN_DELAY_MS, KO_WINDOW_MS, BUMP_WINDOW_MS, CHARM_INVULN_MS,
  DAMAGE, KO_BOUNTY, KO_XP, KO_POINTS,
  newHealth, applyDamage, recordBump, regen, koCredit, shamanFee,
} from '../src/game/health';

test('constants match the design', () => {
  assert.equal(MAX_HP, 100);
  assert.equal(REGEN_PER_SEC, 3);
  assert.equal(REGEN_DELAY_MS, 5000);
  assert.equal(KO_WINDOW_MS, 4000);
  assert.equal(BUMP_WINDOW_MS, 2000);
  assert.equal(CHARM_INVULN_MS, 1500);
  assert.deepEqual(DAMAGE, { blade: 20, saw: 25, mace: 20, wrecker: 25, boulder: 30, crusher: 60, bolt: 25, bomb: 35, lightning: 30, spikes: 8, shock: 10, ram: 10 });
  assert.equal(KO_BOUNTY, 75);
  assert.equal(KO_XP, 50);
  assert.equal(KO_POINTS, 2);
});

test('newHealth: full HP, alive, nobody to blame', () => {
  assert.deepEqual(newHealth(), { hp: 100, lastHitAt: -Infinity, lastHitBy: null, lastBumpAt: -Infinity, lastBumpedBy: null, invulnUntil: -Infinity, dnf: false });
});

test('applyDamage: takes HP, remembers when and who, never mutates the input', () => {
  const h = newHealth();
  const r = applyDamage(h, 25, 1000, 3);
  assert.equal(r.health.hp, 75);
  assert.equal(r.health.lastHitAt, 1000);
  assert.equal(r.health.lastHitBy, 3);
  assert.equal(r.died, false);
  assert.equal(r.saved, false);
  assert.equal(h.hp, 100, 'input untouched');
});

test('applyDamage: a hazard hit (no attacker) keeps the last attacker on record', () => {
  let h = applyDamage(newHealth(), 10, 1000, 4).health;
  h = applyDamage(h, 10, 1500, null).health;
  assert.equal(h.lastHitBy, 4);
  assert.equal(h.lastHitAt, 1500);
});

test('applyDamage: reaching 0 HP is a DNF (died), HP never goes below 0', () => {
  const r = applyDamage(applyDamage(newHealth(), 90, 0, null).health, 30, 100, 2);
  assert.equal(r.health.hp, 0);
  assert.equal(r.health.dnf, true);
  assert.equal(r.died, true);
});

test("applyDamage: Shaman's Charm saves you once: 1 HP and a short invulnerability", () => {
  const r = applyDamage(applyDamage(newHealth(), 90, 0, null).health, 30, 100, 2, { charm: true });
  assert.equal(r.died, false);
  assert.equal(r.saved, true);
  assert.equal(r.health.hp, 1);
  assert.equal(r.health.dnf, false);
  assert.equal(r.health.invulnUntil, 100 + CHARM_INVULN_MS);
});

test('applyDamage: no damage while invulnerable, or once DNF', () => {
  const saved = applyDamage({ ...newHealth(), hp: 5 }, 30, 0, 1, { charm: true }).health;
  const during = applyDamage(saved, 50, 500, 1);
  assert.equal(during.health.hp, 1, 'invulnerable');
  assert.equal(during.died, false);
  const dead = applyDamage(newHealth(), 200, 0, null).health;
  const again = applyDamage(dead, 10, 10, null);
  assert.equal(again.died, false, 'already out: no second death');
  assert.equal(again.health.hp, 0);
});

test('regen: nothing for 5 s after a hit, then +3 HP per second, capped at 100', () => {
  const hit = applyDamage(newHealth(), 50, 0, null).health; // hp 50 at t=0
  assert.equal(regen(hit, 4999, 1000).hp, 50, 'too soon');
  assert.equal(regen(hit, 5000, 1000).hp, 53);
  assert.equal(regen({ ...hit, hp: 99.5 }, 9000, 1000).hp, 100);
  const dead = applyDamage(newHealth(), 200, 0, null).health;
  assert.equal(regen(dead, 99999, 1000).hp, 0, 'no regen once DNF');
});

test('koCredit: the last attacker within 4 s', () => {
  const h = applyDamage(newHealth(), 10, 1000, 6).health;
  assert.equal(koCredit(h, 1000 + KO_WINDOW_MS), 6);
  assert.equal(koCredit(h, 1000 + KO_WINDOW_MS + 1), null);
});

test('koCredit: knocked into a hazard: the rival who bumped you within 2 s', () => {
  let h = recordBump(newHealth(), 8, 2000);
  h = applyDamage(h, 60, 2500, null).health; // crusher, no attacker
  assert.equal(koCredit(h, 2500), 8);
  assert.equal(koCredit(recordBump(newHealth(), 8, 2000), 2000 + BUMP_WINDOW_MS + 1), null);
});

test('koCredit: a recent attacker beats an older bump; nobody to credit = null', () => {
  let h = recordBump(newHealth(), 8, 1000);
  h = applyDamage(h, 10, 1500, 3).health;
  assert.equal(koCredit(h, 1600), 3);
  assert.equal(koCredit(newHealth(), 0), null);
});

test("shamanFee: championship and story charge 30 % (min 250); can't pay = he takes 2 charges", () => {
  assert.deepEqual(shamanFee('championship', 2000), { due: 600, fee: 600, short: false, takeCharges: 0 });
  assert.deepEqual(shamanFee('story', 500), { due: 250, fee: 250, short: false, takeCharges: 0 });
  assert.deepEqual(shamanFee('championship', 100), { due: 250, fee: 100, short: true, takeCharges: 2 });
});

test('shamanFee: quick race 10 % (min 50), never takes charges; online is free', () => {
  assert.deepEqual(shamanFee('quick', 1000), { due: 100, fee: 100, short: false, takeCharges: 0 });
  assert.deepEqual(shamanFee('quick', 20), { due: 50, fee: 20, short: true, takeCharges: 0 });
  assert.deepEqual(shamanFee('online', 5000), { due: 0, fee: 0, short: false, takeCharges: 0 });
});
