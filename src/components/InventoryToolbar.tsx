import type { CSSProperties } from 'react';
import { PackageCheck, CircleHelp } from 'lucide-react';
import { slotKeyLabel } from '../game/skill-keys';
import { ITEM_INFO, inventoryCount } from '../game/types';
import ItemGlyph from './ItemGlyph';
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
  /** P2-10: what is on each of the eight keys (null = an empty slot). */
  slots: (ItemType | null)[];
  /** The Tab slot: a trial skill picked up from a box or an item peg (platformer races), null when empty. */
  pickup?: ItemType | null;
  onUsePickup?: () => void;
}

export default function InventoryToolbar({ inventory, remaining, selected, blocked, coolingDown, onUse, unlimited, slots, pickup, onUsePickup }: Props) {
  return <section className="inventory-toolbar" aria-label="Race power-up toolbar">
    <div className="inventory-toolbar-heading"><span><PackageCheck size={13} />LOADOUT <b>{inventoryCount(inventory)}</b></span><small>TAP OR PRESS Q W E R / A S D F</small><span title="One charge per use. Unused items carry into your next race."><CircleHelp size={12} />SINGLE USE</span></div>
    <div className="inventory-slots">{onUsePickup && (() => {
      // The Tab slot: one trial skill from a box or an item peg. Use it to pick up another.
      const info = pickup ? ITEM_INFO[pickup] : null;
      const art = pickup ? buttonArt[`../assets/ui/item-${pickup}.webp`] : undefined;
      const active = !!pickup && remaining[pickup] > 0;
      return <button key="tab-slot" className={`inventory-slot kit-slot pickup-slot ${pickup ? 'stocked' : 'empty'}`} style={info ? { '--item-color': info.color } as CSSProperties : undefined} disabled={!pickup || blocked || coolingDown || active} onClick={onUsePickup} aria-label={pickup ? `Use ${info!.name}, picked up (Tab)` : 'Tab slot: empty, roll through an item box'} title={pickup ? `${info!.name}: ${info!.desc} (picked up, use it to pick up another)` : 'Roll through an item box or an item peg to try a skill you have not unlocked'}>
        {pickup && (art ? <img className="kit-slot-art" src={art} alt="" draggable={false} /> : <span className="kit-slot-art kit-slot-glyph"><ItemGlyph item={pickup} size={26} /></span>)}
        <kbd>TAB</kbd><span className="kit-slot-count">{pickup ? 'TRY' : ''}</span>
        {!pickup && <span className="kit-slot-state">EMPTY</span>}
      </button>;
    })()}{slots.map((slotItem, i) => {
      if (!slotItem) return <div key={`empty-${i}`} className="inventory-slot kit-slot empty slot-unassigned" aria-label={`Slot ${slotKeyLabel(i)} is empty`}><kbd>{slotKeyLabel(i)}</kbd></div>;
      const item = slotItem;
      const info = ITEM_INFO[item];
      const active = remaining[item] > 0;
      const available = inventory[item] > 0;
      return <button key={item} className={`inventory-slot kit-slot ${available ? 'stocked' : 'empty'} ${active ? 'effect-active' : ''} ${selected === item ? 'last-selected' : ''}`} style={{ '--item-color': info.color } as CSSProperties} disabled={blocked || coolingDown || active || !available} onClick={() => onUse(item)} aria-label={`Deploy ${info.name}, ${inventory[item]} charges${active ? `, active for ${(remaining[item] / 1000).toFixed(1)} seconds` : ''}`} title={`${info.name}: ${info.desc} (${inventory[item]} owned)`}>
        {buttonArt[`../assets/ui/item-${item}.webp`]
          ? <img className="kit-slot-art" src={buttonArt[`../assets/ui/item-${item}.webp`]} alt="" draggable={false} />
          : <span className="kit-slot-art kit-slot-glyph"><ItemGlyph item={item} size={26} /></span>}
        <kbd>{slotKeyLabel(i)}</kbd><span className="kit-slot-count">{active ? `${(remaining[item] / 1000).toFixed(1)}s` : unlimited?.[item] === -1 ? '∞' : `x${inventory[item]}`}</span>
        {(active || !available) && <span className="kit-slot-state">{active ? item === 'jump' ? 'RECHARGING' : 'ACTIVE' : 'EMPTY'}</span>}
        {active && <span className="effect-countdown" style={{ width: `${Math.min(100, remaining[item] / info.duration * 100)}%` }} />}
      </button>;
    })}</div>
  </section>;
}