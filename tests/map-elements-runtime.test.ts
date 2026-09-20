import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { PALETTE } from '../src/components/editor/palette';
import { defaultPiece } from '../src/components/editor/defaults';
import type { Piece, TrackDef } from '../src/game/trackdef';
import { placementPieces } from '../src/components/editor/ghost';
import { W } from '../src/game/track';
import { validateStatic } from '../src/components/editor/validate';

test('Workshop loop route carries light and heavy marbles over the top and out in both directions', () => {
  for (const flip of [false, true]) for (const weight of [2, 5, 9]) {
    const pieces = placementPieces('loop', { x: 470, y: 1500 }, false)!.map(p => ({ ...p, flip }));
    const def: TrackDef = { v: 1, seed: 19, name: 'Loop route', theme: 'classic', height: 4000, pieces };
    assert.ok(!validateStatic(def).some(issue => issue.message.includes('no entry ramp found')));
    assert.ok(validateStatic({ ...def, pieces: [pieces[0]] }).some(issue => issue.message.includes('no entry ramp found')));
    const game = new Game(19, [{ id: 0, name: 'Probe', color: '#fff', isPlayer: true, stats: { weight, speed: 5, bounce: 5 } }], {
      def, recovery: false, effects: false, aiItems: false, wireEvents: true,
    });
    try {
      assert.equal(game.trackDefError, null);
      game.openGate();
      const marble = game.player;
      // Drop from rest onto the high end, with no external launch or recovery.
      Matter.Body.setPosition(marble.body, { x: flip ? W - 30 : 30, y: 1140 });
      Matter.Body.setVelocity(marble.body, { x: 0, y: 0 });
      let crossedTop = false, exited = false;
      for (let step = 0; step < 1200; step++) {
        game.step(PHYSICS_STEP);
        crossedTop ||= marble.loopStage === 1 && marble.body.position.y < 1350;
        if (crossedTop && marble.loopStage === 0 && (flip ? marble.body.position.x < 250 : marble.body.position.x > 650)) {
          exited = true;
          break;
        }
      }
      assert.ok(crossedTop, `weight ${weight}, flip ${flip}: never reached the top`);
      assert.ok(exited, `weight ${weight}, flip ${flip}: never cleared the exit`);
      assert.equal(marble.recoveries, 0);
    } finally { game.destroy(); }
  }
});

// Every new palette variant receives a live physics safety probe. Behavioural
// assertions for launchers/fields/set pieces also live in their proving grounds.
for (const tile of PALETTE.slice(4).flatMap(g => g.tiles)) {
  test(`Runtime safety: ${tile.id} stays finite under light and heavy marble impacts`, () => {
    for (const flip of [false, true]) {
      const piece = { ...defaultPiece(tile.t, { x: 450, y: 1500 }, true), ...tile.preset, flip } as Piece;
      const def: TrackDef = { v: 1, seed: 19, name: tile.id, theme: 'classic', height: 4000, pieces: [piece] };
      const game = new Game(19, [2, 5, 9].map((weight, id) => ({ id, name: `Probe ${id}`, color: '#fff', isPlayer: false, stats: { weight, speed: 5, bounce: 10 - weight } })), { def, recovery: false, effects: false, aiItems: false, wireEvents: true });
      try {
        assert.equal(game.trackDefError, null);
        game.openGate();
        game.marbles.forEach((m, i) => {
          Matter.Body.setPosition(m.body, { x: 410 + i * 40, y: 1270 - i * 50 });
          Matter.Body.setVelocity(m.body, { x: (i - 1) * 4, y: 5 });
        });
        for (let frame = 0; frame < 1200; frame++) {
          game.step(PHYSICS_STEP);
          for (const m of game.marbles) {
            assert.ok([m.body.position.x, m.body.position.y, m.body.velocity.x, m.body.velocity.y].every(Number.isFinite), `${tile.id}: non-finite marble state`);
          }
          for (const b of game.track.bodies) assert.ok([b.position.x, b.position.y, b.angle].every(Number.isFinite), `${tile.id}: non-finite obstacle`);
        }
      } finally { game.destroy(); }
    }
  });
}

function singlePieceGame(piece: Piece) {
  return new Game(23, [{ id: 0, name: 'Probe', color: '#fff', isPlayer: true, stats: { weight: 9, speed: 3, bounce: 3 } }], {
    def: { v: 1, name: 'Interaction probe', seed: 23, theme: 'classic', height: 4000, pieces: [piece] },
    recovery: false, effects: false, aiItems: false, wireEvents: true,
  });
}

for (const type of ['tunnel', 'screw', 'wheel'] as const) {
  test(`Interaction: ${type} captures and releases its passenger`, () => {
    const piece = defaultPiece(type, { x: 450, y: 1500 });
    const game = singlePieceGame(piece);
    try {
      game.openGate();
      Matter.Body.setPosition(game.player.body, { x: type === 'wheel' ? 560 : 450, y: 1500 });
      Matter.Body.setVelocity(game.player.body, { x: 0, y: 0 });
      let caught = false, released = false;
      for (let frame = 0; frame < 3600; frame++) {
        game.step(PHYSICS_STEP);
        if (game.player.hold?.kind === type) caught = true;
        if (caught && !game.player.hold) { released = true; break; }
      }
      assert.ok(caught, `${type} never captured the marble`);
      assert.ok(released, `${type} never released the marble`);
      assert.equal(game.player.body.isSensor, false);
      assert.equal(game.player.recoveries, 0);
    } finally { game.destroy(); }
  });
}

