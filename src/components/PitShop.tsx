import { useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowRight, Coins, ShoppingBag, Check, PackageCheck, Trophy } from 'lucide-react';
import Dialog from './Dialog';
import minecart from '../assets/game/minecart.webp';
import ItemGlyph from './ItemGlyph';
import { ITEM_TYPES, ITEM_INFO, inventoryCount, MAX_ITEM_STACK } from '../game/types';
import type { ItemType } from '../game/types';
import type { RacerAccount } from '../game/economy';
import { STARTER_CREDITS, RACE_PRIZES, PEG_CREDITS } from '../game/economy';

interface Props { account: RacerAccount; onBuy: (item: ItemType) => string | undefined; onClose: () => void }

export default function PitShop({ account, onBuy, onClose }: Props) {
  const [filter, setFilter] = useState<'All' | 'Performance' | 'Disruption'>('All');
  const [message, setMessage] = useState('');
  const visible = ITEM_TYPES.filter((item) => filter === 'All' || ITEM_INFO[item].category === filter);
  return <Dialog onClose={onClose} titleId="shop-title" className="pit-shop-dialog">
    <div className="shop-heading"><div><span className="eyebrow"><ShoppingBag size={14} /> THE PIT SHOP / RACE CONSUMABLES</span><h2 id="shop-title">BUY YOUR NEXT ADVANTAGE.</h2><p>Earn it on the track. Spend it on your next move.</p></div><img className="shop-minecart" src={minecart} alt="" aria-hidden="true" /><div className="shop-balance"><span>YOUR BALANCE</span><strong><Coins size={24} />{account.credits.toLocaleString()}<small>CR</small></strong></div></div>
    <div className="shop-toolbar"><div className="shop-tabs" aria-label="Filter items">{(['All', 'Performance', 'Disruption'] as const).map((tab) => <button key={tab} className={tab === filter ? 'selected' : ''} onClick={() => setFilter(tab)} aria-pressed={tab === filter}>{tab === 'All' ? 'All items' : tab}</button>)}</div><span><PackageCheck size={14} /><b>{inventoryCount(account.inventory)}</b> charges owned</span></div>
    <div className="shop-catalog">{visible.map((item) => {
      const info = ITEM_INFO[item];
      const quantity = account.inventory[item];
      const full = quantity >= MAX_ITEM_STACK;
      const affordable = account.credits >= info.price;
      return <article className="shop-item" key={item} style={{ '--item-color': info.color } as CSSProperties}>
        <div className="shop-item-top"><span className="shop-item-glyph"><ItemGlyph item={item} size={25} /></span><div><h3>{info.name}</h3><span>{info.effect}</span></div><span className="shop-owned"><b>{quantity}</b>OWNED</span></div>
        <p>{info.desc}</p>
        <div className="shop-item-bottom"><span><Coins size={13} /><strong>{info.price}</strong> CR</span><button className="shop-buy" onClick={() => { const error = onBuy(item); setMessage(error ?? `${info.name} purchased. Added to your race toolbar.`); }} disabled={full || !affordable} aria-label={`Buy ${info.name} for ${info.price} credits`} title={full ? `Maximum ${MAX_ITEM_STACK} charges` : affordable ? 'Buy one charge' : `Need ${info.price - account.credits} more credits`}>{full ? <><Check size={14} />Full</> : !affordable ? 'Not enough CR' : <>Buy +1 <ArrowRight size={14} /></>}</button></div>
      </article>;
    })}</div>
    <div className="shop-message" role="status" aria-live="polite">{message ? <><Check size={14} />{message}</> : <><PackageCheck size={14} />Bought items and glowing-peg pickups share one inventory.</>}</div>
    <details className="shop-payout-guide"><summary><Trophy size={14} />How to earn credits <span>Up to {RACE_PRIZES[0]} CR + peg bonuses per finish</span></summary><div className="payout-scale">{RACE_PRIZES.map((prize, i) => <div key={i}><span>P{i + 1}</span><strong>{prize}</strong></div>)}</div><p>Finish a quick race or championship heat to get paid. Each orange peg adds {PEG_CREDITS} CR when you finish. Quitting and DNFs do not pay. Your first account starts with {STARTER_CREDITS} welcome credits.</p></details>
    <footer className="shop-footer"><p>Single-use charges. Up to {MAX_ITEM_STACK} per type. Unused items carry over; deployed items stay spent, even if you leave the race. Game credits only.</p><button className="button-primary" onClick={onClose}>Loadout ready <ArrowRight size={16} /></button></footer>
  </Dialog>;
}