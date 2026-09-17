import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { FastForward, SkipForward } from 'lucide-react';
import { raceAudio } from '../../game/audio';
import { storyBackground, storyEnding, storyProp } from '../../game/story/assets';
import { CAST } from '../../game/story/cast';
import { castFacing, castName, castPlateColor, castPortrait, castRing } from '../../game/story/portraits';
import { emptyFlags, ENDING_ART, flagsMatch } from '../../game/story/types';
import type { ChoiceOption, FlagMap, Line, Scene } from '../../game/story/types';
import '../../story.css';

/** UI sounds are not positional: park the listener on the player so they always play at full volume. */
const UI_LISTENER = { x: 450, y: 0, halfHeight: 1000 };
const uiSound = (type: 'blip' | 'sting') => raceAudio.play({ type, x: 450, y: 0, player: true }, UI_LISTENER);

const TYPE_STEP = 2;
const TYPE_MS = 17;
const FAST_TYPE_MS = 8;
const HOLD_MS = 220;
const AUTO_PER_CHAR = 26;
const AUTO_MIN = 1500;

/** True when the player asked the OS for less motion: no slide-ins, no typewriter. */
export function reducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface StorySceneProps {
  scene: Scene;
  /** Corner chip, e.g. "CHAPTER 2 · HEAT 1 OF 3". */
  heading?: string;
  /** Story flags, used to hide choice options the script has already ruled out. */
  flags?: FlagMap;
  /** Keep advancing on its own once a line has finished typing. */
  autoAdvance?: boolean;
  onAutoAdvanceChange?: (on: boolean) => void;
  /** The scene ran out of lines (`choice` null) or a choice was picked. */
  onDone: (choice: ChoiceOption | null) => void;
  /** Skip button / Escape. */
  onExit?: () => void;
}

/**
 * One dialogue scene (ST-03): the background plate, speakers sliding in from the side they face in a
 * kit ring frame, a team-colour nameplate, a typewriter line box, props that pop up over the plate and
 * choices as kit buttons. Tap or Space/Enter advances, holding fast-forwards, Escape skips.
 */
