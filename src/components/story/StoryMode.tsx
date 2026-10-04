import { useEffect, useMemo, useRef, useState } from 'react';
import LoadingScreen from '../LoadingScreen';
import RaceScreen from '../RaceScreen';
import type { RaceAction } from '../RaceScreen';
import { gridOrder } from '../../game/season';
import { awardResultXp, settleRace } from '../../game/economy';
import type { RacerAccount, RacePayout } from '../../game/economy';
import { HEATS_PER_GP } from '../../game/types';
import type { HeatResult, MarbleInfo, TrackProfile } from '../../game/types';
import { chapterDef } from '../../game/story/outline';
import {
  chapterTitle, liveObjectiveChips, markScenePlayed, nextScene, settleHeat, storyBeats,
} from '../../game/story/engine';
import type { HeatSettlement } from '../../game/story/engine';
import { buildStoryHooks, emptyStoryCounters } from '../../game/story/modifiers';
import type { StoryHookHandle } from '../../game/story/modifiers';
import { applyChapterReward, rewardForChapter } from '../../game/story/rewards';
import type { ChapterPayout } from '../../game/story/rewards';
import {
  applyChoice, chapterObjectives, chapterUnlocked, completeTutorial, loadStory,
  newStory, saveStory, storyGrandPrix, storyPosition, storyProfile, storyRaceSeed,
  storyRoster,
} from '../../game/story/state';
import type { StoryDriver, StoryState } from '../../game/story/state';
import { checkedPick, enterChapter, openStory } from '../../game/story/opening';
import type { StoryPick } from '../../game/story/opening';
import { ENDING_TITLE } from '../../game/story/types';
import type { ChapterNumber, ChoiceOption, RaceCounters, Scene, StoryOutcome, Trigger } from '../../game/story/types';
import ChapterCard from './ChapterCard';
import { ChapterComplete } from './ChapterComplete';
import type { StoryNotice } from './StoryHub';
import { actStarts } from './StoryHub';
import StoryScene from './StoryScene';
import TutorialPrologue from './TutorialPrologue';
import TutorialRace from './TutorialRace';
import type { StoryRaceProps } from './StoryRace';
import '../../story.css';

/** Stages of the story flow. Scene playback lives in `playing`, on top of whichever stage queued it. */
type Stage =
  /** Back to the home screen's Story tab: the one chapter list (story mode never shows a second one). */
  | { kind: 'home' }
  /** P2-13: a fresh save opens here; both buttons end in the picked chapter. */
  | { kind: 'prologue' }
  /** P2-13: the Training Grounds tutorial race (player + 2 slow AI, no damage). */
  | { kind: 'tutorial' }
  | { kind: 'card'; chapter: ChapterNumber }
  | { kind: 'intro'; chapter: ChapterNumber }
  | { kind: 'pre'; chapter: ChapterNumber; heat: number }
  | { kind: 'loading'; chapter: ChapterNumber; heat: number }
  | { kind: 'race'; chapter: ChapterNumber; heat: number }
  | { kind: 'outro'; chapter: ChapterNumber; settlement: HeatSettlement | null }
  | { kind: 'complete'; chapter: ChapterNumber; payout: ChapterPayout; last: boolean };

interface Playback {
  trigger: Trigger;
  chapter: number;
  outcome: StoryOutcome | null;
  scene: Scene;
  then: Stage;
}

interface RaceSetup {
  seed: number;
  roster: MarbleInfo[];
  profile: TrackProfile;
  grid: number[];
}

export interface StoryModeProps {
  /** The garage goblin, carried onto the story grid. */
  driver: StoryDriver;
  account: RacerAccount;
  /** Publish credits/inventory changes (App owns the wallet and its save). */
  onAccount: (account: RacerAccount) => void;
  /**
   * P2-20: the race paid XP and the driver levelled up — App shows the level-up
   * card over the results screen (it owns that overlay, like every other mode).
   */
  onLevelUp?: (from: number, to: number, xp: number) => void;
  onShop: () => void;
  /**
   * The chapter picked on the home screen's Story tab. Story mode starts it straight away (after the tutorial
   * prologue on a save that has not learned to race); without one it starts the next chapter to play.
   */
  start?: StoryPick | null;
  /** Back to the home screen's Story tab, with the banner for a chapter just banked. */
  onExit: (notice?: StoryNotice | null) => void;
}

