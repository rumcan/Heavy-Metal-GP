import type { CSSProperties } from 'react';
import { ArrowDown, PackageCheck, Trophy } from 'lucide-react';
import type { Inventory } from '../../game/types';
import { ITEM_INFO, ITEM_TYPES, inventoryCount } from '../../game/types';
import SkillArt from './SkillArt';
import { useReducedMotion } from './motion';

interface Props { kept: Inventory; ready?: boolean; instant?: boolean }

export default function KeptSkills({ kept, ready = true, instant = false }: Props) {
  const reducedMotion = useReducedMotion();
  const items = ITEM_TYPES.filter((item) => kept[item] > 0);
  const total = inventoryCount(kept);
  const landed = instant || reducedMotion;
  return <section className={`kept-skills${ready ? ' is-ready' : ''}${landed ? ' is-instant' : ''}`} aria-label="Skills you brought home">
    <div className="kept-heading"><PackageCheck size={18} aria-hidden="true" /><h3>Skills you brought home</h3><b>+{total}</b></div>
    {items.length === 0 ? <p className="kept-empty">No new skills this time. Unused charges are still in your loadout.</p> : <>
      <ul className="kept-skill-items" style={{ '--kept-columns': Math.min(items.length, 4) } as CSSProperties}>{items.map((item, i) => <li key={item} data-item={item} style={{ '--skill-color': ITEM_INFO[item].color, '--flight-delay': `${i * 90}ms` } as CSSProperties}>
        <div className="kept-skill-loot"><SkillArt item={item} /><strong>×{kept[item]}</strong><span>{ITEM_INFO[item].name}</span></div>
        <ArrowDown className="kept-route-arrow" size={12} aria-hidden="true" />
        <div className="kept-skill-landing" aria-hidden="true"><SkillArt item={item} className="skill-landed" /><SkillArt item={item} className="skill-flight" /><b>×{kept[item]}</b></div>
      </li>)}</ul>
      <p className="kept-destination"><Trophy size={14} aria-hidden="true" /><strong>Trophy shelf</strong><span>Find them in your garage</span></p>
    </>}
  </section>;
}
