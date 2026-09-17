// ══════════════════════════════════════════════════════════════════════════
// MP-08 — what a player is told when the network misbehaves.
//
// Two notices, and they are the whole of the story a race can tell about a
// dropped socket:
//
//   the strip   — a rival's connection is gone, and the race is carrying on
//                 without them (the AI has their marble, and the seat is held
//                 for a minute before it is given away). Shown over the lobby
//                 and the race alike, because a drop is not a phase's business.
//   the overlay — the HOST is gone. The host is the simulation; without it
//                 there is no race, so this one ends, and it pays nothing.
//
// Both are pure props → markup: the room's `peerStatus` frames are folded in
// `src/net/presence.ts`, and the clock is handed in rather than read, so a test
// can render the twenty-ninth second without waiting for it.
// ══════════════════════════════════════════════════════════════════════════
import { AI_TAKEOVER_MS, graceLabel, graceLeft, offlineFor, type PeerPresence } from '../net/presence';

/** A fixed strip over the current screen: who is missing, and what is holding. */
export function PeerStrip({ peers, hostId, now }: { peers: readonly PeerPresence[]; hostId: string | null; now: number }) {
  if (!peers.length) return null;
  return (
    <div className="peer-strip" role="status" aria-live="polite">
      {peers.map((peer) => {
        const host = peer.playerId === hostId;
        const who = host ? 'The host' : peer.username || 'A driver';
        const left = graceLabel(graceLeft(peer, now));
        // Three seconds is the rule in `presence.ts`: past it the marble is the
        // AI's, and saying so is the point — a marble nobody is steering still
        // has to be accounted for.
        const note = host
          ? `the race is held for ${left}`
          : offlineFor(peer, now) >= AI_TAKEOVER_MS
            ? `the AI has their marble — ${left} to get back`
            : `${left} to get back`;
        return (
          <span className="peer-row" key={peer.playerId}>
            <span className="live-dot" aria-hidden />
            {who} lost connection — {note}
          </span>
        );
      })}
    </div>
  );
}

interface OverlayProps {
  /** Why it ended: the room's own words, or the clock running out. */
  message: string;
  onLeave: () => void;
}

/**
 * The host is gone, so the race is over — for everybody, this instant.
 *
 * No payout: an unfinished race is not a result, and a wallet that paid for a
 * race that stopped mid-heat would be a wallet that can be farmed by pulling a
 * cable. (MP-09 settles a race that FINISHED; this is the other case.)
 */
export default function HostLeftOverlay({ message, onLeave }: OverlayProps) {
  return (
    <div className="results-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="host-left-title">
      <div className="panel host-left">
        <span className="eyebrow">RACE ABANDONED</span>
        <h2 id="host-left-title">The host is gone</h2>
        <p>{message} A race that never finished pays nothing — the whole grid goes back to the garage.</p>
        <button className="button-primary" onClick={onLeave}>
          Back to the garage
        </button>
      </div>
    </div>
  );
}
