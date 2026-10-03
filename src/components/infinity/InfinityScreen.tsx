// P2-24: the Infinity run screen. Full screen, landscape-first, no rivals, no timer, no ranking, no health bar: a ball
// rolling across a land that grows ahead of it. The HUD is one soft distance readout, a pause button, a mute button and
// Hide UI (photo mode: only the world, tap anywhere to bring the buttons back).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, EyeOff, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { InfinityRun } from '../../game/platformer/infinity-world';
import { marbleDepth, renderPlatformer } from '../../game/platformer/render';
import { PHYSICS_STEP } from '../../game/physics';
import { nudgeOf } from '../../game/controls';
import { actionForKey } from '../../game/skill-keys';
import { raceAudio } from '../../game/audio';
import { formatKm, loadRecords, recordDistance, recordStart, seedFromText, setReduceMotion } from '../../game/infinity-store';
import { biomeAt, dayAt } from '../../game/infinity-look';
import { InfinityAudio } from '../../game/infinity-audio';
import { InfinityPainter } from './InfinityPainter';
import type { MarbleInfo } from '../../game/types';
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

export default function InfinityScreen({ seedText, driver, onLeave, onNewSeed }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const controls = useRef({ left: false, right: false, touch: 0, engine: false });
  const runRef = useRef<InfinityRun | null>(null);
  const pausedRef = useRef(false);
  const [paused, setPausedState] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [muted, setMuted] = useState(() => raceAudio.loadPreference());
  const [km, setKm] = useState(0);
  // P2-25: fewer particles and no drifting motion; remembered with the records.
  const [reduceMotion, setReduceMotionState] = useState(() => loadRecords().reduceMotion);
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;
  const audioRef = useRef<InfinityAudio | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

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
    const audio = new InfinityAudio(seed);
    audioRef.current = audio;
    audio.setMuted(raceAudio.muted);
    painter.onKm = () => audio.chime();
    let elapsed = 0, frameMs = 16;
    runRef.current = run;
    recordStart(seedText);
    if (import.meta.env.DEV) (window as unknown as { __infinity?: unknown }).__infinity = run;
    const game = run.game;
    const camera = { x: game.player.body.position.x + 200, y: game.player.body.position.y - 40, scale: 0.8, focus: 1 };
    let width = 0, height = 0, raf = 0, last = performance.now(), accumulator = 0, hudTimer = 0, bankTimer = 0, banked = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const onKey = (event: KeyboardEvent, down: boolean) => {
      if (event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable)) return;
      if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return;
      if (down && !event.repeat) { raceAudio.unlock(); audio.start(); }
      if (down && !event.repeat && event.code === 'KeyM') { toggleMute(); return; }
      if (down && !event.repeat && (event.code === 'KeyP' || event.code === 'Escape')) { setPaused(!pausedRef.current); return; }
      if (down && !event.repeat && event.code === 'KeyH') { setUiHidden((v) => !v); return; }
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

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(now - last, 100);
      last = now;
      frameMs += (dt - frameMs) * 0.05;
      if (!pausedRef.current) elapsed += dt;
      if (!pausedRef.current) {
        game.nudge = nudgeOf(controls.current);
        game.engineHeld = controls.current.engine;
        accumulator += dt;
        while (accumulator >= PHYSICS_STEP) { run.step(PHYSICS_STEP); accumulator -= PHYSICS_STEP; }
      }
      if (width > 0 && height > 0) {
        const p = game.player.body.position;
        // Side-scrolling camera, framed for landscape, easing toward a little way ahead of the ball.
        // P2-25: a slow zoom out as the ball picks up speed (never sudden).
        const v = game.player.body.velocity;
        const speed = Math.hypot(v.x, v.y);
        const target = Math.max(0.42, Math.min(1.25, Math.min(width / 1000, height / 520))) * (1 - Math.min(0.16, speed * 0.011));
        camera.scale += (target - camera.scale) * (1 - Math.exp(-dt / 180));
        const ahead = Math.max(-160, Math.min(260, game.player.body.velocity.x * 26));
        camera.x += (p.x + ahead - camera.x) * (1 - Math.exp(-dt / 220));
        camera.y += (p.y + 10 - camera.y) * (1 - Math.exp(-dt / 200));
        camera.focus = marbleDepth(game, game.player);
        renderPlatformer(ctx, game, camera, width, height, pausedRef.current ? game.time : now, game.player);
        const grounded = game.player.grounded < 5;
        painter.paint(ctx, {
          width, height, camera, dtMs: dt, frameMs, km: run.km, elapsedMs: elapsed, reduceMotion: reduceRef.current, paused: pausedRef.current,
          ball: { x: p.x, y: p.y, vx: v.x, vy: v.y, grounded },
        });
        const biome = biomeAt(run.km, seed);
        const music = biome.t > 0.5 ? biome.to : biome.from;
        audio.setScale(music.scale, music.root);
        audio.update(pausedRef.current ? 0 : speed, grounded && !pausedRef.current, dayAt(run.km, elapsed).dark);
        const cues = game.sounds.splice(0);
        if (cues.length && !pausedRef.current) {
          const listener = { x: camera.x, y: camera.y, halfHeight: height / 2 / camera.scale };
          for (const cue of cues) raceAudio.play(cue, listener);
        }
      }
      if (fadeRef.current) fadeRef.current.style.opacity = String(Math.min(1, run.fade * 1.1).toFixed(2));
      hudTimer += dt; bankTimer += dt;
      if (hudTimer > 120) { hudTimer = 0; setKm(run.km); }
      if (bankTimer > BANK_EVERY_MS && !pausedRef.current) { bankTimer = 0; recordDistance(run.km, banked); banked = run.km; }
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
      recordDistance(run.km, banked);
      audio.stop();
      audioRef.current = null;
      runRef.current = null;
      run.destroy();
    };
  }, [seedText, driver, setPaused, toggleMute, pressJump]);

  const hold = (key: 'left' | 'right') => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); controls.current[key] = true; },
    onPointerUp: () => { controls.current[key] = false; },
    onPointerCancel: () => { controls.current[key] = false; },
    onLostPointerCapture: () => { controls.current[key] = false; },
  });

  return <div className="infinity-screen" data-ui={uiHidden ? 'hidden' : 'shown'}>
    <canvas ref={canvasRef} className="infinity-canvas" aria-label="Infinity: a ball rolling across an endless land. Arrow keys steer, up or space jumps, down fires the Magic Engine, P pauses, H hides the buttons." />
    <div ref={fadeRef} className="infinity-fade" aria-hidden="true" />
    {uiHidden && <button className="infinity-reveal" aria-label="Show the buttons" onClick={() => setUiHidden(false)} />}
    {!uiHidden && <>
      <div className="infinity-hud" aria-live="off">
        <span className="infinity-km"><strong>{formatKm(km)}</strong><small>km</small></span>
        {savedNote && <span className="infinity-note" role="status">{savedNote}</span>}
      </div>
      <div className="infinity-tools">
        <button className="infinity-icon" onClick={() => setPaused(true)} aria-label="Pause" title="Pause (P)"><Pause size={18} /></button>
        <button className="infinity-icon" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} title="Sound (M)">{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
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
    {paused && <Dialog titleId="infinity-pause-title" onClose={() => setPaused(false)} className="pause-dialog infinity-pause">
      <span className="eyebrow">INFINITY</span>
      <h2 id="infinity-pause-title">Taking a breath.</h2>
      <p className="dialog-intro">{formatKm(km)} km so far on the seed “{seedText}”. Nothing is lost whenever you stop.</p>
      <label className="infinity-option"><input type="checkbox" checked={reduceMotion} onChange={(e) => { setReduceMotionState(e.target.checked); setReduceMotion(e.target.checked); }} /> Reduce motion (fewer drifting things, no twinkle)</label>
      <div className="pause-actions">
        <button className="button-primary" onClick={() => setPaused(false)} autoFocus><Play size={15} />Resume</button>
        <button className="button-secondary" onClick={onNewSeed}>New seed</button>
        <button className="button-secondary" onClick={onLeave}>Leave</button>
      </div>
    </Dialog>}
  </div>;
}
