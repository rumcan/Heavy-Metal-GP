import { useState, useMemo } from 'react';
import Dialog from '../Dialog';
import { TILES } from './palette';

const art = import.meta.glob<string>('../../assets/game/*.{webp,png}', { eager: true, import: 'default' });
const artFor = (name: string | null) => (name ? art[`../../assets/game/${name}.webp`] ?? art[`../../assets/game/${name}.png`] ?? null : null);

interface Props {
  onClose: () => void;
  onSave: (name: string, sprite: string) => void;
  defaultSprite: string;
}

export default function TemplateSaveDialog({ onClose, onSave, defaultSprite }: Props) {
  const [name, setName] = useState('New Template');
  const [sprite, setSprite] = useState(defaultSprite);

  const uniqueSprites = useMemo(() => {
    const sprites = new Set<string>();
    for (const t of TILES) {
      if (t.sprite) sprites.add(t.sprite);
    }
    return Array.from(sprites);
  }, []);

  return (
    <Dialog onClose={onClose} titleId="template-save-title" className="publish-dialog">
      <h2 id="template-save-title" style={{ marginTop: 0 }}>Save Template</h2>
      <p className="dialog-intro text-muted" style={{ marginBottom: 16 }}>
        Choose a name and an icon for your template. It will appear in the Templates tab.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '6px' }}>Template Name</label>
          <input
            type="text"
            className="lobby-input"
            style={{ width: '100%', padding: '8px 12px', background: '#0e151d', border: '1px solid #334252', borderRadius: '4px', color: '#fff' }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '6px' }}>Template Icon</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '200px', overflowY: 'auto', padding: '4px', border: '1px solid #1e2936', borderRadius: '6px', background: '#0c1016' }}>
            {uniqueSprites.map(s => {
              const src = artFor(s);
              return (
                <button
                  key={s}
                  type="button"
                  style={{
                    width: '32px', height: '32px', padding: '2px',
                    background: sprite === s ? '#d63e2e' : 'transparent',
                    border: `1px solid ${sprite === s ? '#ff6b5a' : 'transparent'}`,
                    borderRadius: '4px', cursor: 'pointer'
                  }}
                  onClick={() => setSprite(s)}
                  title={s}
                >
                  {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} draggable={false} /> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <button type="button" className="button-secondary" onClick={onClose} style={{ padding: '8px 16px' }}>Cancel</button>
          <button type="button" className="button-primary" onClick={() => onSave(name, sprite)} style={{ padding: '8px 16px' }} disabled={!name.trim()}>Save Template</button>
        </div>
      </div>
    </Dialog>
  );
}
