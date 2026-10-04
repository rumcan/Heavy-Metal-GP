import type { ReactNode } from 'react';
import { Sparkles, Trophy } from 'lucide-react';
import { CHAPTERS, chapterDef } from '../../game/story/outline';
import { chapterTitle, chaptersForAct } from '../../game/story/engine';
import {
  activeFlags, chapterObjectives, chapterUnlocked, chaptersCleared, storyGrandPrix, storyPosition,
} from '../../game/story/state';
import type { StoryState } from '../../game/story/state';
import { earnedUnlocks, rewardEarned, rewardForChapter } from '../../game/story/rewards';
import type { StoryUnlock } from '../../game/story/rewards';
import { chapterCleared as isCleared, storyPrimary } from '../../game/story/opening';
import type { StoryPick } from '../../game/story/opening';
import { CAST, STORY_GRID } from '../../game/story/cast';
import { castPortrait } from '../../game/story/portraits';
import { ENDING_TITLE } from '../../game/story/types';
import type { ChapterNumber } from '../../game/story/types';
import { HEATS_PER_GP } from '../../game/types';
import { ChapterTile } from './ChapterCard';
import '../../story.css';

/** One line per flag, for the "your story so far" pane. Written here so the script stays script. */
export const FLAG_LABELS: Record<string, string> = {
  beatAceEarly: 'Beat Ace at Marblehurst',
  metSmokey: 'Met Old Smokey',
  streetSmart: 'Learned the peg lines',
  hoodSeen: 'The Hood noticed you',
  trainingDone: "Survived Smokey's training",
  acceptedVexDeal: "Took Vex's deal",
  refusedVex: "Refused Vex's deal",
  trustedZapp: 'Believed Zapp',
  blamedZapp: 'Blamed Zapp',
  sabotaged: 'Sabotaged at Spa',
  midpointCrash: 'Cracked your marble',
  smokeyInjured: 'Smokey got hurt',
  hoodRevealed: "Learned The Hood's face",
  vexPlan: "Knows Vex's plan",
  aceAlly: 'Ace is on your side',
  vexExposed: 'Exposed Vex',
  hoodRedeemed: 'The Hood came back',
  smokeyProud: 'Smokey is proud of you',
};

/** Banner shown after a chapter is banked. */
export interface StoryNotice {
  chapter: number;
  credits: number;
  perfect: boolean;
  unlock: StoryUnlock;
  unlocked: boolean;
  replay: boolean;
}

export interface StoryHubProps {
  state: StoryState;
  /** Banner for a chapter just finished. */
  notice?: StoryNotice | null;
  /** A chapter card was picked: story mode starts that chapter straight away. */
  onPlay: (pick: StoryPick) => void;
  /** The garage, drawn between the chapters and the dossier. */
  children?: ReactNode;
}

/** The home screen's one big Story button: what it reads and starts (src/game/story/opening.ts). */
export { storyPrimary };


/**
 * The story hub (ST-08), on the home screen's Story tab (P2-04): the six chapters, the story so far, and the cast.
 * This is the ONE chapter list: picking a card starts that chapter (story mode has no list of its own). Cleared
 * chapters can be replayed; a replay never writes to the save. The home owns the one big button and the pane switcher.
 */
