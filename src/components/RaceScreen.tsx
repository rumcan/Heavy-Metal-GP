import * as storage from '../game/storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { nudgeOf } from '../game/controls';
import { ArrowLeft, ArrowRight, Pause, Play, Flag, ChevronRight, FastForward, Timer, Gauge, Coins, MessageCircle, Snowflake, ZoomIn, ZoomOut, Volume2, VolumeX } from 'lucide-react';
import { CHAT_BUBBLE_MS, canSay, chatMessage, MAX_CHAT_LENGTH, offCooldown, speakerOf, trimChatText } from '../net/chat';
import type { ChatMsg } from '../net/protocol';
import { raceAudio } from '../game/audio';
import { Game } from '../game/engine';
import { RaceSession } from '../net/session';
import type { RaceLink } from '../net/session';
import type { RaceSettings, Seat } from '../net/protocol';
import { render } from '../game/render';
import { W } from '../game/track';
import type { Track } from '../game/track';
import { HEAT_TIME_LIMIT, PHYSICS_STEP, formatTime } from '../game/physics';
import { teamOf, ITEM_TYPES, emptyInventory, normalizeInventory } from '../game/types';
import type { MarbleInfo, ItemType, TrackProfile, HeatResult, Inventory } from '../game/types';
import type { TrackDef } from '../game/trackdef';
import type { RacePayout } from '../game/economy';
import { pointsFor } from '../game/season';
import Brand from './Brand';
import Dialog from './Dialog';
import InventoryToolbar from './InventoryToolbar';
import RaceMinimap from './RaceMinimap';
import RaceBubbles from './RaceBubbles';
import type { SpeechBubble } from './RaceBubbles';
import RaceResults from './RaceResults';
import type { RaceAction } from './RaceResults';
import type { RankedRaceView } from '../game/rank-view';
import StoryRaceOverlay from './story/StoryRace';
import type { StoryRaceProps } from './story/StoryRace';
export type { RaceAction } from './RaceResults';

interface Props {
  seed: number; roster: MarbleInfo[]; profile: TrackProfile; gridOrder: number[];
  /** MB-08: a player-built circuit — when present the `seed` still seeds RNG but the track is built from the def. */
  trackDef?: TrackDef | null;
  title: string; subtitle: string; championship?: boolean;
  onExit: () => void;
  /**
   * The classification, plus (online) the kit the local driver came home with —
   * the wallet is settled from both (MP-09).
   */
  onFinished: (results: HeatResult[], kit?: Inventory) => void;
  actions: RaceAction[];
  inventory: Inventory; credits: number;
  onInventoryChange: (inventory: Inventory) => void;
  payout: RacePayout | null;
  onShop: () => void;
  /** MB-08: show reduced-payout note when the heat was on a custom circuit. */
  isCustom?: boolean;
  /** Story mode only (ST-03/ST-07): mid-race beats, objective chips and chapter engine hooks. */
  story?: StoryRaceProps;
  /**
   * MP-06: an ONLINE race. When this is set the screen does not own the world —
   * a `RaceSession` does, and it is either the simulation (host) or the picture
   * of one (guest). Everything else on this screen is unchanged: it still reads
   * a `Game`, it just no longer steps it.
   */
  online?: OnlineRace;
  /**
   * RK-05: the ranked outcome of an online race — badge, delta and tier
   * callouts on the results, and a rating row per rated human. Absent (every
   * offline heat, and a race with no room behind it) means no rating panel:
   * nothing can have moved. Null inside an online race means the panel is not
   * a rated one, which is itself worth printing.
   */
  rating?: RankedRaceView | null;
}

/** What an online race needs that an offline one does not. */
export interface OnlineRace {
  /** The grid, in slot order — the host's grid, or the guest's copy of it. */
  seats: Seat[];
  settings: RaceSettings;
  /** Which marble is mine. */
  localSeat: number;
  /** True when this screen is the one that simulates. */
  isHost: boolean;
  /** The wall-clock instant the gate opens, published by the lobby. */
  countdownAt: number;
  /** The room: where intents go, and where frames come from. */
  link: RaceLink;
}
const ZOOM_KEY = 'heavy-metal-gp:zoom';
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2.5;
function loadZoom(): number {
  try { const n = Number(storage.getItem(ZOOM_KEY)); return n >= ZOOM_MIN && n <= ZOOM_MAX ? n : 1; } catch { return 1; }
}

interface LiveRow { id: number; rank: number; time: number | null; x: number; y: number }
interface Hud {
  rank: number; time: number; inventory: Inventory; remaining: Record<ItemType, number>; coolingDown: boolean; speed: number; cap: number;
  /** DEV probe (MP-10): the local marble's position, read by the browser suite. */
  mx: number; my: number;
  lights: number; finished: boolean; playerTime: number | null; pegs: number;
  sector: string; sectorIndex: number; progress: number; state: string;
  frozen: boolean; field: LiveRow[]; finishedCount: number; following: string;
  viewTop: number; viewBottom: number;
}

