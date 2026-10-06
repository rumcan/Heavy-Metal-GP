// Run with: node --import tsx --test tests/workshop-lanes.test.ts
// The owner: build one lane at a time; a course has 1 (main), 2 (main + back) or 3 lanes. Old courses are 3 lanes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrackDef } from '../src/game/trackdef';
import type { TrackDef } from '../src/game/trackdef';
import { decodeShareCode, encodeShareCode } from '../src/game/sharecode';
import { newPlatformerDef, planFromTrackDef, platformerIssues } from '../src/game/platformer/def';
import { lanesOf } from '../src/game/lanes';

const course = (lanes?: 1 | 2): TrackDef => ({
  ...newPlatformerDef('Lanes', 6000),
  ...(lanes ? { lanes } : {}),
  pieces: [
    { t: 'ramp', a: [900, 800], b: [2000, 900] },
    { t: 'ramp', a: [900, 700], b: [2000, 800], lane: 0 },
    { t: 'ramp', a: [900, 900], b: [2000, 1000], lane: 2 },
  ],
});

test('lane sets: 1 is the main lane, 2 adds the back lane, 3 (or none) is all of them', () => {
  assert.deepEqual(lanesOf(1), [1]);
  assert.deepEqual(lanesOf(2), [0, 1]);
  assert.deepEqual(lanesOf(undefined), [0, 1, 2]);
  assert.deepEqual(lanesOf(3), [0, 1, 2]);
});

test('a lane count validates, survives JSON and a share code, and is only for platformer courses', async () => {
  for (const lanes of [1, 2] as const) {
    const check = validateTrackDef(course(lanes));
    assert.ok(check.ok);
    if (!check.ok) return;
    assert.equal(check.def.lanes, lanes);
    const back = await decodeShareCode(await encodeShareCode(check.def));
    assert.equal(back.lanes, lanes);
  }
  const three = validateTrackDef(course());
  assert.ok(three.ok && three.def.lanes === undefined, 'three lanes stay as they always were');
  assert.ok(!validateTrackDef({ ...course(), lanes: 4 } as unknown as TrackDef).ok);
  assert.ok(!validateTrackDef({ v: 1, name: 'Drop', theme: 'classic', height: 1400, lanes: 1, pieces: [] } as unknown as TrackDef).ok);
});

test('a course with fewer lanes builds only its lanes, and says so about pieces in a lane it does not have', () => {
  const one = planFromTrackDef(course(1));
  assert.deepEqual(one.lanes, [1]);
  assert.ok(one.floors.every((f) => f.lane === 1), 'only main-lane floors');
  const two = planFromTrackDef(course(2));
  assert.deepEqual(two.lanes, [0, 1]);
  assert.ok(two.floors.some((f) => f.lane === 0) && !two.floors.some((f) => f.lane === 2));
  assert.equal(planFromTrackDef(course()).lanes, undefined);
  assert.ok(platformerIssues(course(1)).some((i) => /does not have/.test(i.message)));
});
