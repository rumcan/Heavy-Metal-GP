// ══════════════════════════════════════════════════════════════════════════
// MP-CHAT — the race's half of the chat: a bubble over a marble.
//
// Mid-race a line is not a log, it is a SPEECH BUBBLE: it rides above the
// marble that said it and clears itself a few seconds later. No scrollback
// and no panel — nobody reads a conversation while they are driving, and the
// lobby is where a conversation lives.
//
// Split out of `RaceScreen` because this half only renders. The other half —
// pinning a bubble to a marble that is moving — is done by the race loop,
// which owns the camera; this component puts the node there and the loop moves
// it. It takes bubbles and draws them, which is what makes it testable
// without a canvas.
// ══════════════════════════════════════════════════════════════════════════
import type { CSSProperties, Ref } from 'react';

/**
 * One line of race talk, parked over the marble that said it.
 *
 * `seat` is the grid slot, which is both the marble's id and its offset in
 * every packed frame — the same numbering the whole online race already uses,
 * so a bubble cannot end up over the wrong ball.
 */
export interface SpeechBubble {
  /** Per-screen id: a React key, and the handle the expiry timer drops. */
  id: number;
  seat: number;
  text: string;
  /** The speaker's name ('YOU' for this screen's own driver) and their livery. */
  name: string;
  color: string;
}

interface Props {
  /** One bubble per marble at most — a newer line replaces the older one. */
  bubbles: readonly SpeechBubble[];
  /**
   * The layer itself. The race loop reads it to pin each bubble to its marble
   * in the same frame the marble was drawn in.
   */
  ref?: Ref<HTMLDivElement>;
}

export default function RaceBubbles({ bubbles, ref }: Props) {
  return <div className="race-bubbles" ref={ref} aria-live="polite">
    {bubbles.map((bubble) => <div
      key={bubble.id}
      className="race-bubble"
      data-seat={bubble.seat}
      style={{ '--team': bubble.color } as CSSProperties}
    >
      <b>{bubble.name}</b>
      <span>{bubble.text}</span>
    </div>)}
  </div>;
}
