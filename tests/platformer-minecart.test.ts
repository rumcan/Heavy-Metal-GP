// Run with: node --import tsx --test tests/platformer-minecart.test.ts
// P2-26c: the minecart on a platformer course. It has a rail of its own (x, span); a marble that lands in it rides it
// across a chasm and rolls off on the far side; the rail survives a share code and old codes still read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { TRACK_THEMES } from '../src/game/types';
import { validateTrackDef } from '../src/game/trackdef';
import type { Piece } from '../src/game/trackdef';
import { decodeShareCode, encodeShareCode } from '../src/game/sharecode';
import { trackFromPlan } from '../src/game/platformer/build';
import { boardCart } from '../src/game/engine/holds';
import { meta } from '../src/game/track';
import { PF_START_END, PF_START_Y, newPlatformerDef, planFromTrackDef } from '../src/game/platformer/def';
import { setEditorWorld } from '../src/components/editor/world';
import { defaultPiece } from '../src/components/editor/defaults';

const Y = PF_START_Y;

/** Floor, a chasm from 3000 to 4000 on every lane, floor again, and a cart over the chasm. */
function chasmCourse() {
  const floors: Piece[] = [0, 1, 2].flatMap((lane) => [
    { t: 'ramp', a: [PF_START_END, Y], b: [3000, Y], lane } as Piece,
    { t: 'ramp', a: [4000, Y], b: [8000, Y], lane } as Piece,
  ]);
  const cart: Piece = { t: 'bucket', y: Y - 20, phase: 0, x: 3500, span: 450 };
  const check = validateTrackDef({ ...newPlatformerDef('Chasm', 8500), pieces: [...floors, cart] });
  assert.ok(check.ok, check.ok ? '' : check.error);
  return check.ok ? check.def : null!;
}

test('a cart placed in the platformer Workshop gets its own rail where you click', () => {
  setEditorWorld({ width: 12000 });
  const p = defaultPiece('bucket', { x: 3500, y: Y - 20 });
  assert.ok(p.t === 'bucket' && p.x === 3500 && p.span === 300);
  setEditorWorld(null);
  const classic = defaultPiece('bucket', { x: 300, y: 900 });
  assert.ok(classic.t === 'bucket' && classic.x === undefined, 'a drop-track cart still spans the shaft');
});

test('the rail survives a share code, and a code from before rails still reads', async () => {
  const def = chasmCourse();
  const back = await decodeShareCode(await encodeShareCode(def));
  const cart = back.pieces.find((p) => p.t === 'bucket');
  assert.ok(cart && cart.t === 'bucket' && cart.x === 3500 && cart.span === 450);
  const old = await decodeShareCode(await encodeShareCode({ ...def, mode: undefined, width: undefined, pieces: [{ t: 'bucket', y: 900, phase: 0.5 }] } as never));
  const oc = old.pieces[0];
  assert.ok(oc.t === 'bucket' && oc.x === undefined && oc.phase === 0.5);
});

test('a marble that lands in the cart rides it across the chasm and rolls off on the far side', () => {
  const def = chasmCourse();
  const track = trackFromPlan(planFromTrackDef(def), 1, TRACK_THEMES.forest);
  const cart = track.buckets[0];
  assert.ok(cart && meta(cart).cartX === 3500);
  const game = new Game(1, [{ id: 0, name: 'You', color: '#d63e2e', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: false, character: 0 }], { track, recovery: false, effects: false, aiItems: false });
  game.start();
  game.openGate();
  const m = game.marbles[0];
  // wait until the cart is near the near end, then drop the marble in
  for (let t = 0; t < 20000 && cart.position.x > 3150; t += PHYSICS_STEP) game.step(PHYSICS_STEP);
  boardCart(game, m, cart);
  assert.equal(m.hold?.kind, 'cart');
  let crossed = false;
  for (let t = 0; t < 6000; t += PHYSICS_STEP) {
    game.step(PHYSICS_STEP);
    if (!m.hold && m.body.position.x > 4000) { crossed = true; break; }
  }
  assert.ok(crossed, `the marble is at x ${Math.round(m.body.position.x)}`);
  for (let t = 0; t < 1500; t += PHYSICS_STEP) game.step(PHYSICS_STEP);
  assert.ok(m.body.position.x > 4000 && m.body.position.y < Y + 40, `rolling on the far floor at ${Math.round(m.body.position.x)}, ${Math.round(m.body.position.y)}`);
  assert.equal(meta(cart).cartRider, undefined, 'the cart is free again');
});
