import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { buildTrackFromDef, validateTrackDef, isRetiredPieceType, RETIRED_PIECE_TYPES, type TrackDef } from '../src/game/trackdef';
import { decodeShareCode } from '../src/game/sharecode';
import { THEME_IDS } from '../src/game/types';
import { buildEditorTrack } from '../src/components/editor/build';

// #99: the track switch lever (`switch`), the scoop (`scoop`) and the skipping pond (`pool`) are
// out of the game. Anything an older build saved — workshop drafts, community tracks and share
// codes — must still load; the retired pieces are silently dropped, never an error or a crash.

test('#99: validation drops retired pieces instead of failing', () => {
  const legacy = {
    v: 1, name: 'Legacy draft', seed: 7, theme: 'classic', height: 3000,
    pieces: [
      { t: 'switch', x: 450, y: 800, len: 120, angle: 0.65, side: 0 },
      { t: 'scoop', x: 300, y: 1400, deg: 276, hold: 800, exit: [420, 1600, 1400] },
      { t: 'pool', a: [290, 2000], b: [620, 2000], depth: 96, skip: 6.5 },
      { t: 'ramp', a: [0, 400], b: [890, 700] },
    ],
  } as unknown as TrackDef;
  const check = validateTrackDef(legacy);
  assert.ok(check.ok, check.ok ? '' : check.errors.join('; '));
  assert.deepEqual(check.def.pieces.map((p) => p.t), ['ramp'], 'only the valid piece survives');
});

test('#99: the race builder ignores retired pieces but builds the rest', () => {
  const legacy = {
    v: 1, name: 'Legacy draft', seed: 7, theme: 'classic', height: 3000,
    pieces: [
      { t: 'pool', a: [290, 900], b: [620, 900], depth: 96, skip: 6.5 },
      { t: 'scoop', x: 300, y: 1400, deg: 276, hold: 800 },
      { t: 'ramp', a: [0, 400], b: [890, 700] },
    ],
  } as unknown as TrackDef;
  const track = buildTrackFromDef(legacy);
  assert.ok(track.bodies.length > 0);
  assert.ok(!track.bodies.some((b) => ['pool', 'scoop', 'switch', 'switchPad'].includes((b.plugin as { kind?: string } | undefined)?.kind ?? '')),
    'no retired body kinds in the built track');
});

test('#99: the Workshop opens a draft with retired pieces (they are not drawn or selectable)', () => {
  const legacy = {
    v: 1, name: 'Legacy draft', seed: 7, theme: 'classic', height: 3000,
    pieces: [
      { t: 'switch', x: 450, y: 800, len: 120, angle: 0.65, side: 1 },
      { t: 'ramp', a: [0, 400], b: [890, 700] },
    ],
  } as unknown as TrackDef;
  const editor = buildEditorTrack(legacy);
  assert.equal(editor.error, null);
  // The ramp (piece index 1) still maps to its body; the retired piece maps to none.
  assert.ok(editor.bodyToPiece.filter((p) => p === 1).length >= 1, 'the remaining piece keeps its bodies');
  assert.ok(editor.bodyToPiece.every((p) => p !== 0), 'the retired piece has no bodies at all');
});

// — share codes: hand-craft a code the way an older build encoded it, including retired pieces,
// and prove the decoder reads their bytes (the stream stays aligned) while dropping the pieces.
const uvarint = (out: number[], value: number) => {
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
};
const pushString = (out: number[], s: string) => {
  const enc = new TextEncoder().encode(s);
  uvarint(out, enc.length);
  out.push(...enc);
};

test('#99: an old-version share code with retired pieces decodes, dropping them', async () => {
  // PIECE_TYPES ids are positional and append-only: 0 ramp … 20 switch, 35 scoop, 39 pool.
  const wire: number[] = [];
  pushString(wire, 'Old build code');
  uvarint(wire, 11);                          // seed
  uvarint(wire, THEME_IDS.indexOf('classic'));
  uvarint(wire, 3000);                        // height
  uvarint(wire, 0);                           // no segments
  uvarint(wire, 5);                           // piece count: switch, scoop x2, pool, ramp
  // switch: (x, y, len, angle*1000, side)
  uvarint(wire, 20); uvarint(wire, 0);
  uvarint(wire, 450); uvarint(wire, 800); uvarint(wire, 120); uvarint(wire, 650); uvarint(wire, 0);
  // scoop, kickback flavour: (x, y, deg, hold, exitFlag=0)
  uvarint(wire, 35); uvarint(wire, 0);
  uvarint(wire, 300); uvarint(wire, 1400); uvarint(wire, 276); uvarint(wire, 800); uvarint(wire, 0);
  // scoop, subway flavour: exitFlag=1 followed by the exit triple
  uvarint(wire, 35); uvarint(wire, 0);
  uvarint(wire, 300); uvarint(wire, 1600); uvarint(wire, 276); uvarint(wire, 800); uvarint(wire, 1);
  uvarint(wire, 650); uvarint(wire, 1700); uvarint(wire, 1400);
  // pool: (a0, a1, b0, b1, depth, skip*10)
  uvarint(wire, 39); uvarint(wire, 0);
  uvarint(wire, 290); uvarint(wire, 2000); uvarint(wire, 620); uvarint(wire, 2000); uvarint(wire, 96); uvarint(wire, 65);
  // the valid trailing piece proves the stream stayed perfectly aligned through the retired bytes
  uvarint(wire, 0); uvarint(wire, 0); // ramp
  uvarint(wire, 0); uvarint(wire, 400); uvarint(wire, 890); uvarint(wire, 700);

  const code = '1-' + Buffer.from(deflateSync(Buffer.from(wire))).toString('base64url');
  const def = await decodeShareCode(code);
  assert.equal(def.pieces.length, 1, 'all four retired pieces are dropped');
  assert.equal(def.pieces[0].t, 'ramp');
  assert.deepEqual(def.pieces[0].t === 'ramp' && { a: def.pieces[0].a, b: def.pieces[0].b }, { a: [0, 400], b: [890, 700] },
    'the surviving piece decodes exactly (the retired bytes did not desync the stream)');
});

test('#99: the retire table covers every type the palette, builder and renderer dropped', () => {
  assert.deepEqual([...RETIRED_PIECE_TYPES], ['switch', 'scoop', 'pool']);
  for (const t of ['switch', 'scoop', 'pool', 'ramp']) {
    assert.equal(isRetiredPieceType(t), t !== 'ramp');
  }
  assert.ok(isRetiredPieceType('switchPad') === false, 'switchPad was a body kind, not a placeable type');
});
