/**
 * Issue #72 — focused selection-bounds checks for the map builder.
 *
 * The numerical reproductions (mirrored wheel/sling/magnet, wind fan) are
 * confirmed in the ticket; these tests pin the repaired behaviour:
 *   - mirrored pieces are selected where they are drawn, not at their
 *     un-mirrored authoring coordinates;
 *   - the wind fan box is selectable where the renderer paints it;
 *   - selection follows size, facing and flip.
 * Bounds are checked through the real `buildEditorTrack` / `hitPieceAt` /
 * `piecesInBox` code paths, plus the placement probes from the ticket.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEditorTrack, hitPieceAt, piecesInBox } from '../src/components/editor/build';
import { visualBoundsForPiece, windFanAnchor } from '../src/components/editor/bounds';
import { handlesFor } from '../src/components/editor/handles';
import { defaultPiece } from '../src/components/editor/defaults';
import { meta, W } from '../src/game/track';
import type { Piece, TrackDef } from '../src/game/trackdef';

function defFor(pieces: Piece[]): TrackDef {
  return { v: 1, name: 'Bounds check', seed: 42, theme: 'classic', height: 4000, pieces };
}

/** Build a one-piece def and return its editor build plus the piece. */
function buildOne(piece: Piece) {
  const editor = buildEditorTrack(defFor([piece]));
  assert.equal(editor.error, null);
  assert.ok(editor.track);
  return editor;
}

const hit = (editor: ReturnType<typeof buildOne>, x: number, y: number) =>
  hitPieceAt({ x, y }, editor.track!, editor.bodyToPiece, editor.pieceBounds);

function within(b: { min: { x: number; y: number }; max: { x: number; y: number } }, x: number, y: number): boolean {
  return x >= b.min.x && x <= b.max.x && y >= b.min.y && y <= b.max.y;
}

test('mirrored water wheel is selected at its drawn centre, not its authoring x', () => {
  const piece: Piece = { t: 'wheel', x: 200, y: 1500, r: 110, buckets: 6, rpm: 3, dir: 0, release: 105, phase: 0, flip: true };
  const editor = buildOne(piece);
  // The rendered/handle centre mirrors about the centre line: W - 200 = 700.
  assert.equal(handlesFor(piece)[0].x, W - 200);
  assert.equal(hit(editor, 700, 1500), 0, 'drawn centre must hit piece 0');
  assert.equal(hit(editor, 200, 1500), null, 'un-mirrored authoring position must not select');
  // The bounds follow the built (mirrored) ring body, not the raw piece x.
  const ring = editor.track!.bodies.find((b) => meta(b).kind === 'wheel' && b.isSensor)!;
  const bounds = editor.pieceBounds[0];
  assert.ok(bounds.min.x > W / 2 && bounds.max.x <= W, 'mirrored wheel bounds sit on the drawn side');
  assert.ok(within(bounds, ring.bounds.min.x + 1, ring.bounds.min.y + 1));
  assert.ok(within(bounds, ring.bounds.max.x - 1, ring.bounds.max.y - 1));
});

test('mirrored sling and magnet select where they are drawn', () => {
  const sling: Piece = { ...defaultPiece('sling', { x: 200, y: 1500 }), flip: true } as Piece;
  assert.ok(sling.t === 'sling');
  const editorSling = buildOne(sling);
  const move = handlesFor(sling)[0];
  assert.equal(move.x, W - 200);
  assert.equal(hit(editorSling, move.x, move.y), 0, 'drawn sling anchor must select');
  assert.equal(hit(editorSling, 200, 1500), null, 'un-mirrored sling position must not select');

  const magnet: Piece = { ...defaultPiece('magnet', { x: 200, y: 1500 }), flip: true } as Piece;
  assert.ok(magnet.t === 'magnet');
  const editorMagnet = buildOne(magnet);
  assert.equal(hit(editorMagnet, W - 200, 1500), 0, 'drawn magnet centre must select');
  assert.equal(hit(editorMagnet, 200, 1500), null, 'un-mirrored magnet position must not select');
});

test('wind fan is selectable where the renderer paints it', () => {
  const piece = defaultPiece('wind', { x: 200, y: 1500 });
  assert.ok(piece.t === 'wind');
  // Default field: a = (90, 1240), b = (310, 1500), dir = 270 (up).
  const editor = buildOne(piece);
  const body = editor.track!.bodies.find((b) => meta(b).kind === 'wind')!;
  const wind = meta(body).wind!;
  // The renderer's own corner formula: fan near the lower-left for an upward blow.
  const fan = windFanAnchor(wind);
  assert.ok(Math.abs(fan.x - 104) < 1e-6 && Math.abs(fan.y - 1488) < 1e-6, `fan anchor at the leading corner, got ${JSON.stringify(fan)}`);
  const bounds = editor.pieceBounds[0];
  assert.ok(within(bounds, fan.x, fan.y), 'fan anchor inside selection bounds');
  assert.ok(within(bounds, fan.x - 28 + 1, fan.y - 20 + 1), 'painted fan box inside selection bounds');
  assert.equal(hit(editor, fan.x - 10, fan.y - 5), 0, 'clicking the visible fan selects the wind piece');
  assert.equal(hit(editor, 200, 1370), 0, 'field centre stays selectable');
  // The bounds also cover the whole editable field, not just the icon.
  assert.ok(within(bounds, wind.box.x + 1, wind.box.y + 1) && within(bounds, wind.box.x + wind.box.w - 1, wind.box.y + wind.box.h - 1));
});

