import { useMemo } from 'react';
import { ArrowRight, Flag, Timer, Trophy, Check, Coins, ShoppingBag } from 'lucide-react';
import type { HeatResult, MarbleInfo } from '../game/types';
import { teamOf } from '../game/types';
import { pointsFor } from '../game/season';
import { formatTime } from '../game/physics';
import type { RacePayout } from '../game/economy';
import { CUSTOM_PAYOUT_NOTE } from '../game/economy';
import { postRaceBanter } from '../game/characters';
import Portrait from './Portrait';
import Banter from './Banter';
import crowd from '../assets/game/goblin-crowd.webp';
import raceFlag from '../assets/game/flag-race.webp';

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
  onShop?: () => void;
  /** MB-08: custom circuits pay 30 % (18 % online) — show the note under the payout. */
  isCustom?: boolean;
}

export default function RaceResults({ results, roster, title, subtitle, actions, championship, payout, credits, onShop, isCustom = false }: Props) {
  const byId = (id: number) => roster.find((m) => m.id === id)!;
  const me = results.find((r) => byId(r.id).isPlayer)!;
  const finished = results.filter((r) => r.time !== null);
  const fastest = [...finished].sort((a, b) => a.time! - b.time!)[0];
  const winnerTime = fastest?.time ?? 0;
  const banter = useMemo(() => postRaceBanter(roster, [...results].sort((a, b) => a.rank - b.rank).map((r) => r.id), me.time !== null, Math.random), [roster, results, me.time]);
  const points = championship && me.time !== null ? pointsFor(me.rank) : 0;

  return <div className="results-backdrop">
    <section className="results-panel" role="dialog" aria-modal="true" aria-labelledby="results-title">
      <header className="results-header">
        <div className="eyebrow results-eyebrow"><Flag size={16} /> CHEQUERED FLAG <span className="muted">/ {subtitle}</span><span className="results-crowd" aria-hidden="true"><img src={raceFlag} alt="" className="results-flag" /><img src={crowd} alt="" /></span></div>
        <div className="results-heading-row"><div><h2 id="results-title" className="results-title">{me.time === null ? 'NEXT TIME. FULL SEND.' : me.rank === 1 ? 'THAT\'S A RACE WIN.' : me.rank <= 3 ? 'A PLACE ON THE PODIUM.' : 'EVERY POSITION COUNTS.'}</h2><p>{title}</p></div><div className="result-position"><span>YOUR FINISH</span><strong>{me.time === null ? 'DNF' : `P${me.rank}`}</strong></div></div>
        <div className="result-summary"><span><Timer size={14} /> {me.time === null ? 'Time limit reached' : formatTime(me.time)}</span>{championship && <span className="accent"><Trophy size={14} /> +{points} championship points</span>}<span><Check size={14} /> {finished.length}/{roster.length} finished</span></div>
        <Banter lines={banter} className="results-banter" delay={600} interval={1100} />
      </header>
      <div className="results-table-wrap"><table className="results-table"><caption className="sr-only">Final race classification</caption>
        <thead><tr><th>POS</th><th>DRIVER / TEAM</th><th className="result-pegs">PEGS</th><th>TIME / GAP</th>{championship && <th>POINTS</th>}</tr></thead>
        <tbody>{results.map((result) => {
          const m = byId(result.id);
          const team = teamOf(m.id);
          return <tr key={m.id} className={`${m.isPlayer ? 'player-result' : ''} ${result.rank === 1 && result.time !== null ? 'winner-result' : ''}`}>
            <td className="classification-position">{String(result.rank).padStart(2, '0')}</td>
            <td><div className="result-driver"><span className="team-stripe" style={{ background: team.color }} /><Portrait marble={m} mood={result.rank === 1 ? 'happy' : result.time === null ? 'surprised' : 'angry'} size={36} ring={result.rank === 1 && result.time !== null ? 'spiked' : undefined} /><div><strong>{m.isPlayer ? 'You' : m.name}{m.isPlayer && <small>YOU</small>}</strong><span>{team.name}</span></div></div></td>
            <td className="result-pegs"><span className="orange-peg" />{result.pegs}</td>
            <td className="classification-time">{result.time === null ? <span className="dnf-label">DNF</span> : <><strong>{formatTime(result.time)}</strong><span>{result.rank === 1 ? 'WINNER' : `+${((result.time - winnerTime) / 1000).toFixed(2)}s`}</span></>}</td>
            {championship && <td className="classification-points">{result.time === null ? '0' : `+${pointsFor(result.rank)}`}</td>}
          </tr>;
        })}</tbody>
      </table></div>
      <footer className="results-footer">{fastest && <div className="fastest-result"><Timer size={15} /><span>FASTEST FINISH</span><strong>{byId(fastest.id).isPlayer ? 'You' : byId(fastest.id).name}</strong><span>{formatTime(fastest.time!)}</span></div>}
        {payout && <div className="race-payout" role="status"><div className="payout-total"><Coins size={24} /><div><span>{payout.total > 0 ? 'RACE WINNINGS' : 'NO PAYOUT / DNF'}</span><strong>+{payout.total.toLocaleString()} <small>CR</small></strong></div></div><p><span>Placement <b>{payout.placement} CR</b></span><span>Orange pegs <b>+{payout.pegBonus} CR</b></span></p>{isCustom && <p className="payout-custom-note" style={{ fontSize: '10px', color: 'var(--muted)', margin: '6px 0 0' }}>{CUSTOM_PAYOUT_NOTE}</p>}<div className="payout-wallet"><span>BALANCE: {(credits ?? payout.balance).toLocaleString()} CR</span>{onShop && <button className="text-button" onClick={onShop}><ShoppingBag size={14} />Spend winnings <ArrowRight size={14} /></button>}</div></div>}
        <div className="results-actions">{actions.map((action, i) => <button key={action.label} autoFocus={i === 0} className={action.primary ? 'button-primary' : 'button-secondary'} onClick={action.onClick}>{action.label}{action.primary && <ArrowRight size={18} />}</button>)}</div></footer>
    </section>
  </div>;
}