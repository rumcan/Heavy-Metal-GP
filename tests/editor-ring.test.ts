/** Ring rail: a perfect plank circle — builds closed, round and capless, resizes, and survives save and share. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEditorTrack } from '../src/components/editor/build';
import { applyHandle, movePieces } from '../src/components/editor/handles';
import { validateTrackDef } from '../src/game/trackdef';
import type { Piece, TrackDef } from '../src/game/trackdef';
import { encodeShareCode, decodeShareCode } from '../src/game/sharecode';
import { blankTemplate } from '../src/game/templates';
import { meta, W } from '../src/game/track';

const RING: Piece = { t: 'ring', x: 450, y: 900, r: 150, thick: 26 };
const defOf = (pieces: Piece[]): TrackDef => ({ ...blankTemplate(), height: 3000, pieces });

test('ring: builds a closed, round, capless hoop centred on its radius', () => {
  const built = buildEditorTrack(defOf([RING]));
  assert.equal(built.error, null);
  const bodies = built.track!.bodies.filter((_, i) => built.bodyToPiece[i] === 0);
  assert.ok(bodies.length >= 24, `${bodies.length} segments`);
  for (const b of bodies) {
    assert.deepEqual(meta(b)?.caps, [], 'no iron end caps');
    const d = Math.hypot(b.position.x - 450, b.position.y - 900);
    assert.ok(Math.abs(d - 150) < 3, `segment centre at radius ${d.toFixed(1)}`);
  }
  const box = built.pieceBounds[0];
  assert.ok(Math.abs((box.max.x - box.min.x) - (box.max.y - box.min.y)) < 6, 'as wide as it is tall');
});

test('ring: side dot sets the radius, top dot the thickness, corners scale the radius', () => {
  assert.equal((applyHandle(RING, 'r', { x: 450 + 220, y: 900 }, false) as { r: number }).r, 220);
  const thick = applyHandle(RING, 'thick', { x: 450, y: 900 - 150 - 20 }, false) as { thick: number };
  assert.equal(thick.thick, 40);
  const box = buildEditorTrack(defOf([RING])).pieceBounds[0];
  const grown = applyHandle(RING, 'box-se', { x: box.max.x + 160, y: box.max.y + 160 }, false, box) as { r: number; thick: number };
  assert.ok(grown.r > 190, `radius grew to ${grown.r}`);
  assert.equal(grown.thick, 26, 'thickness has its own handle');
});

test('ring: survives a save and a share code', async () => {
  const def = defOf([RING, { ...RING, x: 300, y: 1500, r: 90, thick: 14, flip: true }]);
  const checked = validateTrackDef(JSON.parse(JSON.stringify(def)));
  assert.ok(checked.ok, checked.ok ? '' : checked.error);
  const back = await decodeShareCode(await encodeShareCode(def));
  assert.deepEqual(back.pieces, def.pieces);
});

test('group move: a selection may run into the side walls; a single item stops at the wall', () => {
  const section: Piece[] = [{ t: 'ramp', a: [100, 500], b: [300, 560] }, { t: 'wall', x: 200, y: 620, w: 20, h: 80 }];
  const moved = movePieces(section, -500, 0);
  const ramp = moved[0] as Extract<Piece, { t: 'ramp' }>;
  assert.equal(ramp.a[0], -200, 'group slides into the wall margin');
  assert.ok(validateTrackDef(defOf(moved)).ok, 'still saveable');
  const single = movePieces([section[0]], -500, 0)[0] as Extract<Piece, { t: 'ramp' }>;
  assert.equal(single.a[0], 0, 'a lone ramp stops at the wall');
  void W;
});

test('sign: decoration with text — collides with nothing, keeps its words through save and share', async () => {
  const sign: Piece = { t: 'sign', x: 300, y: 700, w: 180, text: 'SHORTCUT → 💀' };
  const built = buildEditorTrack(defOf([sign]));
  assert.equal(built.error, null);
  const body = built.track!.bodies.find((_, i) => built.bodyToPiece[i] === 0)!;
  assert.equal(body.collisionFilter.mask, 0, 'marbles pass through');
  assert.equal(meta(body)?.sign?.text, 'SHORTCUT → 💀');
  const def = defOf([sign, { ...sign, x: 600, text: 'x'.repeat(60), flip: true }]);
  const checked = validateTrackDef(JSON.parse(JSON.stringify(def)));
  assert.ok(checked.ok);
  assert.equal((checked.ok && (checked.def.pieces[1] as { text: string }).text.length), 40, 'text capped at 40');
  const back = await decodeShareCode(await encodeShareCode(checked.ok ? checked.def : def));
  assert.equal((back.pieces[0] as { text: string }).text, 'SHORTCUT → 💀');
});