test('wind bounds follow the field, the fan and the flip', () => {
  const small = defaultPiece('wind', { x: 450, y: 1500 });
  const tall: Piece = { ...small, a: [small.a[0], small.a[1] - 400], b: [small.b[0] + 120, small.b[1]] } as Piece;
  assert.ok(small.t === 'wind' && tall.t === 'wind');
  const boundsSmall = buildOne(small).pieceBounds[0];
  const boundsTall = buildOne(tall).pieceBounds[0];
  assert.ok(boundsTall.min.y < boundsSmall.min.y - 300, 'taller field extends the bounds upward');
  assert.ok(boundsTall.max.x > boundsSmall.max.x, 'wider field extends the bounds sideways');

  const mirrored: Piece = { ...defaultPiece('wind', { x: 200, y: 1500 }), flip: true } as Piece;
  const editor = buildOne(mirrored);
  const body = editor.track!.bodies.find((b) => meta(b).kind === 'wind')!;
  const wind = meta(body).wind!;
  const fan = windFanAnchor(wind);
  assert.ok(hit(editor, fan.x, fan.y) === 0, 'mirrored wind fan still selectable at its drawn corner');
  assert.ok(editor.pieceBounds[0].min.x > W / 2, 'mirrored wind bounds sit on the drawn side');
});

test('sling selection follows size and facing', () => {
  const base: Piece = { t: 'sling', x: 450, y: 1500, size: 90, facing: 245, strength: 4 };
  const big: Piece = { ...base, size: 160 };
  const turned: Piece = { ...base, facing: 65 };
  const bBase = buildOne(base).pieceBounds[0];
  const bBig = buildOne(big).pieceBounds[0];
  const bTurned = buildOne(turned).pieceBounds[0];
  const area = (b: typeof bBase) => (b.max.x - b.min.x) * (b.max.y - b.min.y);
  assert.ok(area(bBig) > area(bBase) * 1.5, 'bigger sling collider grows the selection box');
  // 245° vs 65° point the rubber face (and the 60×68 art) opposite ways, so the
  // art box must move with it, not stay a fixed upright rectangle.
  assert.ok(Math.abs(bTurned.min.x - bBase.min.x) > 10 || Math.abs(bTurned.min.y - bBase.min.y) > 10,
    'facing rotates the selection box with the drawn art');
  // Both rest poses stay selectable at their drawn anchor.
  for (const p of [base, big, turned]) {
    const editor = buildOne(p);
    const move = handlesFor(p)[0];
    assert.equal(hit(editor, move.x, move.y), 0);
  }
});

test('magnet and geyser union their field extents with their icons', () => {
  const magnet = defaultPiece('magnet', { x: 450, y: 1500 });
  assert.ok(magnet.t === 'magnet');
  const mBounds = buildOne(magnet).pieceBounds[0];
  assert.ok(within(mBounds, 450 - magnet.r + 1, 1500), 'magnet field edge selectable');
  assert.ok(within(mBounds, 450 + magnet.r - 1, 1500), 'magnet field edge selectable');

  const geyser = defaultPiece('geyser', { x: 450, y: 1500 });
  assert.ok(geyser.t === 'geyser');
  const editor = buildOne(geyser);
  const gBounds = editor.pieceBounds[0];
  // The column top and the vent plinth are both drawn art / editable extent.
  assert.ok(within(gBounds, 450, 1500 - geyser.h + 10), 'geyser column top selectable');
  assert.ok(within(gBounds, 450, 1508), 'geyser vent plinth selectable');
  assert.equal(hit(editor, 450, 1500 - geyser.h + 10), 0);
});

test('platform route and slab art stay selectable, including when flipped', () => {
  const piece = defaultPiece('platform', { x: 200, y: 1500 });
  assert.ok(piece.t === 'platform');
  const editor = buildOne(piece);
  const body = editor.track!.bodies.find((b) => meta(b).kind === 'platform')!;
  const mo = meta(body).motion!;
  assert.ok(mo.mode === 'platform');
  for (const pt of [mo.a, mo.b, body.position]) {
    assert.ok(within(editor.pieceBounds[0], pt.x, pt.y - 12), `platform pose at ${JSON.stringify(pt)} selectable`);
  }
  assert.equal(hit(editor, mo.a.x, mo.a.y - 10), 0, 'route end A selectable');
  assert.equal(hit(editor, mo.b.x, mo.b.y - 10), 0, 'route end B selectable');

  const mirrored: Piece = { ...piece, flip: true } as Piece;
  const editorM = buildOne(mirrored);
  const bodyM = editorM.track!.bodies.find((b) => meta(b).kind === 'platform')!;
  const moM = meta(bodyM).motion!;
  assert.ok(moM.mode === 'platform');
  assert.ok(moM.a.x > W / 2 && moM.b.x > W / 2, 'mirrored route sits on the drawn side');
  assert.equal(hit(editorM, moM.a.x, moM.a.y - 10), 0, 'mirrored route end A selectable');
  assert.equal(hit(editorM, moM.b.x, moM.b.y - 10), 0, 'mirrored route end B selectable');
});

