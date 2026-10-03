// Run with: node --import tsx --test tests/platformer-track.test.ts
// P2-22: a platformer course is an ordinary TrackDef with `mode: 'platformer'`, a `width`, pieces on lanes, and two new
// piece types (gate, ledge). It must survive validation, JSON and a share code, and classic defs must not change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrackDef } from '../src/game/trackdef';
import type { TrackDef } from '../src/game/trackdef';
import { decodeShareCode, encodeShareCode } from '../src/game/sharecode';

const course = (): TrackDef => ({
  v: 1, name: 'Hill Side', theme: 'classic', height: 1600, mode: 'platformer', width: 12000,
  pieces: [
    { t: 'ramp', a: [900, 800], b: [1700, 800] },
    { t: 'ramp', a: [1700, 800], b: [2600, 900], lane: 2 },
    { t: 'gate', kind: 'ramp', to: 0, x: 3000, y: 900, w: 170 },
    { t: 'gate', kind: 'door', to: 1, x: 5000, y: 900, w: 170, lane: 0 },
    { t: 'ledge', x: 6000, y: 700, w: 300, lane: 2 },
    { t: 'pad', x: 7000, y: 880, w: 60, dir: 1 },
    { t: 'itembox', x: 9000, y: 820 },
  ],
});

test('a platformer course validates and keeps its mode, width, lanes, gates and ledges', () => {
  const check = validateTrackDef(course());
  assert.ok(check.ok, check.ok ? '' : check.error);
  if (!check.ok) return;
  assert.equal(check.def.mode, 'platformer');
  assert.equal(check.def.width, 12000);
  const lanes = check.def.pieces.map((p) => p.lane ?? 1);
  assert.deepEqual(lanes, [1, 2, 1, 0, 2, 1, 1]);
  assert.equal(check.def.pieces.filter((p) => p.t === 'gate').length, 2);
  assert.equal(check.def.pieces.filter((p) => p.t === 'ledge').length, 1);
  // A def survives JSON.
  const again = validateTrackDef(JSON.parse(JSON.stringify(check.def)));
  assert.ok(again.ok);
});

test('pieces may stand far to the right in a platformer course, and not in a classic one', () => {
  const far = { ...course(), pieces: [{ t: 'peg', x: 11000, y: 800, r: 10 }] } as unknown as TrackDef;
  assert.ok(validateTrackDef(far).ok, 'a peg at x 11000 inside a 12000 wide course');
  const classic = { ...far, mode: undefined, width: undefined } as TrackDef;
  const check = validateTrackDef(classic);
  assert.ok(!check.ok && /x is 11000/.test(check.error), 'a classic pipe is only 900 wide');
});

test('bad platformer fields are refused with a readable reason', () => {
  const bad = (patch: Record<string, unknown>) => validateTrackDef({ ...course(), ...patch });
  const a = bad({ width: 100 });
  assert.ok(!a.ok && /width/.test(a.error), a.ok ? '' : a.error);
  const b = bad({ mode: 'sideways' });
  assert.ok(!b.ok && /mode/.test(b.error));
  const c = bad({ pieces: [{ t: 'ramp', a: [0, 0], b: [500, 0], lane: 3 }] });
  assert.ok(!c.ok && /lane/.test(c.error));
  const d = bad({ pieces: [{ t: 'gate', kind: 'window', to: 1, x: 100, y: 100, w: 170 }] });
  assert.ok(!d.ok && /kind/.test(d.error));
  const e = validateTrackDef({ ...course(), mode: undefined });
  assert.ok(!e.ok && /width/.test(e.error), 'a width without the mode is refused');
});

test('a platformer course round-trips through a share code, lanes and all', async () => {
  const check = validateTrackDef(course());
  assert.ok(check.ok);
  if (!check.ok) return;
  const code = await encodeShareCode(check.def);
  const back = await decodeShareCode(code);
  assert.equal(back.mode, 'platformer');
  assert.equal(back.width, 12000);
  assert.deepEqual(back.pieces.map((p) => p.lane ?? 1), [1, 2, 1, 0, 2, 1, 1]);
  assert.deepEqual(back.pieces, check.def.pieces);
});

test('a classic def still encodes without a trailer and decodes unchanged', async () => {
  const classic = validateTrackDef({ v: 1, name: 'Plain', theme: 'classic', height: 1400, pieces: [{ t: 'ramp', a: [100, 200], b: [700, 300] }] });
  assert.ok(classic.ok);
  if (!classic.ok) return;
  const back = await decodeShareCode(await encodeShareCode(classic.def));
  assert.equal(back.mode, undefined);
  assert.equal(back.width, undefined);
  assert.deepEqual(back.pieces, classic.def.pieces);
});
