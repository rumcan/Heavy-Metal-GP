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
// RK-05: the rank surfaces — a chip, the ladder panel, and the results band.
const RankChipModule = await server.ssrLoadModule('/src/components/RankChip.tsx');
const RankChip = RankChipModule.default;
const LadderDialog = (await server.ssrLoadModule('/src/components/LadderDialog.tsx')).default;
const RaceResults = (await server.ssrLoadModule('/src/components/RaceResults.tsx')).default;
const rankView = (await server.ssrLoadModule('/src/game/rank-view.ts')) as typeof import('../src/game/rank-view');
const rating = (await server.ssrLoadModule('/src/net/rating.ts')) as typeof import('../src/net/rating');

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

test('MP-06 lobby: the panel offers host, join and the ranked queue, and asks for six characters', () => {
  const html = renderToStaticMarkup(createElement(OnlinePanel, { busy: false, error: null, onHost() {}, onJoin() {}, onQuick() {} }));
  assert.match(html, /Host game/);
  assert.match(html, /Join with code/);
  assert.match(html, /Quick race/);
  assert.match(html, /maxlength="6"/i, 'the code field takes six characters, no more');
  assert.match(html, /Room code/);
  // Up to six players per race, and AI drivers fill the rest.
  assert.match(html, /Up to six players per race/);
});

