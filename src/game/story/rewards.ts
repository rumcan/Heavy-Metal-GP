/**
 * Chapter rewards (ST-08). Credits are the economy's currency and go through the racer account; the
 * cosmetic unlock is a flag on the STORY save, never on `mrr-account-v1`, so the two modes cannot
 * contaminate each other. Everything here is pure — `StoryMode` publishes the results.
 */
import type { RacerAccount } from '../economy';
import type { StoryState } from './state';
import type { ChapterNumber, ObjectiveOutcome } from './types';
import { chapterDef } from './outline';

export type UnlockKind = 'portrait' | 'livery';

export interface StoryUnlock {
  /** Stored in `StoryState.unlocks`; also the paid-marker, so a reward is never paid twice. */
  id: string;
  kind: UnlockKind;
  label: string;
  detail: string;
}

export interface ChapterRewardDef {
  chapter: ChapterNumber;
  /** Paid when the chapter's three heats are in. */
  credits: number;
  /** Extra credits when every objective, bonus ones included, has been met. */
  perfect: number;
  unlock: StoryUnlock;
}

export const CHAPTER_REWARDS: Readonly<Record<ChapterNumber, ChapterRewardDef>> = {
  1: {
    chapter: 1, credits: 250, perfect: 150,
    unlock: { id: 'livery:scrapyard-primer', kind: 'livery', label: 'Scrapyard Primer', detail: 'Lead red over hammer marks. Sprocket mixed it themselves.' },
  },
  2: {
    chapter: 2, credits: 350, perfect: 200,
    unlock: { id: 'portrait:street-smart', kind: 'portrait', label: 'Street Smart', detail: 'The grin of a goblin who has learned which pegs pay.' },
  },
  3: {
    chapter: 3, credits: 450, perfect: 250,
    unlock: { id: 'livery:smokey-orange', kind: 'livery', label: "Smokey's Orange", detail: 'Old Smokey’s own race colours, handed over after the training montage.' },
  },
  4: {
    chapter: 4, credits: 600, perfect: 300,
    unlock: { id: 'portrait:signed-contract', kind: 'portrait', label: 'Signed In Iron', detail: 'Whatever you chose at Spa, somebody wrote it down.' },
  },
  5: {
    chapter: 5, credits: 800, perfect: 400,
    unlock: { id: 'livery:hood-black', kind: 'livery', label: 'Hood Black', detail: 'Matte black with a folded cowl. Nobody asks where it came from.' },
  },
  6: {
    chapter: 6, credits: 1500, perfect: 750,
    unlock: { id: 'portrait:down-we-go', kind: 'portrait', label: 'Down We Go', detail: 'The face you wore in the mine, framed for the garage wall.' },
  },
};

export function rewardForChapter(chapter: number): ChapterRewardDef {
  return CHAPTER_REWARDS[(Math.min(6, Math.max(1, chapter)) as ChapterNumber)];
}

/** True once this chapter's reward has been banked on the story save. */
export function rewardEarned(state: StoryState, chapter: number): boolean {
  return state.unlocks.includes(rewardForChapter(chapter).unlock.id);
}

/** Credits for finishing the chapter, plus the perfect bonus when every objective was met. */
export function rewardCredits(chapter: number, objectives: readonly ObjectiveOutcome[]): { credits: number; perfect: boolean } {
  const def = chapterDef(chapter);
  const reward = rewardForChapter(chapter);
  const perfect = def.objectives.every((objective) => objectives.find((result) => result.id === objective.id)?.met === true);
  return { credits: reward.credits + (perfect ? reward.perfect : 0), perfect };
}

export interface ChapterPayout {
  state: StoryState;
  account: RacerAccount;
  /** 0 when the reward was already banked (or this is a chapter-select replay). */
  credits: number;
  perfect: boolean;
  unlock: StoryUnlock;
  /** The unlock is new: show it on the chapter card. */
  unlocked: boolean;
}

/**
 * Bank one chapter: credits onto the racer account, the unlock onto the story save. Replays pass
 * `pay: false` so re-racing a finished chapter cannot farm credits or duplicate an unlock.
 */
export function applyChapterReward(
  state: StoryState,
  account: RacerAccount,
  chapter: number,
  objectives: readonly ObjectiveOutcome[],
  pay = true,
): ChapterPayout {
  const reward = rewardForChapter(chapter);
  const { credits, perfect } = rewardCredits(chapter, objectives);
  const already = rewardEarned(state, chapter);
  if (!pay || already) {
    return { state, account, credits: 0, perfect, unlock: reward.unlock, unlocked: false };
  }
  const nextAccount: RacerAccount = {
    ...account,
    credits: account.credits + credits,
    totalWinnings: account.totalWinnings + credits,
  };
  const nextState: StoryState = { ...state, unlocks: [...state.unlocks, reward.unlock.id] };
  return { state: nextState, account: nextAccount, credits, perfect, unlock: reward.unlock, unlocked: true };
}

/** Every unlock the story has banked so far, in chapter order — for the hub's trophy shelf. */
export function earnedUnlocks(state: StoryState): StoryUnlock[] {
  return [1, 2, 3, 4, 5, 6]
    .map((chapter) => rewardForChapter(chapter).unlock)
    .filter((unlock) => state.unlocks.includes(unlock.id));
}
