import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Piece, TrackDef } from '../src/game/trackdef';
import { validateTrackDef } from '../src/game/trackdef';
import { defaultPiece } from '../src/components/editor/defaults';
import { TILES } from '../src/components/editor/palette';
import { translatePiece } from '../src/components/editor/translation';
import { getTemplates, placeTemplate, saveTemplate, snapshotTemplate, type SavedTemplate } from '../src/components/editor/templates';
import { removeItem, setItem } from '../src/game/storage';

const walls: Extract<Piece, { t: 'wall' }>[] = [300, 500].map(x => ({ t: 'wall', x, y: 1500, w: 120, h: 24 }));
const template = (pieces: Piece[]): SavedTemplate => ({ id: 'template-test', name: 'Test', sprite: 'rail-wood', ...snapshotTemplate(pieces) });
const defFor = (pieces: Piece[]): TrackDef => ({ v: 1, name: 'Templates', seed: 0, theme: 'classic', height: 6000, pieces });
const tidy = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'number' ? Math.round(v * 1e8) / 1e8 : v));

test('Template round trip: the exact two-wall reproduction keeps 200 units of separation', () => {
  const saved = template(walls);
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.pieces, walls.map((p, i) => ({ ...p, x: i ? 100 : -100, y: 0 })));
  assert.deepEqual(placeTemplate(saved, { x: 400, y: 1500 }, false), walls);
  assert.deepEqual(placeTemplate(saved, { x: 463, y: 2013 }, true), walls.map((p, i) => ({ ...p, x: i ? 575 : 375, y: 2025 })));
  assert.deepEqual(walls.map(p => 'x' in p && p.x), [300, 500], 'saving must not mutate the source');
});

for (const tile of TILES) {
  test(`Template translation: ${tile.id} preserves every field and flip without clamping`, () => {
    for (const flip of [false, true]) {
      const piece = { ...defaultPiece(tile.t, { x: 300, y: 1500 }, false), ...tile.preset, flip } as Piece;
      const before = structuredClone(piece);
      const local = translatePiece(piece, -1000, -2000);
      assert.deepEqual(tidy(translatePiece(local, 1000, 2000)), tidy(piece));
      assert.deepEqual(piece, before);
      assert.equal(local.flip, flip);
      // Translation moves ALL points, not only the move handle.
      if ('a' in piece && 'a' in local) assert.deepEqual(local.a, [piece.a[0] + (flip ? 1000 : -1000), piece.a[1] - 2000]);
      if ('pivot' in piece && 'pivot' in local) assert.deepEqual(local.pivot, [piece.pivot[0] + (flip ? 1000 : -1000), piece.pivot[1] - 2000]);
      if ('pts' in piece && 'pts' in local) assert.deepEqual(local.pts, piece.pts.map(([x, y]) => [x + (flip ? 1000 : -1000), y - 2000]));
      if ('ax' in piece && 'ax' in local) assert.equal(local.bx, piece.bx + (flip ? 1000 : -1000));
      if ('bottom' in piece && 'bottom' in local) assert.equal(local.bottom, piece.bottom - 2000);
      if ('exit' in piece && piece.exit && 'exit' in local) {
        assert.deepEqual(local.exit, [piece.exit[0] + (flip ? 1000 : -1000), piece.exit[1] - 2000, ...piece.exit.slice(2)]);
      }
      const saved = template([piece, walls[1]]);
      const placed = placeTemplate(saved, { x: 450, y: 2000 }, false)!;
      assert.ok(placed);
      const placedWall = placed[1];
      assert.ok(placedWall.t === 'wall');
      const dx = placedWall.x - walls[1].x;
      const dy = placedWall.y - walls[1].y;
      assert.deepEqual(tidy(placed), tidy([piece, walls[1]].map(p => translatePiece(p, dx, dy))), 'save/reinsert must be a rigid translation');
      const check = validateTrackDef(defFor(placed));
      assert.ok(check.ok, check.ok ? '' : check.errors.join('; '));
    }
  });
}

