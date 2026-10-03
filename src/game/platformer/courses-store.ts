// P2-22: the platformer courses a player has saved (the Workshop's "My platformer courses"). Stored as one JSON list
// under a registered storage key; every entry is re-validated on load, and each valid one is registered as a custom
// course so a quick-race pick (`platformer:my-<id>`) resolves to it.
import { getItem, setItem } from '../storage';
import { customCourseId, registerPlatformerDef, serializePlatformerDef, validatePlatformerDef } from './def';
import type { PlatformerDef } from './def';
import { unregisterCustomCourse } from './course';

export const COURSES_KEY = 'heavy-metal-gp:platformer-courses:v1';
export const MAX_COURSES = 30;
/** A saved course may be at most this much JSON. */
export const COURSE_BUDGET = 120 * 1024;

export interface SavedCourse { id: string; def: PlatformerDef; createdAt: number; updatedAt: number }

function newId(): string {
  const bytes = new Uint8Array(6);
  try { crypto.getRandomValues(bytes); } catch { for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); }
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

/** The saved list, validated; every valid course is registered so it can be raced. */
export function loadSavedCourses(): SavedCourse[] {
  const raw = getItem(COURSES_KEY);
  if (!raw) return [];
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const out: SavedCourse[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || !/^[a-z0-9]{4,24}$/.test(e.id)) continue;
    const check = validatePlatformerDef(e.def);
    if (!check.ok) continue;
    out.push({ id: e.id, def: check.def, createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(), updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : Date.now() });
    registerPlatformerDef(e.id, check.def);
  }
  return out;
}

function write(list: SavedCourse[]): void { setItem(COURSES_KEY, JSON.stringify(list)); }

/** Save a def as a new course, or over the one with `id`. */
export function saveCourse(def: PlatformerDef, id?: string | null): SavedCourse | { error: string } {
  const check = validatePlatformerDef(def);
  if (!check.ok) return { error: check.errors[0] };
  if (serializePlatformerDef(check.def).length > COURSE_BUDGET) return { error: 'This course is too big to save: remove some of its things.' };
  const list = loadSavedCourses();
  const now = Date.now();
  const at = id ? list.findIndex((c) => c.id === id) : -1;
  let saved: SavedCourse;
  if (at >= 0) {
    saved = { ...list[at], def: check.def, updatedAt: now };
    list[at] = saved;
  } else {
    if (list.length >= MAX_COURSES) return { error: `You can keep ${MAX_COURSES} platformer courses: delete one first.` };
    saved = { id: newId(), def: check.def, createdAt: now, updatedAt: now };
    list.unshift(saved);
  }
  write(list);
  registerPlatformerDef(saved.id, saved.def);
  return saved;
}

export function deleteCourse(id: string): boolean {
  const list = loadSavedCourses();
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return false;
  write(next);
  unregisterCustomCourse(customCourseId(id));
  return true;
}
