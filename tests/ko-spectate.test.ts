// Run with: node --import tsx --test tests/ko-spectate.test.ts
// P2-07 (#113): once knocked out you watch the race (the camera on whoever did it for 3 s, then the leader); a KO is
// worth 2 championship points; the engine remembers who knocked a marble out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { SPECTATE_KILLER_MS, outMessage, spectateTarget } from '../src/game/spectate';
import { KO_POINTS, computeStandings, heatPoints, pointsFor } from '../src/game/season';
import type { SeasonState } from '../src/game/season';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, TRACK_THEMES, mulberry32, randomStats } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';

const order = (ids: [number, boolean][]) => ids.map(([id, racing]) => ({ id, racing }));

test('spectating: the killer for 3 s, then the leader', () => {
  const field = order([[4, true], [7, true], [2, true]]);
  assert.deepEqual(spectateTarget({ now: 1000, koAt: 1000, koBy: 7, order: field }), { follow: 7, onKiller: true });
  assert.deepEqual(spectateTarget({ now: 1000 + SPECTATE_KILLER_MS - 1, koAt: 1000, koBy: 7, order: field }), { follow: 7, onKiller: true });
  assert.deepEqual(spectateTarget({ now: 1000 + SPECTATE_KILLER_MS, koAt: 1000, koBy: 7, order: field }), { follow: 4, onKiller: false });
});

test('spectating: a hazard, a straggler cut or a killer who is out too goes straight to the leader', () => {
  const field = order([[4, false], [7, true], [2, true]]);
  assert.equal(spectateTarget({ now: 0, koAt: 0, koBy: -1, order: field }).follow, 7, 'the first one still racing leads');
  assert.equal(spectateTarget({ now: 0, koAt: 0, koBy: -2, order: field }).follow, 7);
  assert.equal(spectateTarget({ now: 0, koAt: 0, koBy: 4, order: field }).follow, 7, 'the killer has finished');
  assert.equal(spectateTarget({ now: 0, koAt: 0, koBy: 9, order: order([[1, false]]) }).follow, null, 'nobody left');
  assert.equal(outMessage(3, () => 'Big Grubba'), 'Knocked out by Big Grubba');
  assert.equal(outMessage(-1, () => ''), 'Knocked out');
  assert.match(outMessage(-2, () => ''), /behind/);
});

test('a KO is worth 2 championship points, even to a driver who did not finish', () => {
  assert.equal(KO_POINTS, 2);
  assert.equal(heatPoints({ time: 40000, rank: 1, kos: 0 }), pointsFor(1));
  assert.equal(heatPoints({ time: 40000, rank: 3, kos: 2 }), pointsFor(3) + 4);
  assert.equal(heatPoints({ time: null, rank: 9, kos: 1 }), 2);
  assert.equal(heatPoints({ time: null, rank: 10 }), 0);
  const season = {
    roster: [0, 1, 2].map((id) => ({ id })),
    results: [[[{ id: 0, rank: 1, time: 30000, pegs: 0, kos: 1 }, { id: 1, rank: 2, time: 31000, pegs: 0 }, { id: 2, rank: 3, time: null, pegs: 0, dnf: true, kos: 2 }]]],
    fastest: [null],
  } as unknown as SeasonState;
  const st = computeStandings(season);
  const by = (id: number) => st.find((s) => s.id === id)!;
  assert.equal(by(0).points, pointsFor(1) + 2);
  assert.equal(by(0).kos, 1);
  assert.equal(by(2).points, 4, 'two KOs and a DNF');
  assert.equal(by(2).kos, 2);
});

test('the engine remembers who knocked a marble out and when, and a straggler cut is told apart', () => {
  const rng = mulberry32(5);
  const roster: MarbleInfo[] = Array.from({ length: 3 }, (_, i) => ({ id: i, name: AI_NAMES[i], color: AI_COLORS[i], stats: randomStats(rng), isPlayer: i === 0, character: i }));
  const game = new Game(1, roster, { track: buildPlatformerTrack(1, TRACK_THEMES.forest, 'rolling-hills'), stragglerCut: { ms: 20_000, humans: true } });
  game.start();
  game.openGate();
  const victim = game.marbles[1];
  assert.ok(game.damage(victim, 1000, 2, 'wrecker'));
  assert.equal(victim.koBy, 2);
  assert.equal(victim.koAt, game.time);
  // the player never moves: once the third marble finishes, it is cut 20 s later
  Matter.Body.setStatic(game.player.body, true);
  for (let t = 0; t < 300_000 && !game.allFinished(); t += PHYSICS_STEP) game.step(PHYSICS_STEP);
  assert.ok(game.player.dnf);
  assert.equal(game.player.koBy, -2);
  game.destroy();
});
