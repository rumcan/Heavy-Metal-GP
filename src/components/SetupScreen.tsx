import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { BookOpen, Users, ArrowRight, ArrowUpRight, RotateCcw, Shuffle, Flag, Trophy, FlaskConical, CircleHelp, Gauge, Weight, MoveUp, LockKeyhole, ChevronRight, ChevronLeft, Radio, Hammer } from 'lucide-react';
import { adjustStat, statsToPhysics, STAT_BUDGET, PLAYER_COLORS, teamOf } from '../game/types';
import { DRIVER_NAMES, PLAYER_PORTRAIT_COUNT, RIVALS, characterOf } from '../game/characters';
import Portrait from './Portrait';
import type { MarbleStats, MarbleInfo } from '../game/types';
import { CALENDAR } from '../game/season';
import Brand from './Brand';
import CircuitPreview from './CircuitPreview';
import PhysicsLab from './PhysicsLab';
import OnlinePanel from './OnlinePanel';
import RulesDialog from './RulesDialog';
import WalletButton from './WalletButton';
import LoadoutPreview from './LoadoutPreview';
import TrackThumbnail from './editor/TrackThumbnail';
import { loadTracksSync } from '../game/tracks';
import type { RacerAccount } from '../game/economy';

interface Props {
  stats: MarbleStats;
  onStats: (s: MarbleStats) => void;
  color: string;
  onColor: (c: string) => void;
  rivals: MarbleInfo[];
  onRerollRivals: () => void;
  seed: number;
  onNewSeed: () => void;
  onStart: () => void;
  onStartSeason: () => void;
  onContinueSeason?: () => void;
  seasonMode?: boolean;
  onBackToSeason?: () => void;
  circuitIndex: number;
  onCircuit: (index: number) => void;
  /** MB-08: quick race can run a player-built circuit instead of the calendar. */
  customTrackId?: string | null;
  onSelectCustom?: (id: string | null) => void;
  account: RacerAccount;
  onShop: () => void;
  portrait: number;
  onPortrait: (index: number) => void;
  /** Story mode (ST-08). Omitted when the story is not available. */
  onStartStory?: () => void;
  /** A saved story with progress exists: the button becomes a red "Continue story". */
  storyInProgress?: boolean;
  /** MP-06: the online panel — host, join by code, quick race (MP-07). */
  mpBusy?: boolean;
  mpError?: string | null;
  onHostGame?: () => void;
  onJoinGame?: (code: string) => void;
  /** MP-07: quick match, and the cancel that goes with it. */
  onQuickGame?: () => void;
  searching?: boolean;
  windows?: number;
  onCancelSearch?: () => void;
  /** MP-08: the race a returning player can be put back in. */
  rejoin?: { roomCode: string } | null;
  onRejoin?: () => void;
  onDismissRejoin?: () => void;
  /** MB-02: the Workshop (track editor) — reachable from the header, beside Garage and Championship. */
  onWorkshop?: () => void;
  /** Open Community tracks. */
  onCommunity?: () => void;
}

const PANES = [['circuit', 'Circuit'], ['driver', 'Driver'], ['grid', 'Grid']] as const;

const STAT_META = [
  { key: 'weight', label: 'Weight', Icon: Weight, color: '#f1ae65', hint: 'More impact. Break walls and push through the pack.' },
  { key: 'speed', label: 'Speed', Icon: Gauge, color: '#d63e2e', hint: 'Less drag. Carry momentum through every turn.' },
  { key: 'bounce', label: 'Bounce', Icon: MoveUp, color: '#b6a0ff', hint: 'More airtime. Reach ramps and shortcut ledges.' },
] as const;
const COLOR_NAMES = ['Race Red', 'Glacier', 'Coral', 'Tangerine', 'Violet', 'Pearl', 'Mint'];

