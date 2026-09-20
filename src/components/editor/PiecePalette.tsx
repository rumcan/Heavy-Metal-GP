import { useState, useEffect, Fragment } from 'react';
import { Settings } from 'lucide-react';
import { PALETTE } from './palette';
import { getTemplates, deleteTemplate } from './templates';

const art = import.meta.glob<string>('../../assets/game/*.{webp,png}', { eager: true, import: 'default' });
const artFor = (name: string | null) => (name ? art[`../../assets/game/${name}.webp`] ?? art[`../../assets/game/${name}.png`] ?? null : null);

interface Props {
  /** Armed tile id. */
  active: string | null;
  onPick: (id: string) => void;
  onShowToast?: (msg: string) => void;
}

export default function PiecePalette({ active, onPick, onShowToast }: Props) {
  const [tab, setTab] = useState<'base' | 'templates'>('base');
  const [templates, setTemplates] = useState(getTemplates());

  // Reload templates when tab changes just in case
  useEffect(() => {
    if (tab === 'templates') {
      setTemplates(getTemplates());
    }
  }, [tab]);

  // Refresh templates if we switch to the templates tab or periodically when placing
  // A better way is to pass down a reload trigger, but for now we re-read.

  return <div className="editor-palette">
    <div className="palette-tabs">
      <button className={`tab-btn ${tab === 'base' ? 'active' : ''}`} onClick={() => setTab('base')}>Base Items</button>
      <button className={`tab-btn ${tab === 'templates' ? 'active' : ''}`} onClick={() => setTab('templates')}>Templates</button>
    </div>

    {tab === 'base' && PALETTE.map((group) => <section key={group.id} className="palette-group" aria-labelledby={`palette-${group.id}`}>
      <header className="palette-heading"><span className="eyebrow" id={`palette-${group.id}`}>{group.label}</span><small>{group.note}</small></header>
      <div className="palette-tiles">{group.tiles.map((tile) => {
        const src = artFor(tile.sprite);
        const armed = active === tile.id;
        return (
          <Fragment key={tile.id}>
            <button
              type="button"
              className={`palette-tile ${armed ? 'armed' : ''}`}
              aria-pressed={armed}
              title={`${tile.label} — ${tile.hint}`}
              onClick={() => onPick(tile.id)}
              data-coach={`palette-${tile.id}`}
              data-tile={tile.id}
            >
              <span className="palette-art">
                {src ? <img src={src} alt="" draggable={false} style={tile.id === 'flipper-right' ? { transform: 'scaleX(-1)' } : undefined} /> : <i className="palette-art-fallback" aria-hidden="true" />}
              </span>
              <span className="palette-label">{tile.label}</span>
            </button>
            {armed && (
              <div className="palette-tile-details" style={{
                gridColumn: '1 / -1',
                padding: '12px',
                background: '#0b1016',
                border: '1px solid var(--accent)',
                borderRadius: '6px',
                marginTop: '4px',
                marginBottom: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                <strong style={{ color: '#e6edf3', fontSize: '12px', letterSpacing: '0.5px' }}>{tile.label}</strong>
                <p style={{ margin: 0, fontSize: '10px', lineHeight: 1.5, color: '#8ea2b5' }}>{tile.hint}</p>
                <div style={{ marginTop: '4px', display: 'flex' }}>
                  <button
                    type="button"
                    className="editor-tool-select"
                    style={{ fontSize: '9px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}
                    onClick={() => {
                      const msg = "Place this item on the track first, then select it to edit its settings.";
                      if (onShowToast) {
                        onShowToast(msg);
                      } else {
                        console.log(msg);
                      }
                    }}
                  >
                    <Settings size={12} style={{ marginRight: '4px' }} />
                    Settings
                  </button>
                </div>
              </div>
            )}
          </Fragment>
        );
      })}</div>
    </section>)}

    {tab === 'templates' && <section className="palette-group" aria-labelledby="palette-templates">
      <header className="palette-heading"><span className="eyebrow" id="palette-templates">Your Templates</span><small>Saved piece groupings</small></header>
      <div className="palette-tiles">
        {templates.length === 0 && <p className="palette-note">No templates yet. Select multiple pieces and click "Template" to save one.</p>}
        {templates.map((tpl) => {
          const src = artFor(tpl.sprite);
          const armed = active === tpl.id;
          return (
            <Fragment key={tpl.id}>
              <div className="palette-tile-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  type="button"
                  className={`palette-tile ${armed ? 'armed' : ''}`}
                  aria-pressed={armed}
                  title={tpl.name}
                  onClick={() => onPick(tpl.id)}
                >
                  <span className="palette-art">
                    {src ? <img src={src} alt="" draggable={false} /> : <i className="palette-art-fallback" aria-hidden="true" />}
                  </span>
                  <span className="palette-label">{tpl.name}</span>
                </button>
                <button className="text-button" style={{ fontSize: 10, padding: 2 }} onClick={(e) => {
                  e.stopPropagation();
                  deleteTemplate(tpl.id);
                  setTemplates(getTemplates());
                  if (active === tpl.id) onPick(tpl.id);
                }}>Delete</button>
              </div>
              {armed && (
                <div className="palette-tile-details" style={{
                  gridColumn: '1 / -1',
                  padding: '12px',
                  background: '#0b1016',
                  border: '1px solid var(--accent)',
                  borderRadius: '6px',
                  marginTop: '4px',
                  marginBottom: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <strong style={{ color: '#e6edf3', fontSize: '12px', letterSpacing: '0.5px' }}>{tpl.name}</strong>
                  <p style={{ margin: 0, fontSize: '10px', lineHeight: 1.5, color: '#8ea2b5' }}>A custom grouping of pieces saved as a template. Place it on the track to use it.</p>
                  <div style={{ marginTop: '4px', display: 'flex' }}>
                    <button
                      type="button"
                      className="editor-tool-select"
                      style={{ fontSize: '9px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}
                      onClick={() => {
                        const msg = "Place this template on the track first, then select its pieces to edit their settings.";
                        if (onShowToast) {
                          onShowToast(msg);
                        } else {
                          console.log(msg);
                        }
                      }}
                    >
                      <Settings size={12} style={{ marginRight: '4px' }} />
                      Settings
                    </button>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </section>}

    <p className="palette-note">Arm a piece to build with it. Click the canvas to place. Drag pieces or handles to edit. Drag empty space to multi-select.</p>
  </div>;
}