export default function StoryHub({ state, notice, onPlay, children }: StoryHubProps) {
  const position = storyPosition(state);
  const cleared = chaptersCleared(state);
  const flags = activeFlags(state);
  const unlocks = earnedUnlocks(state);
  const finished = state.season.complete;
  const ending = state.ending;
  const { chapter: nextChapter } = storyPrimary(state);

  return <div className="story-embedded">
    <main className="story-embedded-main">
      <div className="fit-pane story-chapters-pane" data-pane-id="chapters">
        <div className="section-topline">
          <span className="eyebrow"><Sparkles size={14} /> DOWN WE GO · {cleared} OF 6 CHAPTERS</span>
          <span className="local-save">{finished && ending ? ENDING_TITLE[ending].toUpperCase() : position ? `CHAMPIONSHIP P${position}` : 'A NEW STORY'}</span>
        </div>
        <div className="story-intro">
          <h1>{finished ? 'THE STORY YOU RACED' : 'SIX CHAPTERS. ONE MINE.'}</h1>
          <p>A scrapyard goblin with a homemade marble, a mentor with one lap left, and a Duchess who buys
            everything. Every chapter is a Grand Prix of three heats — objectives steer the script, they never fail it.</p>
        </div>

        {notice && <div className="story-notice" role="status">
          <Trophy size={16} />
          <div>
            <strong>
              Chapter {notice.chapter} · {notice.replay ? 'replay finished, no payout' : notice.credits ? `+${notice.credits.toLocaleString()} CR${notice.perfect ? ' (perfect)' : ''}` : 'already banked'}
            </strong>
            <span>{notice.unlocked
              ? `${notice.unlock.kind} unlocked — ${notice.unlock.label}: ${notice.unlock.detail}`
              : `${notice.unlock.label} is on the shelf`}</span>
          </div>
        </div>}

        <div className="story-tiles">
          {CHAPTERS.map((def) => {
            const gp = storyGrandPrix(def.chapter);
            const unlocked = chapterUnlocked(state, def.chapter);
            const done = isCleared(state, def.chapter);
            const heats = state.season.results[def.chapter - 1]?.length ?? 0;
            const reward = rewardForChapter(def.chapter);
            const earned = rewardEarned(state, def.chapter);
            const replay = done && unlocked;
            const isNext = !finished && def.chapter === nextChapter;
            const status = !unlocked ? 'Locked'
              : done ? (earned ? 'Complete · reward banked' : 'Complete')
                : heats > 0 ? `Heat ${heats + 1} of ${HEATS_PER_GP}`
                  : isNext ? null : 'Ready';
            return <ChapterTile
              key={def.chapter}
              chapter={def.chapter}
              title={chapterTitle(def.chapter)}
              act={def.act}
              circuit={`${gp.name} · ${gp.location}`}
              status={status}
              statusKind={!unlocked ? 'locked' : done ? 'done' : isNext ? 'live' : undefined}
              // each objective carries its own tick here (the dossier used to list the chapters a second time for it)
              objectives={def.objectives.map((objective) => {
                const met = chapterObjectives(state, def.chapter).find((r) => r.id === objective.id)?.met;
                return `${met ? '✓' : objective.bonus ? '★' : '◎'} ${objective.label}`;
              })}
              reward={{ credits: reward.credits + (earned ? 0 : reward.perfect), label: earned ? reward.unlock.label : `${reward.unlock.kind}: ${reward.unlock.label}` }}
              locked={!unlocked}
              current={isNext}
              onSelect={() => onPlay({ chapter: def.chapter as ChapterNumber, replay })}
            />;
          })}
        </div>
      </div>

      {children}

      <div className="fit-pane story-dossier-pane" data-pane-id="dossier">
        <section className="story-dossier">
          <div className="section-topline"><h2>YOUR STORY SO FAR</h2><span className="eyebrow">{flags.length} TURNS</span></div>
          {flags.length
            ? <ul className="story-flag-list">{flags.map((flag) => <li key={flag}>{FLAG_LABELS[flag] ?? flag}</li>)}</ul>
            : <p className="story-empty">Nothing decided yet. Chapter 1 is waiting at Marblehurst.</p>}
        </section>


        <section className="story-dossier">
          <div className="section-topline"><h2>THE SHELF</h2><span className="eyebrow">{unlocks.length} OF 6</span></div>
          {unlocks.length
            ? <ul className="story-unlock-list">{unlocks.map((unlock) => <li key={unlock.id}>
              <span className={`story-unlock-kind is-${unlock.kind}`}>{unlock.kind}</span>
              <div><strong>{unlock.label}</strong><span>{unlock.detail}</span></div>
            </li>)}</ul>
            : <p className="story-empty">Finish a chapter to bank its reward.</p>}
        </section>

        <section className="story-dossier">
          <div className="section-topline"><h2>THE CAST</h2><span className="eyebrow">{STORY_GRID.length} ON THE GRID</span></div>
          <ul className="story-cast-list">
            {STORY_GRID.filter((id) => id !== 'hood-revealed').map((id) => {
              const cast = CAST[id];
              return <li key={id}>
                <span className="kit-portrait ring-steel story-cast-portrait"><img src={castPortrait(id, cast.defaultMood)} alt={cast.name} draggable={false} /></span>
                <div><strong>{cast.name}</strong><span>{cast.role} — {cast.arc}</span></div>
              </li>;
            })}
          </ul>
        </section>
      </div>
    </main>
  </div>;
}

/** Which chapters an act banner should slam in for. */
export function actStarts(chapter: ChapterNumber): 1 | 2 | 3 | undefined {
  const act = chapterDef(chapter).act;
  return chaptersForAct(act)[0]?.chapter === chapter ? act : undefined;
}
