/**
 * MB-09. 5-step coach marks for first-time Workshop players.
 *
 * Steps: place a ramp, add a loop, test drive, validate, share.
 * The overlay highlights the relevant control via data-coach attributes and
 * advances when the player performs the action (or clicks Next). Dismissal is
 * persisted so returning players aren't nagged, but a "Show tutorial" button can
 * reopen it.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import * as storage from '../../game/storage';
import type { TrackDef } from '../../game/trackdef';

const KEY = 'heavy-metal-gp:coach:v1';

interface CoachState {
  dismissed: boolean;
  step: number; // 0..4, 5 = done
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
  /** Force open even if dismissed (for Help menu) */
  forceOpen?: boolean;
}

interface Step {
  id: string;
  title: string;
  body: string;
  target: string; // data-coach value
  cta: string;
}

const STEPS: Step[] = [
  { id: 'ramp', title: 'Step 1 — Place a ramp', body: 'Pick Ramp in the palette (Rails) then click the canvas to drop it. Drag its ends to set the angle.', target: 'palette-ramp', cta: 'Place a ramp' },
  { id: 'loop', title: 'Step 2 — Add a loop', body: 'Pick Loop, click to place it where the marble will have speed. Loops need a run-up — the ramp you just placed.', target: 'palette-loop', cta: 'Add a loop' },
  { id: 'test', title: 'Step 3 — Test drive', body: 'Hit Test drive to roll a marble through your track. Esc returns — your edits and camera are kept.', target: 'testdrive', cta: 'Test drive' },
  { id: 'validate', title: 'Step 4 — Validate', body: 'Run Validate — we headless-roll 10 marbles. Need 9/10 finishers and no errors to share.', target: 'validate', cta: 'Validate' },
  { id: 'share', title: 'Step 5 — Share', body: 'When VALID, Share copies a compressed code. Paste it online to host a custom race, or send it to a friend.', target: 'share', cta: 'Share' },
];

export default function CoachMarks({ def, testing, canShare, forceOpen, onClose }: CoachProps) {
  const [state, setState] = useState<CoachState>(() => loadCoach());
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const stepIdx = Math.min(state.step, STEPS.length);
  const done = stepIdx >= STEPS.length;
  const step = !done ? STEPS[stepIdx] : null;

  // Auto-open on first visit
  useEffect(() => {
    if (forceOpen) { setOpen(true); return; }
    if (!state.dismissed && state.step < STEPS.length) {
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [forceOpen, state.dismissed, state.step]);

  // Auto-advance / auto-rewind based on track content so a fresh blank track always starts at step 0
  useEffect(() => {
    if (!open || done) return;
    const hasRamp = def.pieces.some((p) => p.t === 'ramp' || p.t === 'ice');
    const hasLoop = def.pieces.some((p) => p.t === 'loop');
    // Compute the earliest step that is still incomplete based on current track
    let desired = 0;
    if (!hasRamp) desired = 0;
    else if (!hasLoop) desired = 1;
    else if (!testing && !canShare) desired = 2; // need to test
    else if (!canShare) desired = 3; // need to validate
    else desired = 4; // share
    // If the track changed to an earlier stage (e.g., Blank after a full track), rewind
    // If it moved forward, advance — but never skip ahead more than one at a time for test/validate
    let next = state.step;
    if (desired < state.step) next = desired;
    else if (stepIdx === 0 && hasRamp) next = 1;
    else if (stepIdx === 1 && hasLoop) next = 2;
    else if (stepIdx === 2 && testing) next = 3;
    else if (stepIdx === 3 && canShare) next = 4;
    if (next !== state.step) {
      const ns = { ...state, step: next };
      setState(ns); saveCoach(ns);
    }
  }, [def.pieces, testing, canShare, open, done, stepIdx, state]);

  // Track target rect for spotlight
  useLayoutEffect(() => {
    if (!open || !step) { setRect(null); return; }
    const update = () => {
      const el = document.querySelector(`[data-coach=\"${step.target}\"]`) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
      else setRect(null);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const id = setInterval(update, 500);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); clearInterval(id); };
  }, [open, step]);

  const dismiss = () => {
    const ns: CoachState = { dismissed: true, step: stepIdx };
    setState(ns); saveCoach(ns);
    setOpen(false);
    onClose();
  };
  const next = () => {
    const n = Math.min(stepIdx + 1, STEPS.length);
    const ns: CoachState = { ...state, step: n };
    if (n >= STEPS.length) ns.dismissed = true;
    setState(ns); saveCoach(ns);
    if (n >= STEPS.length) { setOpen(false); onClose(); }
  };
  const prev = () => {
    const n = Math.max(0, stepIdx - 1);
    const ns = { ...state, step: n, dismissed: false };
    setState(ns); saveCoach(ns);
  };
  const resetAndOpen = () => {
    const ns: CoachState = { dismissed: false, step: 0 };
    setState(ns); saveCoach(ns);
    setOpen(true);
  };

  // Expose reset globally via custom event for parent to call? Instead parent controls via forceOpen.
  // Also allow external reset via window (for help button)
  useEffect(() => {
    (window as unknown as { __coachReset?: () => void }).__coachReset = resetAndOpen;
    return () => { delete (window as unknown as { __coachReset?: () => void }).__coachReset; };
  }, []);

  const style = useMemo(() => {
    // Keep the card bottom-centered so it never clips or goes off-screen;
    // the spotlight still points at the target. Bottom-center is also the
    // Blizzard tutorial convention and works on mobile.
    void rect;
    return { bottom: '20px', left: '50%', transform: 'translateX(-50%)', top: 'auto' } as const;
  }, [rect]);

  if (!open || done) {
    if (forceOpen && done) {
      return (
        <div className="coach-overlay" role="dialog" aria-modal="true" aria-label="Tutorial complete">
          <div className="coach-card is-done">
            <h3><Sparkles size={16} /> You built it!</h3>
            <p>Ramp, loop, test, validate, share — you are a Workshop goblin now. Make another track or close.</p>
            <div className="coach-actions">
              <button className="button-primary" onClick={() => { const ns: CoachState = { dismissed: true, step: STEPS.length }; setState(ns); saveCoach(ns); setOpen(false); onClose(); }}>Done</button>
              <button className="button-secondary" onClick={resetAndOpen}>Replay</button>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="coach-overlay" role="dialog" aria-modal="true" aria-label={step!.title}>
      {/* Spotlight cutout via box-shadow */}
      {rect && (
        <div
          className="coach-spot"
          aria-hidden="true"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}
      <div className="coach-card" style={style as unknown as React.CSSProperties}>
        <header className="coach-head">
          <span className="coach-step">{stepIdx + 1} / {STEPS.length}</span>
          <h3>{step!.title}</h3>
          <button className="icon-button" onClick={dismiss} aria-label="Dismiss tutorial"><X size={14} /></button>
        </header>
        <p className="coach-body">{step!.body}</p>
        {stepIdx === 0 && <p className="coach-hint">Tip: Grid snaps to 25 u — toggle it in the toolbar.</p>}
        <div className="coach-dots" aria-hidden="true">
          {STEPS.map((_, i) => <span key={i} className={i === stepIdx ? 'is-active' : i < stepIdx ? 'is-done' : ''} />)}
        </div>
        <div className="coach-actions">
          <button className="button-secondary" onClick={dismiss}>Skip</button>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            {stepIdx > 0 && <button className="button-secondary" onClick={prev}><ChevronLeft size={14} /> Back</button>}
            <button className="button-primary" onClick={next}>{stepIdx === STEPS.length - 1 ? 'Done' : 'Next'} <ChevronRight size={14} /></button>
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
