// P2-22: platformer share codes: `pf1-` and the def's JSON, deflated, as base64url. The same envelope as a track's
// share code (src/game/sharecode.ts), a different prefix so the two are never confused.
import { base64UrlDecode, base64UrlEncode, deflateBytes, inflateBytes } from '../sharecode';
import { parsePlatformerDef, serializePlatformerDef, validatePlatformerDef } from './def';
import type { PlatformerDef } from './def';

export const PLATFORMER_CODE_PREFIX = 'pf1-';
/** A code longer than this is refused unread (a def is a few KB). */
const MAX_CODE = 200_000;

export class PlatformerCodeError extends Error {}

export async function encodePlatformerCode(def: PlatformerDef): Promise<string> {
  const check = validatePlatformerDef(def);
  if (!check.ok) throw new PlatformerCodeError(check.errors[0]);
  const bytes = new TextEncoder().encode(serializePlatformerDef(check.def));
  return PLATFORMER_CODE_PREFIX + base64UrlEncode(await deflateBytes(bytes));
}

/** Decode and fully validate a platformer share code. Throws PlatformerCodeError with a readable message. */
export async function decodePlatformerCode(code: string): Promise<PlatformerDef> {
  const text = code.trim();
  if (!text.startsWith(PLATFORMER_CODE_PREFIX)) throw new PlatformerCodeError('That is not a platformer course code (it should start with pf1-).');
  if (text.length > MAX_CODE) throw new PlatformerCodeError('That code is too long to be a course.');
  const body = text.slice(PLATFORMER_CODE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new PlatformerCodeError('That code has characters a course code never holds.');
  let json: string;
  try { json = new TextDecoder().decode(await inflateBytes(base64UrlDecode(body))); } catch { throw new PlatformerCodeError('That code is damaged: it does not unpack.'); }
  const check = parsePlatformerDef(json);
  if (!check.ok) throw new PlatformerCodeError(check.errors[0]);
  return check.def;
}
