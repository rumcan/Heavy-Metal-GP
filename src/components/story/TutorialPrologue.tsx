// P2-13 (#119) — the story's prologue. A fresh save opens HERE instead of the hub:
// one screen that says "your first race is a short, voiced lesson" with a big way in and
// a big way around (Skip goes straight to Chapter 1). No state of its own — StoryMode
// owns the save and the stage machine.
import { Flag, GraduationCap, SkipForward } from 'lucide-react';

const styles = `
.tutorial-prologue { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 24px; background: radial-gradient(1100px 700px at 50% -10%, #16321f 0%, #0b1510 55%, #070d0a 100%); }
.tutorial-prologue-card { max-width: 620px; width: 100%; text-align: center; color: #e8eef4; }
.tutorial-prologue-card .eyebrow { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; letter-spacing: 0.18em; color: #7dd3fc; font-weight: 700; margin-bottom: 14px; }
.tutorial-prologue-card h1 { font-size: clamp(30px, 6vw, 46px); line-height: 1.05; margin: 0 0 14px; text-transform: uppercase; letter-spacing: 0.02em; }
.tutorial-prologue-card p { font-size: 15.5px; line-height: 1.55; color: #b9c6d2; margin: 0 auto 26px; max-width: 520px; }
.tutorial-prologue-actions { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
.tutorial-prologue-actions button { font-size: 16px; padding: 13px 26px; display: inline-flex; align-items: center; gap: 9px; }
.tutorial-prologue-note { margin-top: 18px; font-size: 12.5px; color: #748596; }
`;

interface Props {
  /** Ride the lessons — starts the Training Grounds tutorial race. */
  onPlay: () => void;
  /** Straight to Chapter 1 — the story never asks again. */
  onSkip: () => void;
}

export default function TutorialPrologue({ onPlay, onSkip }: Props) {
  return <div className="tutorial-prologue">
    <style>{styles}</style>
    <div className="tutorial-prologue-card">
      <span className="eyebrow"><Flag size={14} /> PROLOGUE</span>
      <h1>Learn to Race</h1>
      <p>
        Before the championship, one supervised lap of the Training Grounds: steering, the Magic Engine,
        your skills, jumping and the odd shortcut. It is fully voiced, nobody can hurt you, and it takes
        about a minute.
      </p>
      <div className="tutorial-prologue-actions">
        <button className="button-primary" onClick={onPlay}><GraduationCap size={18} /> Learn to race</button>
        <button className="button-secondary" onClick={onSkip}><SkipForward size={18} /> Skip tutorial</button>
      </div>
      <p className="tutorial-prologue-note">You can always play the tutorial later from How to play.</p>
    </div>
  </div>;
}
