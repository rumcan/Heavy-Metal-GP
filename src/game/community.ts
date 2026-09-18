/**
 * Community tracks: players publish Workshop tracks for everyone, browse the most-upvoted and the newest, upvote
 * the good ones and copy any of them into My tracks.
 *
 * On RUN.world this is the SDK's UGC API (`RundotGameAPI.ugc`): one public entry per track, content type
 * `track`, the track stored as a share code (compressed and validated on the way back in), the title and tags
 * on the entry, and upvotes are the entry's likes (one per player, can be taken back).
 *
 * The SDK's offline mock (local dev, `isMock()`) has no UGC backend: it returns empty lists and throws on
 * create/like. So in that mode the same calls run against a small device-only store, and the UI says so.
 * Nothing written there ever reaches RUN.world.
 */
import * as storage from './storage';
import { decodeShareCode, encodeShareCode } from './sharecode';
import type { TrackDef } from './trackdef';

export const CONTENT_TYPE = 'track';
export const PAGE_SIZE = 20;
export const MAX_TAGS = 3;
/** Tags a publisher can pick from (fixed list: no free text to moderate, and they read the same for everyone). */
export const COMMUNITY_TAGS = ['Fast', 'Technical', 'Loops', 'Peggle', 'Jumps', 'Ice', 'Chaos', 'Beginner', 'Hard', 'Long', 'Short', 'Funny'] as const;
export type CommunityTag = (typeof COMMUNITY_TAGS)[number];

export type CommunitySort = 'top' | 'new';

export interface CommunityTrack {
  id: string;
  name: string;
  author: string;
  tags: string[];
  upvotes: number;
  upvotedByMe: boolean;
  createdAt: number;
  /** The track as a share code; decode with `decodeCommunityTrack`. */
  code: string;
}

export interface CommunityPage {
  tracks: CommunityTrack[];
  /** Pass back to load the next page; undefined when there are no more. */
  cursor?: string;
}

// ------------------------------------------------------------------ SDK access

interface UgcEntryLike {
  id: string;
  authorName?: string;
  authorDeactivatedAt?: number;
  title?: string;
  tags?: string[];
  likeCount?: number;
  isLikedByMe?: boolean;
  createdAt: number;
  data: Record<string, unknown>;
}
interface UgcLike {
  create(p: { contentType: string; data: Record<string, unknown>; isPublic?: boolean; title?: string; tags?: string[] }): Promise<UgcEntryLike>;
  browse(p: { contentType?: string; cursor?: string; limit?: number; sortBy?: 'recent' | 'mostLiked'; sortOrder?: 'asc' | 'desc' }): Promise<{ entries: UgcEntryLike[]; nextCursor?: string }>;
  like(id: string): Promise<{ likeCount: number }>;
  unlike(id: string): Promise<{ likeCount: number }>;
  recordUse(id: string): Promise<unknown>;
  checkTextAsync(text: string): Promise<{ clean: boolean; profaneWords: string[] }>;
}
interface SdkLike { ugc: UgcLike; isMock(): boolean; getProfile(): { name?: string; username?: string } }

let sdkPromise: Promise<SdkLike | null> | null = null;
function sdk(): Promise<SdkLike | null> {
  if (!sdkPromise) {
    sdkPromise = typeof window === 'undefined'
      ? Promise.resolve(null)
      : import('@series-inc/rundot-game-sdk/api').then((m) => m.default as unknown as SdkLike).catch(() => null);
  }
  return sdkPromise;
}

/** True when community tracks are device-only (local dev / SDK mock), false on RUN.world. */
export async function isLocalCommunity(): Promise<boolean> {
  const api = await sdk();
  if (!api) return true;
  try { return api.isMock(); } catch { return true; }
}

async function myName(): Promise<string> {
  const api = await sdk();
  try {
    const p = api?.getProfile();
    return p?.username || p?.name || 'You';
  } catch {
    return 'You';
  }
}

// ------------------------------------------------------------------ device-only store (dev)

export const LOCAL_COMMUNITY_KEY = 'heavy-metal-gp:community-local:v1';

