/**
 * #75 — map builder: the three grouped manipulation/preview defects.
 *
 *   1. the catapult length handle jumped the arm because it was drawn with one formula and decoded
 *      with another;
 *   2. sling / crusher / moving platform offered a size in the settings panel with no handle on the
 *      canvas to drag;
 *   3. the placement ghost was a hand-written copy of the palette defaults, so it ignored variant
 *      tiles, ignored saved templates entirely, and put a trapdoor hinge 55 units off the cursor.
 *
 * The checks are the ticket's own reproductions: a handle round-trips at the position it is drawn at,
 * a new handle stays inside the schema's bounds, and a ghost is the piece a click places.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyHandle, handlesFor, HANDLE_RANGES, CATAPULT_ARM_SCALE, mirrorPiece, movePiece } from '../src/components/editor/handles';
import { defaultPiece } from '../src/components/editor/defaults';
import { TILES } from '../src/components/editor/palette';
import { ghostParts, ghostPartsWorld, ghostPreview, placementPieces, TEMPLATE_ARM, type GhostPart } from '../src/components/editor/ghost';
import { buildEditorTrack } from '../src/components/editor/build';
import { validateTrackDef, type Piece, type TrackDef } from '../src/game/trackdef';
import { W } from '../src/game/track';
import { placeTemplate, type SavedTemplate } from '../src/components/editor/templates';

const CURSOR = { x: 450, y: 1500 };

function defFor(piece: Piece): TrackDef {
  return { v: 1, name: 'Handle audit', seed: 42, theme: 'classic', height: 4000, pieces: [piece] };
}

const handleById = (piece: Piece, id: string) => {
  const h = handlesFor(piece).find((x) => x.id === id);
  assert.ok(h, `expected a "${id}" handle on a ${piece.t}`);
  return h!;
};

/** Every handle is measured from the piece's move handle; slide this one along that line by `delta`. */
function dragHandle(piece: Piece, id: string, delta: number, snap = false): Piece {
  const h = handleById(piece, id);
  const a = handlesFor(piece)[0];
  const m = Math.hypot(h.x - a.x, h.y - a.y) || 1;
  return applyHandle(piece, id, { x: h.x + ((h.x - a.x) / m) * delta, y: h.y + ((h.y - a.y) / m) * delta }, snap);
}

/** Drag the handle onto the anchor it is measured from: every size handle must stop at its floor. */
function dragOntoAnchor(piece: Piece, id: string): Piece {
  const a = handlesFor(piece)[0];
  return applyHandle(piece, id, { x: a.x, y: a.y }, false);
}

const field = (piece: Piece, key: string) => (piece as unknown as Record<string, number>)[key];

