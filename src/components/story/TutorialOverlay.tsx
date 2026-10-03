// P2-13 (#119) — the tutorial overlay.
//
// Mounted OVER a RaceScreen (by `TutorialRace`), fed by a `TutorialBridge` the race screen
// calls into. It owns the lesson state machine (src/game/story/tutorial.ts), speaks each
// lesson through the voice player with captions, shows the big key prompt (keyboard keys
// on desktop, the on-screen button highlighted on touch), and reports when the ride is
// done or skipped. Everything renders through a portal so the race HUD underneath is
// untouched, and pointer events pass through except on the card itself.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SkipForward } from 'lucide-react';
import VoiceSubtitles from '../VoiceSubtitles';
import { playVoice, preloadVoice, stopVoice } from '../../game/voice';
import {
  TUTORIAL_LESSONS, TUTORIAL_SHORTCUT, TUTORIAL_VOICE_SET,
  currentLesson, newTutorial, skipTutorial, tutorialStep,
} from '../../game/story/tutorial';
import type { TutorialState } from '../../game/story/tutorial';
import type { ItemType } from '../../game/types';

/** One snapshot of the race, pushed into the overlay on the HUD tick. */
export interface TutorialFrameData {
  x: number;
  y: number;
  /** Magic Engine heat 0..1 — a climbing heat bar is how the engine lesson is detected. */
  heat: number;
  gateOpen: boolean;
  finished: boolean;
  paused: boolean;
}

/**
 * The hook the RaceScreen gets for a tutorial race: it reports input and frames, the
 * overlay does everything else. The overlay assigns the callbacks onto this object.
 */
export interface TutorialBridge {
  onFrame: (frame: TutorialFrameData) => void;
  onSteer: (dir: -1 | 1) => void;
  onJump: () => void;
  onEngine: (held: boolean) => void;
  onSkill: (item: ItemType) => void;
}

/** Heat rise per frame that counts as "the Magic Engine fired" (heat climbs 1/3000 per ms). */
const ENGINE_FIRED_DELTA = 0.004;

/** Touch controls the overlay highlights, by lesson id (aria-labels RaceScreen already uses). */
const TOUCH_TARGETS: Partial<Record<string, string[]>> = {
  steer: ['[aria-label="Nudge left"]', '[aria-label="Nudge right"]'],
  engine: ['[aria-label="Magic Engine (hold)"]'],
  jump: ['[aria-label="Jump"]'],
  shortcut: ['[aria-label="Jump"]'],
};

const styles = `
.tutorial-layer { position: fixed; inset: 0; z-index: 60; pointer-events: none; display: flex; flex-direction: column; align-items: center; }
.tutorial-card { pointer-events: auto; margin-top: 64px; max-width: min(560px, calc(100vw - 24px)); background: rgba(10, 15, 21, 0.92); border: 1px solid rgba(125, 211, 252, 0.35); border-radius: 14px; padding: 12px 18px 14px; box-shadow: 0 10px 34px rgba(0,0,0,0.45); text-align: center; }
.tutorial-eyebrow { display: block; font-size: 11px; letter-spacing: 0.14em; color: #7dd3fc; font-weight: 700; margin-bottom: 4px; }
.tutorial-card p { margin: 2px 0 10px; font-size: 15px; line-height: 1.35; color: #e8eef4; }
.tutorial-keys { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.tutorial-keys kbd { font-family: inherit; font-size: 15px; font-weight: 800; min-width: 34px; padding: 7px 10px; border-radius: 8px; background: #16222e; border: 1px solid #3d5568; border-bottom-width: 3px; color: #f8fafc; }
.tutorial-touch { font-size: 14px; color: #bae6fd; font-weight: 600; }
.tutorial-card .tutorial-skip { margin-top: 10px; }
.tutorial-glow { outline: 3px solid #7dd3fc !important; outline-offset: 3px; animation: tutorial-pulse 1.1s ease-in-out infinite; }
@keyframes tutorial-pulse { 0%, 100% { outline-color: rgba(125, 211, 252, 0.95); } 50% { outline-color: rgba(125, 211, 252, 0.35); } }
@media (max-width: 700px) { .tutorial-card { margin-top: 52px; padding: 10px 14px; } .tutorial-card p { font-size: 13.5px; } }
`;

interface Props {
  /** The bridge object handed to the RaceScreen; the overlay assigns its callbacks here. */
  bridge: TutorialBridge;
  /** Every lesson completed — the finish line dropped and the last line was spoken. */
  onDone: () => void;
  /** The player skipped — the parent decides what "straight to Chapter 1" means. */
  onSkip: () => void;
}