export default function RaceScreen({ seed, roster, profile, gridOrder, trackDef, title, subtitle, onExit, onFinished, actions, championship = false, inventory, credits, onInventoryChange, payout, onShop, isCustom = false, story, online, rating = null }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  /** MP-06: the online session, when there is one. The host's simulation or the guest's picture. */
  const sessionRef = useRef<RaceSession | null>(null);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  /** Which marble is mine — the seat, online; the player, offline. */
  const playerId = roster.find((m) => m.isPlayer)?.id ?? 0;
  const controls = useRef({ left: false, right: false, touch: 0 });
  const pausedRef = useRef(false);
  const fastRef = useRef(1);
  const zoomRef = useRef(loadZoom());
  const [zoom, setZoomState] = useState(zoomRef.current);
  const setZoom = useCallback((value: number) => {
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
    zoomRef.current = next;
    setZoomState(next);
    try { storage.setItem(ZOOM_KEY, String(next)); } catch { /* storage unavailable */ }
  }, []);
  const doneRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(() => raceAudio.loadPreference());
  const toggleMute = useCallback(() => { raceAudio.unlock(); raceAudio.setMuted(!raceAudio.muted); setMuted(raceAudio.muted); }, []);
  const [confirmExit, setConfirmExit] = useState(false);
  const [fast, setFast] = useState(1);
  const [toast, setToast] = useState<{ message: string; color: string } | null>(null);
  const [results, setResults] = useState<HeatResult[] | null>(null);
  const [mapTrack, setMapTrack] = useState<Track | null>(null);
  // ── MP-CHAT: race talk, as a bubble over the marble that said it ─────────
  /**
   * Mid-race a line is a BUBBLE, not a log: it rides over its own marble and
   * clears itself a few seconds later. No scrollback and no panel — nobody is
   * reading a conversation while they are driving, and the lobby is where a
   * conversation lives.
   */
  const [bubbles, setBubbles] = useState<SpeechBubble[]>([]);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  /** Read by the keyboard handler, which is installed once per race. */
  const composingRef = useRef(false);
  composingRef.current = composing;
  const bubbleSeq = useRef(0);
  const bubbleTimers = useRef(new Set<number>());
  /** The layer the bubbles sit in — the loop pins them to their marbles. */
  const bubbleLayer = useRef<HTMLDivElement>(null);
  /** MP-CHAT: local clock when this driver last spoke (the cooldown). */
  const lastSaidAt = useRef(-Infinity);
  /** MP-CHAT: whose voice this screen is, so its own echo is not printed twice. */
  const myPlayerId = online?.seats.find((seat) => seat.slot === online.localSeat)?.playerId ?? '';
  /** Read by the room's message handler, which is subscribed once per race. */
  const chatSink = useRef<(msg: ChatMsg) => void>(() => {});
  const initialInventory = useRef(normalizeInventory(inventory));
  const inventoryCallback = useRef(onInventoryChange);
  inventoryCallback.current = onInventoryChange;
  const selectedRef = useRef<ItemType>(ITEM_TYPES.find((item) => inventory[item] > 0) ?? 'rocket');
  const [selected, setSelected] = useState<ItemType>(selectedRef.current);
  const [hud, setHud] = useState<Hud>({
    rank: Math.max(0, gridOrder.indexOf(playerId)) + 1, time: 0, inventory: { ...initialInventory.current }, remaining: emptyInventory(), coolingDown: false, speed: 0, cap: 100, lights: 0, mx: 0, my: 0,
    finished: false, playerTime: null, pegs: 0, sector: 'Starting grid', sectorIndex: 0,
    progress: 0, state: 'ON THE GRID', frozen: false, finishedCount: 0, following: 'You',
    field: gridOrder.map((id, i) => ({ id, rank: i + 1, time: null, x: 60 + i * 86, y: 116 })),
    viewTop: 0, viewBottom: 700,
  });
  const finishedCallback = useRef(onFinished);
  finishedCallback.current = onFinished;
  /**
   * Deploy an item. Offline the game spends it; online the HOST spends it — a
   * guest's button is a request, and the state frames are the answer.
   */
  const useItem = useCallback((item: ItemType) => {
    const session = sessionRef.current;
    if (session) session.useItem(item);
    else gameRef.current?.usePlayerItem(item);
  }, []);

  /**
   * MP-CHAT: put a line over a marble.
   *
   * One bubble per marble: a second line from the same driver REPLACES the
   * first rather than stacking above it, because two bubbles over one ball is
   * a rendering problem and the newest line is the one worth reading. The
   * expiry is a timer, not the race clock — a bubble clears on wall time
   * whether the race is running, paused or over.
   */
  const showBubble = useCallback((from: string, text: string) => {
    const speaker = speakerOf(onlineRef.current?.seats ?? [], from);
    // A voice with no marble has nowhere to put a bubble.
    if (speaker.seat === null) return;
    const seat = speaker.seat;
    const mine = seat === onlineRef.current?.localSeat;
    const id = ++bubbleSeq.current;
    setBubbles((list) => [...list.filter((b) => b.seat !== seat), { id, seat, text: trimChatText(text), name: mine ? 'YOU' : speaker.name, color: speaker.color }]);
    const timer = window.setTimeout(() => {
      bubbleTimers.current.delete(timer);
      setBubbles((list) => list.filter((b) => b.id !== id));
    }, CHAT_BUBBLE_MS);
    bubbleTimers.current.add(timer);
  }, []);

  // MP-CHAT: the room's frames reach a bubble through this sink. The
  // subscription lives in the effect below (one per race, like the session).
  useEffect(() => {
    chatSink.current = (msg) => {
      // The ROOM stamped the author, so a line can never be printed under a
      // name its sender did not own. Mine comes back to me as well — it is
      // already on the screen, put there by `say` before the round trip.
      if (!msg.from || msg.from === myPlayerId) return;
      showBubble(msg.from, msg.text);
    };
    const timers = bubbleTimers.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
    };
  }, [myPlayerId, showBubble]);

  /** MP-CHAT: say a line — to everybody in this race, over my marble. True when it went out. */
  const say = useCallback((raw: string): boolean => {
    const link_ = onlineRef.current?.link;
    const text = trimChatText(raw);
    if (!link_ || !canSay(text)) return false;
    const now = Date.now();
    // A held key is not a sentence. The room would relay every one of them.
    if (!offCooldown(now, lastSaidAt.current)) return false;
    lastSaidAt.current = now;
    link_.send(chatMessage(text));
    // Printed now rather than on the echo: the room's copy is a round trip
    // away, and a bubble that lags the key press reads as a dropped line.
    showBubble(myPlayerId, text);
    return true;
  }, [myPlayerId, showBubble]);

  /**
   * MP-CHAT: the compose bar. `T` opens it, Enter sends, Escape closes — and
   * while it is open the keyboard belongs to the input, not the marble (the
   * key handler ignores events from a focused field).
   */
  const openCompose = useCallback(() => {
    if (!onlineRef.current || doneRef.current) return;
    setDraft('');
    setComposing(true);
  }, []);
  const closeCompose = useCallback(() => { setComposing(false); setDraft(''); }, []);
  const submitChat = (event: React.FormEvent) => {
    event.preventDefault();
    // A line the cooldown swallowed leaves the bar open with the text still in
    // it, so Enter again a moment later works instead of losing the sentence.
    if (say(draft)) closeCompose();
  };
  const setPause = useCallback((value: boolean) => {
    pausedRef.current = value;
    controls.current = { left: false, right: false, touch: 0 };
    const game = gameRef.current;
    if (value && game) {
      // Freeze the displayed timers at the same instant as the simulation, not the last HUD tick.
      const remaining = emptyInventory();
      for (const item of ITEM_TYPES) remaining[item] = game.itemRemaining(game.player, item);
      setHud((previous) => ({ ...previous, time: game.player.finishedAt ?? game.raceTime(), remaining, inventory: { ...game.player.inventory }, coolingDown: game.time < game.player.itemCooldownUntil }));
    }
    setPaused(value);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    // MP-06: online, the session owns the world and the screen only draws it.
    // Offline, the screen builds its own Game, exactly as it always has.
    const link = onlineRef.current?.link ?? null;
    const session = onlineRef.current
      ? new RaceSession({
          seed,
          seats: onlineRef.current.seats,
          settings: onlineRef.current.settings,
          profile,
          trackDef: trackDef ?? undefined,
          localSeat: onlineRef.current.localSeat,
          isHost: onlineRef.current.isHost,
          countdownAt: onlineRef.current.countdownAt,
          send: (msg) => link?.send(msg),
        })
      : null;
    sessionRef.current = session;
    const game = session ? session.game : new Game(seed, roster, { profile, gridOrder, inventory: initialInventory.current, story: story?.hooks, def: trackDef ?? undefined });
    // Online, this screen does not own the wallet: the race inventory is the
    // host's book until MP-09 puts each driver's own items on the grid, and a
    // pickup here must not empty the account it was bought with.
    if (!session) game.onInventoryChange = (items) => inventoryCallback.current(items);
    setMapTrack(game.track);
    gameRef.current = game;
    // Frames from the room go to whichever screen is live. The room is
    // subscribed once (in App); this is the screen raising its hand.
    if (link) link.onMessage = (msg) => {
      sessionRef.current?.accept(msg);
      // MP-CHAT: talk is not the world, so the session has no business with
      // it — a line is siphoned off here on its way past the simulation.
      if (msg.type === 'chat') chatSink.current(msg);
    };
    doneRef.current = false;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    game.onEvent = (message, color = '#d63e2e') => {
      clearTimeout(toastTimer);
      setToast({ message, color });
      toastTimer = setTimeout(() => setToast(null), 2400);
    };
    const camera = { x: W / 2, y: game.track.startY + 150, scale: 1 };
    let width = 0;
    let height = 0;
    let raf = 0;
    let last = performance.now();
    /** When the online session was last advanced (by a frame or by the background heartbeat). */
    let simAt = last;
    const advanceSession = (at: number) => {
      const session = sessionRef.current;
      if (!session) return;
      session.setNudge(nudgeOf(controls.current));
      // Uncapped up to a quarter second: a host on a slow machine must not run the race in slow motion for everyone.
      session.update(Math.min(Math.max(0, at - simAt), 250));
      simAt = at;
    };
    // A browser stops animation frames for a hidden or covered window. The host IS the race,
    // so a timer keeps the simulation (and the stream to everyone else) going until frames resume.
    const heartbeat = window.setInterval(() => {
      const at = performance.now();
      if (!sessionRef.current || doneRef.current || at - simAt < 100) return;
      advanceSession(at);
      if (sessionRef.current.results) finish();
    }, 50);
    let accumulator = 0;
    let hudTimer = 0;
    let formationElapsed = 0;
    let lights = 0;
    let finishHold = 0;
    const lightsOutAt = 4200 + game.rng() * 1000;
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const wheel = (event: WheelEvent) => { event.preventDefault(); setZoom(zoomRef.current * Math.exp(-event.deltaY * 0.0015)); };
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStart = 0;
    let pinchZoom = 1;
    const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const pointerDown = (event: PointerEvent) => { pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.size === 2) { pinchStart = spread(); pinchZoom = zoomRef.current; } };
    const pointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2 && pinchStart > 0) setZoom(pinchZoom * spread() / pinchStart);
    };
    const pointerUp = (event: PointerEvent) => { pointers.delete(event.pointerId); if (pointers.size < 2) pinchStart = 0; };
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    resize();

    const onKey = (event: KeyboardEvent, down: boolean) => {
      if (doneRef.current || (event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable))) return;
      if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return;
      if (['ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
      if (down && (event.code === 'Equal' || event.code === 'NumpadAdd')) { setZoom(zoomRef.current * 1.2); return; }
      if (down && (event.code === 'Minus' || event.code === 'NumpadSubtract')) { setZoom(zoomRef.current / 1.2); return; }
      if (down && (event.code === 'Digit0' || event.code === 'Numpad0')) { setZoom(1); return; }
      if (down && !event.repeat) raceAudio.unlock();
      if (event.code === 'KeyM' && down && !event.repeat) { toggleMute(); return; }
      // Online there is no pause: the race clock is not this tab's, and a host
      // that stopped stepping would take the whole grid with it.
      if (event.code === 'KeyP' && down && !event.repeat) { if (!onlineRef.current) setPause(!pausedRef.current); return; }
      if (event.code === 'Escape' && down && !event.repeat) {
        // MP-CHAT: a compose bar open is the closer thing to leave — Escape
        // puts it away before it puts the race away.
        if (composingRef.current) { closeCompose(); return; }
        if (onlineRef.current) { leaveRace(); return; }
        if (!pausedRef.current) setPause(true);
        return;
      }
      // MP-CHAT: T opens the compose bar. (Enter would do as well, but Enter
      // is the key that sends — so one key opens and one key sends.)
      //
      // `preventDefault` matters: the bar mounts with the caret already in it,
      // and without this the same keystroke that opened it types a "t" at the
      // front of the first line.
      if (event.code === 'KeyT' && down && !event.repeat && onlineRef.current) { event.preventDefault(); openCompose(); return; }
      if (pausedRef.current) return;
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') controls.current.left = down;
      if (event.code === 'ArrowRight' || event.code === 'KeyD') controls.current.right = down;
      const numberKey = /^(?:Digit|Numpad)([1-8])$/.exec(event.code);
      if (numberKey && down && !event.repeat) {
        event.preventDefault();
        const item = ITEM_TYPES[Number(numberKey[1]) - 1];
        selectedRef.current = item;
        setSelected(item);
        useItem(item);
      }
      if (event.code === 'Space' && down && !event.repeat) useItem(selectedRef.current);
    };
    const keyDown = (e: KeyboardEvent) => onKey(e, true);
    const keyUp = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => { controls.current = { left: false, right: false, touch: 0 }; if (!doneRef.current && !onlineRef.current) setPause(true); };
    const hidden = () => { if (document.hidden) blur(); };
    const unlockAudio = () => raceAudio.unlock();
    unlockAudio();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);

    const finish = () => {
      if (doneRef.current) return;
      // Online, the classification is the host's: one race, one result, and
      // every screen shows the same rows in the same order.
      const rows = sessionRef.current?.results ?? null;
      if (sessionRef.current) {
        if (!rows) return; // the host has not published it yet
        doneRef.current = true;
        setResults(rows);
        // MP-09: online, what this driver is holding lives on the host's marble,
        // so it is handed back with the result — that is what settles the kit.
        finishedCallback.current(rows, sessionRef.current.kit);
        return;
      }
      doneRef.current = true;
      const classification = game.classify().map((r) => ({ id: r.marble.info.id, rank: r.rank, time: r.time, pegs: r.marble.pegs }));
      setResults(classification);
      finishedCallback.current(classification);
    };

    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(now - last, 50));
      last = now;
      if (!pausedRef.current && !doneRef.current) {
        // MP-06: online, the session does the work — the host steps the world
        // and publishes it, the guest plays out the frames it has been sent.
        // Neither has a formation lap of its own: the lights belong to the
        // host's clock, and the gate opens on the instant the lobby published.
        if (sessionRef.current) {
          advanceSession(now);
          if (sessionRef.current.results) finish();
        } else {
        formationElapsed += dt;
        if (!game.gateOpen) {
          const nextLights = Math.min(5, Math.floor(formationElapsed / 650));
          if (nextLights > lights && nextLights > 0) raceAudio.play({ type: 'light', x: W / 2, y: 0, player: true }, { x: 0, y: 0, halfHeight: 1 });
          lights = nextLights;
          if (formationElapsed >= lightsOutAt) { lights = -1; game.openGate(); }
        }
        game.nudge = nudgeOf(controls.current);
        accumulator += dt * (game.player.finishedAt !== null ? fastRef.current : 1);
        while (accumulator >= PHYSICS_STEP) { game.step(PHYSICS_STEP); accumulator -= PHYSICS_STEP; }
        if (game.allFinished()) { finishHold += dt; if (finishHold > 750) finish(); }
        else if (game.raceTime() >= HEAT_TIME_LIMIT) finish();
        }
      }
      // The light bank: 0..5 while the lights count, -1 the moment they are out.
      if (sessionRef.current) lights = sessionRef.current.lightStage;
      const ranking = game.ranking();
      const following = game.player.finishedAt === null ? game.player : ranking.find((r) => !r.finished)?.marble ?? game.player;
      const p = following.body.position;
      if (width > 0 && height > 0) {
        const sidebar = width >= 980 ? 215 : 0;
        const rightRail = width >= 980 ? 142 : 0;
        const availableWidth = width - sidebar - rightRail;
        const fitWidth = Math.min(availableWidth / (W + 70), 1.55);
        // Default view shows roughly 900 world units of height so wide screens are not zoomed in; the player's zoom scales that.
        const baseScale = width < 700 && game.gateOpen ? Math.max(fitWidth, Math.min(height / 850, 0.83)) : Math.min(fitWidth, height / 900);
        const targetScale = baseScale * zoomRef.current;
        const scale = camera.scale + (targetScale - camera.scale) * (1 - Math.exp(-dt / 180));
        const halfWidth = availableWidth / 2 / scale;
        const halfHeight = height / 2 / scale;
        const targetX = (halfWidth >= W / 2 ? W / 2 : Math.max(halfWidth - 15, Math.min(W - halfWidth + 15, p.x))) - (sidebar - rightRail) / 2 / scale;
        camera.scale = scale;
        camera.x += (targetX - camera.x) * (1 - Math.exp(-dt / 150));
        camera.y += (p.y + 115 - camera.y) * (1 - Math.exp(-dt / 150));
        camera.y = halfHeight * 2 >= game.track.height ? game.track.height / 2 : Math.max(halfHeight - 15, Math.min(game.track.height - halfHeight + 15, camera.y));
        render(ctx, game, camera, width, height, pausedRef.current || doneRef.current ? game.time : now, { shake: !reduceMotion, minimap: false });
        // MP-CHAT: pin every bubble to the marble that said it, in the same
        // frame the marble was drawn in. World → screen is the camera's own
        // transform — the one `render` just used — so a bubble cannot drift
        // out of step with the ball it belongs to.
        //
        // Done here rather than in a second React effect because the camera
        // moves every frame and a bubble that re-rendered that often would
        // cost more than the whole race HUD.
        const layer = bubbleLayer.current;
        if (layer) {
          for (const node of Array.from(layer.children) as HTMLElement[]) {
            const marble = game.marbles.find((m) => m.info.id === Number(node.dataset.seat));
            if (!marble) { node.style.opacity = '0'; continue; }
            const bx = (marble.body.position.x - camera.x) * camera.scale + width / 2;
            const by = (marble.body.position.y - camera.y) * camera.scale + height / 2;
            // 26 is the marble's own radius plus the bubble's tail: the line
            // sits above the ball, not on top of it.
            node.style.transform = `translate(${Math.round(bx)}px, ${Math.round(by - 26 * camera.scale)}px) translate(-50%, -100%)`;
            node.style.opacity = by < 24 || by > height + 40 ? '0' : '1';
          }
        }
        const cues = sessionRef.current ? sessionRef.current.drainCues() : game.sounds.splice(0);
        if (cues.length) {
          const listener = { x: camera.x, y: camera.y, halfHeight: height / 2 / camera.scale };
          for (const cue of cues) raceAudio.play(cue, listener);
        }
      }

      hudTimer += dt;
      if (hudTimer > 85 && !doneRef.current) {
        hudTimer = 0;
        const m = game.player;
        const velocity = m.body.velocity;
        const section = game.track.segments.findIndex((s) => p.y >= s.y && p.y < s.y + s.h);
        const status = !game.gateOpen ? 'ON THE GRID' : m.finishedAt !== null ? 'CHEQUERED FLAG' : m.frozen ? `FROZEN / ${((m.frozenUntil - game.time) / 1000).toFixed(1)}s` : m.inOil ? 'OIL SLICK' : m.recoveryUntil > game.time ? 'BACK ON TRACK' : m.rocketUntil > game.time ? 'BOOST ACTIVE' : m.aeroUntil > game.time ? 'SLIPSTREAM' : m.anvilUntil > game.time ? 'HEAVY METAL' : m.ghostUntil > game.time ? 'GHOST MODE' : m.grounded < 5 ? 'ROLLING' : 'AIRBORNE';
        const remaining = emptyInventory();
        for (const item of ITEM_TYPES) remaining[item] = game.itemRemaining(m, item);
        setHud({
          rank: game.gateOpen ? game.playerRank() : m.gridSlot, time: m.finishedAt ?? game.raceTime(),
          inventory: { ...m.inventory }, remaining, coolingDown: game.time < m.itemCooldownUntil,
          speed: Math.hypot(velocity.x, velocity.y) * 6, cap: game.speedLimit(m) * 6,
          lights, finished: m.finishedAt !== null, playerTime: m.finishedAt, pegs: m.pegs,
          sector: game.track.segments[section]?.name ?? 'Finish', sectorIndex: Math.max(0, section),
          // DEV probe (MP-10): where this screen's own marble is, right now.
          mx: p.x, my: p.y,
          progress: Math.max(0, Math.min(1, (m.body.position.y - game.track.startY) / (game.track.finishY - game.track.startY))),
          state: status, frozen: m.frozen, finishedCount: game.finishOrder.length,
          field: game.gateOpen ? ranking.map((r) => ({ id: r.marble.info.id, rank: r.rank, time: r.time, x: r.marble.body.position.x, y: r.marble.body.position.y })) : gridOrder.filter((id) => !game.benched.has(id)).map((id, i) => ({ id, rank: i + 1, time: null, x: game.marbles.find((m) => m.info.id === id)!.body.position.x, y: 116 })),
          following: following.info.isPlayer ? 'You' : following.info.name,
          viewTop: camera.y - height / 2 / camera.scale, viewBottom: camera.y + height / 2 / camera.scale,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); window.clearInterval(heartbeat); clearTimeout(toastTimer); observer.disconnect();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp);
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp);
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden);
      if (link) link.onMessage = null;
      if (session) session.dispose(); else game.destroy();
      sessionRef.current = null;
      gameRef.current = null;
    };
  }, [seed, roster, profile, trackDef, gridOrder, setPause, setZoom, toggleMute, online, useItem, openCompose, closeCompose]);

  const byId = (id: number) => roster.find((m) => m.id === id)!;
  const preStart = hud.lights >= 0;
  const showGo = !preStart && hud.time < 1100;
  /**
   * DEV ONLY: end the heat immediately with the player at a chosen place, so story branches (win / podium / loss / DNF)
   * can be tested without racing. Rivals keep their current running order. Stripped from production builds.
   */
  const devSkipRace = (place: number | 'dnf') => {
    const game = gameRef.current;
    if (!import.meta.env.DEV || !game || doneRef.current || sessionRef.current) return;
    doneRef.current = true;
    const order = game.classify().map((r) => r.marble).filter((m) => m !== game.player);
    order.splice(place === 'dnf' ? order.length : Math.max(0, Math.min(place - 1, order.length)), 0, game.player);
    const classification = order.map((m, i) => ({
      id: m.info.id, rank: i + 1, pegs: m.pegs,
      time: place === 'dnf' && m === game.player ? null : 95000 + i * 1300,
    }));
    setResults(classification);
    finishedCallback.current(classification);
  };

  /**
   * Online there is no pause to ask under: the race is happening without this
   * tab's permission, so leaving is the only honest way out of it.
   */
  const leaveRace = () => {
    if (onlineRef.current) {
      onExit();
      return;
    }
    setPause(true);
    setConfirmExit(true);
  };
  const requestExit = leaveRace;
  const deploy = (item: ItemType) => {
    if (pausedRef.current || doneRef.current) return;
    selectedRef.current = item;
    setSelected(item);
    useItem(item);
  };
  const nudgeButton = (direction: number) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => { event.currentTarget.setPointerCapture(event.pointerId); if (!pausedRef.current) controls.current.touch = direction; },
    onPointerUp: () => { controls.current.touch = 0; },
    onPointerCancel: () => { controls.current.touch = 0; },
    onLostPointerCapture: () => { controls.current.touch = 0; },
  });

  // DEV ONLY, and gone from a build (vite strips `import.meta.env.DEV` branches):
  // the local marble's seat and position, as data attributes. The two-browser
  // suite (MP-10) drives a real browser against a real room, and "the driver got
  // the SAME marble back after ten seconds offline" is a fact about a coordinate
  // — there is no honest way to read it out of a canvas.
  const mpProbe = import.meta.env.DEV
    ? { 'data-mp-seat': String(online ? online.localSeat : 0), 'data-mp-x': hud.mx.toFixed(1), 'data-mp-y': hud.my.toFixed(1), 'data-mp-time': String(Math.round(hud.time)) }
    : {};

  return <div className="race-shell" {...mpProbe}>
    <header className="race-topbar"><Brand compact /><div className="race-event"><span>{subtitle}</span><h1>{title}</h1></div><div className="race-clock"><span>RACE TIME</span><strong>{formatTime(hud.time)}</strong></div><div className="race-top-actions">{import.meta.env.DEV && !results && !online && <div className="dev-skip-race" title="Dev only: finish this heat instantly with you in the chosen place"><span>SKIP</span>{([1, 3, 8, 'dnf'] as const).map((place) => <button key={place} className="text-button" onClick={() => devSkipRace(place)}>{place === 'dnf' ? 'DNF' : `P${place}`}</button>)}</div>}<button className="icon-button" onClick={toggleMute} aria-label={muted ? 'Unmute sound (M)' : 'Mute sound (M)'} aria-pressed={muted} title={muted ? 'Sound off (M)' : 'Sound on (M)'}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><button className="icon-button" onClick={() => setPause(true)} aria-label="Pause race" disabled={!!results || !!online} title={online ? 'An online race cannot be paused' : 'Pause race'}><Pause size={18} /></button><button className="text-button" onClick={requestExit} disabled={!!results}>{online ? 'Leave race' : 'Exit'} <ArrowUpRightIcon /></button></div></header>
    <div className="race-stage">
      <canvas ref={canvasRef} className="race-canvas" aria-label="2D marble race. Arrow keys nudge. Keys 1 to 8 deploy power-ups; plus and minus zoom; Space repeats the last item. P pauses." />
      {mapTrack && <RaceMinimap track={mapTrack} racers={hud.field} roster={roster} viewTop={hud.viewTop} viewBottom={hud.viewBottom} progress={hud.progress} />}
      <aside className="timing-tower" aria-label={preStart ? 'Starting grid' : 'Live classification'}><div className="timing-heading"><i className="live-dot" />{preStart ? 'STARTING GRID' : 'LIVE CLASSIFICATION'}</div><ol>{hud.field.map((r) => {
        const m = byId(r.id);
        const leading = hud.field[0];
        return <li key={r.id} className={`${m.isPlayer ? 'timing-player' : ''} ${m.isHuman && !m.isPlayer ? 'timing-human' : ''}`}><span className="timing-rank">{r.rank}</span><i style={{ background: teamOf(r.id).color }} /><span className="timing-name">{m.isPlayer ? 'YOU' : m.name.toUpperCase()}</span><span className="timing-gap">{preStart ? teamOf(r.id).short : r.time !== null ? <Flag size={11} /> : leading.time !== null ? 'RACING' : r.rank === 1 ? 'LEADER' : `+${Math.max(0, (leading.y - r.y) / 100).toFixed(1)}m`}</span></li>;
      })}</ol><div className="timing-footer">{hud.finishedCount} / 10 FINISHED <span>{championship ? 'CHAMPIONSHIP' : 'QUICK RACE'}</span></div></aside>
      <div className="zoom-controls" role="group" aria-label="Zoom"><button className="icon-button" onClick={() => setZoom(zoom * 1.25)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in"><ZoomIn size={16} /></button><button className="zoom-level" onClick={() => setZoom(1)} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button><button className="icon-button" onClick={() => setZoom(zoom / 1.25)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out"><ZoomOut size={16} /></button></div>
      <div className="race-sector"><span>SECTOR {String(hud.sectorIndex + 1).padStart(2, '0')}</span><b>{hud.sector.toUpperCase()}</b></div>
      {(preStart || showGo) && <div className={`start-sequence ${showGo ? 'lights-out' : ''}`}><div className="start-light-bank">{Array.from({ length: 5 }, (_, i) => <div key={i} className={`start-light-pair ${hud.lights > i ? 'lit' : ''}`}><i /><i /></div>)}</div><span>{showGo ? 'LIGHTS OUT. FULL SEND.' : hud.lights === 5 ? 'HOLD YOUR LINE.' : 'THE GRID IS SET.'}</span></div>}
      {toast && <div key={toast.message} className="race-toast" role="status" style={{ '--toast-color': toast.color } as CSSProperties}><span />{toast.message}</div>}
      {story && <StoryRaceOverlay story={story} sectorIndex={hud.sectorIndex} live={!results} />}
      {hud.finished && !results && <div className="finish-follow"><Flag size={20} /><div><strong>P{hud.rank} secured.{championship ? ` +${pointsFor(hud.rank)} points.` : ''}</strong><span>Following {hud.following}. {roster.length - hud.finishedCount} marbles still racing.</span></div>{(!online || sessionRef.current?.canFastForward) ? <button className={`button-secondary ${fast > 1 ? 'fast-active' : ''}`} onClick={() => { const next = fast === 1 ? 2 : fast === 2 ? 4 : 1; fastRef.current = next; setFast(next); sessionRef.current?.setSpeed(next); }} aria-label={`Replay speed ${fast}x, click to change`}><FastForward size={16} />{fast === 1 ? 'Fast forward' : `${fast}x speed`}</button> : <span className="finish-follow-note">{sessionRef.current?.isHost ? 'Fast forward unlocks when every driver has finished' : 'The host can fast forward once every driver has finished'}</span>}</div>}
      <div className="race-progress"><span style={{ width: `${hud.progress * 100}%` }} /></div>
      {/* MP-CHAT: bubbles live in their own layer over the canvas. The loop
          pins each one to the marble that said it; React only ever adds and
          removes them. */}
      <RaceBubbles ref={bubbleLayer} bubbles={bubbles} />
      {/* MP-CHAT: the mouth. A button as well as a key, because a keyboard
          shortcut nobody can find is not a feature on a phone. */}
      {online && !results && <button className="race-chat-open" onClick={composing ? closeCompose : openCompose} aria-pressed={composing} title="Say something to the grid (T)">
        <MessageCircle size={16} /><kbd>T</kbd>
      </button>}
      {online && composing && !results && <form className="race-chat" onSubmit={submitChat}>
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, MAX_CHAT_LENGTH))}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeCompose(); } }}
          onBlur={closeCompose}
          placeholder="Say something to the grid"
          aria-label="Message the grid"
          maxLength={MAX_CHAT_LENGTH}
          autoComplete="off"
        />
        {/* Keeps the focus (and the caret) in the field, so the click lands
            as a submit rather than as a blur that closes the bar first. */}
        <button className="button-secondary" type="submit" onMouseDown={(event) => event.preventDefault()} disabled={!canSay(draft)}>Send</button>
      </form>}
    </div>
    <footer className="race-dashboard race-cockpit"><div className="race-telemetry">
      <div className="position-readout"><span>POSITION</span><div><strong>P{hud.rank}</strong><span>/ 10</span></div></div>
      <div className="speed-readout"><div className="readout-caption"><Gauge size={13} /><span>SPEED</span></div><div><strong>{Math.round(hud.speed)}</strong><span>cm/s</span></div><div className="speed-meter"><span style={{ width: `${Math.min(100, hud.speed / hud.cap * 100)}%` }} /></div></div>
      <div className={`marble-state ${hud.frozen ? 'is-frozen' : ''}`}><span className="readout-caption">MARBLE STATUS</span><strong>{hud.frozen && <Snowflake size={14} />}{hud.state}</strong><span className="peg-readout"><i className="orange-peg" />{hud.pegs} orange pegs</span></div>
      <div className="race-wallet"><Coins size={16} /><strong>{credits.toLocaleString()}</strong><span>CR</span></div>
      <div className="race-controls"><div className="nudge-controls"><span>FIND YOUR LINE</span><div><button className="nudge-button" aria-label="Nudge left" {...nudgeButton(-1)} disabled={hud.finished || preStart || paused}><ArrowLeft size={18} /><kbd>←</kbd></button><button className="nudge-button" aria-label="Nudge right" {...nudgeButton(1)} disabled={hud.finished || preStart || paused}><ArrowRight size={18} /><kbd>→</kbd></button></div></div></div>
      </div><InventoryToolbar unlimited={online?.settings.items} inventory={hud.inventory} remaining={hud.remaining} selected={selected} blocked={paused || hud.finished || preStart || hud.frozen || !!results} coolingDown={hud.coolingDown} onUse={deploy} />
    </footer>
    {paused && !results && <Dialog titleId="pause-title" onClose={() => { setConfirmExit(false); setPause(false); }} className="pause-dialog"><span className="eyebrow"><Timer size={15} /> {confirmExit ? 'RACE CONTROL' : 'TIME OUT'}</span><h2 id="pause-title">{confirmExit ? 'Leaving the grid?' : 'A quick pit stop.'}</h2><p className="dialog-intro">{confirmExit ? 'This heat will not be scored or paid. Used items stay spent; unused items and pickups stay in your inventory. Previous results are safe.' : 'The clock, every marble, and all item timers are paused. Your next move can wait.'}</p><div className="pause-actions"><button className="button-primary" onClick={() => { setConfirmExit(false); setPause(false); }}><Play size={17} />Back to the race</button><button className="button-secondary" onClick={confirmExit ? onExit : () => setConfirmExit(true)}>{confirmExit ? 'Leave heat' : 'Return to paddock'}<ChevronRight size={16} /></button></div></Dialog>}
    {results && <RaceResults results={results} roster={roster} title={title} subtitle={subtitle} actions={actions} championship={championship} payout={payout} credits={credits} onShop={onShop} isCustom={isCustom} rating={rating} />}
  </div>;
}

function ArrowUpRightIcon() { return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 15 15 5M5 5h10v10" stroke="currentColor" strokeWidth="1.5" /></svg>; }