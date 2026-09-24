/** Loop ride: touching the loop from any side captures the marble, spins it round and throws it out the opposite side. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { Game } from '../src/game/engine';
import { buildTrackFromDef } from '../src/game/trackdef';
import { blankTemplate } from '../src/game/templates';
import { PHYSICS_STEP } from '../src/game/physics';
import type { MarbleInfo } from '../src/game/types';

const R = 130, CX = 450, BOTTOM = 1600, CY = BOTTOM - R;
const driver: MarbleInfo = { id: 0, name: 'Tester', color: '#ff0000', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true } as MarbleInfo;

function ride(from: { x: number; y: number }, vel: { x: number; y: number }) {
  const track = buildTrackFromDef({ ...blankTemplate(), height: 3000, pieces: [{ t: 'loop', x: CX, bottom: BOTTOM, r: R }] });
  const game = new Game(1, [driver], { track, effects: false, aiItems: false, recovery: false });
  game.openGate();
  const m = game.player;
  Matter.Body.setPosition(m.body, from);
  Matter.Body.setVelocity(m.body, vel);
  let captured = false;
  for (let i = 0; i < 400; i++) {
    game.step(PHYSICS_STEP);
    if (m.hold) captured = true;
    if (captured && !m.hold) break;
  }
  const out = { captured, released: captured && !m.hold, pos: { ...m.body.position }, vel: { ...m.body.velocity } };
  game.destroy();
  return out;
}

for (const [name, from, vel, side] of [
  ['from the left', { x: CX - R - 40, y: CY }, { x: 8, y: 0 }, 'right'],
  ['from the right', { x: CX + R + 40, y: CY }, { x: -8, y: 0 }, 'left'],
  ['dropping in from above', { x: CX, y: CY - R - 40 }, { x: 0, y: 6 }, 'below'],
  ['slowly from below', { x: CX + 20, y: CY + R + 30 }, { x: 0, y: -3 }, 'above'],
] as const) {
  test(`loop ride: ${name} → out the ${side}, moving away`, () => {
    const r = ride(from, vel);
    assert.ok(r.captured, 'captured');
    assert.ok(r.released, 'released');
    const dx = r.pos.x - CX, dy = r.pos.y - CY;
    if (side === 'right') { assert.ok(dx > R, `x ${r.pos.x}`); assert.ok(r.vel.x > 3, `vx ${r.vel.x}`); }
    if (side === 'left') { assert.ok(dx < -R, `x ${r.pos.x}`); assert.ok(r.vel.x < -3, `vx ${r.vel.x}`); }
    if (side === 'below') { assert.ok(dy > R, `y ${r.pos.y}`); assert.ok(r.vel.y > 3, `vy ${r.vel.y}`); }
    if (side === 'above') { assert.ok(dy < -R, `y ${r.pos.y}`); assert.ok(r.vel.y < -3, `vy ${r.vel.y}`); }
  });
}
