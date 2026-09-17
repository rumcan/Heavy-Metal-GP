import * as storage from './game/storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import SetupScreen from './components/SetupScreen';
import RaceScreen, { RaceAction } from './components/RaceScreen';
import ChampionshipScreen from './components/ChampionshipScreen';
import OnlineLobby from './components/OnlineLobby';
import type { OnlineRaceStart } from './components/OnlineLobby';
import type { OnlineRace } from './components/RaceScreen';
import {
  createRoom,
  isAccessDenied,
  isMatchmakeWindowExpired,
  isOfflineMockRealtime,
  joinRoomByCode,
  listRejoinableRooms,
  NO_ROOM_SERVER_MESSAGE,
  promptLogin,
  quickMatch,
  readActiveMatch,
  writeActiveMatch,
  type ActiveMatchMemo,
  type RaceRoom,
} from './net/transport';
import { Matchmaker } from './net/matchmake';
import type { RaceProtocol } from './net/transport';
import type { RaceLink } from './net/session';
import { HOST_LEFT_REASON } from './net/protocol';
import type { WelcomeMsg } from './net/protocol';
import { foldPeer, graceLeft, peerOf, type PeerPresence } from './net/presence';
import { PeerStrip } from './components/PeerNotices';
import HostLeftOverlay from './components/PeerNotices';
import { circuitIndexOf, gridOrderOf, rosterOf } from './net/lobby';
import type { SeatGarage } from './net/lobby';
import { MarbleInfo, MarbleStats, AI_COLORS, randomStats, mulberry32, PLAYER_COLORS, HeatResult, HEATS_PER_GP } from './game/types';
import { SeasonState, newSeason, recordHeat, gridOrder, gpSeed, CALENDAR, saveSeason, loadSeason } from './game/season';
import { loadAccount, saveAccount, purchaseItem, onlineRaceId, settleOnlineRace, settleRace } from './game/economy';
import type { RacerAccount, RacePayout } from './game/economy';
import { normalizeInventory } from './game/types';
import type { Inventory, ItemType } from './game/types';
import PitShop from './components/PitShop';
import { RIVALS, PLAYER_PORTRAIT_COUNT, preRaceBanter } from './game/characters';
import type { Line } from './game/characters';
import LoadingScreen from './components/LoadingScreen';
import StoryMode from './components/story/StoryMode';
import { loadStory } from './game/story/state';

/**
 * How long a rejoin offer stays on the table, in ms.
 *
 * The memo is a "you were in a race" note for a tab that closed or a browser
 * that crashed; it is not a bookmark. Ten minutes is long enough to notice and
 * short enough that the garage never offers a race that finished an age ago.
 */
const REJOIN_OFFER_MS = 10 * 60_000;

const PORTRAIT_KEY = 'heavy-metal-gp:portrait';
function loadPortrait(): number {
  try { const n = Number(storage.getItem(PORTRAIT_KEY)); return Number.isInteger(n) && n >= 0 && n < PLAYER_PORTRAIT_COUNT ? n : 0; } catch { return 0; }
}
interface Loading { eyebrow: string; title: string; cta: string; banter?: Line[]; next: Phase }

