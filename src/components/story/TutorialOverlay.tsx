// P2-13, rebuilt casual-game style. The race drives the ball itself between lessons; at each lesson's spot it freezes,
// the screen dims and one big key (or the on-screen button on a phone) says exactly what to press. Only that key does
// anything. Pressing it lights the key up and the race carries on with the action at exactly the right place.
// The rules live in src/game/story/tutorial.ts; this file is the screen and the wiring to the race (the bridge).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SkipForward } from 'lucide-react';
import {
  TUTORIAL_STEPS, TUTORIAL_VOICE_SET, allows, autopilot, currentStep, newTutorial, skipTutorial, speedCap, tutorialFrame, tutorialInput,
} from '../../game/story/tutorial';
import type { TutorialInput, TutorialState } from '../../game/story/tutorial';
import { playVoice, preloadVoice, stopVoice } from '../../game/voice';
import VoiceSubtitles from '../VoiceSubtitles';

/** What the race tells the tutorial each physics step. */
export interface TutorialStepFrame { x: number; vx: number; lane: number; gateOpen: boolean; finished: boolean; time: number }

/** The one object the race and the tutorial share. The race reads the fields; the overlay assigns the functions. */
export interface TutorialBridge {
  /** Each physics step (may freeze the race on a lesson's spot). */
  step: (f: TutorialStepFrame) => void;
  /** Once a frame: the pause dialog, and the chequered flag. */
  onFrame: (f: { paused: boolean; finished: boolean }) => void;
  /** May this input reach the race right now? */
  allow: (input: TutorialInput) => boolean;
  /** The race acted on an allowed input. */
  press: (input: TutorialInput, time: number) => void;
  /** The race is frozen on a lesson (no physics until the key is pressed). */
  frozen: boolean;
  /** The ball drives itself (full right) between lessons. */
  autopilot: boolean;
  /** The self-driving ball's top speed at race time `t`. */
  cap: (t: number) => number;
}

export function newBridge(): TutorialBridge {
  return { step: () => undefined, onFrame: () => undefined, allow: () => true, press: () => undefined, frozen: false, autopilot: false, cap: () => Infinity };
}

