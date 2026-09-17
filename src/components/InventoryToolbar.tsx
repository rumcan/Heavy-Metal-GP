import type { CSSProperties } from 'react';
import { PackageCheck, CircleHelp } from 'lucide-react';
import { ITEM_INFO, ITEM_TYPES, inventoryCount } from '../game/types';
import type { Inventory, ItemType } from '../game/types';
const buttonArt = import.meta.glob<string>('../assets/ui/item-*.webp', { eager: true, import: 'default' });

interface Props {
  inventory: Inventory;
  remaining: Record<ItemType, number>;
  selected: ItemType;
  blocked: boolean;
  coolingDown: boolean;
  onUse: (item: ItemType) => void;
  /** Online house rules: items set to unlimited (-1) show ∞. */
  unlimited?: Partial<Record<ItemType, number>>;
}

export default function InventoryToolbar({ inventory, remaining, selected, blocked, coolingDown, onUse, unlimited }: Props) {
  return <section className="inventory-toolbar" aria-label="Race power-up toolbar">
    <div className="inventory-toolbar-heading"><span><PackageCheck size={13} />LOADOUT <b>{inventoryCount(inventory)}</b></span><small>CLICK OR PRESS 1-8 TO DEPLOY <i>/</i> SPACE REPEATS YOUR LAST ITEM</small><span title="One charge per use. Unused items carry into your next race."><CircleHelp size={12} />SINGLE USE</span></div>
    <div className="inventory-slots">{ITEM_TYPES.map((item, i) => {
      const info = ITEM_INFO[item];
      const active = remaining[item] > 0;
      const available = inventory[item] > 0;
      return <button key={item} className={`inventory-slot kit-slot ${available ? 'stocked' : 'empty'} ${active ? 'effect-active' : ''} ${selected === item ? 'last-selected' : ''}`} style={{ '--item-color': info.color } as CSSProperties} disabled={blocked || coolingDown || active || !available} onClick={() => onUse(item)} aria-label={`Deploy ${info.name}, ${inventory[item]} charges${active ? `, active for ${(remaining[item] / 1000).toFixed(1)} seconds` : ''}`} title={`${info.name}: ${info.desc} (${inventory[item]} owned)`}>
        <img className="kit-slot-art" src={buttonArt[`../assets/ui/item-${item}.webp`]} alt="" draggable={false} />
        <kbd>{i + 1}</kbd><span className="kit-slot-count">{active ? `${(remaining[item] / 1000).toFixed(1)}s` : unlimited?.[item] === -1 ? '∞' : `x${inventory[item]}`}</span>
        {(active || !available) && <span className="kit-slot-state">{active ? item === 'jump' ? 'RECHARGING' : 'ACTIVE' : 'EMPTY'}</span>}
        {active && <span className="effect-countdown" style={{ width: `${Math.min(100, remaining[item] / info.duration * 100)}%` }} />}
      </button>;
    })}</div>
  </section>;
}