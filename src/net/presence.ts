// ══════════════════════════════════════════════════════════════════════════
// MP-08 — WHO IS STILL HERE.
//
// A dropped socket is not a dropped driver: the platform holds the seat for a
// window (`reconnectTimeout`) and flips `player.connected`, and the ROOM is the
// party that notices and says so as `peerStatus`. This module is what the two
// ends do with that frame, and it is pure on purpose — the host decides when a
// marble changes hands from it, and the HUD decides what to say, and neither
// should be able to disagree with the other.
//
// The one number that matters to a player: a race must not STOP because somebody
// lost their signal. Three seconds and that marble belongs to the AI — it keeps
// rolling, and the race keeps being a race. Come back inside the window and it
// is yours again, exactly where it got to.
// ══════════════════════════════════════════════════════════════════════════
import type { PeerStatusMsg } from './protocol';

/**
 * How long a dropped driver keeps their marble before the AI takes the wheel.
 *
 * Long enough to ride out a tunnel or a Wi-Fi hiccup, short enough that the
 * race never sits waiting on a socket: a marble with nobody in it has to keep
 * rolling or the whole field is held hostage by one bad connection.
 */
export const AI_TAKEOVER_MS = 3_000;

/** Assumed hold window when the room says nothing, in ms. */
export const DEFAULT_PEER_GRACE_MS = 60_000;

/** What a screen knows about one rival's connection. */
export interface PeerPresence {
  /** The RUN player id — the same id the seat table keys on. */
  playerId: string;
  /** The room's name for them, so a notice can say WHO instead of "a driver". */
  username?: string;
  /** When the drop was seen, on the local wall clock (ms). */
  since: number;
  /** How long the seat is held before it is gone for good, in ms. */
  graceMs: number;
}

/**
 * One `peerStatus` frame, folded into what a screen knows.
 *
 * Only DROPS are remembered: a rival who is present needs no badge, and
 * "reconnected" is not information a screen can show — it is the absence of the
 * drop it cancels. (The host, which has to act on the transition, looks before
 * it folds.)
 */
export function foldPeer(list: readonly PeerPresence[], msg: PeerStatusMsg, now: number): PeerPresence[] {
  const rest = list.filter((peer) => peer.playerId !== msg.playerId);
  if (msg.status === 'reconnected') return rest;
  const known = peerOf(list, msg.playerId);
  return [
    ...rest,
    {
      playerId: msg.playerId,
      username: msg.username ?? known?.username,
      // A drop the room says twice is one drop: the clock starts when the driver
      // was FIRST seen gone, or an echo would keep pushing the AI takeover and
      // the hold window out by another minute, for ever.
      since: known?.since ?? now,
      graceMs:
        typeof msg.graceMs === 'number' && msg.graceMs > 0
          ? msg.graceMs
          : known?.graceMs ?? DEFAULT_PEER_GRACE_MS,
    },
  ];
}

/** The rival who is missing, or null when everybody is here. */
export function peerOf(list: readonly PeerPresence[], playerId: string): PeerPresence | null {
  return list.find((peer) => peer.playerId === playerId) ?? null;
}

/** Milliseconds before the seat is given up — 0 once it is. */
export function graceLeft(peer: PeerPresence, now: number): number {
  return Math.max(0, peer.since + peer.graceMs - now);
}

/** Milliseconds this driver has been missing. */
export function offlineFor(peer: PeerPresence, now: number): number {
  return Math.max(0, now - peer.since);
}

/**
 * True once the AI should be driving this marble.
 *
 * Deliberately NOT the hold window: the seat is held for a minute, but a marble
 * nobody is steering is a marble that has stopped racing.
 */
export function takeoverDue(peer: PeerPresence, now: number): boolean {
  return offlineFor(peer, now) >= AI_TAKEOVER_MS;
}

/** A countdown a player can read: `0:29`, `1:00`. */
export function graceLabel(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
