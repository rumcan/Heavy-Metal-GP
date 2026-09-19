// ══════════════════════════════════════════════════════════════════════════
// MP-CHAT — the rules of drivers talking, without a room, a socket or a
// browser.
//
// `src/net/chat.ts` is the half of chat that is not React and not the wire,
// and every rule in it is a rule about a line somebody typed:
//
//   - what a line IS (trimmed, one line, cut to the ceiling the wire will
//     carry);
//   - how much history a screen keeps (bounded — a lobby is six people, not
//     an archive);
//   - how often a driver may talk (a held Enter is not a sentence);
//   - and WHO a line is from, which is read off the SEAT TABLE rather than
//     the frame, so a name and a livery are the ones on the grid.
//
// Pure: no SDK, no DOM, no `season.ts`.
// ══════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_BUBBLE_MS,
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY,
  MAX_CHAT_LENGTH,
  UNKNOWN_SPEAKER_COLOR,
  appendChat,
  canSay,
  chatLine,
  chatMessage,
  offCooldown,
  speakerOf,
  trimChatText,
} from '../src/net/chat';
import type { ChatLine } from '../src/net/chat';
import { validateMessage, type Seat } from '../src/net/protocol';

const HOST = 'player-host';
const GUEST = 'player-guest';

function seats(): Seat[] {
  return Array.from({ length: 10 }, (_, slot) => ({
    slot,
    playerId: slot === 0 ? HOST : slot === 1 ? GUEST : '',
    name: slot === 0 ? 'Sprocket' : slot === 1 ? 'Nugget' : `Rival ${slot}`,
    color: slot === 0 ? '#22d3ee' : slot === 1 ? '#f97316' : '#888888',
    stats: { weight: 5, speed: 5, bounce: 5 },
    portrait: slot,
    isAI: slot > 1,
    ready: true,
  }));
}

const T0 = 1_700_000_000_000;

