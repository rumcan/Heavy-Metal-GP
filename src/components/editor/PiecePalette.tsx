import { useState, useEffect, Fragment } from 'react';
import { Weight, Zap, CircleDot } from 'lucide-react';
import { PALETTE, PLATFORMER_PALETTE } from './palette';
import { getTemplates, deleteTemplate } from './templates';
import { pegArts, pegArtById, chosenPegArt, choosePegArt } from '../../game/peg-art';
import { scaffoldKits, scaffoldKitById, chosenScaffoldKit, chooseScaffoldKit, SCAFFOLD_MARGIN } from '../../game/scaffold-kits';
import { W } from '../../game/track';
import { piecePoints } from '../../game/platformer/crossings';
import { doubleLoopKit, loopKit, overpassKit } from '../../game/platformer/track-kits';
import type { Piece } from '../../game/trackdef';
import signUrl from '../../assets/game/platformer/sign.webp';
import doorUrl from '../../assets/game/platformer/door.webp';
import cloudUrl from '../../assets/game/platformer/clouds/cloud-1.webp';

const art = import.meta.glob<string>('../../assets/game/*.{webp,png}', { eager: true, import: 'default' });
/** Tiles whose own piece has art outside the sprite folder: the thing a click lays. */
const TILE_ART: Record<string, string> = { sign: signUrl, cloud: cloudUrl, 'gate-door': doorUrl };

/** The Workshop track kits, drawn as the very pieces they place (their ramps and curves), fitted to the tile. */
const KIT_PIECES: Record<string, () => Piece[]> = { 'track-loop': () => loopKit(0, 0), 'track-double-loop': () => doubleLoopKit(0, 0), 'track-overpass': () => overpassKit(0, 0) };

function KitIcon({ id }: { id: string }) {
  const lines = KIT_PIECES[id]().map((p) => piecePoints(p) ?? []);
  const all = lines.flat();
  const minX = Math.min(...all.map((q) => q.x)), maxX = Math.max(...all.map((q) => q.x));
  const minY = Math.min(...all.map((q) => q.y)), maxY = Math.max(...all.map((q) => q.y));
  const w = 64, h = 38, pad = 4;
  const k = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxY - minY));
  const ox = (w - (maxX - minX) * k) / 2, oy = (h - (maxY - minY) * k) / 2;
  const d = lines.map((pts) => pts.map((q, i) => `${i ? 'L' : 'M'}${(ox + (q.x - minX) * k).toFixed(1)} ${(oy + (q.y - minY) * k).toFixed(1)}`).join(' ')).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={d} fill="none" stroke="#4a2a12" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#c8873f" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The lane ramp: the wooden jump wedge it lays, with the hop across to the other lane. */
