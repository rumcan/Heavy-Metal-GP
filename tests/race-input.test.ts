// Playtest regression: online, the race screen never handed the held keys to the
// session, so nobody could steer. The screen is a canvas loop (not unit-renderable),
// so these pin the wiring in its source, and test the steering rule itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { nudgeOf } from '../src/game/controls';

const source = readFileSync(new URL('../src/components/RaceScreen.tsx', import.meta.url), 'utf8');

test('Playtest input: the online loop sends the local controls to the session every frame', () => {
  const advance = source.slice(source.indexOf('const advanceSession'), source.indexOf('const heartbeat'));
  assert.match(advance, /session\.setNudge\(nudgeOf\(controls\.current\)\)/, 'setNudge is called with the held controls');
  assert.match(source, /if \(sessionRef\.current\) \{\s*advanceSession\(now\)/, 'the frame loop advances the session through it');
});

test('Playtest input: arrow keys and A/D both steer', () => {
  assert.match(source, /event\.code === 'ArrowLeft' \|\| event\.code === 'KeyA'/);
  assert.match(source, /event\.code === 'ArrowRight' \|\| event\.code === 'KeyD'/);
});

test('Playtest input: a host whose window is hidden keeps simulating on a timer', () => {
  assert.match(source, /const heartbeat = window\.setInterval\(/);
  assert.match(source, /window\.clearInterval\(heartbeat\)/);
});

test('Playtest input: nudgeOf — touch wins, else right minus left', () => {
  assert.equal(nudgeOf({ left: true, right: false, touch: 0 }), -1);
  assert.equal(nudgeOf({ left: false, right: true, touch: 0 }), 1);
  assert.equal(nudgeOf({ left: true, right: true, touch: 0 }), 0);
  assert.equal(nudgeOf({ left: false, right: false, touch: 0 }), 0);
  assert.equal(nudgeOf({ left: true, right: false, touch: 1 }), 1);
});
