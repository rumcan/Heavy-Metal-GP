// Emits the committed plain TrackDef JSON for CHAMP-04.
//   node --import tsx scripts/champ3/emit.mjs [--check]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDef } from './def.mjs';
import { validateTrackDef } from '../../src/game/trackdef.ts';

const target = fileURLToPath(new URL('../../src/game/official-tracks/champ-3.json', import.meta.url));
const def = buildDef();
const check = validateTrackDef(def);
if (!check.ok) {
  console.error('validateTrackDef rejected the authored def:');
  console.error(check.errors.join('\n'));
  process.exit(1);
}
const json = `${JSON.stringify(def, null, 1)}\n`;
if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== json) {
    console.error('src/game/official-tracks/champ-3.json is out of date — run scripts/champ3/emit.mjs');
    process.exit(1);
  }
  console.log('champ-3.json is up to date');
} else {
  writeFileSync(target, json);
  console.log(`wrote ${target} — ${def.pieces.length} pieces, height ${def.height}`);
}
