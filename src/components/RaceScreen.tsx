import * as storage from '../game/storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, Pause, Play, Flag, ChevronRight, FastForward, Timer, Gauge, Coins, Snowflake, ZoomIn, ZoomOut, Volume2, VolumeX } from 'lucide-react';
import { raceAudio } from '../game/audio';
import { Game } from '../game/engine';
import { render } from '../game/render';
import { W } from '../game/track';
import type { Track } from '../game/track';
import { HEAT_TIME_LIMIT, PHYSICS_STEP, formatTime } from '../game/physics';
import { teamOf, ITEM_TYPES, emptyInventory, normalizeInventory } from '../game/types';
import type { MarbleInfo, ItemType, TrackProfile, HeatResult, Inventory } from '../game/types';
import type { RacePayout } from '../game/economy';
import { pointsFor } from '../game/season';
import Brand from './Brand';
import Dialog from './Dialog';
import InventoryToolbar from './InventoryToolbar';
import RaceMinimap from './RaceMinimap';
import RaceResults from './RaceResults';
import type { RaceAction } from './RaceResults';
import StoryRaceOverlay from './story/StoryRace';
import type { StoryRaceProps } from './story/StoryRace';
export type { RaceAction } from './RaceResults';

interface Props {
  seed: number; roster: MarbleInfo[]; profile: TrackProfile; gridOrder: number[];
  title: string; subtitle: string; championship?: boolean;
  onExit: () => void; onFinished: (results: HeatResult[]) => void; actions: RaceAction[];
  inventory: Inventory; credits: number;
  onInventoryChange: (inventory: Inventory) => void;
  payout: RacePayout | null;
  onShop: () => void;
  /** Story mode only (ST-03/ST-07): mid-race beats, objective chips and chapter engine hooks. */
  story?: StoryRaceProps;
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
  lights: number; finished: boolean; playerTime: number | null; pegs: number;
  sector: string; sectorIndex: number; progress: number; state: string;
  frozen: boolean; field: LiveRow[]; finishedCount: number; following: string;
  viewTop: number; viewBottom: number;
}