const styles = `
.tutorial-layer { position: fixed; inset: 0; z-index: 70; pointer-events: none; font-family: var(--sans, system-ui); }
.tutorial-scrim { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 55%, rgba(4,8,14,0.25), rgba(4,8,14,0.72)); animation: tut-in .18s ease-out; }
.tutorial-prompt { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 18px;
  padding: 22px 28px 18px; max-width: min(560px, 92vw); text-align: center; color: #fff; pointer-events: none; animation: tut-pop .22s cubic-bezier(.2,1.4,.4,1); }
.tutorial-step { font: 700 12px var(--mono, monospace); letter-spacing: 2px; color: #fde68a; text-transform: uppercase; }
.tutorial-text { margin: 0; font: 600 clamp(17px, 2.4vw, 22px)/1.35 var(--sans, system-ui); text-shadow: 0 2px 8px #000; }
.tutorial-keys { display: flex; gap: 14px; align-items: center; justify-content: center; flex-wrap: wrap; }
.tutorial-key { min-width: 86px; height: 86px; padding: 0 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: 16px;
  background: linear-gradient(180deg, #fff, #d6dde6); color: #111827; font: 800 32px var(--display, Impact, sans-serif); letter-spacing: 1px;
  box-shadow: 0 8px 0 #7d8896, 0 12px 24px rgba(0,0,0,.5); animation: tut-bob 1.1s ease-in-out infinite; transition: transform .08s, box-shadow .08s, background .12s; }
.tutorial-key.is-pressed { transform: translateY(7px) scale(.96); box-shadow: 0 1px 0 #15803d, 0 4px 12px rgba(0,0,0,.4); background: linear-gradient(180deg, #86efac, #22c55e); color: #052e16; animation: none; }
.tutorial-or { font: 700 13px var(--mono, monospace); color: #cbd5e1; }
.tutorial-call { font: 800 clamp(20px, 3vw, 28px) var(--display, Impact, sans-serif); letter-spacing: 1px; text-transform: uppercase; color: #fde047; text-shadow: 0 2px 10px #000; }
.tutorial-banner { position: absolute; left: 50%; top: 84px; transform: translateX(-50%); max-width: min(560px, 92vw); padding: 10px 18px; border-radius: 10px;
  background: rgba(10,16,24,.88); border: 1px solid #2a3a52; color: #fff; font: 600 15px/1.35 var(--sans, system-ui); text-align: center; animation: tut-in .2s; }
.tutorial-skip { position: absolute; right: 16px; bottom: 16px; pointer-events: auto; }
.tutorial-skip button { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 8px; border: 1px solid #334155; background: rgba(10,16,24,.85); color: #cbd5e1; font: 700 12px var(--mono, monospace); letter-spacing: 1px; text-transform: uppercase; cursor: pointer; }
.tutorial-glow { position: relative; z-index: 71; box-shadow: 0 0 0 4px #fde047, 0 0 26px 8px rgba(253,224,71,.8) !important; animation: tut-glow .8s ease-in-out infinite alternate; }
@keyframes tut-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes tut-pop { from { transform: translate(-50%, -46%) scale(.9); opacity: 0 } to { transform: translate(-50%, -50%) scale(1); opacity: 1 } }
@keyframes tut-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
@keyframes tut-glow { from { box-shadow: 0 0 0 3px #fde047, 0 0 14px 4px rgba(253,224,71,.6) } to { box-shadow: 0 0 0 5px #fde047, 0 0 30px 10px rgba(253,224,71,.95) } }
@media (max-height: 520px) { .tutorial-key { min-width: 64px; height: 64px; font-size: 24px; } .tutorial-prompt { gap: 10px; } .tutorial-banner { top: 56px; } }
`;

interface Props {
  bridge: TutorialBridge;
  /** Every step done and the last line spoken. */
  onDone: () => void;
  /** The player skipped (a real click on Skip). */
  onSkip: () => void;
}

