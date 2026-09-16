// ══════════════════════════════════════════════════════════════════════════
// MP-01 — the race room REGISTRATION.
//
// This file exists so the room type is real: `rundot/realtime.config.json`
// points `hmgp-race` at it, and the dev sidecar (`rundotMultiplayerPlugin()` on
// `npm run dev`) bundles it with Vite and serves it on port 9001. With it,
// `createRoom()` mints a room and hands back a six-character code, and
// `joinRoomByCode()` seats a second tab — which is exactly what MP-01's
// acceptance asks for, and nothing more.
//
// MP-03 replaces this body with the real thing: the thin validating relay.
// Host authority, thin relay —
//   guest intent/resync  →  forward to the host ONLY
//   host snapshot/delta  →  broadcast to everyone else
//   forged guest state   →  DROPPED (`sender.id !== hostId`)
// and the room mints the seed and names the host in `onCreate`. It still never
// simulates: the host browser runs the Matter.js game.
//
// Two rules this file must keep whatever MP-03 makes of it:
//   - Import the SDK's `mp-server` surface ONLY. This module runs on the room
//     server, never in the browser, so it must never reach `…/mp-client`,
//     `…/api` or `src/net/transport.ts` (that would drag the client bundle into
//     the room and the room into the page). `src/net/protocol.ts` is the one
//     shared import both sides are allowed: it is pure.
//   - Never generate anything here with `Math.random()`: the seed every client
//     regenerates its circuit from is minted once, by the room, from a seeded
//     RNG (MP-03/MP-04).
// ══════════════════════════════════════════════════════════════════════════
import { GameRoom } from '@series-inc/rundot-game-sdk/mp-server';
// MP-02: the wire the room relays. `src/net/protocol.ts` is pure (no SDK, no
// DOM, no Matter.js — only `game/types` and `game/audio`), so the room bundle
// may import it: the relay validates what it forwards with the same code the
// client validates what it applies.
import type { RaceProtocol } from '../net/protocol';

/** The message union the room relays. */
export type RoomProtocol = RaceProtocol;

/**
 * The race room. See the header: MP-01 registers the seat-taking skeleton
 * (seating, capacity, reconnection grace — all owned by `GameRoom` and the
 * room's config), and MP-03 adds the relay.
 */
export default class RaceRoom extends GameRoom<RoomProtocol> {}
