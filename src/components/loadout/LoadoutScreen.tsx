// P2-10: pick up to eight skills for the keys Q W E R / A S D F, and buy charges for them, in one screen
// (the shop is folded in). Saved as you go; locked skills say why. Replaces the old pit shop.
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { X, Coins, Lock } from 'lucide-react';
import Dialog from '../Dialog';
import ItemGlyph from '../ItemGlyph';
import { GROUP_COLORS, SKILLS, STARTER_SKILLS } from '../../game/skills/catalog';
import type { SkillGroup } from '../../game/skills/catalog';
import { lockReason } from '../../game/loadout';
import type { Catalog } from '../../game/loadout';
import { loadSlots, saveSlots, LOADOUT_MODES } from '../../game/loadout-store';
import type { LoadoutMode, Slots } from '../../game/loadout-store';
import { progressOf } from '../../game/economy';
import type { RacerAccount } from '../../game/economy';
import { ITEM_INFO, ITEM_TYPES, MAX_ITEM_STACK } from '../../game/types';
import type { ItemType } from '../../game/types';
import { SLOT_KEYS } from '../../game/loadout';

interface Props {
  account: RacerAccount;
  onBuy: (item: ItemType) => string | undefined;
  onClose: () => void;
  /** Open on this mode's bar (default Quick). */
  mode?: LoadoutMode;
  /**
   * P2-10b: shown before a race. The mode is fixed, and the footer asks: race with this loadout, the same as last time
   * (any changes made here are put back), or never ask again.
   */
  preRace?: { onRace: () => void; onSame: () => void; ask: boolean; onAsk: (ask: boolean) => void };
}

const GROUPS: { id: SkillGroup; label: string }[] = [
  { id: 'movement', label: 'Movement' }, { id: 'offence', label: 'Offence' }, { id: 'defence', label: 'Defence' }, { id: 'utility', label: 'Utility' },
];
/** P2-20: the mode switch — every mode keeps its own bar. */
const MODE_LABELS: Record<LoadoutMode, string> = { quick: 'Quick', championship: 'Championship', story: 'Story', online: 'Online' };
const CATALOG: Catalog = Object.fromEntries(ITEM_TYPES.map((id) => {
  const d = SKILLS[id];
  return [id, { price: ITEM_INFO[id].price, unlockLevel: d.unlockLevel, starter: (STARTER_SKILLS as readonly string[]).includes(id) }];
}));

