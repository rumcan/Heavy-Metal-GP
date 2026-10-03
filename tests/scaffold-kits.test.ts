/** Scaffold tunnels: ten premade kits of curve rails, each roomy for a marble, inside the track, and rollable end to end. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { Game } from '../src/game/engine';
import { buildTrackFromDef, validateTrackDef } from '../src/game/trackdef';
import type { Piece } from '../src/game/trackdef';
import { blankTemplate } from '../src/game/templates';
import { translatePiece } from '../src/components/editor/translation';
import { PHYSICS_STEP } from '../src/game/physics';
import { W } from '../src/game/track';
import { MARBLE_RADIUS } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { scaffoldKits, scaffoldKitById, MIN_TUBE_GAP, TUBE_GAP } from '../src/game/scaffold-kits';

const driver: MarbleInfo = { id: 0, name: 'Tester', color: '#ff0000', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true } as MarbleInfo;
/** Longest a marble may take from the mouth to the far end (seconds of race clock). */
const MAX_SECONDS = 45;

test('scaffold kits: ten of them with unique ids and names', () => {
  const kits = scaffoldKits();
  assert.equal(kits.length, 10);
  assert.equal(new Set(kits.map((k) => k.id)).size, 10);
  assert.equal(new Set(kits.map((k) => k.name)).size, 10);
  assert.equal(scaffoldKitById('nope').id, kits[0].id, 'an unknown id falls back to the first kit');
});

test('scaffold kits: the tube is always wider than a marble', () => {
  assert.ok(TUBE_GAP >= 30 && TUBE_GAP >= MIN_TUBE_GAP, `${TUBE_GAP}px gap`);
  assert.ok(MIN_TUBE_GAP >= MARBLE_RADIUS * 2);
});

function placed(kitId: string) {
  const kit = scaffoldKitById(kitId);
  const cx = W / 2, cy = kit.height / 2 + 500;
  const pieces = kit.pieces.map((p) => translatePiece(p as Piece, cx, cy));
  return { kit, cx, cy, pieces, height: Math.round(cy + kit.height / 2 + 700) };
}

for (const kit of scaffoldKits()) {
  test(`scaffold kit "${kit.name}": curve rails only, one group, scaffold skin, centred, and it validates`, () => {
    assert.ok(kit.pieces.length >= 4, `${kit.pieces.length} rails`);
    assert.ok(kit.pieces.every((p) => p.t === 'curve' && p.skin === 'scaffold' && p.grp === kit.pieces[0].grp));
    const xs = kit.pieces.flatMap((p) => [p.a[0], p.b[0], p.c[0]]), ys = kit.pieces.flatMap((p) => [p.a[1], p.b[1], p.c[1]]);
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2) < 40, 'centred horizontally');
    assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2) < 40, 'centred vertically');
    assert.ok(kit.width < W, `${kit.width}px wide does not fit the ${W}px track`);
    const { pieces, height } = placed(kit.id);
    const check = validateTrackDef({ ...blankTemplate(), height, pieces });
    assert.ok(check.ok, check.ok ? '' : check.error);
  });

  test(`scaffold kit "${kit.name}": bends are wide enough for the rails and lanes keep clear of each other`, () => {
    const c = kit.centre, k = 6;
    for (let i = k; i < c.length - k; i++) {
      const [a, b, d] = [c[i - k], c[i], c[i + k]];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bd = Math.hypot(d[0] - b[0], d[1] - b[1]), ad = Math.hypot(d[0] - a[0], d[1] - a[1]);
      const area2 = Math.abs((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]));
      const radius = area2 < 1e-6 ? Infinity : (ab * bd * ad) / (2 * area2);
      assert.ok(radius >= 55, `a bend of radius ${Math.round(radius)}px at sample ${i}: the inner rail would fold over itself`);
    }
    // Two stretches of the tube far apart along it must not run into each other's rails (each rail band reaches 43 px out).
    for (let i = 0; i < c.length; i += 3) for (let j = i + 40; j < c.length; j += 3) {
      const d = Math.hypot(c[i][0] - c[j][0], c[i][1] - c[j][1]);
      assert.ok(d >= kit.half[i] + kit.half[j] + 26 + 4 || j - i < 40 * 1.5, `samples ${i} and ${j} are only ${Math.round(d)}px apart`);
    }
  });

  test(`scaffold kit "${kit.name}": a marble dropped at the mouth rolls out of the far end`, () => {
    const { cx, cy, pieces, height } = placed(kit.id);
    const track = buildTrackFromDef({ ...blankTemplate(), height, pieces });
    const game = new Game(1, [driver], { track, effects: false, aiItems: false, recovery: false });
    game.openGate();
    const m = game.player;
    const entry = { x: cx + kit.entry[0], y: cy + kit.entry[1] }, exit = { x: cx + kit.exit[0], y: cy + kit.exit[1] };
    Matter.Body.setPosition(m.body, entry);
    Matter.Body.setVelocity(m.body, { x: 0, y: 0 });
    const centre = kit.centre.map((v) => ({ x: cx + v[0], y: cy + v[1] }));
    let reached = -1, closest = Infinity, strayed = 0;
    for (let i = 0; i < MAX_SECONDS * 120; i++) {
      game.step(PHYSICS_STEP);
      const d = Math.hypot(m.body.position.x - exit.x, m.body.position.y - exit.y);
      closest = Math.min(closest, d);
      if (d < 50) { reached = i * PHYSICS_STEP / 1000; break; }
      // Staying inside: always near the centre line (the rails are 30 px either side of it).
      let off = Infinity, k = 0;
      centre.forEach((c, n) => { const e = Math.hypot(m.body.position.x - c.x, m.body.position.y - c.y); if (e < off) { off = e; k = n; } });
      strayed = Math.max(strayed, off / kit.half[k]);
    }
    game.destroy();
    assert.ok(reached >= 0, `never reached the far end (closest ${Math.round(closest)}px, strayed ${strayed.toFixed(2)})`);
    assert.ok(strayed < 1, `left the tube: ${strayed.toFixed(2)} of the way to a rail`);
  });
}

