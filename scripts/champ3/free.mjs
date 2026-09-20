/** Unsteered baseline: what does each archetype do on its own? */
import { BUILDS, runOne } from './sim.mjs';
for (const name of Object.keys(BUILDS)) {
  const r = runOne({ build: BUILDS[name], targets: [] });
  console.log(`${name.padEnd(9)} ${r.finished ? r.time.toFixed(1) + 's' : 'DNF'}  rec=${r.recoveries} ${JSON.stringify(r.recoverySpots)}`);
  console.log(`          holds=${JSON.stringify(r.holds.map((h) => `${h.kind}@${h.at}s${JSON.stringify(h.from)}`))}`);
  console.log(`          marks=${JSON.stringify(r.marks)}`);
}
