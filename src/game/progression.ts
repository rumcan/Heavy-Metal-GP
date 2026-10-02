// src/game/progression.ts — XP, levels, talent points (pure, no imports)

export const MAX_LEVEL = 30;

export const XP = {
  finish: 50,
  perPlace: 10,
  perPeg: 2,
  perKo: 50,
  personalBest: 25,
  chapterFirst: 300,
  bonusObjective: 100,
};

export const AWARDED_KEEP = 200;

/** round(100 * level^1.4); 0 when level >= MAX_LEVEL */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return Math.round(100 * Math.pow(level, 1.4));
}

/** Sum of xpToNext(l) for l = 1 .. level-1 (level 1 -> 0) */
export function totalXpForLevel(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) {
    sum += xpToNext(l);
  }
  return sum;
}

/**
 * negative xp counts as 0.
 * level = highest level whose total <= xp, capped at MAX_LEVEL.
 * into = xp - totalXpForLevel(level).
 * toNext = xpToNext(level).
 */
export function levelForXp(xp: number): { level: number; into: number; toNext: number } {
  const safe = Math.max(0, xp);
  let lvl = 1;
  for (let l = 2; l <= MAX_LEVEL; l++) {
    if (totalXpForLevel(l) <= safe) {
      lvl = l;
    } else {
      break;
    }
  }
  // Also check if we exceed everything (capped at MAX_LEVEL)
  if (totalXpForLevel(MAX_LEVEL) <= safe) {
    lvl = MAX_LEVEL;
  }
  return {
    level: lvl,
    into: safe - totalXpForLevel(lvl),
    toNext: xpToNext(lvl),
  };
}

export interface RaceXpInput {
  finished: boolean;
  rank: number;
  pegs: number;
  kos: number;
  beatBest: boolean;
}

/**
 * rank is clamped to 1..10.
 * Finished: finish + (11 - rank) * perPlace + (beatBest ? personalBest : 0).
 * Not finished (DNF): none of those.
 * Always add pegs * perPeg + kos * perKo.
 */
export function raceXp(r: RaceXpInput): number {
  const clampedRank = Math.min(10, Math.max(1, r.rank));
  let xp = r.pegs * XP.perPeg + r.kos * XP.perKo;
  if (r.finished) {
    xp += XP.finish + (11 - clampedRank) * XP.perPlace + (r.beatBest ? XP.personalBest : 0);
  }
  return xp;
}

/** (firstTime ? 300 : 0) + 100 * bonusObjectives */
export function chapterXp(firstTime: boolean, bonusObjectives: number): number {
  return (firstTime ? XP.chapterFirst : 0) + XP.bonusObjective * bonusObjectives;
}

export interface ProgressState {
  xp: number;
  level: number;
  talentPoints: number;
  awarded: string[];
}

/** { xp: 0, level: 1, talentPoints: 0, awarded: [] } */
export function newProgress(): ProgressState {
  return { xp: 0, level: 1, talentPoints: 0, awarded: [] };
}

/**
 * Never mutate state. If raceId is already in state.awarded: return the same state and [].
 * Otherwise add the xp, recompute the level, levelsGained = every level gained in order,
 * talentPoints += levelsGained.length, append raceId to awarded keeping only the last AWARDED_KEEP.
 */
export function awardXp(
  state: ProgressState,
  raceId: string,
  xp: number,
): { state: ProgressState; levelsGained: number[] } {
  if (state.awarded.includes(raceId)) {
    return { state, levelsGained: [] };
  }

  const newXp = state.xp + xp;
  const newLevelInfo = levelForXp(newXp);

  const levelsGained: number[] = [];
  for (let l = state.level + 1; l <= newLevelInfo.level; l++) {
    levelsGained.push(l);
  }

  const newAwarded = [...state.awarded, raceId];
  const trimmed =
    newAwarded.length > AWARDED_KEEP
      ? newAwarded.slice(newAwarded.length - AWARDED_KEEP)
      : newAwarded;

  return {
    state: {
      xp: newXp,
      level: newLevelInfo.level,
      talentPoints: state.talentPoints + levelsGained.length,
      awarded: trimmed,
    },
    levelsGained,
  };
}

/** Old players get 50 XP per finish, the matching level and talent points */
export function migrateAccount(finishes: number): ProgressState {
  const xp = 50 * Math.max(0, finishes);
  const info = levelForXp(xp);
  return { xp, level: info.level, talentPoints: info.level - 1, awarded: [] };
}

/** Starters only until the campaign is finished */
export function onlineSkillGate(campaignComplete: boolean): 'starters' | 'unlocked' {
  return campaignComplete ? 'unlocked' : 'starters';
}