/** A fresh run gets its own seed without `Math.random()`: the sim derives everything from it. */
function runSeed(driver: StoryDriver): number {
  let hash = 0x811c9dc5;
  for (const char of `${driver.name}|${driver.color}|${Date.now()}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

/**
 * Story mode orchestrator (ST-08): chapter card → scenes → loading screen → race → scenes → next chapter. The chapter
 * is picked on the home screen's Story tab and every way out goes back there. Owns the story save end to end; the
 * championship save and the wallet's paid-race ledger are the only things it shares with the rest of the game.
 */
export default function StoryMode({ driver, account, onAccount, onLevelUp, onShop, start = null, onExit }: StoryModeProps) {
  // P2-13: a save with no tutorial and no progress yet opens on the prologue — the first race of the campaign IS the
  // tutorial. Anything else goes straight into the picked chapter (its title card).
  const [opening] = useState(() => openStory(loadStory(), start, () => newStory(runSeed(driver), driver, Date.now())));
  const [state, setState] = useState<StoryState>(opening.state);
  const stateRef = useRef(state);
  const accountRef = useRef(account);
  accountRef.current = account;
  /** The untouched save while a chapter-select replay is running. */
  const baseRef = useRef<StoryState | null>(opening.base);
  const handleRef = useRef<StoryHookHandle | null>(null);
  const settlementRef = useRef<HeatSettlement | null>(null);
  const heatRef = useRef(opening.heat);

  const [stage, setStage] = useState<Stage>(opening.tutorial ? { kind: 'prologue' } : { kind: 'card', chapter: opening.pick.chapter });
  const [playing, setPlaying] = useState<Playback | null>(null);
  const [setup, setSetup] = useState<RaceSetup | null>(null);
  const [payout, setPayout] = useState<RacePayout | null>(null);
  const [liveCounters, setLiveCounters] = useState<RaceCounters>(emptyStoryCounters());
  const [autoAdvance, setAutoAdvance] = useState(false);

  useEffect(() => { saveStory(stateRef.current); }, [state]);

  // A brand-new run picks up the garage tune; a saved run keeps the setup it started with.
  useEffect(() => {
    const fresh = !stateRef.current.season.results.some((heats) => heats.length) && !stateRef.current.seenScenes.length;
    if (fresh) mutate((previous) => ({ ...previous, driver }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mutate = (fn: (previous: StoryState) => StoryState): StoryState => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    setState(next);
    return next;
  };

  const chapter = stage.kind === 'home' || stage.kind === 'prologue' || stage.kind === 'tutorial' ? state.chapter : stage.chapter;
  const def = chapterDef(chapter);
  // Every hook stays above the first `return` below: a hook after it ran on some renders and not others, and React
  // threw the whole page away the moment the first scene started ("Rendered fewer hooks than expected", a blank screen).
  const roster = useMemo(() => storyRoster(state.driver), [state.driver]);
  // Mid-race bubbles play in the first race of a chapter only; they used to repeat in every race.
  const beatHeat = stage.kind === 'race' ? stage.heat : 1;
  const beats = useMemo(() => (beatHeat > 1 ? [] : storyBeats(chapter, state.flags)), [chapter, state.flags, beatHeat]);
  const objectives = useMemo(
    () => liveObjectiveChips(def, chapterObjectives(state, chapter), liveCounters),
    [def, state, chapter, liveCounters],
  );
  const storyProp: StoryRaceProps = useMemo(
    () => ({ beats, objectives, hooks: handleRef.current?.hooks }),
    // `raceKey` changes when a new heat's hooks are built.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beats, objectives, stage],
  );
  // The race's profile and grid keep their identity between renders: RaceScreen rebuilds its race whenever they change,
  // and this screen re-renders on every inventory change (picking up an item box used to restart the heat).
  const raceChapter = stage.kind === 'race' ? stage.chapter : 0;
  const raceProfile = useMemo(() => setup?.profile ?? (raceChapter ? storyProfile(raceChapter) : null), [setup, raceChapter]);
  const raceGrid = useMemo(() => setup?.grid ?? gridOrder(state.season), [setup, state.season]);

  /** Chapter hooks are built once per heat: the game captures them when it is constructed. */
  const makeHandle = (forChapter: number, heat: number, from: StoryState): StoryHookHandle => {
    const counters = emptyStoryCounters();
    const handle = buildStoryHooks({
      chapter: forChapter, heat, flags: from.flags,
      seed: storyRaceSeed(from, forChapter), roster: storyRoster(from.driver), counters,
    });
    const inner = handle.hooks.onCounter;
    let lastPush = 0;
    handle.hooks = {
      ...handle.hooks,
      onCounter: (event) => {
        inner?.(event);
        const now = Date.now();
        // The HUD chips read React state; the counters themselves stay in the handle.
        if (now - lastPush > 220) {
          lastPush = now;
          setLiveCounters({ ...counters, overtakes: { ...counters.overtakes } });
        }
      },
    };
    return handle;
  };

  const enterLoading = (forChapter: ChapterNumber, heat: number) => {
    const from = stateRef.current;
    handleRef.current = makeHandle(forChapter, heat, from);
    settlementRef.current = null;
    heatRef.current = heat;
    setLiveCounters(emptyStoryCounters());
    setPayout(null);
    // Frozen for the whole heat: RaceScreen rebuilds the game if these identities change.
    setSetup({
      seed: storyRaceSeed(from, forChapter),
      roster: storyRoster(from.driver),
      profile: storyProfile(forChapter),
      grid: gridOrder(from.season),
    });
    setStage({ kind: 'loading', chapter: forChapter, heat });
  };

  const bankChapter = (forChapter: number, settlement: HeatSettlement): ChapterPayout => {
    const replay = stateRef.current.replaying;
    const paid = applyChapterReward(
      stateRef.current, accountRef.current, forChapter,
      chapterObjectives(settlement.state, forChapter), !replay,
    );
    if (paid.unlocked) {
      mutate(() => paid.state);
      accountRef.current = paid.account;
      onAccount(paid.account);
    }
    return paid;
  };

  /** Ask the engine for the next scene of a trigger; when the queue is empty, move to `then`. */
  const enqueue = (trigger: Trigger, forChapter: number, outcome: StoryOutcome | null, then: Stage) => {
    const scene = nextScene(stateRef.current, trigger, outcome, forChapter);
    if (!scene) { run(then); return; }
    setPlaying({ trigger, chapter: forChapter, outcome, scene, then });
  };

  function run(next: Stage) {
    setPlaying(null);
    switch (next.kind) {
      case 'home':
        leaveToHome();
        return;
      case 'card':
      case 'prologue':
      case 'tutorial':
        setStage(next);
        return;
      case 'intro':
        enqueue('intro', next.chapter, null, { kind: 'pre', chapter: next.chapter, heat: heatRef.current });
        return;
      case 'pre':
        heatRef.current = next.heat;
        enqueue('pre-race', next.chapter, null, { kind: 'loading', chapter: next.chapter, heat: next.heat });
        return;
      case 'loading':
        enterLoading(next.chapter, next.heat);
        return;
      case 'race':
        setStage(next);
        return;
      case 'outro':
        enqueue('outro', next.chapter, null, next.settlement
          ? { kind: 'complete', chapter: next.chapter as ChapterNumber, payout: bankChapter(next.chapter, next.settlement), last: next.settlement.storyDone }
          : { kind: 'home' });
        return;
      case 'complete':
        setStage(next);
        return;
    }
  }

  const beginChapter = (pick: StoryPick) => {
    const chosen = checkedPick(stateRef.current, pick);
    const entered = enterChapter(stateRef.current, chosen);
    baseRef.current = entered.base;
    mutate(() => entered.state);
    heatRef.current = entered.heat;
    run({ kind: 'card', chapter: chosen.chapter });
  };

  /** Back to the home screen's Story tab. A replay never touched the save (`saveStory` skips it), so nothing to undo there. */
  const leaveToHome = (notice: StoryNotice | null = null) => {
    if (stateRef.current.replaying && baseRef.current) stateRef.current = baseRef.current;
    baseRef.current = null;
    handleRef.current = null;
    settlementRef.current = null;
    setPlaying(null);
    setStage({ kind: 'home' });
    onExit(notice);
  };

  const onSceneDone = (choice: ChoiceOption | null) => {
    if (!playing) return;
    const playback = playing;
    const next = mutate((previous) => {
      const marked = markScenePlayed(previous, playback.scene);
      return choice ? applyChoice(marked, choice.set, choice.value !== false) : marked;
    });
    // Scenes later in the queue can gate on flags this one just set, so ask again rather than pre-queue.
    const following = nextScene(next, playback.trigger, playback.outcome, playback.chapter);
    if (following) { setPlaying({ ...playback, scene: following }); return; }
    run(playback.then);
  };

  const onSceneSkip = () => {
    if (!playing) return;
    const playback = playing;
    mutate((previous) => markScenePlayed(previous, playback.scene));
    run(playback.then);
  };

  const onRaceFinished = (results: HeatResult[]) => {
    const handle = handleRef.current;
    const counters = handle?.counters ?? emptyStoryCounters();
    const snapshot: RaceCounters = {
      ...counters,
      overtakes: { ...counters.overtakes },
      rivalRanks: { ...counters.rivalRanks },
      eventsFired: [...(counters.eventsFired ?? [])],
    };
    const replay = stateRef.current.replaying;
    const settlement = settleHeat(stateRef.current, results, snapshot);
    settlementRef.current = settlement;
    mutate(() => settlement.state);
    setLiveCounters(snapshot);
    if (replay) { setPayout(null); return; }
    const raceId = `story:${settlement.state.seed}:${settlement.chapterRaced}:${heatRef.current}`;
    // P2-20: the story heat pays through the same purse every offline mode uses —
    // the Shaman's fee and KO bounties ride on the same settleRace call.
    const paid = settleRace(accountRef.current, raceId, settlement.player, 1, 'story');
    let next = paid.account;
    // P2-20: XP once per race id (the same id the purse was paid under), and the
    // level-up card on the results screen when the XP pushed the driver up a level.
    if (!paid.payout.alreadyPaid) {
      const r = awardResultXp(next, raceId, settlement.player);
      next = r.account;
      if (r.levelsGained.length) onLevelUp?.(r.from, r.to, r.xp);
    }
    accountRef.current = next;
    onAccount(next);
    setPayout(paid.payout);
  };

  const continueAfterRace = () => {
    const settlement = settlementRef.current;
    setPayout(null);
    if (!settlement) { leaveToHome(); return; }
    const raced = settlement.chapterRaced as ChapterNumber;
    if (!settlement.chapterDone && heatRef.current < HEATS_PER_GP) {
      run({ kind: 'pre', chapter: raced, heat: heatRef.current + 1 });
      return;
    }
    run({ kind: 'outro', chapter: raced, settlement });
  };

  const afterComplete = (forChapter: ChapterNumber, last: boolean, paid: ChapterPayout) => {
    const replay = stateRef.current.replaying;
    const notice: StoryNotice = {
      chapter: forChapter, credits: paid.credits, perfect: paid.perfect,
      unlock: paid.unlock, unlocked: paid.unlocked, replay,
    };
    if (last || replay) { leaveToHome(notice); return; }
    const next = Math.min(6, forChapter + 1) as ChapterNumber;
    if (!chapterUnlocked(stateRef.current, next)) { leaveToHome(notice); return; }
    beginChapter({ chapter: next, replay: false });
  };

  // ---- render ----

  if (playing) {
    const heatNo = heatRef.current;
    return <StoryScene
      key={playing.scene.id}
      scene={playing.scene}
      flags={state.flags}
      autoAdvance={autoAdvance}
      onAutoAdvanceChange={setAutoAdvance}
      onDone={onSceneDone}
      onExit={onSceneSkip}
      heading={`CHAPTER ${String(playing.chapter).padStart(2, '0')} · ${chapterTitle(playing.chapter).toUpperCase()}${playing.scene.trigger === 'mid-race' ? '' : ` · HEAT ${Math.min(HEATS_PER_GP, heatNo)} OF ${HEATS_PER_GP}`}`}
    />;
  }

  // P2-13: leaving the tutorial banks `tutorialDone` either way — finishing teaches every lesson, skipping is a choice
  // the save remembers too. Finishing and Skip both go on into the picked chapter; quitting from the pause menu goes home.
  const tutorialThenChapter = () => {
    mutate(completeTutorial);
    beginChapter(opening.pick);
  };
  const quitTutorial = () => {
    mutate(completeTutorial);
    leaveToHome();
  };

  switch (stage.kind) {
    case 'prologue':
      return <TutorialPrologue
        onPlay={() => setStage({ kind: 'tutorial' })}
        onSkip={tutorialThenChapter}
      />;

    case 'tutorial':
      return <TutorialRace
        driver={state.driver}
        subtitle="PROLOGUE · LEARN TO RACE"
        onDone={tutorialThenChapter}
        onSkip={tutorialThenChapter}
        onQuit={quitTutorial}
      />;

    case 'home':
      return null;

    case 'card': {
      const gp = storyGrandPrix(stage.chapter);
      const reward = rewardForChapter(stage.chapter);
      return <ChapterCard
        chapter={stage.chapter}
        act={actStarts(stage.chapter)}
        circuit={gp.name}
        heats={HEATS_PER_GP}
        reward={{ credits: reward.credits + reward.perfect, label: `${reward.unlock.kind}: ${reward.unlock.label}` }}
        onDone={() => run({ kind: 'intro', chapter: stage.chapter })}
      />;
    }

    case 'intro':
      return null;

    case 'pre':
      return null;

    case 'loading': {
      const gp = storyGrandPrix(stage.chapter);
      return <LoadingScreen
        eyebrow={`STORY · CHAPTER ${String(stage.chapter).padStart(2, '0')} / HEAT ${stage.heat} OF ${HEATS_PER_GP}`}
        title={gp.name.toUpperCase()}
        cta="Lights out"
        onContinue={() => run({ kind: 'race', chapter: stage.chapter, heat: stage.heat })}
      />;
    }

    case 'race': {
      const gp = storyGrandPrix(stage.chapter);
      const actions: RaceAction[] = [{
        label: heatRef.current >= HEATS_PER_GP || state.season.complete ? 'Continue the story' : 'Next heat',
        onClick: continueAfterRace,
        primary: true,
      }];
      return <RaceScreen
        key={`story-${stage.chapter}-${stage.heat}-${setup?.seed ?? 0}`}
        seed={setup?.seed ?? storyRaceSeed(state, stage.chapter)}
        roster={setup?.roster ?? roster}
        profile={raceProfile ?? storyProfile(stage.chapter)}
        gridOrder={raceGrid}
        title={gp.name}
        subtitle={`STORY · CHAPTER ${String(stage.chapter).padStart(2, '0')} / HEAT ${stage.heat} OF ${HEATS_PER_GP}`}
        championship
        loadoutMode="story"
        onExit={() => leaveToHome()}
        onFinished={onRaceFinished}
        actions={actions}
        inventory={account.inventory}
        credits={account.credits}
        onInventoryChange={state.replaying ? () => undefined : (inventory) => onAccount({ ...accountRef.current, inventory: { ...inventory } })}
        payout={payout}
        onShop={onShop}
        story={storyProp}
      />;
    }

    case 'complete': {
      const gp = storyGrandPrix(stage.chapter);
      const ending = state.ending;
      return <ChapterComplete
        chapter={stage.chapter}
        circuit={gp.name}
        credits={stage.payout.credits}
        perfect={stage.payout.perfect}
        unlock={stage.payout.unlock}
        unlocked={stage.payout.unlocked}
        replay={state.replaying}
        last={stage.last}
        position={storyPosition(state)}
        endingTitle={ending ? ENDING_TITLE[ending] : null}
        onDone={() => afterComplete(stage.chapter, stage.last, stage.payout)}
      />;
    }
  }
}
