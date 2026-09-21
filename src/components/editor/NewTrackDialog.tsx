import { useState, useMemo } from 'react';
import { X, Sparkles, Map, LayoutGrid, Zap, Target, ShoppingCart, Dices } from 'lucide-react';
import { CALENDAR } from '../../game/season';
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

type Tab = 'generator' | 'templates';

export default function NewTrackDialog({ onClose, onCreate }: Props) {
  const [tab, setTab] = useState<Tab>('generator');
  const [seedStr, setSeedStr] = useState<string>('');
  const [selectedEnv, setSelectedEnv] = useState<number>(0);

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
  
  const handleGenerate = () => {
    const gp = CALENDAR[selectedEnv];
    if (!gp) return;
    const seed = seedStr.trim() === '' ? randomSeed() : Number(seedStr);
    const def = generateExperimentalTrackDef(seed, gp.profile, `${gp.short} — Gen`);
    def.name = def.name.slice(0, 48);
    onCreate(def);
    onClose();
  };

  const generatedPreview = useMemo(() => {
    const gp = CALENDAR[selectedEnv];
    if (!gp) return blank;
    const seed = seedStr.trim() === '' ? 0xC0FFEE : Number(seedStr);
    return generateExperimentalTrackDef(seed, gp.profile, gp.short);
  }, [selectedEnv, seedStr]);

  return (
    <div className="new-track-overlay" role="dialog" aria-modal="true" aria-labelledby="new-track-title" onClick={onClose}>
      <div className="new-track-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="new-track-head">
          <h2 id="new-track-title">New track</h2>
          <p>Start blank, generate a procedural circuit, or use a hand-made starter.</p>
          <button className="icon-button new-track-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="new-track-tabs">
          <button className={`tab ${tab === 'generator' ? 'is-active' : ''}`} onClick={() => setTab('generator')}>Procedural Generator</button>
          <button className={`tab ${tab === 'templates' ? 'is-active' : ''}`} onClick={() => setTab('templates')}>Starter Templates</button>
        </div>

        <div className="new-track-body" style={{ minHeight: 400 }}>
          {tab === 'generator' && (
            <div className="generator-tab">
              <div className="generator-layout">
                <div className="generator-controls" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 15 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase' }}>Environment</label>
                    <select 
                      value={selectedEnv} 
                      onChange={(e) => setSelectedEnv(Number(e.target.value))}
                      style={{ width: '100%', padding: '8px', background: 'var(--surface-sunken)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 4 }}
                    >
                      {CALENDAR.map((gp, i) => (
                        <option key={gp.id} value={i}>{gp.flag} {gp.name}</option>
                      ))}
                    </select>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>Each environment has a unique signature layout and hazard profile.</p>
                  </div>
                  
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase' }}>Generation Seed</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input 
                        type="number" 
                        value={seedStr} 
                        onChange={(e) => setSeedStr(e.target.value)} 
                        placeholder="Random" 
                        style={{ flex: 1, padding: '8px', background: 'var(--surface-sunken)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 4 }}
                      />
                      <button 
                        className="button-secondary" 
                        onClick={() => setSeedStr(String(randomSeed()))}
                        title="Randomize Seed"
                        style={{ padding: '0 10px' }}
                      >
                        <Dices size={16} />
                      </button>
                    </div>
                  </div>
                  
                  <button className="button-primary" style={{ marginTop: 'auto', padding: '12px', fontSize: 14 }} onClick={handleGenerate}>
                    <Map size={16} /> Generate Track
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

          {tab === 'templates' && (
            <div className="templates-tab">
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
                <h3><Sparkles size={14} /> Hand-Made Templates</h3>
                <p className="new-track-hint">Hand-made starters for specific track types.</p>
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
          )}
        </div>
      </div>
    </div>
  );
}
