import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Garage } from '../../game/garages';
import { storyRunStarted } from '../../game/garages';
import { clearStory } from '../../game/story/state';
import type { StoryState } from '../../game/story/state';
import type { RacerAccount } from '../../game/economy';
import type { StoryPick } from '../../game/story/opening';
import type { RankChipModel } from '../../game/rank-view';
import ConfirmDialog from '../ConfirmDialog';
import StoryHub from '../story/StoryHub';
import type { StoryNotice } from '../story/StoryHub';
import GaragePanel from './GaragePanel';

interface Props {
  /** The saved story, or a fresh one for show when there is none. */
  story: StoryState;
  garage: Garage;
  onGarage: (garage: Garage) => void;
  /** Start story mode on this chapter (a chapter card was picked). This tab is the only chapter list. */
  onPlay: (pick: StoryPick) => void;
  /** Banner for the chapter story mode just banked. */
  notice?: StoryNotice | null;
  /** The save was wiped: read it again. */
  onRestarted: () => void;
  account: RacerAccount;
  onShop: () => void;
  rank: RankChipModel | null;
  onRank?: () => void;
}

/**
 * Story: the story hub itself (chapters on the left, the dossier on the right) with the story goblin between them.
 * A run that has started keeps the setup it started with — the story ignores the garage after that — so the garage
 * shows that setup, read-only, until the story is restarted.
 */
export default function StoryTab({ story, garage, onGarage, onPlay, notice = null, onRestarted, account, onShop, rank, onRank }: Props) {
  const [confirmRestart, setConfirmRestart] = useState(false);
  const started = storyRunStarted(story);
  // What the run is racing with, not what the garage would give a new run.
  const shown: Garage = started ? { stats: story.driver.stats, color: story.driver.color, portrait: story.driver.portrait } : garage;

  return <>
    <StoryHub state={story} notice={notice} onPlay={onPlay}>
      <GaragePanel
        mode="story"
        garage={shown}
        onChange={onGarage}
        locked={started}
        lockNote="Your story goblin is locked in for this run. Restart the story to tune a new one."
        name="Sprocket"
        kicker="THE SCRAPYARD KID"
        actions={started ? <button className="button-secondary" onClick={() => setConfirmRestart(true)}><RotateCcw size={14} />Restart story</button> : undefined}
        account={account}
        onShop={onShop}
        rank={rank}
        onRank={onRank}
      />
    </StoryHub>
    {confirmRestart && <ConfirmDialog
      title="Start the story again?"
      message="Chapters, flags and unlocks are wiped. Your championship save is untouched."
      confirmLabel="Restart story"
      onConfirm={() => { setConfirmRestart(false); clearStory(); onRestarted(); }}
      onCancel={() => setConfirmRestart(false)}
    />}
  </>;
}
