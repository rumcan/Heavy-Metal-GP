/**
 * CHAMP-04 branch entry -> rejoin timing, measured from real 10-marble races.
 *
 *   node --import tsx scripts/champ3/timing.mjs [build...]
 *
 * For each archetype build this runs the shipping pack (ten marbles, the same options `pack.mjs`
 * uses) and records every marble's crossing time and x at a set of gate lines. A branch is credited
 * when the marble is inside that branch's x band at the branch's entry line, so the numbers come
 * from marbles that actually took the line rather than from a hand-placed spawn. The reported
 * figure is the median entry->rejoin time for that branch and those marbles.
 */
import { Game } from '../../src/game/engine.ts';
import { buildTrackFromDef } from '../../src/game/trackdef.ts';
import { buildDef } from './def.mjs';
import { BUILDS, roster } from './sim.mjs';

const FRAME = 1000 / 60;
const CAP_MS = 150000;

/** entry: the y where the branch is chosen and the x band that commits to it. rejoin: its merge. */
const BRANCHES = {
  sweepA: { entry: 660, band: [0, 380], rejoin: 1080, specialist: 'SPEED', line: 'left ice sweep' },
  springA: { entry: 660, band: [520, 900], rejoin: 1080, specialist: 'BOUNCE', line: 'right spring line' },
  oxbowB: { entry: 1380, band: [560, 900], rejoin: 2140, specialist: 'SPEED', line: 'switchback + pool' },
  burrowB: { entry: 1240, band: [330, 700], rejoin: 2440, specialist: 'BOUNCE', line: 'entry rail + burrow' },
  outsideC: { entry: 2560, band: [520, 900], rejoin: 3295, specialist: 'SPEED', line: 'outside S' },
  rootC: { entry: 2560, band: [0, 480], rejoin: 3295, specialist: 'MASS', line: 'root channel' },
};

function race(build) {
  const track = buildTrackFromDef(buildDef());
  const game = new Game(42, roster(BUILDS[build], 0, 10), { track, effects: false, aiItems: false, recovery: true });
  game.openGate();
  const gates = [...new Set(Object.values(BRANCHES).flatMap((b) => [b.entry, b.rejoin]))].sort((a, b) => a - b);
  const crossing = game.marbles.map(() => ({}));
  let t = 0;
  while (t < CAP_MS && !game.allFinished()) {
    game.step(FRAME);
    t += FRAME;
    game.marbles.forEach((m, i) => {
      const p = m.body.position;
      for (const y of gates) {
        if (crossing[i][y] === undefined && p.y >= y) crossing[i][y] = { x: p.x, t: t / 1000 };
      }
    });
  }
  return { crossing, finished: game.marbles.filter((m) => m.finishedAt !== null).length };
}

const builds = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BUILDS);
const runs = new Map(builds.map((b) => [b, race(b)]));
for (const b of builds) console.log(`${b.padEnd(9)} pack finished ${runs.get(b).finished}/10`);

const median = (xs) => (xs.length ? xs.slice().sort((a, c) => a - c)[Math.floor(xs.length / 2)] : null);
let branchRows = '';
for (const [name, spec] of Object.entries(BRANCHES)) {
  const per = {};
  for (const b of builds) {
    const times = [];
    for (const c of runs.get(b).crossing) {
      const e = c[spec.entry];
      const r = c[spec.rejoin];
      if (!e || !r) continue;
      if (e.x < spec.band[0] || e.x >= spec.band[1]) continue;
      const dt = r.t - e.t;
      if (dt > 0.5 && dt < 60) times.push(dt);
    }
    per[b] = { n: times.length, med: median(times) };
  }
  const withTime = builds.filter((b) => per[b].med !== null);
  const specTime = per[spec.specialist]?.med ?? null;
  const others = withTime.filter((b) => b !== spec.specialist && b !== 'BALANCED' && per[b].med !== null).map((b) => per[b].med);
  console.log(`\n${name} — ${spec.line} (specialist ${spec.specialist}, y${spec.entry} -> y${spec.rejoin})`);
  for (const b of builds) {
    const p = per[b];
    console.log(`  ${b === spec.specialist ? '*' : ' '}${b.padEnd(9)} n=${p.n}  median ${p.med === null ? '   -  ' : `${p.med.toFixed(2)}s`}${specTime !== null && p.med !== null && b !== spec.specialist ? `  (${(((p.med - specTime) / specTime) * 100).toFixed(0)}% vs specialist)` : ''}`);
  }
  if (specTime !== null && others.length) {
    const ref = others.reduce((a, c) => a + c, 0) / others.length;
    console.log(`  specialist advantage over the other archetypes (mean): ${(((ref - specTime) / ref) * 100).toFixed(1)}%`);
    branchRows += `${name}: ${(((ref - specTime) / ref) * 100).toFixed(1)}%\n`;
  } else {
    console.log('  no comparable non-specialist sample in this build set');
    branchRows += `${name}: n/a\n`;
  }
}