export default function StoryScene({
  scene, heading, flags, autoAdvance = false, onAutoAdvanceChange, onDone, onExit,
}: StorySceneProps) {
  const still = useMemo(reducedMotion, []);
  const lines = scene.lines;
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(still ? (lines[0]?.text.length ?? 0) : 0);
  const [fast, setFast] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);

  const line: Line | undefined = lines[index];
  const text = line?.text ?? '';
  const typing = !still && !!line && shown < text.length;

  // Typewriter, one blip every few characters. Reduced motion shows the whole line.
  useEffect(() => {
    if (!line) return;
    if (still) { setShown(line.text.length); return; }
    setShown(0);
    let count = 0;
    let tick = 0;
    const id = window.setInterval(() => {
      count = Math.min(line.text.length, count + TYPE_STEP);
      setShown(count);
      if (++tick % 3 === 0 && count < line.text.length) uiSound('blip');
      if (count >= line.text.length) window.clearInterval(id);
    }, fast ? FAST_TYPE_MS : TYPE_MS);
    return () => window.clearInterval(id);
  }, [line, fast, still]);

  const options = useMemo(
    () => (scene.choice ? scene.choice.options.filter((option) => flagsMatch(option.when, flags ?? emptyFlags())) : []),
    [scene.choice, flags],
  );

  const advance = useCallback(() => {
    if (!line) { onDone(null); return; }
    if (shown < line.text.length && !still) { setShown(line.text.length); return; }
    if (index + 1 < lines.length) { setIndex(index + 1); return; }
    if (options.length) return; // a choice is picked, never tapped past
    onDone(null);
  }, [line, shown, still, index, lines.length, options.length, onDone]);

  const pick = useCallback((option: ChoiceOption) => {
    uiSound('blip');
    onDone(option);
  }, [onDone]);

  // Number keys pick a choice.
  useEffect(() => {
    if (!options.length) return;
    const down = (event: KeyboardEvent) => {
      const n = Number(event.key);
      if (!Number.isInteger(n) || n < 1 || n > options.length) return;
      event.preventDefault();
      pick(options[n - 1]);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [options, pick]);

  // Opening a scene: the reveal sting for scenes that ask for one.
  useEffect(() => {
    if (scene.sting) uiSound('sting');
  }, [scene.id, scene.sting]);

  // Auto-advance once the line has finished typing and nothing has to be chosen.
  useEffect(() => {
    if (!autoAdvance || typing || !line || options.length) return;
    const wait = still ? 1800 : Math.max(AUTO_MIN, text.length * AUTO_PER_CHAR);
    const id = window.setTimeout(advance, wait);
    return () => window.clearTimeout(id);
  }, [autoAdvance, typing, line, options.length, still, text.length, advance]);

  // Keyboard: Space/Enter advance (held = fast-forward), Escape skips.
  useEffect(() => {
    const isAdvance = (key: string) => key === ' ' || key === 'Enter' || key === 'Spacebar';
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onExit?.(); return; }
      if (!isAdvance(event.key)) return;
      event.preventDefault();
      if (event.repeat) { setFast(true); held.current = true; return; }
      advance();
    };
    const up = (event: KeyboardEvent) => {
      if (isAdvance(event.key)) { setFast(false); held.current = false; }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [advance, onExit]);

  useEffect(() => () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); }, []);

  const pressStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    held.current = false;
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => { held.current = true; setFast(true); }, HOLD_MS);
  };
  const pressEnd = () => {
    if (holdTimer.current) { window.clearTimeout(holdTimer.current); holdTimer.current = null; }
    setFast(false);
    if (!held.current) advance();
    held.current = false;
  };
  const pressCancel = () => {
    if (holdTimer.current) { window.clearTimeout(holdTimer.current); holdTimer.current = null; }
    setFast(false);
    held.current = false;
  };

  const background = scene.ending ? storyEnding(ENDING_ART[scene.ending]) : storyBackground(scene.background);
  const speakers = useMemo(() => {
    const seen: Line['who'][] = [];
    for (const entry of lines) if (!seen.includes(entry.who)) seen.push(entry.who);
    return seen;
  }, [lines]);
  // The most recent prop stays on screen until the next one appears.
  const prop = useMemo(() => {
    for (let i = Math.min(index, lines.length - 1); i >= 0; i--) if (lines[i].prop) return lines[i].prop;
    return undefined;
  }, [index, lines]);
  const direction = text.startsWith('(');
  // Three or more speakers wrap into rows in speaking order; two face each other left/right of centre.
  const group = speakers.length > 2;
  const castRef = useRef<HTMLDivElement>(null);

  // Point the bubble's tail at the active speaker, wherever layout or wrapping put them.
  useLayoutEffect(() => {
    const cast = castRef.current;
    if (!cast) return;
    const place = () => {
      const bubble = cast.querySelector<HTMLElement>('.scene-bubble');
      const portrait = cast.querySelector<HTMLElement>('.story-speaker.is-active .kit-portrait');
      if (!bubble || !portrait) return;
      const b = bubble.getBoundingClientRect();
      const p = portrait.getBoundingClientRect();
      const x = Math.max(24, Math.min(b.width - 24, p.left + p.width / 2 - b.left));
      bubble.style.setProperty('--tail', `${x}px`);
    };
    place();
    const frame = requestAnimationFrame(place);
    const settle = window.setTimeout(place, 400); // after the slide-in animation
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(settle); window.removeEventListener('resize', place); };
  }, [index, line?.who, speakers.length]);

  return <div className="story-scene" data-scene={scene.id}>
    <div className="story-bg"><img key={scene.id} src={background} alt="" draggable={false} /></div>
    <div className="story-scrim" />

    <header className="story-topbar">
      <div className="story-heading">
        {heading && <div className="story-chip">{heading}</div>}
        {scene.ending && <div className="story-chip"><b>{scene.ending}</b> ending</div>}
      </div>
      <div className="story-top-actions">
        {onAutoAdvanceChange && <button
          type="button"
          className="story-toggle"
          aria-pressed={autoAdvance}
          onClick={() => onAutoAdvanceChange(!autoAdvance)}
          title="Advance each line on its own"
        ><FastForward size={12} />Auto</button>}
        {onExit && <button type="button" className="story-toggle" onClick={onExit} title="Skip this scene (Esc)">
          <SkipForward size={12} />Skip
        </button>}
      </div>
    </header>

    <div
      className="story-stage"
      role="button"
      tabIndex={0}
      aria-label={typing ? 'Reveal the rest of the line' : 'Next line'}
      onPointerDown={pressStart}
      onPointerUp={pressEnd}
      onPointerCancel={pressCancel}
      onPointerLeave={pressCancel}
    >
      <div ref={castRef} className={`story-cast ${group ? 'is-group' : ''}`} style={{ '--cast-count': speakers.length } as CSSProperties}>
        {speakers.map((who, slotIndex) => {
          const cast = CAST[who];
          const isActive = who === line?.who;
          const mood = isActive ? line!.mood : cast.defaultMood;
          const plate = castPlateColor(who);
          // Speakers alternate left/right of centre and always look inward, so a two-hander reads as a conversation.
          const side = group ? 'grouped' : speakers.length === 1 ? 'center' : slotIndex % 2 === 0 ? 'left' : 'right';
          const lookTowards = side === 'right' ? 'left' : 'right';
          const mirrored = (side === 'left' || side === 'right') && castFacing(who, mood) !== lookTowards;
          return <div
            key={who}
            className={`story-speaker is-${side} ${isActive ? 'is-active' : ''} ${still ? 'is-still' : ''}`}
            style={{ '--plate': plate } as CSSProperties}
          >
            <span className={`kit-portrait ring-${castRing(who)} ${mirrored ? 'is-mirrored' : ''}`} style={{ '--speaker': plate } as CSSProperties}>
              <img src={castPortrait(who, mood)} alt={castName(who)} draggable={false} />
            </span>
            <span className="story-nameplate" style={{ '--plate': plate } as CSSProperties}>
              <strong>{castName(who)}</strong>
              <span>{cast.role}</span>
            </span>
            {isActive && <div className="scene-bubble">
              <p className={`story-text ${direction ? 'is-direction' : ''}`} aria-live="polite">
                {typing ? text.slice(0, shown) : text}
                {!typing && !options.length && <span className="story-caret"> ▸</span>}
              </p>
            </div>}
          </div>;
        })}
      </div>
      {prop && <div className="story-prop" key={prop}><img src={storyProp(prop)} alt="" draggable={false} /></div>}
    </div>

    {scene.choice && !typing && <div className="story-panel">
      <div className="story-choices" role="group" aria-label={scene.choice.prompt}>
        <p className="story-choice-prompt">{scene.choice.prompt}</p>
        {options.map((option, i) => <button key={option.set} type="button" className="story-choice" onClick={() => pick(option)}>
          {option.label}<kbd>{i + 1}</kbd>
        </button>)}
      </div>
    </div>}
    <div className="story-hint">{typing ? 'Hold to speed up' : options.length ? 'Choose your line' : 'Tap or press Space'}</div>
  </div>;
}
