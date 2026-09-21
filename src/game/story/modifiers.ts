/**
 * Story race hooks (ST-07): turn a `ChapterDef` into the optional `StoryHooks` the engine accepts.
 *
 * Everything here is deterministic from the chapter seed and never touches `game.rng`, so the engine's own
 * random stream — and therefore the simulation — is exactly what it would be without story mode. With no
 * hooks the engine behaves as before; these hooks only add: extra track weights, forced events at a sector,
 * rival item targeting, and counters for the objectives.
 */
import { CAST } from './cast';
import { chapterDef } from './outline';
import { emptyRaceCounters, flagsMatch } from './types';
import type { AiDirective, ChapterDef, FlagMap, RaceCounters, StoryEvent, StoryHooks } from './types';
import { ITEM_TYPES, MARBLE_RADIUS, mulberry32 } from '../types';
import type { MarbleInfo, TrackProfile } from '../types';
import type { Game, Marble } from '../engine';

export interface StoryHookOptions {
  /** Chapter being raced (1..6). */
  chapter: number;
  /** Heat inside the chapter, 1..3. Scripted events can be limited to one heat. */
  heat: number;
  flags: FlagMap;
  /** Chapter seed: every scripted choice derives from it. */
  seed: number;
  /** The story grid, so cast members resolve to marble ids. */
  roster: readonly MarbleInfo[];
  /** Counters to accumulate into. A fresh record is created when omitted. */
  counters?: RaceCounters;
}

export interface StoryHookHandle {
  /** Hand this to `new Game(seed, roster, { story })`. */
  hooks: StoryHooks;
  /** Live counters; read them at the chequered flag and pass them to `settleHeat()`. */
  counters: RaceCounters;
  /** Ids of the scripted events that fired in this heat (the same array as `counters.eventsFired`). */
  eventsFired: string[];
  /** The chapter definition the hooks were built from. */
  chapter: ChapterDef;
}

/** The Grand Prix profile with the chapter's extra hazards merged in (override, so merging twice is safe). */
export function storyWeights(def: ChapterDef): Record<string, number> | undefined {
  return def.weights && Object.keys(def.weights).length ? def.weights : undefined;
}

export function profileWithStory(profile: TrackProfile, def: ChapterDef): TrackProfile {
  const weights = storyWeights(def);
  return { ...profile, generator: 'legacy', weights: weights ? { ...profile.weights, ...weights } : profile.weights };
}

/** Cast id → marble id on the story grid, or null when that cast member is not racing. */
function marbleIdFor(roster: readonly MarbleInfo[], castId: AiDirective['target']): number | null {
  const id = castId === 'player' ? 0 : CAST[castId]?.gridId;
  if (id === undefined) return null;
  return roster.some((marble) => marble.id === id) ? id : null;
}

/** Resolve the chapter's AI directives into a marble-id → target-id map (flags decide who hunts whom). */
export function aiTargets(def: ChapterDef, flags: FlagMap, roster: readonly MarbleInfo[]): Map<number, number> {
  const targets = new Map<number, number>();
  for (const directive of def.ai ?? []) {
    if (!flagsMatch(directive.when, flags)) continue;
    const who = marbleIdFor(roster, directive.who);
    const target = marbleIdFor(roster, directive.target);
    if (who === null || target === null || who === target) continue;
    targets.set(who, target);
  }
  return targets;
}

