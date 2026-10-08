// P2-24: the Infinity run screen. Full screen, landscape-first, no rivals, no timer, no ranking, no health bar: a ball
// rolling across a land that grows ahead of it. The HUD is one soft distance readout, a pause button, a mute button and
// Hide UI (photo mode: only the world, tap anywhere to bring the buttons back).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, RotateCcw, EyeOff, Heart, Pause, Play, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react';
import { INFINITY_LIVES, InfinityRun } from '../../game/platformer/infinity-world';
import { radio } from '../../game/sound/radio';
import RadioPill from '../RadioPill';
import HeatEdges from '../HeatEdges';
import { RING_CREDITS } from '../../game/platformer/course';
import { marbleDepth, renderPlatformer, shiftForeground, trackLineY } from '../../game/platformer/render';
import { smoothFrameMs } from '../../game/frame-clock';
import { newTrackCamera, trackCameraY } from '../../game/platformer/camera-y';
import type { PlatformCamera } from '../../game/platformer/render';
import { laneView } from '../../game/lanes';
import { PHYSICS_STEP } from '../../game/physics';
import { blendPoses, rememberPoses } from '../../game/interpolate';
import { PerfMeter } from '../../game/perf-meter';
import { RenderScale } from '../../game/render-scale';
import { nudgeOf } from '../../game/controls';
import { actionForKey } from '../../game/skill-keys';
import { raceAudio } from '../../game/audio';
import { bankRings, bankRunEnd, formatKm, loadRecords, recordDistance, recordStart, seedFromText, setReduceMotion } from '../../game/infinity-store';
import { biomeAt, dayAt } from '../../game/infinity-look';
import { InfinityAudio } from '../../game/infinity-audio';
import { InfinityPainter } from './InfinityPainter';
import type { MarbleInfo } from '../../game/types';
import * as storage from '../../game/storage';
import Dialog from '../Dialog';
import './infinity.css';

interface Props {
  /** The seed text of this run: the same text always gives the same land. */
  seedText: string;
  driver: MarbleInfo;
  /** Leave for the garage. */
  onLeave: () => void;
  /** Start again on a new seed (the app makes the text and remounts this screen). */
  onNewSeed: () => void;

}

/** How often the distance is banked into the records while rolling (ms): a closed tab keeps the best. */
const BANK_EVERY_MS = 4000;

/**
 * Zoom (the owner): automatic by default, in close when slow and out wide when fast (autoZoom). Zooming yourself (the
 * wheel, a pinch, + / - or the buttons) takes over and is kept on this device; 0 (or the Auto button) hands it back.
 * null = automatic.
 */
const ZOOM_KEY = 'heavy-metal-gp:infinity-zoom';
export const INFINITY_ZOOM_MIN = 0.4;
export const INFINITY_ZOOM_MAX = 2;
const clampZoom = (z: number) => Math.max(INFINITY_ZOOM_MIN, Math.min(INFINITY_ZOOM_MAX, z));
function loadZoom(): number | null {
  try { const n = Number(storage.getItem(ZOOM_KEY)); return n > 0 ? clampZoom(n) : null; } catch { return null; }
}
/** The automatic zoom at a speed (px per step): 1.25 standing still, easing down to 0.55 at about 24 and up. */
export function autoZoom(speed: number): number {
  const t = Math.max(0, Math.min(1, speed / 24));
  return 1.25 - 0.7 * t * t * (3 - 2 * t);
}

