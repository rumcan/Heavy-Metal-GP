import { useEffect } from 'react';
import { ArrowRight, Coins, Sparkles, Trophy } from 'lucide-react';
import { raceAudio } from '../../game/audio';
import type { StoryUnlock } from '../../game/story/rewards';
import type { ChapterNumber } from '../../game/story/types';
import { reducedMotion } from './StoryScene';
import '../../story.css';

const UI_LISTENER = { x: 450, y: 0, halfHeight: 1000 };
const sting = () => raceAudio.play({ type: 'sting', x: 450, y: 0, player: true }, UI_LISTENER);

export interface ChapterCompleteProps {
  chapter: ChapterNumber;
  circuit: string;
  credits: number;
  perfect: boolean;
  unlock: StoryUnlock;
  unlocked: boolean;
  replay: boolean;
  /** The whole season is classified. */
  last: boolean;
  position: number | null;
  endingTitle?: string | null;
  onDone: () => void;
}

/**
 * The beat between chapters (ST-08): what the chapter paid, what it unlocked, and where the season
 * stands. Replays show the same card without a payout, because a replay never touches the save.
 */
export function ChapterComplete({
  chapter, circuit, credits, perfect, unlock, unlocked, replay, last, position, endingTitle, onDone,
}: ChapterCompleteProps) {
  const still = reducedMotion();

  useEffect(() => { sting(); }, []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Enter' && event.key !== 'Spacebar' && event.key !== 'Escape') return;
      event.preventDefault();
      onDone();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [onDone]);

  return <div className="chapter-card" role="button" tabIndex={0} aria-label={`Chapter ${chapter} complete`} onClick={onDone} onPointerDown={onDone}>
    <div className={`chapter-complete ${still ? 'is-still' : ''}`}>
      <span className="chapter-complete-eyebrow">
        {last ? <><Trophy size={13} /> THE SEASON IS CLASSIFIED</> : <><Sparkles size={13} /> CHAPTER {String(chapter).padStart(2, '0')} COMPLETE</>}
      </span>
      <h1>{last ? endingTitle ?? 'Down We Go' : circuit}</h1>
      {last && position && <p className="chapter-complete-line">You finished the championship P{position}.</p>}
      <div className="chapter-complete-grid">
        <div>
          <span>CREDITS</span>
          <strong><Coins size={15} />{replay ? '—' : credits > 0 ? `+${credits.toLocaleString()}` : 'Banked'}</strong>
          {perfect && !replay && <em>Every objective met</em>}
          {replay && <em>Replay: no payout</em>}
        </div>
        <div>
          <span>{unlock.kind} UNLOCK</span>
          <strong>{unlock.label}</strong>
          <em>{unlocked ? 'New — on the shelf' : 'Already on the shelf'}</em>
        </div>
      </div>
      <p className="chapter-complete-detail">{unlock.detail}</p>
      <button type="button" className="button-primary" onClick={(event) => { event.stopPropagation(); onDone(); }}>
        {last ? 'Back to the hub' : 'Next chapter'}<ArrowRight size={17} />
      </button>
    </div>
  </div>;
}