/** One scripted event, applied through the engine's public API only. */
function fireEvent(game: Game, event: StoryEvent, rng: () => number): void {
  const player = game.player;
  const position = player.body.position;
  switch (event.kind) {
    case 'sabotage': {
      // An item malfunction: one charge is destroyed and a slick appears under the player's own marble.
      const broken = ITEM_TYPES.find((item) => player.inventory[item] > 0);
      if (broken) {
        player.inventory[broken] -= 1;
        game.onInventoryChange?.({ ...player.inventory });
      }
      game.oils.push({ x: position.x, y: position.y + MARBLE_RADIUS, r: 52, ownerId: -1, expiresAt: game.time + 5200 });
      game.shake = Math.max(game.shake, 9);
      game.onEvent?.(event.message ?? 'SABOTAGE! Your item misfires', '#f87171');
      break;
    }
    case 'slick': {
      const drift = (rng() - 0.5) * 220;
      game.oils.push({ x: position.x + drift, y: position.y + 120, r: 56, ownerId: -1, expiresAt: game.time + 7000 });
      game.onEvent?.(event.message ?? 'OIL ON TRACK', '#c084fc');
      break;
    }
    case 'shake': {
      game.shake = Math.max(game.shake, event.power ?? 8);
      game.onEvent?.(event.message ?? 'THE TRACK IS SHAKING', '#fbbf24');
      break;
    }
    default:
      break;
  }
}

/**
 * Build the hooks for one heat of one chapter. Create a fresh handle per heat: the fired-event set and the
 * counters belong to a single race.
 */
export function buildStoryHooks(options: StoryHookOptions): StoryHookHandle {
  const def = chapterDef(options.chapter);
  const counters = options.counters ?? emptyRaceCounters();
  const fired = new Set(counters.eventsFired ?? []);
  const rng = mulberry32((options.seed ^ (options.chapter * 0x9e3779b9) ^ (options.heat * 0x85ebca6b)) >>> 0);
  const targets = aiTargets(def, options.flags, options.roster);
  const events = (def.events ?? []).filter((event) => !event.heats || event.heats.includes(options.heat));

  const hooks: StoryHooks = {
    ...(storyWeights(def) ? { weights: storyWeights(def) } : {}),

    onCounter(event) {
      // Objectives are the player's; rival events are noise here (the HUD reads the player only).
      if (!event.player) return;
      if (event.counter === 'overtakes') {
        if (event.rivalId === undefined) return;
        counters.overtakes[event.rivalId] = (counters.overtakes[event.rivalId] ?? 0) + 1;
        return;
      }
      counters[event.counter] = (counters[event.counter] ?? 0) + 1;
      counters.sectors = Math.max(counters.sectors, event.sectorIndex);
    },

    onSector(game, marble, sectorIndex) {
      if (!marble.info.isPlayer) return;
      counters.sectors = Math.max(counters.sectors, sectorIndex);
      for (const event of events) {
        if (fired.has(event.id) || sectorIndex < event.atSector) continue;
        fired.add(event.id);
        // `counters.eventsFired` is what `settleHeat()` reads to award the event's flag; push in place so the
        // handle's live view of the array stays valid.
        counters.eventsFired.push(event.id);
        fireEvent(game, event, rng);
      }
    },

    aiTarget(game, marble) {
      const target = targets.get(marble.info.id);
      if (target === undefined) return null;
      const rival = game.marbles.find((other) => other.info.id === target);
      // Only aim at a rival who is still racing and roughly in view; otherwise keep the engine's own logic.
      if (!rival || rival.finishedAt !== null) return null;
      if (Math.abs(rival.body.position.y - marble.body.position.y) > 1400) return null;
      return target;
    },
  };

  return { hooks, counters, eventsFired: counters.eventsFired, chapter: def };
}

/**
 * Counters for a heat with no hooks at all: everything zero, and rival ranks filled in by the caller from the
 * classification. Kept here so a race played without story hooks still produces a valid record.
 */
export function emptyStoryCounters(): RaceCounters {
  return emptyRaceCounters();
}

/** Which sector a marble is in, from the track's segment list (the same lookup the race HUD uses). */
export function sectorOf(game: Game, marble: Marble): number {
  const y = marble.body.position.y;
  const segments = game.track.segments;
  for (let index = 0; index < segments.length; index++) {
    if (y >= segments[index].y && y < segments[index].y + segments[index].h) return index;
  }
  return y < (segments[0]?.y ?? 0) ? 0 : Math.max(0, segments.length - 1);
}