export default function LoadoutScreen({ account, onBuy, onClose, mode: startMode = 'quick', preRace }: Props) {
  // P2-20: one bar per mode; the switch picks which one is shown and saved.
  const [mode, setMode] = useState<LoadoutMode>(startMode);
  const [slots, setSlots] = useState<Slots>(() => loadSlots(startMode));
  // what the bar was when the screen opened ("Same as last time" puts it back)
  const [opened] = useState<Slots>(() => loadSlots(startMode));
  const [at, setAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const level = progressOf(account).level;
  const driver = useMemo(() => ({ level, campaignComplete: account.campaignComplete === true }), [level, account.campaignComplete]);

  const commit = (next: Slots) => { setSlots(next); saveSlots(next, mode); };
  const pickMode = (next: LoadoutMode) => {
    setMode(next);
    setSlots(loadSlots(next));
    setError(null);
  };
  const place = (item: ItemType) => {
    const why = lockReason(item, CATALOG, driver, false);
    if (why) { setError(why === 'level' ? `${ITEM_INFO[item].name} unlocks at level ${CATALOG[item].unlockLevel}` : 'That skill is not available'); return; }
    setError(null);
    const next = slots.map((s) => (s === item ? null : s));
    next[at] = item;
    commit(next);
    const free = next.findIndex((s) => s === null);
    if (free >= 0) setAt(free);
  };
  const clear = (i: number) => { const next = [...slots]; next[i] = null; commit(next); setAt(i); };
  const buy = (item: ItemType) => setError(onBuy(item) ?? null);

  return <Dialog titleId="loadout-title" onClose={onClose} className="loadout-dialog">
    <div className="loadout-head"><h2 id="loadout-title">LOADOUT</h2><span className="loadout-wallet"><Coins size={14} />{account.credits.toLocaleString()} CR · LEVEL {level}</span></div>
    {!preRace && <div className="mode-switch loadout-mode" role="group" aria-label="Loadout mode">
      {LOADOUT_MODES.map((m) => <button key={m} className={m === mode ? 'selected' : ''} aria-pressed={m === mode} onClick={() => pickMode(m)}>{MODE_LABELS[m]}</button>)}
    </div>}
    <p className="dialog-intro">Pick up to 8 skills for your keys in <b>{MODE_LABELS[mode]}</b> mode. Each mode keeps its own bar; charges are shared by every mode and carry between races.</p>
    {error && <p className="loadout-error" role="alert">{error}</p>}
    <div className="loadout-slots" role="group" aria-label="Your eight skill slots">
      {slots.map((item, i) => <div key={i} className={`loadout-slot ${i === at ? 'is-selected' : ''} ${item ? 'is-filled' : ''}`} style={item ? { '--item-color': ITEM_INFO[item].color } as CSSProperties : undefined}>
        <button className="loadout-slot-main" onClick={() => setAt(i)} aria-pressed={i === at} aria-label={`Slot ${SLOT_KEYS[i]}${item ? `: ${ITEM_INFO[item].name}, ${account.inventory[item]} charges` : ', empty'}`}>
          <kbd>{SLOT_KEYS[i]}</kbd>
          {item ? <><ItemGlyph item={item} size={22} /><b>{ITEM_INFO[item].short}</b><span>x{account.inventory[item]}</span></> : <span className="loadout-empty">empty</span>}
        </button>
        {item && <div className="loadout-slot-tools">
          <button onClick={() => buy(item)} disabled={account.inventory[item] >= MAX_ITEM_STACK || account.credits < ITEM_INFO[item].price} className="loadout-buy" aria-label={`Buy one more ${ITEM_INFO[item].name} for ${ITEM_INFO[item].price} credits`} title={account.inventory[item] >= MAX_ITEM_STACK ? 'Full' : account.credits < ITEM_INFO[item].price ? `Need ${ITEM_INFO[item].price - account.credits} more credits` : `Buy one charge for ${ITEM_INFO[item].price} CR`}>{account.inventory[item] >= MAX_ITEM_STACK ? 'Full' : <>Buy <Coins size={11} />{ITEM_INFO[item].price}</>}</button>
          <button onClick={() => clear(i)} aria-label={`Clear slot ${SLOT_KEYS[i]}`}><X size={12} /></button>
        </div>}
      </div>)}
    </div>
    <div className="loadout-groups">
      {GROUPS.map((g) => <section key={g.id} aria-label={g.label}>
        <h3 style={{ color: GROUP_COLORS[g.id] }}>{g.label}</h3>
        <div className="loadout-skill-list">
          {ITEM_TYPES.filter((id) => SKILLS[id].group === g.id).map((id) => {
            const why = lockReason(id, CATALOG, driver, false);
            const on = slots.includes(id);
            return <button key={id} className={`loadout-skill ${why ? 'is-locked' : ''} ${on ? 'is-slotted' : ''}`} style={{ '--item-color': ITEM_INFO[id].color } as CSSProperties} onClick={() => place(id)} aria-disabled={!!why} title={`${ITEM_INFO[id].name}: ${ITEM_INFO[id].desc}`}>
              <ItemGlyph item={id} size={18} />
              <span><b>{ITEM_INFO[id].name}</b><small>{why ? <><Lock size={9} /> Level {SKILLS[id].unlockLevel}</> : `${ITEM_INFO[id].price} CR · own ${account.inventory[id]}`}</small></span>
              {on && <i>{SLOT_KEYS[slots.indexOf(id)]}</i>}
            </button>;
          })}
        </div>
      </section>)}
    </div>
    {preRace ? <div className="pause-actions loadout-prerace">
      <button className="button-primary" onClick={preRace.onRace} autoFocus>Race with this loadout</button>
      <button className="button-secondary" onClick={() => { saveSlots(opened, mode); preRace.onSame(); }}>Same as last time</button>
      <label className="loadout-ask"><input type="checkbox" checked={!preRace.ask} onChange={(e) => preRace.onAsk(!e.target.checked)} /> Don't ask before every race</label>
    </div> : <div className="pause-actions"><button className="button-primary" onClick={onClose} autoFocus>Done</button></div>}
  </Dialog>;
}
