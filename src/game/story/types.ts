/**
 * Story mode — "Down We Go" (epic #22). Every story type lives here, plus the pure helpers that need
 * nothing but type data.
 *
 * Node-safe on purpose: all imports below are `import type`, so `tests/story-*.test.ts` can import this
 * module (and everything that only needs types) without Vite's `import.meta.glob` or the RUN SDK.
 * Values that need those live with their owners: art names in `assets.ts`, the cast in `cast.ts`,
 * the save record in `state.ts`.
 */
import type { StoryBackground, StoryCharacter, StoryEnding, StoryProp } from './assets';
import type { CastId } from './cast';
import type { Game, Marble } from '../engine';

/** Chapters are 1..6 and map to `CALENDAR[chapter - 1]` (see `ChapterDef.gp`). */
export type ChapterNumber = 1 | 2 | 3 | 4 | 5 | 6;
export const CHAPTER_COUNT = 6;

/** When a scene may play. `post-*` scenes are picked by the chapter's outcome; `outro` plays whatever it was. */
export type Trigger = 'intro' | 'pre-race' | 'mid-race' | 'post-win' | 'post-podium' | 'post-loss' | 'outro';
export const TRIGGERS: readonly Trigger[] = ['intro', 'pre-race', 'mid-race', 'post-win', 'post-podium', 'post-loss', 'outro'];
/** Triggers whose scenes are selected by a heat/chapter result. */
export const OUTCOME_TRIGGERS: readonly Trigger[] = ['post-win', 'post-podium', 'post-loss'];

/** Sprocket's marble is always id 0, in story mode as everywhere else. */
export const PLAYER_MARBLE_ID = 0;

/** Lines are short on purpose: the dialogue box shows one at a time, phone portrait included. */
export const MAX_LINE_LENGTH = 90;

/** How a race (or a whole chapter) went for the player. */
export type StoryOutcome = 'win' | 'podium' | 'loss';

/** Win = P1, podium = P2–3, loss = everything else including a DNF (`rank === null`). */
export function outcomeForRank(rank: number | null): StoryOutcome {
  if (rank === 1) return 'win';
  if (rank === 2 || rank === 3) return 'podium';
  return 'loss';
}

export function triggerForOutcome(outcome: StoryOutcome): Trigger {
  return outcome === 'win' ? 'post-win' : outcome === 'podium' ? 'post-podium' : 'post-loss';
}

// ───────────────────────────── flags ─────────────────────────────

/**
 * Every story flag. Flags are the whole branching model: scenes gate on them, choices set them, and the
 * epilogues read them. The story bible (what each one changes) is in the epic PR description.
 */
export type StoryFlag =
  // Act I — The Rookie
  | 'beatAceEarly'    // ch1 bonus: finished a heat ahead of Ace Spadegrin
  | 'metSmokey'       // ch2: Old Smokey agreed to teach you
  | 'streetSmart'     // ch2 bonus: hit 10 orange pegs in one heat
  | 'hoodSeen'        // ch2: The Hood showed up and said almost nothing
  // Act II — The Rise and the Fall
  | 'trainingDone'    // ch3: crate, loop and hoops all cleared
  | 'acceptedVexDeal' // ch4 choice: signed Duchess Vex's contract
  | 'refusedVex'      // ch4 choice: walked out of the gilded office
  | 'trustedZapp'     // ch4 choice: believed Zapp had nothing to do with the sabotage
  | 'blamedZapp'      // ch4 choice: accused Zapp
  | 'sabotaged'       // ch4: the scripted malfunction actually fired in a heat
  | 'midpointCrash'   // ch4: the crash and the DNF — the midpoint loss
  | 'smokeyInjured'   // ch4: Smokey was hurt pulling you out of the wreck
  // Act III — Down We Go
  | 'hoodRevealed'    // ch5: The Hood's face — Apex's missing star
  | 'vexPlan'         // ch5: you know Vex is rigging the finale down the mine
  | 'aceAlly'         // ch5 choice: reluctant alliance with Ace
  | 'vexExposed'      // ch6 bonus: beat Vex in the finale, in front of everyone
  | 'hoodRedeemed'    // ch6: The Hood stood down / was pulled out of the mine
  | 'smokeyProud';    // epilogue: the mentor moment landed
export const STORY_FLAGS: readonly StoryFlag[] = [
  'beatAceEarly', 'metSmokey', 'streetSmart', 'hoodSeen',
  'trainingDone', 'acceptedVexDeal', 'refusedVex', 'trustedZapp', 'blamedZapp', 'sabotaged', 'midpointCrash', 'smokeyInjured',
  'hoodRevealed', 'vexPlan', 'aceAlly', 'vexExposed', 'hoodRedeemed', 'smokeyProud',
];

