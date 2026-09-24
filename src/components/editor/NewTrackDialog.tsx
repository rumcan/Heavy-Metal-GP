import { useState, useMemo } from 'react';
import { X, Sparkles, Map, LayoutGrid, Zap, Target, ShoppingCart, Dices, Flag, ArrowRight } from 'lucide-react';
import { CALENDAR } from '../../game/season';
import { officialTrack } from '../../game/official-tracks';
import { generateExperimentalTrackDef } from '../../game/trackdef';
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

type Tab = 'start' | 'generate';

/**
 * New track: either START FROM something that exists (a blank canvas, a copy of a championship circuit, a
 * hand-made starter) or GENERATE a fresh random layout in the hazard style of one of the circuits.
 * Every card says what clicking it does, so it is clear where to click.
 */
export default function NewTrackDialog({ onClose, onCreate }: Props) {
  const [tab, setTab] = useState<Tab>('start');
  const [seedStr, setSeedStr] = useState<string>('');
  const [style, setStyle] = useState<number>(0);

  const blank = useMemo(() => blankTemplate(), []);
  const handMade = useMemo(() => TEMPLATES.filter((t) => t.id !== 'blank').map((t) => ({ ...t, preview: t.build() })), []);
  const circuits = useMemo(() => CALENDAR.map((gp) => ({ gp, def: officialTrack(gp.id) })).filter((c): c is { gp: typeof CALENDAR[number]; def: TrackDef } => !!c.def), []);

  const use = (def: TrackDef) => { onCreate(def); onClose(); };

  const handleGenerate = () => {
    const gp = CALENDAR[style];
    if (!gp) return;
    const seed = seedStr.trim() === '' ? randomSeed() : Number(seedStr);
    const def = generateExperimentalTrackDef(seed, gp.profile, `${gp.short} style #${seed % 10000}`);
    def.name = def.name.slice(0, 48);
    use(def);
  };

  const generatedPreview = useMemo(() => {
    if (tab !== 'generate') return blank;
    const gp = CALENDAR[style];
    if (!gp) return blank;
    const seed = seedStr.trim() === '' ? 0xC0FFEE : Number(seedStr);
    return generateExperimentalTrackDef(seed, gp.profile, gp.short);
  }, [tab, style, seedStr, blank]);

  const card = (key: string, def: TrackDef, title: React.ReactNode, desc: string, onPick: () => void, cta = 'Use this') => (
    <button key={key} className="new-track-card" onClick={onPick}>
      <TrackThumbnail def={def} />
      <strong>{title}</strong>
      <span>{desc}</span>
      <em className="new-track-cta">{cta} <ArrowRight size={12} /></em>
    </button>
  );

  return (
    <div className="new-track-overlay" role="dialog" aria-modal="true" aria-labelledby="new-track-title" onClick={onClose}>
      <div className="new-track-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="new-track-head">
          <h2 id="new-track-title">New track</h2>
          <p>Start from a blank canvas, a championship circuit or a starter — or generate a brand-new layout.</p>
          <button className="icon-button new-track-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="new-track-tabs">
          <button className={`tab ${tab === 'start' ? 'is-active' : ''}`} onClick={() => setTab('start')}><LayoutGrid size={13} /> Start from…</button>
          <button className={`tab ${tab === 'generate' ? 'is-active' : ''}`} onClick={() => setTab('generate')}><Dices size={13} /> Generate new</button>
        </div>

        <div className="new-track-body" style={{ minHeight: 400 }}>
          {tab === 'start' && (
            <>
              <section className="new-track-section">
                <h3><LayoutGrid size={14} /> Blank canvas</h3>
                <div className="new-track-grid is-single">
                  {card('blank', blank, 'Blank canvas', 'Just the start grid and the finish. Build anything.', () => use(blankTemplate()), 'Start blank')}
                </div>
              </section>

              <section className="new-track-section">
                <h3><Flag size={14} /> Championship circuits</h3>
                <p className="new-track-hint">Opens an editable copy. The championship itself is not changed.</p>
                <div className="new-track-grid">
                  {circuits.map(({ gp, def }) => card(gp.id.toString(), def, <><small className="new-track-flag">{gp.flag}</small> {gp.name}</>, `${def.pieces.length} pieces · ${gp.desc}`, () => use({ ...JSON.parse(JSON.stringify(def)), name: `${gp.short} copy` }), 'Edit a copy'))}
                </div>
              </section>

              <section className="new-track-section">
                <h3><Sparkles size={14} /> Starter templates</h3>
                <p className="new-track-hint">Small hand-made starters for one kind of track.</p>
                <div className="new-track-grid">
                  {handMade.map((e) => {
                    const Icon = e.id === 'loop' ? Zap : e.id === 'peggle' ? Target : ShoppingCart;
                    return card(e.id, e.preview, <><Icon size={13} /> {e.label}</>, e.desc, () => use(e.build()));
                  })}
                </div>
              </section>
            </>
          )}

          {tab === 'generate' && (
            <div className="generator-tab">
              <div className="generator-layout">
                <div className="generator-controls" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 15 }}>
                  <div>
                    <label htmlFor="new-track-style" style={{ display: 'block', fontSize: 11, fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase' }}>Style</label>
                    <select
                      id="new-track-style"
                      value={style}
                      onChange={(e) => setStyle(Number(e.target.value))}
                      style={{ width: '100%', padding: '8px', background: 'var(--surface-sunken)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 4 }}
                    >
                      {CALENDAR.map((gp, i) => (
                        <option key={gp.id} value={i}>{gp.flag} {gp.short} style</option>
                      ))}
                    </select>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>
                      Which hazards the generator favours, borrowed from that circuit: {CALENDAR[style]?.desc}
                    </p>
                  </div>

                  <div>
                    <label htmlFor="new-track-seed" style={{ display: 'block', fontSize: 11, fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase' }}>Seed (optional)</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        id="new-track-seed"
                        type="number"
                        value={seedStr}
                        onChange={(e) => setSeedStr(e.target.value)}
                        placeholder="Random"
                        style={{ flex: 1, padding: '8px', background: 'var(--surface-sunken)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 4 }}
                      />
                      <button className="button-secondary" onClick={() => setSeedStr(String(randomSeed()))} title="Pick a random seed" style={{ padding: '0 10px' }}>
                        <Dices size={16} />
                      </button>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>The same seed and style always make the same track.</p>
                  </div>

                  <button className="button-primary" style={{ marginTop: 'auto', padding: '12px', fontSize: 14 }} onClick={handleGenerate}>
                    <Map size={16} /> Generate track
                  </button>
                </div>
                <div className="generator-preview" style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, padding: 10, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: 11, fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase' }}>Preview</div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <TrackThumbnail def={generatedPreview} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