test('MP-07 lobby: a ranked search says what it is doing, and can be cancelled', () => {
  const html = renderToStaticMarkup(createElement(OnlinePanel, { busy: true, error: null, onHost() {}, onJoin() {}, onQuick() {}, searching: true, windows: 2, onCancelSearch() {} }));
  // Says what is happening: a rank-matched search that widens until it finds
  // anybody (RK-04 — the queue, not an open lobby), and since RK-05 says which
  // door is rated.
  assert.match(html, /Looking for another driver/);
  assert.match(html, /Quick race · ranked/);
  assert.match(html, /widens until it finds anyone/);
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

test('Playtest lobby: the host can take AI off the grid; a guest cannot', () => {
  const seats = grid();
  const hostHtml = renderToStaticMarkup(createElement(LobbyGrid, { seats, roster: rosterOf(seats, 0), myPlayerId: HOST, isHost: true, onKick() {}, onToggleAI() {}, benched: [4] }));
  assert.match(hostHtml, /Remove .* from the grid/);
  assert.match(hostHtml, /Put .* back on the grid/);
  assert.match(hostHtml, /OFF THE GRID/);
  const guestHtml = renderToStaticMarkup(createElement(LobbyGrid, { seats, roster: rosterOf(seats, 1), myPlayerId: GUEST, isHost: false, benched: [4] }));
  assert.doesNotMatch(guestHtml, /Remove .* from the grid/);
  assert.match(guestHtml, /OFF THE GRID/, 'but everyone sees who is off');
});

test('Playtest lobby: an AI power-ups switch is on the lobby', () => {
  assert.match(lobby(HOST), /AI drivers use power-ups/);
});

// ── RK-05 ─────────────────────────────────────────────────────────────────
// The rank surfaces are painted here, the same way the lobby is: a badge is an
// `img` with a bundled URL, so "the chip renders the right plate" is a fact
// about markup. The MODELS behind them (which tier, which delta, which of the
// three results states) are `tests/rank-view.test.ts`'s business, without a
// browser — this half only proves the surfaces PAINT.

/** A results row, in the shape the race screen hands over. */
const row = (id: number, rank: number, time: number | null) => ({ id, rank, time, pegs: id });

/** A rating band's view, built the way App builds it. */
function ratedView(state: 'settled' | 'pending' | 'unrated') {
  const verdict = rating.rateRaceOutcome({
    self: { playerId: HOST, state: { rating: 1042, matches: 8, wins: 4, losses: 4, season: 's1' } },
    board: [{ playerId: HOST, rating: 1042, games: 8 }, { playerId: GUEST, rating: 1010, games: 4 }],
    order: [{ playerId: HOST, finished: true }, { playerId: GUEST, finished: true }],
  });
  return rankView.rankedViewFor({
    verdict: state === 'settled' ? verdict : null,
    rated: state !== 'unrated',
    names: { [GUEST]: 'Sprocket' },
    seats: [{ slot: 0, playerId: HOST }, { slot: 1, playerId: GUEST }],
    current: rankView.chipOf({ rating: 1042, matches: 8 }),
  });
}

test('RK-05 chip: a badge, a tier and a number — and an honest blank when there is none', () => {
  const html = renderToStaticMarkup(createElement(RankChip, { model: rankView.chipOf({ rating: 1462, matches: 14 }) }));
  assert.match(html, /data-tier="steel"/, 'the plate the tier wears');
  assert.match(html, /assets\/ui\/rank\/steel\.png/, 'and it is the BUNDLED art, not a URL fetched at paint time');
  assert.match(html, /Steel/);
  assert.match(html, />1462</);
  assert.match(html, /alt=""/, 'decorative: the tier name beside it is what a screen reader reads');

  // A seat the room has not heard from: no number, and it says so.
  const unknown = renderToStaticMarkup(createElement(RankChip, { model: rankView.chipOfWire(null) }));
  assert.match(unknown, /no rating yet/);
  assert.match(unknown, /data-tier="unranked"/);
  assert.match(unknown, /assets\/ui\/rank\/unranked\.png/);

  // A compact chip is the same chip with the tier name hidden, not dropped.
  const compact = renderToStaticMarkup(createElement(RankChip, { model: rankView.chipOf({ rating: 1288, matches: 3 }), compact: true }));
  assert.match(compact, /class="sr-only">Iron</, 'the name is still in the accessibility tree');
});

test('RK-05 lobby: every human seat shows its rank, and the AI shows none', () => {
  const seats = grid();
  const chips: Record<string, { key: string; label: string; rating: number; games: number }> = {
    [HOST]: rankView.chipOf({ rating: 1462, matches: 14 }),
    [GUEST]: rankView.chipOfWire({ rating: 1010, games: 4 }),
  };
  const html = renderToStaticMarkup(createElement(LobbyGrid, {
    seats,
    roster: rosterOf(seats, 0),
    myPlayerId: HOST,
    isHost: true,
    rankOf: (playerId: string) => chips[playerId] ?? null,
  }));
  assert.equal((html.match(/<span class="rank-chip /g) ?? []).length, 2, 'one chip per human seat, and none for the eight machines');
  assert.match(html, /data-tier="steel"/);
  assert.match(html, /data-tier="scrap"/, 'a 1010 with four races is Scrap, not Unranked');
  assert.match(html, />1462</);
  assert.match(html, />1010</);

  // No lookup, no chips: an older caller paints the grid it always did.
  const bare = renderToStaticMarkup(createElement(LobbyGrid, { seats, roster: rosterOf(seats, 0), myPlayerId: HOST, isHost: true }));
  assert.doesNotMatch(bare, /rank-chip/);
});

test('RK-05 lobby: the room says which door it was — ranked or friendly', () => {
  const html = lobby(HOST);
  assert.match(html, /FRIENDLY/, 'a lobby opened by hand is friendly, and says so');
  assert.doesNotMatch(html, /RANKED/);
});

test('RK-05 panel: the quick-race door is Ranked, the code doors are Friendly', () => {
  const html = renderToStaticMarkup(createElement(OnlinePanel, { busy: false, error: null, onHost() {}, onJoin() {}, onQuick() {} }));
  assert.match(html, /Quick race<small>· Ranked<\/small>/, 'the queue is the rated door, and says so');
  assert.match(html, /Host game<small>· Friendly<\/small>/);
  assert.match(html, /Join with code<small>· Friendly<\/small>/);
  assert.match(html, /rated door/, 'and the panel explains what the difference costs');
});

test('RK-05 ladder: the panel prints the board, its own card, and every way it can be empty', () => {
  const mine = rankView.chipOf({ rating: 1042, matches: 11 });
  const open = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(LadderDialog, {
    ladder: null, loading: false, available: true, mine, onRetry() {}, onClose() {}, ...props,
  }));

  // No board behind this page (a dev room, a signed-out player): one line, not
  // an empty ladder that reads as "nobody plays this game".
  const unavailable = open({ available: false });
  assert.match(unavailable, /not reachable from this page/);
  assert.match(unavailable, /Your card/);
  assert.match(unavailable, /1042/, 'the driver still sees their own number');

  assert.match(open({ loading: true }), /Reading the board/);
  assert.match(open({}), /did not answer/);
  assert.match(open({ ladder: { entries: [], mine: null, total: 0 } }), /Nobody has filed a rating yet/);

  // The board itself: place, name, tier and number; then this driver's card and
  // where it sits.
  const listed = open({
    ladder: {
      entries: [
        { profileId: 'p1', username: 'Brakka', rating: 1830, rank: 1 },
        { profileId: 'p2', username: 'Sprocket', rating: 1290, rank: 2 },
      ],
      mine: { rank: 7, rating: 1042 },
      total: 41,
    },
  });
  assert.match(listed, /data-rank="1"/);
  assert.match(listed, /Brakka/);
  assert.match(listed, /data-tier="heavy-metal"/, '1830 wears the top plate');
  assert.match(listed, /data-tier="iron"/, '1290 is Iron');
  assert.match(listed, /rank 7 of 41/);
  assert.match(listed, /TOP 50/);
});

test('RK-05 results: the band prints the delta, the badge and the tier callout', () => {
  const results = [row(0, 1, 91_000), row(1, 2, 93_000), row(2, 3, null)];
  const roster = rosterOf(grid(), 0);
  const settled = renderToStaticMarkup(createElement(RaceResults, {
    results, roster, title: 'Test circuit', subtitle: 'ONLINE', actions: [{ label: 'Race again', onClick() {} }],
    championship: false, rating: ratedView('settled'),
  }));
  assert.match(settled, /RATING/, 'the table grows a column only when a rating moved');
  assert.match(settled, /rank-delta/);
  assert.match(settled, /results-ranking-badge/);
  assert.match(settled, /of 2 rated drivers/);
  assert.match(settled, /PLACEMENT RACE/, 'eleven races in is still placement');

  // While the room is still filing: work in progress, never a +0.
  const pending = renderToStaticMarkup(createElement(RaceResults, {
    results, roster, title: 'Test circuit', subtitle: 'ONLINE', actions: [{ label: 'Race again', onClick() {} }],
    championship: false, rating: ratedView('pending'),
  }));
  assert.match(pending, /Filed with the room/);
  assert.doesNotMatch(pending, /rank-delta/, 'no numbers are invented while the room has not agreed');

  // A friendly race: the band says nothing moved, and the table has no column.
  const unrated = renderToStaticMarkup(createElement(RaceResults, {
    results, roster, title: 'Test circuit', subtitle: 'ONLINE', actions: [{ label: 'Race again', onClick() {} }],
    championship: false, rating: ratedView('unrated'),
  }));
  assert.match(unrated, /friendly race/i);
  assert.match(unrated, /UNRATED/);

  // And an offline heat — no room, no rating — is the results screen it always was.
  const offline = renderToStaticMarkup(createElement(RaceResults, {
    results, roster, title: 'Quick race', subtitle: 'SINGLE HEAT', actions: [{ label: 'Race again', onClick() {} }], championship: false,
  }));
  assert.doesNotMatch(offline, /results-ranking/);
  assert.doesNotMatch(offline, />RATING</);
});
