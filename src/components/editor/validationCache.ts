/**
 * Remembered validation results, keyed by a fingerprint of the exact track. My tracks shows a saved track's PASS/FAIL
 * from here instead of racing 10 marbles through every saved track each time the Workshop opens (on big maps that
 * froze the page for seconds per track). Results are recorded whenever the player runs Validate.
 */
import type { TrackDef } from '../../game/trackdef';
import { getItem, setItem } from '../../game/storage';

const KEY = 'heavy-metal-gp:validation-results';
const MAX = 60;

/** A short fingerprint of a track's content (name aside: renaming does not change how it races). */
export function trackFingerprint(def: TrackDef): string {
  const text = JSON.stringify({ p: def.pieces, h: def.height, s: def.seed, t: def.theme });
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${text.length.toString(36)}-${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`;
}

function load(): Record<string, boolean> {
  try { return JSON.parse(getItem(KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; }
}

/** The remembered result for this exact track: true = pass, false = fail, undefined = never validated. */
export function cachedValidation(def: TrackDef): boolean | undefined {
  return load()[trackFingerprint(def)];
}

export function rememberValidation(def: TrackDef, canShare: boolean): void {
  const all = load();
  const key = trackFingerprint(def);
  delete all[key];
  all[key] = canShare;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete all[k];
  try { setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
