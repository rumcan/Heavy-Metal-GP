import { useEffect, useMemo } from 'react';
import { loadTracksSync } from '../../game/tracks';
import type { Garage } from '../../game/garages';
import type { MarbleInfo } from '../../game/types';
import type { RacerAccount } from '../../game/economy';
import type { RankChipModel } from '../../game/rank-view';
import GaragePanel from './GaragePanel';
import RosterGrid from './RosterGrid';
import TrackPicker from './TrackPicker';
import type { QuickSub } from './TrackPicker';
import { rosterWith } from './roster';

interface Props {
  garage: Garage;
  onGarage: (garage: Garage) => void;
  rivals: MarbleInfo[];
  onRerollRivals: () => void;
  seed: number;
  onNewSeed: () => void;
  circuitIndex: number;
  onCircuit: (index: number) => void;
  customTrackId: string | null;
  onSelectCustom: (id: string | null) => void;
  sub: QuickSub;
  onSub: (sub: QuickSub) => void;
  account: RacerAccount;
  onShop: () => void;
  rank: RankChipModel | null;
  onRank?: () => void;
  onWorkshop: () => void;
}

/** Quick race: pick a circuit (calendar, yours, or the community's), tune the quick-race goblin, see the grid. */
export default function QuickRaceTab({ garage, onGarage, rivals, onRerollRivals, seed, onNewSeed, circuitIndex, onCircuit, customTrackId, onSelectCustom, sub, onSub, account, onShop, rank, onRank, onWorkshop }: Props) {
  const roster = useMemo(() => rosterWith(garage, rivals), [garage, rivals]);

  // A pick that points at a track deleted since (in the Workshop) would leave the race on a circuit the picker
  // does not show: drop it.
  useEffect(() => {
    if (customTrackId && !loadTracksSync().some((t) => t.id === customTrackId)) onSelectCustom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>
    <TrackPicker sub={sub} onSub={onSub} circuitIndex={circuitIndex} onCircuit={onCircuit} seed={seed} onNewSeed={onNewSeed} roster={roster} customTrackId={customTrackId} onSelectCustom={onSelectCustom} onWorkshop={onWorkshop} />
    <GaragePanel mode="quick" garage={garage} onChange={onGarage} account={account} onShop={onShop} rank={rank} onRank={onRank} />
    <RosterGrid roster={roster} portrait={garage.portrait} onShuffle={onRerollRivals} />
  </>;
}
