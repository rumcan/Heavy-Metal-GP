// P2-13 (#119) — the tutorial race itself: the Training Grounds with the learner plus two
// slow rivals, no damage, and the lesson overlay on top. StoryMode mounts it for the
// prologue; RulesDialog mounts it for the "Play the tutorial" replay. The race screen is
// wired exactly like a quick race on a platformer course — the tutorial bits ride in
// through the `tutorial` bridge, never through the physics.
import { useMemo, useRef } from 'react';
import RaceScreen from '../RaceScreen';
import type { RaceAction } from '../RaceScreen';
import TutorialOverlay from './TutorialOverlay';
import type { TutorialBridge } from './TutorialOverlay';
import { CALENDAR } from '../../game/season';
import { TRACK_THEMES, emptyInventory } from '../../game/types';
import type { MarbleInfo, TrackProfile } from '../../game/types';
import { TUTORIAL_COURSE_ID, TUTORIAL_SEED, tutorialRoster } from '../../game/story/tutorial';
import type { StoryDriver } from '../../game/story/state';

interface Props {
  /** The garage tune (or the story save's driver) — the learner drives their own marble. */
  driver: StoryDriver;
  /**
   * Which story the tutorial rides for. The campaign prologue gets the campaign driver; a
   * replay from How to play passes whatever driver the screen it sits over has.
   */
  subtitle?: string;
  /** Every lesson completed, or the race finished after the last lesson. */
  onDone: () => void;
  /** The player skipped mid-ride (or bailed from the pause dialog). */
  onSkip: () => void;
}

/** A starter kit for the skills lesson: three Speed Boost charges, nothing else to fuss with. */
function starterInventory() {
  return { ...emptyInventory(), rocket: 3 };
}

export default function TutorialRace({ driver, subtitle = 'PROLOGUE · LEARN TO RACE', onDone, onSkip }: Props) {
  const roster = useMemo<MarbleInfo[]>(() => tutorialRoster(driver), [driver]);
  const gridOrder = useMemo(() => roster.map((m) => m.id), [roster]);
  const profile = useMemo<TrackProfile>(
    () => ({ ...CALENDAR[0].profile, generator: 'platformer' as const, course: TUTORIAL_COURSE_ID, theme: TRACK_THEMES.forest }),
    [],
  );
  const inventory = useMemo(starterInventory, []);
  // One stable object for the whole race: the overlay assigns the callbacks, RaceScreen
  // calls them. The RaceScreen effect must never rebuild the game because of the tutorial.
  const bridge = useRef<TutorialBridge>({
    onFrame: () => undefined, onSteer: () => undefined, onJump: () => undefined,
    onEngine: () => undefined, onSkill: () => undefined,
  }).current;
  const actions: RaceAction[] = [{ label: 'Continue', onClick: onDone, primary: true }];

  return <>
    <RaceScreen
      key={`tutorial-${TUTORIAL_SEED}`}
      seed={TUTORIAL_SEED}
      roster={roster}
      profile={profile}
      gridOrder={gridOrder}
      title="Training Grounds"
      subtitle={subtitle}
      onExit={onSkip}
      onFinished={onDone}
      actions={actions}
      inventory={inventory}
      credits={0}
      onInventoryChange={() => undefined}
      payout={null}
      onShop={() => undefined}
      tutorial={bridge}
    />
    <TutorialOverlay bridge={bridge} onDone={onDone} onSkip={onSkip} />
  </>;
}
