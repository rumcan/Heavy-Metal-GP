/**
 * Issue #71: map builder edge placement, path distortion and placement settings.
 *
 * Focused checks for the three reproduced failures in the ticket — a legal click that built a piece
 * outside 0..W, a move against a wall that reshaped the piece, and placement prompts that wrote
 * settings the schema rejects. The numbers come from the ticket's reproductions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPiece } from '../src/components/editor/defaults';
import { applyHandle, movePiece, movePieces } from '../src/components/editor/handles';
import { pieceXs, xExtent } from '../src/components/editor/extent';
import { applyPlacementSettings, maxBoulderRest, SETTING_RANGES } from '../src/components/editor/pieceSettings';
import { TILES } from '../src/components/editor/palette';
import { buildTrackFromDef, validateTrackDef, type Piece, type TrackDef } from '../src/game/trackdef';
import { W } from '../src/game/track';

const defFor = (pieces: Piece[]): TrackDef => ({ v: 1, name: 'Placement bounds', seed: 42, theme: 'classic', height: 4000, pieces });
const check = (pieces: Piece[]) => validateTrackDef(defFor(pieces));
const problems = (pieces: Piece[]) => {
  const res = check(pieces);
  return res.ok ? '' : res.errors.join('; ');
};

/** Every stored x of a piece, measured from its leftmost one — its shape along the track. */
const shape = (piece: Piece): number[] => {
  const xs = pieceXs(piece);
  if (xs.length === 0) return [];
  const min = Math.min(...xs);
  return xs.map((x) => x - min).sort((a, b) => a - b);
};

// ---------------------------------------------------------------- 1. edge placement

