/**
 * MB-04. Test drive — play the track inside the editor.
 *
 * Drops the current garage marble (or 10 when ghost field is on) on the
 * def-built track and runs the real `Game` with its normal HUD minimal
 * variant.  Esc returns to the editor at the same camera position.
 * Shows a live trail of the test marble so builders can see where it went.
 * Ghost toggle and trail are the spec's two explicit extras.
 *
 * Physics is stepped here — the only place the editor steps — and the
 * static chunk cache is rebaked on exit via `clearStaticChunks` like the
 * shell does after any geometry edit.  The editor's own `rig` is never
 * touched (the test has its own follow camera), so the round-trip keeps
 * def and camera unchanged per acceptance.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import { Game } from '../../game/engine';
import { buildTrackFromDef } from '../../game/trackdef';
import { W } from '../../game/track';
import { PHYSICS_STEP, formatTime } from '../../game/physics';
import { render, clearStaticChunks } from '../../game/render';
import { AI_COLORS, randomStats, mulberry32, ITEM_TYPES } from '../../game/types';
import type { MarbleInfo } from '../../game/types';
import { RIVALS } from '../../game/characters';
import type { TrackDef } from '../../game/trackdef';
import type { Point } from './camera';

const { Body } = Matter;

interface Props {
  def: TrackDef;
  driver: MarbleInfo;
  seed: number;
  ghost: boolean;
  spawnAt: Point | null;
  onExit: () => void;
}

function makeGhostRoster(seed: number, driver: MarbleInfo): MarbleInfo[] {
  const rng = mulberry32(seed ^ 0x9e3779b9 ^ 0x12345);
  const pool = RIVALS.map((_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const roster: MarbleInfo[] = [{ ...driver, id: 0, isPlayer: true }];
  for (let i = 0; i < 9; i++) {
    roster.push({
      id: i + 1,
      name: RIVALS[pool[i % pool.length]].name,
      character: pool[i % pool.length],
      color: AI_COLORS[i % AI_COLORS.length],
      stats: randomStats(rng),
      isPlayer: false,
    });
  }
  return roster;
}

interface Hud {
  time: number;
  rank: number;
  speed: number;
  trail: number;
  finished: boolean;
}

export default function TestDrive({ def, driver, seed, ghost, spawnAt, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const controls = useRef({ left: false, right: false });
  const [hud, setHud] = useState<Hud>({ time: 0, rank: 1, speed: 0, trail: 0, finished: false });
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const exit = useCallback(() => {
    onExit();
  }, [onExit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const track = buildTrackFromDef(def);
    const roster = ghost ? makeGhostRoster(seed, driver) : [{ ...driver, id: 0, isPlayer: true }];
    const game = new Game(track.seed ?? seed, roster, { track, effects: true, aiItems: ghost, recovery: true });
    gameRef.current = game;

    // Spawn override: drop at clicked point if provided, else grid.
    if (spawnAt) {
      const p = game.player.body.position;
      Body.setPosition(game.player.body, { x: spawnAt.x, y: spawnAt.y });
      Body.setVelocity(game.player.body, { x: 0, y: 0 });
      // Keep trail起点 at spawn
      game.player.trail = [];
      void p;
    }

    let gateTimer: ReturnType<typeof setTimeout> | undefined;
    // Open gate after a short formation — mirrors quick race but without lights
    gateTimer = setTimeout(() => game.openGate(), 500);

    let width = 0;
    let height = 0;
    const dpr = () => Math.min(2, devicePixelRatio || 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr());
      canvas.height = Math.round(height * dpr());
      ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const camera = { x: W / 2, y: track.startY + 140, scale: 1 };
    const trail: Point[] = [];
    const MAX_TRAIL = 600;
    let last = performance.now();
    let acc = 0;
    let hudTimer = 0;
    let raf = 0;

    const worldToScreen = (w: Point) => ({
      x: (w.x - camera.x) * camera.scale + width / 2,
      y: (w.y - camera.y) * camera.scale + height / 2,
    });

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.max(0, Math.min(now - last, 50));
      last = now;
      if (pausedRef.current) {
        // Still render paused frame without stepping
        render(ctx, game, camera, width, height, now, { minimap: false, shake: false });
        // Draw trail even when paused
        if (trail.length > 1) {
          ctx.save();
          ctx.strokeStyle = 'rgba(214,62,46,0.85)';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          for (let i = 0; i < trail.length; i++) {
            const s = worldToScreen(trail[i]);
            if (i === 0) ctx.moveTo(s.x, s.y);
            else ctx.lineTo(s.x, s.y);
          }
          ctx.stroke();
          ctx.restore();
        }
        return;
      }
      acc += dt;
      // Apply nudge from controls
      game.nudge = Number(controls.current.right) - Number(controls.current.left);
      while (acc >= PHYSICS_STEP) {
        game.step(PHYSICS_STEP);
        acc -= PHYSICS_STEP;
      }

      // Record live trail of the test marble (player) — cap for performance.
      const pos = game.player.body.position;
      // Only record when gate open and marble moving or finished not yet
      if (game.gateOpen) {
        const lastPt = trail[trail.length - 1];
        if (!lastPt || Math.hypot(pos.x - lastPt.x, pos.y - lastPt.y) > 2) {
          trail.push({ x: pos.x, y: pos.y });
          if (trail.length > MAX_TRAIL) trail.shift();
        }
      }

      // Follow camera — smooth lerp to player, like RaceScreen but simpler
      if (width > 0 && height > 0) {
        const p = game.player.body.position;
        const targetScale = Math.min(1.2, Math.max(0.55, height / 900));
        camera.scale += (targetScale - camera.scale) * (1 - Math.exp(-dt / 200));
        const halfH = height / 2 / camera.scale;
        const halfW = width / 2 / camera.scale;
        const targetX = halfW >= W / 2 ? W / 2 : Math.max(halfW - 12, Math.min(W - halfW + 12, p.x));
        const targetY = p.y + 90;
        camera.x += (targetX - camera.x) * (1 - Math.exp(-dt / 140));
        camera.y += (targetY - camera.y) * (1 - Math.exp(-dt / 140));
        camera.y = halfH * 2 >= track.height ? track.height / 2 : Math.max(halfH - 12, Math.min(track.height - halfH + 12, camera.y));
      }

      render(ctx, game, camera, width, height, now, { minimap: false, shake: true });

      // Draw live trail over the rendered track — builder-visible path
      if (trail.length > 1) {
        ctx.save();
        ctx.strokeStyle = 'rgba(22, 200, 255, 0.92)';
        ctx.lineWidth = Math.max(1.5, 2.2 * camera.scale);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(22,200,255,0.4)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        for (let i = 0; i < trail.length; i++) {
          const s = worldToScreen(trail[i]);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Head dot
        const head = worldToScreen(trail[trail.length - 1]);
        ctx.fillStyle = '#16c8ff';
        ctx.beginPath();
        ctx.arc(head.x, head.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      hudTimer += dt;
      if (hudTimer > 90) {
        hudTimer = 0;
        const v = game.player.body.velocity;
        const speed = Math.hypot(v.x, v.y) * 6;
        const rank = game.gateOpen ? game.playerRank() : 1;
        const finished = game.player.finishedAt !== null;
        setHud({ time: game.raceTime(), rank, speed, trail: trail.length, finished });
      }
    };
    raf = requestAnimationFrame(loop);

    const onKey = (e: KeyboardEvent, down: boolean) => {
      if ((e.code === 'Escape' || e.code === 'Space') && down && !e.repeat) {
        e.preventDefault();
        exit();
        return;
      }
      if (e.code === 'KeyP' && down && !e.repeat) {
        // Pause toggle for test drive
        setPaused((v) => !v);
        return;
      }
      if (down && e.code.startsWith('Numpad')) {
        const num = parseInt(e.code.replace('Numpad', ''), 10);
        if (num >= 1 && num <= 9) {
          e.preventDefault();
          if (gameRef.current) {
            const item = ITEM_TYPES[num - 1];
            gameRef.current.player.inventory[item] = 99;
            gameRef.current.useItem(gameRef.current.player, item);
          }
        }
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') controls.current.left = down;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') controls.current.right = down;
      if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)) e.preventDefault();
    };
    const keyDown = (e: KeyboardEvent) => onKey(e, true);
    const keyUp = (e: KeyboardEvent) => onKey(e, false);
    const onBlur = () => { controls.current.left = false; controls.current.right = false; };

    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(gateTimer);
      ro.disconnect();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', onBlur);
      clearStaticChunks(game);
      game.destroy();
      gameRef.current = null;
    };
  }, [def, driver, seed, ghost, spawnAt, exit]);

  return (
    <div className="testdrive-wrap">
      <canvas ref={canvasRef} className="testdrive-canvas" aria-label="Test drive — arrow keys or A/D to nudge, Esc to return to editor" />
      <div className="testdrive-hud">
        <div className="testdrive-hud-left">
          <span className="testdrive-chip">TEST DRIVE</span>
          <span className="testdrive-chip">{hud.finished ? 'FINISHED' : ghost ? 'GHOST FIELD · 10 MARBLES' : 'SOLO'}</span>
          <span className="testdrive-chip">TIME {formatTime(hud.time)}</span>
          <span className="testdrive-chip">RANK P{hud.rank}</span>
          <span className="testdrive-chip">{Math.round(hud.speed)} cm/s</span>
          <span className="testdrive-chip">TRAIL {hud.trail} PTS</span>
        </div>
        <div className="testdrive-hud-right">
          <button className="text-button" onClick={() => setPaused((v) => !v)} aria-label={paused ? 'Resume' : 'Pause'}>
            {paused ? 'Resume (P)' : 'Pause (P)'}
          </button>
          <button className="button-primary" onClick={exit} aria-label="Return to editor">
            Exit to editor (Esc)
          </button>
        </div>
      </div>
      <p className="testdrive-help">A/D or \u2190/\u2192 to nudge | P to pause | Space/Esc to return | Camera follows test marble | Ghost toggle in editor</p>

      {/* Infinite skills drawer */}
      <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6, background: 'rgba(0,0,0,0.85)', padding: '6px 12px', borderRadius: 12, border: '1px solid #444', alignItems: 'center' }}>
        <span style={{ color: '#aaa', fontSize: 10, marginRight: 8, fontFamily: 'var(--mono)', letterSpacing: 1 }}>SKILLS</span>
        {ITEM_TYPES.slice(0, 9).map((item, i) => (
          <button 
            key={item} 
            onClick={() => { 
              if (gameRef.current) {
                gameRef.current.player.inventory[item] = 99;
                gameRef.current.useItem(gameRef.current.player, item);
              }
            }}
            style={{ 
              color: '#fff', background: '#222', border: '1px solid #555', borderRadius: 4, 
              padding: '4px 8px', fontSize: 10, cursor: 'pointer', fontFamily: 'var(--mono)',
              transition: 'background 0.1s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = '#444'}
            onMouseOut={(e) => e.currentTarget.style.background = '#222'}
            title={`Press Numpad ${i + 1} to use`}
          >
            <span style={{ color: '#888', marginRight: 4 }}>{i + 1}</span>
            {item.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
