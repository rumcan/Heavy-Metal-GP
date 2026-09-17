/**
 * MB-02. The piece palette: the sidebar a player builds from.
 *
 * Every tile shows the piece's real race sprite (the same art `src/game/render.ts` draws it with), and arming a
 * tile is the whole of this ticket's canvas interaction — MB-03 turns an armed tile into a placed piece. Until
 * then the armed tile is stated plainly in the toolbar rather than pretended at.
 *
 * Art comes from a component-local glob rather than `sprite()` so a tile is never blank while the game's
 * sprite cache is still decoding (the same pattern as the race's item toolbar).
 */
import { PALETTE } from './palette';
import type { PieceType } from './palette';

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
        >
          <span className="palette-art">{src ? <img src={src} alt="" draggable={false} /> : <i className="palette-art-fallback" aria-hidden="true" />}</span>
          <span className="palette-label">{tile.label}</span>
        </button>;
      })}</div>
    </section>)}
    <p className="palette-note">Arm a piece to build with it. Placing, moving and rotating come next — for now the Workshop is the camera, the grid and the palette.</p>
  </div>;
}
