// #99 — the vortex funnel teleport.
//
// With two or more funnels on the track, a marble swallowed by one pours out beneath a random
// OTHER funnel (never the one that swallowed it). With a single funnel the behavior is exactly
// what it has always been: the swirl carries the marble to the centre and it drops through its
// own hole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
const { Body } = Matter;
import type { TrackDef } from '../src/game/trackdef';
import { Game } from '../src/game/engine';
import { AI_COLORS, mulberry32, randomStats } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';

const roster = (seed = 1): MarbleInfo[] => {
  const rng = mulberry32(seed);
  return Array.from({ length: 10 }, (_, id) => ({
    id,
    name: `M${id}`,
    color: AI_COLORS[id % AI_COLORS.length],
    stats: randomStats(rng),
    isPlayer: false,
  }));
};

const height = 2400;

function startGame(def: TrackDef, seed: number): { game: Game; m: Game['marbles'][number] } {
  const game = new Game(seed, roster(seed), { def, recovery: false, effects: false, aiItems: false, wireEvents: false });
  game.openGate();
  const m = game.marbles[0];
  // park the rest of the field so only the probe marble matters
  for (const s of game.marbles.slice(1)) s.finishedAt = 1;
  return { game, m };
}

test('#99: a marble swallowed by one of two vortices pours out the other one', () => {
  const def = {
    v: 1, name: 'two funnels', seed: 4, theme: 'classic', height,
    pieces: [
      { t: 'vortex', x: 200, y: 400, r: 140, spin: 1.5, hole: 30 },
      { t: 'vortex', x: 700, y: 400, r: 140, spin: 1.5, hole: 30 },
    ],
  } as unknown as TrackDef;
  const { game, m } = startGame(def, 12);
  try {
    Body.setPosition(m.body, { x: 212, y: 406 }); // just inside funnel A's hole rim
    Body.setVelocity(m.body, { x: 0, y: 4 });
    for (let i = 0; i < 30; i++) game.step(1000 / 60);
    assert.ok(Math.abs(m.body.position.x - 700) < 30,
      `marble must exit below the OTHER funnel (x=${m.body.position.x.toFixed(0)}, expected ≈700)`);
    assert.ok(m.body.position.y > 400 + 140,
      `marble should pour out beneath the reaching funnel's rim (y=${m.body.position.y.toFixed(0)})`);
  } finally {
    game.destroy();
  }
});

test('#99: a single vortex keeps its swirl-and-drop-through behaviour', () => {
  const def = {
    v: 1, name: 'lone funnel', seed: 4, theme: 'classic', height,
    pieces: [
      { t: 'vortex', x: 200, y: 400, r: 140, spin: 1.5, hole: 30 },
    ],
  } as unknown as TrackDef;
  const { game, m } = startGame(def, 12);
  try {
    Body.setPosition(m.body, { x: 212, y: 406 }); // just inside the only hole rim
    Body.setVelocity(m.body, { x: 0, y: 4 });
    for (let i = 0; i < 30; i++) game.step(1000 / 60);
    assert.ok(Math.abs(m.body.position.x - 200) < 30,
      `a lone funnel keeps dropping marbles straight down its own hole (x=${m.body.position.x.toFixed(0)})`);
    assert.ok(m.body.position.y > 400 + 140, `marble should exit beneath the funnel (y=${m.body.position.y.toFixed(0)})`);
  } finally {
    game.destroy();
  }
});

test('#99: with three funnels the destination is never the funnel that swallowed the marble', () => {
  const def = {
    v: 1, name: 'three funnels', seed: 4, theme: 'classic', height,
    pieces: [
      { t: 'vortex', x: 150, y: 400, r: 120, spin: 1.5, hole: 30 },
      { t: 'vortex', x: 450, y: 400, r: 120, spin: 1.5, hole: 30 },
      { t: 'vortex', x: 750, y: 400, r: 120, spin: 1.5, hole: 30 },
    ],
  } as unknown as TrackDef;
  // Try several seeds: wherever the marble goes, it must be one of the other two funnels' exits.
  for (const seed of [12, 34, 56, 78, 90]) {
    const { game, m } = startGame(def, seed);
    try {
      Body.setPosition(m.body, { x: 162, y: 406 });
      Body.setVelocity(m.body, { x: 0, y: 4 });
      for (let i = 0; i < 30; i++) game.step(1000 / 60);
      const exits = [450, 750];
      assert.ok(exits.some((x) => Math.abs(m.body.position.x - x) < 30),
        `seed ${seed}: marble exited at x=${m.body.position.x.toFixed(0)} — not one of the other funnels`);
    } finally {
      game.destroy();
    }
  }
});