test('Template origin is independent of first piece type and order, including paths, pivots, bottom and exits', () => {
  const pieces = ['loop', 'blade', 'boulder', 'platform', 'tunnel', 'scoop', 'curve'].map((t, i) => ({
    ...defaultPiece(t as Piece['t'], { x: 350, y: 1500 }, false), flip: i % 2 === 0,
  } as Piece));
  pieces.push({ t: 'scoop', x: 550, y: 1600, deg: 270, hold: 800, exit: [600, 1800, 1400], flip: true });
  const expected = placeTemplate(template(pieces), { x: 450, y: 2500 }, false)!;
  for (let i = 0; i < pieces.length; i++) {
    const ordered = [...pieces.slice(i), ...pieces.slice(0, i)];
    const actual = placeTemplate(template(ordered), { x: 450, y: 2500 }, false)!;
    assert.deepEqual(actual, [...expected.slice(i), ...expected.slice(0, i)]);
  }
  const scoop = expected[expected.length - 1];
  assert.ok(scoop.t === 'scoop');
  assert.equal(scoop.exit?.[2], 1400);
  assert.equal(scoop.flip, true);
});

test('Template edge placement clamps a single group delta, preserving paths and spacing', () => {
  const pieces: Piece[] = [
    ...walls,
    { t: 'ramp', a: [100, 1600], b: [300, 1650] },
    { t: 'tunnel', x: 200, y: 1800, exit: [600, 1900], edir: [1, 0], ms: 1000, speed: 10, flip: true },
  ];
  const saved = template(pieces);
  for (const x of [0, 25, 875, 900]) {
    const placed = placeTemplate(saved, { x, y: 2500 }, false)!;
    const first = placed[0];
    assert.ok(first.t === 'wall');
    const dx = first.x - 300;
    const dy = first.y - 1500;
    assert.deepEqual(tidy(placed), tidy(pieces.map(p => translatePiece(p, dx, dy))));
    const check = validateTrackDef(defFor(placed));
    assert.ok(check.ok, check.ok ? '' : check.errors.join('; '));
  }
  const tooWide = template([{ t: 'ramp', a: [-100, 1500], b: [1000, 1600] }]);
  assert.equal(placeTemplate(tooWide, { x: 450, y: 1500 }, false), null);
});

test('Template snapshot is independent of later edits to selected paths and exits', () => {
  const piece: Piece = { t: 'scoop', x: 300, y: 1500, deg: 270, hold: 800, exit: [500, 1700, 1400] };
  const saved = template([piece, walls[1]]);
  const before = structuredClone(saved);
  piece.exit![0] = 800;
  piece.exit![2] = 2000;
  assert.deepEqual(saved, before);
});

test('Legacy stored templates retain historical anchors; new saves persist their version', () => {
  try {
    for (const t of ['wall', 'ramp', 'loop', 'blade', 'boulder', 'platform'] as const) {
      const piece = defaultPiece(t, { x: 300, y: 1500 }, false);
      const legacy: SavedTemplate = { id: 'template-legacy', name: t, sprite: 'rail-wood', pieces: [piece] };
      setItem('heavy-metal-templates', JSON.stringify([legacy]));
      assert.deepEqual(getTemplates(), [legacy], 'loading must not rewrite old coordinates or add a version');
      const ax = 'x' in piece ? piece.x : 'a' in piece ? piece.a[0] : 0;
      const ay = 'y' in piece ? piece.y : 'a' in piece ? piece.a[1] : 0;
      assert.deepEqual(placeTemplate(getTemplates()[0], { x: ax, y: ay }, false), [piece]);
    }
    const saved = saveTemplate({ name: 'New walls', sprite: 'rail-wood', ...snapshotTemplate(walls) });
    assert.deepEqual(getTemplates().find(t => t.id === saved.id), saved);
    assert.deepEqual(placeTemplate(saved, { x: 400, y: 1500 }, false), walls);
  } finally {
    removeItem('heavy-metal-templates');
  }
});

test('Bucket groups retain spacing by pinning their fixed horizontal route', () => {
  const pieces: Piece[] = [{ t: 'bucket', y: 1500 }, ...walls];
  const saved = template(pieces);
  assert.notEqual(saved.fixedOriginX, undefined);
  assert.deepEqual(placeTemplate(saved, { x: 25, y: 2000 }, false), placeTemplate(saved, { x: 875, y: 2000 }, false));
  const placed = placeTemplate(saved, { x: 450, y: 2000 }, false)!;
  assert.deepEqual(placed, pieces.map(p => translatePiece(p, 0, (placed[0] as { y: number }).y - 1500)));
});
