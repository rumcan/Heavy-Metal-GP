import type { StoryBeat, StoryHooks } from '../../game/story/types';
import StoryBubble from './StoryBubble';
import StoryObjectives from './StoryObjectives';
import { useStoryBeats } from './useStoryBeats';

/** One objective chip as the race HUD shows it (shape produced by `objectiveChips()` / `liveObjectiveChips()`). */
export interface ObjectiveChip {
  id: string;
  label: string;
  progress: number;
  target: number;
  met: boolean;
  bonus: boolean;
}

/**
 * The single optional story prop on `RaceScreen` (ST-03 + ST-07): mid-race beats, HUD objective chips
 * and the chapter's engine hooks. With `story` unset the race screen behaves exactly as before.
 */
export interface StoryRaceProps {
  beats?: readonly StoryBeat[];
  objectives?: readonly ObjectiveChip[];
  hooks?: StoryHooks;
}

export interface StoryRaceOverlayProps {
  story: StoryRaceProps;
  /** The player's current sector, from the race HUD. */
  sectorIndex: number;
  /** Stop firing new beats (results screen up). */
  live?: boolean;
}

/** Renders the in-race story layer. Lives inside `.race-stage`, so both children are absolutely placed. */
export default function StoryRaceOverlay({ story, sectorIndex, live = true }: StoryRaceOverlayProps) {
  const beat = useStoryBeats(story.beats, sectorIndex, live);
  return <>
    {story.objectives && <StoryObjectives objectives={story.objectives} />}
    {beat && <StoryBubble key={`${beat.atSector}:${beat.line.who}`} line={beat.line} onDone={beat.dismiss} />}
  </>;
}