function makeRivals(seed: number): MarbleInfo[] {
  const rng = mulberry32(seed);
  const pool = RIVALS.map((_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return AI_COLORS.map((color, i) => ({
    id: i + 1,
    name: RIVALS[pool[i]].name,
    character: pool[i],
    color,
    stats: randomStats(rng),
    isPlayer: false,
  }));
}

type Phase = 'menu' | 'retune' | 'hub' | 'race' | 'quick' | 'story' | 'lobby' | 'online';

export default function App() {
  const [phase, setPhase] = useState<Phase>('menu');
  const [loading, setLoading] = useState<Loading | null>({ eyebrow: 'SMALL GOBLINS. BIG BALLS. BIGGER DREAMS.', title: 'WELCOME TO THE GRID', cta: 'Enter the paddock', next: 'menu' });
  const [portrait, setPortrait] = useState(loadPortrait);
  useEffect(() => { try { storage.setItem(PORTRAIT_KEY, String(portrait)); } catch { /* storage unavailable */ } }, [portrait]);
  const [stats, setStats] = useState<MarbleStats>({ weight: 5, speed: 5, bounce: 5 });
  const [color, setColor] = useState(PLAYER_COLORS[0]);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [rivalSeed, setRivalSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [raceKey, setRaceKey] = useState(0);
  const [circuitIndex, setCircuitIndex] = useState(0);
  const [season, setSeason] = useState<SeasonState | null>(() => loadSeason());
  const [account, setAccount] = useState(loadAccount);
  const accountRef = useRef(account);
  const [shopOpen, setShopOpen] = useState(false);
  const [raceId, setRaceId] = useState('');
  const [payout, setPayout] = useState<RacePayout | null>(null);

  // ---- online (MP-06) -----------------------------------------------------
  // The room lives here, not in a screen: a lobby, a race and the next race are
  // three screens on one socket, and the socket has to outlive all of them.
  const [room, setRoom] = useState<RaceRoom | null>(null);
  const [online, setOnline] = useState<OnlineRaceStart | null>(null);
  const [mpBusy, setMpBusy] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);
  /** MP-07: a quick-match search, and how many windows it has burned through. */
  const [search, setSearch] = useState<{ windows: number } | null>(null);
  const searchRef = useRef<Matchmaker<RaceRoom> | null>(null);
  /** True when this lobby came from matchmaking rather than a typed code. */
  const [quick, setQuick] = useState(false);
  /** MP-08: rivals whose socket dropped, held for a window before eviction. */
  const [peers, setPeers] = useState<PeerPresence[]>([]);
  /** The host's player id, from the room's own welcome. */
  const [hostId, setHostId] = useState<string | null>(null);
  /**
   * MP-09: the room's greeting, kept across a race. "Race again" returns to the
   * lobby, and a room only greets on a join — without this the lobby would come
   * back empty and wait for a hello that nobody is going to send.
   */
  const [greeting, setGreeting] = useState<WelcomeMsg | null>(null);
  /** Set when the host is gone for good: the race is over for everybody. */
  const [hostLeft, setHostLeft] = useState<string | null>(null);
  /** A wall clock that only runs while somebody is missing, for the countdown. */
  const [now, setNow] = useState(() => Date.now());
  /** MP-08: the race a return can offer back — a rejoin memo, and its room. */
  const [rejoin, setRejoin] = useState<ActiveMatchMemo | null>(null);
  const leaveRoom = useCallback(() => {
    setRoom(null);
    setOnline(null);
    setQuick(false);
    setPeers([]);
    setHostId(null);
    setGreeting(null);
    setHostLeft(null);
    setMpError(null);
    setPhase('menu');
  }, []);

  /**
   * The room, as the screens see it: intents go out through `send`, frames come
   * in through `onMessage`/`onPlayerLeft`, and whichever screen is live is the
   * one that has registered itself. The room is subscribed ONCE, below.
   */
  const link = useMemo<RaceLink>(() => ({ send: (msg: RaceProtocol) => room?.send(msg), onMessage: null, onPlayerLeft: null }), [room]);

  /**
   * MP-08: the room's OWN voice is this app's business, not a screen's — a drop
   * or a host walking out can land on a lobby or on a race, and either way the
   * answer is the same. Only race frames go down to the live screen.
   */
  const onRoomFrame = useCallback((msg: RaceProtocol) => {
    if (msg.type === 'peerStatus') {
      setPeers((list) => foldPeer(list, msg, Date.now()));
      return;
    }
    if (msg.type === 'welcome') {
      setHostId(msg.hostId);
      setGreeting(msg);
      link.onMessage?.(msg);
      return;
    }
    // Room full, race under way, host gone, or this driver taken off a grid.
    // The host leaving ends the race for everybody; being taken off ends it for
    // this driver, and the room says why — the platform's own `kick` arrives as
    // a socket that stopped talking, with nothing to show for it.
    if (msg.type === 'reject') {
      if (msg.reason === HOST_LEFT_REASON) {
        setHostLeft(msg.reason);
        return;
      }
      leaveRoom();
      setMpError(msg.reason);
      return;
    }
    link.onMessage?.(msg);
  }, [link, leaveRoom]);

  useEffect(() => {
    if (!room) return;
    room.on({
      onMessage: onRoomFrame,
      // TARGETED frames (everything the room says to this player alone: their own
      // greeting, and every guest frame the room forwards to the host) arrive
      // here, not on `onMessage` — the SDK keeps the two apart, and a client that
      // only listens for broadcasts hears none of them. Same handling: a frame is
      // a frame.
      onPrivateMessage: onRoomFrame,
      onPlayerLeft: (id) => link.onPlayerLeft?.(id),
      onError: (message) => setMpError(message),
      onDisconnect: () => setMpError('Lost the room — trying to get back in.'),
      onReconnected: () => setMpError(null),
    });
    // MP-10: the room's greeting was sent when this socket JOINED, which is
    // before any of this existed — `createRoom` and `joinRoomByCode` both hand
    // over a room that is already in. So ask for one: the room answers us and
    // nobody else.
    room.send({ type: 'hello' });
    // Unmounting (leaving the lobby, closing the tab) drops the room rather
    // than leaving a live socket — and a live seat — behind.
    return () => { room.leave(); void writeActiveMatch(null); };
  }, [room, link, onRoomFrame]);

  // A countdown is a clock. It runs only while somebody is missing: no drops,
  // no re-render.
  useEffect(() => {
    if (!peers.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [peers.length]);

  /**
   * The host's seat is held for a window; when it runs out the race is over,
   * whether or not the room gets round to saying so.
   */
  const hostDrop = hostId ? peerOf(peers, hostId) : null;
  const hostGone = hostLeft ?? (hostDrop && graceLeft(hostDrop, now) <= 0 ? 'The host never came back.' : null);

  /**
   * MP-08: the rejoin offer. The memo is written when a race is entered and
   * cleared when it is left — including by a crash or a closed tab, which is
   * precisely the case that must NOT clear it.
   */
  useEffect(() => {
    let live = true;
    void (async () => {
      const memo = await readActiveMatch();
      if (!live || !memo) return;
      // Ten minutes: a race is not a bookmark.
      if (Date.now() - memo.at > REJOIN_OFFER_MS) { void writeActiveMatch(null); return; }
      // And only while the room is still there to be rejoined. An EMPTY answer
      // is not "gone" — it is the platform not answering (signed out, no host
      // RPC), and clearing the memo for that would throw away the one case it
      // exists for.
      const rooms = await listRejoinableRooms();
      if (!live) return;
      if (rooms.length && !rooms.some((r) => r.roomCode === memo.roomCode)) { void writeActiveMatch(null); return; }
      setRejoin(memo);
    })();
    return () => { live = false; };
  }, []);

  /** This driver's garage: the tune from the garage panes, plus the livery. */
  const garage = useMemo<SeatGarage>(
    // MP-09: the kit goes with the garage — an online race spends what this
    // driver bought, not what the host happens to be carrying.
    () => ({ name: room?.players.find((p) => p.id === room.playerId)?.username || 'You', color, stats, portrait, inventory: account.inventory }),
    [room, color, stats, portrait, account.inventory],
  );

  /** Why a room did not open, in words a player can act on. */
  const explain = useCallback(async (err: unknown): Promise<string> => {
    if (isAccessDenied(err)) {
      // Anonymous: the platform's login sheet, and the AI is still there to race.
      const { success } = await promptLogin();
      return success ? 'Signed in — press Host, Join or Quick race again.' : 'Multiplayer needs a signed-in RUN.world account.';
    }
    return err instanceof Error ? err.message : String(err);
  }, []);

  const openRoom = useCallback(async (action: () => Promise<RaceRoom>) => {
    if (isOfflineMockRealtime()) { setMpError(NO_ROOM_SERVER_MESSAGE); return; }
    setMpBusy(true);
    setMpError(null);
    try {
      const next = await action();
      // The rejoin memo (MP-08): a drop is precisely the case that CANNOT clear
      // it, which is what lets a return offer the same race back.
      void writeActiveMatch({ roomCode: next.roomCode, at: Date.now() });
      setQuick(false);
      setRoom(next);
      setPhase('lobby');
    } catch (err) {
      setMpError(await explain(err));
    } finally {
      setMpBusy(false);
    }
  }, [explain]);

  /**
   * MP-07: QUICK RACE. One SDK request is one thirty-second window, so the loop
   * lives here — press the button, be in a race when somebody else presses it.
   */
  const findRace = useCallback(async () => {
    if (isOfflineMockRealtime()) { setMpError(NO_ROOM_SERVER_MESSAGE); return; }
    setMpError(null);
    setMpBusy(true);
    setSearch({ windows: 0 });
    const matchmaker = new Matchmaker<RaceRoom>({
      request: () => quickMatch(),
      isExpired: isMatchmakeWindowExpired,
      onWindowClosed: (windows) => setSearch({ windows }),
      // Paired on the way out: nobody is waiting in it, so leave it rather than
      // hold a seat in a room nobody can see.
      abandon: (room) => room.leave(),
    });
    searchRef.current = matchmaker;
    try {
      const next = await matchmaker.find();
      if (next) {
        void writeActiveMatch({ roomCode: next.roomCode, at: Date.now() });
        setQuick(true);
        setRoom(next);
        setPhase('lobby');
      } else {
        setMpError('Search cancelled — nobody was paired.');
      }
    } catch (err) {
      setMpError(await explain(err));
    } finally {
      setMpBusy(false);
      setSearch(null);
      searchRef.current = null;
    }
  }, [explain]);

  const cancelSearch = useCallback(() => searchRef.current?.cancel(), []);

  /**
   * MP-09: back to the lobby with the same room and the same seats — the host
   * may pick another circuit and drop the lights again.
   */
  const raceAgain = useCallback(() => {
    setOnline(null);
    setPayout(null);
    setPhase('lobby');
  }, []);


  /** MP-08: back into the race a dropped tab left (same code, same seat). */
  const rejoinRace = useCallback(() => {
    if (!rejoin) return;
    setRejoin(null);
    void openRoom(() => joinRoomByCode(rejoin.roomCode));
  }, [openRoom, rejoin]);

  const dismissRejoin = useCallback(() => {
    setRejoin(null);
    void writeActiveMatch(null);
  }, []);

  const startOnlineRace = useCallback((race: OnlineRaceStart) => {
    setOnline(race);
    setPayout(null);
    setRaceKey((k) => k + 1);
    setPhase('online');
  }, []);

  const onlineView = useMemo<OnlineRace | null>(
    () => (online ? { seats: online.seats, settings: online.settings, localSeat: online.localSeat, isHost: online.isHost, countdownAt: online.countdownAt, link } : null),
    [online, link],
  );
  const onlineRoster = useMemo(() => (online ? rosterOf(online.seats, online.localSeat) : []), [online]);
  const onlineGrid = useMemo(() => (online ? gridOrderOf(online.seats) : []), [online]);

  const publishAccount = useCallback((next: RacerAccount) => {
    accountRef.current = next;
    saveAccount(next);
    setAccount(next);
  }, []);
  useEffect(() => saveAccount(accountRef.current), []);
  const buy = useCallback((item: ItemType) => {
    const result = purchaseItem(accountRef.current, item);
    if (!result.error) publishAccount(result.account);
    return result.error;
  }, [publishAccount]);
  const inventoryChanged = useCallback((inventory: Inventory) => {
    publishAccount({ ...accountRef.current, inventory: { ...inventory } });
  }, [publishAccount]);
  /**
   * MP-09: an online race pays ITSELF, on every screen.
   *
   * There is no host banker: a host that could pay its guests could also simply
   * not pay them. So each client settles its own seat out of the host's
   * classification, at the online scale, and writes back the kit it came home
   * with. A race that never reached a classification — the host left, the
   * results never came — pays nothing at all.
   */
  const settleOnline = useCallback((rows: HeatResult[], kit?: Inventory) => {
    if (!online) return;
    const mine = rows.find((row) => row.id === online.localSeat);
    if (!mine) return;
    const raceId = onlineRaceId(room?.roomCode ?? 'race', online.countdownAt);
    const paid = settleOnlineRace(accountRef.current, raceId, mine);
    // What you came home with is what you have: spent is spent, picked is kept.
    publishAccount(kit ? { ...paid.account, inventory: normalizeInventory(kit) } : paid.account);
    setPayout(paid.payout);
  }, [online, publishAccount, room]);

  const awardWinnings = (results: HeatResult[]) => {
    const result = results.find((r) => r.id === 0);
    if (!result) return;
    const paid = settleRace(accountRef.current, raceId, result);
    publishAccount(paid.account);
    setPayout(paid.payout);
  };
  const openShop = () => setShopOpen(true);
  const withShop = (screen: ReactNode) => (
    <>
      {screen}
      {/* MP-08: a drop is not a phase's business — the strip rides over the
          lobby and the race alike. */}
      {peers.length > 0 && !hostGone && <PeerStrip peers={peers} hostId={hostId} now={now} />}
      {hostGone && <HostLeftOverlay message={hostGone} onLeave={leaveRoom} />}
      {shopOpen && <PitShop account={account} onBuy={buy} onClose={() => setShopOpen(false)} />}
    </>
  );
  const launchQuickRace = () => {
    setRaceId(`quick:${crypto.randomUUID()}`);
    setPayout(null);
    setRaceKey((k) => k + 1);
    const circuit = CALENDAR[circuitIndex];
    setLoading({ eyebrow: 'QUICK RACE / SINGLE HEAT', title: circuit.name.toUpperCase(), cta: 'Lights out', banter: preRaceBanter(quickRoster, Math.random), next: 'quick' });
  };

  useEffect(() => saveSeason(season), [season]);

  const rivals = useMemo(() => makeRivals(rivalSeed), [rivalSeed]);
  // A story counts as "to continue" once it has progress and the finale has not been played out yet.
  // Re-read whenever the garage is shown, so leaving story mode updates the button.
  const storyInProgress = useMemo(() => {
    if (phase !== 'menu') return false;
    const saved = loadStory();
    return !!saved && saved.finishedAt === null && (saved.chapter > 1 || saved.heat > 0 || saved.seenScenes.length > 0);
  }, [phase]);
  const quickRoster = useMemo<MarbleInfo[]>(() => [{ id: 0, name: 'You', color, stats, isPlayer: true, character: portrait }, ...rivals], [rivals, color, stats, portrait]);
  const quickGrid = useMemo(() => quickRoster.map((m) => m.id), [quickRoster]);
  const newSeed = useCallback(() => setSeed(Math.floor(Math.random() * 0xffffffff)), []);

  // ---- season helpers ----
  const startSeason = () => {
    if (season && !season.complete && season.results.some((gp) => gp.length) && !window.confirm('Start a new championship? This replaces your saved season.')) return;
    const s = newSeason(quickRoster);
    setSeason(s);
    setPhase('hub');
  };

  const seasonRoster = useMemo<MarbleInfo[]>(() => {
    if (!season) return [];
    return season.roster.map((m) => (m.isPlayer ? { ...m, stats, color, character: portrait } : m));
  }, [season, stats, color, portrait]);

  // sync player tune into the saved season roster when returning from retune
  const lockSetup = () => {
    if (season) setSeason({ ...season, roster: season.roster.map((m) => (m.isPlayer ? { ...m, stats, color } : m)) });
    setPhase('hub');
  };

  const enterSeason = (s: SeasonState) => {
    const me = s.roster.find((m) => m.isPlayer);
    if (me) {
      setStats(me.stats);
      setColor(me.color);
    }
    setSeason(s);
    setPhase('hub');
  };

  const seasonGrid = useMemo(() => (season && !season.complete ? gridOrder(season) : []), [season]);

  const [pendingResult, setPendingResult] = useState<HeatResult[] | null>(null);
  const onHeatFinished = (results: HeatResult[]) => {
    awardWinnings(results);
    setPendingResult(results);
    // Persist immediately, without replacing the active race's immutable roster or track.
    if (season) saveSeason(recordHeat(season, results));
  };
  const commitHeat = () => {
    if (season && pendingResult) {
      setSeason(recordHeat(season, pendingResult));
      setPendingResult(null);
    }
    setPhase('hub');
  };

  // ---- render ----
  if (loading) {
    const done = loading;
    return <LoadingScreen key={`${done.next}:${raceKey}`} eyebrow={done.eyebrow} title={done.title} cta={done.cta} banter={done.banter} onContinue={() => { setPhase(done.next); setLoading(null); }} />;
  }
  if (phase === 'menu' || phase === 'retune') {
    return withShop(
      <SetupScreen
        stats={stats}
        onStats={setStats}
        color={color}
        onColor={setColor}
        rivals={phase === 'retune' && season ? season.roster.filter((m) => !m.isPlayer) : rivals}
        onRerollRivals={() => setRivalSeed(Math.floor(Math.random() * 0xffffffff))}
        seed={seed}
        onNewSeed={newSeed}
        onStart={launchQuickRace}
        onStartSeason={startSeason}
        onContinueSeason={season && phase === 'menu' ? () => enterSeason(season) : undefined}
        seasonMode={phase === 'retune'}
        onBackToSeason={lockSetup}
        circuitIndex={circuitIndex}
        onCircuit={setCircuitIndex}
        account={account}
        onShop={openShop}
        portrait={portrait}
        onPortrait={setPortrait}
        onStartStory={() => setPhase('story')}
        storyInProgress={storyInProgress}
        mpBusy={mpBusy}
        mpError={mpError}
        onHostGame={() => void openRoom(createRoom)}
        onJoinGame={(code) => void openRoom(() => joinRoomByCode(code))}
        onQuickGame={() => void findRace()}
        rejoin={rejoin}
        onRejoin={rejoinRace}
        onDismissRejoin={dismissRejoin}
        searching={search !== null}
        windows={search?.windows ?? 0}
        onCancelSearch={cancelSearch}
      />
    );
  }

  // Online lobby (MP-06): the room the host opened, seen from either end.
  if (phase === 'lobby' && room) {
    return withShop(
      <OnlineLobby
        room={room}
        garage={garage}
        circuitIndex={circuitIndex}
        onCircuit={setCircuitIndex}
        onLeave={leaveRoom}
        onStart={startOnlineRace}
        link={link}
        autoStart={quick}
        peers={peers}
        greeting={greeting}
        error={mpError}
        onError={setMpError}
      />,
    );
  }

  // Story mode owns its own save, season and flow (ST-08); it only shares the wallet.
  if (phase === 'story') {
    return withShop(
      <StoryMode
        driver={{ name: 'Sprocket', color, portrait, stats }}
        account={account}
        onAccount={publishAccount}
        onShop={openShop}
        onExit={() => setPhase('menu')}
      />
    );
  }

  if (phase === 'hub' && season) {
    return withShop(
      <ChampionshipScreen
        season={season}
        onStartHeat={() => {
          setRaceId(`champ:${season.seed}:${season.round}:${season.results[season.round].length}`);
          setPayout(null);
          setRaceKey((k) => k + 1);
          const heatNo = season.results[season.round].length + 1;
          setLoading({ eyebrow: `ROUND ${String(season.round + 1).padStart(2, '0')} / HEAT ${heatNo} OF ${HEATS_PER_GP}`, title: CALENDAR[season.round].name.toUpperCase(), cta: 'Lights out', banter: preRaceBanter(seasonRoster, Math.random), next: 'race' });
        }}
        onRetune={() => { setCircuitIndex(season.round); setPhase('retune'); }}
        onAbandon={() => setPhase('menu')}
        onNewSeason={startSeason}
        account={account}
        onShop={openShop}
      />
    );
  }

  if (phase === 'race' && season) {
    const gp = CALENDAR[season.round];
    const heatNo = (season.results[season.round]?.length ?? 0) + 1;
    const isLastHeat = heatNo === HEATS_PER_GP;
    const actions: RaceAction[] = [
      { label: isLastHeat ? 'View Grand Prix results' : 'Standings & next heat', onClick: commitHeat, primary: true },
    ];
    return withShop(
      <RaceScreen
        key={raceKey}
        seed={gpSeed(season.seed, season.round)}
        roster={seasonRoster}
        profile={gp.profile}
        gridOrder={seasonGrid}
        title={gp.name}
        subtitle={`ROUND ${String(season.round + 1).padStart(2, '0')} / HEAT ${heatNo} OF ${HEATS_PER_GP}`}
        championship
        onExit={() => {
          setPendingResult(null);
          setPhase('hub');
        }}
        onFinished={onHeatFinished}
        actions={actions}
        inventory={account.inventory}
        credits={account.credits}
        onInventoryChange={inventoryChanged}
        payout={payout}
        onShop={openShop}
      />
    );
  }

  // online race (MP-06): the same screen, driven by a `RaceSession` instead of
  // its own `Game`. The host simulates and publishes; a guest draws the frames.
  if (phase === 'online' && online && onlineView) {
    const gp = CALENDAR[circuitIndexOf(online.settings)] ?? CALENDAR[0];
    const drivers = online.seats.filter((s) => !s.isAI).length;
    return withShop(
      <RaceScreen
        key={raceKey}
        seed={online.seed}
        roster={onlineRoster}
        profile={gp.profile}
        gridOrder={onlineGrid}
        title={gp.name}
        subtitle={`ONLINE / ${online.isHost ? 'HOSTING' : 'JOINED'} / ${drivers} DRIVERS`}
        onExit={leaveRoom}
        // MP-09: an online race settles this screen's own seat, at the online
        // scale, and writes back the kit it came home with.
        onFinished={settleOnline}
        actions={[
          { label: 'Race again', onClick: raceAgain, primary: true },
          { label: 'Back to the garage', onClick: leaveRoom },
        ]}
        inventory={account.inventory}
        credits={account.credits}
        onInventoryChange={inventoryChanged}
        payout={payout}
        onShop={openShop}
        online={onlineView}
      />,
    );
  }

  // quick race
  const quickActions: RaceAction[] = [
    { label: 'Race again', onClick: launchQuickRace, primary: true },
    {
      label: 'New layout',
      onClick: () => {
        newSeed();
        launchQuickRace();
      },
    },
    { label: 'Back to garage', onClick: () => setPhase('menu') },
  ];
  return withShop(
    <RaceScreen
      key={raceKey}
      seed={seed}
      roster={quickRoster}
      profile={CALENDAR[circuitIndex].profile}
      gridOrder={quickGrid}
      title={CALENDAR[circuitIndex].name}
      subtitle="QUICK RACE / SINGLE HEAT"
      onExit={() => setPhase('menu')}
      onFinished={awardWinnings}
      actions={quickActions}
      inventory={account.inventory}
      credits={account.credits}
      onInventoryChange={inventoryChanged}
      payout={payout}
      onShop={openShop}
    />
  );
}