export default function SetupScreen(props: Props) {
  const { stats, onStats, color, onColor, rivals, onRerollRivals, seed, onNewSeed, onStart, onStartSeason, onContinueSeason, seasonMode, onBackToSeason, circuitIndex, onCircuit } = props;
  const { account, onShop, portrait, onPortrait, onStartStory, storyInProgress } = props;
  const { mpBusy = false, mpError = null, onHostGame, onJoinGame, onQuickGame, searching = false, windows = 0, onCancelSearch, rejoin = null, onRejoin, onDismissRejoin } = props;
  const { onWorkshop } = props;
  const [pane, setPane] = useState<'circuit' | 'driver' | 'grid'>('driver');
  const [mode, setMode] = useState<'season' | 'quick' | 'online'>('season');
  const [dialog, setDialog] = useState<'rules' | 'lab' | null>(null);
  const ph = useMemo(() => statsToPhysics(stats), [stats]);
  const roster = useMemo<MarbleInfo[]>(() => [{ id: 0, name: 'You', color, stats, isPlayer: true, character: portrait }, ...rivals], [color, stats, rivals, portrait]);
  const circuit = CALENDAR[circuitIndex];
  // MB-08: quick race can run a player-built circuit. Tabs are calendar vs My tracks.
  const myTracks = loadTracksSync();
  const selectedCustom = myTracks.find((t) => t.id === props.customTrackId) ?? null;
  // Championships always run the calendar, so the retune screen only shows it. Everywhere else, picking one of
  // your own tracks switches the launch bar to Quick race, the only mode that can race it.
  const [circuitTab, setCircuitTab] = useState<'calendar' | 'custom'>(props.customTrackId && !seasonMode ? 'custom' : 'calendar');
  useEffect(() => {
    if (!props.customTrackId || seasonMode) return;
    setCircuitTab('custom');
    setMode('quick');
  }, [props.customTrackId, seasonMode]);
  const raceCustom = selectedCustom && !seasonMode ? () => { setMode('quick'); onStart(); } : null;

  return <div className="app-shell garage-page fit-shell" data-pane={pane}>
    <header className="app-header">
      <Brand />
      <nav className="main-nav" aria-label="Main navigation">
        <button className="active" aria-current="page">Garage</button>
        <button onClick={onContinueSeason ?? (() => setMode('season'))}>Championship</button>
        {onWorkshop && <button onClick={onWorkshop}>Workshop</button>}
        {props.onCommunity && <button onClick={props.onCommunity}>Community</button>}
        <button onClick={() => setDialog('rules')}>How to play</button>
      </nav>
      <div className="header-tools">{onWorkshop && <button className="icon-button mobile-only" onClick={onWorkshop} aria-label="Workshop" title="Workshop — build your own circuit"><Hammer size={17} /></button>}{props.onCommunity && <button className="icon-button mobile-only" onClick={props.onCommunity} aria-label="Community tracks" title="Community tracks"><Users size={17} /></button>}<button className="icon-button mobile-only" onClick={() => setDialog('rules')} aria-label="How to play"><CircleHelp size={17} /></button>{import.meta.env.DEV && <button className="text-button lab-link" onClick={() => setDialog('lab')}><FlaskConical size={16} /><span>Physics lab</span></button>}<WalletButton credits={account.credits} onClick={onShop} /></div>
    </header>

    <main className="fit-main garage-fit">
      <section className="fit-pane circuit-panel" data-pane-id="circuit" aria-labelledby="circuit-title">
        <div className="section-topline"><span className="eyebrow"><b>01</b> THE CIRCUIT</span><button className="text-button" onClick={onNewSeed}><Shuffle size={14} />Regenerate</button></div>
        {!seasonMode && <div className="circuit-tabs" role="tablist" aria-label="Circuit source">
          <button role="tab" aria-selected={circuitTab === 'calendar'} className={circuitTab === 'calendar' ? 'selected' : ''} onClick={() => { setCircuitTab('calendar'); props.onSelectCustom?.(null); }}>Calendar</button>
          <button role="tab" aria-selected={circuitTab === 'custom'} className={circuitTab === 'custom' ? 'selected' : ''} onClick={() => setCircuitTab('custom')}>My tracks{myTracks.length ? ` (${myTracks.length})` : ''}</button>
        </div>}
        {circuitTab === 'calendar' ? (
          <>
            <div className="circuit-title-row"><div><h2 id="circuit-title">{circuit.short}</h2><span>{circuit.location}</span></div><span className="circuit-seed">SEED<br /><b>{seed.toString(16).slice(0, 6).toUpperCase()}</b></span></div>
            <CircuitPreview seed={seed} roster={roster} profile={circuit.profile} />
            <div className="circuit-selector" aria-label="Select a circuit">{CALENDAR.map((gp, i) => <button key={gp.id} className={i === circuitIndex ? 'selected' : ''} aria-pressed={i === circuitIndex} onClick={() => { props.onSelectCustom?.(null); onCircuit(i); }}><span>{String(i + 1).padStart(2, '0')}</span><strong>{gp.short}</strong></button>)}</div>
          </>
        ) : (
          <div className="custom-circuit-pane" aria-label="My tracks">
            {selectedCustom ? (
              <div className="custom-selected">
                <div className="circuit-title-row"><div><h2 id="circuit-title">{selectedCustom.def.name.toUpperCase()}</h2><span>CUSTOM • {selectedCustom.def.pieces.length} pieces • {selectedCustom.def.height}px</span></div><span className="circuit-seed">CUSTOM<br /><b>{selectedCustom.id.slice(0, 6).toUpperCase()}</b></span></div>
                <div className="custom-preview"><TrackThumbnail def={selectedCustom.def} /><p className="muted">{selectedCustom.def.name} — a player-built circuit. Quick race payout is reduced (30 %) to keep farming in check; calendar races pay full purse.</p></div>
                <div className="custom-actions">
                  {raceCustom && <button className="button-primary" onClick={raceCustom}><Flag size={15} />Race this track<ArrowRight size={16} /></button>}
                  <button className="text-button" onClick={() => props.onSelectCustom?.(null)}>Back to Calendar</button>
                </div>
              </div>
            ) : myTracks.length === 0 ? null : (
              <p className="muted">Click one of your tracks below to select it, then press <b>Race this track</b>. Races on your own tracks pay 30 % of the usual winnings.</p>
            )}
            <div className="my-tracks-list" role="listbox" aria-label="Saved tracks">
              {myTracks.length === 0 ? (
                <div className="my-tracks-empty">
                  <p>You have no saved tracks yet.</p>
                  {onWorkshop && <button className="button-secondary" onClick={onWorkshop}><Hammer size={14} />Open Workshop</button>}
                  <p className="muted">Build a circuit, save it, and it appears here for quick races.</p>
                </div>
              ) : (
                myTracks.map((t) => (
                  <button
                    key={t.id}
                    role="option"
                    aria-selected={t.id === props.customTrackId}
                    className={`my-track-row ${t.id === props.customTrackId ? 'selected' : ''}`}
                    onClick={() => props.onSelectCustom?.(t.id)}
                  >
                    <TrackThumbnail def={t.def} />
                    <span className="my-track-meta">
                      <strong>{t.def.name}</strong>
                      <span className="muted">{t.def.pieces.length} pcs • {t.def.height}px • {t.def.theme}</span>
                    </span>
                    <span className="my-track-check" aria-hidden>{t.id === props.customTrackId ? '●' : ''}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </section>

      <section className="fit-pane tuning-panel" data-pane-id="driver" aria-labelledby="tuning-title">
        <div className="section-topline"><span className="eyebrow"><b>02</b> YOUR GOBLIN</span><button className="icon-button" onClick={() => onStats({ weight: 5, speed: 5, bounce: 5 })} aria-label="Reset stats to balanced"><RotateCcw size={15} /></button></div>
        <div className="driver-identity">
          <button className="icon-button" onClick={() => onPortrait((portrait + PLAYER_PORTRAIT_COUNT - 1) % PLAYER_PORTRAIT_COUNT)} aria-label="Previous driver"><ChevronLeft size={18} /></button>
          <Portrait className="driver-portrait" marble={roster[0]} mood="happy" size={96} alt={DRIVER_NAMES[portrait]} />
          <div><span className="eyebrow accent">APEX RACING</span><h2 id="tuning-title">{DRIVER_NAMES[portrait].toUpperCase()}</h2><span className="marble-mass">{Math.round(ph.mass * 100)}g <span>/</span> DRIVER {portrait + 1}/{PLAYER_PORTRAIT_COUNT}</span></div>
          <button className="icon-button" onClick={() => onPortrait((portrait + 1) % PLAYER_PORTRAIT_COUNT)} aria-label="Next driver"><ChevronRight size={18} /></button>
        </div>
        <fieldset className="paint-selector"><legend>Ball livery</legend><div>{PLAYER_COLORS.map((c, i) => <button key={c} type="button" style={{ '--paint': c } as CSSProperties} className={`paint-swatch ${c === color ? 'selected' : ''}`} onClick={() => onColor(c)} aria-label={`${COLOR_NAMES[i]} livery`} aria-pressed={c === color}><span /></button>)}</div></fieldset>
        <div className="stat-controls">{STAT_META.map(({ key, label, Icon, hint, color: statColor }) => <div className="stat-control" key={key} style={{ '--stat-color': statColor, '--range-fill': `${(stats[key] - 1) / 9 * 100}%` } as CSSProperties}>
          <div className="stat-label"><label htmlFor={`stat-${key}`}><Icon size={16} />{label}</label><output htmlFor={`stat-${key}`}>{String(stats[key]).padStart(2, '0')}<span>/10</span></output></div>
          <input id={`stat-${key}`} type="range" min="1" max="10" step="1" value={stats[key]} aria-describedby={`hint-${key}`} onChange={(e) => onStats(adjustStat(stats, key, Number(e.target.value)))} />
          <p id={`hint-${key}`}>{hint}</p>
        </div>)}</div>
        <p className="tradeoff-note">{STAT_BUDGET} points shared. Raising one stat lowers the others.</p>
        <LoadoutPreview inventory={account.inventory} onShop={onShop} />
      </section>

      <section className="fit-pane grid-panel" data-pane-id="grid" aria-labelledby="grid-title">
        <div className="section-topline"><div className="eyebrow" id="grid-title"><b>03</b> THE GRID <span className="muted">/ 10 GOBLINS</span></div>{!seasonMode && <button className="text-button" onClick={onRerollRivals}>Shuffle <Shuffle size={14} /></button>}</div>
        <ol className="driver-grid">{roster.map((m) => { const team = teamOf(m.id); return <li key={m.id} className={m.isPlayer ? 'is-player' : ''} style={{ '--team': team.color } as CSSProperties}>
          <Portrait marble={m} mood={m.isPlayer ? 'happy' : 'angry'} size={48} />
          <div><strong>{m.isPlayer ? DRIVER_NAMES[portrait] : m.name}</strong><small>{m.isPlayer ? 'YOU' : RIVALS[characterOf(m)].tag}</small><span>{team.name}</span></div>
        </li>; })}</ol>
      </section>
    </main>

    <footer className="fit-actions">
      {seasonMode
        ? <><p>Locked for all three heats once the GP begins.</p><button className="button-primary launch-button" onClick={onBackToSeason}><LockKeyhole size={17} /> Save setup <ArrowRight size={19} /></button></>
        : <>
          {onStartStory && (storyInProgress
            ? <button className="button-primary story-continue" onClick={onStartStory} title="Continue story mode: Down We Go"><BookOpen size={15} />Continue story</button>
            : <button className="button-secondary" onClick={onStartStory} title="Story mode: Down We Go"><BookOpen size={15} />Story</button>)}
          <div className="mode-switch" aria-label="Race mode"><button aria-pressed={mode === 'season'} className={mode === 'season' ? 'selected' : ''} onClick={() => setMode('season')}><Trophy size={15} />Championship</button><button aria-pressed={mode === 'quick'} className={mode === 'quick' ? 'selected' : ''} onClick={() => setMode('quick')}><Flag size={15} />Quick race</button><button aria-pressed={mode === 'online'} className={mode === 'online' ? 'selected' : ''} onClick={() => setMode('online')}><Radio size={15} />Online</button></div>
          {onContinueSeason && mode === 'season' && <button className="button-secondary" onClick={onContinueSeason}>Continue <ArrowUpRight size={16} /></button>}
          {mode === 'online'
            ? onHostGame && onJoinGame && onQuickGame
              ? <OnlinePanel
                busy={mpBusy}
                error={mpError}
                onHost={onHostGame}
                onJoin={onJoinGame}
                onQuick={onQuickGame}
                searching={searching}
                windows={windows}
                onCancelSearch={onCancelSearch}
                rejoin={rejoin}
                onRejoin={onRejoin}
                onDismissRejoin={onDismissRejoin}
              />
              : <p className="mode-note">Online needs the RUN.world host — race the AI here.</p>
            : <button className="button-primary launch-button" onClick={mode === 'season' ? onStartSeason : onStart}>{mode === 'season' ? (onContinueSeason ? 'NEW SEASON' : 'START CHAMPIONSHIP') : selectedCustom ? `RACE ${selectedCustom.def.name.toUpperCase()}` : 'LIGHTS OUT'}<ArrowRight size={20} /></button>}
        </>}
    </footer>
    <nav className="pane-tabs" aria-label="Garage sections">{PANES.map(([id, label]) => <button key={id} className={pane === id ? 'selected' : ''} aria-pressed={pane === id} onClick={() => setPane(id)}>{label}</button>)}</nav>
    {import.meta.env.DEV && dialog === 'lab' && <PhysicsLab onClose={() => setDialog(null)} />}
    {dialog === 'rules' && <RulesDialog onClose={() => setDialog(null)} />}
  </div>;
}