import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { castName, castPlateColor, castPortrait, castRing } from '../../game/story/portraits';
import type { Line } from '../../game/story/types';
import '../../story.css';

const READ_MS_PER_CHAR = 42;
const MIN_MS = 2600;
const MAX_MS = 9000;

export interface StoryBubbleProps {
  line: Line;
  /** Called once the bubble has been read. */
  onDone?: () => void;
  /** Override the read time (ms). */
  ms?: number;
}

/**
 * Mid-race story line (ST-03): a speech bubble over the race canvas with the speaker's portrait and a
 * team-colour nameplate. It reads itself out and disappears — it never pauses the race or eats input.
 */
export default function StoryBubble({ line, onDone, ms }: StoryBubbleProps) {
  const plate = castPlateColor(line.who);
  const wait = ms ?? Math.min(MAX_MS, Math.max(MIN_MS, line.text.length * READ_MS_PER_CHAR));

  useEffect(() => {
    const id = window.setTimeout(() => onDone?.(), wait);
    return () => window.clearTimeout(id);
  }, [wait, onDone]);

  const direction = line.text.startsWith('(');

  return <div className="story-bubble" role="status" style={{ '--plate': plate } as CSSProperties}>
    <span className={`kit-portrait ring-${castRing(line.who)}`} style={{ '--speaker': plate } as CSSProperties}>
      <img src={castPortrait(line.who, line.mood)} alt={castName(line.who)} draggable={false} />
    </span>
    <div className="story-bubble-body" style={{ '--plate': plate } as CSSProperties}>
      <span className="story-bubble-name">{castName(line.who)}</span>
      <p className={`story-bubble-text ${direction ? 'is-direction' : ''}`}>{line.text}</p>
    </div>
  </div>;
}
