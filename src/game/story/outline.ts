/**
 * The story outline (ST-01): the six chapters and every scene id, in the order they are offered.
 *
 * Content lives in the act files (`script/act1..3.ts`); this module only assembles and indexes it, so
 * `nextScenes()` in `engine.ts` can walk a chapter trigger by trigger. Scene order inside a chapter and
 * trigger is the array order of the act file — that IS the outline order.
 */
import { ACT1_CHAPTERS, ACT1_SCENES } from './script/act1';
import { ACT2_CHAPTERS, ACT2_SCENES } from './script/act2';
import { ACT3_CHAPTERS, ACT3_SCENES } from './script/act3';
import { CHAPTER_COUNT, TRIGGERS } from './types';
import type { ChapterDef, ChapterNumber, Scene, Trigger } from './types';

export const CHAPTERS: readonly ChapterDef[] = [...ACT1_CHAPTERS, ...ACT2_CHAPTERS, ...ACT3_CHAPTERS];

export const SCENES: readonly Scene[] = [...ACT1_SCENES, ...ACT2_SCENES, ...ACT3_SCENES];

export const SCENE_BY_ID: Readonly<Record<string, Scene>> = SCENES.reduce<Record<string, Scene>>((all, scene) => {
  all[scene.id] = scene;
  return all;
}, {});

/** Scene ids per chapter and trigger, in outline order. */
export const OUTLINE: Readonly<Record<ChapterNumber, Readonly<Record<Trigger, readonly string[]>>>> = (() => {
  const emptyTriggers = (): Record<Trigger, string[]> =>
    TRIGGERS.reduce((all, trigger) => ({ ...all, [trigger]: [] }), {} as Record<Trigger, string[]>);
  const outline = {} as Record<ChapterNumber, Record<Trigger, string[]>>;
  for (let chapter = 1; chapter <= CHAPTER_COUNT; chapter++) outline[chapter as ChapterNumber] = emptyTriggers();
  for (const scene of SCENES) outline[scene.chapter][scene.trigger].push(scene.id);
  return outline;
})();

export function chapterDef(chapter: number): ChapterDef {
  const found = CHAPTERS.find((entry) => entry.chapter === chapter);
  if (!found) throw new Error(`No story chapter ${chapter}.`);
  return found;
}

export function chapterAct(chapter: ChapterNumber): 1 | 2 | 3 {
  return chapterDef(chapter).act;
}

export function sceneById(id: string): Scene | undefined {
  return SCENE_BY_ID[id];
}

/** Scene ids offered for one chapter and trigger, in outline order. */
export function chapterSceneIds(chapter: number, trigger: Trigger): readonly string[] {
  const byChapter = OUTLINE[chapter as ChapterNumber];
  return byChapter?.[trigger] ?? [];
}

/** Every scene of a chapter, in outline order (all triggers). */
export function chapterScenes(chapter: number): readonly Scene[] {
  return TRIGGERS.flatMap((trigger) => chapterSceneIds(chapter, trigger).map((id) => SCENE_BY_ID[id]!));
}

/** The scene where the face under the hood appears (ST-01 test: hidden before, revealed after). */
export const REVEAL_SCENE_ID = 'c5-intro-mine';

/** Chapter titles, for the hub and the plaques. */
export const CHAPTER_TITLES: readonly string[] = CHAPTERS.map((entry) => entry.title);
