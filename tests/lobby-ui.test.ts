// ══════════════════════════════════════════════════════════════════════════
// MP-06 — the lobby, painted.
//
// The wire half of this ticket is proved without a browser (two sessions on a
// wire, in `tests/session.test.ts`), but a component that throws on first paint
// is a lobby nobody can join. So: render the panel, the lobby and the grid to
// static markup and assert the things the acceptance names — the code is on the
// screen and copyable, the grid has ten seats, the host gets Start and the
// guest gets Ready.
//
// This is a SMOKE test, and it is honest about being one: no effects run and no
// messages are exchanged, so it proves these screens PAINT, not that they work.
// The working is played by hand (README → Multiplayer) and, from MP-10, by the
// browser suite.
// ══════════════════════════════════════════════════════════════════════════
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

// These components import STATIC ART (`logo.webp`, the portrait sheets) and use
// `import.meta.glob` — both are bundler features node cannot load on its own.
// So the render goes through vite's own SSR pipeline (`ssrLoadModule`), which
// transforms them exactly as the dev server does, with no browser and none of
// the SDK's dev-server plugins.
// The lobby imports `src/net/transport.ts` (the room type, the code helpers),
// and the RUN SDK singleton reads `window` on import. The same two stubs
// `tests/multiplayer.test.ts` uses — enough to import, not a DOM.
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

const { createServer } = await import('vite');
const { renderToStaticMarkup } = await import('react-dom/server');
const { createElement } = await import('react');

const server = await createServer({
  configFile: false, // not this app's config: that boots the SDK's room sidecar
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  esbuild: { jsx: 'automatic' },
});
after(() => server.close());

const OnlinePanel = (await server.ssrLoadModule('/src/components/OnlinePanel.tsx')).default;
const OnlineLobby = (await server.ssrLoadModule('/src/components/OnlineLobby.tsx')).default;
const LobbyGrid = (await server.ssrLoadModule('/src/components/LobbyGrid.tsx')).default;
const lobby_ = await server.ssrLoadModule('/src/net/lobby.ts');
const { dressGrid, fileGarage, rosterOf, setReady } = lobby_ as typeof import('../src/net/lobby');
const season = (await server.ssrLoadModule('/src/game/season.ts')) as typeof import('../src/game/season');
const { CALENDAR } = season;
const { MARBLE_COUNT } = (await server.ssrLoadModule('/src/net/protocol.ts')) as typeof import('../src/net/protocol');
// Loaded here, not beside the tests that use them: `after(() => server.close())`
// runs the moment the file's top-level test body ends, and a module fetched
// later than that finds the server gone.
const Notices = await server.ssrLoadModule('/src/components/PeerNotices.tsx');
const PeerStrip = Notices.PeerStrip;
const HostLeftOverlay = Notices.default;
const { foldPeer, AI_TAKEOVER_MS } = (await server.ssrLoadModule('/src/net/presence.ts')) as typeof import('../src/net/presence');

const T0 = 1_700_000_000_000;

const HOST = 'player-host';
const GUEST = 'player-guest';

/** The host's grid: the room's seats, dressed, with the guest's garage filed. */
function grid() {
  const fromRoom = Array.from({ length: MARBLE_COUNT }, (_, slot) => ({
    slot,
    playerId: slot === 0 ? HOST : slot === 1 ? GUEST : '',
    name: slot === 0 ? 'HOST' : slot === 1 ? 'GUEST' : `Rival ${slot}`,
    color: '#67e8f9',
    stats: { weight: 5, speed: 5, bounce: 5 },
    portrait: slot % 6,
    isAI: slot > 1,
    ready: slot > 1,
  }));
  const dressed = dressGrid(fromRoom, 9182);
  const filed = fileGarage(dressed, GUEST, { name: 'Sprocket', color: '#22d3ee', stats: { weight: 7, speed: 4, bounce: 4 }, portrait: 3 });
  return setReady(setReady(filed, HOST, true), GUEST, true);
}

