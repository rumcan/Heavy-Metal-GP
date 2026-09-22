import * as storage from './game/storage';
import { APP_VERSION, SEEN_VERSION_KEY } from './game/version';
import WhatsNew from './components/WhatsNew';
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
  isOfflineMockRealtime,
  joinRoomByCode,
  listRejoinableRooms,
  NO_ROOM_SERVER_MESSAGE,
  promptLogin,
  readActiveMatch,
  writeActiveMatch,
  type ActiveMatchMemo,
  type RaceRoom,
} from './net/transport';
import type { RaceProtocol } from './net/transport';
import { rankedQueue } from './net/ranked-queue';
import { isLadderAvailable, rankStore } from './net/rankstore';
import type { RankLadder } from './net/rankstore';
import { RankRuntime, raceRankSession } from './net/rank-runtime';
import { rankBoardFrom } from './net/rating';
import type { RankBoard, RankState, RaceVerdict } from './net/rating';
import { chipOf, chipOfWire, rankedViewFor } from './game/rank-view';
import type { RankChipLookup, RankedRaceView } from './game/rank-view';
import LadderDialog from './components/LadderDialog';
import type { RaceLink } from './net/session';
import { HOST_LEFT_REASON } from './net/protocol';
import type { WelcomeMsg } from './net/protocol';
import { foldPeer, graceLeft, peerOf, type PeerPresence } from './net/presence';
import { PeerStrip } from './components/PeerNotices';
import HostLeftOverlay from './components/PeerNotices';
import { circuitIndexOf, gridOrderOf, rosterOf } from './net/lobby';
import type { SeatGarage } from './net/lobby';
import { MarbleInfo, MarbleStats, AI_COLORS, randomStats, mulberry32, PLAYER_COLORS, HeatResult, HEATS_PER_GP } from './game/types';
import { SeasonState, newSeason, recordHeat, gridOrder, gpSeed, CALENDAR, saveSeason, loadSeason, roundTrack, roundName, setRoundTrack } from './game/season';
import { officialTrack } from './game/official-tracks';
import { loadAccount, saveAccount, purchaseItem, onlineRaceId, settleOnlineRace, settleRace, settleCustomRace } from './game/economy';
import type { RacerAccount, RacePayout } from './game/economy';
import { loadTracksSync } from './game/tracks';
import type { TrackDef } from './game/trackdef';
import { normalizeInventory } from './game/types';
import type { Inventory, ItemType } from './game/types';
import PitShop from './components/PitShop';
import { RIVALS, PLAYER_PORTRAIT_COUNT, preRaceBanter } from './game/characters';
import type { Line } from './game/characters';
import LoadingScreen from './components/LoadingScreen';
import StoryMode from './components/story/StoryMode';
import TrackEditor from './components/TrackEditor';
import CommunityScreen from './components/CommunityScreen';
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

type Phase = 'menu' | 'retune' | 'hub' | 'race' | 'quick' | 'story' | 'lobby' | 'online' | 'editor' | 'community';

