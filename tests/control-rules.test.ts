// P2-01 (#107) battle tests, job ALPHA: the pure control rules in src/game/controls.ts.
// Standalone: imports only the module under test, so an Arena sandbox can run it as-is.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTROL_TUNING, nudgeOf, steerVelocity,
  newEngine, engineStep, engineThrust,
  newJump, jumpStep,
} from '../src/game/controls';

const T = CONTROL_TUNING;
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// ── nudgeOf (unchanged behaviour) ───────────────────────────────────────────
test('nudgeOf: touch wins, else right minus left', () => {
  assert.equal(nudgeOf({ left: true, right: false, touch: 0 }), -1);
  assert.equal(nudgeOf({ left: false, right: true, touch: 0 }), 1);
  assert.equal(nudgeOf({ left: true, right: true, touch: 0 }), 0);
  assert.equal(nudgeOf({ left: false, right: false, touch: 0 }), 0);
  assert.equal(nudgeOf({ left: true, right: false, touch: 1 }), 1);
});

// ── steering ────────────────────────────────────────────────────────────────
test('steer: no input leaves vx alone', () => {
  assert.equal(steerVelocity(3, 0, true, 1), 3);
});

test('steer: ground push is stronger than air push', () => {
  const ground = steerVelocity(0, 1, true, 1) - 0;
  const air = steerVelocity(0, 1, false, 1) - 0;
  assert.ok(near(ground, T.steerGround), `ground ${ground}`);
  assert.ok(near(air, T.steerAir), `air ${air}`);
  assert.ok(ground > air);
});

test('steer: scales with the step size s', () => {
  assert.ok(near(steerVelocity(0, -1, true, 2), -2 * T.steerGround));
});

test('steer: counter-steer (pushing against your motion) is boosted', () => {
  const against = steerVelocity(5, -1, true, 1) - 5; // moving right, pushing left
  assert.ok(near(against, -T.steerGround * T.counterSteerBoost), `against ${against}`);
});

test('steer: never pushes past maxSteerVx in the pushed direction', () => {
  assert.equal(steerVelocity(T.maxSteerVx, 1, true, 1), T.maxSteerVx, 'already at the cap: no more push');
  assert.equal(steerVelocity(T.maxSteerVx - 0.01, 1, true, 1), T.maxSteerVx, 'clamped to the cap');
  assert.equal(steerVelocity(T.maxSteerVx + 4, 1, true, 1), T.maxSteerVx + 4, 'faster than the cap (from a slope): steering does not slow you');
  assert.ok(steerVelocity(T.maxSteerVx + 4, -1, true, 1) < T.maxSteerVx + 4, 'but you can always steer against it');
});

// ── Magic Engine heat ───────────────────────────────────────────────────────
test('engine: fires while held, heats up, cools when released', () => {
  let e = newEngine();
  assert.equal(e.heat, 0);
  let r = engineStep(e, true, 0, 1000);
  assert.equal(r.firing, true);
  assert.ok(near(r.state.heat, 1000 * T.engineHeatPerMs), `heat ${r.state.heat}`);
  e = r.state;
  r = engineStep(e, false, 1000, 500);
  assert.equal(r.firing, false);
  assert.ok(near(r.state.heat, Math.max(0, e.heat - 500 * T.engineCoolPerMs)));
});

test('engine: about 3 s of holding overheats it, then it is locked for overheatLockMs', () => {
  let e = newEngine();
  let now = 0;
  let firing = true;
  for (let i = 0; i < 400 && firing; i++) { const r = engineStep(e, true, now, 10); e = r.state; firing = r.firing; now += 10; }
  assert.equal(firing, false, 'it overheated');
  assert.ok(now >= 2900 && now <= 3100, `overheated after ${now} ms`);
  assert.ok(e.lockedUntil >= now - 10 + T.overheatLockMs - 10, 'locked out');
  const during = engineStep(e, true, now + T.overheatLockMs / 2, 10);
  assert.equal(during.firing, false, 'still locked while held');
  const after = engineStep(during.state, true, e.lockedUntil + 1, 10);
  assert.equal(after.firing, true, 'fires again after the lockout');
});

test('engine: heat never goes below 0 or above 1', () => {
  let e = newEngine();
  for (let i = 0; i < 100; i++) e = engineStep(e, false, i * 50, 50).state;
  assert.equal(e.heat, 0);
  e = engineStep(newEngine(), true, 0, 999999).state;
  assert.ok(e.heat <= 1);
});

test('engineThrust: pushes along the direction of travel', () => {
  const t = engineThrust(3, 4, true, 1); // moving (0.6, 0.8)
  assert.ok(near(t.x, 0.6 * T.engineThrust) && near(t.y, 0.8 * T.engineThrust), JSON.stringify(t));
});

test('engineThrust: straight down when nearly stopped; nothing when not firing', () => {
  const slow = engineThrust(0.1, 0, true, 1);
  assert.ok(near(slow.x, 0) && near(slow.y, T.engineThrust), JSON.stringify(slow));
  assert.deepEqual(engineThrust(3, 4, false, 1), { x: 0, y: 0 });
  const twice = engineThrust(3, 4, true, 2);
  assert.ok(near(twice.x, 1.2 * T.engineThrust));
});

// ── core jump: coyote time, input buffer, cooldown ──────────────────────────
test('jump: pressing on the ground jumps', () => {
  const r = jumpStep(newJump(), 1000, true, true);
  assert.equal(r.jump, true);
});

test('jump: no jump in mid-air after coyote time', () => {
  let s = jumpStep(newJump(), 1000, true, false).state;   // on the ground at t=1000
  const late = jumpStep(s, 1000 + T.coyoteMs + 1, false, true);
  assert.equal(late.jump, false);
  s = jumpStep(newJump(), 1000, true, false).state;
  const coyote = jumpStep(s, 1000 + T.coyoteMs - 1, false, true);
  assert.equal(coyote.jump, true, 'just after leaving a ledge still counts');
});

test('jump: a press just before landing is buffered and fires on landing', () => {
  let s = jumpStep(newJump(), 1000, false, true).state;   // pressed in the air, too late for coyote
  const land = jumpStep(s, 1000 + T.jumpBufferMs - 1, true, false);
  assert.equal(land.jump, true, 'buffered press fires on landing');
  s = jumpStep(newJump(), 1000, false, true).state;
  const tooLate = jumpStep(s, 1000 + T.jumpBufferMs + 1, true, false);
  assert.equal(tooLate.jump, false, 'an old press is forgotten');
});

test('jump: cooldown between jumps, and one press gives one jump', () => {
  let r = jumpStep(newJump(), 1000, true, true);
  assert.equal(r.jump, true);
  r = jumpStep(r.state, 1010, true, true);
  assert.equal(r.jump, false, 'cooldown');
  r = jumpStep(r.state, 1000 + T.jumpCooldownMs + 1, true, false);
  assert.equal(r.jump, false, 'no press, no jump');
  r = jumpStep(r.state, 1000 + T.jumpCooldownMs + 2, true, true);
  assert.equal(r.jump, true, 'a new press after the cooldown jumps');
});

test('jump: jumpSpeed is upward (negative y velocity in a y-down world)', () => {
  assert.ok(T.jumpSpeed > 0, 'stored as a positive speed; the engine applies -jumpSpeed to vy');
});