function LaneRampIcon() {
  return (
    <svg viewBox="0 0 64 38" width={64} height={38} aria-hidden="true">
      <path d="M6 33 L52 33 L52 17 Z" fill="#a8692f" stroke="#4a2a12" strokeWidth={2} strokeLinejoin="round" />
      <path d="M6 33 L52 17" stroke="#d99a55" strokeWidth={2} />
      <path d="M40 14 Q48 2 58 8" fill="none" stroke="#facc15" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M53 5 L58 8 L54 12" fill="none" stroke="#facc15" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const artFor = (name: string | null) => (name ? art[`../../assets/game/${name}.webp`] ?? art[`../../assets/game/${name}.png`] ?? null : null);

interface Props {
  /** Armed tile id. */
  active: string | null;
  onPick: (id: string) => void;
  onShowToast?: (msg: string) => void;
  /** P2-22: the pieces of a platformer course instead of the classic ones. */
  side?: boolean;
}

const PEG_COLORS = { blue: '#3b82f6', orange: '#f97316', green: '#22c55e' } as const;

/** The Peg art picture list, with a live preview of the one the next click stamps. */
function PegArtPicker() {
  const [id, setId] = useState(chosenPegArt());
  const art = pegArtById(id);
  const xs = art.dots.map((d) => d.x), ys = art.dots.map((d) => d.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 14, size = 150;
  const k = (size - pad * 2) / Math.max(maxX - minX, maxY - minY, 1);
  return (
    <div className="peg-art-picker">
      <label className="prop-field" style={{ gridTemplateColumns: '1fr' }}>
        <span>Picture</span>
        <select value={id} onChange={(e) => { choosePegArt(e.target.value); setId(e.target.value); }} onKeyDown={(e) => e.stopPropagation()}>
          {pegArts().map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${art.name}: ${art.dots.length} pegs`} style={{ alignSelf: 'center', background: '#070b10', borderRadius: 4 }}>
        {art.dots.map((d, i) => (
          <circle key={i} cx={pad + (d.x - minX) * k + (size - pad * 2 - (maxX - minX) * k) / 2} cy={pad + (d.y - minY) * k + (size - pad * 2 - (maxY - minY) * k) / 2} r={Math.max(1.6, 8 * k)} fill={PEG_COLORS[d.color]} />
        ))}
      </svg>
      <small style={{ color: '#8ea2b5', fontSize: 10 }}>{art.dots.length} pegs · placed as one group</small>
    </div>
  );
}

/** The Scaffold tunnel list, with a live preview of the one the next click stamps and a warning when it will not fit. */
function ScaffoldPicker() {
  const [id, setId] = useState(chosenScaffoldKit());
  const kit = scaffoldKitById(id);
  const size = 150, pad = 10;
  const k = (size - pad * 2) / Math.max(kit.width, kit.height, 1);
  const ox = size / 2, oy = size / 2;
  const railPath = (p: (typeof kit.pieces)[number]) => {
    const pts: string[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, u = 1 - t;
      pts.push(`${(ox + (u * u * p.a[0] + 2 * u * t * p.c[0] + t * t * p.b[0]) * k).toFixed(1)},${(oy + (u * u * p.a[1] + 2 * u * t * p.c[1] + t * t * p.b[1]) * k).toFixed(1)}`);
    }
    return pts.join(' ');
  };
  const tooWide = kit.width > W - SCAFFOLD_MARGIN * 2;
  return (
    <div className="peg-art-picker">
      <label className="prop-field" style={{ gridTemplateColumns: '1fr' }}>
        <span>Tunnel</span>
        <select value={id} onChange={(e) => { chooseScaffoldKit(e.target.value); setId(e.target.value); }} onKeyDown={(e) => e.stopPropagation()}>
          {scaffoldKits().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${kit.name}: ${kit.width} by ${kit.height} pixels`} style={{ alignSelf: 'center', background: '#070b10', borderRadius: 4 }}>
        {kit.pieces.map((p, i) => <polyline key={i} points={railPath(p)} fill="none" stroke="#b0803f" strokeWidth={Math.max(2, 26 * k)} strokeLinecap="round" strokeLinejoin="round" />)}
        <polyline points={kit.centre.filter((_, i) => i % 3 === 0).map((c) => `${(ox + c[0] * k).toFixed(1)},${(oy + c[1] * k).toFixed(1)}`).join(' ')} fill="none" stroke="#070b10" strokeWidth={Math.max(1, 34 * k)} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={ox + kit.entry[0] * k} cy={oy + kit.entry[1] * k} r="3" fill="#38bdf8" />
        <circle cx={ox + kit.exit[0] * k} cy={oy + kit.exit[1] * k} r="3" fill="#f97316" />
      </svg>
      <small style={{ color: '#8ea2b5', fontSize: 10 }}>{kit.blurb}</small>
      <small style={{ color: tooWide ? '#f59e0b' : '#8ea2b5', fontSize: 10 }}>{tooWide ? `Too wide: ${kit.width} px against a ${W} px track.` : `${kit.width} × ${kit.height} px · placed as one group · enter at the blue dot`}</small>
    </div>
  );
}

const StatEffects = ({ effects }: { effects?: { weight?: number, speed?: number, bounce?: number } }) => {
  if (!effects) return null;
  const items = [
    { icon: <Weight size={12} />, label: 'Weight', value: effects.weight, color: '#f59e0b' },
    { icon: <Zap size={12} />, label: 'Speed', value: effects.speed, color: '#3b82f6' },
    { icon: <CircleDot size={12} />, label: 'Bounce', value: effects.bounce, color: '#10b981' },
  ].filter(i => i.value !== undefined);

  if (items.length === 0) return null;

  return (
    <div style={{ marginTop: '8px', background: '#161b22', borderRadius: '4px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ fontSize: '9px', color: '#8ea2b5', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Stat Effects</div>
      {items.map((it, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#c9d1d9', width: '64px', fontSize: '10px' }}>
            <span style={{ color: it.color, display: 'flex' }}>{it.icon}</span>
            {it.label}
          </div>
          <div style={{ flex: 1, background: '#0d1117', height: '6px', borderRadius: '999px', position: 'relative', overflow: 'hidden' }}>
            {/* Center marker */}
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: '#30363d', zIndex: 10 }}></div>
            {/* Gauge fill */}
            <div style={{
              position: 'absolute',
              top: 0, bottom: 0,
              left: it.value! < 0 ? `${50 + it.value! / 2}%` : '50%',
              right: it.value! > 0 ? `${50 - it.value! / 2}%` : '50%',
              backgroundColor: it.value! > 0 ? '#10b981' : '#f43f5e',
              borderRadius: '999px'
            }}></div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default function PiecePalette({ active, onPick, side = false }: Props) {
  const groups = side ? PLATFORMER_PALETTE : PALETTE;
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

    {tab === 'base' && groups.map((group) => <section key={group.id} className="palette-group" aria-labelledby={`palette-${group.id}`}>
      <header className="palette-heading"><span className="eyebrow" id={`palette-${group.id}`}>{group.label}</span><small>{group.note}</small></header>
      <div className="palette-tiles">{group.tiles.map((tile) => {
        const src = TILE_ART[tile.id] ?? artFor(tile.sprite);
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
                {KIT_PIECES[tile.id] ? <KitIcon id={tile.id} /> : tile.id === 'gate-ramp' ? <LaneRampIcon /> : src ? <img src={src} alt="" draggable={false} style={tile.id === 'flipper-right' ? { transform: 'scaleX(-1)' } : undefined} /> : <i className="palette-art-fallback" aria-hidden="true" />}
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
                {tile.id === 'pegart' && <PegArtPicker />}
                {tile.id === 'scaffold' && <ScaffoldPicker />}
                <StatEffects effects={tile.effects} />
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
