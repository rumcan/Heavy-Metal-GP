import { useState } from 'react';
import type { Garage } from '../../game/garages';
import type { RacerAccount } from '../../game/economy';
import type { RankChipModel } from '../../game/rank-view';
import { clearPending, dailySeedText, formatKm, loadRecords, saveRecords, seedTextFor } from '../../game/infinity-store';
import RingTally from './RingTally';
import type { InfinityRecords, SeedChoice } from '../../game/infinity-store';
import GaragePanel from './GaragePanel';
import '../infinity/infinity.css';
import { RING_CREDITS } from '../../game/platformer/course';

interface Props {
  garage: Garage;
  onGarage: (garage: Garage) => void;
  account: RacerAccount;
  onShop: () => void;
  rank: RankChipModel | null;
  onRank?: () => void;
  /** The ring tally's credits, paid into the account. */
  onCredits?: (credits: number) => void;
}

/**
 * Infinity: a calm card (the best distance and the seed in use), the goblin and ball, and the records. One big button,
 * in the footer, rolls. Its gold rings pay credits (the owner: play Infinity to buy skills instead of the story).
 */
export default function InfinityTab({ garage, onGarage, account, onShop, rank, onRank, onCredits }: Props) {
  const [records, setRecords] = useState<InfinityRecords>(() => loadRecords());
  // the rings banked by the last run(s), counted out once when the tab opens (they stay banked until paid)
  const [tally] = useState(() => loadRecords().pending);
  const update = (next: InfinityRecords) => { saveRecords(next); setRecords(next); };
  const choose = (choice: SeedChoice) => update({ ...records, choice });
  const seedText = seedTextFor(records);

  return <>
    <section className="fit-pane circuit-panel home-event" data-pane-id="event" aria-label="Infinity">
      <div className="section-topline"><span className="eyebrow"><b>01</b> INFINITY</span></div>
      <div className="home-picker-panel infinity-card">
        <div>
          <h2>An endless, calm roll</h2>
          <p className="muted">No rivals, no timer, no finish line. The land grows ahead of you for as long as you keep rolling. Stop whenever you like.</p>
        </div>
        <div className="infinity-best"><strong>{formatKm(records.bestKm)}</strong><span>KM · YOUR BEST</span></div>
        <div className="infinity-seeds" role="group" aria-label="Which land to roll">
          <button className="infinity-seed" aria-pressed={records.choice === 'daily'} onClick={() => choose('daily')}>
            <span><b>Seed of the day</b><small>{dailySeedText()} · the same land for everyone today</small></span>
          </button>
          <button className="infinity-seed" aria-pressed={records.choice === 'mine'} onClick={() => choose('mine')}>
            <span><b>My seed</b><small>Any short text gives its own land. Share it with a friend.</small></span>
          </button>
          {records.choice === 'mine' && <input className="infinity-seed-input" aria-label="My seed" placeholder="for example: moss-and-lanterns" maxLength={40} value={records.mySeed} onChange={(e) => update({ ...records, mySeed: e.target.value })} />}
        </div>
        <p className="picker-selected" role="status">Rolling: <b>{seedText}</b></p>
      </div>
    </section>
    <GaragePanel mode="infinity" garage={garage} onChange={onGarage} account={account} onShop={onShop} rank={rank} onRank={onRank} />
    <section className="fit-pane home-field" data-pane-id="field" aria-label="Your records">
      <div className="section-topline"><span className="eyebrow"><b>03</b> YOUR RECORDS</span></div>
      {tally.rings + tally.bonus > 0 && <RingTally rings={tally.rings} bonus={tally.bonus} km={tally.km} onPaid={(credits) => { setRecords(clearPending()); onCredits?.(credits); }} />}
      <dl className="infinity-records">
        <dt>Best distance</dt><dd>{formatKm(records.bestKm)} km</dd>
        <dt>Total rolled</dt><dd>{formatKm(records.totalKm)} km</dd>
        <dt>Runs</dt><dd>{records.runs}</dd>
        <dt>Last seed</dt><dd>{records.lastSeed || '—'}</dd>
      </dl>
      <p className="muted">Collect gold rings on the way: each one pays {RING_CREDITS} credits to spend in the shop, plus a distance bonus of 5 rings for every km. They are counted out here after your run.</p>
    </section>
  </>;
}
