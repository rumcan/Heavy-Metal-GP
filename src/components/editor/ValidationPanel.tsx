/**
 * MB-05. Results panel with click-to-jump markers on problem spots.
 *
 * Shows static + headless validation, finish rate / median / stuck spots,
 * and a list where each row with a `pos` jumps the editor camera to that
 * world coordinate (via rigCenter).  A track must pass (≥9/10, no hard
 * errors) to be shared/used online; drafts always save.
 */
import type { ValidationResult, ValidationIssue } from './validate';
import { ShieldCheck, ShieldAlert, AlertTriangle, Clock, Flag, MapPin, Crosshair, Timer, Users } from 'lucide-react';

interface Props {
  result: ValidationResult | null;
  validating: boolean;
  onJump: (pos: { x: number; y: number }) => void;
  onValidate: () => void;
}

function IssueRow({ issue, onJump }: { issue: ValidationIssue; onJump: (pos: { x: number; y: number }) => void }) {
  const isError = issue.severity === 'error';
  return (
    <div className={`validation-issue ${isError ? 'is-error' : 'is-warning'}`}>
      <span className="validation-issue-icon">{isError ? <ShieldAlert size={13} /> : <AlertTriangle size={13} />}</span>
      <span className="validation-issue-msg">{issue.message}</span>
      {issue.pos && (
        <button className="validation-jump" onClick={() => onJump(issue.pos!)} title={`Jump to ${Math.round(issue.pos.x)},${Math.round(issue.pos.y)}`}>
          <MapPin size={11} /> {Math.round(issue.pos.x)},{Math.round(issue.pos.y)}
        </button>
      )}
      {issue.pieceIndex !== undefined && <span className="validation-piece">#{issue.pieceIndex}</span>}
    </div>
  );
}

export default function ValidationPanel({ result, validating, onJump, onValidate }: Props) {
  return (
    <div className="validation-panel">
      <header className="validation-head">
        <span className="eyebrow"><b>03</b> VALIDATION</span>
        <button className="button-primary validation-run" onClick={onValidate} disabled={validating} title="Run static + headless (10 marbles at 4×) checks">
          {validating ? <Timer size={13} className="spinning" /> : <ShieldCheck size={13} />}
          {validating ? 'Validating…' : 'Validate'}
        </button>
      </header>

      {!result && !validating && (
        <p className="prop-empty">
          Check if this circuit is finishable, has no traps and gives a fair start. Runs 10 marbles at 4× off-screen — finish rate, median time, stuck spots (marshal recoveries) and time limit hits.
          <br />
          <span style={{ color: '#8ea2b5' }}>Pass = ≥9/10 finishers, no hard errors. Drafts always save; sharing/online needs a pass.</span>
        </p>
      )}

      {validating && (
        <div className="validation-loading">
          <Timer size={14} /> Running headless simulation (4×) and static checks…
        </div>
      )}

      {result && !validating && (
        <>
          <div className={`validation-summary ${result.canShare ? 'is-pass' : 'is-fail'}`}>
            {result.canShare ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
            <strong>{result.canShare ? 'PASS' : 'FAIL'}</strong>
            <span>{result.summary}</span>
          </div>

          <div className="validation-stats">
            <span className="validation-stat"><Users size={11} /> {Math.round(result.headless.finishRate * 10)}/10 finish</span>
            <span className="validation-stat"><Clock size={11} /> median {result.headless.medianTime !== null ? `${(result.headless.medianTime / 1000).toFixed(1)}s` : '—'}</span>
            <span className="validation-stat"><Crosshair size={11} /> {result.headless.stuckSpots.length} trap spots</span>
            <span className="validation-stat"><Flag size={11} /> {result.headless.timeLimitHits} time-outs</span>
            <span className="validation-stat">recoveries {result.headless.totalRecoveries}</span>
          </div>

          <div className="validation-issues">
            {result.issues.length === 0 ? (
              <p className="prop-empty" style={{ color: '#4ade80' }}>No issues — ready to share or race online. Drafts always save.</p>
            ) : (
              result.issues.map((iss, i) => <IssueRow key={i} issue={iss} onJump={onJump} />)
            )}
          </div>

          <div className="validation-meta">
            <span className={`validation-chip ${result.canShare ? 'is-pass' : 'is-fail'}`}>{result.canShare ? 'Can share & race online' : 'Cannot share — fix errors first'}</span>
            <span className="validation-chip">Drafts always save</span>
            {result.headless.stuckSpots.length > 0 && (
              <span className="validation-hint"><MapPin size={10} /> Click a marker to jump camera to that trap</span>
            )}
          </div>

          <details className="validation-details">
            <summary>Headless details — 10 marbles, seed 42, 4× off-screen</summary>
            <div className="validation-details-body">
              <div>Finish times: {result.headless.finishTimes.map((t, i) => (t === null ? `#${i} DNF` : `${(t / 1000).toFixed(1)}s`)).join(', ')}</div>
              <div>Static checks: {result.staticIssues.length} · Headless: {result.headlessIssues.length}</div>
              <div>Stuck spots: {result.headless.stuckSpots.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' · ') || 'none'}</div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
