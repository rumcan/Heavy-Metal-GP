import { isPremium } from '../game/skills/premium';
import { unlockAllOwned } from '../game/premium';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowRight, Coins, ShoppingBag, Check, PackageCheck, Trophy } from 'lucide-react';
import Dialog from './Dialog';
import minecart from '../assets/game/minecart.webp';
import ItemGlyph from './ItemGlyph';
import BallCustomizer from './garage/BallCustomizer';
import { ITEM_TYPES, ITEM_INFO, inventoryCount, MAX_ITEM_STACK } from '../game/types';
import type { ItemType } from '../game/types';
import type { RacerAccount } from '../game/economy';
import { STARTER_CREDITS, RACE_PRIZES, PEG_CREDITS } from '../game/economy';

interface Props { account: RacerAccount; onBuy: (item: ItemType) => string | undefined; onClose: () => void }

type StoreTab = 'items' | 'cosmetics';

export default function PitShop({ account, onBuy, onClose }: Props) {
  const [filter, setFilter] = useState<'All' | 'Performance' | 'Disruption'>('All');
  const [tab, setTab] = useState<StoreTab>('items');
  const [wallet, setWallet] = useState(account);
  const [message, setMessage] = useState('');
  useEffect(() => setWallet(account), [account]);
  // premium skills are on sale once the premium unlock has opened them (the loadout shows them locked until then)
  const visible = ITEM_TYPES.filter((item) => (filter === 'All' || ITEM_INFO[item].category === filter) && (!isPremium(item) || unlockAllOwned()));

  const cosmeticsAccountChanged = (next: RacerAccount) => {
    // Match the existing shop's callback contract while keeping the wallet accurate under this dialog.
    Object.assign(account, next);
    setWallet({ ...next });
  };

  return <Dialog onClose={onClose} titleId="shop-title" className="pit-shop-dialog">
    <style>{`.pit-shop-dialog .shop-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.pit-shop-dialog .shop-toolbar>.shop-tabs:first-child{flex:1 0 100%;overflow-x:auto}.pit-shop-dialog .shop-toolbar .shop-tabs{max-width:100%;scrollbar-width:none}.pit-shop-dialog .shop-toolbar>span{margin-left:auto}.shop-cosmetics-pane{max-height:min(64vh,660px);overflow-y:auto;padding:4px 3px}@media(max-width:480px){.pit-shop-dialog .shop-toolbar{align-items:stretch}.pit-shop-dialog .shop-toolbar>span{font-size:10px}}`}</style>
    <div className="shop-heading"><div><span className="eyebrow"><ShoppingBag size={14} /> THE PIT SHOP / RACE CONSUMABLES & COSMETICS</span><h2 id="shop-title">MAKE YOUR NEXT MOVE.</h2><p>Race tools and ball style, all bought with earned credits.</p></div><img className="shop-minecart" src={minecart} alt="" aria-hidden="true" /><div className="shop-balance"><span>YOUR BALANCE</span><strong><Coins size={24} />{wallet.credits.toLocaleString()}<small>CR</small></strong></div></div>
    <div className="shop-toolbar">
      <div className="shop-tabs" role="tablist" aria-label="Shop sections">
        <button type="button" role="tab" className={tab === 'items' ? 'selected' : ''} aria-selected={tab === 'items'} onClick={() => setTab('items')}>Race items</button>
        <button type="button" role="tab" className={tab === 'cosmetics' ? 'selected' : ''} aria-selected={tab === 'cosmetics'} onClick={() => setTab('cosmetics')}>Cosmetics</button>
      </div>
      {tab === 'items' ? <>
        <div className="shop-tabs" aria-label="Filter items">{(['All', 'Performance', 'Disruption'] as const).map((category) => <button key={category} className={category === filter ? 'selected' : ''} onClick={() => setFilter(category)} aria-pressed={category === filter}>{category === 'All' ? 'All items' : category}</button>)}</div>
        <span><PackageCheck size={14} /><b>{inventoryCount(wallet.inventory)}</b> charges owned</span>
      </> : <span><SparklesIcon /> One global ball look, shared by every mode</span>}
    </div>
    {tab === 'items' ? <>
      <div className="shop-catalog">{visible.map((item) => {
        const info = ITEM_INFO[item];
        const quantity = wallet.inventory[item];
        const full = quantity >= MAX_ITEM_STACK;
        const affordable = wallet.credits >= info.price;
        return <article className="shop-item" key={item} style={{ '--item-color': info.color } as CSSProperties}>
          <div className="shop-item-top"><span className="shop-item-glyph"><ItemGlyph item={item} size={25} /></span><div><h3>{info.name}</h3><span>{info.effect}</span></div><span className="shop-owned"><b>{quantity}</b>OWNED</span></div>
          <p>{info.desc}</p>
          <div className="shop-item-bottom"><span><Coins size={13} /><strong>{info.price}</strong> CR</span><button className="shop-buy" onClick={() => { const error = onBuy(item); setMessage(error ?? `${info.name} purchased. Added to your race toolbar.`); }} disabled={full || !affordable} aria-label={`Buy ${info.name} for ${info.price} credits`} title={full ? `Maximum ${MAX_ITEM_STACK} charges` : affordable ? 'Buy one charge' : `Need ${info.price - wallet.credits} more credits`}>{full ? <><Check size={14} />Full</> : !affordable ? 'Not enough CR' : <>Buy +1 <ArrowRight size={14} /></>}</button></div>
        </article>;
      })}</div>
      <div className="shop-message" role="status" aria-live="polite">{message ? <><Check size={14} />{message}</> : <><PackageCheck size={14} />Bought items and glowing-peg pickups share one inventory.</>}</div>
      <details className="shop-payout-guide"><summary><Trophy size={14} />How to earn credits <span>Up to {RACE_PRIZES[0]} CR + peg bonuses per finish</span></summary><div className="payout-scale">{RACE_PRIZES.map((prize, i) => <div key={i}><span>P{i + 1}</span><strong>{prize}</strong></div>)}</div><p>Finish a quick race or championship heat to get paid. Each orange peg adds {PEG_CREDITS} CR when you finish. Quitting and DNFs do not pay. Your first account starts with {STARTER_CREDITS} welcome credits.</p></details>
      <footer className="shop-footer"><p>Single-use charges. Up to {MAX_ITEM_STACK} per type. Unused items carry over; deployed items stay spent, even if you leave the race. Game credits only.</p><button className="button-primary" onClick={onClose}>Loadout ready <ArrowRight size={16} /></button></footer>
    </> : <>
      <div className="shop-cosmetics-pane"><BallCustomizer account={wallet} onAccountChange={cosmeticsAccountChanged} /></div>
      <footer className="shop-footer"><p>Materials, colors, decals, trails and celebrations are cosmetic only. Your chosen ball is saved globally for every race mode.</p><button className="button-primary" onClick={onClose}>Back to the grid <ArrowRight size={16} /></button></footer>
    </>}
  </Dialog>;
}

function SparklesIcon() {
  return <span aria-hidden="true" style={{ color:'#f6ca68', fontWeight:800 }}>✦</span>;
}