export default function RaceScreen({ seed, roster, profile, gridOrder, title, subtitle, onExit, onFinished, actions, championship = false, inventory, credits, onInventoryChange, payout, onShop, story }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
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
  const initialInventory = useRef(normalizeInventory(inventory));
  const inventoryCallback = useRef(onInventoryChange);
  inventoryCallback.current = onInventoryChange;
  const selectedRef = useRef<ItemType>(ITEM_TYPES.find((item) => inventory[item] > 0) ?? 'rocket');
  const [selected, setSelected] = useState<ItemType>(selectedRef.current);
  const [hud, setHud] = useState<Hud>({
    rank: gridOrder.indexOf(0) + 1, time: 0, inventory: { ...initialInventory.current }, remaining: emptyInventory(), coolingDown: false, speed: 0, cap: 100, lights: 0,
    finished: false, playerTime: null, pegs: 0, sector: 'Starting grid', sectorIndex: 0,
    progress: 0, state: 'ON THE GRID', frozen: false, finishedCount: 0, following: 'You',
    field: gridOrder.map((id, i) => ({ id, rank: i + 1, time: null, x: 60 + i * 86, y: 116 })),
    viewTop: 0, viewBottom: 700,
  });
  const finishedCallback = useRef(onFinished);
  finishedCallback.current = onFinished;
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
    const game = new Game(seed, roster, { profile, gridOrder, inventory: initialInventory.current, story: story?.hooks });
    game.onInventoryChange = (items) => inventoryCallback.current(items);
    setMapTrack(game.track);
    gameRef.current = game;
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
      if (down) raceAudio.unlock();
      if (event.code === 'KeyM' && down && !event.repeat) { toggleMute(); return; }
      if (event.code === 'KeyP' && down && !event.repeat) { setPause(!pausedRef.current); return; }
      if (event.code === 'Escape' && down && !event.repeat) { if (!pausedRef.current) setPause(true); return; }
      if (pausedRef.current) return;
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') controls.current.left = down;
      if (event.code === 'ArrowRight' || event.code === 'KeyD') controls.current.right = down;
      const numberKey = /^(?:Digit|Numpad)([1-8])$/.exec(event.code);
      if (numberKey && down && !event.repeat) {
        event.preventDefault();
        const item = ITEM_TYPES[Number(numberKey[1]) - 1];
        selectedRef.current = item;
        setSelected(item);
        game.usePlayerItem(item);
      }
      if (event.code === 'Space' && down && !event.repeat) game.usePlayerItem(selectedRef.current);
    };
    const keyDown = (e: KeyboardEvent) => onKey(e, true);
    const keyUp = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => { controls.current = { left: false, right: false, touch: 0 }; if (!doneRef.current) setPause(true); };
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
      doneRef.current = true;
      const classification = game.classify().map((r) => ({ id: r.marble.info.id, rank: r.rank, time: r.time, pegs: r.marble.pegs }));
      setResults(classification);
      finishedCallback.current(classification);
    };

    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(now - last, 50));
      last = now;
      if (!pausedRef.current && !doneRef.current) {
        formationElapsed += dt;
        if (!game.gateOpen) {
          const nextLights = Math.min(5, Math.floor(formationElapsed / 650));
          if (nextLights > lights && nextLights > 0) raceAudio.play({ type: 'light', x: W / 2, y: 0, player: true }, { x: 0, y: 0, halfHeight: 1 });
          lights = nextLights;
          if (formationElapsed >= lightsOutAt) { lights = -1; game.openGate(); }
        }
        game.nudge = controls.current.touch || Number(controls.current.right) - Number(controls.current.left);
        accumulator += dt * (game.player.finishedAt !== null ? fastRef.current : 1);
        while (accumulator >= PHYSICS_STEP) { game.step(PHYSICS_STEP); accumulator -= PHYSICS_STEP; }
        if (game.allFinished()) { finishHold += dt; if (finishHold > 750) finish(); }
        else if (game.raceTime() >= HEAT_TIME_LIMIT) finish();
      }
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
        if (game.sounds.length) {
          const listener = { x: camera.x, y: camera.y, halfHeight: height / 2 / camera.scale };
          for (const cue of game.sounds) raceAudio.play(cue, listener);
          game.sounds.length = 0;
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
          progress: Math.max(0, Math.min(1, (m.body.position.y - game.track.startY) / (game.track.finishY - game.track.startY))),
          state: status, frozen: m.frozen, finishedCount: game.finishOrder.length,
          field: game.gateOpen ? ranking.map((r) => ({ id: r.marble.info.id, rank: r.rank, time: r.time, x: r.marble.body.position.x, y: r.marble.body.position.y })) : gridOrder.map((id, i) => ({ id, rank: i + 1, time: null, x: game.marbles.find((m) => m.info.id === id)!.body.position.x, y: 116 })),
          following: following.info.isPlayer ? 'You' : following.info.name,
          viewTop: camera.y - height / 2 / camera.scale, viewBottom: camera.y + height / 2 / camera.scale,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(toastTimer); observer.disconnect();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp);
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp);
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden);
      game.destroy(); gameRef.current = null;
    };
  }, [seed, roster, profile, gridOrder, setPause, setZoom, toggleMute]);

  const byId = (id: number) => roster.find((m) => m.id === id)!;
  const preStart = hud.lights >= 0;
  const showGo = !preStart && hud.time < 1100;
  const requestExit = () => { setPause(true); setConfirmExit(true); };
  const deploy = (item: ItemType) => {
    if (pausedRef.current || doneRef.current) return;
    selectedRef.current = item;
    setSelected(item);
    gameRef.current?.usePlayerItem(item);
  };
  const nudgeButton = (direction: number) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => { event.currentTarget.setPointerCapture(event.pointerId); if (!pausedRef.current) controls.current.touch = direction; },
    onPointerUp: () => { controls.current.touch = 0; },
    onPointerCancel: () => { controls.current.touch = 0; },
    onLostPointerCapture: () => { controls.current.touch = 0; },
  });

  return <div className="race-shell">
    <header className="race-topbar"><Brand compact /><div className="race-event"><span>{subtitle}</span><h1>{title}</h1></div><div className="race-clock"><span>RACE TIME</span><strong>{formatTime(hud.time)}</strong></div><div className="race-top-actions"><button className="icon-button" onClick={toggleMute} aria-label={muted ? 'Unmute sound (M)' : 'Mute sound (M)'} aria-pressed={muted} title={muted ? 'Sound off (M)' : 'Sound on (M)'}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><button className="icon-button" onClick={() => setPause(true)} aria-label="Pause race" disabled={!!results}><Pause size={18} /></button><button className="text-button" onClick={requestExit} disabled={!!results}>Exit <ArrowUpRightIcon /></button></div></header>
    <div className="race-stage">
      <canvas ref={canvasRef} className="race-canvas" aria-label="2D marble race. Arrow keys nudge. Keys 1 to 8 deploy power-ups; plus and minus zoom; Space repeats the last item. P pauses." />
      {mapTrack && <RaceMinimap track={mapTrack} racers={hud.field} roster={roster} viewTop={hud.viewTop} viewBottom={hud.viewBottom} progress={hud.progress} />}
      <aside className="timing-tower" aria-label={preStart ? 'Starting grid' : 'Live classification'}><div className="timing-heading"><i className="live-dot" />{preStart ? 'STARTING GRID' : 'LIVE CLASSIFICATION'}</div><ol>{hud.field.map((r) => {
        const m = byId(r.id);
        const leading = hud.field[0];
        return <li key={r.id} className={m.isPlayer ? 'timing-player' : ''}><span className="timing-rank">{r.rank}</span><i style={{ background: teamOf(r.id).color }} /><span className="timing-name">{m.isPlayer ? 'YOU' : m.name.toUpperCase()}</span><span className="timing-gap">{preStart ? teamOf(r.id).short : r.time !== null ? <Flag size={11} /> : leading.time !== null ? 'RACING' : r.rank === 1 ? 'LEADER' : `+${Math.max(0, (leading.y - r.y) / 100).toFixed(1)}m`}</span></li>;
      })}</ol><div className="timing-footer">{hud.finishedCount} / 10 FINISHED <span>{championship ? 'CHAMPIONSHIP' : 'QUICK RACE'}</span></div></aside>
      <div className="zoom-controls" role="group" aria-label="Zoom"><button className="icon-button" onClick={() => setZoom(zoom * 1.25)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in"><ZoomIn size={16} /></button><button className="zoom-level" onClick={() => setZoom(1)} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button><button className="icon-button" onClick={() => setZoom(zoom / 1.25)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out"><ZoomOut size={16} /></button></div>
      <div className="race-sector"><span>SECTOR {String(hud.sectorIndex + 1).padStart(2, '0')}</span><b>{hud.sector.toUpperCase()}</b></div>
      {(preStart || showGo) && <div className={`start-sequence ${showGo ? 'lights-out' : ''}`}><div className="start-light-bank">{Array.from({ length: 5 }, (_, i) => <div key={i} className={`start-light-pair ${hud.lights > i ? 'lit' : ''}`}><i /><i /></div>)}</div><span>{showGo ? 'LIGHTS OUT. FULL SEND.' : hud.lights === 5 ? 'HOLD YOUR LINE.' : 'THE GRID IS SET.'}</span></div>}
      {toast && <div key={toast.message} className="race-toast" role="status" style={{ '--toast-color': toast.color } as CSSProperties}><span />{toast.message}</div>}
      {story && <StoryRaceOverlay story={story} sectorIndex={hud.sectorIndex} live={!results} />}
      {hud.finished && !results && <div className="finish-follow"><Flag size={20} /><div><strong>P{hud.rank} secured.{championship ? ` +${pointsFor(hud.rank)} points.` : ''}</strong><span>Following {hud.following}. {roster.length - hud.finishedCount} marbles still racing.</span></div><button className={`button-secondary ${fast > 1 ? 'fast-active' : ''}`} onClick={() => { const next = fast === 1 ? 2 : fast === 2 ? 4 : 1; fastRef.current = next; setFast(next); }} aria-label={`Replay speed ${fast}x, click to change`}><FastForward size={16} />{fast === 1 ? 'Fast forward' : `${fast}x speed`}</button></div>}
      <div className="race-progress"><span style={{ width: `${hud.progress * 100}%` }} /></div>
    </div>
    <footer className="race-dashboard race-cockpit"><div className="race-telemetry">
      <div className="position-readout"><span>POSITION</span><div><strong>P{hud.rank}</strong><span>/ 10</span></div></div>
      <div className="speed-readout"><div className="readout-caption"><Gauge size={13} /><span>SPEED</span></div><div><strong>{Math.round(hud.speed)}</strong><span>cm/s</span></div><div className="speed-meter"><span style={{ width: `${Math.min(100, hud.speed / hud.cap * 100)}%` }} /></div></div>
      <div className={`marble-state ${hud.frozen ? 'is-frozen' : ''}`}><span className="readout-caption">MARBLE STATUS</span><strong>{hud.frozen && <Snowflake size={14} />}{hud.state}</strong><span className="peg-readout"><i className="orange-peg" />{hud.pegs} orange pegs</span></div>
      <div className="race-wallet"><Coins size={16} /><strong>{credits.toLocaleString()}</strong><span>CR</span></div>
      <div className="race-controls"><div className="nudge-controls"><span>FIND YOUR LINE</span><div><button className="nudge-button" aria-label="Nudge left" {...nudgeButton(-1)} disabled={hud.finished || preStart || paused}><ArrowLeft size={18} /><kbd>A</kbd></button><button className="nudge-button" aria-label="Nudge right" {...nudgeButton(1)} disabled={hud.finished || preStart || paused}><ArrowRight size={18} /><kbd>D</kbd></button></div></div></div>
      </div><InventoryToolbar inventory={hud.inventory} remaining={hud.remaining} selected={selected} blocked={paused || hud.finished || preStart || hud.frozen || !!results} coolingDown={hud.coolingDown} onUse={deploy} />
    </footer>
    {paused && !results && <Dialog titleId="pause-title" onClose={() => { setConfirmExit(false); setPause(false); }} className="pause-dialog"><span className="eyebrow"><Timer size={15} /> {confirmExit ? 'RACE CONTROL' : 'TIME OUT'}</span><h2 id="pause-title">{confirmExit ? 'Leaving the grid?' : 'A quick pit stop.'}</h2><p className="dialog-intro">{confirmExit ? 'This heat will not be scored or paid. Used items stay spent; unused items and pickups stay in your inventory. Previous results are safe.' : 'The clock, every marble, and all item timers are paused. Your next move can wait.'}</p><div className="pause-actions"><button className="button-primary" onClick={() => { setConfirmExit(false); setPause(false); }}><Play size={17} />Back to the race</button><button className="button-secondary" onClick={confirmExit ? onExit : () => setConfirmExit(true)}>{confirmExit ? 'Leave heat' : 'Return to paddock'}<ChevronRight size={16} /></button></div></Dialog>}
    {results && <RaceResults results={results} roster={roster} title={title} subtitle={subtitle} actions={actions} championship={championship} payout={payout} credits={credits} onShop={onShop} />}
  </div>;
}

function ArrowUpRightIcon() { return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 15 15 5M5 5h10v10" stroke="currentColor" strokeWidth="1.5" /></svg>; }