export default function InfinityScreen({ seedText, driver, onLeave, onNewSeed }: Props) {
  const [rings, setRings] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const controls = useRef({ left: false, right: false, touch: 0, engine: false });
  const runRef = useRef<InfinityRun | null>(null);
  const pausedRef = useRef(false);
  const [paused, setPausedState] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  /** Bumped by Restart: the same seed from the start meadow. */
  const [restarts, setRestarts] = useState(0);
  const [muted, setMuted] = useState(() => raceAudio.loadPreference());
  const [km, setKm] = useState(0);
  /** Lives left (a death pit takes one), how many were lost (each loss shakes the hearts), and the run being over. */
  const [lives, setLives] = useState(INFINITY_LIVES);
  const [lost, setLost] = useState(0);
  const [over, setOver] = useState(false);
  /** The Magic Engine is overheated (the red glow at the sides). */
  const [hot, setHot] = useState(false);
  // P2-25: fewer particles and no drifting motion; remembered with the records.
  const [reduceMotion, setReduceMotionState] = useState(() => loadRecords().reduceMotion);
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;
  const audioRef = useRef<InfinityAudio | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  /** Ends the current run's bookkeeping (set by the run's effect). */
  const endRunRef = useRef<() => void>(() => {});
  const zoomRef = useRef<number | null>(loadZoom());
  /** The zoom on screen right now (automatic or yours): where your own zooming starts from. */
  const shownZoomRef = useRef(zoomRef.current ?? 1);
  const [zoom, setZoomState] = useState<number | null>(zoomRef.current);
  /** Your own zoom (it takes over from the automatic one), or null: back to automatic. */
  const setZoom = useCallback((value: number | null) => {
    const next = value === null ? null : clampZoom(value);
    zoomRef.current = next;
    setZoomState(next);
    try { storage.setItem(ZOOM_KEY, next === null ? 'auto' : String(next)); } catch { /* storage unavailable */ }
  }, []);

  const setPaused = useCallback((next: boolean) => {
    pausedRef.current = next;
    setPausedState(next);
    if (next) controls.current = { left: false, right: false, touch: 0, engine: false };
  }, []);
  const toggleMute = useCallback(() => { raceAudio.unlock(); raceAudio.setMuted(!raceAudio.muted); setMuted(raceAudio.muted); audioRef.current?.setMuted(raceAudio.muted); }, []);
  /** Photo mode: save what is on screen as a picture. */
  const savePicture = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `heavy-metal-gp-infinity-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setSavedNote('Picture saved');
      setTimeout(() => setSavedNote(null), 1800);
    }, 'image/png');
  }, []);
  const pressJump = useCallback(() => { if (runRef.current && !pausedRef.current) runRef.current.game.jumpPressed = true; }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const seed = seedFromText(seedText);
    const run = new InfinityRun(seed, driver, { effects: true });
    const painter = new InfinityPainter(seed);
    let shiftsSeen = 0, lostSeen = 0;
    setLives(run.lives); setLost(0); setOver(false);
    radio.setScene('infinity'); // the Infinity Skies station from the first moment (the frame loop refines day, night and biome)
    const audio = new InfinityAudio(seed);
    audioRef.current = audio;
    audio.setMuted(raceAudio.muted);
    painter.onKm = () => audio.chime();
    let elapsed = 0, frameMs = 16;
    // gold rings become credits in the account (banked every few seconds and on leaving, so a closed tab keeps them)
    let ringsBanked = 0;
    const bankRun = () => { const n = run.rings - ringsBanked; if (n > 0) { ringsBanked = run.rings; bankRings(n); } };
    // The run is over (Leave, Restart, New seed, or the screen closing): bank its distance, rings and distance bonus,
    // once. Leave calls it before the menu opens, so the menu's ring tally counts this run (the owner).
    let ended = false;
    const endRun = () => {
      if (ended) return;
      ended = true;
      recordDistance(run.km, banked);
      bankRun();
      bankRunEnd(run.km);
    };
    endRunRef.current = endRun;
    runRef.current = run;
    recordStart(seedText);
    if (import.meta.env.DEV) (window as unknown as { __infinity?: unknown }).__infinity = run;
    const game = run.game;
    const camera: PlatformCamera = { x: game.player.body.position.x + 200, y: game.player.body.position.y - 40, scale: 0.8, focus: 1 };
    if (import.meta.env.DEV) (window as unknown as { __infinityCamera?: unknown }).__infinityCamera = camera; // (tests)
    let smoothSpeed = 0, shownZoom = zoomRef.current ?? autoZoom(0), fgPerScale = 1, wasManual = zoomRef.current !== null, framed = false;
    const trackCam = newTrackCamera();
    let width = 0, height = 0, raf = 0, last = performance.now(), accumulator = 0, hudTimer = 0, bankTimer = 0, banked = 0, lookAhead = 0;
    let motionMs: number | null = null; // the frame time the motion runs on (frame-clock.ts)

    const meter = new PerfMeter();
    const renderScale = new RenderScale();
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const dpr = renderScale.ratio(devicePixelRatio); // perf: softer when frames keep arriving late
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const onKey = (event: KeyboardEvent, down: boolean) => {
      if (event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable)) return;
      // Space is the jump even right after tapping a button on screen (the owner); only a dialog's button keeps it
      if (event.code === 'Space' && event.target instanceof HTMLElement && event.target.closest('[role="dialog"]')) return;
      if (event.code === 'Space') event.preventDefault(); // and it never presses the focused button
      if (down && !event.repeat) { raceAudio.unlock(); audio.start(); }
      if (down && !event.repeat && event.code === 'KeyM') { toggleMute(); return; }
      if (runRef.current?.over) return; // the run is over: its own screen has the buttons
      if (down && !event.repeat && (event.code === 'KeyP' || event.code === 'Escape')) { setPaused(!pausedRef.current); return; }
      if (down && !event.repeat && event.code === 'KeyH') { setUiHidden((v) => !v); return; }
      if (down && (event.code === 'Equal' || event.code === 'NumpadAdd')) { setZoom(shownZoomRef.current * 1.2); return; }
      if (down && (event.code === 'Minus' || event.code === 'NumpadSubtract')) { setZoom(shownZoomRef.current / 1.2); return; }
      if (down && (event.code === 'Digit0' || event.code === 'Numpad0')) { setZoom(null); return; }
      if (down && !event.repeat && event.code === 'F3') { event.preventDefault(); meter.toggle(); return; }
      if (pausedRef.current) return;
      let code = event.code;
      if (code === 'KeyA') code = 'ArrowLeft'; else if (code === 'KeyD') code = 'ArrowRight'; else if (code === 'KeyW') code = 'ArrowUp'; else if (code === 'KeyS') code = 'ArrowDown';
      const action = actionForKey(code);
      if (!action || action.kind === 'skill') return;
      event.preventDefault();
      if (action.kind === 'steer') { if (action.dir < 0) controls.current.left = down; else controls.current.right = down; return; }
      if (action.kind === 'engine') { controls.current.engine = down; return; }
      if (action.kind === 'jump' && down && !event.repeat) pressJump();
    };
    const keyDown = (e: KeyboardEvent) => onKey(e, true);
    const keyUp = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => { controls.current = { left: false, right: false, touch: 0, engine: false }; setPaused(true); };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    const hidden = () => { if (document.hidden) blur(); };
    document.addEventListener('visibilitychange', hidden);
    const unlock = () => { raceAudio.unlock(); audio.start(); };
    window.addEventListener('pointerdown', unlock);
    const wheel = (event: WheelEvent) => { event.preventDefault(); setZoom(shownZoomRef.current * Math.exp(-event.deltaY * 0.0015)); };
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStart = 0, pinchZoom = 1;
    const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const pointerDown = (event: PointerEvent) => { pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.size === 2) { pinchStart = spread(); pinchZoom = shownZoomRef.current; } };
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

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (renderScale.observe(now - last)) resize();
      meter.frame(now, now - last);
      const rawMs = Math.min(now - last, 100);
      last = now;
      // The motion (physics, camera, zoom, parallax) runs on the smoothed frame time: uneven frames no longer judder.
      motionMs = smoothFrameMs(motionMs, rawMs);
      const dt = motionMs;
      frameMs += (rawMs - frameMs) * 0.05;
      if (!pausedRef.current) elapsed += dt;
      if (!pausedRef.current) {
        game.nudge = nudgeOf(controls.current);
        game.engineHeld = controls.current.engine;
        accumulator += dt;
        meter.time('physics', () => { while (accumulator >= PHYSICS_STEP) { rememberPoses(game); run.step(PHYSICS_STEP); accumulator -= PHYSICS_STEP; } });
        // The world was shifted back toward zero (every 4 km): move everything that remembers a world position by the
        // same amount, so the picture carries straight on instead of sliding back across the land.
        if (run.originShifts !== shiftsSeen) {
          shiftsSeen = run.originShifts;
          const { dx, dy } = run.lastShift;
          camera.x += dx; camera.y += dy;
          shiftForeground(camera, dx, dy);
          painter.shift(dx, dy);
        }
      }
      // Perf: draw the ball between its last two physics steps (undone at the end of the frame).
      const unblend = pausedRef.current ? () => {} : blendPoses(game, accumulator / PHYSICS_STEP);
      if (width > 0 && height > 0) {
        const p = game.player.body.position;
        // Side-scrolling camera, framed for landscape, easing toward a little way ahead of the ball.
        // The zoom: yours if you set one, else automatic from the speed (eased slowly: never sudden). The speed is
        // smoothed first, so a bump or a landing does not pump the zoom.
        const v = game.player.body.velocity;
        smoothSpeed += (Math.hypot(v.x, v.y) - smoothSpeed) * (1 - Math.exp(-dt / 700));
        const want = zoomRef.current ?? autoZoom(smoothSpeed);
        shownZoom += (want - shownZoom) * (1 - Math.exp(-dt / (zoomRef.current === null ? 900 : 120)));
        shownZoomRef.current = shownZoom;
        const fit = Math.max(0.42, Math.min(1.25, Math.min(width / 1000, height / 520)));
        const target = fit * shownZoom;
        // The trees, islands and cliffs (fgScale): the automatic speed zoom leaves them still, but your own zoom grows
        // and shrinks them exactly as it does the track: while you hold a zoom, fgScale IS the camera's scale times a
        // factor fixed when you took over from the automatic zoom, so they grow by the same factor at the same moment
        // (the owner: they eased differently, grew by a different amount and slid sideways against the track).
        const manual = zoomRef.current !== null;
        if (manual && !wasManual && framed) fgPerScale = (camera.fgScale ?? fit) / camera.scale;
        wasManual = manual;
        // the first frame starts at the right zoom (nothing eases into place when a run starts)
        camera.scale = framed ? camera.scale + (target - camera.scale) * (1 - Math.exp(-dt / 180)) : target;
        if (manual) camera.fgScale = camera.scale * fgPerScale;
        else camera.fgScale = framed && camera.fgScale !== undefined ? camera.fgScale + (fit - camera.fgScale) * (1 - Math.exp(-dt / 180)) : fit;
        framed = true;
        // the land the screen shows, out to the back lane (drawn smallest, so widest): the run keeps all of it built
        run.viewHalfWidth = width / 2 / (camera.scale * laneView(0, camera.focus).scale);
        // a smoothed look-ahead (the raw speed jumps on every bump) and a calmer vertical follow
        lookAhead += (Math.max(-160, Math.min(260, game.player.body.velocity.x * 26)) - lookAhead) * (1 - Math.exp(-dt / 600));
        camera.x += (p.x + lookAhead - camera.x) * (1 - Math.exp(-dt / 220));
        // The camera stands on the track (the owner: nothing bobbing, and the trees must never move against the track):
        // it locks to the track under it exactly (trackLineY, the line the foreground pines are glued to), blending the
        // two lanes' tracks through a lane change, so a jump or a bump does not move the picture. It only lifts (eased)
        // to keep a ball high in the air (the clouds) on screen, and drops to keep a falling one.
        camera.focus = marbleDepth(game, game.player);
        const ground = trackLineY(game.track.platformer!.plan, camera.focus, camera.x);
        camera.y = trackCameraY(trackCam, { ground, ballY: p.y, height, scale: camera.scale, dtMs: dt, framed });
        camera.originX = run.origin.x; camera.originY = run.origin.y;
        camera.dtMs = dt;
        meter.time('draw', () => renderPlatformer(ctx, game, camera, width, height, pausedRef.current ? game.time : now, game.player));
        const grounded = game.player.grounded < 5;
        meter.time('fx', () => painter.paint(ctx, {
          width, height, camera, dtMs: dt, frameMs, km: run.km, elapsedMs: elapsed, reduceMotion: reduceRef.current, paused: pausedRef.current,
          ball: { x: p.x, y: p.y, vx: v.x, vy: v.y, grounded },
        }));
        meter.draw(ctx, width, `${canvas.width}x${canvas.height}px (${Math.round(renderScale.scale * 100)}%)`);
        const biome = biomeAt(run.km, seed);
        const here = biome.t > 0.5 ? biome.to : biome.from;
        audio.setRoot(here.root);
        const dark = dayAt(run.km, elapsed).dark;
        // The music is the radio's Infinity Skies (night tracks after dark, tracks made for the biome by day). The ball's
        // rolling and wind are the shared recorded loops, the forest (or crickets) underneath.
        radio.setScene('infinity', dark > 0.5, here.id);
        raceAudio.setAmbience(dark > 0.5 ? 'amb-night' : 'amb-forest', 0.14);
        raceAudio.setDrive(pausedRef.current ? null : { speed: Math.hypot(v.x, v.y), grounded, engine: !!game.player.engineOn });
        const cues = game.sounds.splice(0);
        if (cues.length && !pausedRef.current) {
          const listener = { x: camera.x, y: camera.y, halfHeight: height / 2 / camera.scale };
          for (const cue of cues) raceAudio.play(cue, listener);
        }
      }
      // A death pit took a life: the hearts shake at once (not at the next HUD tick); the last one ends the run and its
      // takings are banked straight away.
      if (run.livesLost !== lostSeen) {
        lostSeen = run.livesLost;
        setLives(run.lives); setLost(run.livesLost);
        if (run.over) { endRun(); setKm(run.km); setRings(run.rings); setOver(true); controls.current = { left: false, right: false, touch: 0, engine: false }; }
      }
      if (fadeRef.current) fadeRef.current.style.opacity = String(Math.min(1, run.fade * 1.1).toFixed(2));
      hudTimer += dt; bankTimer += dt;
      if (hudTimer > 120) { hudTimer = 0; setKm(run.km); setRings(run.rings); setHot((game.player.engine?.lockedUntil ?? 0) > game.time && !pausedRef.current); }
      if (bankTimer > BANK_EVERY_MS && !pausedRef.current) { bankTimer = 0; recordDistance(run.km, banked); banked = run.km; bankRun(); }
      unblend();
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pointerdown', unlock);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerUp);
      endRun();
      audio.stop();
      raceAudio.stopDrive();
      raceAudio.setAmbience(null);
      audioRef.current = null;
      runRef.current = null;
      run.destroy();
    };
  }, [seedText, driver, setPaused, toggleMute, pressJump, setZoom, restarts]);

  const hold = (key: 'left' | 'right') => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); controls.current[key] = true; },
    onPointerUp: () => { controls.current[key] = false; },
    onPointerCancel: () => { controls.current[key] = false; },
    onLostPointerCapture: () => { controls.current[key] = false; },
  });

  return <div className="infinity-screen" data-ui={uiHidden ? 'hidden' : 'shown'}>
    <HeatEdges on={hot} />
    <canvas ref={canvasRef} className="infinity-canvas" aria-label="Infinity: a ball rolling across an endless land. Arrow keys steer, up or space jumps, down fires the Magic Engine, P pauses, H hides the buttons." />
    <div ref={fadeRef} className="infinity-fade" aria-hidden="true" />
    {uiHidden && <button className="infinity-reveal" aria-label="Show the buttons" onClick={() => setUiHidden(false)} />}
    {!uiHidden && <>
      <div className="infinity-hud" aria-live="off">
        <span className="infinity-km"><strong>{formatKm(km)}</strong><small>km</small></span>
        <span key={lost} className={`infinity-lives${lost ? ' is-hit' : ''}`} aria-label={`${lives} of ${INFINITY_LIVES} lives`} title="Lives: fall into a pit and you lose one. Lose them all and the run is over.">
          {Array.from({ length: INFINITY_LIVES }, (_, i) => <Heart key={i} size={17} className={i < lives ? 'on' : 'off'} aria-hidden="true" />)}
        </span>
        <span className="infinity-rings" title={`Gold rings: ${RING_CREDITS} credits each`}><i aria-hidden="true" /><strong>{rings}</strong><small>+{rings * RING_CREDITS} CR</small></span>
        {savedNote && <span className="infinity-note" role="status">{savedNote}</span>}
      </div>
      <div className="infinity-tools">
        <RadioPill compact />
        <button className="infinity-icon" onClick={() => setPaused(true)} aria-label="Pause" title="Pause (P)"><Pause size={18} /></button>
        <button className="infinity-icon" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} title="Sound (M)">{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
        <button className="infinity-icon" onClick={() => setZoom(shownZoomRef.current / 1.25)} disabled={zoom !== null && zoom <= INFINITY_ZOOM_MIN} aria-label="Zoom out" title="Zoom out (-)"><ZoomOut size={18} /></button>
        <button className="infinity-icon" onClick={() => setZoom(shownZoomRef.current * 1.25)} disabled={zoom !== null && zoom >= INFINITY_ZOOM_MAX} aria-label="Zoom in" title="Zoom in (+)"><ZoomIn size={18} /></button>
        {zoom !== null && <button className="infinity-icon infinity-auto-zoom" onClick={() => setZoom(null)} aria-label="Automatic zoom" title="Automatic zoom (0)">A</button>}
        <button className="infinity-icon" onClick={savePicture} aria-label="Save picture" title="Save a picture"><Camera size={18} /></button>
        <button className="infinity-icon" onClick={() => setUiHidden(true)} aria-label="Hide the buttons" title="Hide the buttons (H)"><EyeOff size={18} /></button>
      </div>
      <div className="infinity-controls">
        <div className="infinity-steer">
          <button className="infinity-pad" aria-label="Steer left" {...hold('left')}><ArrowLeft size={22} /></button>
          <button className="infinity-pad" aria-label="Steer right" {...hold('right')}><ArrowRight size={22} /></button>
        </div>
        <div className="infinity-thumbs">
          <button className="infinity-pad wide" aria-label="Magic Engine (hold)"
            onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); controls.current.engine = true; }}
            onPointerUp={() => { controls.current.engine = false; }} onPointerCancel={() => { controls.current.engine = false; }} onLostPointerCapture={() => { controls.current.engine = false; }}>ENGINE</button>
          <button className="infinity-pad wide" aria-label="Jump" onPointerDown={(e) => { e.preventDefault(); pressJump(); }}>JUMP</button>
        </div>
      </div>
    </>}
    {over && <Dialog titleId="infinity-over-title" onClose={() => { setOver(false); setRestarts((n) => n + 1); }} className="pause-dialog infinity-pause infinity-over">
      <span className="eyebrow">INFINITY / OUT OF LIVES</span>
      <h2 id="infinity-over-title">The pit wins this one.</h2>
      <p className="dialog-intro">You rolled {formatKm(km)} km on the seed “{seedText}” and picked up {rings} gold {rings === 1 ? 'ring' : 'rings'} (+{rings * RING_CREDITS} CR). Your distance and rings are banked.</p>
      <div className="pause-actions">
        <button className="button-primary" onClick={() => { setOver(false); setKm(0); setRestarts((n) => n + 1); }} autoFocus><RotateCcw size={15} />Try again</button>
        <button className="button-secondary" onClick={onNewSeed}>New seed</button>
        <button className="button-secondary" onClick={() => { endRunRef.current(); onLeave(); }}>Leave</button>
      </div>
    </Dialog>}
    {paused && !over && <Dialog titleId="infinity-pause-title" onClose={() => setPaused(false)} className="pause-dialog infinity-pause">
      <span className="eyebrow">INFINITY</span>
      <h2 id="infinity-pause-title">Taking a breath.</h2>
      <p className="dialog-intro">{formatKm(km)} km so far on the seed “{seedText}”. Nothing is lost whenever you stop.</p>
      <label className="infinity-option"><input type="checkbox" checked={reduceMotion} onChange={(e) => { setReduceMotionState(e.target.checked); setReduceMotion(e.target.checked); }} /> Reduce motion (fewer drifting things, no twinkle)</label>
      <div className="pause-actions">
        <button className="button-primary" onClick={() => setPaused(false)} autoFocus><Play size={15} />Resume</button>
        <button className="button-secondary" onClick={() => { setPaused(false); setKm(0); setRestarts((n) => n + 1); }}><RotateCcw size={15} />Restart</button>
        <button className="button-secondary" onClick={onNewSeed}>New seed</button>
        <button className="button-secondary" onClick={() => { endRunRef.current(); onLeave(); }}>Leave</button>
      </div>
    </Dialog>}
  </div>;
}
