/**
 * MB-09. New track dialog — Blank, calendar copies, and 3 hand-made templates.
 *
 * Offered when the player hits "New track" in the Workshop.  Each option builds
 * a TrackDef that immediately replaces the editor's circuit (after history push).
 * Calendar copies go through `generateTrackDef` so they are true procedural
 * circuits, not hand-made.
 */
import { X, Sparkles, Map, LayoutGrid, Zap, Target, ShoppingCart } from 'lucide-react';
import { CALENDAR } from '../../game/season';
import { generateTrackDef } from '../../game/trackdef';
import type { TrackDef } from '../../game/trackdef';
import { TEMPLATES, blankTemplate } from '../../game/templates';
import TrackThumbnail from './TrackThumbnail';

interface Props {
  onClose: () => void;
  onCreate: (def: TrackDef) => void;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export default function NewTrackDialog({ onClose, onCreate }: Props) {
  // TEMPLATES already includes blank; split for layout
  const blank = blankTemplate();
  const handMade = TEMPLATES.filter((t) => t.id !== 'blank');

  const pickBlank = () => {
    onCreate(blankTemplate());
    onClose();
  };
  const pickTemplate = (id: string) => {
    const e = handMade.find((t) => t.id === id);
    if (!e) return;
    onCreate(e.build());
    onClose();
  };
  const pickCalendar = (i: number) => {
    const gp = CALENDAR[i];
    if (!gp) return;
    const def = generateTrackDef(randomSeed(), gp.profile, `${gp.short} — copy`);
    // Keep short name within MAX_NAME
    def.name = def.name.slice(0, 48);
    onCreate(def);
    onClose();
  };

  return (
    <div className="new-track-overlay" role="dialog" aria-modal="true" aria-labelledby="new-track-title" onClick={onClose}>
      <div className="new-track-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="new-track-head">
          <h2 id="new-track-title">New track</h2>
          <p>Start blank, from a calendar circuit, or a hand-made starter. Pick one — you can always undo.</p>
          <button className="icon-button new-track-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="new-track-body">
          <section className="new-track-section">
            <h3><LayoutGrid size={14} /> Blank</h3>
            <div className="new-track-grid is-single">
              <button className="new-track-card" onClick={pickBlank}>
                <TrackThumbnail def={blank} />
                <strong>Blank canvas</strong>
                <span>Empty grid + finish. Add anything.</span>
              </button>
            </div>
          </section>

          <section className="new-track-section">
            <h3><Map size={14} /> Copy a calendar circuit</h3>
            <p className="new-track-hint">Each is a fresh <code>generateTrackDef</code> copy of that Grand Prix's profile — same recipe, new seed.</p>
            <div className="new-track-grid">
              {CALENDAR.map((gp, i) => {
                // Preview def for thumbnail — deterministic per i so thumb is stable
                const preview = generateTrackDef(0xC0FFEE + i * 0x9e3779b1, gp.profile, gp.short);
                return (
                  <button key={gp.id} className="new-track-card" onClick={() => pickCalendar(i)}>
                    <TrackThumbnail def={preview} />
                    <strong><span className="new-track-flag">{gp.flag}</span> {gp.short}</strong>
                    <span className="new-track-desc">{gp.desc}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="new-track-section">
            <h3><Sparkles size={14} /> Starter templates</h3>
            <p className="new-track-hint">Hand-made — Loop gauntlet, Peggle cascade, Minecart run.</p>
            <div className="new-track-grid">
              {handMade.map((e) => {
                const preview = e.build();
                const Icon = e.id === 'loop' ? Zap : e.id === 'peggle' ? Target : ShoppingCart;
                return (
                  <button key={e.id} className="new-track-card" onClick={() => pickTemplate(e.id)}>
                    <TrackThumbnail def={preview} />
                    <strong><Icon size={13} /> {e.label}</strong>
                    <span>{e.desc}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <footer className="new-track-foot">
          <button className="button-secondary" onClick={onClose}>Cancel</button>
        </footer>
      </div>
    </div>
  );
}
