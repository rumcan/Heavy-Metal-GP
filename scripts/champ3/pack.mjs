/**
 * CHAMP-04 shipping gate: run the *plain JSON* the game will load through the same checks a player's
 * custom circuit gets, and re-check the ticket's other hard limits.
 *
 *   node --import tsx scripts/champ3/pack.mjs
 *
 *  - `validateTrackDef` (the loader's own gate)
 *  - `buildTrackFromDef` (what `roundTrack` hands to the race)
 *  - `validateTrack` (static checks + the 10-marble headless pack, seed 42, needs >= 9/10)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildTrackFromDef, validateTrackDef } from '../../src/game/trackdef.ts';
import { validateTrack } from '../../src/components/editor/validate.ts';
import { meta } from '../../src/game/track.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '../../src/game/official-tracks/champ-3.json');
const RAW = readFileSync(FILE, 'utf8');
const def = JSON.parse(RAW);

let bad = 0;
const fail = (msg) => { console.log(`  FAIL ${msg}`); bad++; };
const pass = (msg) => console.log(`  ok   ${msg}`);

console.log(`champ-3.json — ${RAW.length} bytes\n`);

// ---- loader gate ------------------------------------------------------------------------------
const v = validateTrackDef(def);
if (v.ok) pass('validateTrackDef accepted the def');
else fail(`validateTrackDef rejected: ${v.error}`);

// ---- the def the race actually gets ------------------------------------------------------------
const track = buildTrackFromDef(def);
const kinds = {};
for (const body of track.bodies) {
  const k = meta(body)?.kind ?? body.label;
  kinds[k] = (kinds[k] ?? 0) + 1;
}
pass(`buildTrackFromDef: ${track.bodies.length} bodies ${JSON.stringify(kinds)}`);

// ---- ticket limits ----------------------------------------------------------------------------
if (def.pieces.length <= 165) pass(`authored pieces ${def.pieces.length} <= 165`);
else fail(`authored pieces ${def.pieces.length} > 165`);
if (def.height === 3660) pass('height 3660 (finish stub at 3360, sensor 3400)');
else fail(`height ${def.height} != 3660`);
if (def.name === 'Spa-Francoroll' && def.theme === 'forest' && def.seed === 41004) pass('name/theme/seed match the ticket');
else fail(`name/theme/seed ${def.name}/${def.theme}/${def.seed}`);
if (def.v === 1) pass('v:1');
else fail(`v ${def.v}`);

// ---- editor validation, including the 10-marble pack ------------------------------------------
const r = validateTrack(def);
const h = r.headless;
console.log(`  pack  ${r.summary}`);
console.log(`        finishTimes ${JSON.stringify(h.finishTimes.map((t) => (t === null ? null : +(t / 1000).toFixed(1))))}`);
console.log(`        recoveries/race ${h.averageRecoveries.toFixed(2)}, timeLimitHits ${h.timeLimitHits}`);
if (h.stuckSpots.length) console.log(`        stuck spots ${JSON.stringify(h.stuckSpots)}`);
for (const i of r.issues) console.log(`        ${i.severity}: ${i.message}`);
if (r.ok) pass('validateTrack ok (>=9/10 finish)'); else fail(`validateTrack: ${r.summary}`);
if (h.timeLimitHits === 0) pass('no time-limit hits');
else fail(`${h.timeLimitHits} time-limit hit(s)`);

console.log(bad ? `\n${bad} problem(s)` : '\nall CHAMP-04 gates pass');
process.exit(bad ? 1 : 0);