/** A flag test on a scene or a choice option: one flag, an AND list, or an OR list. */
export type FlagCondition =
  | { flag: StoryFlag; not?: true }
  | { all: readonly FlagCondition[] }
  | { any: readonly FlagCondition[] };

export type FlagMap = Record<StoryFlag, boolean>;

export function emptyFlags(): FlagMap {
  return STORY_FLAGS.reduce((all, flag) => ({ ...all, [flag]: false }), {} as FlagMap);
}

/** Pure flag test. `undefined` always passes. */
export function flagsMatch(condition: FlagCondition | undefined, flags: FlagMap): boolean {
  if (!condition) return true;
  if ('all' in condition) return condition.all.every((inner) => flagsMatch(inner, flags));
  if ('any' in condition) return condition.any.some((inner) => flagsMatch(inner, flags));
  return condition.not ? !flags[condition.flag] : !!flags[condition.flag];
}

// ───────────────────────────── script ─────────────────────────────

export interface Line {
  who: CastId;
  /** Portrait mood: a `STORY_PORTRAITS` mood for story art, `angry|happy|surprised` for race rivals. */
  mood: string;
  text: string;
  /** Optional prop that pops up over the scene while this line is on screen. */
  prop?: StoryProp;
}

export interface ChoiceOption {
  label: string;
  set: StoryFlag;
  /** Set the flag to false instead of true (used for "no" answers that must be recorded). */
  value?: boolean;
  when?: FlagCondition;
}

export interface SceneChoice {
  prompt: string;
  options: readonly ChoiceOption[];
}

export interface Scene {
  /** `c<chapter>-<slug>`; the schema test checks the prefix matches `chapter`. */
  id: string;
  chapter: ChapterNumber;
  trigger: Trigger;
  background: StoryBackground;
  /** Play only when the flags match. */
  when?: FlagCondition;
  /** Restrict to one result. Required to be consistent with a `post-*` trigger. */
  outcome?: StoryOutcome;
  /** Sector this mid-race beat fires at (`trigger: 'mid-race'` only). */
  atSector?: number;
  lines: readonly Line[];
  choice?: SceneChoice;
  /** Flags set when the scene has been played through (e.g. the reveal sets `hoodRevealed`). */
  sets?: readonly StoryFlag[];
  /** Belongs to one ending; skipped when the story's ending is a different one. */
  ending?: EndingId;
  /** Play the reveal sting instead of the per-line blip (ST-03). */
  sting?: boolean;
}

// ───────────────────────────── objectives ─────────────────────────────

/** Race events the engine's story hooks count (ST-07). */
export type RaceCounter = 'orangePegs' | 'crates' | 'hoops' | 'loops' | 'buckets' | 'pads' | 'itemBoxes' | 'overtakes';
export const RACE_COUNTERS: readonly RaceCounter[] = ['orangePegs', 'crates', 'hoops', 'loops', 'buckets', 'pads', 'itemBoxes', 'overtakes'];

/**
 * Live counters for one heat, filled from the engine hook points and settled at the chequered flag.
 * Rivals are keyed by marble id — the story grid is fixed (`STORY_GRID`), so an id always maps back to one
 * cast member through `CAST[...].gridId`.
 */
export interface RaceCounters {
  orangePegs: number;
  crates: number;
  hoops: number;
  loops: number;
  buckets: number;
  pads: number;
  itemBoxes: number;
  /** Times the player passed a rival. */
  overtakes: Record<number, number>;
  /** Finishing position of every marble (filled in after the heat). */
  rivalRanks: Record<number, number>;
  /** Ids of the scripted story events that fired this heat (ST-07). */
  eventsFired: string[];
  /** Highest sector the player reached, for the HUD. */
  sectors: number;
}

export function emptyRaceCounters(): RaceCounters {
  return {
    orangePegs: 0, crates: 0, hoops: 0, loops: 0, buckets: 0, pads: 0, itemBoxes: 0,
    overtakes: {}, rivalRanks: {}, eventsFired: [], sectors: 0,
  };
}

