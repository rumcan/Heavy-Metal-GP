// ══════════════════════════════════════════════════════════════════════════
// The room test harness: the REAL SDK dispatch (`handleJoin` → `onPlayerJoin`,
// `handleMessage` → `onGameMessage`, `handleLeave` → `onPlayerLeave`) driven by
// a fake `RoomProtocol` that records every outbound frame.
//
// Shared, not duplicated: MP-03's relay tests live in `tests/room.test.ts` and
// RK-03's rating tests in `tests/rank-runtime.test.ts`, and both need the same
// room. HexMatch's equivalent file is its own `tests/unit/…` harness.
// ══════════════════════════════════════════════════════════════════════════
import type { Clock, GameRoomProps, LeaveReason, Logger, PlatformServices, Player, RoomProtocol } from '@series-inc/rundot-game-sdk/mp-server';
import RaceRoom, { MAX_HUMAN_SEATS } from '../src/rooms/RaceRoom';
import type { RaceProtocol, WelcomeMsg } from '../src/net/protocol';
import assert from 'node:assert/strict';

export class TestRoom extends RaceRoom {
  constructor(props: GameRoomProps) {
    super(props);
  }
}

export interface Frame {
  /** 'broadcast', or the target player id (mirrors room:broadcast / room:sendTo). */
  target: string;
  type: string;
  data: unknown;
}

/**
 * The room's clock, faked. A REAL `setInterval` would keep the test process
 * alive for ever (and make presence timing non-deterministic); this records
 * the callbacks so a test fires the poll exactly when it wants one.
 */
export class FakeClock {
  private readonly timers = new Map<string, () => void>();
  setInterval(name: string, cb: () => void, _ms: number): void { this.timers.set(name, cb); }
  setTimeout(name: string, cb: () => void, _ms: number): void { this.timers.set(name, cb); }
  clear(name: string): void { this.timers.delete(name); }
  has(name: string): boolean { return this.timers.has(name); }
  dispose(): void { this.timers.clear(); }
  /** Fire every registered timer once — the room's poll is an interval. */
  tick(): void { for (const cb of [...this.timers.values()]) cb(); }
}

export interface Harness {
  room: TestRoom;
  protocol: RoomProtocol;
  frames: Frame[];
  players: Map<string, Player>;
  clock: FakeClock;
}

export function setup(config: Record<string, unknown> = {}, roomId = 'room-1'): Harness {
  const frames: Frame[] = [];
  const players = new Map<string, Player>();
  const silentLog = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    critical: () => {},
    child: () => silentLog,
  } as unknown as Logger;
  // Outbound calls record; the inbound handlers are dummies the GameRoom
  // constructor overwrites with the real dispatch.
  const protocol: RoomProtocol = {
    broadcast: (type, data) => void frames.push({ target: 'broadcast', type, data }),
    sendTo: (playerId, type, data) => void frames.push({ target: playerId, type, data }),
    kick: (playerId, reason) => void frames.push({ target: playerId, type: 'kick', data: { reason: reason ?? null } }),
    lock: () => void frames.push({ target: 'room', type: 'lock', data: {} }),
    unlock: () => void frames.push({ target: 'room', type: 'unlock', data: {} }),
    persist: () => {},
    handleCreate: () => Promise.resolve(),
    handleRestore: () => Promise.resolve(),
    handleJoin: () => Promise.resolve({ accepted: false as const, reason: 'unset' }),
    handleMessage: () => Promise.resolve(),
    handleLeave: () => Promise.resolve(),
    handleDispose: () => Promise.resolve(),
    handleTick: () => Promise.resolve(),
    serializePersistState: () => ({}),
    getLocked: () => false,
    getPlayers: () => players,
  };
  const clock = new FakeClock();
  const room = new TestRoom({
    protocol,
    roomId,
    roomType: 'hmgp-race',
    config: { maxPlayers: MAX_HUMAN_SEATS, reconnectTimeout: 30, ...config },
    players,
    clock: clock as unknown as Clock,
    log: silentLog,
    services: {} as unknown as PlatformServices,
  });
  return { room, protocol, frames, players, clock };
}

/** Reassemble a frame the way the client's transport does. */
export function messageOf(frame: Frame): RaceProtocol {
  return { ...(frame.data as Record<string, unknown>), type: frame.type } as RaceProtocol;
}

export const to = (frames: Frame[], target: string): Frame[] => frames.filter((f) => f.target === target);
export const ofType = (frames: Frame[], type: string): Frame[] => frames.filter((f) => f.type === type);
export const broadcasts = (frames: Frame[]): RaceProtocol[] => frames.filter((f) => f.target === 'broadcast').map(messageOf);
export const sentTo = (frames: Frame[], playerId: string): RaceProtocol[] => to(frames, playerId).map(messageOf);

/**
 * The LAST welcome sent to `target`. Every join broadcasts a new one (the seat
 * table changes), and every re-greet sends another — so the freshest is the
 * truth, and the older ones are history.
 */
export function welcomeOf(frames: Frame[], target = 'broadcast'): WelcomeMsg {
  const greetings = ofType(to(frames, target), 'welcome');
  assert.ok(greetings.length > 0, `no welcome for ${target}`);
  return messageOf(greetings[greetings.length - 1]) as WelcomeMsg;
}

export async function join(h: Harness, id: string, username = id.toUpperCase()): Promise<Player> {
  const res = await h.protocol.handleJoin({ id, username });
  if (!res.accepted) throw new Error(`join rejected: ${res.reason}`);
  return res.player;
}

/** A join the room refuses — returns the reason instead of throwing. */
export async function joinRefused(h: Harness, id: string): Promise<string> {
  const res = await h.protocol.handleJoin({ id, username: id.toUpperCase() });
  assert.equal(res.accepted, false, `${id} should have been refused`);
  return res.accepted ? '' : res.reason;
}

export async function send(h: Harness, from: string, msg: RaceProtocol): Promise<void> {
  const { type, ...rest } = msg as { type: string } & Record<string, unknown>;
  await h.protocol.handleMessage(from, type, rest);
}

export async function leave(h: Harness, id: string, reason: LeaveReason = 'leave'): Promise<void> {
  await h.protocol.handleLeave(id, reason);
}