export default function App() {
  const [phase, setPhase] = useState<Phase>('menu');
  // What's new: once per version, over the garage after the splash screen.
  const [whatsNew, setWhatsNew] = useState(() => storage.getItem(SEEN_VERSION_KEY) !== APP_VERSION);
  const closeWhatsNew = () => { storage.setItem(SEEN_VERSION_KEY, APP_VERSION); setWhatsNew(false); };
  const [loading, setLoading] = useState<Loading | null>({ eyebrow: 'SMALL GOBLINS. BIG BALLS. BIGGER DREAMS.', title: 'WELCOME TO THE GRID', cta: 'Enter the paddock', next: 'menu' });
  const [portrait, setPortrait] = useState(loadPortrait);
  useEffect(() => { try { storage.setItem(PORTRAIT_KEY, String(portrait)); } catch { /* storage unavailable */ } }, [portrait]);
  const [stats, setStats] = useState<MarbleStats>({ weight: 5, speed: 5, bounce: 5 });
  const [color, setColor] = useState(PLAYER_COLORS[0]);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [rivalSeed, setRivalSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [raceKey, setRaceKey] = useState(0);
  const [circuitIndex, setCircuitIndex] = useState(0);
  const [customTrackId, setCustomTrackId] = useState<string | null>(null);
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
  /** Auto Match Making: a search in flight. */
  const [search, setSearch] = useState<{ windows: number } | null>(null);
  const searchRef = useRef<{ cancel: () => void } | null>(null);
  /** True when this lobby came from matchmaking rather than a typed code. */
  const [quick, setQuick] = useState(false);
  /** MP-08: rivals whose socket dropped, held for a window before eviction. */
  const [peers, setPeers] = useState<PeerPresence[]>([]);
  /** The host's player id, from the room's own welcome. */
  const [hostId, setHostId] = useState<string | null>(null);

  // ---- ranked (RK-05) ------------------------------------------------------
  /** This driver's own rating file, and the room's board of everyone's. */
  const [rank, setRank] = useState<RankState | null>(null);
  const [board, setBoard] = useState<RankBoard>({});
  /** The race-time half (RK-03). One per room; held in a ref, not render state. */
  const runtimeRef = useRef<RankRuntime | null>(null);
  /** True when the race that is running (or just finished) counts. */
  const [rankedRace, setRankedRace] = useState(false);
  /** The room's verdict on the race, once it has filed one. */
  const [rankResult, setRankResult] = useState<{ verdict: RaceVerdict; stored: boolean } | null>(null);
  /** The ladder panel: open, and what the board answered. */
  const [ladderOpen, setLadderOpen] = useState(false);
  const [ladder, setLadder] = useState<RankLadder | null>(null);
  const [ladderLoading, setLadderLoading] = useState(false);
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
  // MB-08: decoded custom track for the online race (host and guest decode from settings.customCode)
  const [onlineCustomDef, setOnlineCustomDef] = useState<TrackDef | null>(null);
  const leaveRoom = useCallback(() => {
    setRoom(null);
    setOnline(null);
    setOnlineCustomDef(null);
    setQuick(false);
    setPeers([]);
    setHostId(null);
    setGreeting(null);
    setHostLeft(null);
    setMpError(null);
    // RK-05: the verdict belonged to the room that just closed.
    setRankResult(null);
    setRankedRace(false);
    setPhase('menu');
  }, []);

  /**
   * RK-05: this driver's own rating file, read once when the page mounts. The
   * garage header prints it before any room exists, and `findRace` reads it
   * again on the way into the queue — a rating that moved in another tab must
   * not steer THIS search, which is why the queue asks for it fresh.
   */
  useEffect(() => {
    let live = true;
    void rankStore().loadState().then((state) => { if (live) setRank(state); });
    return () => { live = false; };
  }, []);

  /**
   * The room, as the screens see it: intents go out through `send`, frames come
   * in through `onMessage`/`onPlayerLeft`, and whichever screen is live is the
   * one that has registered itself. The room is subscribed ONCE, below.
   */
  const link = useMemo<RaceLink>(() => ({ send: (msg: RaceProtocol) => room?.send(msg), onMessage: null, onPlayerLeft: null }), [room]);

  /**
   * RK-03, wired (RK-05): one `RankRuntime` per ROOM, built the moment a
   * socket exists so this driver's rating is published while the lobby fills —
   * a chip on every seat is worth more before the lights than after them.
   *
   * It is torn down with the room (`room` is the dependency), and the roster
   * and ratedness are handed over at the start, when the lobby has settled
   * both (`setRoster` / `setRated`).
   */
  useEffect(() => {
    if (!room) { runtimeRef.current = null; setBoard({}); return; }
    const rt = new RankRuntime({
      session: raceRankSession(link, room.playerId),
      store: rankStore(),
      // Fired once the verdict has been folded into this driver's own file.
      onVerdict: (verdict) => {
        setRank(verdict.state);
        setRankResult({ verdict, stored: runtimeRef.current?.outcome?.stored ?? true });
      },
    });
    runtimeRef.current = rt;
    void rt.start();
  }, [room, link]);

  /** RK-05: a seat's chip — this driver's own file where it is theirs, else the room's board. */
  const rankOf = useCallback<RankChipLookup>((playerId) => {
    if (room && playerId === room.playerId && rank) return chipOf(rank);
    return board[playerId] ? chipOfWire(board[playerId]) : null;
  }, [room, rank, board]);

  /**
   * RK-05: the ladder panel. The board is read through the store (the one door
   * to the platform's leaderboard) at the moment it opens, and every way the
   * read can fail is a state the panel prints: no board behind this page, no
   * answer, an empty board, rows.
   */
  const openLadder = useCallback(() => {
    setLadderOpen(true);
    setLadderLoading(true);
    void rankStore().loadLadder(50)
      .then((result) => setLadder(result))
      .catch(() => setLadder(null))
      .finally(() => setLadderLoading(false));
  }, []);


  /**
   * RK-05: fold a board update into BOTH copies of it — the runtime's (which a
   * verdict is computed from) and React's (which the chips are painted from).
   * Merged, never replaced: a partial update must not erase a driver's number.
   */
  const applyBoard = useCallback((ratings: Parameters<typeof rankBoardFrom>[0]) => {
    const next = rankBoardFrom(ratings);
    runtimeRef.current?.applyBoard(next);
    setBoard((prev) => ({ ...prev, ...next }));
  }, []);

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
      // RK-05: the greeting carries the room's rating board (RK-03), so the
      // first look at a lobby already shows the numbers that are known.
      if (msg.ratings?.length) applyBoard(msg.ratings);
      link.onMessage?.(msg);
      return;
    }
    // RK-03 (RK-05): the room's board, relayed whenever a driver publishes.
    // A driver's own number feeds the seats' chips; a race is rated from the
    // same board, so it is kept whole rather than per-seat.
    if (msg.type === 'ratingUpdate') {
      if (msg.ratings?.length) applyBoard(msg.ratings);
      return;
    }
    // RK-03: the room's verdict on a race. It is the ONLY thing that moves a
    // rating — the clients recompute the arithmetic from the same board and
    // classification the room stamped — and it never goes down to the race
    // screen, which has its own `results` (the classification) to draw.
    if (msg.type === 'result') {
      void runtimeRef.current?.handleResult(msg);
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
      return success ? 'Signed in — press Host, Join or Auto Match Making again.' : 'Multiplayer needs a signed-in RUN.world account.';
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
   * AUTO MATCH MAKING (RK-04): the RANKED queue. The search starts in this
   * driver's rank bucket and widens a rung at a time until it finds whoever is
   * waiting — so "searching" is a state a player can sit in, counting the
   * windows, with Cancel under it (a queue that gave up would be guessing at a
   * pool it cannot see).
   *
   * The rating comes off the driver's own file (`rankStore().loadState()`,
   * fresh 1000 for a player who has never raced), read once when the button is
   * pressed. A room that lands here is a matchmade room, which is the fact
   * RK-03's rated wire hangs off; a lobby opened by hand is not.
   */
  const findRace = useCallback(async () => {
    if (isOfflineMockRealtime()) { setMpError(NO_ROOM_SERVER_MESSAGE); return; }
    setMpError(null);
    setMpBusy(true);
    // The ladder is this driver's own rating, read once from their file (a
    // fresh 1000 for a driver who has never raced). The read comes BEFORE the
    // "searching" state goes up, so Cancel always has a search to stop.
    const { rating } = await rankStore().loadState();
    setSearch({ windows: 0 });
    let cancelled = false;
    const search = rankedQueue(rating, { onWindowClosed: (windows) => setSearch({ windows }) });
    searchRef.current = { cancel: () => { cancelled = true; search.cancel(); } };
    try {
      const next = await search.find();
      if (!next) { setMpError('Auto Match Making cancelled.'); return; }
      void writeActiveMatch({ roomCode: next.roomCode, at: Date.now() });
      setQuick(true);
      setRoom(next);
      setPhase('lobby');
    } catch (err) {
      // A cancelled search resolves `null` rather than throwing, so anything
      // that reaches here is the platform's own failure and belongs on screen.
      if (!cancelled) setMpError(await explain(err));
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
    // keep onlineCustomDef for next race if host reuses same settings; it will be refreshed on next start
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

  const startOnlineRace = useCallback(async (race: OnlineRaceStart) => {
    setOnline(race);
    setPayout(null);
    // RK-05: the lights are about to go out, so the lobby's two late decisions
    // are handed to the rating runtime — the grid it files a claim from, and
    // whether this lobby is a RATED one (Quick race, no house-rule power-ups).
    runtimeRef.current?.setRoster(race.seats.map((seat) => ({ slot: seat.slot, playerId: seat.playerId, isAI: seat.isAI })));
    runtimeRef.current?.setRated(race.rated === true);
    setRankedRace(race.rated === true);
    setRankResult(null);
    setRaceKey((k) => k + 1);
    const code = (race.settings as unknown as { customCode?: string })?.customCode;
    if (code) {
      try {
        const { decodeShareCode } = await import('./game/sharecode');
        const def = await decodeShareCode(code);
        setOnlineCustomDef(def);
      } catch (err) {
        console.warn('Custom track decode failed', err);
        setOnlineCustomDef(null);
        setMpError(err instanceof Error ? err.message : 'Custom track is invalid — falling back to calendar.');
      }
    } else {
      setOnlineCustomDef(null);
    }
    setPhase('online');
  }, []);

  const onlineView = useMemo<OnlineRace | null>(
    () => (online ? { seats: online.seats, settings: online.settings, localSeat: online.localSeat, isHost: online.isHost, countdownAt: online.countdownAt, link } : null),
    [online, link],
  );
  const onlineRoster = useMemo(() => (online ? rosterOf(online.seats, online.localSeat) : []), [online]);

  /**
   * RK-05: what the results screen may say about the rating — this driver's own
   * line (badge, new number, signed delta, tier callout) plus a row per rated
   * human for the table. Null for a race with no room behind it (every offline
   * heat): the panel only exists where a rating can move.
   */
  const rankView = useMemo<RankedRaceView | null>(() => {
    if (!online) return null;
    const names: Record<string, string> = {};
    for (const seat of online.seats) if (!seat.isAI && seat.playerId) names[seat.playerId] = seat.name;
    return rankedViewFor({
      verdict: rankResult?.verdict ?? null,
      rated: rankedRace,
      stored: rankResult?.stored,
      names,
      seats: online.seats.map((seat) => ({ slot: seat.slot, playerId: seat.playerId })),
      current: rank ? chipOf(rank) : null,
    });
  }, [online, rankResult, rankedRace, rank]);
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
  /**
   * RK-03 (RK-05): HOST only — the flag has fallen, so claim the classification.
   *
   * This is the ONE place a race's rating is set in motion: the room checks the
   * claim against what it saw, stamps it with its own clock and board, and
   * broadcasts `result` to every seat (this one included), which is what
   * `onRoomFrame` folds in. The guests do nothing here — they have no
   * standing to say who crossed the line.
   *
   * The classification arrives as the results screen's rows (seat order), so it
   * is re-sorted into finishing order and handed over in `claimFinish`'s shape.
   * `durationSec` is the last finisher's time: the ladder board bounds a race by
   * its length, and a race everyone DNF'd is a second.
   */
  const claimRanked = useCallback((rows: readonly HeatResult[]) => {
    const runtime = runtimeRef.current;
    if (!runtime || !online?.isHost) return;
    const byRank = [...rows].sort((a, b) => a.rank - b.rank);
    const order = byRank.map((row) => row.id);
    const times: (number | null)[] = [];
    for (const row of byRank) times[row.id] = row.time;
    const last = byRank.reduce((ms, row) => Math.max(ms, row.time ?? 0), 0);
    runtime.claimFinish({ order, times }, Math.max(1, Math.round(last / 1000)));
  }, [online]);

  const settleOnline = useCallback((rows: HeatResult[], kit?: Inventory) => {
    if (!online) return;
    claimRanked(rows);
    const mine = rows.find((row) => row.id === online.localSeat);
    if (!mine) return;
    const raceId = onlineRaceId(room?.roomCode ?? 'race', online.countdownAt);
    const isCustom = !!(online.settings as unknown as { customCode?: string })?.customCode;
    const paid = isCustom ? settleCustomRace(accountRef.current, raceId, mine, true) : settleOnlineRace(accountRef.current, raceId, mine);
    // What you came home with is what you have: spent is spent, picked is kept.
    publishAccount(kit ? { ...paid.account, inventory: normalizeInventory(kit) } : paid.account);
    setPayout(paid.payout);
  }, [online, publishAccount, room, claimRanked]);

  /** `isCustom`: the heat ran on a player-built track (pays 30%). Quick races pass the Garage pick; a championship heat its round's track. */
  const awardWinnings = (results: HeatResult[], isCustom = !!customTrackDef) => {
    const result = results.find((r) => r.id === 0);
    if (!result) return;
    const paid = isCustom ? settleCustomRace(accountRef.current, raceId, result, false) : settleRace(accountRef.current, raceId, result);
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
      {/* RK-05: the ladder. It rides above every phase — the garage header and
          the lobby both open it, and a climb is worth checking mid-evening. */}
      {ladderOpen && <LadderDialog
        ladder={ladder}
        loading={ladderLoading}
        available={isLadderAvailable()}
        mine={rank ? chipOf(rank) : chipOfWire(null)}
        onRetry={openLadder}
        onClose={() => setLadderOpen(false)}
      />}
      {shopOpen && <PitShop account={account} onBuy={buy} onClose={() => setShopOpen(false)} />}
      {whatsNew && phase === 'menu' && <WhatsNew onClose={closeWhatsNew} onWorkshop={() => { closeWhatsNew(); setPhase('editor'); }} />}
    </>
  );
  const launchQuickRace = () => {
    setRaceId(`quick:${crypto.randomUUID()}`);
    setPayout(null);
    setRaceKey((k) => k + 1);
    if (customTrackDef) {
      setLoading({ eyebrow: 'QUICK RACE / CUSTOM HEAT', title: customTrackDef.name.toUpperCase(), cta: 'Lights out', banter: preRaceBanter(quickRoster, Math.random), next: 'quick' });
    } else {
      const circuit = CALENDAR[circuitIndex];
      setLoading({ eyebrow: 'QUICK RACE / SINGLE HEAT', title: circuit.name.toUpperCase(), cta: 'Lights out', banter: preRaceBanter(quickRoster, Math.random), next: 'quick' });
    }
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
  const customTrack = customTrackId ? loadTracksSync().find((t) => t.id === customTrackId) ?? null : null;
  const customTrackDef: TrackDef | null = customTrack?.def ?? null;
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
    awardWinnings(results, !!(season && season.tracks?.[season.round]));
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
        rank={rank ? chipOf(rank) : null}
        onRank={openLadder}
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
        customTrackId={customTrackId}
        onSelectCustom={setCustomTrackId}
        account={account}
        onShop={openShop}
        portrait={portrait}
        onPortrait={setPortrait}
        onStartStory={() => setPhase('story')}
        onWorkshop={() => setPhase('editor')}
        onCommunity={() => setPhase('community')}
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

  // The Workshop (MB-02): the track editor, opening on a copy of the circuit the garage is showing
  // (the official archive when there is one, else a generated circuit). Fixes start from the real thing.
  if (phase === 'editor') {
    const gp = CALENDAR[circuitIndex];
    return <TrackEditor
      seed={seed}
      profile={gp.profile}
      name={gp.name}
      initialDef={officialTrack(circuitIndex)}
      driver={quickRoster[0]}
      onExit={() => setPhase('menu')}
      onCommunity={() => setPhase('community')}
    />;
  }

  // Community tracks: browse, upvote and copy other players' tracks into My tracks.
  if (phase === 'community') {
    return withShop(<CommunityScreen account={account} onShop={openShop} onGarage={() => setPhase('menu')} onWorkshop={() => setPhase('editor')} />);
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
        rankOf={rankOf}
        onRank={openLadder}
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
          setLoading({ eyebrow: `ROUND ${String(season.round + 1).padStart(2, '0')} / HEAT ${heatNo} OF ${HEATS_PER_GP}`, title: roundName(season, season.round).toUpperCase(), cta: 'Lights out', banter: preRaceBanter(seasonRoster, Math.random), next: 'race' });
        }}
        onRetune={() => { setCircuitIndex(season.round); setPhase('retune'); }}
        onAbandon={() => setPhase('menu')}
        onNewSeason={startSeason}
        onChangeTrack={(round, def) => setSeason(setRoundTrack(season, round, def))}
        account={account}
        onShop={openShop}
      />
    );
  }

  if (phase === 'race' && season) {
    const gp = CALENDAR[season.round];
    const roundDef = roundTrack(season, season.round);
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
        trackDef={roundDef}
        isCustom={!!season.tracks?.[season.round]}
        title={roundName(season, season.round)}
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
    const isCustomOnline = !!(online.settings as unknown as { customCode?: string })?.customCode;
    const gp = isCustomOnline && onlineCustomDef ? { name: onlineCustomDef.name, profile: CALENDAR[0].profile } as unknown as typeof CALENDAR[0] : CALENDAR[circuitIndexOf(online.settings)] ?? CALENDAR[0];
    const drivers = online.seats.filter((s) => !s.isAI).length;
    return withShop(
      <RaceScreen
        key={raceKey}
        seed={online.seed}
        roster={onlineRoster}
        profile={gp.profile}
        trackDef={onlineCustomDef}
        gridOrder={onlineGrid}
        title={gp.name}
        isCustom={isCustomOnline}
        subtitle={`ONLINE / ${online.isHost ? 'HOSTING' : 'JOINED'} / ${drivers} DRIVERS${isCustomOnline ? ' / CUSTOM' : ''}`}
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
        rating={rankView}
      />,
    );
  }

  // quick race
  const quickActions: RaceAction[] = [
    { label: 'Race again', onClick: launchQuickRace, primary: true },
    { label: 'Back to garage', onClick: () => setPhase('menu') },
  ];
  // MB-08: quick race on a custom circuit — title/seed/profile follow the def when present.
  // Calendar circuits race the official archives: no quick-race layout is generated either.
  const quickDef = customTrackDef ?? officialTrack(circuitIndex);
  const quickProfile = customTrackDef ? CALENDAR[0].profile : CALENDAR[circuitIndex].profile;
  const quickTitle = customTrackDef ? customTrackDef.name : CALENDAR[circuitIndex].name;
  const quickSubtitle = customTrackDef ? `QUICK RACE / CUSTOM // ${customTrackDef.pieces.length} PCS` : "QUICK RACE / SINGLE HEAT";
  return withShop(
    <RaceScreen
      key={raceKey}
      seed={seed}
      roster={quickRoster}
      profile={quickProfile}
      trackDef={quickDef}
      gridOrder={quickGrid}
      title={quickTitle}
      isCustom={!!customTrackDef}
      subtitle={quickSubtitle}
      onExit={() => setPhase('menu')}
      onFinished={(results) => awardWinnings(results)}
      actions={quickActions}
      inventory={account.inventory}
      credits={account.credits}
      onInventoryChange={inventoryChanged}
      payout={payout}
      onShop={openShop}
    />
  );
}