export interface ObjectiveDef {
  id: string;
  /** Chip text in the race HUD, e.g. "Hit 10 orange pegs". */
  label: string;
  /**
   * `finish` — complete a heat (not a DNF); `rank` — finish at or better than `rank`;
   * `counter` — a race counter reaches `target`; `ahead` — finish ahead of `rival`.
   */
  kind: 'finish' | 'rank' | 'counter' | 'ahead';
  rank?: number;
  counter?: RaceCounter;
  target?: number;
  /** `ahead`, and `counter: 'overtakes'` restricted to one rival. */
  rival?: CastId;
  /** Cumulative over the chapter's three heats, or one heat only. Default `heat`. */
  scope?: 'heat' | 'chapter';
  /** Bonus objectives never gate a chapter; they only set a flag and pick scene variants. */
  bonus?: boolean;
  /** Flag set the first time the objective is met. */
  flag?: StoryFlag;
}

export interface ObjectiveOutcome {
  id: string;
  label: string;
  bonus: boolean;
  met: boolean;
  progress: number;
  target: number;
  flag?: StoryFlag;
}

// ───────────────────────────── chapters ─────────────────────────────

/** A scripted event fired at a sector (ST-07): sabotage, a slick, a shake. */
export interface StoryEvent {
  id: string;
  kind: 'sabotage' | 'slick' | 'shake';
  atSector: number;
  /** Toast shown to the player when it fires. */
  message?: string;
  /** Set once, on the first heat it fires in. */
  flag?: StoryFlag;
  /** Only fire in heats 1..3 matching this list. Default: every heat. */
  heats?: readonly number[];
  power?: number;
}

/** Rival AI targeting (ST-07): who a named rival's items prefer. */
export interface AiDirective {
  who: CastId;
  /** `player`, or another cast member by id. */
  target: 'player' | CastId;
  /** Gate on flags, e.g. with `aceAlly` Ace goes after Vex's team instead of you. */
  when?: FlagCondition;
}

export interface StoryBeat {
  atSector: number;
  line: Line;
}

export interface ChapterDef {
  chapter: ChapterNumber;
  act: 1 | 2 | 3;
  /** Index into `CALENDAR` — chapter N is Grand Prix N-1. */
  gp: number;
  /** Matches the chapter plaque art. */
  title: string;
  objectives: readonly ObjectiveDef[];
  /** Set when every non-bonus objective of the chapter has been met. */
  completeFlag?: StoryFlag;
  /** Extra track weights merged into the Grand Prix profile (ST-07). No new pieces, only weights. */
  weights?: Record<string, number>;
  events?: readonly StoryEvent[];
  ai?: readonly AiDirective[];
  /** Mid-race lines, in sector order (ST-03 renders them as bubbles). */
  beats?: readonly StoryBeat[];
}

// ───────────────────────────── endings ─────────────────────────────

export type EndingId = 'champion' | 'bittersweet' | 'heartbreak';
export const ENDINGS: readonly EndingId[] = ['champion', 'bittersweet', 'heartbreak'];

/** Ending → the art in `src/assets/story/endings/` (values only; no image is imported here). */
export const ENDING_ART: Record<EndingId, StoryEnding> = {
  champion: 'champion-ending',
  bittersweet: 'bittersweet-ending',
  heartbreak: 'heartbreak-ending',
};

/** The final championship position decides the ending: P1, P2–3, everything else. */
export function endingForPosition(position: number): EndingId {
  return position <= 1 ? 'champion' : position <= 3 ? 'bittersweet' : 'heartbreak';
}

export const ENDING_TITLE: Record<EndingId, string> = {
  champion: 'WORLD CHAMPION',
  bittersweet: 'ON THE PODIUM',
  heartbreak: 'DOWN WE GO',
};

// ───────────────────────────── race hooks (ST-07) ─────────────────────────────

export interface StoryCounterEvent {
  counter: RaceCounter;
  /** Marble id the event happened to. */
  marbleId: number;
  player: boolean;
  sectorIndex: number;
  /** For `overtakes`: the marble id that was passed. */
  rivalId?: number;
}

/**
 * Optional story hooks handed to `new Game(...)`. With `story` unset the engine behaves exactly as before;
 * every field is optional and everything must stay deterministic from the chapter seed (never `game.rng()`
 * inside a hook — use your own `mulberry32`).
 */
export interface StoryHooks {
  /** Merged into `TrackProfile.weights` before the track is generated. */
  weights?: Record<string, number>;
  /** Fired once per marble when it enters a new sector. */
  onSector?: (game: Game, marble: Marble, sectorIndex: number) => void;
  /** Preferred item target for a marble; `null` keeps the engine's default choice. */
  aiTarget?: (game: Game, marble: Marble) => number | null;
  /** Fired where the engine already plays a sound: crate, orange peg, hoop, loop, bucket, pad, item box, overtake. */
  onCounter?: (event: StoryCounterEvent) => void;
}

/** Character ids that have painted story portraits (the rest speak with their race portrait). */
export type StoryPortraitCharacter = StoryCharacter;
