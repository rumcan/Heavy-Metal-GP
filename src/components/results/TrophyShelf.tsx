import type { CSSProperties } from 'react';
import { Trophy } from 'lucide-react';
import type { Inventory } from '../../game/types';
import { emptyInventory, ITEM_INFO, ITEM_TYPES, inventoryCount } from '../../game/types';
import SkillArt from './SkillArt';
import './results.css';

interface Props { inventory: Inventory; trophies?: Inventory }

export default function TrophyShelf({ inventory, trophies = emptyInventory() }: Props) {
  return <section className="trophy-shelf" aria-label="Trophy shelf">
    <div className="trophy-shelf-heading"><h3><Trophy size={16} aria-hidden="true" />Trophy shelf</h3><p>{inventoryCount(trophies).toLocaleString()} brought home · lifetime</p></div>
    <ul className="trophy-shelf-items">{ITEM_TYPES.map((item) => <li key={item} data-item={item} className={inventory[item] > 0 ? 'has-stock' : ''} style={{ '--skill-color': ITEM_INFO[item].color } as CSSProperties}>
      <SkillArt item={item} /><span className="trophy-skill-name" title={ITEM_INFO[item].name}>{ITEM_INFO[item].name}</span><strong>×{inventory[item]} <small>owned</small></strong><span className="trophy-lifetime">{trophies[item].toLocaleString()} brought home</span>
    </li>)}</ul>
  </section>;
}
