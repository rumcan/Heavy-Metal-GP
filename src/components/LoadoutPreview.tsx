import type { CSSProperties } from 'react';
import { ShoppingBag, ArrowUpRight } from 'lucide-react';
import { ITEM_INFO, ITEM_TYPES, inventoryCount } from '../game/types';
import type { Inventory } from '../game/types';
import ItemGlyph from './ItemGlyph';
import { loadAccount } from '../game/economy';
import TrophyShelf from './results/TrophyShelf';

export default function LoadoutPreview({ inventory, onShop, trophies = loadAccount().trophies }: { inventory: Inventory; onShop: () => void; trophies?: Inventory }) {
  return <section className="paddock-loadout" aria-label="Your saved race loadout"><div className="loadout-preview-title"><span className="eyebrow"><ShoppingBag size={13} /> YOUR RACE LOADOUT</span><p>{inventoryCount(inventory)} charges ready. Collected items carry over.</p></div><div className="loadout-preview-items">{ITEM_TYPES.map((item, i) => <button key={item} onClick={onShop} style={{ '--item-color': ITEM_INFO[item].color } as CSSProperties} className={inventory[item] ? 'has-stock' : ''} title={`${ITEM_INFO[item].name}: ${inventory[item]} owned. Key ${i + 1} during a race.`} aria-label={`Shop ${ITEM_INFO[item].name}, ${inventory[item]} owned`}><ItemGlyph item={item} size={18} /><b>{inventory[item]}</b></button>)}</div><button className="text-button" onClick={onShop}>Stock up <ArrowUpRight size={14} /></button><TrophyShelf inventory={inventory} trophies={trophies} /></section>;
}
