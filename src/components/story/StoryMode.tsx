import { useEffect, useMemo, useRef, useState } from 'react';
import LoadingScreen from '../LoadingScreen';
import RaceScreen from '../RaceScreen';
import type { RaceAction } from '../RaceScreen';
import { gridOrder } from '../../game/season';
import { settleRace } from '../../game/economy';
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
  applyChoice, chapterObjectives, chapterUnlocked, clearStory, loadStory, newStory, saveStory,
  startReplay, storyGrandPrix, storyPosition, storyProfile, storyRaceSeed, storyRoster,
} from '../../game/story/state';
import type { StoryDriver, StoryState } from '../../game/story/state';
import { ENDING_TITLE } from '../../game/story/types';
import type { ChapterNumber, ChoiceOption, RaceCounters, Scene, StoryOutcome, Trigger } from '../../game/story/types';
import ChapterCard from './ChapterCard';
import { ChapterComplete } from './ChapterComplete';
import StoryHub from './StoryHub';
import type { StoryNotice } from './StoryHub';
import { actStarts } from './StoryHub';
import StoryScene from './StoryScene';
import type { StoryRaceProps } from './StoryRace';
import '../../story.css';

/** Stages of the story flow. Scene playback lives in `playing`, on top of whichever stage queued it. */
type Stage =
  | { kind: 'hub' }
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
  onShop: () => void;
  onExit: () => void;
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
 * Story mode orchestrator (ST-08): hub → chapter card → scenes → loading screen → race → scenes →
 * next chapter. Owns the story save end to end; the championship save and the wallet's paid-race ledger
 * are the only things it shares with the rest of the game.
 */
export default function StoryMode({ driver, account, onAccount, onShop, onExit }: StoryModeProps) {
  const [state, setState] = useState<StoryState>(() => loadStory() ?? newStory(runSeed(driver), driver, Date.now()));
  const stateRef = useRef(state);
  const accountRef = useRef(account);
  accountRef.current = account;
  /** The untouched save while a chapter-select replay is running. */
  const baseRef = useRef<StoryState | null>(null);
  const handleRef = useRef<StoryHookHandle | null>(null);
  const settlementRef = useRef<HeatSettlement | null>(null);
  const heatRef = useRef(1);

  const [stage, setStage] = useState<Stage>({ kind: 'hub' });
  const [playing, setPlaying] = useState<Playback | null>(null);
  const [setup, setSetup] = useState<RaceSetup | null>(null);
  const [payout, setPayout] = useState<RacePayout | null>(null);
  const [notice, setNotice] = useState<StoryNotice | null>(null);
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

  const chapter = stage.kind === 'hub' ? state.chapter : stage.chapter;
  const def = chapterDef(chapter);
  const roster = useMemo(() => storyRoster(state.driver), [state.driver]);
  const beats = useMemo(() => storyBeats(chapter, state.flags), [chapter, state.flags]);
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
      case 'hub':
      case 'card':
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
          : { kind: 'hub' });
        return;
      case 'complete':
        setStage(next);
        return;
    }
  }

  const beginChapter = (forChapter: ChapterNumber, replay: boolean) => {
    setNotice(null);
    if (!replay && !chapterUnlocked(stateRef.current, forChapter)) return;
    const next = mutate((previous) => {
      if (replay) {
        baseRef.current = previous;
        return startReplay(previous, forChapter);
      }
      baseRef.current = null;
      return { ...previous, chapter: forChapter, replaying: false };
    });
    heatRef.current = (replay ? 0 : (next.season.results[forChapter - 1]?.length ?? 0)) + 1;
    run({ kind: 'card', chapter: forChapter });
  };

  const leaveToHub = () => {
    if (stateRef.current.replaying && baseRef.current) {
      stateRef.current = baseRef.current;
      setState(baseRef.current);
    }
    baseRef.current = null;
    handleRef.current = null;
    settlementRef.current = null;
    setSetup(null);
    setPayout(null);
    setPlaying(null);
    setStage({ kind: 'hub' });
  };

  const restart = () => {
    clearStory();
    const fresh = newStory(runSeed(driver), driver, Date.now());
    stateRef.current = fresh;
    baseRef.current = null;
    setState(fresh);
    setNotice(null);
    setPlaying(null);
    setSetup(null);
    setStage({ kind: 'hub' });
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
    const paid = settleRace(accountRef.current, raceId, settlement.player);
    accountRef.current = paid.account;
    onAccount(paid.account);
    setPayout(paid.payout);
  };

  const continueAfterRace = () => {
    const settlement = settlementRef.current;
    setPayout(null);
    if (!settlement) { leaveToHub(); return; }
    const raced = settlement.chapterRaced as ChapterNumber;
    if (!settlement.chapterDone && heatRef.current < HEATS_PER_GP) {
      run({ kind: 'pre', chapter: raced, heat: heatRef.current + 1 });
      return;
    }
    run({ kind: 'outro', chapter: raced, settlement });
  };

  const afterComplete = (forChapter: ChapterNumber, last: boolean, paid: ChapterPayout) => {
    const replay = stateRef.current.replaying;
    setNotice({
      chapter: forChapter, credits: paid.credits, perfect: paid.perfect,
      unlock: paid.unlock, unlocked: paid.unlocked, replay,
    });
    if (last || replay) { leaveToHub(); return; }
    const next = Math.min(6, forChapter + 1) as ChapterNumber;
    if (!chapterUnlocked(stateRef.current, next)) { leaveToHub(); return; }
    beginChapter(next, false);
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

  switch (stage.kind) {
    case 'hub':
      return <StoryHub
        state={state}
        account={account}
        notice={notice}
        onPlay={beginChapter}
        onRestart={restart}
        onShop={onShop}
        onExit={onExit}
      />;

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
        profile={setup?.profile ?? storyProfile(stage.chapter)}
        gridOrder={setup?.grid ?? gridOrder(state.season)}
        title={gp.name}
        subtitle={`STORY · CHAPTER ${String(stage.chapter).padStart(2, '0')} / HEAT ${stage.heat} OF ${HEATS_PER_GP}`}
        championship
        onExit={leaveToHub}
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
