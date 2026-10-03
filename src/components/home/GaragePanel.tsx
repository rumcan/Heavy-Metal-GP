import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Gauge, LockKeyhole, MoveUp, RotateCcw, Weight } from 'lucide-react';
import { adjustStat, statsToPhysics, STAT_BUDGET, PLAYER_COLORS } from '../../game/types';
import { DRIVER_NAMES, PLAYER_PORTRAIT_COUNT } from '../../game/characters';
import type { Garage, GarageMode } from '../../game/garages';
import type { RacerAccount } from '../../game/economy';
import type { RankChipModel } from '../../game/rank-view';
import Portrait from '../Portrait';
import RankChip from '../RankChip';
import XpBar from '../progression/XpBar';
import { loadCosmeticSave, progressOf, saveCosmeticSave, unlockedCosmeticLook } from '../../game/economy';
import BallCustomizer from '../garage/BallCustomizer';
import LoadoutPreview from '../LoadoutPreview';
import { playerOf } from './roster';

const STAT_META = [
  { key: 'weight', label: 'Weight', Icon: Weight, color: '#f1ae65', hint: 'More impact. Break walls and push through the pack.' },
  { key: 'speed', label: 'Speed', Icon: Gauge, color: '#d63e2e', hint: 'Less drag. Carry momentum through every turn.' },
  { key: 'bounce', label: 'Bounce', Icon: MoveUp, color: '#b6a0ff', hint: 'More airtime. Reach ramps and shortcut ledges.' },
] as const;
const COLOR_NAMES = ['Race Red', 'Glacier', 'Coral', 'Tangerine', 'Violet', 'Pearl', 'Mint'];

/** What the pane's title line says it is the goblin FOR. */
const MODE_LABEL: Record<GarageMode, string> = { story: 'Story', championship: 'Championship', quick: 'Quick race', online: 'Online' };

export interface GaragePanelProps {
  /** Which mode's goblin this is: it only names the pane. The garage itself is the `garage` prop. */
  mode: GarageMode;
  garage: Garage;
  onChange: (garage: Garage) => void;
  /** Read-only: the mode is running with exactly this setup. */
  locked?: boolean;
  /** Why it is locked, and the way out. */
  lockNote?: ReactNode;
  /** Buttons under the controls (Retune, Restart story). */
  actions?: ReactNode;
  /** The name under the portrait. Defaults to the portrait's own driver name. */
  name?: string;
  /** The small line above the name. */
  kicker?: string;
  account: RacerAccount;
  onShop: () => void;
  /** RK-05: the rank chip's phone home — the header has no room for it at 375 px. */
  rank?: RankChipModel | null;
  onRank?: () => void;
}

/**
 * The middle column in every mode: the goblin you race with in THIS mode — portrait, livery, the three stats and the
 * pit-shop loadout. Each mode has its own (`src/game/garages.ts`); a mode that is already running (a season, a story
 * run) shows the setup it is racing with, read-only.
 */
