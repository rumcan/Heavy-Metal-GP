/**
 * P2-03 — the caption strip.
 *
 * Mount it once per screen (or once per app) and it shows whatever `playVoice` is saying:
 * the speaker's name plus the line, over the bottom of the viewport. It is a plain
 * `useSyncExternalStore` reader of the player, so it needs no props and no state of its own,
 * and it disappears the moment the line ends or is skipped.
 *
 * It renders through a portal: captions must be pinned to the VIEWPORT even when the screen
 * that speaks is a transformed/overflowing container (a dialog, the story stage, the editor).
 * Pointer events pass straight through — a caption must never eat a click or a race input.
 */
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { currentVoice, subscribeVoice } from '../game/voice';
import '../voice.css';

interface Props {
  /** Extra class for a screen that needs to nudge the strip (e.g. clear of a HUD bar). */
  className?: string;
}

export default function VoiceSubtitles({ className = '' }: Props) {
  const voice = useSyncExternalStore(subscribeVoice, currentVoice, currentVoice);
  if (!voice.line || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className={`voice-subtitles ${className}`.trim()}
      role="status"
      aria-live="polite"
      data-speaker={voice.line.speaker}
      data-line={voice.line.id}
    >
      <b>{voice.name}</b>
      <p>{voice.line.text}</p>
    </div>,
    document.body,
  );
}
