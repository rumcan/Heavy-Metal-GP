// Run with: node --import tsx --test tests/floating-floors.test.ts
// The owner: a Workshop curve need not have a cliff under it; the cliff is switched on and off per floor piece.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrackDef } from '../src/game/trackdef';
import type { TrackDef } from '../src/game/trackdef';
import { decodeShareCode, encodeShareCode } from '../src/game/sharecode';
import { newPlatformerDef, planFromTrackDef } from '../src/game/platformer/def';

const course = (): TrackDef => ({
  ...newPlatformerDef('Floating', 6000),
  pieces: [
    { t: 'ramp', a: [900, 800], b: [2000, 900] },
    { t: 'curve', a: [2000, 600], c: [2400, 760], b: [2800, 600], cliff: false },
  ],
});

test('a floor with its cliff off survives validation and a share code; floors with it on are unchanged', async () => {
  const check = validateTrackDef(course());
  assert.ok(check.ok);
  if (!check.ok) return;
  assert.equal((check.def.pieces[1] as { cliff?: boolean }).cliff, false);
  assert.equal((check.def.pieces[0] as { cliff?: boolean }).cliff, undefined);
  const back = await decodeShareCode(await encodeShareCode(check.def));
  assert.equal((back.pieces[1] as { cliff?: boolean }).cliff, false);
  assert.equal((back.pieces[0] as { cliff?: boolean }).cliff, undefined);
});

test('the floating curve\'s floors are marked, the ramp\'s are not', () => {
  const plan = planFromTrackDef(course());
  const curve = plan.floors.filter((f) => f.x0 >= 2000 && f.x1 <= 2800 && f.y0 < 780);
  assert.ok(curve.length > 1 && curve.every((f) => f.noCliff));
  assert.ok(plan.floors.filter((f) => f.x1 <= 2000 && f.x0 >= 900).every((f) => !f.noCliff));
});