function loadLocal(): CommunityTrack[] {
  try {
    const raw = storage.getItem(LOCAL_COMMUNITY_KEY);
    const list = raw ? (JSON.parse(raw) as CommunityTrack[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function saveLocal(list: CommunityTrack[]) {
  storage.setItem(LOCAL_COMMUNITY_KEY, JSON.stringify(list));
}
function pageOf(list: CommunityTrack[], cursor?: string): CommunityPage {
  const start = cursor ? Number(cursor) || 0 : 0;
  const end = start + PAGE_SIZE;
  return { tracks: list.slice(start, end), cursor: end < list.length ? String(end) : undefined };
}

// ------------------------------------------------------------------ public API

function fromEntry(e: UgcEntryLike): CommunityTrack | null {
  const code = typeof e.data?.code === 'string' ? e.data.code : null;
  if (!code) return null;
  return {
    id: e.id,
    name: e.title || 'Untitled track',
    author: e.authorDeactivatedAt ? 'Deleted player' : e.authorName || 'Unknown goblin',
    tags: (e.tags ?? []).filter((t) => (COMMUNITY_TAGS as readonly string[]).includes(t)),
    upvotes: e.likeCount ?? 0,
    upvotedByMe: !!e.isLikedByMe,
    createdAt: e.createdAt,
    code,
  };
}

/** One page of community tracks: most upvoted first (`top`) or newest first (`new`). */
export async function browseCommunity(sort: CommunitySort, cursor?: string): Promise<CommunityPage> {
  if (await isLocalCommunity()) {
    const list = loadLocal().slice();
    list.sort(sort === 'top' ? (a, b) => b.upvotes - a.upvotes || b.createdAt - a.createdAt : (a, b) => b.createdAt - a.createdAt);
    return pageOf(list, cursor);
  }
  const api = (await sdk())!;
  const res = await api.ugc.browse({ contentType: CONTENT_TYPE, sortBy: sort === 'top' ? 'mostLiked' : 'recent', sortOrder: 'desc', limit: PAGE_SIZE, cursor });
  return { tracks: res.entries.map(fromEntry).filter((t): t is CommunityTrack => t !== null), cursor: res.nextCursor };
}

export class PublishError extends Error {}

/** Publish a (validated) track for everyone. Throws `PublishError` with a player-facing message. */
export async function publishTrack(def: TrackDef, tags: string[]): Promise<CommunityTrack> {
  const name = def.name.trim() || 'Untitled track';
  const picked = tags.filter((t) => (COMMUNITY_TAGS as readonly string[]).includes(t)).slice(0, MAX_TAGS);
  const code = await encodeShareCode(def);
  if (await isLocalCommunity()) {
    const track: CommunityTrack = { id: `local-${Date.now().toString(36)}`, name, author: await myName(), tags: picked, upvotes: 0, upvotedByMe: false, createdAt: Date.now(), code };
    saveLocal([track, ...loadLocal()]);
    return track;
  }
  const api = (await sdk())!;
  const check = await api.ugc.checkTextAsync(name).catch(() => ({ clean: true, profaneWords: [] }));
  if (!check.clean) throw new PublishError('That track name was flagged by the word filter. Rename it and try again.');
  try {
    const entry = await api.ugc.create({ contentType: CONTENT_TYPE, data: { v: 1, code }, isPublic: true, title: name, tags: picked });
    const track = fromEntry(entry);
    if (!track) throw new Error('bad entry');
    return track;
  } catch (e) {
    throw new PublishError(e instanceof PublishError ? e.message : 'Publishing failed. Check your connection and try again.');
  }
}

/** Upvote (on = true) or take an upvote back. Returns the new count. */
export async function setUpvote(track: CommunityTrack, on: boolean): Promise<number> {
  if (await isLocalCommunity()) {
    const list = loadLocal();
    const hit = list.find((t) => t.id === track.id);
    if (!hit) return track.upvotes;
    if (hit.upvotedByMe !== on) {
      hit.upvotedByMe = on;
      hit.upvotes = Math.max(0, hit.upvotes + (on ? 1 : -1));
      saveLocal(list);
    }
    return hit.upvotes;
  }
  const api = (await sdk())!;
  const res = on ? await api.ugc.like(track.id) : await api.ugc.unlike(track.id);
  return res.likeCount;
}

/** Decode (and validate) a community track back into a def. */
export function decodeCommunityTrack(track: CommunityTrack): Promise<TrackDef> {
  return decodeShareCode(track.code);
}

/** Tell RUN.world the track was used (copied into My tracks). Best effort; rate-limited server-side. */
export async function recordTrackUse(track: CommunityTrack): Promise<void> {
  if (await isLocalCommunity()) return;
  try { await (await sdk())!.ugc.recordUse(track.id); } catch { /* best effort */ }
}
