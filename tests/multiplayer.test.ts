// ══════════════════════════════════════════════════════════════════════════
// MP-01 — transport tests: the SDK seam, the room registration, code helpers.
//
// Two halves, both runnable with no browser and no network:
//
//   1. THE ISOLATION RULE (the ticket's acceptance): the RUN.world realtime API
//      is reached from `src/net/transport.ts` and nowhere else. A source scan,
//      not an import — the same shape HexMatch uses, and for the same reason:
//      `src/net/transport.ts` loads the SDK singleton at module scope, so test
//      code should not have to boot it to prove who calls it.
//   2. THE SEAM ITSELF: `ROOM_TYPE`/`MATCH_CRITERIA` against the room
//      registration on disk, and the pure helpers (room codes, the SDK's
//      matchmaking-expiry and access-denied duck typing, the no-host fallbacks).
//
// The second half DOES import `src/net/transport.ts`, which needs a browser
// `window` (the RUN SDK singleton is constructed on import). The two `window`/
// `document` stubs below are the minimum that import reads — not a jsdom, and
// deliberately not a port of the transport's room calls, which need a real
// signed-in host and a live sidecar: those are covered by local two-tab play
// (README → Multiplayer) and, from MP-10, the browser e2e suite.
// ══════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const SRC = join(ROOT, 'src');

// ── the browser globals `@series-inc/rundot-game-sdk/api` reads on import ───
const stubs = globalThis as unknown as { window?: unknown; document?: unknown };
stubs.window ??= {
  location: { href: 'http://localhost:5173/', origin: 'http://localhost:5173' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
};
stubs.document ??= {
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} }, body: { appendChild() {} },
  querySelector: () => null, addEventListener() {},
};

const transport = await import('../src/net/transport');

// ══════════════════════════════════════════════════════════════════════════
// 1. The SDK seam — one file imports the realtime API, and only one.
// ══════════════════════════════════════════════════════════════════════════

/** Every `.ts`/`.tsx` under `src/`, as `src/…` paths, sorted. */
function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out.map((f) => relative(ROOT, f).replace(/\\/g, '/')).sort();
}

/** True when the file IMPORTS the subpath (static or dynamic), comments aside. */
function imports(file: string, subpath: string): boolean {
  const source = readFileSync(join(ROOT, file), 'utf8');
  const specifier = `@series-inc/rundot-game-sdk/${subpath}`;
  return (
    source.includes(`from '${specifier}'`) ||
    source.includes(`from "${specifier}"`) ||
    source.includes(`import('${specifier}')`) ||
    source.includes(`import("${specifier}")`)
  );
}

const files = sourceFiles();

test('MP-01 isolation: only src/net/transport.ts imports the SDK realtime client', () => {
  // `…/mp-client` IS the realtime API surface (ServerRoom, MultiplayerApi,
  // room events). Game and UI code imports the wrappers this file re-exports —
  // types erased at build — so a BETA SDK change is a one-file fix.
  const importers = files.filter((file) => imports(file, 'mp-client'));
  assert.deepEqual(importers, ['src/net/transport.ts']);
});

test('MP-01 isolation: only src/net/transport.ts reaches through the SDK singleton for realtime', () => {
  // Importing the subpath is not the only way in: the realtime API hangs off the
  // SDK singleton (`RundotGameAPI.realtime`), and this app ALREADY imports that
  // singleton in `src/main.tsx` and `src/game/storage.ts` for boot and the device
  // cache. So the rule is about the PROPERTY, not the import: match any
  // `.realtime` access (through whatever alias) and any `{ realtime }` destructure,
  // not just the one spelling.
  const accessed = /\.\s*realtime\b|\{\s*realtime\s*[,:}]/;
  const accessors = files.filter((file) => accessed.test(readFileSync(join(ROOT, file), 'utf8')));
  assert.deepEqual(accessors, ['src/net/transport.ts']);
});

test('MP-01 isolation: the room server code is the only mp-server importer', () => {
  // The deliberate exception, and the opposite direction: `src/rooms/RaceRoom.ts`
  // runs ON the room server (dev sidecar, RUN.world room worker). It must never
  // pull the client entry in, and nothing in the client path may pull the server
  // bundle in.
  const importers = files.filter((file) => imports(file, 'mp-server'));
  assert.deepEqual(importers, ['src/rooms/RaceRoom.ts']);
});

