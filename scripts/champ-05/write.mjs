// CHAMP-05: emit src/game/official-tracks/champ-4.json from the authored def.
//   node --import tsx scripts/champ-05/write.mjs
// The JSON is the deliverable — plain TrackDef, no helper code ships with it.
import { writeFileSync } from 'node:fs';
import { validateTrackDef } from '../../src/game/trackdef.ts';
import { def } from './def.mjs';

const problems = validateTrackDef(def);
if (problems.length) {
  console.error('validateTrackDef rejected the def:');
  for (const p of problems) console.error(' -', p);
  process.exit(1);
}
if (def.pieces.length > 200) {
  console.error(`piece budget blown: ${def.pieces.length} > 200`);
  process.exit(1);
}

const out = JSON.parse(JSON.stringify({
  v: def.v,
  name: def.name,
  seed: def.seed,
  theme: def.theme,
  height: def.height,
  segments: def.segments,
  pieces: def.pieces,
}));
writeFileSync('src/game/official-tracks/champ-4.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote src/game/official-tracks/champ-4.json — ${out.pieces.length} authored pieces, height ${out.height}, seed ${out.seed}`);
