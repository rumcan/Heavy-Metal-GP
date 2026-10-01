import { useMemo } from 'react';
import { LockKeyhole, SlidersHorizontal, Trophy } from 'lucide-react';
import { CALENDAR, computeStandings, gpRanking, gpSeed, roundName, roundTrack } from '../../game/season';
import type { SeasonState } from '../../game/season';
import { officialTrack } from '../../game/official-tracks';
import { HEATS_PER_GP, teamOf } from '../../game/types';
import type { MarbleInfo } from '../../game/types';
import type { Garage } from '../../game/garages';
import type { RacerAccount } from '../../game/economy';
import type { RankChipModel } from '../../game/rank-view';
import CircuitPreview from '../CircuitPreview';
import Portrait from '../Portrait';
import GaragePanel from './GaragePanel';
import RosterGrid from './RosterGrid';
import { rosterWith } from './roster';

interface Props {
  /** The saved season, running or finished. Null until the player starts one. */
  season: SeasonState | null;
  /** The garage on screen: the season's own setup while one runs, the championship garage otherwise. */
  garage: Garage;
  onGarage: (garage: Garage) => void;
  /** A season is running and the garage is not being retuned: the setup is read-only. */
  locked: boolean;
  /** The retune screen: the garage is open again, between Grands Prix. */
  retune: boolean;
  /** The grid's rivals: a fresh shuffle before a season, the season's own once it runs. */
  rivals: MarbleInfo[];
  onRerollRivals: () => void;
  seed: number;
  /** The circuit the retune screen shows (the season's current round). */
  circuitIndex: number;
  onRetune?: () => void;
  onNewSeason?: () => void;
  account: RacerAccount;
  onShop: () => void;
  rank: RankChipModel | null;
  onRank?: () => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Championship: the season at a glance on the left, your championship goblin in the middle, and the table (or, before
 * the first race, the grid you will face) on the right. The heats themselves are raced from the season screen, which
 * the footer's Continue season opens.
 */
export default function ChampionshipTab({ season, garage, onGarage, locked, retune, rivals, onRerollRivals, seed, circuitIndex, onRetune, onNewSeason, account, onShop, rank, onRank }: Props) {
  const roster = useMemo(() => rosterWith(garage, rivals), [garage, rivals]);
  const round = season ? Math.min(season.round, CALENDAR.length - 1) : 0;
  const heatsDone = season?.results[round]?.length ?? 0;
  // Between the first and the last heat of a Grand Prix the setup is shut (the same rule as the season screen).
  const midGp = !!season && heatsDone > 0 && heatsDone < HEATS_PER_GP;

  const lockNote = <>Locked while your season runs — this is the setup you are racing with. {midGp ? 'It opens again after this Grand Prix.' : 'Use Retune between Grands Prix.'}</>;
  const actions = locked && onRetune
    ? <button className="button-secondary" onClick={onRetune} disabled={midGp} title={midGp ? 'Setup is locked until the next Grand Prix' : 'Tune your marble for the next circuit'}>
      {midGp ? <LockKeyhole size={15} /> : <SlidersHorizontal size={15} />}{midGp ? 'Locked until the next GP' : 'Retune'}
    </button>
    : undefined;

  return <>
    {retune
      ? <RetunePane season={season} seed={seed} circuitIndex={circuitIndex} roster={roster} />
      : <SeasonPane season={season} seed={seed} roster={roster} onNewSeason={onNewSeason} />}
    <GaragePanel mode="championship" garage={garage} onChange={onGarage} locked={locked} lockNote={lockNote} actions={actions} account={account} onShop={onShop} rank={rank} onRank={onRank} />
    {season && !retune
      ? <StandingsPane season={season} />
      : <RosterGrid roster={roster} portrait={garage.portrait} onShuffle={season ? undefined : onRerollRivals} />}
  </>;
}

/** The retune screen's left column: the circuit the next Grand Prix races, live. */
function RetunePane({ season, seed, circuitIndex, roster }: { season: SeasonState | null; seed: number; circuitIndex: number; roster: MarbleInfo[] }) {
  const index = season ? Math.min(season.round, CALENDAR.length - 1) : circuitIndex;
  const def = season ? roundTrack(season, index) : officialTrack(index);
  return <section className="fit-pane circuit-panel home-event" data-pane-id="event" aria-label="The circuit">
    <div className="section-topline"><span className="eyebrow"><b>01</b> THE NEXT GRAND PRIX</span></div>
    <div className="circuit-title-row"><div><h2 id="circuit-title">{season ? roundName(season, index).toUpperCase() : CALENDAR[index].short}</h2><span>{CALENDAR[index].location}</span></div></div>
    <CircuitPreview seed={season ? gpSeed(season.seed, index) : seed} roster={roster} profile={CALENDAR[index].profile} def={def} />
  </section>;
}

/** The season overview: where the championship stands, the next circuit, and the six rounds. */
function SeasonPane({ season, seed, roster, onNewSeason }: { season: SeasonState | null; seed: number; roster: MarbleInfo[]; onNewSeason?: () => void }) {
  const round = season ? Math.min(season.round, CALENDAR.length - 1) : 0;
  const standings = useMemo(() => (season ? computeStandings(season) : []), [season]);
  const byId = (id: number) => season?.roster.find((m) => m.id === id);
  const champion = season?.complete ? byId(standings[0]?.id ?? -1) : null;
  const heats = season?.results[round]?.length ?? 0;

  const title = !season ? 'THE CHAMPIONSHIP' : season.complete ? 'SEASON COMPLETE' : roundName(season, round).toUpperCase();
  const subtitle = !season
    ? 'Six Grands Prix · three heats each'
    : season.complete
      ? `${champion ? (champion.isPlayer ? 'You are' : `${champion.name} is`) : 'Somebody is'} the world champion`
      : `ROUND ${pad2(round + 1)} OF ${pad2(CALENDAR.length)} · HEAT ${Math.min(heats + 1, HEATS_PER_GP)} OF ${HEATS_PER_GP}`;

  return <section className="fit-pane home-event season-pane" data-pane-id="event" aria-labelledby="season-title">
    <div className="section-topline"><span className="eyebrow"><b>01</b> THE SEASON</span>{season && !season.complete && onNewSeason && <button className="text-button" onClick={onNewSeason}>New season</button>}</div>
    <div className="circuit-title-row"><div><h2 id="season-title">{title}</h2><span>{subtitle}</span></div></div>
    {!season && <p className="season-intro">Finishers score 25, 18, 15, 12, 10, 8, 6, 4, 2 or 1 point, and the fastest heat of each Grand Prix adds a bonus point. Your setup locks for all three heats once a Grand Prix begins.</p>}
    {!season?.complete && <CircuitPreview
      seed={season ? gpSeed(season.seed, round) : seed}
      roster={season ? season.roster : roster}
      profile={CALENDAR[round].profile}
      def={season ? roundTrack(season, round) : officialTrack(round)}
    />}
    <div className="season-calendar">
      <div className="section-topline"><h2>THE CALENDAR</h2><span className="eyebrow">{pad2(CALENDAR.length)} GRANDS PRIX</span></div>
      <ol>{CALENDAR.map((event, i) => {
        const done = season?.results[i] ?? [];
        const complete = done.length === HEATS_PER_GP;
        const current = !!season && !season.complete && i === round;
        const winner = complete && season ? byId(gpRanking(done, season.fastest[i])[0]) : null;
        const swap = season?.tracks?.[i] ?? null;
        return <li key={event.id} className={current ? 'calendar-current' : ''}>
          <span className="calendar-round">{pad2(i + 1)}</span>
          <div><strong>{swap ? swap.name.toUpperCase() : event.short}</strong><span>{swap ? `Your track · replaces ${event.short}` : event.location}</span></div>
          <span className="calendar-status">{winner ? <><Trophy size={12} />{winner.isPlayer ? 'You' : winner.name}</> : current ? 'UP NEXT' : 'UPCOMING'}</span>
        </li>;
      })}</ol>
    </div>
  </section>;
}

/** The right-hand column once a season exists: the drivers' table and where you are in it. */
function StandingsPane({ season }: { season: SeasonState }) {
  const standings = useMemo(() => computeStandings(season), [season]);
  const byId = (id: number) => season.roster.find((m) => m.id === id)!;
  const player = season.roster.find((m) => m.isPlayer)!;
  const position = standings.findIndex((s) => s.id === player.id) + 1;
  const mine = standings.find((s) => s.id === player.id);
  return <aside className="fit-pane home-field standings-pane" data-pane-id="field" aria-labelledby="standings-title">
    <div className="section-topline"><h2 id="standings-title">THE STANDINGS</h2><span className="eyebrow">LIVE POINTS</span></div>
    <table className="champ-table standings-table">
      <caption className="sr-only">Drivers' Championship</caption>
      <thead><tr><th>POS</th><th>DRIVER / TEAM</th><th>WINS</th><th>PTS</th></tr></thead>
      <tbody>{standings.map((standing, i) => {
        const m = byId(standing.id);
        return <tr key={m.id} className={m.isPlayer ? 'champ-player' : ''}>
          <td>{pad2(i + 1)}</td>
          <td><span className="standing-driver"><i className="standing-stripe" style={{ background: teamOf(m.id).color }} /><Portrait marble={m} size={28} /><span><strong>{m.isPlayer ? 'You' : m.name}</strong><small>{teamOf(m.id).name}</small></span></span></td>
          <td>{standing.wins}</td>
          <td><strong>{standing.points}</strong>{i > 0 && standings[0].points > 0 && <small className="standing-gap">-{standings[0].points - standing.points}</small>}</td>
        </tr>;
      })}</tbody>
    </table>
    <div className="your-standing"><span className="eyebrow">YOUR CHAMPIONSHIP</span><div><strong>P{position}</strong><span>{mine?.points ?? 0} <small>POINTS</small></span></div></div>
  </aside>;
}
