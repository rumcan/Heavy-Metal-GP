import { meta } from '../src/game/track';
import { handlesFor, applyHandle, mirrorPiece } from '../src/components/editor/handles';
import { rotateSelection } from '../src/components/editor/rotate';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILES } from '../src/components/editor/palette';
import { defaultPiece } from '../src/components/editor/defaults';
import { buildEditorTrack, hitPieceAt } from '../src/components/editor/build';
import { buildTrackFromDef, validateTrackDef, type Piece, type TrackDef } from '../src/game/trackdef';
import { encodeShareCode, decodeShareCode } from '../src/game/sharecode';

function defFor(piece: Piece): TrackDef {
  return { v: 1, name: 'Placement audit', seed: 42, theme: 'classic', height: 4000, pieces: [piece] };
}
const geometry = (track: ReturnType<typeof buildTrackFromDef>) => track.bodies.map(b => ({
  position: b.position, angle: b.angle, sensor: b.isSensor,
  vertices: b.vertices.map(v => ({ x: v.x, y: v.y })),
}));

for (const tile of TILES) {
  test(`Placement: ${tile.id} builds, selects and reloads identically to the race`, async () => {
    for (const snap of [false, true]) for (const flip of [false, true]) {
      const piece = { ...defaultPiece(tile.t, { x: 450, y: 1500 }, snap), ...tile.preset, flip } as Piece;
      const def = defFor(piece);
      const check = validateTrackDef(def);
      assert.ok(check.ok, check.ok ? '' : `${tile.id}: ${check.errors.join('; ')}`);
      const editor = buildEditorTrack(def);
      assert.equal(editor.error, null);
      assert.ok(editor.track);
      const indices = editor.bodyToPiece.flatMap((p, i) => p === 0 ? [i] : []);
      assert.ok(indices.length > 0, `${tile.id}: placed piece has no selectable bodies`);
      const body = editor.track.bodies[indices[indices.length - 1]];
      assert.equal(hitPieceAt(body.position, editor.track, editor.bodyToPiece), 0);
      assert.deepEqual(geometry(editor.track), geometry(buildTrackFromDef(def)));
      const back = await decodeShareCode(await encodeShareCode(def));
      // Share codes intentionally quantise coordinates to whole world units.
      assert.equal(back.pieces[0].t, piece.t);
      assert.deepEqual(geometry(buildEditorTrack(back).track!), geometry(buildTrackFromDef(back)));
    }
  });
}

test('Wind placement keeps its full field height with grid snapping enabled', () => {
  const free = defaultPiece('wind', { x: 450, y: 1500 }, false);
  const snapped = defaultPiece('wind', { x: 450, y: 1500 }, true);
  assert.ok(free.t === 'wind' && snapped.t === 'wind');
  assert.ok(Math.abs((snapped.b[1] - snapped.a[1]) - (free.b[1] - free.a[1])) <= 25);
  assert.equal(snapped.a[1] % 25, 0);
});

test('Rotating a subway scoop preserves the transit duration and valid exit', () => {
  const scoop: Piece = { t: 'scoop', x: 450, y: 1500, deg: 270, hold: 800, exit: [550, 1700, 1400] };
  for (const deg of [15, 90, 180, -90]) {
    const rotated = rotateSelection([scoop], [0], deg)[0];
    assert.ok(rotated.t === 'scoop');
    assert.equal(rotated.exit?.[2], 1400);
    assert.ok(validateTrackDef(defFor(rotated)).ok);
    assert.ok(buildTrackFromDef(defFor(rotated)).bodies.length);
  }
});

for (const type of ['blade', 'saw', 'crusher', 'mace', 'wheel', 'seesaw', 'catapult', 'flipper', 'magnet', 'geyser'] as const) {
  test(`Resize limits: ${type} remains valid at both extremes with grid snapping`, () => {
    const piece = defaultPiece(type, { x: 450, y: 1500 }, true);
    for (const h of handlesFor(piece).filter(h => ['len', 'r', 'travel', 'h'].includes(h.id))) {
      for (const delta of [0, 1, 1000]) {
        const resized = applyHandle(piece, h.id, { x: 450 + delta, y: 1500 + (type === 'geyser' ? -delta : delta) }, true);
        const check = validateTrackDef(defFor(resized));
        assert.ok(check.ok, check.ok ? '' : check.errors.join('; '));
      }
    }
  });
}

test('Mirroring a screw lift keeps its entry and exit roles', () => {
  const piece = defaultPiece('screw', { x: 450, y: 1500 });
  const mirrored = mirrorPiece(piece);
  assert.ok(piece.t === 'screw' && mirrored.t === 'screw');
  assert.deepEqual(mirrored.a, [900 - piece.a[0], piece.a[1]]);
  assert.deepEqual(mirrored.b, [900 - piece.b[0], piece.b[1]]);
});

test('Collapsed screw lifts are rejected before they create non-finite geometry', () => {
  const piece = defaultPiece('screw', { x: 450, y: 1500 });
  assert.ok(piece.t === 'screw');
  const collapsed = { ...piece, b: piece.a };
  assert.equal(validateTrackDef(defFor(collapsed)).ok, false);
  assert.throws(() => buildTrackFromDef(defFor(collapsed)), /screw.*distinct/i);
  const dragged = applyHandle(piece, 'b', { x: piece.a[0], y: piece.a[1] }, true);
  assert.deepEqual(dragged, piece, 'dragging onto the entry must leave the last valid span');
});

test('Rotating a cannon across zero degrees preserves its narrow aiming arc', () => {
  const piece = defaultPiece('cannon', { x: 450, y: 1500 });
  const turned = rotateSelection([piece], [0], 60)[0];
  for (const flip of [false, true]) {
    const track = buildTrackFromDef(defFor({ ...turned, flip }));
    const cannon = track.bodies.find(b => meta(b).cannon)!;
    const motion = meta(cannon).motion!;
    assert.ok(motion.mode === 'aim');
    assert.ok(Math.abs((motion.maxA! - motion.minA!) * 180 / Math.PI - 26) < 1e-8);
  }
});

test('Mirroring a conveyor reverses horizontal belt motion', () => {
  const piece = defaultPiece('conveyor', { x: 450, y: 1500 });
  const direction = (p: Piece) => {
    const track = buildTrackFromDef(defFor(p));
    const md = meta(track.bodies.find(b => meta(b).belt)!);
    return { x: md.surface!.tangent.x * md.belt!.dir0, y: md.surface!.tangent.y * md.belt!.dir0 };
  };
  const before = direction(piece), after = direction(mirrorPiece(piece));
  assert.ok(Math.abs(before.x + after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
});


test('Boulders appear at the placement point, keep their route in bounds and expose a radius handle', () => {
  for (const x of [50, 450, 825, 900]) {
    const piece = defaultPiece('boulder', { x, y: 1500 }, true);
    assert.ok(piece.t === 'boulder');
    assert.deepEqual(piece.pts[0], [x, 1500]);
    assert.ok(validateTrackDef(defFor(piece)).ok);
    const track = buildTrackFromDef(defFor(piece));
    assert.deepEqual(track.bodies.find(b => meta(b).kind === 'boulder')!.position, { x, y: 1500 });
    assert.ok(handlesFor(piece).some(h => h.id === 'r'));
    const resized = applyHandle(piece, 'r', { x: x + 55, y: 1500 }, false);
    assert.ok(resized.t === 'boulder' && resized.r === 55);
  }
});