test('MP-01 isolation: the seam is real, so the scan above cannot pass vacuously', () => {
  const seam = readFileSync(join(ROOT, 'src/net/transport.ts'), 'utf8');
  assert.ok(seam.includes(`@series-inc/rundot-game-sdk/mp-client`), 'transport.ts must import the realtime client types');
  assert.match(seam, /RundotGameAPI\s*\.\s*realtime/, 'transport.ts must read the realtime API off the SDK singleton');
  assert.ok(seam.includes('createRoom') && seam.includes('joinRoomByCode') && seam.includes('matchmakeRoom'));
  assert.ok(files.length > 20, `expected a populated src/ tree, scanned ${files.length} files`);
  // The lobby (MP-06) goes through the wrappers like any other caller: the
  // realtime API has one door, and the UI is not it.
  assert.equal(imports('src/components/OnlineLobby.tsx', 'mp-client'), false);
  assert.equal(imports('src/components/OnlinePanel.tsx', 'mp-client'), false);
  assert.equal(imports('src/components/RaceScreen.tsx', 'mp-client'), false);
});

// ══════════════════════════════════════════════════════════════════════════
// 2. The room registration — the SDK resolves rooms by type, so a typo in
//    either the config or the transport is a silent "no rooms like that".
// ══════════════════════════════════════════════════════════════════════════

interface RoomsConfig {
  rooms: { type: string; file?: string; export?: string; config?: { maxPlayers?: number; metadata?: Record<string, unknown> } }[];
}

function readRooms(path: string): RoomsConfig {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as RoomsConfig;
}

test('MP-01 registration: rundot/realtime.config.json registers the room the transport asks for', () => {
  const config = readRooms('rundot/realtime.config.json');
  const room = config.rooms.find((r) => r.type === transport.ROOM_TYPE);
  assert.ok(room, `no room of type "${transport.ROOM_TYPE}" in rundot/realtime.config.json`);
  assert.equal(room.export, 'default');
  assert.equal(room.config?.metadata?.mode, transport.MATCH_CRITERIA.mode, 'the room metadata and the matchmaking criteria must agree, or quick match never pairs');
  // Six humans plus AI filling the rest of the ten-marble grid (epic: "up to 6
  // humans + AI filling the other seats of a 10-marble grid").
  assert.equal(room.config?.maxPlayers, 6);
  assert.ok(room.config?.allowReconnect, 'a dropped seat must be held for the reconnect window (MP-08)');
  // MP-03 set this to 30: half the grace the room started with. It is the
  // number `peerStatus.graceMs` prints, so it is the room's copy that counts.
  assert.equal(room.config?.reconnectTimeout, 30);
});

test('MP-01 registration: the registered room file exists and default-exports the room class', () => {
  const config = readRooms('rundot/realtime.config.json');
  const room = config.rooms.find((r) => r.type === transport.ROOM_TYPE);
  assert.ok(room?.file, 'a non-deterministic room needs a `file`');
  assert.ok(existsSync(join(ROOT, room.file)), `${room.file} is registered but missing — the sidecar cannot load it`);
  assert.match(readFileSync(join(ROOT, room.file), 'utf8'), /export default class \w+ extends GameRoom/);
});

test('MP-01 registration: the e2e rooms file ships the same room with the suite-owned grace', () => {
  // MP-10's suite starts the sidecar against `rundot/realtime.e2e.config.json`
  // (via RUNDOT_DEV_ROOMS_CONFIG) so the departure specs wait on a grace the
  // repo owns instead of one inherited from the shipped file.
  const shipped = readRooms('rundot/realtime.config.json');
  const e2e = readRooms('rundot/realtime.e2e.config.json');
  // …everything except the grace, which is the one number the suite owns: the
  // shipped 30 seconds is a player's window, and a spec that waits on one is a
  // spec that takes half a minute per departure.
  const withoutGrace = (config: RoomsConfig): RoomsConfig => ({
    rooms: config.rooms.map((r) => ({ ...r, config: { ...r.config, reconnectTimeout: 0 } })),
  });
  assert.deepEqual(withoutGrace(e2e), withoutGrace(shipped), 'the e2e file must not drift from the shipped room shape');
  assert.equal(shipped.rooms[0].config?.reconnectTimeout, 30, 'the shipped grace is a player’s');
  assert.equal(e2e.rooms[0].config?.reconnectTimeout, 12, 'the suite’s grace is a spec’s');
  assert.ok(e2e.rooms[0].config?.allowReconnect, 'a dropped seat is still held for the (shorter) window');
});