/** Axis-aligned extent of a set of ghost parts, in world units. */
function bbox(parts: GhostPart[]) {
  const pts: [number, number][] = [];
  for (const part of parts) {
    if (part.kind === 'box') pts.push([part.x - part.w / 2, part.y - part.h / 2], [part.x + part.w / 2, part.y + part.h / 2]);
    else if (part.kind === 'ring') pts.push([part.x - part.r, part.y - part.r], [part.x + part.r, part.y + part.r]);
    else if (part.kind === 'path') pts.push(...part.pts);
    else pts.push([part.from[0], part.from[1]], [part.to[0], part.to[1]]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

const arrows = (parts: GhostPart[]) => parts.filter((p): p is Extract<GhostPart, { kind: 'arrow' }> => p.kind === 'arrow');

// ---- 1. the catapult handle must be its own inverse ---------------------------------------------

test('Catapult: dragging the length handle where it is drawn leaves the arm alone', () => {
  for (const len of [120, 230, 400, 277.5]) for (const dir of [0, 1] as const) for (const flip of [false, true]) {
    const piece = { ...defaultPiece('catapult', { x: 300, y: 1500 }), len, dir, flip } as Piece;
    const next = applyHandle(piece, 'len', handleById(piece, 'len'), false) as Piece & { len: number };
    assert.ok(Math.abs(next.len - len) < 1e-6, `${len} dir${dir} flip${flip}: an unmoved handle rewrote the arm to ${next.len}`);
    assert.ok(validateTrackDef(defFor(next)).ok);
  }
});

test('Catapult: the handle sits on the arm the race poses, and a drag tracks that arm', () => {
  const piece = defaultPiece('catapult', { x: 300, y: 1500 }) as Piece & { len: number; dir: 0 | 1 };
  const h = handleById(piece, 'len');
  // `Builder.catapult` rests a dir-0 arm at 135°: down and to the left of the pivot.
  assert.ok(h.x < 300 && h.y > 1500, `the handle sat at (${h.x}, ${h.y})`);
  // One shared scale for drawing and decoding: the handle's radius is the arm length times that scale.
  const radius = Math.hypot(h.x - 300, h.y - 1500);
  assert.ok(Math.abs(radius / CATAPULT_ARM_SCALE - 230) < 1e-6, `handle radius ${radius} does not decode to the arm's 230`);
  // Pulling the handle out along the arm line moves the length on that same scale, and nothing else.
  const grown = dragHandle(piece, 'len', 70) as Piece & { len: number };
  assert.ok(Math.abs(grown.len - (230 + 70 / CATAPULT_ARM_SCALE)) < 1e-6, `a 70-unit pull set the length to ${grown.len}`);
  assert.deepEqual({ ...grown, len: 0 }, { ...piece, len: 0 }, 'the length handle moved the pivot or the throw direction');
  // Mirrored pieces keep the same relationship: a flipped copy and a coordinate-mirrored copy.
  for (const variant of [{ ...piece, flip: true } as Piece, mirrorPiece(piece) as Piece]) {
    assert.ok(Math.abs((applyHandle(variant, 'len', handleById(variant, 'len'), false) as Piece & { len: number }).len - 230) < 1e-6);
    assert.ok(Math.abs((dragHandle(variant, 'len', 70) as Piece & { len: number }).len - (230 + 70 / CATAPULT_ARM_SCALE)) < 1e-6);
  }
});

test('Catapult: the arm stops at the schema bounds and lands on the lattice with the grid on', () => {
  const piece = defaultPiece('catapult', CURSOR) as Piece & { len: number };
  const { min, max } = HANDLE_RANGES.catapultLen;
  assert.equal((dragHandle(piece, 'len', 6000) as Piece & { len: number }).len, max);
  assert.equal((dragOntoAnchor(piece, 'len') as Piece & { len: number }).len, min);
  assert.equal(validateTrackDef(defFor({ ...piece, len: max + 1 } as Piece)).ok, false, 'the handle must not allow what the schema rejects');
  const snapped = applyHandle(piece, 'len', { x: 450 - 225, y: 1500 + 225 }, true) as Piece & { len: number };
  assert.equal(snapped.len % 25, 0, `grid snapping left the arm at ${snapped.len}, off the 25-unit lattice`);
  assert.ok(validateTrackDef(defFor(snapped)).ok);
});

// ---- 2. a size in the panel means a handle on the canvas ----------------------------------------

const SIZE_HANDLES = [
  { t: 'sling', id: 'size', field: 'size', range: HANDLE_RANGES.slingSize },
  { t: 'crusher', id: 'w', field: 'w', range: HANDLE_RANGES.crusherW },
  { t: 'platform', id: 'w', field: 'w', range: HANDLE_RANGES.platformW },
] as const;

for (const { t, id, field: key, range } of SIZE_HANDLES) {
  test(`${t}: a ${key} handle resizes it on the canvas within the panel's range`, () => {
    for (const flip of [false, true]) {
      const piece = { ...defaultPiece(t as never, { x: 300, y: 1500 }), flip } as Piece;
      const current = field(piece, key);
      // The handle is drawn where the shape's own geometry puts it, so it round-trips.
      assert.ok(Math.abs(field(applyHandle(piece, id, handleById(piece, id), false), key) - current) < 1e-6, `flip=${flip}: the handle resized the piece on its own`);
      assert.ok(field(dragHandle(piece, id, 60), key) > current, `flip=${flip}: dragging out did not grow ${key}`);
      assert.equal(field(dragHandle(piece, id, 6000), key), range.max);
      assert.equal(field(dragOntoAnchor(piece, id), key), range.min);
      // And whatever it produces is a def the race accepts and can build.
      for (const next of [dragHandle(piece, id, 60), dragHandle(piece, id, 6000), dragOntoAnchor(piece, id)]) {
        const def = defFor(next);
        assert.ok(validateTrackDef(def).ok, `${key}=${field(next, key)} left the schema`);
        assert.equal(buildEditorTrack(def).error, null);
      }
    }
  });
}

test('Crusher keeps its travel handle distinct from the new plate-width handle', () => {
  const piece = defaultPiece('crusher', CURSOR) as Piece & { w: number; travel: number };
  assert.deepEqual(handlesFor(piece).map((h) => h.id), ['move', 'travel', 'w']);
  const travel = handleById(piece, 'travel');
  assert.equal(field(applyHandle(piece, 'travel', travel, false), 'travel'), piece.travel);
  assert.equal(field(dragHandle(piece, 'w', 40), 'travel'), piece.travel, 'widening the plate moved its slam');
  assert.equal(field(applyHandle(piece, 'travel', { x: travel.x, y: travel.y + 40 }, false), 'w'), piece.w, 'setting the travel resized the plate');
});

test('Moving platform keeps its two route ends as separate controls from the deck width', () => {
  const piece = defaultPiece('platform', CURSOR) as Piece & { ax: number; ay: number; bx: number; by: number; w: number };
  assert.deepEqual(handlesFor(piece).map((h) => h.id), ['move', 'a', 'b', 'w']);
  const a = handleById(piece, 'a');
  const moved = applyHandle(piece, 'a', { x: a.x - 50, y: a.y + 25 }, false) as typeof piece;
  assert.equal(moved.ax, piece.ax - 50);
  assert.equal(moved.bx, piece.bx, 'dragging end A moved end B too');
  assert.equal(moved.w, piece.w, 'dragging an endpoint resized the deck');
  const mid = (piece.ax + piece.bx) / 2;
  const wide = applyHandle(piece, 'w', { x: mid + 90, y: (piece.ay + piece.by) / 2 }, false) as typeof piece;
  assert.equal(wide.w, 180);
  assert.deepEqual({ ax: wide.ax, ay: wide.ay, bx: wide.bx, by: wide.by }, { ax: piece.ax, ay: piece.ay, bx: piece.bx, by: piece.by }, 'the deck width handle moved the route');
});

test('Sling: the size handle sits behind the wedge and every size in range still races', () => {
  const piece = defaultPiece('sling', { x: 300, y: 1500 }) as Piece & { size: number; facing: number };
  assert.deepEqual(handlesFor(piece).map((h) => h.id), ['move', 'size']);
  // facing 245° kicks up-left, so the wedge body — and its handle — hang down-right of the anchor.
  const h = handleById(piece, 'size');
  assert.ok(h.x > piece.x && h.y > piece.y, `the size handle sat at (${h.x.toFixed(1)}, ${h.y.toFixed(1)})`);
  // One shared scale: the handle is exactly one `size` out from the anchor, so it round-trips.
  assert.ok(Math.abs(Math.hypot(h.x - piece.x, h.y - piece.y) - piece.size) < 1e-6);
  const spans: number[] = [];
  for (const size of [HANDLE_RANGES.slingSize.min, 90, HANDLE_RANGES.slingSize.max]) {
    const def = defFor({ ...piece, size } as Piece);
    assert.ok(validateTrackDef(def).ok, `size ${size} is outside the schema's range`);
    const built = buildEditorTrack(def);
    assert.equal(built.error, null);
    // A bigger wedge must collide with more: the body's own bounds have to grow with the field.
    const body = built.track!.bodies.find((b) => b.plugin && (b.plugin as { kind?: string }).kind === 'sling');
    assert.ok(body, `size ${size} produced no sling body`);
    spans.push(body!.bounds.max.x - body!.bounds.min.x);
  }
  assert.ok(spans[0] < spans[1] && spans[1] < spans[2], `the sling collider ignored its size: ${spans.map((s) => s.toFixed(1)).join(', ')}`);
});

// ---- 3. the ghost previews the piece a click places --------------------------------------------

test('Every palette tile previews real geometry, not a fallback dot', () => {
  for (const tile of TILES) for (const snap of [false, true]) {
    const preview = ghostPreview(tile.id, CURSOR, snap);
    assert.ok(preview, `${tile.id} had no ghost at all`);
    assert.equal(preview!.label, tile.label);
    assert.equal(preview!.pieces.length, 1, `${tile.id} previewed ${preview!.pieces.length} pieces, expected one`);
    const ghost = preview!.pieces[0];
    assert.ok(ghost.parts.length > 0, `${tile.id} previewed nothing`);
    const { minX, maxX, minY, maxY } = bbox(ghost.parts);
    for (const v of [minX, maxX, minY, maxY]) assert.ok(Number.isFinite(v), `${tile.id} produced a non-finite ghost point`);
    // The old switch fell through to a six-pixel dot for most pieces; a preview must show the extent.
    assert.ok(maxX - minX > 12 || maxY - minY > 12, `${tile.id} previewed only ${maxX - minX}×${maxY - minY}`);
    // The preview is built from the very piece the click commits, handles and all.
    const placed = placementPieces(tile.id, CURSOR, snap)[0];
    assert.deepEqual(ghost.piece, placed);
    assert.deepEqual(ghost.handles, handlesFor(placed));
  }
});

test('A flipped piece is previewed where it is drawn, not where its numbers point', () => {
  for (const tile of TILES) {
    const piece = placementPieces(tile.id, { x: 300, y: 1500 }, false)[0];
    const plain = bbox(ghostPartsWorld(piece));
    const flipped = bbox(ghostPartsWorld({ ...piece, flip: true } as Piece));
    // Mirroring about the centre line keeps the vertical extent and swaps the horizontal one.
    assert.ok(Math.abs(flipped.minY - plain.minY) < 1e-6 && Math.abs(flipped.maxY - plain.maxY) < 1e-6, `${tile.id} moved vertically when mirrored`);
    assert.ok(Math.abs(W - plain.maxX - flipped.minX) < 1e-6 && Math.abs(W - plain.minX - flipped.maxX) < 1e-6, `${tile.id} did not mirror about the centre line`);
  }
});

test('Named variants preview their own preset, not the base piece', () => {
  const ghost = (id: string) => {
    const preview = ghostPreview(id, CURSOR, false);
    assert.ok(preview, `${id} had no ghost`);
    return preview!.pieces[0];
  };
  // A peg tile that only differs by colour still previews the radius and colour it places.
  assert.equal(bbox(ghost('ppeg').parts).maxX - bbox(ghost('ppeg').parts).minX, 20, 'the blue peg preview lost its radius');
  assert.equal(ghost('ppeg').tint, '#60a5fa');
  const item = ghost('ppeg-item');
  assert.equal(field(item.piece, 'r'), 13, 'the item peg places r=13 but previews something else');
  assert.equal(bbox(item.parts).maxX - bbox(item.parts).minX, 26);
  assert.equal(item.tint, '#4ade80');
  // A reversed belt must preview the other way down the lane.
  const back = ghost('conveyor-back');
  const forward = ghost('conveyor');
  assert.equal(field(back.piece, 'dir'), 1);
  assert.ok(arrows(back.parts)[0].to[0] < arrows(back.parts)[0].from[0], 'the reversed belt arrow still pointed downhill');
  assert.ok(arrows(forward.parts)[0].to[0] > arrows(forward.parts)[0].from[0], 'the plain belt arrow pointed backwards');
  // The bat hangs the way the piece is set up to swing: 172° for the right hand, 8° for the left.
  const batLen = field(ghost('flipper').piece, 'len');
  assert.ok(bbox(ghost('flipper-right').parts).minX < CURSOR.x - batLen * 0.9, 'the right flipper preview pointed its bat the wrong way');
  assert.ok(bbox(ghost('flipper').parts).maxX > CURSOR.x + batLen * 0.9, 'the left flipper preview pointed its bat the wrong way');
  // A weight trapdoor is the same hatch with a different trigger: the preview carries the piece.
  assert.equal(field(ghost('trapdoor-weight').piece, 'mode'), 'weight');
  // The tough barricade is thicker to break but not bigger: the outline is the piece's own box.
  const tough = ghost('barricade-tough');
  const boxPart = tough.parts.find((p) => p.kind === 'box') as Extract<GhostPart, { kind: 'box' }>;
  assert.equal(boxPart.w, field(tough.piece, 'w'));
  assert.equal(field(tough.piece, 'tough'), 8);
});

test('Trapdoor: the hinge stays under the cursor before and after the click', () => {
  for (const id of ['trapdoor', 'trapdoor-weight']) for (const click of [{ x: 437, y: 1500 }, { x: 300, y: 1600 }]) for (const snap of [false, true]) {
    const preview = ghostPreview(id, click, snap);
    assert.ok(preview);
    const piece = preview!.pieces[0].piece as Piece & { x: number; y: number; w: number; hinge: -1 | 1 };
    const anchorX = snap ? Math.round(click.x / 25) * 25 : click.x;
    // `defaultPiece` treats the click as the hinge, so the centre it stores sits half a leaf inboard…
    assert.equal(piece.x + (piece.hinge * piece.w) / 2, anchorX, `${id}: the placed hinge drifted off the cursor`);
    // …and the preview must mark that same point rather than the centre. (It used to be 55 out.)
    const hingeMark = preview!.pieces[0].parts.find((p) => p.kind === 'ring' && p.r === 6) as Extract<GhostPart, { kind: 'ring' }>;
    assert.ok(hingeMark, 'the preview must show where the hatch is hinged');
    assert.equal(hingeMark.x, anchorX);
    assert.equal(hingeMark.y, piece.y);
    // Placing then mirroring keeps the hinge on the mirrored side of the same world point.
    const mirrored = bbox(ghostPartsWorld({ ...piece, flip: true } as Piece));
    assert.ok(W - anchorX >= mirrored.minX && W - anchorX <= mirrored.maxX, 'the mirrored hatch no longer covers its hinge');
  }
});

test('Ghost geometry follows the fields of an edited piece, not the palette defaults', () => {
  const piece = { t: 'catapult', x: 400, y: 1200, len: 380, reload: 1400, dir: 1 } as Piece;
  const long = bbox(ghostPartsWorld(piece));
  assert.ok(long.maxX - long.minX > 380 * 0.7, `a 380-unit arm previewed only ${long.maxX - long.minX} wide`);
  assert.ok(long.maxY > 1200 + 380 * 0.7, 'the preview did not hang along the resting arm');
  const short = bbox(ghostPartsWorld({ ...piece, len: 120 } as Piece));
  assert.ok(short.maxX - short.minX < long.maxX - long.minX, 'the short arm previewed no smaller');
  // A dragged platform route and a widened deck both show up.
  const deck = { t: 'platform', ax: 200, ay: 1000, bx: 700, by: 1200, w: 300, travel: 2600, pause: 1800, phase: 0 } as Piece;
  const deckBox = bbox(ghostPartsWorld(deck));
  assert.equal(deckBox.minX, 200 - 150);
  assert.equal(deckBox.maxX, 700 + 150);
  assert.equal(deckBox.minY, 1000 - 8);
});

test('Template preview shows the whole group at the coordinates it lands on', () => {
  const tpl: SavedTemplate = {
    id: `${TEMPLATE_ARM}audit`,
    name: 'Twin walls',
    sprite: 'tile-metal',
    pieces: [
      { t: 'wall', x: -100, y: 0, w: 120, h: 24 } as Piece,
      { t: 'wall', x: 100, y: 0, w: 120, h: 24 } as Piece,
      { t: 'ramp', a: [-40, 60], b: [40, 90] } as Piece,
    ],
  };
  const preview = ghostPreview(tpl.id, CURSOR, false, [tpl]);
  assert.ok(preview);
  assert.equal(preview!.label, 'Twin walls');
  assert.equal(preview!.pieces.length, 3, 'a template ghost must carry every piece of the group');
  const committed = placementPieces(tpl.id, CURSOR, false, [tpl]);
  assert.deepEqual(preview!.pieces.map((g) => g.piece), committed, 'the ghost and the click placed different groups');
  // The group is placed as one block: its anchor piece lands on the cursor and nothing comes apart.
  const xs = committed.slice(0, 2).map((p) => field(p, 'x'));
  assert.equal(xs[0], CURSOR.x);
  assert.equal(xs[1] - xs[0], 200, 'the template lost the spacing between its pieces');
  preview!.pieces.forEach((ghost, i) => {
    assert.ok(ghost.parts.length > 0, `piece ${i} of the template had no outline`);
    assert.deepEqual(ghost.handles, handlesFor(committed[i]));
  });
  // With the grid on, the group still moves as one block — onto the lattice, from the same raw click.
  const raw = placementPieces(tpl.id, { x: 462, y: 1511 }, false, [tpl])!;
  const snapped = placementPieces(tpl.id, { x: 462, y: 1511 }, true, [tpl])!;
  assert.equal(field(snapped[0], 'x') % 25, 0);
  assert.equal(field(snapped[1], 'x') - field(snapped[0], 'x'), 200, 'the group came apart when it snapped');
  assert.deepEqual(snapped, raw.map((p) => movePiece(p, -12, -11)), 'the snapped group is not the same block slid onto the lattice');

  // The transform is #74's `placeTemplate`, not a second copy of it: legacy anchors and the
  // centre-normalised v2 format (whose origin is the group centre, and whose buckets keep their
  // fixed horizontal route) preview exactly where they land because both sides call the same function.
  const v2: SavedTemplate = { ...tpl, version: 2, pieces: tpl.pieces.map((piece) => movePiece(piece, -180, -30)) };
  for (const armed of [tpl, v2]) {
    for (const snap of [false, true]) {
      for (const at of [CURSOR, { x: 462, y: 1511 }]) {
        assert.deepEqual(placementPieces(armed.id, at, snap, [armed]), placeTemplate(armed, at, snap),
          `template v${armed.version ?? 1} previewed a different group than the click would place`);
      }
    }
  }
});

test('Armed ids the palette does not know place nothing, and an unplaceable template is refused', () => {
  for (const armed of ['not-a-piece', '']) {
    assert.deepEqual(placementPieces(armed, CURSOR, false, []), []);
    assert.equal(ghostPreview(armed, CURSOR, false, []), null);
  }
  // An armed template that cannot be placed as it stands — deleted, emptied, or wider than the track
  // — is `null` from `placementPieces`: the editor says so and the ghost draws the refusal instead of
  // a placement the click would not make (#74).
  const tooWide: SavedTemplate = {
    id: `${TEMPLATE_ARM}wide`,
    name: 'Too wide',
    sprite: 'tile-metal',
    pieces: [
      { t: 'wall', x: -W, y: 0, w: 120, h: 24 } as Piece,
      { t: 'wall', x: W, y: 0, w: 120, h: 24 } as Piece,
    ],
  };
  for (const tpl of [tooWide, { id: `${TEMPLATE_ARM}empty`, name: 'Empty', sprite: 'tile-metal', pieces: [] }]) {
    assert.equal(placementPieces(tpl.id, CURSOR, false, [tpl]), null, 'a group that does not fit was still placed');
    assert.deepEqual(ghostPreview(tpl.id, CURSOR, false, [tpl]), { label: tpl.name, pieces: [], invalid: true });
  }
  assert.equal(placementPieces(`${TEMPLATE_ARM}missing`, CURSOR, false, []), null);
});