// ------------------------------------------------------------------ the skin, share codes and the Workshop stamp
import { encodeShareCode, decodeShareCode } from '../src/game/sharecode';
import { placementPieces } from '../src/components/editor/ghost';
import { chooseScaffoldKit } from '../src/game/scaffold-kits';
import { meta } from '../src/game/track';

test('scaffold skin: only known skins validate, and a piece keeps its skin', () => {
  const { pieces, height } = placed('s-bend');
  const ok = validateTrackDef({ ...blankTemplate(), height, pieces });
  assert.ok(ok.ok);
  if (ok.ok) assert.ok(ok.def.pieces.every((p) => p.skin === 'scaffold'));
  const bad = validateTrackDef({ ...blankTemplate(), height, pieces: pieces.map((p, i) => (i === 0 ? { ...p, skin: 'chrome' } : p)) });
  assert.ok(!bad.ok);
  if (!bad.ok) assert.match(bad.error, /skin must be one of/);
});

test('scaffold skin: the built rail bodies carry it, plain rails do not', () => {
  const { pieces, height } = placed('u-turn');
  const track = buildTrackFromDef({ ...blankTemplate(), height, pieces: [...pieces, { t: 'ramp', a: [100, 200], b: [300, 260] }] });
  const ramps = track.bodies.filter((b) => meta(b)?.kind === 'ramp');
  const skinned = ramps.filter((b) => meta(b).skin === 'scaffold');
  assert.ok(skinned.length > 40, `${skinned.length} skinned slabs`);
  assert.equal(ramps.length - skinned.length, ramps.filter((b) => !meta(b).skin).length);
  assert.ok(ramps.some((b) => !meta(b).skin), 'a plain ramp stays plain');
});

test('scaffold skin: survives a share code round trip, and old codes without it still decode', async () => {
  const { pieces, height } = placed('hairpin-stack');
  const def = { ...blankTemplate(), height, pieces: [...pieces, { t: 'ramp', a: [100, 200], b: [300, 260] } as Piece] };
  const back = await decodeShareCode(await encodeShareCode(def));
  const skinned = back.pieces.filter((p) => p.skin === 'scaffold');
  assert.equal(skinned.length, pieces.length);
  assert.equal(back.pieces.filter((p) => p.skin === undefined).length, 1);
  const plain = await decodeShareCode(await encodeShareCode({ ...blankTemplate(), height: 3000, pieces: [{ t: 'ramp', a: [100, 200], b: [300, 260] }] }));
  assert.equal(plain.pieces[0].skin, undefined);
});

test('scaffold tunnels: the Workshop tile stamps the whole kit as one group, inside the track', () => {
  for (const kit of scaffoldKits()) {
    chooseScaffoldKit(kit.id);
    // Even clicked hard against the left wall the kit is slid inside the track.
    for (const x of [30, 450, 880]) {
      const stamped = placementPieces('scaffold', { x, y: 2000 }, true);
      assert.ok(stamped, `${kit.name} at x=${x}`);
      assert.equal(stamped!.length, kit.pieces.length);
      assert.ok(stamped!.every((p) => p.t === 'curve' && p.skin === 'scaffold' && p.grp === stamped![0].grp), 'one group, all skinned');
      const xs = stamped!.flatMap((p) => (p.t === 'curve' ? [p.a[0], p.b[0]] : []));
      assert.ok(Math.min(...xs) > 0 && Math.max(...xs) < W, `${kit.name} at x=${x} pokes out of the track`);
      assert.ok(validateTrackDef({ ...blankTemplate(), height: 6000, pieces: stamped! }).ok);
    }
  }
  chooseScaffoldKit('sweeper-left');
});
