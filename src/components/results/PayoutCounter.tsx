import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Coins, ShoppingBag, Trophy } from 'lucide-react';
import type { RacePayout } from '../../game/economy';
import { CUSTOM_PAYOUT_NOTE, PEG_CREDITS } from '../../game/economy';
import { raceAudio } from '../../game/audio';
import { payoutFrame, PAYOUT_LINE_MS, PAYOUT_TICK_MS } from './payout';
import { useReducedMotion } from './motion';

interface Props {
  payout: RacePayout;
  pegs: number;
  /** Undefined for a single heat; zero is still a championship points line. */
  points?: number;
  credits?: number;
  isCustom?: boolean;
  instant?: boolean;
  onComplete?: () => void;
  onShop?: () => void;
}

function sound(type: 'click' | 'bonus') {
  raceAudio.play({ type, x: 450, y: 0, player: true }, { x: 450, y: 0, halfHeight: 1 });
}

export default function PayoutCounter({ payout, pegs, points, credits, isCustom, instant = false, onComplete, onShop }: Props) {
  const reducedMotion = useReducedMotion();
  const finishNow = instant || reducedMotion;
  const targets = useMemo(() => [payout.placement, payout.pegBonus, ...(points === undefined ? [] : [points]), payout.total], [payout.placement, payout.pegBonus, payout.total, points]);
  const [elapsed, setElapsed] = useState(0);
  const completed = useRef(false);
  const frame = payoutFrame(targets, finishNow ? targets.length * PAYOUT_LINE_MS : elapsed);
  const { values, active, done } = frame;

  useEffect(() => {
    if (finishNow) return;
    const started = performance.now();
    let previous = payoutFrame(targets, 0).values;
    const timer = window.setInterval(() => {
      const at = performance.now() - started;
      const next = payoutFrame(targets, at);
      if (!next.done && next.values.some((value, i) => value !== previous[i])) sound('click');
      previous = next.values;
      setElapsed(at);
      if (next.done) window.clearInterval(timer);
    }, PAYOUT_TICK_MS);
    return () => window.clearInterval(timer);
  }, [targets, finishNow]);

  useEffect(() => {
    if (!done || completed.current) return;
    completed.current = true;
    if (payout.total > 0) sound('bonus');
    onComplete?.();
  }, [done, onComplete, payout.total]);

  const lines = [
    { label: 'Placement prize', detail: 'Chequered flag reward', unit: 'CR' },
    { label: 'Peg bonus', detail: `${pegs} pegs × ${PEG_CREDITS} CR${pegs * PEG_CREDITS !== payout.pegBonus ? ' · scaled purse' : ''}`, unit: 'CR' },
    ...(points === undefined ? [] : [{ label: 'Championship points', detail: 'Added to the standings, not your wallet', unit: 'PTS' }]),
  ];

  return <section className={`race-payout arcade-payout${done ? ' is-complete' : ''}`} aria-label="Race winnings" aria-busy={!done}>
    <div className="payout-heading"><Coins size={18} aria-hidden="true" /><h3>{payout.total > 0 ? 'Race winnings' : 'No payout / DNF'}</h3><span>{done ? 'BANKED' : 'COUNTING…'}</span></div>
    <ol className="payout-lines">{lines.map((line, i) => <li key={line.label} className={i === active ? 'is-counting' : i < active ? 'is-counted' : ''}>
      <div><span>{line.label}</span><small>{line.detail}</small></div>
      <b data-counter={i}>+{values[i].toLocaleString()} <small>{line.unit}</small></b>
      <Check size={12} className="payout-line-check" aria-hidden="true" />
    </li>)}</ol>
    <div className="payout-total arcade-total"><Coins size={28} aria-hidden="true" /><div><span>TOTAL CREDITS</span><strong data-counter="total">+{values[values.length - 1].toLocaleString()} <small>CR</small></strong></div>{done && <Trophy size={20} aria-hidden="true" />}</div>
    {isCustom && <p className="payout-custom-note">{CUSTOM_PAYOUT_NOTE}</p>}
    <div className="payout-wallet"><span>BALANCE: {(credits ?? payout.balance).toLocaleString()} CR</span>{onShop && <button className="text-button" onClick={onShop}><ShoppingBag size={14} />Spend winnings <ArrowRight size={14} /></button>}</div>
    {/* Announce once, not on every tick. */}
    <span className="sr-only" role="status">{done ? `${payout.total.toLocaleString()} credits banked${points === undefined ? '' : `, ${points} championship points`}.` : ''}</span>
  </section>;
}
