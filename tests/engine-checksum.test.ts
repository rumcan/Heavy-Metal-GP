// P2-00a safety net: a full race must play out byte-for-byte the same after engine refactors.
// The golden fingerprints in tests/engine-checksum.golden.json were recorded before the engine split.
// If a change is MEANT to alter the simulation, regenerate them with: UPDATE_GOLDEN=1 node --import tsx --test tests/engine-checksum.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { officialTrack } from '../src/game/official-tracks';
import { AI_COLORS, AI_NAMES, mulberry32, randomStats } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';

const GOLDEN = new URL('./engine-checksum.golden.json', import.meta.url);
const STEPS = 3000;

function roster(): MarbleInfo[] {
  const rng = mulberry32(777);
  return Array.from({ length: 10 }, (_, i) => ({
    id: i,
    name: i === 0 ? 'You' : AI_NAMES[i - 1],
    color: i === 0 ? '#d63e2e' : AI_COLORS[i - 1],
    stats: randomStats(rng),
    isPlayer: i === 0,
    character: i % 6,
  }));
}

function fingerprint(circuit: number, seed: number): string {
  const game = new Game(seed, roster(), { def: officialTrack(circuit), inventory: { rocket: 2, jump: 2, shock: 1 } });
  game.start();
  game.openGate();
  const hash = createHash('sha256');
  for (let i = 0; i < STEPS; i++) {
    // A scripted human: steer in bursts and fire items, so input and item code paths run too.
    game.nudge = Math.sin(i / 40) > 0.3 ? 1 : Math.sin(i / 40) < -0.3 ? -1 : 0;
    if (i === 400) game.usePlayerItem('rocket');
    if (i === 900) game.usePlayerItem('jump');
    if (i === 1500) game.usePlayerItem('shock');
    game.step(PHYSICS_STEP);
    if (i % 50 === 0) {
      for (const m of game.marbles) {
        const p = m.body.position;
        hash.update(`${m.info.id}:${p.x.toFixed(6)},${p.y.toFixed(6)}|`);
      }
      hash.update(game.ranking().map((r) => r.marble.info.id).join(','));
    }
  }
  return hash.digest('hex');
}

test('P2-00a: a seeded race on three official tracks is unchanged (engine checksum)', () => {
  const cases = [[0, 4242], [2, 99], [5, 2026]] as const;
  const got: Record<string, string> = {};
  for (const [circuit, seed] of cases) got[`${circuit}:${seed}`] = fingerprint(circuit, seed);
  if (process.env.UPDATE_GOLDEN || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(got, null, 2) + '\n');
    return;
  }
  const want = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
  assert.deepEqual(got, want, 'the simulation changed: a refactor must not change a single step');
});
