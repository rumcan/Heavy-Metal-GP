// ══════════════════════════════════════════════════════════════════════════
// MP-01 — RUN.world realtime transport (ported from HexMatch).
//
// THE ONLY client module that touches the RUN.world *realtime* API. Multiplayer
// is BETA and the API drifts: every `RundotGameAPI.realtime.*` call, every room
// lifecycle call and every room code helper lives here so a breaking SDK change
// is a one-file fix. Game and UI code imports the wrappers (and the re-exported
// types) below instead of the SDK. `tests/multiplayer.test.ts` enforces the
// rule: no other file under `src/` may import `…/mp-client` or reach for
// `RundotGameAPI.realtime`.
//
// Two deliberate exceptions, both OUTSIDE the client path:
//   - `src/rooms/RaceRoom.ts` imports `…/mp-server` because it RUNS on the
//     room server (the sidecar in dev, RUN.world's room worker when published).
//   - `vite.config.ts` imports the build plugin, and `src/main.tsx` +
//     `src/game/storage.ts` import the SDK's non-realtime services (boot and
//     the device cache) — neither is the realtime API.
//
// What goes where (mirroring HexMatch's split):
//   - `protocol.ts` (MP-02) — the message union + version refusal. No SDK, no
//     browser: safe to import from the room bundle, Node tests, anywhere.
//   - THIS file — room lifecycle (`createRoom`, `joinRoomByCode`, `quickMatch`,
//     `getUserRooms`), room-code shape, the per-player active-match memo and
//     the auth helpers. Needs the RUN host, or `npm run dev` with
//     `rundotMultiplayerPlugin()`, which serves rooms locally on port 9001.
//
// No `localStorage`/`sessionStorage` here: RUN.world blocks them. The active
// match memo goes through the SDK's `appStorage` (per-player, cloud-backed, and
// mocked in dev) — see `readPlayerValue` below.
// ══════════════════════════════════════════════════════════════════════════
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import type {
  ConnectionState,
  MultiplayerApi,
  RoomEvents,
  ServerPlayer,
  ServerRoom,
} from '@series-inc/rundot-game-sdk/mp-client';
// MP-02: the message union this transport speaks now exists. `protocol.ts` is
// pure (no SDK, no DOM, no Matter) so importing it here costs nothing and does
// not drag the room bundle into the page.
import type { RaceProtocol } from './protocol';
export type { RaceProtocol };
// `ListUserRoomsOptions` / `RealtimeRoomSummary` are not re-exported from
// `/mp-client` — they live on the package root. Type-only: erased at build.
import type { ListUserRoomsOptions, RealtimeRoomSummary } from '@series-inc/rundot-game-sdk';

/** Room type — must match the room registered in `rundot/realtime.config.json`. */
export const ROOM_TYPE = 'hmgp-race';

/**
 * Matchmaking criteria — must match the room `metadata` in
 * `rundot/realtime.config.json` (MP-07/MP-08). Two players pair only when
 * every key matches.
 */
export const MATCH_CRITERIA: Record<string, string | number> = { mode: 'race' };

/** RUN room codes are 6 characters (e.g. "HM4X9Q"). */
export const ROOM_CODE_LENGTH = 6;

/**
 * The message union this transport speaks: the race protocol, `RaceProtocol`
 * from `src/net/protocol.ts` (MP-02), re-exported above.
 *
 * MP-01 registered the room with the SDK's base `Protocol` (`{ type: string }`)
 * because the wire itself was MP-02's ticket. Now that it exists, every room
 * call below is typed against it: `room.send()` takes a real race message, and
 * `onMessage` hands back a validated-looking one (validation itself is
 * `validateMessage`, not the type).
 */

/** A connected RUN room speaking the race protocol. */
export type RaceRoom = ServerRoom<RaceProtocol>;

/** Room event handlers for a race room (`room.on(…)`). */
export type RaceRoomEvents = RoomEvents<RaceProtocol>;