export default function GaragePanel({ mode, garage, onChange, locked = false, lockNote, actions, name, kicker, account, onShop, rank = null, onRank }: GaragePanelProps) {
  const [view, setView] = useState<'driver' | 'ball'>('driver');
  const { stats, color, portrait } = garage;
  const ph = useMemo(() => statsToPhysics(stats), [stats]);
  const marble = useMemo(() => playerOf(garage), [garage]);
  const step = (by: number) => onChange({ ...garage, portrait: (portrait + by + PLAYER_PORTRAIT_COUNT) % PLAYER_PORTRAIT_COUNT });
  const keepCosmeticLook = (next: Garage['stats']): Garage['stats'] => {
    const cosmeticLook = (stats as Garage['stats'] & { cosmeticLook?: unknown }).cosmeticLook;
    return { ...next, ...(cosmeticLook === undefined ? {} : { cosmeticLook }) } as Garage['stats'];
  };

  // Preserve the look on the mode's stats payload too: SeatGarage already carries stats and
  // the host/guest roster builders pass that object through unchanged to MarbleInfo.
  useEffect(() => {
    const saved = loadCosmeticSave();
    const look = unlockedCosmeticLook(saved.look, account);
    if (JSON.stringify(look) !== JSON.stringify(saved.look)) saveCosmeticSave({ version: 1, look });
    const current = (garage.stats as Garage['stats'] & { cosmeticLook?: unknown }).cosmeticLook;
    if (JSON.stringify(current) !== JSON.stringify(look)) {
      onChange({ ...garage, stats: { ...garage.stats, cosmeticLook: look } as Garage['stats'] });
    }
    // One sync per mode-pane mount; edits below update the same metadata explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return <section className={`fit-pane tuning-panel home-garage ${locked ? 'is-locked' : ''}`} data-pane-id="garage" data-mode={mode} aria-label={`${MODE_LABEL[mode]} garage`}>
    <style>{`.garage-view-tabs{display:flex;gap:5px;margin:0 0 8px}.garage-view-tabs button{flex:1;min-height:34px;border:1px solid #314253;border-radius:4px;background:#0b131c;color:#a9b3c0;font:600 11px var(--mono,monospace);text-transform:uppercase}.garage-view-tabs button[aria-selected="true"]{border-color:#d63e2e;color:#fff3dc;background:#d63e2e22}.garage-ball-panel{min-height:0;overflow:auto;padding:1px 2px 4px 0}`}</style>
    <div className="section-topline"><span className="eyebrow"><b>02</b> YOUR GOBLIN <span className="muted">/ {MODE_LABEL[mode].toUpperCase()}</span></span>
      {/* RK-05: the phone home for the rank badge. The header row has no room for it at 375 px, and this title line
          does — so the same chip lives here and CSS shows exactly one of the two at any width. */}
      {rank && <button className="rank-button rank-button-inline" onClick={onRank} aria-label={`Rank: ${rank.label} — open the ladder`} title="Your rank — open the ladder"><RankChip model={rank} compact /></button>}
      {!locked && <button className="icon-button" onClick={() => onChange({ ...garage, stats: keepCosmeticLook({ weight: 5, speed: 5, bounce: 5 }) })} aria-label="Reset stats to balanced"><RotateCcw size={15} /></button>}
    </div>
    <div className="garage-view-tabs" role="tablist" aria-label="Garage panels">
      <button type="button" role="tab" aria-selected={view === 'driver'} onClick={() => setView('driver')}>Driver</button>
      <button type="button" role="tab" aria-selected={view === 'ball'} onClick={() => setView('ball')}>Ball</button>
    </div>
    {view === 'driver' ? <>
      {/* A disabled fieldset disables every control inside it at once: the read-only garage is one attribute. */}
      <fieldset className="garage-controls" disabled={locked}>
        <div className="driver-identity">
          <button className="icon-button" onClick={() => step(-1)} aria-label="Previous driver"><ChevronLeft size={18} /></button>
          <Portrait className="driver-portrait" marble={marble} mood="happy" size={96} alt={DRIVER_NAMES[portrait]} />
          <div><span className="eyebrow accent">{kicker ?? 'APEX RACING'}</span><h2 id="tuning-title">{(name ?? DRIVER_NAMES[portrait]).toUpperCase()}</h2><span className="marble-mass">{Math.round(ph.mass * 100)}g <span>/</span> DRIVER {portrait + 1}/{PLAYER_PORTRAIT_COUNT}</span></div>
          <button className="icon-button" onClick={() => step(1)} aria-label="Next driver"><ChevronRight size={18} /></button>
        </div>
        <XpBar progress={progressOf(account)} />
        <fieldset className="paint-selector"><legend>Ball livery</legend><div>{PLAYER_COLORS.map((c, i) => <button key={c} type="button" style={{ '--paint': c } as CSSProperties} className={`paint-swatch ${c === color ? 'selected' : ''}`} onClick={() => onChange({ ...garage, color: c })} aria-label={`${COLOR_NAMES[i]} livery`} aria-pressed={c === color}><span /></button>)}</div></fieldset>
        <div className="stat-controls">{STAT_META.map(({ key, label, Icon, hint, color: statColor }) => <div className="stat-control" key={key} style={{ '--stat-color': statColor, '--range-fill': `${(stats[key] - 1) / 9 * 100}%` } as CSSProperties}>
          <div className="stat-label"><label htmlFor={`stat-${key}`}><Icon size={16} />{label}</label><output htmlFor={`stat-${key}`}>{String(stats[key]).padStart(2, '0')}<span>/10</span></output></div>
          <input id={`stat-${key}`} type="range" min="1" max="10" step="1" value={stats[key]} aria-describedby={`hint-${key}`} onChange={(e) => onChange({ ...garage, stats: keepCosmeticLook(adjustStat(stats, key, Number(e.target.value))) })} />
          <p id={`hint-${key}`}>{hint}</p>
        </div>)}</div>
      </fieldset>
      {locked
        ? <p className="garage-lock" role="note"><LockKeyhole size={15} aria-hidden="true" /><span>{lockNote}</span></p>
        : <p className="tradeoff-note">{STAT_BUDGET} points shared. Raising one stat lowers the others.</p>}
      <LoadoutPreview inventory={account.inventory} onShop={onShop} />
    </> : <div className="garage-ball-panel" role="tabpanel" aria-label="Ball customisation">
      <BallCustomizer account={account} onLookChange={(look) => onChange({ ...garage, stats: { ...stats, cosmeticLook: look } as Garage['stats'] })} />
    </div>}
    {actions && <div className="garage-actions">{actions}</div>}
  </section>;
}