/** A log of `n` lines, oldest first, from `from`. */
function log(n: number, from = HOST): ChatLine[] {
  let out: ChatLine[] = [];
  for (let i = 0; i < n; i++) out = appendChat(out, chatLine(i + 1, from, `line ${i}`, T0 + i));
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// The line
// ══════════════════════════════════════════════════════════════════════════

test('MP-CHAT line: a typed line is trimmed, flattened and cut to the ceiling', () => {
  assert.equal(trimChatText('  Boxes at turn three  '), 'Boxes at turn three');
  // A speech bubble has no paragraphs: a newline is a space or it is nothing.
  assert.equal(trimChatText('one\ntwo'), 'one two');
  assert.equal(trimChatText('one\n\n  two'), 'one two');
  assert.equal(trimChatText('\t\t'), '');
  // Cut, not wrapped — and the cut is at the wire's own ceiling.
  assert.equal(trimChatText('x'.repeat(500)).length, MAX_CHAT_LENGTH);
  assert.equal(validateMessage(chatMessage('x'.repeat(500))), null, 'what the helper sends, the wire accepts');
  // Nothing but whitespace is not a line.
  assert.equal(canSay('   '), false);
  assert.equal(canSay('a'), true);
});

test('MP-CHAT line: the frame carries the trimmed line and nothing else', () => {
  const msg = chatMessage('  Watch the oil  ');
  assert.deepEqual(msg, { type: 'chat', text: 'Watch the oil' });
  assert.equal(validateMessage(msg), null);
  // A line too long for the wire is refused by the wire — which is why the
  // helper cuts it before it is ever sent.
  assert.ok(validateMessage({ type: 'chat', text: 'x'.repeat(MAX_CHAT_LENGTH + 1) }));
});

// ══════════════════════════════════════════════════════════════════════════
// The log
// ══════════════════════════════════════════════════════════════════════════

test('MP-CHAT log: the newest line is at the bottom, and the log is bounded', () => {
  let out: ChatLine[] = [];
  for (let i = 1; i <= CHAT_HISTORY + 12; i++) out = appendChat(out, chatLine(i, HOST, `line ${i}`, T0 + i));
  assert.equal(out.length, CHAT_HISTORY, 'a lobby does not keep an archive');
  // Trimmed from the FRONT: the bottom of the log is what a driver came to read.
  assert.equal(out[0].text, `line ${13}`);
  assert.equal(out[out.length - 1].text, `line ${CHAT_HISTORY + 12}`);
  // Order is arrival order, whatever the stamps say.
  for (let i = 1; i < out.length; i++) assert.ok(out[i].at >= out[i - 1].at);
});

test('MP-CHAT log: the same line twice is printed once', () => {
  // The room echoes every line to everybody, speaker included: a screen that
  // printed the echo as well as its own copy would talk to itself twice.
  const one = appendChat([], chatLine(1, HOST, 'hello', T0));
  const two = appendChat(one, chatLine(1, HOST, 'hello', T0));
  assert.equal(two.length, 1);
  assert.equal(two, one, 'a re-print hands back the same log');
});

test('MP-CHAT log: an empty log is a legal log, and one line is a conversation', () => {
  assert.deepEqual(appendChat([], chatLine(1, GUEST, 'hi', T0)), [{ id: 1, from: GUEST, text: 'hi', at: T0 }]);
  assert.deepEqual(log(0), []);
});

// ══════════════════════════════════════════════════════════════════════════
// The cooldown and the bubble
// ══════════════════════════════════════════════════════════════════════════

test('MP-CHAT cooldown: a held key is not a conversation', () => {
  assert.equal(offCooldown(T0, -Infinity), true, 'the first line is always allowed');
  assert.equal(offCooldown(T0 + CHAT_COOLDOWN_MS - 1, T0), false);
  assert.equal(offCooldown(T0 + CHAT_COOLDOWN_MS, T0), true);
  // Two seconds between lines is an argument, not a flood.
  assert.ok(CHAT_COOLDOWN_MS > 0 && CHAT_COOLDOWN_MS < 1000);
});

test('MP-CHAT bubble: a line hangs around long enough to read, and not longer', () => {
  // Long enough for a sentence at a glance while driving; short enough that
  // two drivers trading lines do not bury the track.
  assert.ok(CHAT_BUBBLE_MS >= 2000, `${CHAT_BUBBLE_MS}ms is not enough to read a line`);
  assert.ok(CHAT_BUBBLE_MS <= 8000, `${CHAT_BUBBLE_MS}ms is a billboard, not a bubble`);
});

// ══════════════════════════════════════════════════════════════════════════
// The speaker
// ══════════════════════════════════════════════════════════════════════════

test('MP-CHAT speaker: a line is signed with the name and livery on the grid', () => {
  const grid = seats();
  assert.deepEqual(speakerOf(grid, HOST), { name: 'Sprocket', color: '#22d3ee', seat: 0 });
  assert.deepEqual(speakerOf(grid, GUEST), { name: 'Nugget', color: '#f97316', seat: 1 });
  // The seat is what a race bubble hangs off, so it is the same numbering the
  // packed frames use — no translation table to get wrong.
  assert.equal(speakerOf(grid, GUEST).seat, 1);
});

test('MP-CHAT speaker: an AI seat is never a speaker, and a stranger is a rival', () => {
  const grid = seats();
  // A machine has no voice here. A line that arrived under an AI's id is
  // either a bug or a forgery, and neither gets a name on the timing tower.
  assert.equal(speakerOf(grid, '').seat, null);
  assert.equal(speakerOf(grid, undefined).seat, null);
  const stranger = speakerOf(grid, 'player-who-left');
  assert.equal(stranger.seat, null, 'a driver with no seat is not on the grid');
  assert.equal(stranger.color, UNKNOWN_SPEAKER_COLOR);
  assert.ok(stranger.name.length > 0, 'even a stranger is somebody');
  // The AI seats carry no player id, so they can never be picked up as a speaker.
  assert.equal(speakerOf(grid, grid[4].playerId).seat, null, 'an AI seat has no player id to match');
});

test('MP-CHAT speaker: an empty grid leaves nobody to name', () => {
  assert.equal(speakerOf([], HOST).seat, null);
});