test('scoop pocket art and subway exit both stay selectable', () => {
  const piece: Piece = { t: 'scoop', x: 450, y: 1500, deg: 270, hold: 800, exit: [650, 1700, 1400] };
  const editor = buildOne(piece);
  assert.equal(hit(editor, 450, 1500), 0, 'pocket body selectable');
  assert.equal(hit(editor, 650, 1700), 0, 'subway exit sensor selectable');
  // The pocket sprite is offset (-20, -12) from the body: its far corner must be in bounds.
  assert.ok(within(editor.pieceBounds[0], 450 - 40 + 1, 1500 - 24 + 1));
});

test('tunnel entrance and exit art are selectable in world coordinates', () => {
  const piece: Piece = { t: 'tunnel', x: 200, y: 1500, exit: [600, 1700], edir: [0, 1], ms: 900, speed: 7, flip: true };
  const editor = buildOne(piece);
  // flip mirrors both holes: entrance at W - 200, exit at W - 600.
  assert.equal(hit(editor, W - 200, 1500), 0, 'mirrored entrance selectable');
  assert.equal(hit(editor, W - 600, 1700), 0, 'mirrored exit selectable');
  assert.equal(hit(editor, 200, 1500), null, 'un-mirrored entrance must not select');
});

test('marquee selection covers pieces where they are drawn', () => {
  const wheel: Piece = { t: 'wheel', x: 200, y: 1500, r: 110, buckets: 6, rpm: 3, dir: 0, release: 105, phase: 0, flip: true };
  const wind = defaultPiece('wind', { x: 450, y: 1500 });
  const editor = buildEditorTrack(defFor([wheel, wind]));
  assert.equal(editor.error, null);
  assert.ok(editor.track);
  // A box around the mirrored wheel's drawn location picks it up.
  const aroundWheel = piecesInBox({ minX: 600, minY: 1400, maxX: 800, maxY: 1600 }, editor.track!, editor.bodyToPiece, editor.pieceBounds);
  assert.ok(aroundWheel.has(0), 'marquee over the drawn wheel selects it');
  const aroundAuthoring = piecesInBox({ minX: 100, minY: 1400, maxX: 300, maxY: 1600 }, editor.track!, editor.bodyToPiece, editor.pieceBounds);
  assert.ok(!aroundAuthoring.has(0), 'marquee over the un-mirrored authoring spot misses it');
  // A box over the wind fan (not the field centre) picks up the wind.
  const body = editor.track!.bodies.find((b) => meta(b).kind === 'wind')!;
  const fan = windFanAnchor(meta(body).wind!);
  const aroundFan = piecesInBox({ minX: fan.x - 20, minY: fan.y - 15, maxX: fan.x + 5, maxY: fan.y + 5 }, editor.track!, editor.bodyToPiece, editor.pieceBounds);
  assert.ok(aroundFan.has(1), 'marquee over the visible fan selects the wind');
});

test('pieces without sprite art keep their physics-extent bounds', () => {
  // A plain wall: bounds are the body AABB plus padding, in world coordinates either way.
  for (const flip of [false, true]) {
    const piece: Piece = { t: 'wall', x: 450, y: 1500, w: 200, h: 40, flip };
    const editor = buildOne(piece);
    const body = editor.track!.bodies.find((b) => meta(b).kind === 'wall')!;
    const b = editor.pieceBounds[0];
    assert.ok(Math.abs(b.min.x - (body.bounds.min.x - 15)) < 1e-6);
    assert.ok(Math.abs(b.max.y - (body.bounds.max.y + 15)) < 1e-6);
    assert.equal(hit(editor, body.position.x, body.position.y), 0);
  }
});

test('visualBoundsForPiece falls back to a mirrored anchor when a piece built no bodies', () => {
  // A def piece type the builder ignores still gets a usable box at its drawn spot.
  const weird = { t: 'wall', x: 200, y: 1500, w: 10, h: 10, flip: true } as unknown as Piece;
  const bounds = visualBoundsForPiece(weird, []);
  const cx = (bounds.min.x + bounds.max.x) / 2;
  assert.ok(Math.abs(cx - (W - 200)) < 1e-6, 'fallback centre mirrors with the piece');
});
