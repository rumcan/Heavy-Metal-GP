/**
 * MB-02 + MB-09. The piece palette: the sidebar a player builds from.
 *
 * MB-09 adds a Blizzard-style riveted frame around each icon
 * (src/assets/editor/palette-frame.png, easily replaceable) and data-coach
 * hooks for the 5-step tutorial.
 */
import { PALETTE } from './palette';
import type { PieceType } from './palette';
// MB-09 palette icon frame — Blizzard style, easily replaceable at src/assets/editor/palette-frame.png
import frameUrl from '../../assets/editor/palette-frame.png';

const art = import.meta.glob<string>('../../assets/game/*.webp', { eager: true, import: 'default' });
const artFor = (name: string | null) => (name ? art[`../../assets/game/${name}.webp`] ?? null : null);

interface Props {
  active: PieceType | null;
  onPick: (t: PieceType) => void;
}

export default function PiecePalette({ active, onPick }: Props) {
  return <div className="editor-palette">
    {PALETTE.map((group) => <section key={group.id} className="palette-group" aria-labelledby={`palette-${group.id}`}>
      <header className="palette-heading"><span className="eyebrow" id={`palette-${group.id}`}>{group.label}</span><small>{group.note}</small></header>
      <div className="palette-tiles">{group.tiles.map((tile) => {
        const src = artFor(tile.sprite);
        const armed = active === tile.t;
        return <button
          key={tile.t}
          type="button"
          className={`palette-tile ${armed ? 'armed' : ''}`}
          aria-pressed={armed}
          title={`${tile.label} — ${tile.hint}`}
          onClick={() => onPick(tile.t)}
          data-coach={`palette-${tile.t}`}
        >
          <span className="palette-art">
            <span className="palette-frame" style={{ backgroundImage: `url(${frameUrl})` }} aria-hidden="true" />
            <span className="palette-art-inner">{src ? <img src={src} alt="" draggable={false} /> : <i className="palette-art-fallback" aria-hidden="true" />}</span>
          </span>
          <span className="palette-label">{tile.label}</span>
        </button>;
      })}</div>
    </section>)}
    <p className="palette-note">Arm a piece to build with it. Click the canvas to place. Drag pieces or handles to edit. Shift+click / drag a box to multi-select.</p>
  </div>;
}
