// ══════════════════════════════════════════════════════════════════════════
// MP-CHAT — the RULES of drivers talking, with no React, no SDK and no
// socket in sight.
//
// A chat is a log of lines and a clock. Everything here is the part of that
// worth testing without a browser:
//
//   - a line is CLAMPED and TRIMMED before it goes anywhere. The wire refuses
//     a line longer than `MAX_CHAT_LENGTH`, so the UI and the wire agree on
//     one number — what is typed is what travels, and nothing is cut in half
//     on the way.
//   - the log is BOUNDED. A lobby is a room with six seats in it; sixty lines
//     is more history than a race has, and an unbounded array in React state
//     is a slow leak with a scroll bar.
//   - a driver may not FLOOD it. The cooldown is a client-side courtesy, not
//     a law — the room is free to relay whatever it is given — but a key held
//     down is not a conversation and should not read as one.
//   - a line's AUTHOR is resolved from the SEAT TABLE, not from the frame.
//     The wire carries a player id; the name on the screen is the one the
//     grid is showing, because that is the livery and the name everybody
//     else is looking at.
//
// Pure on purpose: no SDK, no DOM, no React. The components own the clock and
// the input; this file only ever moves lines around.
// ══════════════════════════════════════════════════════════════════════════
import { MAX_CHAT_LENGTH, type ChatMsg, type Seat } from './protocol';

// Re-exported so a component reads the ceiling from one place, and types the
// frame it sends from the same import it takes the helpers from.
export { MAX_CHAT_LENGTH };
export type { ChatMsg };

/** How many lines a lobby's log keeps. The oldest fall off the top. */
export const CHAT_HISTORY = 60;

/**
 * How long a driver waits between lines, in ms.
 *
 * Long enough that a held Enter is one sentence and not a drum solo, short
 * enough that two people mid-argument never notice it.
 */
export const CHAT_COOLDOWN_MS = 600;

/**
 * How long a race bubble hangs over its marble, in ms.
 *
 * Long enough to read a sentence at a glance while driving, short enough
 * that a bubble is a remark and not a billboard — and short enough that two
 * drivers trading lines do not bury the track in text. There is no scrollback
 * mid-race on purpose: the lobby is where a conversation lives.
 */
export const CHAT_BUBBLE_MS = 4000;

/** One line of talk, as a screen holds it. */
export interface ChatLine {
  /** Monotonic per screen — a React key, and nothing else. Not on the wire. */
  id: number;
  /** Who said it: the RUN player id the ROOM stamped. '' when unknown. */
  from: string;
  /** The line itself, trimmed. */
  text: string;
  /**
   * Local clock (ms) when this screen saw the line.
   *
   * Wall time, not the race clock: a lobby has no race clock, and two tabs
   * disagree about `Date.now()` anyway. It orders this screen's own log and
   * it is never compared with anybody else's.
   */
  at: number;
}

/** A speaker, as the grid is showing them. The fallback is a rival with no name. */
export interface ChatSpeaker {
  /** The name on the timing tower. 'Rival' for a voice with no seat. */
  name: string;
  /** `#rrggbb` — the livery, so a line reads in the colour of the marble. */
  color: string;
  /** The grid slot, or null when the speaker is not on the grid. */
  seat: number | null;
}

/** The colour a line gets when its author has no seat — neither mine nor a rival's. */
export const UNKNOWN_SPEAKER_COLOR = '#8e9caa';

/**
 * A typed line, ready for the wire: trimmed of the whitespace a driver did
 * not mean, collapsed to one line (a speech bubble has no paragraphs) and cut
 * to the ceiling.
 */
export function trimChatText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
}

/** True when a line is worth sending: something left after the trim. */
export function canSay(text: string): boolean {
  return trimChatText(text).length > 0;
}

/**
 * True when enough time has passed since this driver's last line.
 *
 * The caller that owns the clock uses this to decide whether a line goes out
 * at all — and says so back to the field, so a line the cooldown swallowed
 * stays typed rather than vanishing into a send that never happened.
 */
export function offCooldown(at: number, lastAt: number): boolean {
  return at - lastAt >= CHAT_COOLDOWN_MS;
}

/** One line, from a player id and a sentence, stamped with this screen's clock. */
export function chatLine(id: number, from: string, text: string, at: number): ChatLine {
  return { id, from, text: trimChatText(text), at };
}

/**
 * A line added to a log: appended, and the log kept to its bound.
 *
 * Trimmed from the FRONT, because the thing at the bottom is what a driver
 * came to read. A duplicate id (the same frame twice — a resync, a client
 * that echoed itself) is dropped rather than printed twice.
 */
export function appendChat(log: readonly ChatLine[], line: ChatLine): ChatLine[] {
  if (log.some((entry) => entry.id === line.id)) return log as ChatLine[];
  const next = [...log, line];
  return next.length > CHAT_HISTORY ? next.slice(next.length - CHAT_HISTORY) : next;
}

/**
 * Who is talking, from the grid this screen is showing.
 *
 * Resolved from the seat table rather than read off the frame because the
 * frame carries an id and a screen wants a name and a livery — and because a
 * driver who is not on the grid (they left, or the lobby has not dressed them
 * yet) still deserves a line, just not a name.
 */
export function speakerOf(seats: readonly Seat[], playerId: string | undefined): ChatSpeaker {
  if (playerId) {
    const seat = seats.find((s) => !s.isAI && s.playerId === playerId);
    if (seat) return { name: seat.name, color: seat.color, seat: seat.slot };
  }
  return { name: 'Rival', color: UNKNOWN_SPEAKER_COLOR, seat: null };
}

/** The frame a driver's line crosses the wire as. */
export function chatMessage(text: string): ChatMsg {
  return { type: 'chat', text: trimChatText(text) };
}
