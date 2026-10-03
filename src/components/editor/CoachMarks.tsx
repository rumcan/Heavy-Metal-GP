/**
 * MB-09 / P2-15. The Workshop tour: Zapp walks a first-time builder through the Workshop in nine voiced steps
 * (src/components/editor/tour/steps.ts): New track, the pieces, editing, track settings, Test drive, Validate,
 * Save and My tracks, Publish, and where to play your track.
 *
 * Each step spotlights its control via a data-coach attribute and speaks its line (captioned on the card). It moves on
 * with Next, or when the player does the thing (starts a test drive, passes validation). It opens by itself the first
 * time the Workshop opens; Skip is remembered, and the Tutorial button replays it.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import * as storage from '../../game/storage';
import { playVoice, stopVoice } from '../../game/voice';
import type { TrackDef } from '../../game/trackdef';
import { TOUR_STEPS, TOUR_VOICE_SET, tourAutoAdvance, tourCaption, tourVoiceId } from './tour/steps';

// v3: the voiced tour (P2-15) replaces the old 5 steps, so everyone sees it once.
const KEY = 'heavy-metal-gp:coach:v3';

interface CoachState {
  dismissed: boolean;
  step: number; // 0..TOUR_STEPS.length-1, TOUR_STEPS.length = done
}

function loadCoach(): CoachState {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return { dismissed: false, step: 0 };
    const j = JSON.parse(raw) as CoachState;
    if (typeof j.dismissed !== 'boolean' || typeof j.step !== 'number') return { dismissed: false, step: 0 };
    return j;
  } catch { return { dismissed: false, step: 0 }; }
}
function saveCoach(s: CoachState) {
  try { storage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export interface CoachProps {
  def: TrackDef;
  testing: boolean;
  validating: boolean;
  canShare: boolean;
  armed: string | null;
  onClose: () => void;
  onReset?: () => void;
  /** Force open even if dismissed (the Tutorial button) */
  forceOpen?: boolean;
}

export default function CoachMarks({ testing, canShare, forceOpen, onClose }: CoachProps) {
  const [state, setState] = useState<CoachState>(() => loadCoach());
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const stepIdx = Math.min(state.step, TOUR_STEPS.length);
  const done = stepIdx >= TOUR_STEPS.length;
  const step = !done ? TOUR_STEPS[stepIdx] : null;

  const save = (ns: CoachState) => { setState(ns); saveCoach(ns); };

  // Auto-open on the first visit; the Tutorial button replays from the start.
  useEffect(() => {
    if (forceOpen) {
      if (loadCoach().step >= TOUR_STEPS.length || loadCoach().dismissed) save({ dismissed: false, step: 0 });
      setOpen(true);
      return;
    }
    if (!state.dismissed && state.step < TOUR_STEPS.length) {
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [forceOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Doing the step moves the tour on.
  useEffect(() => {
    if (!open || done) return;
    const next = tourAutoAdvance(stepIdx, { testing, valid: canShare });
    if (next !== stepIdx) save({ ...state, step: next });
  }, [testing, canShare, open, done, stepIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zapp speaks each step; closing the tour (or leaving the Workshop) cuts him off.
  useEffect(() => {
    if (!open || !step) return;
    void playVoice(TOUR_VOICE_SET, tourVoiceId(step));
    return () => stopVoice();
  }, [open, step]);

  // Track the target rect for the spotlight. A control that is hidden (the phone palette drawer) gets no spotlight.
  useLayoutEffect(() => {
    if (!open || !step?.target) { setRect(null); return; }
    const update = () => {
      const rects = step.target!.split(' ').map((t) => document.querySelector(`[data-coach="${t}"]`)?.getBoundingClientRect());
      const onScreen = (r?: DOMRect) => !!r && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
      setRect(rects.find(onScreen) ?? null);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const id = setInterval(update, 500);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); clearInterval(id); };
  }, [open, step]);

  const close = () => { setOpen(false); onClose(); };
  const dismiss = () => { save({ dismissed: true, step: stepIdx }); close(); };
  const next = () => {
    const n = Math.min(stepIdx + 1, TOUR_STEPS.length);
    save({ ...state, step: n, dismissed: n >= TOUR_STEPS.length });
    if (n >= TOUR_STEPS.length) close();
  };
  const prev = () => save({ ...state, step: Math.max(0, stepIdx - 1), dismissed: false });
  const replay = () => { save({ dismissed: false, step: 0 }); setOpen(true); };

  useEffect(() => {
    (window as unknown as { __coachReset?: () => void }).__coachReset = replay;
    return () => { delete (window as unknown as { __coachReset?: () => void }).__coachReset; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || done) {
    if (forceOpen && done) {
      return (
        <div className="coach-overlay" role="dialog" aria-modal="true" aria-label="Tour complete">
          <div className="coach-card is-done">
            <h3><Sparkles size={16} /> That's the tour!</h3>
            <p>Build, test, validate, publish, race. You are a Workshop goblin now.</p>
            <div className="coach-actions">
              <button className="button-primary" onClick={() => { save({ dismissed: true, step: TOUR_STEPS.length }); close(); }}>Done</button>
              <button className="button-secondary" onClick={replay}>Replay</button>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="coach-overlay" role="dialog" aria-modal="true" aria-label={step!.title}>
      {rect && (
        <div
          className="coach-spot"
          aria-hidden="true"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      {/* Bottom-centred so it never clips on a phone; the spotlight still points at the control. */}
      <div className="coach-card" style={{ bottom: '20px', left: '50%', transform: 'translateX(-50%)', top: 'auto' }}>
        <header className="coach-head">
          <span className="coach-step">{stepIdx + 1} / {TOUR_STEPS.length}</span>
          <h3>{step!.title}</h3>
          <button className="icon-button" onClick={dismiss} aria-label="Dismiss tutorial"><X size={14} /></button>
        </header>
        <p className="coach-body"><b className="coach-speaker">Zapp:</b> {tourCaption(step!)}</p>
        <div className="coach-dots" aria-hidden="true">
          {TOUR_STEPS.map((_, i) => <span key={i} className={i === stepIdx ? 'is-active' : i < stepIdx ? 'is-done' : ''} />)}
        </div>
        <div className="coach-actions">
          <button className="button-secondary" onClick={dismiss}>Skip</button>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            {stepIdx > 0 && <button className="button-secondary" onClick={prev}><ChevronLeft size={14} /> Back</button>}
            <button className="button-primary" onClick={next}>{stepIdx === TOUR_STEPS.length - 1 ? 'Done' : 'Next'} <ChevronRight size={14} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function resetCoach() {
  try { storage.removeItem(KEY); } catch { /* ignore */ }
  const fn = (window as unknown as { __coachReset?: () => void }).__coachReset;
  if (fn) fn();
}
