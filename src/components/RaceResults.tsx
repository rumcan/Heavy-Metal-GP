import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Flag, Timer, Trophy, Check } from 'lucide-react';
import type { HeatResult, MarbleInfo, Inventory } from '../game/types';
import { teamOf } from '../game/types';
import { heatPoints } from '../game/season';
import { formatTime } from '../game/physics';
import type { RacePayout } from '../game/economy';
import { keptSkills, saveRaceTrophies } from '../game/economy';
import { postRaceBanter } from '../game/characters';
import type { Line } from '../game/characters';
import Portrait from './Portrait';
import Banter from './Banter';
import crowd from '../assets/game/goblin-crowd.webp';
import raceFlag from '../assets/game/flag-race.webp';
import RankResults, { RankDelta } from './RankResults';
import type { RankedRaceView } from '../game/rank-view';
import Podium from './results/Podium';
import PayoutCounter from './results/PayoutCounter';
import KeptSkills from './results/KeptSkills';
import { useReducedMotion } from './results/motion';
import './results/results.css';

export interface RaceAction { label: string; onClick: () => void; primary?: boolean }
interface Props {
  results: HeatResult[];
  roster: MarbleInfo[];
  title: string;
  subtitle: string;
  actions: RaceAction[];
  championship: boolean;
  payout?: RacePayout | null;
  credits?: number;
  /** Frozen race snapshots, never the live wallet (shopping must not create trophies). */
  startKit?: Inventory | null;
  endKit?: Inventory | null;
  onShop?: () => void;
  /** MB-08: custom circuits pay 30 % (18 % online) — show the note under the payout. */
  isCustom?: boolean;
  /**
   * RK-05: the rated outcome of an online race — the rating band under the
   * summary, and a signed delta beside every rated human's name. Null/absent
   * for a race nothing could move (an offline heat), which is why the column
   * and the band appear together and never on their own.
   */
  rating?: RankedRaceView | null;
}