export default function TutorialOverlay({ bridge, onDone, onSkip }: Props) {
  const [machine, setMachine] = useState<TutorialState>(newTutorial);
  const machineRef = useRef(machine);
  const [pressed, setPressed] = useState<string | null>(null);
  const boostedAt = useRef<number | null>(null);
  const spoken = useRef(-1);
  const linePromise = useRef<Promise<void> | null>(null);
  const doneNotified = useRef(false);
  const callbacks = useRef({ onDone, onSkip });
  callbacks.current = { onDone, onSkip };
  const isTouch = useMemo(() => typeof matchMedia !== 'undefined' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window), []);

  const commit = (next: TutorialState) => {
    if (next === machineRef.current) return;
    machineRef.current = next;
    bridge.frozen = next.frozen;
    bridge.autopilot = autopilot(next);
    setMachine(next);
  };

  // The bridge: the race calls these synchronously, so a freeze lands on the exact physics step.
  useMemo(() => {
    bridge.frozen = false;
    bridge.autopilot = true;
    bridge.cap = (t) => speedCap(t, boostedAt.current);
    bridge.allow = (input) => allows(machineRef.current, input);
    bridge.press = (input, time) => {
      if (input === 'engine' || input === 'skill') boostedAt.current = time;
      commit(tutorialInput(machineRef.current, input));
    };
    bridge.step = (f) => commit(tutorialFrame(machineRef.current, f));
    bridge.onFrame = (f) => {
      if (f.paused) stopVoice();
      if (machineRef.current.done && !doneNotified.current && !machineRef.current.skipped) {
        doneNotified.current = true;
        void (linePromise.current ?? Promise.resolve()).then(() => callbacks.current.onDone());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  // Speak each step once: the moment it freezes, or when a no-key step comes up.
  const step = currentStep(machine);
  useEffect(() => {
    if (!step || machine.skipped) return;
    const speakNow = machine.frozen || step.keys === null;
    if (!speakNow || spoken.current === machine.index) return;
    spoken.current = machine.index;
    linePromise.current = playVoice(TUTORIAL_VOICE_SET, step.line);
    const next = TUTORIAL_STEPS[machine.index + 1];
    if (next) preloadVoice(TUTORIAL_VOICE_SET, next.line);
  }, [machine, step]);
  // a welcome while the lights count
  useEffect(() => {
    const id = window.setTimeout(() => { if (spoken.current < 0) linePromise.current = playVoice(TUTORIAL_VOICE_SET, 'tutorial-welcome'); }, 400);
    preloadVoice(TUTORIAL_VOICE_SET, TUTORIAL_STEPS[0].line);
    return () => window.clearTimeout(id);
  }, []);

  // The key lights up the moment it goes down (the race acts on it through the bridge).
  useEffect(() => {
    if (!machine.frozen || !step?.keys) return;
    const codes = step.keys.codes;
    const down = (e: KeyboardEvent) => { if (codes.includes(e.code)) setPressed(e.code); };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [machine.frozen, step]);
  useEffect(() => { if (!machine.frozen) { const id = window.setTimeout(() => setPressed(null), 250); return () => window.clearTimeout(id); } }, [machine.frozen]);

  // On a phone, the real on-screen button glows while its lesson waits.
  useEffect(() => {
    if (!machine.frozen || !step?.keys) return;
    const nodes = Array.from(document.querySelectorAll(step.keys.touchSelector)).slice(0, step.keys.touchSelector === '.loadout-slot' ? 1 : 4);
    nodes.forEach((n) => n.classList.add('tutorial-glow'));
    return () => nodes.forEach((n) => n.classList.remove('tutorial-glow'));
  }, [machine.frozen, step]);

  useEffect(() => () => stopVoice(), []);

  const skip = () => {
    stopVoice();
    commit(skipTutorial(machineRef.current));
    bridge.frozen = false;
    bridge.autopilot = false;
    callbacks.current.onSkip();
  };

  if (typeof document === 'undefined' || machine.skipped) return null;
  const keyLabel = (k: string, i: number) => {
    const code = step?.keys?.codes[i];
    const lit = pressed !== null && (code === pressed || (step?.keys?.codes.includes(pressed) && i === 0));
    return <kbd key={k} className={`tutorial-key${lit ? ' is-pressed' : ''}`}>{k}</kbd>;
  };
  return createPortal(
    <div className="tutorial-layer">
      <style>{styles}</style>
      {step && machine.frozen && step.keys && <>
        <div className="tutorial-scrim" />
        <div className="tutorial-prompt" role="dialog" aria-label={step.prompt ?? step.text}>
          <span className="tutorial-step">Lesson {machine.index + 1} of {TUTORIAL_STEPS.length}</span>
          <p className="tutorial-text">{step.text}</p>
          <div className="tutorial-keys">
            {isTouch
              ? <kbd className={`tutorial-key${pressed ? ' is-pressed' : ''}`}>{step.keys.touch}</kbd>
              : step.keys.keyboard.flatMap((k, i) => (i === 0 ? [keyLabel(k, i)] : [<span key={`or${i}`} className="tutorial-or">OR</span>, keyLabel(k, i)]))}
          </div>
          <span className="tutorial-call">{isTouch ? `Tap ${step.keys.touch}` : step.prompt}</span>
        </div>
      </>}
      {step && !step.keys && <div className="tutorial-banner" role="status">{step.text}</div>}
      {!machine.done && <div className="tutorial-skip">
        {/* Only a real click or tap skips: Space/Enter (the keys the lessons ask for) must never land on it. */}
        <button tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onKeyDown={(e) => e.preventDefault()} onClick={(e) => { if (e.detail > 0) skip(); }}><SkipForward size={14} /> Skip tutorial</button>
      </div>}
      <VoiceSubtitles />
    </div>,
    document.body,
  );
}
