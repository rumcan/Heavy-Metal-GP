// P2-22: how big the Workshop's world is. A classic circuit is the 900-unit pipe, built downwards. A platformer course
// is built sideways and down: it runs `width` units to the right. Every editor module that used to clamp to the pipe
// (W) asks this instead, so one editor serves both. `TrackEditor` sets it while it renders and clears it on unmount.
import { W } from '../../game/track';

export interface EditorWorld {
  /** True while a platformer course is being edited (built sideways and down). */
  side: boolean;
  /** How far right a piece may stand: the pipe's width, or the course's length. */
  width: number;
}

const CLASSIC: EditorWorld = { side: false, width: W };
let current: EditorWorld = CLASSIC;

export const editorWorld = (): EditorWorld => current;
export const worldWidth = (): number => current.width;
export const isSideWorld = (): boolean => current.side;

/** Sets the world for the current def, or back to the classic pipe with `null`. */
export function setEditorWorld(next: { width: number } | null): void {
  current = next ? { side: true, width: next.width } : CLASSIC;
}