// Re-exported so consumers never import the SDK for these types themselves.
export type { ConnectionState, ListUserRoomsOptions, RealtimeRoomSummary, ServerPlayer };

/** The realtime API, or a clear error when there is no RUN host. */
function realtime(): MultiplayerApi {
  const rt = RundotGameAPI.realtime as MultiplayerApi | undefined;
  if (!rt) {
    throw new Error(
      'RUN.world realtime is not available in this environment. ' +
        'Multiplayer needs the RUN host (or `npm run dev` with rundotMultiplayerPlugin).',
    );
  }
  return rt;
}

/**
 * Host a race. The creator becomes host and the room mints the seed every
 * client regenerates its circuit from (MP-04); this layer only opens the room.
 */
export function createRoom(): Promise<RaceRoom> {
  return realtime().createRoom<RaceProtocol>(ROOM_TYPE);
}

/** Join by code. The code is normalized (trim, uppercase) before sending. */
export function joinRoomByCode(code: string): Promise<RaceRoom> {
  return realtime().joinRoomByCode<RaceProtocol>(normalizeRoomCode(code));
}

export interface QuickMatchOptions {
  /** How long to wait for an opponent before rejecting (default MATCHMAKE_WINDOW_MS). */
  matchmakeTimeoutMs?: number;
  /** How often to poll the pool while waiting (default 1s). */
  pollIntervalMs?: number;
}

/**
 * How long ONE matchmake request waits before the SDK gives up on it: it sends
 * `matchmaking:cancel`, closes the socket and rejects with
 * "Matchmaking timeout — no opponent found".
 *
 * A bounded window is what makes Quick race's Cancel honest: the SDK has no
 * public cancel for a pending `matchmakeRoom`, so an abandoned request can only
 * leave the RUN pool when its window closes. Keeping the window short bounds
 * how long a cancelled player can still be paired with someone (a ghost
 * ticket). The search itself never stops — the lobby re-issues the request each
 * time a window closes.
 */
export const MATCHMAKE_WINDOW_MS = 30_000;

/**
 * True when `err` is one of the SDK's matchmaking-search rejections: the
 * request's waiting window closed, the server dropped the ticket from the pool
 * ("no longer active"), or the ticket was cancelled. All three mean the SEARCH
 * may continue — the caller re-issues `quickMatch` — as opposed to real
 * failures (access denied, room errors, connection problems), which must
 * surface to the player.
 *
 * The SDK rejects these with plain `Error`s — no `code`, no `name` to duck-type
 * on (BETA drift), so the messages are matched, loosely and case-insensitively,
 * the way `isAccessDenied` duck-types its shapes.
 */
export function isMatchmakeWindowExpired(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  return (
    message.includes('matchmaking timeout') ||
    message.includes('no longer active') ||
    message.includes('matchmaking cancelled')
  );
}

/**
 * Quick race — cross-instance transactional pairing, the call intended for
 * playing strangers (MP-07). Whoever ends up alone in a fresh room is still the
 * host; MP-07 turns that into a shareable invite rather than stranding them.
 *
 * One call is one bounded window (see MATCHMAKE_WINDOW_MS); "keep looking until
 * found or cancelled" is the caller's loop: re-issue whenever
 * `isMatchmakeWindowExpired` says the window closed.
 */
export function quickMatch(opts: QuickMatchOptions = {}): Promise<RaceRoom> {
  return realtime().matchmakeRoom<RaceProtocol>(ROOM_TYPE, {
    criteria: { ...MATCH_CRITERIA },
    matchmakeTimeoutMs: opts.matchmakeTimeoutMs ?? MATCHMAKE_WINDOW_MS,
    pollIntervalMs: opts.pollIntervalMs,
  });
}

/** Rooms the signed-in player belongs to (the rejoin path, MP-08). */
export function getUserRooms(options?: ListUserRoomsOptions): Promise<RealtimeRoomSummary[]> {
  return realtime().getUserRooms(options);
}