export default function RaceResults({ results, roster, title, subtitle, actions, championship, payout, credits, startKit, endKit, onShop, isCustom = false, rating = null }: Props) {
  const byId = (id: number) => roster.find((m) => m.id === id)!;
  const me = results.find((r) => byId(r.id).isPlayer)!;
  const finished = results.filter((r) => r.time !== null);
  const fastest = [...finished].sort((a, b) => a.time! - b.time!)[0];
  const winnerTime = fastest?.time ?? 0;
  const banter = useMemo<Line[]>(() => {
    // A benched online grid can have only one to three drivers. The regular
    // banter picks a driver behind the podium, which that field doesn't have.
    if (results.length < 4) return [{ speaker: byId(me.id), mood: me.time === null ? 'angry' : 'happy', text: me.time === null ? 'Next heat, I’m going full send.' : 'Chequered flag. Bring on the next heat.' }];
    return postRaceBanter(roster, [...results].sort((a, b) => a.rank - b.rank).map((r) => r.id), me.time !== null, Math.random);
  }, [roster, results, me.id, me.time]);
  const points = championship ? heatPoints(me) : 0;
  // P2-07: a KO column, only when this heat had a knock-out or a driver who did not finish
  const koColumn = results.some((r) => (r.kos ?? 0) > 0 || r.time === null || r.dnf);
  const kept = useMemo(() => keptSkills(startKit, endKit), [startKit, endKit]);
  const reducedMotion = useReducedMotion();
  const [skipped, setSkipped] = useState(false);
  const [countedRace, setCountedRace] = useState<string | null>(null);
  const isCounting = !!payout && !reducedMotion && !skipped && countedRace !== payout.raceId;
  const counted = useCallback(() => setCountedRace(payout?.raceId ?? null), [payout?.raceId]);
  const trophyRace = useRef<string | null>(null);

  useEffect(() => {
    if (!startKit || !endKit) return;
    // A paid heat has a durable id. Unscored story replays still bring skills
    // home, but use a presentation id. Keep it stable if a payout arrives later
    // or StrictMode replays the effect: neither may award the same kit twice.
    trophyRace.current ??= payout?.raceId ?? `unscored:${crypto.randomUUID()}`;
    saveRaceTrophies(trophyRace.current, startKit, endKit);
  }, [payout?.raceId, startKit, endKit]);

  useEffect(() => {
    if (!isCounting) return;
    const skip = (event: KeyboardEvent) => {
      // In particular, Enter on the auto-focused action skips the show rather
      // than accidentally starting another race before the final numbers land.
      event.preventDefault();
      event.stopPropagation();
      setSkipped(true);
    };
    window.addEventListener('keydown', skip, true);
    return () => window.removeEventListener('keydown', skip, true);
  }, [isCounting]);

  return <div className="results-backdrop" onClickCapture={(event) => {
      if (!isCounting) return;
      event.preventDefault();
      event.stopPropagation();
      setSkipped(true);
    }}>
    <section className="results-panel arcade-results" role="dialog" aria-modal="true" aria-labelledby="results-title" data-skipped={skipped || reducedMotion}>
      <div className="results-scroll" tabIndex={0} aria-label="Race results and rewards">
      <header className="results-header">
        <div className="results-headline">
        <div className="eyebrow results-eyebrow"><Flag size={16} /> CHEQUERED FLAG <span className="muted">/ {subtitle}</span><span className="results-crowd" aria-hidden="true"><img src={raceFlag} alt="" className="results-flag" /><img src={crowd} alt="" /></span></div>
        <div className="results-heading-row"><div><h2 id="results-title" className="results-title">{me.time === null ? 'NEXT TIME. FULL SEND.' : me.rank === 1 ? 'THAT\'S A RACE WIN.' : me.rank <= 3 ? 'A PLACE ON THE PODIUM.' : 'EVERY POSITION COUNTS.'}</h2><p>{title}</p></div><div className="result-position"><span>YOUR FINISH</span><strong>{me.time === null ? 'DNF' : `P${me.rank}`}</strong></div></div>
        <div className="result-summary"><span><Timer size={14} /> {me.time === null ? 'Time limit reached' : formatTime(me.time)}</span>{championship && <span className="accent"><Trophy size={14} /> +{points} championship points</span>}<span><Check size={14} /> {finished.length}/{roster.length} finished</span></div>
        {rating && <RankResults view={rating} />}
        </div>
        <Podium results={results} roster={roster} />
      </header>
      <div className="results-rewards">
        {payout && <PayoutCounter key={payout.raceId} payout={payout} pegs={me.time === null ? 0 : me.pegs} points={championship ? points : undefined} credits={credits} isCustom={isCustom} instant={skipped || reducedMotion} onComplete={counted} onShop={onShop} />}
        <KeptSkills kept={kept} ready={!isCounting} instant={skipped || reducedMotion} />
      </div>
      <div className="results-table-wrap"><table className="results-table"><caption className="sr-only">Final race classification</caption>
        <thead><tr><th>POS</th><th>DRIVER / TEAM</th><th className="result-pegs">PEGS</th>{koColumn && <th className="result-kos">KO</th>}<th>TIME / GAP</th>{rating && <th className="result-rating-col">RATING</th>}{championship && <th>POINTS</th>}</tr></thead>
        <tbody>{results.map((result) => {
          const m = byId(result.id);
          const team = teamOf(m.id);
          return <tr key={m.id} className={`${m.isPlayer ? 'player-result' : ''} ${result.rank === 1 && result.time !== null ? 'winner-result' : ''}`}>
            <td className="classification-position">{String(result.rank).padStart(2, '0')}</td>
            <td><div className="result-driver"><span className="team-stripe" style={{ background: team.color }} /><Portrait marble={m} mood={result.rank === 1 ? 'happy' : result.time === null ? 'surprised' : 'angry'} size={36} ring={result.rank === 1 && result.time !== null ? 'spiked' : undefined} /><div><strong>{m.isPlayer ? 'You' : m.name}{m.isPlayer && <small>YOU</small>}</strong><span>{team.name}</span></div></div></td>
            <td className="result-pegs"><span className="orange-peg" />{result.pegs}</td>
            {koColumn && <td className="result-kos">{result.kos ?? 0}</td>}
            <td className="classification-time">{result.time === null ? <span className="dnf-label">DNF</span> : <><strong>{formatTime(result.time)}</strong><span>{result.rank === 1 ? 'WINNER' : `+${((result.time - winnerTime) / 1000).toFixed(2)}s`}</span></>}</td>
            {/* RK-05: the human's rating move. An AI seat has no row and prints
                nothing — a dash would read as "rated, no movement". */}
            {rating && <td className="result-rating-col"><RankDelta row={rating.bySeat[result.id]} /></td>}
            {championship && <td className="classification-points">{heatPoints(result) ? `+${heatPoints(result)}` : '0'}</td>}
          </tr>;
        })}</tbody>
      </table></div>
      <div className="results-after-table">{fastest && <div className="fastest-result"><Timer size={15} /><span>FASTEST FINISH</span><strong>{byId(fastest.id).isPlayer ? 'You' : byId(fastest.id).name}</strong><span>{formatTime(fastest.time!)}</span></div>}
        <Banter lines={banter} className="results-banter" delay={600} interval={1100} />
      </div>
      </div>
      <footer className="results-footer">
        <p className="results-skip-hint">{isCounting ? 'Click or press any key to skip the count.' : 'Chequered flag. Winnings and unused skills are yours.'}</p>
        <div className="results-actions">{actions.map((action, i) => <button key={action.label} autoFocus={i === 0} className={action.primary ? 'button-primary' : 'button-secondary'} onClick={action.onClick}>{action.label}{action.primary && <ArrowRight size={18} />}</button>)}</div>
      </footer>
    </section>
  </div>;
}
