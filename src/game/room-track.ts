// P2-11: a track for an online room. Whatever the host picks (My tracks, My courses, a Community track) rides in the
// lobby settings as a share code, and every machine decodes the same def from it. A code that would not fit the
// protocol's limit is refused here, with a sentence the host can act on, instead of being dropped by the wire.
import { MAX_CUSTOM_CODE_CHARS } from '../net/protocol';
import { encodeShareCode } from './sharecode';
import type { TrackDef } from './trackdef';

export type RoomCode = { ok: true; code: string } | { ok: false; reason: string };

/** Pure half: does an encoded code fit a room? */
export function checkRoomCode(code: string, name: string): RoomCode {
  if (code.length > MAX_CUSTOM_CODE_CHARS) {
    return { ok: false, reason: `"${name}" is too big to race online (${Math.round(code.length / 1000)}k of ${MAX_CUSTOM_CODE_CHARS / 1000}k characters). Remove some pieces in the Workshop and try again.` };
  }
  return { ok: true, code };
}

export async function roomCodeFor(def: TrackDef): Promise<RoomCode> {
  try {
    return checkRoomCode(await encodeShareCode(def), def.name);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : `Could not share "${def.name}".` };
  }
}