// A room handle with only the fields the lobby reads. The SDK's ServerRoom is
// not constructible here, and rendering does not need it to be.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeRoom = (playerId: string) => ({ roomCode: 'HM4X9Q', playerId, isCreator: playerId === HOST, players: [{ id: HOST, username: 'HOST' }, { id: GUEST, username: 'GUEST' }], send() {}, leave() {} } as any);
const link = { send() {}, onMessage: null, onPlayerLeft: null };
const garage = { name: 'HOST', color: '#d63e2e', stats: { weight: 5, speed: 5, bounce: 5 }, portrait: 0 };

const lobby = (playerId: string) => renderToStaticMarkup(
  createElement(OnlineLobby, { room: fakeRoom(playerId), garage, circuitIndex: 2, onCircuit() {}, onLeave() {}, onStart() {}, link, error: null, onError() {} }),
);

test('MP-06 lobby: the panel offers host, join and quick race, and asks for six characters', () => {
  const html = renderToStaticMarkup(createElement(OnlinePanel, { busy: false, error: null, onHost() {}, onJoin() {}, onQuick() {} }));
  assert.match(html, /Host game/);
  assert.match(html, /Join with code/);
  assert.match(html, /Quick race/, 'MP-07 wires it; until then it says so');
  assert.match(html, /maxlength="6"/i, 'the code field takes six characters, no more');
  assert.match(html, /Room code/);
  // Up to six players per race, and AI drivers fill the rest.
  assert.match(html, /Up to six players per race/);
});

test('MP-07 lobby: a quick-match search says it is still looking, and can be cancelled', () => {
  const html = renderToStaticMarkup(createElement(OnlinePanel, { busy: true, error: null, onHost() {}, onJoin() {}, onQuick() {}, searching: true, windows: 2, onCancelSearch() {} }));
  assert.match(html, /Looking for a race/);
  // Two windows closed is not a failure — it is two thirty-second windows
  // nobody else was looking in.
  assert.match(html, /still looking after 2 attempts/);
  assert.match(html, /Cancel/, 'and the search can be given up on');
  // The host and join doors stay shut while a search is in flight: two rooms
  // at once is two seats, and one of them is a ghost.
  assert.match(html, /disabled/);
});

test('MP-06 lobby: the host screen shows the code, the circuit and a Start button', () => {
  const html = lobby(HOST);
  assert.match(html, /HM4X9Q/, 'the code is on the screen — big enough to read across a room');
  assert.match(html, /YOUR ROOM CODE/);
  assert.match(html, /Copy the room code/, 'and it can be copied rather than retyped');
  assert.match(html, /Start the race/);
  assert.match(html, /Waiting for the room/, 'before the room answers, the screen says so instead of showing an empty grid');
  assert.match(html, /10 GOBLINS/);
  assert.match(html, new RegExp(CALENDAR[2].name.toUpperCase()), 'the circuit the host picked is named');
  assert.match(html, /You pick/, 'and the host knows it is theirs to pick');
});

test('MP-06 lobby: the guest screen shows the same code, a Ready toggle and no Start', () => {
  const html = lobby(GUEST);
  assert.match(html, /HM4X9Q/, 'the guest sees the code too — it is how they know they are in the right race');
  assert.match(html, /ROOM CODE/);
  assert.doesNotMatch(html, /YOUR ROOM CODE/);
  assert.doesNotMatch(html, /Start the race/, 'only the host drops the lights');
  assert.match(html, /Ready/);
  assert.match(html, /Picked by/, 'and the circuit is the host\'s call');
});

test('MP-06 lobby: the grid is ten seats — drivers with a face and a livery, machines marked AI', () => {
  const seats = grid();
  const html = renderToStaticMarkup(createElement(LobbyGrid, { seats, roster: rosterOf(seats, 0), myPlayerId: HOST, isHost: true, onKick() {} }));
  assert.equal((html.match(/<li class=/g) ?? []).length, MARBLE_COUNT, 'ten slots, every race');
  assert.equal((html.match(/lobby-ai-badge/g) ?? []).length, 8, 'eight machines fill what the humans left');
  assert.match(html, /HOST/);
  assert.match(html, /Sprocket/, 'the guest garage the host filed');
  assert.match(html, /YOU/, 'and its own row says which one it is');
  assert.match(html, /lobby-livery/, 'every seat shows its livery');
  assert.match(html, /Take Sprocket off the grid/, 'the host may take a driver off — named, so it cannot be pressed by accident');

  // A guest sees the same ten rows and no buttons.
  const guestHtml = renderToStaticMarkup(createElement(LobbyGrid, { seats, roster: rosterOf(seats, 1), myPlayerId: GUEST, isHost: false }));
  assert.equal((guestHtml.match(/<li class=/g) ?? []).length, MARBLE_COUNT);
  assert.doesNotMatch(guestHtml, /Take .* off the grid/, 'a guest kicks nobody');
  assert.doesNotMatch(guestHtml, /Take HOST off the grid/);
});