// ══════════════════════════════════════════════════════════════════════════
// The rejoin path (MP-08 groundwork).
//
// A kicked player lands back at the start screen with no memory of the race
// they were in. The platform DOES remember: a dropped socket's seat is held for
// the room's `reconnectTimeout`, and `getUserRooms` lists every room the player
// is still rostered in — which is exactly the set of races they can walk back
// into. Two wrappers make that usable:
//
//   listRejoinableRooms — the filtered, never-throwing list. "Never throws" is
//                         the whole design: the start screen asks this on every
//                         boot, and a host without the rooms RPC (an old
//                         webview, a dev page with no sidecar) must degrade to
//                         "no rejoin on offer", never to a broken screen.
//   the active-match memo — one small per-player record of the race this device
//                         walked into (room code + when). The summary cannot
//                         say whether a room is the race we left rather than
//                         some other session, so the memo is what lets a return
//                         offer the SAME seat back.
// ══════════════════════════════════════════════════════════════════════════

/** The per-player key holding the active-match memo (see below). */
export const ACTIVE_MATCH_KEY = 'heavy-metal-gp:mp:active:v1';

/** What this device walked into, so a return can offer the same race back. */
export interface ActiveMatchMemo {
  roomCode: string;
  /** Wall clock (ms) when the room was entered. */
  at: number;
}

/**
 * Race rooms the signed-in player is still rostered in — the races a return can
 * rejoin. Resolves `[]` whenever the platform cannot answer (no host RPC, no
 * sidecar, signed out): no rejoin on offer is always safe.
 */
export async function listRejoinableRooms(): Promise<RealtimeRoomSummary[]> {
  try {
    const rooms = await getUserRooms();
    if (!Array.isArray(rooms)) return [];
    return rooms.filter(
      (r) => r && r.roomType === ROOM_TYPE && r.status === 'active' && typeof r.roomCode === 'string',
    );
  } catch {
    return [];
  }
}

interface StorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

/**
 * The RUN per-player store, or null when there is no host.
 *
 * Duck-typed instead of imported for the same reason as
 * `isOfflineMockRealtime`: the SDK's BETA surface is not a stable type handle.
 * A wrapper that trusted a store that was never wired would write a room code
 * into a bucket that does not exist and read `null` back forever, which looks
 * exactly like a memo bug.
 */
function playerStorage(): StorageLike | null {
  try {
    const api = RundotGameAPI as unknown as { appStorage?: StorageLike };
    return api.appStorage ?? null;
  } catch {
    return null;
  }
}