export default function TutorialOverlay({ bridge, onDone, onSkip }: Props) {
  const [machine, setMachine] = useState<TutorialState>(newTutorial);
  const [started, setStarted] = useState(false);
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const startedRef = useRef(false);
  const pausedRef = useRef(false);
  /** Input flags collected since the last frame snapshot (one lesson signal per action). */
  const pending = useRef({ steerLeft: false, steerRight: false, jumped: false, skillUsed: false });
  const lastHeat = useRef(0);
  /** The welcome line has been spoken once the gate opens. */
  const welcomed = useRef(false);
  /** Index of the lesson whose voice line already started (so a line is never played twice). */
  const spokenIndex = useRef(-1);
  /** The voice line currently talking — the finish lesson waits for it before handing off. */
  const linePromise = useRef<Promise<void> | null>(null);
  const doneNotified = useRef(false);
  const callbacks = useRef({ onDone, onSkip });
  callbacks.current = { onDone, onSkip };

  const isTouch = useMemo(
    () => typeof matchMedia !== 'undefined' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window),
    [],
  );

  const speakLesson = (index: number) => {
    const lesson = TUTORIAL_LESSONS[index];
    if (!lesson) return;
    spokenIndex.current = index;
    linePromise.current = playVoice(TUTORIAL_VOICE_SET, lesson.line);
    const next = TUTORIAL_LESSONS[index + 1];
    if (next) preloadVoice(TUTORIAL_VOICE_SET, next.line);
  };

  // Wire the bridge: input callbacks set one-frame flags; the frame tick feeds the machine.
  useMemo(() => {
    bridge.onSteer = (dir) => { if (dir < 0) pending.current.steerLeft = true; else pending.current.steerRight = true; };
    bridge.onJump = () => { pending.current.jumped = true; };
    bridge.onSkill = () => { pending.current.skillUsed = true; };
    bridge.onEngine = () => { /* the engine lesson reads the heat bar in the frame */ };
    bridge.onFrame = (frame) => {
      if (!frame.gateOpen) return;             // lights still counting: no lessons yet
      if (!startedRef.current) { startedRef.current = true; setStarted(true); }
      if (frame.paused) {
        // The pause dialog owns the screen: cut the line, and say it again on the way back.
        if (!pausedRef.current) { pausedRef.current = true; stopVoice(); }
        return;
      }
      if (pausedRef.current) {
        pausedRef.current = false;
        if (!doneNotified.current) speakLesson(machineRef.current.index);
      }
      if (doneNotified.current) return;
      const p = pending.current;
      const engineFired = frame.heat > lastHeat.current + ENGINE_FIRED_DELTA;
      const shortcutTaken = frame.x >= TUTORIAL_SHORTCUT.x0 && frame.x <= TUTORIAL_SHORTCUT.x1 && frame.y <= TUTORIAL_SHORTCUT.aboveY;
      const next = tutorialStep(machineRef.current, {
        x: frame.x,
        steerLeft: p.steerLeft, steerRight: p.steerRight,
        engineFired, skillUsed: p.skillUsed, jumped: p.jumped,
        shortcutTaken, finished: frame.finished,
      });
      p.steerLeft = p.steerRight = p.jumped = p.skillUsed = false;
      lastHeat.current = frame.heat;
      if (next !== machineRef.current) {
        machineRef.current = next;
        setMachine(next);
        if (next.done && !next.skipped) {
          // The finish lesson just completed: hand off once its line has finished talking.
          doneNotified.current = true;
          const line = linePromise.current ?? Promise.resolve();
          void line.then(() => callbacks.current.onDone());
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  // The voice track: a welcome line the tick the gate opens, then one line per lesson.
  // Advancing mid-line interrupts the old line — the lesson waits for the ACTION, not the audio.
  useEffect(() => {
    if (!started || machine.skipped) return;
    if (!welcomed.current) {
      welcomed.current = true;
      const welcome = playVoice(TUTORIAL_VOICE_SET, 'tutorial-welcome');
      linePromise.current = welcome;
      preloadVoice(TUTORIAL_VOICE_SET, TUTORIAL_LESSONS[0].line);
      // Once the welcome is done (or cut short by an early advance), say whichever lesson
      // is current — unless an advance already started that line itself.
      void welcome.then(() => {
        if (pausedRef.current || doneNotified.current || machineRef.current.skipped) return;
        if (spokenIndex.current !== machineRef.current.index) speakLesson(machineRef.current.index);
      });
      return;
    }
    if (spokenIndex.current !== machine.index) speakLesson(machine.index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, machine]);

  // On touch, pulse the on-screen control the current lesson is teaching.
  useEffect(() => {
    if (!isTouch) return;
    const lesson = currentLesson(machine);
    const selectors = lesson ? TOUCH_TARGETS[lesson.id] : undefined;
    if (!selectors) return;
    const nodes: Element[] = [];
    const timer = window.setTimeout(() => {
      for (const selector of selectors) {
        for (const node of Array.from(document.querySelectorAll(selector))) {
          node.classList.add('tutorial-glow');
          nodes.push(node);
        }
      }
    }, 350); // wait for the race UI to settle so the buttons exist
    return () => {
      window.clearTimeout(timer);
      for (const node of nodes) node.classList.remove('tutorial-glow');
    };
  }, [machine, isTouch]);

  // Leaving the race cuts the line: captions and audio must never outlive the tutorial.
  useEffect(() => () => stopVoice(), []);

  const lesson = currentLesson(machine);
  const skip = () => {
    stopVoice();
    machineRef.current = skipTutorial(machineRef.current);
    setMachine(machineRef.current);
    callbacks.current.onSkip();
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="tutorial-layer">
      <style>{styles}</style>
      {lesson && !machine.skipped && (
        <div className="tutorial-card" role="status">
          <span className="tutorial-eyebrow">LEARN TO RACE · {String(machine.index + 1).padStart(2, '0')} / {String(TUTORIAL_LESSONS.length).padStart(2, '0')}</span>
          <p>{lesson.text}</p>
          {lesson.keys && (isTouch
            ? <span className="tutorial-touch">Use {lesson.keys.touch}</span>
            : <span className="tutorial-keys">{lesson.keys.keyboard.map((key) => <kbd key={key}>{key}</kbd>)}</span>)}
          <div className="tutorial-skip">
            <button className="text-button" onClick={skip}><SkipForward size={14} /> Skip tutorial</button>
          </div>
        </div>
      )}
      <VoiceSubtitles />
    </div>,
    document.body,
  );
}
