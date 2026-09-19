// ══════════════════════════════════════════════════════════════════════════
// MP-CHAT — the lobby's chat: a log, a line and a Send button.
//
// Split out of `OnlineLobby` for the same reason `LobbyGrid` is: it is the
// half that only renders. It takes lines and draws them, which is what makes
// it testable without a room — and a component that throws on first paint is
// a lobby nobody can talk in.
//
// Nothing here knows about the wire. A line arrives as a `ChatLine`; the
// lobby owns the socket, the clock and the cooldown. The one thing this file
// decides is who a line is FROM, and that is read off the SEAT TABLE (via
// `speakerOf`) so a driver's name and livery are the ones on the grid — not
// whatever a stranger's frame felt like claiming.
// ══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { SendHorizontal } from 'lucide-react';
import { MAX_CHAT_LENGTH, speakerOf, trimChatText } from '../net/chat';
import type { ChatLine } from '../net/chat';
import type { Seat } from '../net/protocol';

interface Props {
  /** The log, oldest first. Bounded by `CHAT_HISTORY` before it gets here. */
  lines: readonly ChatLine[];
  /** The grid, so a line can be signed with a name and a livery. */
  seats: readonly Seat[];
  /** Which driver this screen is, so its own lines read YOU. */
  myPlayerId: string;
  /**
   * Send a line. The lobby owns the socket, the cooldown and the echo, and
   * answers whether the line went out — a line the cooldown swallowed stays
   * in the field rather than vanishing with the keystroke.
   */
  onSend: (text: string) => boolean;
  /** Disabled until there is a room to talk into. */
  disabled?: boolean;
}

export default function LobbyChat({ lines, seats, myPlayerId, onSend, disabled = false }: Props) {
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLOListElement>(null);

  // The newest line is the one a driver came to read. Pinned to the bottom on
  // arrival, not on every render, so scrolling up to re-read a line is not a
  // fight with the log.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = trimChatText(draft);
    if (!text || disabled) return;
    if (onSend(text)) setDraft('');
  };

  return <div className="lobby-chat">
    <ol className="lobby-chat-log" ref={logRef} aria-live="polite" aria-label="Lobby chat">
      {lines.length === 0
        ? <li className="lobby-chat-empty">Nobody has said anything yet. Say hello.</li>
        : lines.map((line) => {
          const speaker = speakerOf(seats, line.from);
          const mine = line.from === myPlayerId;
          return <li key={line.id} className={mine ? 'is-player' : ''} style={{ '--team': speaker.color } as CSSProperties}>
            <i className="lobby-chat-livery" style={{ background: speaker.color }} aria-hidden />
            <b>{mine ? 'YOU' : speaker.name.toUpperCase()}</b>
            <span>{line.text}</span>
          </li>;
        })}
    </ol>
    <form className="lobby-chat-form" onSubmit={submit}>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value.slice(0, MAX_CHAT_LENGTH))}
        placeholder={disabled ? 'Connecting…' : 'Say something'}
        aria-label="Message the lobby"
        maxLength={MAX_CHAT_LENGTH}
        disabled={disabled}
        autoComplete="off"
      />
      <button className="button-secondary" type="submit" disabled={disabled || !trimChatText(draft)} aria-label="Send message">
        <SendHorizontal size={15} />
      </button>
    </form>
  </div>;
}