for (const type of ['barricade', 'crumble'] as const) {
  test(`Interaction: ${type} takes damage from an impact`, () => {
    const game = singlePieceGame(defaultPiece(type, { x: 450, y: 1500 }));
    try {
      game.openGate();
      Matter.Body.setPosition(game.player.body, { x: 450, y: 1380 });
      Matter.Body.setVelocity(game.player.body, { x: 0, y: 12 });
      let damaged = false;
      for (let frame = 0; frame < 240; frame++) {
        game.step(PHYSICS_STEP);
        damaged ||= game.drainRaceEvents().some(e => e.kind === 'crate');
      }
      assert.ok(damaged, `${type} never registered an impact`);
    } finally { game.destroy(); }
  });
}

for (const type of ['trapdoor', 'blade', 'saw', 'crusher', 'boulder', 'mace', 'platform'] as const) {
  test(`Interaction: ${type} runs its movement cycle`, () => {
    const piece = defaultPiece(type, { x: 450, y: 1500 });
    // A default saw spins visually in place; give its slot a span to probe translation.
    const game = singlePieceGame(piece.t === 'saw' ? { ...piece, b: [600, 1500] } : piece);
    try {
      game.openGate();
      const pose = () => game.track.bodies.map(b => [b.position.x, b.position.y, b.angle]);
      const initial = JSON.stringify(pose());
      let moved = false;
      for (let frame = 0; frame < 720; frame++) {
        game.step(PHYSICS_STEP);
        moved ||= JSON.stringify(pose()) !== initial;
      }
      assert.ok(moved, `${type} remained stationary for six seconds`);
    } finally { game.destroy(); }
  });
}

test('Interaction: a loaded seesaw tips and publishes its first state update', () => {
  const game = singlePieceGame(defaultPiece('seesaw', { x: 450, y: 1500 }));
  try {
    game.openGate();
    Matter.Body.setPosition(game.player.body, { x: 530, y: 1480 });
    Matter.Body.setVelocity(game.player.body, { x: 0, y: 0 });
    let events = 0;
    for (let frame = 0; frame < 240; frame++) {
      game.step(PHYSICS_STEP);
      events += game.drainRaceEvents().filter(e => e.kind === 'seesaw').length;
    }
    assert.ok(events > 0, 'moving seesaw never published a state update for guests');
    assert.ok(events < 30, 'state updates must remain throttled');
  } finally { game.destroy(); }
});

test('Water-wheel speed and ride duration are independent, exact and shareable', async () => {
  const { encodeShareCode, decodeShareCode } = await import('../src/game/sharecode');
  for (const rpm of [1, 8]) {
    const base = defaultPiece('wheel', { x: 450, y: 1500 });
    assert.ok(base.t === 'wheel');
    const piece = { ...base, rpm, rideMs: 1800 };
    const def: TrackDef = { v: 1, name: 'Timed wheel', seed: 23, theme: 'classic', height: 4000, pieces: [piece] };
    const decoded = await decodeShareCode(await encodeShareCode(def));
    assert.deepEqual(decoded.pieces[0], piece);
    const game = singlePieceGame(decoded.pieces[0]);
    try {
      game.openGate();
      Matter.Body.setPosition(game.player.body, { x: 560, y: 1500 });
      let capturedAt: number | undefined;
      let exit: { x: number; y: number } | undefined;
      for (let frame = 0; frame < 360; frame++) {
        game.step(PHYSICS_STEP);
        if (capturedAt === undefined && game.player.hold?.kind === 'wheel') {
          capturedAt = game.time;
          assert.ok(Math.abs(game.player.hold.until - game.time - 1800) < 0.01);
          exit = game.player.hold.exit;
        }
        if (capturedAt !== undefined && !game.player.hold) {
          assert.ok(Math.abs(game.time - capturedAt - 1800) <= PHYSICS_STEP + 0.01);
          assert.ok(Math.hypot(game.player.body.position.x - exit!.x, game.player.body.position.y - exit!.y) < 20);
          break;
        }
      }
      assert.ok(capturedAt !== undefined);
      assert.equal(game.player.hold, null);
    } finally { game.destroy(); }
  }
  const legacy = await decodeShareCode('1-eJzj8UlNT0yuVCjPSE3NYWRcIM_AKMVwiPkOdx7bGiaGFVvYGACvJAmj');
  assert.equal(legacy.pieces[0].t, 'wheel');
  assert.ok(legacy.pieces[0].t === 'wheel' && !legacy.pieces[0].rideMs);
});

test('Crumbling wall gaps pass marbles through without invisible collision blocks', async () => {
  const { meta } = await import('../src/game/track');
  const game = singlePieceGame({ t: 'crumble', x: 450, y: 1500, w: 120, h: 220, tough: 6 });
  try {
    game.openGate();
    const bricks = game.track.bodies.filter(b => meta(b).kind === 'crumble');
    assert.equal(bricks.length, 40);
    for (const brick of bricks) if (meta(brick).crumbleTile!.row < 4) game.destroyBody(game.track.bodies.indexOf(brick));
    assert.equal(bricks.filter(b => meta(b).destroyed).length, 16);
    Matter.Body.setPosition(game.player.body, { x: 365, y: 1420 });
    Matter.Body.setVelocity(game.player.body, { x: 12, y: 0 });
    let farthest = 0;
    for (let frame = 0; frame < 60; frame++) {
      game.step(PHYSICS_STEP);
      farthest = Math.max(farthest, game.player.body.position.x);
    }
    assert.ok(farthest > 535, `marble stopped at an empty brick: x=${farthest}`);
    assert.equal(game.player.recoveries, 0);
  } finally { game.destroy(); }
});
