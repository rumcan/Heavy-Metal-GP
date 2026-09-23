/**
 * #99 Part 1 — the shared Workshop item base.
 *
 * Every placeable item shows the same base controls: a bounding box, four round corner resize
 * dots, ONE rotate handle above the box, a settings cog (only for items that have settings) and a
 * lock icon. These checks pin the model so the overlay cannot drift back into hand-duplicated
 * per-canvas copies:
 *
 *   - `baseBoxHandles` is the single source of the dots/rotate/cog positions;
 *   - a corner drag pins the far corner and rescales ANY size-bearing item;
 *   - the old per-type `rot` pad is gone (`box-rot` is the only rotate handle);
 *   - locked items are transparent to click and box-select (build.ts `locked` filters).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyHandle, baseBoxHandles, handlesFor, pieceHasSettings, lockHandlePoint, BASE_STALK } from '../src/components/editor/handles';

import { buildEditorTrack, hitPieceAt, piecesInBox } from '../src/components/editor/build';
import type { Piece, TrackDef } from '../src/game/trackdef';
import { W } from '../src/game/track';

const BOX = { min: { x: 100, y: 200 }, max: { x: 300, y: 400 } };

function defFor(pieces: Piece[]): TrackDef {
  return { v: 1, name: 'Base audit', seed: 7, theme: 'classic', height: 6000, pieces };
}

const BLOCK: Piece = { t: 'block', x: 200, y: 300, w: 200, h: 200 };

test('#99 base: rotate + four corners on every box, cog above-right, lock above-left', () => {
  const handles = baseBoxHandles(BLOCK, BOX);
  const ids = handles.map((h) => h.id);
  assert.deepEqual(ids.slice(0, 5), ['box-rot', 'box-nw', 'box-ne', 'box-sw', 'box-se']);
  assert.ok(ids.includes('settings'), 'a block has settings — the cog shows');
  // Corners sit exactly ON the box corners, the rotate/lock stalk above the top edge.
  const corner = (id: string, x: number, y: number) => {
    const h = handles.find((v) => v.id === id)!;
    assert.equal(h.x, x, id + '.x');
    assert.equal(h.y, y, id + '.y');
  };
  corner('box-nw', 100, 200);
  corner('box-se', 300, 400);
  corner('box-ne', 300, 200);
  corner('box-sw', 100, 400);
  assert.deepEqual(baseBoxHandles(BLOCK, BOX).find((h) => h.id === 'box-rot'), { id: 'box-rot', x: 200, y: 175, cursor: 'grab', label: 'Rotate' });
  assert.deepEqual(lockHandlePoint(BOX), { x: 100, y: 200 - BASE_STALK });
});

test('#99 base: the settings cog only shows when the item has settings', () => {
  // Ramp and wall are position/shape only — everything else gets the cog.
  assert.equal(pieceHasSettings('ramp'), false);
  assert.equal(pieceHasSettings('wall'), false);
  assert.equal(pieceHasSettings('block'), true);
  assert.equal(pieceHasSettings('vortex'), true);
  assert.equal(pieceHasSettings('catapult'), true);
  const withCog = baseBoxHandles(BLOCK, BOX).some((h) => h.id === 'settings');
  assert.equal(withCog, true);
  const ramp: Piece = { t: 'ramp', a: [100, 100], b: [300, 200] };
  const without = baseBoxHandles(ramp, BOX).some((h) => h.id === 'settings');
  assert.equal(without, false, 'ramp has no cog');
});

test('#99 base: one rotate handle — the per-type rot pad is gone', () => {
  // Types that used to carry the bespoke 'rot' pad now only get 'box-rot' from the base overlay.
  const ids = handlesFor(BLOCK).map((h) => h.id);
  assert.ok(!ids.includes('rot'), 'bespoke rotate pad removed');
  assert.ok(!ids.includes('box-rot'), 'box-rot comes from baseBoxHandles, not the type list');
  assert.ok(ids.includes('move'), 'the move handle stays first');
});

test('#99 base: a corner drag pins the far corner and rescales the piece', () => {
  const block: Piece = { t: 'block', x: 200, y: 300, w: 200, h: 200 };
  const box = { min: { x: 100, y: 200 }, max: { x: 300, y: 400 } };
  // Drag the SE corner 40 right / 20 down: x reach grows 20%, y reach 10% — from the pinned NW corner.
  const next = applyHandle(block, 'box-se', { x: 340, y: 420 }, false, box) as Piece & { w: number; h: number };
  assert.equal(next.t, 'block');
  assert.ok(Math.abs(next.w - 240) < 1e-9, `w grew 20% (got ${next.w})`);
  assert.ok(Math.abs(next.h - 220) < 1e-9, `h grew 10% (got ${next.h})`);
  // And the NW corner drag shrinks from the pinned SE corner the same way.
  const back = applyHandle(next, 'box-nw', { x: 100, y: 200 }, false, { min: { x: 100, y: 200 }, max: { x: 340, y: 420 } }) as Piece & { w: number; h: number };
  assert.ok(Math.abs(back.w - 240) < 1e-9 && Math.abs(back.h - 220) < 1e-9, 'un-dragged corner is a no-op');
});

test('#99 base: corner resize works for types the old model ignored', () => {
  // A turnstile (arm radius) had NO resize branch before; its dot must move the radius now.
  const turn: Piece = { t: 'turnstile', x: 200, y: 200, arms: 3, r: 100, mode: 0, period: 4000, phase: 0 } as unknown as Piece;
  const box = { min: { x: 100, y: 100 }, max: { x: 300, y: 300 } };
  const next = applyHandle(turn, 'box-se', { x: 330, y: 300 }, false, box) as Piece & { r: number };
  // sx = 1.15, sy = 1.0 → uniform mean 1.075 on a 100 arm.
  assert.ok(Math.abs(next.r - 107.5) < 1e-9, `radial field scales with the box (got ${next.r})`);
  // End-point geometry (a ramp's a/b) scales about the pinned corner.
  const ramp: Piece = { t: 'ramp', a: [100, 100], b: [300, 300] };
  const grown = applyHandle(ramp, 'box-se', { x: 400, y: 400 }, false, { min: { x: 100, y: 100 }, max: { x: 300, y: 300 } }) as Piece & { a: number[]; b: number[] };
  assert.ok(Math.abs(grown.b[0] - 400) < 1e-9 && Math.abs(grown.b[1] - 400) < 1e-9, 'b follows the dragged corner');
  assert.ok(Math.abs(grown.a[0] - 100) < 1e-9 && Math.abs(grown.a[1] - 100) < 1e-9, 'a stays on the pinned corner');
});

test('#99 base: corner clamps keep the piece inside its schema range', () => {
  const cat: Piece = { t: 'catapult', x: 200, y: 200, len: 400, reload: 2, dir: 0 };
  const box = { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } };
  // Yanking the corner to the horizon must not blow past catapultLen.max (400).
  const next = applyHandle(cat, 'box-se', { x: 5000, y: 100 }, false, box) as Piece & { len: number };
  assert.ok(next.len <= 400 + 1e-9, `clamped at ${next.len}`);
});

test('#99 base: fixed-size set-pieces resize as a whole through their size multiplier', () => {
  const box = { min: { x: 90, y: 90 }, max: { x: 110, y: 110 } };
  const itembox: Piece = { t: 'itembox', x: 100, y: 100 };
  // Double the box from the pinned NW corner: the item stays put and draws twice as large.
  const doubled = applyHandle(itembox, 'box-se', { x: 130, y: 130 }, false, box);
  assert.deepEqual(doubled, { ...itembox, sc: 2 });
  // A huge drag clamps to the 5x ceiling instead of exploding.
  const huge = applyHandle(itembox, 'box-se', { x: 500, y: 500 }, false, box);
  assert.equal((huge as { sc?: number }).sc, 5);
});

test('#99 base: locked pieces are unselectable by click and box-select', () => {
  const placed: Piece = { t: 'block', x: 300, y: 500, w: 200, h: 200 };
  const placed2: Piece = { t: 'trampoline', x: 600, y: 900, w: 200, tension: 1 };
  const d = defFor([placed, placed2]);
  const { track, bodyToPiece, pieceBounds, error } = buildEditorTrack(d);
  assert.equal(error, null);
  assert.ok(track);
  // Both pieces still hit-test with nobody locked.
  const none = hitPieceAt({ x: 300, y: 500 }, track!, bodyToPiece, pieceBounds);
  assert.equal(none, 0);
  // Lock piece 0: a click over it no longer selects it.
  const locked = new Set([0]);
  assert.equal(hitPieceAt({ x: 300, y: 500 }, track!, bodyToPiece, pieceBounds, locked), null);
  assert.equal(hitPieceAt({ x: 600, y: 900 }, track!, bodyToPiece, pieceBounds, locked), 1);
  // Box-select over everything skips the locked piece.
  const set = piecesInBox({ minX: 0, minY: 0, maxX: W, maxY: 6000 }, track!, bodyToPiece, pieceBounds, locked);
  assert.deepEqual([...set].sort(), [1]);
});

test('#101: a click on a locked piece passes through to the piece under it', () => {
  // A big block with a locked tunnel-sized block on top of it (drawn later = on top).
  const under: Piece = { t: 'block', x: 400, y: 600, w: 400, h: 400 };
  const over: Piece = { t: 'block', x: 400, y: 600, w: 150, h: 150 };
  const { track, bodyToPiece, pieceBounds } = buildEditorTrack(defFor([under, over]));
  assert.equal(hitPieceAt({ x: 400, y: 600 }, track!, bodyToPiece, pieceBounds), 1);
  assert.equal(hitPieceAt({ x: 400, y: 600 }, track!, bodyToPiece, pieceBounds, new Set([1])), 0);
});

test('#99 base: a flipped piece keeps its flipped shape after a mirrored corner drag', () => {
  // Flipped pieces store mirrored coordinates; applyHandle un-mirrors pointer AND anchor and swaps
  // the corner side, so world-east dragging world-se grows the stored piece towards world-east.
  const block: Piece = { t: 'block', x: W - 200, y: 300, w: 200, h: 200, flip: true } as Piece;
  // World bounds of that block: x from W-300 to W-100, y 200..400.
  const worldBox = { min: { x: W - 300, y: 200 }, max: { x: W - 100, y: 400 } };
  const next = applyHandle(block, 'box-se', { x: W - 60, y: 420 }, false, worldBox) as Piece & { w: number; h: number };
  assert.ok(next.flip, 'flip stays set');
  assert.ok(Math.abs(next.w - 240) < 1e-9 && Math.abs(next.h - 220) < 1e-9, `rescaled (w=${next.w}, h=${next.h})`);
  assert.equal(next.x, W - 200, 'anchor (x) unchanged by a symmetric-centre resize');
});
