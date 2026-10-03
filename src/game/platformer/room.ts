// P2-22: a Workshop platformer course in an online room. The host puts the course's `pf1-` code in the room's race
// settings (`platformerCode`, with `platformer: 'my-room'`); the host and every guest decode it (full validation) and
// register it under the one key `room`, so the race builds the same course from the same def on every screen.
import { registerPlatformerDef } from './def';
import type { PlatformerDef } from './def';
import { decodePlatformerCode } from './share';

/** The course id (without the `platformer:` prefix) a room's custom course races under. */
export const ROOM_COURSE_ID = 'my-room';
export const ROOM_COURSE_KEY = 'room';

let last: { code: string; def: PlatformerDef } | null = null;

/** Decode a room's course code and register it. Repeated calls with the same code are free. Throws on a bad code. */
export async function registerRoomCourse(code: string): Promise<PlatformerDef> {
  if (last && last.code === code) { registerPlatformerDef(ROOM_COURSE_KEY, last.def); return last.def; }
  const def = await decodePlatformerCode(code);
  registerPlatformerDef(ROOM_COURSE_KEY, def);
  last = { code, def };
  return def;
}
