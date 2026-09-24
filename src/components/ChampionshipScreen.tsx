import { useMemo, useState } from 'react';
import { ArrowRight, ArrowUpRight, Trophy, Flag, Check, LockKeyhole, SlidersHorizontal, Timer, CircleHelp, FlaskConical, Replace, Hammer } from 'lucide-react';
import { CALENDAR, canChangeRoundTrack, computeStandings, computeTeamStandings, gpRanking, gpPointsTable, gpSeed, roundName, roundTrack } from '../game/season';
import type { SeasonState } from '../game/season';
import { HEATS_PER_GP, teamOf } from '../game/types';
import type { MarbleInfo } from '../game/types';
import { formatTime } from '../game/physics';
import Brand from './Brand';
import CircuitPreview from './CircuitPreview';
import RulesDialog from './RulesDialog';
import PhysicsLab from './PhysicsLab';
import WalletButton from './WalletButton';
import LoadoutPreview from './LoadoutPreview';
import type { RacerAccount } from '../game/economy';
import Portrait from './Portrait';
import crowd from '../assets/game/goblin-crowd.webp';
import Dialog from './Dialog';
import TrackThumbnail from './editor/TrackThumbnail';
import { loadTracksSync } from '../game/tracks';
import type { TrackDef } from '../game/trackdef';

interface Props {
  season: SeasonState;
  onStartHeat: () => void;
  onRetune: () => void;
  onAbandon: () => void;
  onNewSeason: () => void;
  account: RacerAccount;
  onShop: () => void;
  /** Swap a round's circuit for one of the player's tracks (null = back to the calendar track). */
  onChangeTrack?: (round: number, def: TrackDef | null) => void;
}

const PANES = [['event', 'Next race'], ['standings', 'Standings'], ['results', 'Results']] as const;

function MarbleDot({ marble }: { marble: MarbleInfo }) {
  return <Portrait marble={marble} size={28} />;
}