test('Issue #71.1: a click at either edge places a valid piece of every type', () => {
  const failures: string[] = [];
  // 25 and 875 are the ticket's reproductions; 0 and W are the extremes the canvas allows.
  for (const x of [0, 25, 100, 450, 800, 875, W]) {
    for (const snap of [true, false]) {
      for (const tile of TILES) {
        const piece = { ...defaultPiece(tile.t, { x, y: 1500 }, snap), ...tile.preset } as Piece;
        const bad = problems([piece]);
        if (bad) failures.push(`x=${x} snap=${snap} ${tile.id}: ${bad}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('Issue #71.1: the ticket\'s reproduced placements are now inside the track', () => {
  // Left edge, grid on: these all started left of x=0 before the fix.
  const left: Record<string, number> = { ramp: -125, curve: -125, ice: -125, conveyor: -115, bridge: -155, wind: -75, mud: -100, pool: -125, platform: -50 };
  for (const [type, was] of Object.entries(left)) {
    const piece = defaultPiece(type as 'ramp', { x: 25, y: 1500 }, true);
    const ext = xExtent(piece);
    assert.ok(ext, `${type} has no extent`);
    assert.ok(ext!.min >= 0, `${type} still starts at ${ext!.min} (was ${was})`);
    assert.ok(ext!.max <= W, `${type} ends at ${ext!.max}`);
  }
  // Right edge, grid on: these all ended right of x=900.
  const right: Record<string, number> = { ramp: 1025, curve: 1025, ice: 1025, tunnel: 950, trapdoor: 930, wind: 975, mud: 1000, pool: 1025, platform: 950 };
  for (const [type, was] of Object.entries(right)) {
    const piece = defaultPiece(type as 'ramp', { x: 875, y: 1500 }, true);
    const ext = xExtent(piece);
    assert.ok(ext!.max <= W, `${type} still ends at ${ext!.max} (was ${was})`);
    assert.ok(ext!.min >= 0, `${type} starts at ${ext!.min}`);
  }
});

test('Issue #71.1: an edge placement slides the piece instead of shortening it', () => {
  for (const snap of [true, false]) {
    const mid = defaultPiece('ramp', { x: 450, y: 1500 }, snap);
    assert.ok(mid.t === 'ramp');
    for (const x of [0, 25, 875, W]) {
      const edge = defaultPiece('ramp', { x, y: 1500 }, snap);
      assert.ok(edge.t === 'ramp');
      // One translation: the rise and the run survive, so the ramp is still 300 long at 12°.
      assert.ok(Math.abs((edge.b[0] - edge.a[0]) - (mid.b[0] - mid.a[0])) < 1e-9, `run changed at x=${x}`);
      assert.ok(Math.abs((edge.b[1] - edge.a[1]) - (mid.b[1] - mid.a[1])) < 1e-9, `rise changed at x=${x}`);
    }
  }
});

test('Issue #71.1: anchor-led pieces turn inwards rather than leaving the track', () => {
  const tunnel = defaultPiece('tunnel', { x: 875, y: 1500 }, true);
  assert.ok(tunnel.t === 'tunnel');
  // The entrance stays where it was clicked; the ride turns back towards the middle.
  assert.equal(tunnel.x, 875);
  assert.ok(tunnel.exit[0] < tunnel.x, `exit at ${tunnel.exit[0]} should turn left`);
  assert.ok(tunnel.edir[0] < 0, 'launch direction should follow the inward route');

  const trapdoor = defaultPiece('trapdoor', { x: 875, y: 1500 }, true);
  assert.ok(trapdoor.t === 'trapdoor');
  assert.equal(trapdoor.hinge, 1);
  assert.ok(trapdoor.x + trapdoor.w / 2 <= W, `leaf reaches ${trapdoor.x + trapdoor.w / 2}`);

  const boulder = defaultPiece('boulder', { x: 875, y: 1500 }, true);
  assert.ok(boulder.t === 'boulder');
  // The run keeps its full 340 units — it turns instead of running short.
  assert.equal(Math.abs(boulder.pts[1][0] - boulder.pts[0][0]), 340);
});

test('Issue #71.1: an edge placement still builds the track the race would build', () => {
  for (const x of [25, 875]) {
    for (const tile of TILES) {
      const piece = { ...defaultPiece(tile.t, { x, y: 1500 }, true), ...tile.preset } as Piece;
      const def = defFor([piece]);
      assert.ok(validateTrackDef(def).ok, `${tile.id} at x=${x}: ${problems([piece])}`);
      const track = buildTrackFromDef(def);
      assert.ok(track.bodies.length > 0, `${tile.id} at x=${x} built no bodies`);
    }
  }
});

// ---------------------------------------------------------------- 2. moving near a boundary

test('Issue #71.2: moving a ramp into a wall keeps its length', () => {
  const ramp: Piece = { t: 'ramp', a: [100, 1475], b: [300, 1525] };
  // The ticket: dx=-200 used to take the length from 200 to 100, and farther collapsed it.
  for (const dx of [-200, -600, -5000]) {
    const moved = movePiece(ramp, dx, 0);
    assert.ok(moved.t === 'ramp');
    assert.equal(moved.b[0] - moved.a[0], 200, `dx=${dx} changed the length`);
    assert.equal(moved.b[1] - moved.a[1], 50);
    assert.equal(problems([moved]), '');
    assert.ok(moved.a[0] >= 0 && moved.b[0] <= W);
  }
  for (const dx of [700, 5000]) {
    const moved = movePiece(ramp, dx, 0);
    assert.ok(moved.t === 'ramp');
    assert.equal(moved.b[0] - moved.a[0], 200, `dx=${dx} changed the length`);
    assert.equal(problems([moved]), '');
  }
});

test('Issue #71.2: dragging the move handle into a wall keeps the piece shape', () => {
  const cases: { piece: Piece; handle: string; to: { x: number; y: number } }[] = [
    { piece: { t: 'ramp', a: [100, 1475], b: [300, 1525] }, handle: 'move', to: { x: -50, y: 1500 } },
    { piece: { t: 'curve', a: [100, 1400], c: [200, 1450], b: [300, 1500], n: 12 }, handle: 'move', to: { x: 0, y: 1500 } },
    { piece: { t: 'conveyor', a: [100, 1500], b: [300, 1560], v: 0.16, flipMs: 0, dir: 0 }, handle: 'move', to: { x: 0, y: 1500 } },
    { piece: { t: 'platform', ax: 100, ay: 1500, bx: 300, by: 1500, w: 130, travel: 2400, pause: 1600, phase: 0 }, handle: 'move', to: { x: 0, y: 1500 } },
    { piece: { t: 'wind', a: [100, 1250], b: [300, 1500], dir: 270, str: 0.34, pulse: 2600, phase: 0 }, handle: 'move', to: { x: 0, y: 1500 } },
    { piece: { t: 'saw', a: [100, 1500], b: [100, 1700], r: 26, spin: 0.55, period: 3600, phase: 0 }, handle: 'move', to: { x: 0, y: 1500 } },
    { piece: defaultPiece('tunnel', { x: 875, y: 1500 }, true), handle: 'move', to: { x: W + 200, y: 1500 } },
    { piece: defaultPiece('boulder', { x: 200, y: 1500 }, true), handle: 'move', to: { x: W + 200, y: 1500 } },
  ];
  for (const { piece, handle, to } of cases) {
    for (const snap of [true, false]) {
      const moved = applyHandle(piece, handle, to, snap);
      assert.deepEqual(shape(moved), shape(piece), `${piece.t} reshaped by its move handle (snap=${snap})`);
      assert.equal(problems([moved]), '', `${piece.t} move handle (snap=${snap})`);
    }
  }
});

test('Issue #71.2: every piece keeps its geometry and validity when moved hard against both walls', () => {
  for (const tile of TILES) {
    for (const flip of [false, true]) {
      const piece = { ...defaultPiece(tile.t, { x: 450, y: 1500 }, true), ...tile.preset, flip } as Piece;
      for (const [dx, dy] of [[-5000, 37], [5000, -37], [-120, 0], [120, 0], [0, 250]]) {
        const moved = movePiece(piece, dx, dy);
        assert.deepEqual(shape(moved), shape(piece), `${tile.id} flip=${flip} reshaped by dx=${dx}`);
        assert.equal(problems([moved]), '', `${tile.id} flip=${flip} dx=${dx} dy=${dy}`);
      }
    }
  }
});

test('Issue #71.2: a multi-selection moves as one block, keeping its spacing', () => {
  const first: Piece = { t: 'ramp', a: [600, 1000], b: [700, 1050] };
  const second: Piece = { t: 'ramp', a: [800, 1200], b: [850, 1250] };
  const gap = (ps: Piece[]) => {
    const [a, b] = ps as [Extract<Piece, { t: 'ramp' }>, Extract<Piece, { t: 'ramp' }>];
    return b.a[0] - a.b[0];
  };
  for (const dx of [400, 5000, -5000]) {
    const moved = movePieces([first, second], dx, 25);
    assert.equal(gap(moved), gap([first, second]), `dx=${dx} changed the spacing`);
    for (const [i, p] of moved.entries()) {
      const before = [first, second][i];
      assert.deepEqual(shape(p), shape(before), `dx=${dx} reshaped piece ${i}`);
      assert.ok(p.t === 'ramp' && before.t === 'ramp');
      assert.equal(p.a[1] - before.a[1], 25, `dx=${dx} lost the vertical move on piece ${i}`);
    }
    assert.equal(problems(moved), '');
  }
  // A mixed group stops at the wall together, whatever the pieces store.
  const mixed = [defaultPiece('ramp', { x: 700, y: 1500 }, true), defaultPiece('tunnel', { x: 800, y: 1700 }, true), defaultPiece('bucket', { x: 450, y: 1900 }, true)];
  const moved = movePieces(mixed, 900, 0);
  assert.equal(problems(moved), '');
  for (const [i, p] of moved.entries()) assert.deepEqual(shape(p), shape(mixed[i]), `mixed piece ${i} reshaped`);
});

// ---------------------------------------------------------------- 3. placement prompts

/** A prompt that answers from a queue, then records what it was asked. */
function prompter(answers: (string | null)[]) {
  const asked: string[] = [];
  const ask = (question: string) => {
    asked.push(question);
    return answers.length ? answers.shift()! : null;
  };
  return { ask, asked };
}

test('Issue #71.3: placement prompts clamp to the schema range', () => {
  // The ticket's concrete invalid inputs, each of which used to be written into the map as typed.
  const trapdoor = defaultPiece('trapdoor', { x: 450, y: 1500 }, true);
  const timed = applyPlacementSettings(trapdoor, prompter(['1']).ask);
  assert.ok(timed.t === 'trapdoor');
  assert.equal(timed.open, SETTING_RANGES.trapdoor.open.min);
  assert.equal(problems([timed]), '');

  const weighed = applyPlacementSettings({ ...trapdoor, mode: 'weight' } as Piece, prompter(['100']).ask);
  assert.ok(weighed.t === 'trapdoor');
  assert.equal(weighed.kg, SETTING_RANGES.trapdoor.kg.max);
  assert.equal(problems([weighed]), '');

  const crusher = applyPlacementSettings(defaultPiece('crusher', { x: 450, y: 1500 }, true), prompter(['1', '0']).ask);
  assert.ok(crusher.t === 'crusher');
  assert.equal(crusher.period, SETTING_RANGES.crusher.period.min);
  assert.equal(crusher.floor, SETTING_RANGES.crusher.floor.min);
  assert.equal(problems([crusher]), '');

  const boulder = applyPlacementSettings(defaultPiece('boulder', { x: 450, y: 1500 }, true), prompter(['1', '6500', '99999']).ask);
  assert.ok(boulder.t === 'boulder');
  assert.equal(boulder.r, SETTING_RANGES.boulder.r.min);
  assert.equal(boulder.interval, 6500);
  // A rest that eats the interval leaves the boulder sitting at the top: capped like the validator.
  assert.equal(boulder.rest, maxBoulderRest(6500));
  assert.ok(boulder.rest <= boulder.interval * 0.7);
  assert.equal(problems([boulder]), '');
});

test('Issue #71.3: prompts keep the defaults on cancel, empty or nonsense answers', () => {
  const crusher = defaultPiece('crusher', { x: 450, y: 1500 }, true);
  assert.ok(crusher.t === 'crusher');
  for (const answers of [[null, null], ['', ''], ['abc', 'nope']]) {
    const out = applyPlacementSettings(crusher, prompter(answers).ask);
    assert.ok(out.t === 'crusher');
    assert.equal(out.period, crusher.period);
    assert.equal(out.floor, crusher.floor);
    assert.equal(problems([out]), '');
  }
});

test('Issue #71.3: in-range answers are taken as typed, and pieces without prompts are untouched', () => {
  const timed = applyPlacementSettings(defaultPiece('trapdoor', { x: 450, y: 1500 }, true), prompter(['2500']).ask);
  assert.ok(timed.t === 'trapdoor');
  assert.equal(timed.open, 2500);

  const ramp = defaultPiece('ramp', { x: 450, y: 1500 }, true);
  const { ask, asked } = prompter([]);
  assert.equal(applyPlacementSettings(ramp, ask), ramp);
  assert.deepEqual(asked, [], 'a ramp has no settings to ask about');
});
