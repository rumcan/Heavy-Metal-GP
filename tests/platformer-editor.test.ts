// Run with: node --import tsx --test tests/platformer-editor.test.ts
// P2-22: the Workshop edits a platformer course with the same editor as a classic track. These cover the parts that are
// plain functions: the world the editor works in, what a click lays down, how pieces are picked, the build and the
// validation (the canvas and the toolbar are covered in tests/browser.test.ts).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrackDef } from '../src/game/trackdef';
import type { Piece, TrackDef } from '../src/game/trackdef';
import { PF_START_END, PF_START_Y, defFromPlan, newPlatformerDef, planFromTrackDef } from '../src/game/platformer/def';
import { planFlow } from '../src/game/platformer/flow';
import { buildPlatformerEditor, hitSidePiece, sideBounds } from '../src/components/editor/build-side';
import { PALETTE, PLATFORMER_PALETTE, tileFor } from '../src/components/editor/palette';
import { placementPieces } from '../src/components/editor/ghost';
import { clampCamera, fitScale, newRig, rigGoX, rigOpen } from '../src/components/editor/camera';
import { setEditorWorld, worldWidth } from '../src/components/editor/world';
import { validatePlatformer } from '../src/components/editor/validate-side';
import { applyHandle, handlesFor } from '../src/components/editor/handles';

afterEach(() => setEditorWorld(null));

const Y = PF_START_Y;
const course = (pieces: Piece[], width = 12000): TrackDef => {
  const check = validateTrackDef({ ...newPlatformerDef('Editor Test', width), pieces });
  assert.ok(check.ok, check.ok ? '' : check.error);
  return check.ok ? check.def : newPlatformerDef('x');
};

test('the editor world is the pipe until a course is open, then the course width', () => {
  assert.equal(worldWidth(), 900);
  setEditorWorld({ width: 12000 });
  assert.equal(worldWidth(), 12000);
  setEditorWorld(null);
  assert.equal(worldWidth(), 900);
});

test('the camera of a sideways course roams its whole length and can zoom far out', () => {
  setEditorWorld({ width: 12000 });
  const rig = newRig();
  rig.width = 900; rig.height = 500; rig.trackHeight = 2000; rig.startY = Y;
  rigOpen(rig);
  assert.ok(rig.camera.x < 1200, `opens on the start (x ${rig.camera.x})`);
  assert.ok(rig.camera.scale >= 0.3 && rig.camera.scale <= 0.6, `a working scale (${rig.camera.scale})`);
  rig.camera = clampCamera({ ...rig.camera, x: 99999 }, rig.width, rig.height, rig.trackHeight);
  assert.ok(rig.camera.x > 10000 && rig.camera.x <= 12000 + 200, `can reach the far end (x ${rig.camera.x})`);
  assert.ok(fitScale(900, 500) < 0.1, 'Fit shows the whole course');
  rigGoX(rig, 6000);
  assert.ok(Math.abs(rig.camera.x - (6000 + rig.width / 3 / rig.camera.scale)) < 1, 'a jump puts the world x at the left third');
});

test('every platformer tile lays a piece the def accepts, level and on the pointer', () => {
  setEditorWorld({ width: 12000 });
  const at = { x: 3000, y: Y + 100 };
  for (const tile of PLATFORMER_PALETTE.flatMap((g) => g.tiles)) {
    assert.equal(tileFor(tile.id)?.id, tile.id, `${tile.id} is found by id`);
    const placed = placementPieces(tile.id, at, true);
    assert.ok(placed && (placed.length === 1 || tile.id === 'scaffold' || tile.id === 'pegart' || tile.id.startsWith('track-')), `${tile.id} places one piece (scaffold kits, peg art and track kits place several)`);
    const check = validateTrackDef({ ...newPlatformerDef('t', 12000), pieces: placed! });
    assert.ok(check.ok, `${tile.id}: ${check.ok ? '' : check.error}`);
  }
  const floor = placementPieces('ramp', at, true)![0];
  assert.equal(floor.t, 'ramp');
  if (floor.t === 'ramp') { assert.equal(floor.a[1], floor.b[1], 'a floor is level'); assert.equal((floor.a[0] + floor.b[0]) / 2, 3000, 'centred on the click'); }
  const gate = placementPieces('gate-door', at, true)![0];
  assert.ok(gate.t === 'gate' && gate.kind === 'door');
});