export default function ChampionshipScreen({ season, onStartHeat, onRetune, onAbandon, onNewSeason, account, onShop, onChangeTrack }: Props) {
  /** Round whose track picker is open. */
  const [pickRound, setPickRound] = useState<number | null>(null);
  const [pane, setPane] = useState<'event' | 'standings' | 'results'>('event');
  const [tab, setTab] = useState<'drivers' | 'teams'>('drivers');
  const [dialog, setDialog] = useState<'rules' | 'lab' | null>(null);
  const [historyRound, setHistoryRound] = useState<number | null>(null);
  const standings = useMemo(() => computeStandings(season), [season]);
  const teams = useMemo(() => computeTeamStandings(standings), [standings]);
  const byId = (id: number) => season.roster.find((m) => m.id === id)!;
  const player = season.roster.find((m) => m.isPlayer)!;
  const playerPosition = standings.findIndex((s) => s.id === player.id) + 1;
  const round = Math.min(season.round, CALENDAR.length - 1);
  const gp = CALENDAR[round];
  /** The circuit this round actually races: the player's swap-in, else the shipped official archive. */
  const roundDef = roundTrack(season, round);
  /** The player's own swap-in for this round (null = the round races the official circuit). */
  const playerTrack = season.tracks?.[round] ?? null;
  const completedHeats = season.results[round]?.length ?? 0;
  const setupLocked = completedHeats > 0 && completedHeats < HEATS_PER_GP;
  let latest = -1;
  season.results.forEach((heats, i) => { if (heats.length) latest = i; });
  const showing = historyRound ?? latest;
  const showingHeats = season.results[showing];
  const gpOrder = showingHeats ? gpRanking(showingHeats, season.fastest[showing]) : [];
  const gpPoints = showingHeats ? gpPointsTable(showingHeats, season.fastest[showing]) : new Map<number, number>();
  const champion = season.complete ? byId(standings[0].id) : null;

  return <div className="app-shell championship-page fit-shell" data-pane={pane}>
    <header className="app-header"><Brand onClick={onAbandon} /><nav className="main-nav" aria-label="Main navigation"><button onClick={onAbandon}>Garage</button><button className="active" aria-current="page">Championship</button><button onClick={() => setDialog('rules')}>How to play</button></nav><div className="header-tools"><button className="icon-button mobile-only" onClick={() => setDialog('rules')} aria-label="How to play"><CircleHelp size={17} /></button>{import.meta.env.DEV && <button className="text-button lab-link" onClick={() => setDialog('lab')}><FlaskConical size={16} /><span>Physics lab</span></button>}<WalletButton credits={account.credits} onClick={onShop} /></div></header>
    <main className="fit-main champ-fit">
      <div className="fit-pane event-pane" data-pane-id="event">
      {champion && <section className="champion-banner"><Trophy size={45} /><div><span className="eyebrow">WORLD CHAMPION</span><h2>{champion.isPlayer ? 'YOU DID IT.' : `${champion.name.toUpperCase()} TAKES THE TITLE.`}</h2><p>{standings[0].points} points. {standings[0].wins} Grand Prix wins. {teams[0].team.name} wins the constructors' championship.</p><span>You finished P{playerPosition} in the championship.</span></div><img className="champion-crowd" src={crowd} alt="" aria-hidden="true" /></section>}
          {!season.complete && <section className="next-event" aria-labelledby="next-event-title"><div className="section-topline"><span className="eyebrow"><Flag size={14} /> ROUND {String(round + 1).padStart(2, '0')} OF 06</span><span className="local-save"><Check size={12} />PROGRESS SAVED LOCALLY</span></div><div className="next-gp-title"><h2 id="next-event-title">{roundName(season, round).toUpperCase()}</h2><p>{playerTrack ? `Your own track, replacing ${gp.short}. ${roundDef?.pieces.length ?? 0} ${roundDef?.pieces.length === 1 ? 'piece' : 'pieces'}. Custom tracks pay 30% of the usual winnings.` : roundDef ? `The official ${gp.short} circuit — ${roundDef.pieces.length} ${roundDef.pieces.length === 1 ? 'piece' : 'pieces'}. The demo and all three heats run this exact layout.` : gp.desc.replace(/—/g, '-')}</p>{onChangeTrack && canChangeRoundTrack(season, round) && <button className="button-secondary change-track" onClick={() => setPickRound(round)}><Replace size={14} />Change track</button>}</div><div className="heat-progress" aria-label={`${completedHeats} of 3 heats complete`}>{Array.from({ length: 3 }, (_, i) => <div key={i} className={i < completedHeats ? 'heat-complete' : i === completedHeats ? 'heat-current' : ''}><span>{i < completedHeats ? <Check size={12} /> : String(i + 1).padStart(2, '0')}</span><b>HEAT {i + 1}</b><small>{i < completedHeats ? 'COMPLETE' : i === completedHeats ? 'UP NEXT' : 'SAME CIRCUIT'}</small></div>)}</div><CircuitPreview seed={gpSeed(season.seed, round)} roster={season.roster} profile={gp.profile} def={roundDef} /></section>}
      <LoadoutPreview inventory={account.inventory} onShop={onShop} />
      </div>

      <div className="fit-pane results-pane" data-pane-id="results">
          {showingHeats && <section className="gp-scoreboard" aria-labelledby="gp-score-title"><div className="section-topline"><span className="eyebrow"><b>{String(showing + 1).padStart(2, '0')}</b> WEEKEND CLASSIFICATION</span><span className="muted">{showingHeats.length}/3 heats</span></div><h2 id="gp-score-title">{roundName(season, showing).toUpperCase()} {showingHeats.length === 3 ? 'RESULTS' : 'SO FAR'}</h2>
            {showingHeats.length === 3 && <div className="gp-podium">{[1, 0, 2].map((place) => { const m = byId(gpOrder[place]); return <div key={place} className={`podium-${place + 1}`}><MarbleDot marble={m} /><strong>{m.isPlayer ? 'You' : m.name}</strong><small>{gpPoints.get(m.id)} PTS</small><span>{place + 1}</span></div>; })}</div>}
            <table className="champ-table"><caption className="sr-only">Grand Prix heat standings</caption><thead><tr><th>POS</th><th>DRIVER</th><th>H1</th><th>H2</th><th>H3</th><th>PTS</th></tr></thead><tbody>{gpOrder.map((id, i) => { const m = byId(id); return <tr key={id} className={m.isPlayer ? 'champ-player' : ''}><td>{String(i + 1).padStart(2, '0')}</td><td><span className="champ-driver"><MarbleDot marble={m} />{m.isPlayer ? 'You' : m.name}{season.fastest[showing] === id && <Timer className="fastest-icon" size={13} aria-label="Fastest heat bonus" />}</span></td>{[0, 1, 2].map((heat) => { const result = showingHeats[heat]?.find((r) => r.id === id); return <td key={heat} title={result?.time != null ? formatTime(result.time) : undefined}>{result ? result.time !== null ? `P${result.rank}` : 'DNF' : '-'}</td>; })}<td>{gpPoints.get(id) ?? 0}</td></tr>; })}</tbody></table><p className="scoreboard-note"><Timer size={12} /> Fastest heat of the Grand Prix earns one bonus point.</p></section>}

          <section className="season-calendar" aria-labelledby="calendar-title"><div className="section-topline"><h2 id="calendar-title">THE CALENDAR</h2><span className="eyebrow">06 GRANDS PRIX</span></div><ol>{CALENDAR.map((event, i) => { const heats = season.results[i] ?? []; const complete = heats.length === 3; const current = i === round && !season.complete; const winner = complete ? byId(gpRanking(heats, season.fastest[i])[0]) : null; const swap = season.tracks?.[i] ?? null; return <li key={event.id} className={current ? 'calendar-current' : ''}><span className="calendar-round">{String(i + 1).padStart(2, '0')}</span><div><strong>{swap ? swap.name.toUpperCase() : event.short}</strong><span>{swap ? `Your track · replaces ${event.short}` : event.location}</span></div>{onChangeTrack && canChangeRoundTrack(season, i) && <button className="icon-button" aria-label={`Change the track for round ${i + 1}`} title="Change track" onClick={() => setPickRound(i)}><Replace size={15} /></button>}<span className="calendar-status">{winner ? <><Trophy size={12} />{winner.isPlayer ? 'You' : winner.name}</> : current ? 'UP NEXT' : 'UPCOMING'}</span>{heats.length > 0 && <button className="icon-button" aria-label={`View ${event.short} results`} onClick={() => { setHistoryRound(i); setPane('results'); document.getElementById('gp-score-title')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}><ArrowUpRight size={16} /></button>}</li>; })}</ol></section>
      </div>

        <aside className="fit-pane standings-column" data-pane-id="standings"><div className="section-topline"><h2>THE STANDINGS</h2><span className="eyebrow">LIVE POINTS</span></div><div className="standings-tabs" aria-label="Championship standings"><button className={tab === 'drivers' ? 'selected' : ''} aria-pressed={tab === 'drivers'} onClick={() => setTab('drivers')}>Drivers</button><button className={tab === 'teams' ? 'selected' : ''} aria-pressed={tab === 'teams'} onClick={() => setTab('teams')}>Constructors</button></div>
          {tab === 'drivers' ? <table className="champ-table standings-table"><caption className="sr-only">Drivers' Championship</caption><thead><tr><th>POS</th><th>DRIVER / TEAM</th><th>WINS</th><th>PTS</th></tr></thead><tbody>{standings.map((standing, i) => { const m = byId(standing.id); return <tr key={m.id} className={m.isPlayer ? 'champ-player' : ''}><td>{String(i + 1).padStart(2, '0')}</td><td><span className="standing-driver"><i className="standing-stripe" style={{ background: teamOf(m.id).color }} /><MarbleDot marble={m} /><span><strong>{m.isPlayer ? 'You' : m.name}</strong><small>{teamOf(m.id).name}</small></span></span></td><td>{standing.wins}</td><td><strong>{standing.points}</strong>{i > 0 && standings[0].points > 0 && <small className="standing-gap">-{standings[0].points - standing.points}</small>}</td></tr>; })}</tbody></table> : <ol className="constructor-list">{teams.map(({ team, points }, i) => <li key={team.id} className={team.id === 0 ? 'champ-player' : ''}><span>{String(i + 1).padStart(2, '0')}</span><i style={{ background: team.color }} /><div><strong>{team.name}</strong><span>{team.members.map((id) => byId(id).isPlayer ? 'You' : byId(id).name).join(' / ')}</span></div><b>{points}</b></li>)}</ol>}
          <div className="your-standing"><span className="eyebrow">YOUR CHAMPIONSHIP</span><div><strong>P{playerPosition}</strong><span>{standings.find((s) => s.id === player.id)?.points ?? 0} <small>POINTS</small></span></div><p>{standings.every((s) => s.points === 0) ? 'A clean slate. Make your first heat count.' : playerPosition === 1 ? 'You set the pace. Keep the pressure on.' : `${standings[0].points - (standings.find((s) => s.id === player.id)?.points ?? 0)} points from the championship leader.`}</p></div>
        </aside>
    </main>
    <footer className="fit-actions">
      {season.complete
        ? <><button className="button-secondary" onClick={onAbandon}>Garage</button><button className="button-primary launch-button" onClick={onNewSeason}>New championship <ArrowRight size={18} /></button></>
        : <><div className="setup-readout"><span className="eyebrow">YOUR SETUP</span><p>W <b>{player.stats.weight}</b> / S <b>{player.stats.speed}</b> / B <b>{player.stats.bounce}</b></p></div><button className="button-secondary" onClick={onRetune} disabled={setupLocked} title={setupLocked ? 'Setup is locked until the next Grand Prix' : 'Tune your marble for this circuit'}>{setupLocked ? <LockKeyhole size={15} /> : <SlidersHorizontal size={15} />}{setupLocked ? 'Locked' : 'Retune'}</button><button className="button-primary launch-button" onClick={onStartHeat}>START HEAT {completedHeats + 1}<ArrowRight size={18} /></button></>}
    </footer>
    <nav className="pane-tabs" aria-label="Championship sections">{PANES.map(([id, label]) => <button key={id} className={pane === id ? 'selected' : ''} aria-pressed={pane === id} onClick={() => setPane(id)}>{label}</button>)}</nav>
    {pickRound !== null && onChangeTrack && <TrackPicker round={pickRound} current={season.tracks?.[pickRound] ?? null} onPick={(def) => { onChangeTrack(pickRound, def); setPickRound(null); }} onClose={() => setPickRound(null)} />}
    {dialog === 'rules' && <RulesDialog onClose={() => setDialog(null)} />}{import.meta.env.DEV && dialog === 'lab' && <PhysicsLab onClose={() => setDialog(null)} />}
  </div>;
}
/** Pick a round's circuit: the official Grand Prix circuit or one of the player's saved tracks. */
function TrackPicker({ round, current, onPick, onClose }: { round: number; current: TrackDef | null; onPick: (def: TrackDef | null) => void; onClose: () => void }) {
  const gp = CALENDAR[round];
  // Parsing saved tracks checks every one of them: once per visit, not on every render.
  const tracks = useMemo(() => loadTracksSync(), []);
  return <Dialog titleId="track-picker-title" onClose={onClose} className="track-picker">
    <span className="eyebrow"><Replace size={14} /> ROUND {String(round + 1).padStart(2, '0')}</span>
    <h2 id="track-picker-title">Choose the track</h2>
    <p className="dialog-intro">All three heats of this round run on the track you pick. Your own tracks pay 30% of the usual winnings.</p>
    <div className="track-picker-list" role="listbox" aria-label="Tracks">
      <button role="option" aria-selected={!current} className={`track-picker-row ${!current ? 'selected' : ''}`} onClick={() => onPick(null)}>
        <span className="track-picker-badge"><Flag size={16} /></span>
        <span><strong>{gp.name}</strong><small>Official circuit · {gp.location}</small></span>
      </button>
      {tracks.map((t) => {
        const selected = current?.name === t.def.name && current.pieces.length === t.def.pieces.length;
        return <button key={t.id} role="option" aria-selected={selected} className={`track-picker-row ${selected ? 'selected' : ''}`} onClick={() => onPick(t.def)}>
          <TrackThumbnail def={t.def} />
          <span><strong>{t.def.name}</strong><small>Your track · {t.def.pieces.length} {t.def.pieces.length === 1 ? 'piece' : 'pieces'} · {t.def.theme}</small></span>
        </button>;
      })}
      {tracks.length === 0 && <p className="muted track-picker-empty"><Hammer size={14} /> You have no saved tracks yet. Build one in the Workshop and press Save current.</p>}
    </div>
  </Dialog>;
}