// ── MP-08 ─────────────────────────────────────────────────────────────────
// A dropped socket is invisible in a static render unless the screen says it,
// and the two notices below are the whole of what a player is ever told.


test('MP-08 lobby: a driver who drops is named, and the marble is accounted for', () => {
  // One second in: they are missing, and the seat is being held.
  const early = foldPeer([], { type: 'peerStatus', playerId: 'player-1', status: 'disconnected', graceMs: 30_000, username: 'Sprocket' }, T0);
  const html = renderToStaticMarkup(createElement(PeerStrip, { peers: early, hostId: 'player-host', now: T0 + 1_000 }));
  assert.match(html, /Sprocket lost connection/, 'a notice says WHO, not "a driver"');
  assert.match(html, /0:29/, 'and counts the seat down');

  // Four seconds in: the AI has the marble. Saying so is the point — a marble
  // nobody is steering still has to be explained.
  const late = renderToStaticMarkup(createElement(PeerStrip, { peers: early, hostId: 'player-host', now: T0 + AI_TAKEOVER_MS + 1_000 }));
  assert.match(late, /the AI has their marble/, 'past three seconds the notice says whose hands it is in');

  // And when they are all back, there is nothing to say.
  const cleared = renderToStaticMarkup(createElement(PeerStrip, { peers: foldPeer(early, { type: 'peerStatus', playerId: 'player-1', status: 'reconnected' }, T0 + 5_000), hostId: 'player-host', now: T0 + 5_000 }));
  assert.equal(cleared, '', 'a full grid draws no strip');
});

test('MP-08 lobby: a host who drops is the one case the strip says out loud', () => {
  // The host is the simulation. Their drop is not a marble changing hands, it is
  // a race that has stopped, and the notice must not pretend otherwise.
  const peers = foldPeer([], { type: 'peerStatus', playerId: 'player-host', status: 'disconnected', graceMs: 30_000, username: 'Host' }, T0);
  const html = renderToStaticMarkup(createElement(PeerStrip, { peers, hostId: 'player-host', now: T0 + 2_000 }));
  assert.match(html, /The host lost connection/);
  assert.match(html, /the race is held for 0:28/, 'and it says the race is waiting, not that the AI took over');
});

test('MP-08 lobby: the host-left overlay ends the race, and says it pays nothing', () => {
  const html = renderToStaticMarkup(createElement(HostLeftOverlay, { message: 'The host left the race.', onLeave() {} }));
  assert.match(html, /The host left the race\./);
  assert.match(html, /pays nothing/, 'an unfinished race is not a result, and the player is told');
  assert.match(html, /Back to the garage/, 'with one way out');
});

test('MP-08 lobby: a race a returning player was in is offered back', () => {
  const withOffer = renderToStaticMarkup(createElement(OnlinePanel, {
    busy: false, error: null, onHost() {}, onJoin() {}, onQuick() {}, rejoin: { roomCode: 'ABC123' }, onRejoin() {}, onDismissRejoin() {},
  }));
  assert.match(withOffer, /You were in a race/);
  assert.match(withOffer, /ABC123/, 'and it names the room, so two games in a row are not confused');
  assert.match(withOffer, /Rejoin race/);
  // The memo is a "you were in this" note, not a permanent fixture: forgetting
  // it is one click, and it is gone from the next load.
  assert.match(withOffer, /Forget that race/);

  const without = renderToStaticMarkup(createElement(OnlinePanel, { busy: false, error: null, onHost() {}, onJoin() {}, onQuick() {} }));
  assert.doesNotMatch(without, /You were in a race/, 'no memo, no offer');
});
