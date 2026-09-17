import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Coins, LockKeyhole, Play } from 'lucide-react';
import { actBanner as actBannerArt, chapterPlaque } from '../../game/story/assets';
import type { ChapterNumber } from '../../game/story/types';
import { reducedMotion } from './StoryScene';
import { raceAudio } from '../../game/audio';
import '../../story.css';

const UI_LISTENER = { x: 450, y: 0, halfHeight: 1000 };
const sting = () => raceAudio.play({ type: 'sting', x: 450, y: 0, player: true }, UI_LISTENER);

const BANNER_MS = 1500;
const BANNER_MS_STILL = 800;
const ACT_TINT = ['#d63e2e', '#e0b44a', '#7f9bd6'];
const ACT_LABEL = ['Act I — The Rookie', 'Act II — The Rise and the Fall', 'Act III — Down We Go'];

export interface ChapterReward {
  credits: number;
  label?: string;
}

export interface ChapterCardProps {
  chapter: ChapterNumber;
  /** Act this chapter opens (1..3); pass it to slam the act banner in first. */
  act?: 1 | 2 | 3;
  /** Circuit name for the footer line. */
  circuit?: string;
  heats?: number;
  reward?: ChapterReward | null;
  onDone: () => void;
}

/**
 * The pre-chapter title sequence (ST-03): the act banner when a new act starts, then the chapter plaque
 * slamming in over it. Tap, Space or Enter continues; reduced motion drops the slam and the hold.
 */
export default function ChapterCard({ chapter, act, circuit, heats, reward, onDone }: ChapterCardProps) {
  const still = useMemo(reducedMotion, []);
  const [showPlaque, setShowPlaque] = useState(!act);
  const done = useRef(false);

  useEffect(() => {
    if (!act) return;
    const id = window.setTimeout(() => setShowPlaque(true), still ? BANNER_MS_STILL : BANNER_MS);
    return () => window.clearTimeout(id);
  }, [act, still]);

  // One sting for the banner, one for the plaque.
  useEffect(() => { if (act) sting(); }, [act]);
  useEffect(() => { if (showPlaque) sting(); }, [showPlaque]);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Enter' && event.key !== 'Spacebar' && event.key !== 'Escape') return;
      event.preventDefault();
      finish();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [finish]);

  return <div
    className="chapter-card"
    role="button"
    tabIndex={0}
    aria-label={`Chapter ${chapter}${circuit ? `, ${circuit}` : ''}. Continue.`}
    onClick={finish}
    onPointerDown={finish}
  >
    {act && <div className={`act-banner ${still ? 'is-still' : ''}`}>
      <img src={actBannerArt(act)} alt={ACT_LABEL[act - 1]} draggable={false} />
    </div>}
    {showPlaque && <div className={`chapter-plaque ${still ? 'is-still' : ''}`}>
      <img src={chapterPlaque(chapter)} alt={`Chapter ${chapter}`} draggable={false} />
    </div>}
    {showPlaque && <div className={`chapter-foot ${still ? 'is-still' : ''}`}>
      {circuit && <div className="chapter-circuit"><span>CIRCUIT</span>{circuit}{heats ? ` · ${heats} heats` : ''}</div>}
      {reward && reward.credits > 0 && <div className="chapter-reward"><Coins size={12} />{reward.credits.toLocaleString()} CR{reward.label ? ` · ${reward.label}` : ''}</div>}
      <div className="chapter-continue">Tap or press Space</div>
    </div>}
  </div>;
}

export interface ChapterTileProps {
  chapter: ChapterNumber;
  title: string;
  act: 1 | 2 | 3;
  circuit?: string;
  status?: string | null;
  statusKind?: 'live' | 'done' | 'locked';
  objectives?: readonly string[];
  reward?: ChapterReward | null;
  locked?: boolean;
  current?: boolean;
  onSelect?: () => void;
}

/** The chapter card as it appears in the story hub: selectable, lockable, replayable. */
export function ChapterTile({
  chapter, title, act, circuit, status, statusKind, objectives, reward, locked = false, current = false, onSelect,
}: ChapterTileProps) {
  return <button
    type="button"
    className={`story-tile ${current ? 'is-current' : ''}`}
    style={{ '--tile': ACT_TINT[act - 1] } as CSSProperties}
    disabled={locked}
    onClick={onSelect}
    aria-current={current ? 'true' : undefined}
  >
    <span className="story-tile-head">
      <span className="story-tile-num">{chapter}</span>
      <span className="story-tile-act">{locked ? <><LockKeyhole size={10} /> Locked</> : ACT_LABEL[act - 1]}</span>
    </span>
    <span className="story-tile-title">{title}</span>
    {circuit && <span className="story-tile-circuit">{circuit}</span>}
    {!!objectives?.length && <ul className="story-tile-objectives">
      {objectives.map((objective) => <li key={objective}>{objective}</li>)}
    </ul>}
    <span className="story-tile-foot">
      {status && <span className={`story-tile-status ${statusKind ? `is-${statusKind}` : ''}`}>{status}</span>}
      {!locked && <span className="story-tile-status is-live"><Play size={9} /> {current ? 'Continue' : chapter === 1 ? 'Start' : 'Replay'}</span>}
      {reward && reward.credits > 0 && <span className="story-tile-reward"><Coins size={11} />{reward.credits.toLocaleString()} CR</span>}
    </span>
  </button>;
}
