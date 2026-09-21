import { generateTrack } from '../src/game/track';
import { CALENDAR } from '../src/game/season';
import { generateTrackDef, buildTrackFromDef } from '../src/game/trackdef';

const procedural = generateTrack(1, CALENDAR[0].profile);
const def = generateTrackDef(1, CALENDAR[0].profile, 'MARBLEHURST');
console.log('Def pieces:', def.pieces.filter(p => p.t === "wrecker"));
const fromDef = buildTrackFromDef(def);

for (let i = 0; i < procedural.bodies.length; i++) {
  const p = procedural.bodies[i];
  const d = fromDef.bodies[i];
  if (Math.abs(p.position.x - d.position.x) > 0.0001) {
    console.log(`Body ${i} differs!`);
    console.log(`p.label: ${p.label}, p.x: ${p.position.x}, d.x: ${d.position.x}`);
    console.log(`p.plugin: ${JSON.stringify(p.plugin)}`);
    console.log(`d.plugin: ${JSON.stringify(d.plugin)}`);
    break;
  }
}