test('MP-01 registration: npm run dev wires the local room sidecar', () => {
  // Without this plugin there is no sidecar on :9001 and the SDK's offline mock
  // silently resolves every room call — the trap `isOfflineMockRealtime` exists
  // for. Guard the wiring itself, since nothing else in the suite would notice.
  const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
  assert.match(vite, /rundotMultiplayerPlugin\(/, 'npm run dev must start the room sidecar');
  assert.ok(vite.includes('RUNDOT_DEV_ROOMS_CONFIG'), 'the sidecar rooms file must be overridable for the e2e suite');
});

// ══════════════════════════════════════════════════════════════════════════
// 3. The seam's pure helpers.
// ══════════════════════════════════════════════════════════════════════════

test('MP-01 room codes: six characters, trimmed and uppercased, nothing else', () => {
  assert.equal(transport.ROOM_CODE_LENGTH, 6);
  assert.equal(transport.normalizeRoomCode('  r9rcf9 '), 'R9RCF9');
  assert.equal(transport.isValidRoomCode(' r9rcf9 '), true);
  // The old relay's four-character codes are a different room system.
  assert.equal(transport.isValidRoomCode('AB12'), false);
  assert.equal(transport.isValidRoomCode('ABCDE'), false);
  assert.equal(transport.isValidRoomCode('ABCDEFG'), false);
  assert.equal(transport.isValidRoomCode('ABC-E6'), false);
  assert.equal(transport.isValidRoomCode(''), false);
});

test('MP-01 quick match: only the window closing keeps the search alive', () => {
  assert.equal(transport.MATCHMAKE_WINDOW_MS, 30_000);
  assert.equal(transport.isMatchmakeWindowExpired(new Error('Matchmaking timeout — no opponent found')), true);
  assert.equal(transport.isMatchmakeWindowExpired(new Error('This matchmaking ticket is no longer active')), true);
  assert.equal(transport.isMatchmakeWindowExpired(new Error('Matchmaking cancelled')), true);
  // Real failures must surface, not silently re-search.
  assert.equal(transport.isMatchmakeWindowExpired(new Error('Access denied')), false);
  assert.equal(transport.isMatchmakeWindowExpired('matchmaking timeout'), false);
  assert.equal(transport.isMatchmakeWindowExpired(null), false);
});

test('MP-01 auth: both shapes of the anonymous rejection are recognised', async () => {
  const accessDenied = Object.assign(new Error('Anonymous users cannot create rooms'), { name: 'AccessDeniedError' });
  assert.equal(transport.isAccessDenied(accessDenied), true);
  assert.equal(transport.isAccessDenied({ code: 'ACCESS_DENIED' }), true);
  assert.equal(transport.isAccessDenied(new Error('Room not found')), false);
  assert.equal(transport.isAccessDenied(null), false);
  // No host behind this page: report signed-in and let the realtime call fail,
  // and answer the login sheet with a fall-through instead of a throw.
  assert.equal(transport.isAnonymous(), false);
  assert.deepEqual(await transport.promptLogin(), { success: false });
});

test('MP-01 no host: every fallback resolves instead of throwing', async () => {
  // `npm run build` output, `vite preview`, a static copy: there is no realtime
  // API at all. A start screen asking for a rejoin offer must not break.
  assert.equal(transport.isOfflineMockRealtime(), false);
  assert.deepEqual(await transport.listRejoinableRooms(), []);
  assert.equal(await transport.readActiveMatch(), null);
  await transport.writeActiveMatch({ roomCode: 'R9RCF9', at: 1 });
  await transport.writeActiveMatch(null);
  assert.equal(await transport.writePlayerValue('heavy-metal-gp:mp:test', 'x'), false);
  assert.equal(await transport.readPlayerValue('heavy-metal-gp:mp:test'), null);
  assert.equal(transport.NO_ROOM_SERVER_MESSAGE.includes('npm run dev'), true);
});