test('the classic palette is untouched and a click in the pipe still lays the classic piece', () => {
  assert.equal(PALETTE.find((g) => g.id === 'rails')!.tiles.length, 7);
  const ramp = placementPieces('ramp', { x: 450, y: 500 }, true)![0];
  assert.ok(ramp.t === 'ramp' && ramp.a[1] !== ramp.b[1], 'a classic ramp slopes');
});

test('the editor build is a track to draw, a box per piece, and no body map', () => {
  const def = course([
    { t: 'ramp', a: [PF_START_END, Y], b: [3000, Y] },
    { t: 'ramp', a: [PF_START_END, Y - 100], b: [3000, Y - 100], lane: 2 },
    { t: 'pad', x: 2000, y: Y, w: 60, dir: 1 },
    { t: 'loop', x: 2400, bottom: Y, r: 90 },
  ]);
  const built = buildPlatformerEditor(def);
  assert.equal(built.error, null);
  assert.ok(built.track?.platformer, 'a platformer track');
  assert.equal(built.pieceBounds.length, 4);
  assert.deepEqual(built.bodyToPiece, []);
  const bounds = def.pieces.map(sideBounds);
  assert.ok(bounds.every((b) => b.max.x > b.min.x && b.max.y > b.min.y));
  const bad = buildPlatformerEditor({ ...def, width: 100 } as TrackDef);
  assert.ok(bad.error && /width/.test(bad.error) && bad.track === null);
});

test('a piece is picked by its box, the top one first, and blocked pieces (locked, other lane) are skipped', () => {
  const def = course([
    { t: 'ramp', a: [1000, Y], b: [2000, Y] },
    { t: 'ramp', a: [1000, Y], b: [2000, Y], lane: 2 },
  ]);
  const { pieceBounds } = buildPlatformerEditor(def);
  const point = { x: 1500, y: Y + 5 };
  assert.equal(hitSidePiece(point, pieceBounds), 1, 'the last drawn is on top');
  assert.equal(hitSidePiece(point, pieceBounds, new Set([1])), 0, 'with the front lane blocked, the middle one is picked');
  assert.equal(hitSidePiece(point, pieceBounds, new Set([0, 1])), null);
  assert.equal(hitSidePiece({ x: 9000, y: Y }, pieceBounds), null);
});

test('the handles of a gate and a ledge move them and set their width; a floor reaches the far end of a long course', () => {
  setEditorWorld({ width: 30000 });
  const gate: Piece = { t: 'gate', kind: 'ramp', to: 0, x: 5000, y: Y, w: 170 };
  assert.deepEqual(handlesFor(gate).map((h) => h.id), ['move', 'w']);
  const wider = applyHandle(gate, 'w', { x: 5300, y: Y }, false) as Extract<Piece, { t: 'gate' }>;
  assert.equal(wider.w, 300);
  const moved = applyHandle(gate, 'move', { x: 7000, y: Y + 50 }, false) as Extract<Piece, { t: 'gate' }>;
  assert.deepEqual([moved.x, moved.y], [7000, Y + 50]);
  const ledge: Piece = { t: 'ledge', x: 6000, y: Y - 100, w: 400 };
  const longer = applyHandle(ledge, 'w', { x: 8000, y: Y }, false) as Extract<Piece, { t: 'ledge' }>;
  assert.equal(longer.w, 2000);
  const ramp: Piece = { t: 'ramp', a: [1000, Y], b: [1400, Y] };
  const far = applyHandle(ramp, 'b', { x: 20000, y: Y }, false) as Extract<Piece, { t: 'ramp' }>;
  assert.equal(far.b[0], 20000, 'a floor end can be dragged along a 30 000 u course');
});

test('validation: a copy of an official course passes, a broken one says what to fix', () => {
  const copy = defFromPlan(planFlow(7), 'Copy 7');
  const good = validatePlatformer(copy);
  assert.ok(good.canShare, good.summary + ' ' + good.issues.map((i) => i.message).join(' / '));
  assert.ok(good.headless.finishRate >= 0.9);
  const empty = validatePlatformer(newPlatformerDef('Empty', 6000));
  assert.ok(!empty.canShare);
  assert.match(empty.summary, /FAIL/);
  assert.ok(empty.issues.every((i) => i.pos), 'every problem says where it is');
  assert.ok(planFromTrackDef(copy).floors.length > 100);
});
