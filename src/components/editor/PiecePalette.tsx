/**
 * MB-02 + MB-09. The piece palette: the sidebar a player builds from. Each tile shows the piece's race art on
 * a dark, rust-edged card (styled in editor.css), and carries a data-coach hook for the 5-step tutorial.
 * Tiles are armed by id, so variants of one piece (blue / orange / item pegs) are separate tiles.
 */
import { PALETTE } from './palette';

const art = import.meta.glob<string>('../../assets/game/*.webp', { eager: true, import: 'default' });
const artFor = (name: string | null) => (name ? art[`../../assets/game/${name}.webp`] ?? null : null);

interface Props {
  /** Armed tile id. */
  active: string | null;
  onPick: (id: string) => void;
}

export default function PiecePalette({ active, onPick }: Props) {
  return <div className="editor-palette">
    {PALETTE.map((group) => <section key={group.id} className="palette-group" aria-labelledby={`palette-${group.id}`}>
      <header className="palette-heading"><span className="eyebrow" id={`palette-${group.id}`}>{group.label}</span><small>{group.note}</small></header>
      <div className="palette-tiles">{group.tiles.map((tile) => {
        const src = artFor(tile.sprite);
        const armed = active === tile.id;
        return <button
          key={tile.id}
          type="button"
          className={`palette-tile ${armed ? 'armed' : ''}`}
          aria-pressed={armed}
          title={`${tile.label} — ${tile.hint}`}
          onClick={() => onPick(tile.id)}
          data-coach={`palette-${tile.id}`}
        >
          <span className="palette-art">
            {src ? <img src={src} alt="" draggable={false} /> : <i className="palette-art-fallback" aria-hidden="true" />}
          </span>
          <span className="palette-label">{tile.label}</span>
        </button>;
      })}</div>
    </section>)}
    <p className="palette-note">Arm a piece to build with it. Click the canvas to place. Drag pieces or handles to edit. Shift+click / drag a box to multi-select.</p>
  </div>;
}
