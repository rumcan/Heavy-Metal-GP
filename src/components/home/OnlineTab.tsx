import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Trophy, Users } from 'lucide-react';
import { DRIVER_NAMES } from '../../game/characters';
import type { Garage } from '../../game/garages';
import type { RacerAccount } from '../../game/economy';
import type { RankChipModel } from '../../game/rank-view';
import { MARBLE_COUNT } from '../../net/protocol';
import OnlinePanel from '../OnlinePanel';
import Portrait from '../Portrait';
import RankChip from '../RankChip';
import GaragePanel from './GaragePanel';
import { playerOf } from './roster';

interface Props {
  garage: Garage;
  onGarage: (garage: Garage) => void;
  /** The three doors — host, join by code, ranked queue — and the rejoin offer. Absent when there is no room server. */
  online?: {
    busy: boolean;
    error: string | null;
    onHost: () => void;
    onJoin: (code: string) => void;
    onQuick: () => void;
    searching: boolean;
    windows: number;
    onCancelSearch?: () => void;
    rejoin: { roomCode: string } | null;
    onRejoin?: () => void;
    onDismissRejoin?: () => void;
  };
  account: RacerAccount;
  onShop: () => void;
  rank: RankChipModel | null;
  onRank?: () => void;
}

/**
 * Online: the doors on the left, the online goblin in the middle, who you will race on the right. The footer's HOST
 * button is the same door as the panel's Host game; the panel keeps all three (and the rejoin offer, and the state of
 * a search in flight) together so the player reads them as one set.
 */
export default function OnlineTab({ garage, onGarage, online, account, onShop, rank, onRank }: Props) {
  const marble = useMemo(() => playerOf(garage), [garage]);
  return <>
    <section className="fit-pane home-event online-pane" data-pane-id="event" aria-labelledby="online-title">
      <div className="section-topline"><span className="eyebrow"><b>01</b> PLAY ONLINE</span></div>
      <div className="online-intro">
        <h2 id="online-title">RACE OTHER GOBLINS</h2>
        <p>Race friends in a room of your own, or queue for a ranked race against a stranger near your rank.</p>
      </div>
      {online
        ? <OnlinePanel
          busy={online.busy}
          error={online.error}
          onHost={online.onHost}
          onJoin={online.onJoin}
          onQuick={online.onQuick}
          searching={online.searching}
          windows={online.windows}
          onCancelSearch={online.onCancelSearch}
          rejoin={online.rejoin}
          onRejoin={online.onRejoin}
          onDismissRejoin={online.onDismissRejoin}
        />
        : <p className="mode-note">Online needs the RUN.world host — race the AI here.</p>}
    </section>

    <GaragePanel mode="online" garage={garage} onChange={onGarage} kicker="ONLINE" account={account} onShop={onShop} rank={rank} onRank={onRank} />

    <section className="fit-pane home-field online-seats" data-pane-id="field" aria-labelledby="seats-title">
      <div className="section-topline"><div className="eyebrow" id="seats-title"><b>03</b> THE FIELD</div>
        {rank && onRank && <button className="text-button" onClick={onRank}><Trophy size={14} />Ladder</button>}</div>
      <ol className="driver-grid">
        <li className="is-player" style={{ '--team': '#d63e2e' } as CSSProperties}>
          <Portrait marble={marble} mood="happy" size={48} />
          <div><strong>{DRIVER_NAMES[garage.portrait]}</strong><small>YOU</small><span>{rank ? 'your rank travels with you' : 'host or guest'}</span></div>
          {rank && <RankChip model={rank} compact />}
        </li>
        <li className="is-open">
          <span className="lobby-ai-badge" aria-hidden="true"><Users size={18} /></span>
          <div><strong>Open seats</strong><small>Friends by code, or whoever Auto Match finds</small><span>up to six drivers in all</span></div>
        </li>
        <li className="is-ai">
          <span className="lobby-ai-badge" aria-hidden="true">AI</span>
          <div><strong>AI drivers</strong><small>Fill every seat nobody takes</small><span>the grid always has {MARBLE_COUNT} marbles</span></div>
        </li>
      </ol>
    </section>
  </>;
}
