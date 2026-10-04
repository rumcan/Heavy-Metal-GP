// P2-11: racing Community tracks online. What failed: the lobby had no Community source at all, and a custom track
// the host did pick was lost the moment a guest readied up (the memoised publish re-sent a stale, code-less settings
// frame). Here: room codes round-trip to the same def, oversize codes are refused with a reason, and the settings
// the host publishes always carry the current code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRoomCode, roomCodeFor } from '../src/game/room-track';
import { decodeShareCode } from '../src/game/sharecode';
import { MAX_CUSTOM_CODE_CHARS, readRaceSettings } from '../src/net/protocol';
import { blankTemplate } from '../src/game/templates';

const lobby = readFileSync(new URL('../src/components/OnlineLobby.tsx', import.meta.url), 'utf8');

test('a track shared with the room decodes to the same def on every machine and passes the wire check', async () => {
  const def = { ...blankTemplate(), name: 'Room Test', height: 3000, pieces: [{ t: 'ramp' as const, a: [200, 600] as [number, number], b: [700, 800] as [number, number] }] };
  const room = await roomCodeFor(def);
  assert.ok(room.ok, room.ok ? '' : room.reason);
  if (!room.ok) return;
  assert.ok(room.code.length <= MAX_CUSTOM_CODE_CHARS);
  const back = await decodeShareCode(room.code);
  assert.equal(back.name, def.name);
  assert.equal(back.pieces.length, def.pieces.length);
  assert.ok(readRaceSettings({ circuit: 0, customCode: room.code }), 'the settings frame with the code is valid');
});

test('a code over the limit is refused with a sentence the host can act on', () => {
  const big = checkRoomCode('1-' + 'a'.repeat(MAX_CUSTOM_CODE_CHARS), 'Monster');
  assert.equal(big.ok, false);
  if (!big.ok) assert.match(big.reason, /Monster.*too big.*Workshop/);
  assert.deepEqual(checkRoomCode('1-abc', 'Small'), { ok: true, code: '1-abc' });
});

test('the lobby offers Community tracks and courses, and publishes the current code (not a stale one)', () => {
  assert.match(lobby, />Community<\/button>/);
  assert.match(lobby, /<CommunityPicker[^>]*kind="platformer"/, "the lobby lists community platformer courses");
  assert.match(lobby, /if \(l\.customCode\)/, 'hostSettings reads the code through latest');
  assert.doesNotMatch(lobby, /if \(customCode\) \(base/, 'no captured customCode in hostSettings');
});