/** Read a stored per-player value; `null` when absent, unreachable, or malformed. */
export async function readPlayerValue(key: string): Promise<string | null> {
  const store = playerStorage();
  if (!store) return null;
  try {
    const value = await store.getItem(key);
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Write a stored per-player value; resolves `false` when the write did not happen. */
export async function writePlayerValue(key: string, value: string): Promise<boolean> {
  const store = playerStorage();
  if (!store) return false;
  try {
    await store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Clear a stored per-player value; `false` when there was nothing to clear. */
export async function clearPlayerValue(key: string): Promise<boolean> {
  const store = playerStorage();
  if (!store) return false;
  try {
    await store.removeItem?.(key);
    return true;
  } catch {
    return false;
  }
}

/** Read the active-match memo; null when absent, unreadable or malformed. */
export async function readActiveMatch(): Promise<ActiveMatchMemo | null> {
  const raw = await readPlayerValue(ACTIVE_MATCH_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveMatchMemo>;
    if (typeof parsed?.roomCode !== 'string' || parsed.roomCode.length === 0) return null;
    return { roomCode: parsed.roomCode, at: Number(parsed.at) || 0 };
  } catch {
    return null;
  }
}

/**
 * Write (or with `null`, clear) the active-match memo. Written when a networked
 * race is entered, cleared when it is left through a door this client controls
 * — a drop is precisely the case that CANNOT clear it, which is what makes the
 * rejoin offer possible on return (MP-08).
 */
export async function writeActiveMatch(memo: ActiveMatchMemo | null): Promise<void> {
  if (!memo) {
    await clearPlayerValue(ACTIVE_MATCH_KEY);
    return;
  }
  await writePlayerValue(ACTIVE_MATCH_KEY, JSON.stringify(memo));
}

/**
 * True when there is NO room server behind the SDK: not the RUN host, and not
 * `npm run dev` either (the multiplayer plugin injects the local sidecar's
 * origin as `window.__RUNDOT_MULTIPLAYER_DEV_SERVER__`, and only on serve — a
 * built or previewed page never gets it).
 *
 * This state is a trap rather than an error: the SDK's offline mock still
 * RESOLVES `createRoom` and `joinRoomByCode` — with a random six-character code,
 * and for a join it ignores the code entirely and mocks a second room. Both
 * lobbies therefore look alive ("Connected", a copyable code) and then wait for
 * a welcome that nothing will ever send. Detect it at the door and say so.
 *
 * Duck-typed on the mock's `delegate` field, which is null exactly when it is
 * offline: BETA drift means a class name is not a handle to rely on, and the
 * hosted API has no such field.
 */
export function isOfflineMockRealtime(): boolean {
  try {
    const rt = RundotGameAPI.realtime as unknown as { delegate?: unknown } | undefined;
    return !!rt && 'delegate' in rt && rt.delegate == null;
  } catch {
    return false;
  }
}

/**
 * Shown instead of a lobby that can never fill. Deliberately names the fix:
 * multiplayer is only reachable from the dev server (or from RUN.world once
 * published), never from `vite preview` / a static copy of the build.
 */
export const NO_ROOM_SERVER_MESSAGE =
  'No room server behind this page, so host and join can never meet. ' +
  'Multiplayer runs from `npm run dev` — open the localhost:5173 URL it prints ' +
  '(its room server listens on port 9001). A previewed or statically served ' +
  'build mocks rooms instead; race the AI here.';

/**
 * Normalize a room code the way the join field (MP-06) does: trim and
 * uppercase, `maxLength={6}` at the input. No server-address field exists —
 * unlike an old relay lobby there is nothing to configure.
 */
export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Shape check ONLY — the server is the final authority on whether a code
 * exists. Four-character relay codes fail here, which is correct: they are a
 * different room system entirely.
 */
export function isValidRoomCode(code: string): boolean {
  const normalized = normalizeRoomCode(code);
  return normalized.length === ROOM_CODE_LENGTH && /^[A-Z0-9]+$/.test(normalized);
}

/**
 * True when `err` is the platform's anonymous-user rejection.
 *
 * The documented shape is `code === "ACCESS_DENIED"`; the SDK also throws
 * `AccessDeniedError` (a `name`, no `code`). Accept BOTH — BETA drift means
 * either shape may arrive, and misclassifying it strands a signed-out player on
 * an error screen instead of the login sheet with its race-the-AI fallback.
 *
 * Duck-typed on purpose: importing the error class would couple every caller to
 * the SDK's error taxonomy.
 */
export function isAccessDenied(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === 'AccessDeniedError' || e.code === 'ACCESS_DENIED';
}

/**
 * True when no signed-in user is present — multiplayer calls will hit the login
 * sheet. Defensive: when the access gate itself is missing (a host older than
 * the gate), report signed-in and let the realtime call fail with
 * `AccessDeniedError`, which `isAccessDenied` already handles.
 */
export function isAnonymous(): boolean {
  try {
    return RundotGameAPI.accessGate.isAnonymous();
  } catch {
    return false;
  }
}

/**
 * Show the platform login sheet. Resolves `{ success: false }` when the gate is
 * unavailable rather than throwing — the caller falls through to racing the AI
 * (that fallback is required, not optional).
 */
export function promptLogin(): Promise<{ success: boolean }> {
  try {
    return RundotGameAPI.accessGate.promptLogin();
  } catch {
    return Promise.resolve({ success: false });
  }
}
