import { useEffect, useRef, useState } from 'react';
import { Pause, Play, ScanLine } from 'lucide-react';
import { Game } from '../game/engine';
import { render } from '../game/render';
import { PHYSICS_STEP } from '../game/physics';
import { HEAT_TIME_LIMIT } from '../game/physics';
import { W } from '../game/track';
import type { MarbleInfo, TrackProfile } from '../game/types';
import type { TrackDef } from '../game/trackdef';

/** `def`: a player-built circuit to preview instead of generating one from `seed` + `profile`. */
interface Props { seed: number; roster: MarbleInfo[]; profile: TrackProfile; def?: TrackDef | null }

export default function CircuitPreview({ seed, roster, profile, def }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [sector, setSector] = useState('Formation');

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let game: Game;
    const setup = () => {
      game = new Game(seed, roster, { profile, def: def ?? undefined });
      game.openGate();
      for (let tick = 0; tick < 200; tick++) game.step(PHYSICS_STEP);
    };
    setup();
    let width = 0;
    let height = 0;
    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let labelTimer = 0;
    const camera = { x: W / 2, y: game!.player.body.position.y + 180, scale: 1 };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    const loop = (now: number) => {
      const dt = Math.min(now - last, 40);
      last = now;
      if (!pausedRef.current && !document.hidden) {
        accumulator += dt * 0.78;
        while (accumulator >= PHYSICS_STEP) { game.step(PHYSICS_STEP); accumulator -= PHYSICS_STEP; }
        if (game.allFinished() || game.raceTime() > HEAT_TIME_LIMIT) { game.destroy(); setup(); camera.y = game.player.body.position.y; }
      }
      const follow = game.player.finishedAt === null ? game.player : game.ranking().find((r) => !r.finished)?.marble ?? game.player;
      const target = follow.body.position.y + 130;
      camera.scale = width / (W + 90);
      const halfHeight = height / 2 / camera.scale;
      camera.y += (target - camera.y) * (1 - Math.exp(-dt / 240));
      camera.y = Math.max(halfHeight - 15, Math.min(game.track.height - halfHeight + 15, camera.y));
      if (width && height) render(ctx, game, camera, width, height, now, { minimap: false, shake: false });
      labelTimer += dt;
      if (labelTimer > 500) {
        labelTimer = 0;
        setSector(game.track.segments.find((s) => follow.body.position.y >= s.y && follow.body.position.y < s.y + s.h)?.name ?? 'Finish');
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); game.destroy(); };
  }, [seed, roster, profile, def]);

  return <div className="circuit-canvas-wrap">
    <canvas ref={canvasRef} className="circuit-canvas" aria-label="Live preview of marbles racing on the selected circuit" />
    <div className="preview-sector"><ScanLine size={15} /><span>{sector}</span></div>
    <button className="preview-pause icon-button" aria-label={paused ? 'Play circuit preview' : 'Pause circuit preview'} onClick={() => { pausedRef.current = !paused; setPaused(!paused); }}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>
    <div className="preview-live"><i className={paused ? 'is-paused' : ''} /> {paused ? 'PREVIEW PAUSED' : 'LIVE PHYSICS'}</div>
  </div>;
}