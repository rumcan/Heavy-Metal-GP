import type { CSSProperties } from 'react';
import { Shuffle } from 'lucide-react';
import { teamOf } from '../../game/types';
import type { MarbleInfo } from '../../game/types';
import { DRIVER_NAMES, RIVALS, characterOf } from '../../game/characters';
import Portrait from '../Portrait';

interface Props {
  roster: MarbleInfo[];
  /** The player's portrait: it names the player's row. */
  portrait: number;
  /** Re-roll the rivals. Omitted where the field is already fixed (a season's grid). */
  onShuffle?: () => void;
}

/** The right-hand column of Quick race and of a championship that has not started: the ten goblins on the grid. */
export default function RosterGrid({ roster, portrait, onShuffle }: Props) {
  return <section className="fit-pane home-field" data-pane-id="field" aria-labelledby="grid-title">
    <div className="section-topline"><div className="eyebrow" id="grid-title"><b>03</b> THE GRID <span className="muted">/ {roster.length} GOBLINS</span></div>{onShuffle && <button className="text-button" onClick={onShuffle}>Shuffle <Shuffle size={14} /></button>}</div>
    <ol className="driver-grid">{roster.map((m) => { const team = teamOf(m.id); return <li key={m.id} className={m.isPlayer ? 'is-player' : ''} style={{ '--team': team.color } as CSSProperties}>
      <Portrait marble={m} mood={m.isPlayer ? 'happy' : 'angry'} size={48} />
      <div><strong>{m.isPlayer ? DRIVER_NAMES[portrait] : m.name}</strong><small>{m.isPlayer ? 'YOU' : RIVALS[characterOf(m)].tag}</small><span>{team.name}</span></div>
    </li>; })}</ol>
  </section>;
}
