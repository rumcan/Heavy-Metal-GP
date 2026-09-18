/**
 * A tall, to-scale map of a whole track, drawn from its def: ramps and rails as lines, pegs in their colours,
 * loops, bumpers, walls, crates, boosts and the finish, so a player can scroll it and see what was built.
 * The canvas is as tall as the track needs at `width` px wide; wrap it in a scrolling box.
 * Drawing is deferred until the map scrolls into view, so a long list stays cheap.
 */
import { useEffect, useRef, useState } from 'react';
import { W, FINISH_H, START_H } from '../game/track';
import type { Piece, TrackDef } from '../game/trackdef';

const COLORS = {
  bg: '#0c1520', grid: 'rgba(255,255,255,0.04)', wall: '#56657a', wood: '#c98a4b', ice: '#8fd3ff', curve: '#d99a5a',
  blue: '#3b82f6', orange: '#f97316', item: '#a855f7', bumper: '#e0453a', loop: '#f2b36b', hoop: '#ff8a3d',
  boost: '#e0453a', spinner: '#f5c542', wrecker: '#9aa6b2', pad: '#b690ff', crate: '#b87a3e', block: '#7c8ba0', itembox: '#f5c542', bucket: '#34d399',
};

function drawPiece(ctx: CanvasRenderingContext2D, p: Piece, k: number) {
  const X = (x: number) => (p.flip ? W - x : x) * k;
  const Y = (y: number) => y * k;
  const line = (ax: number, ay: number, bx: number, by: number, color: string, width: number) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(bx), Y(by)); ctx.stroke();
  };
  const dot = (x: number, y: number, r: number, color: string) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(x), Y(y), Math.max(1.2, r * k), 0, Math.PI * 2); ctx.fill();
  };
  const box = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color; ctx.fillRect(X(x) - (w * k) / 2, Y(y) - (h * k) / 2, Math.max(1.5, w * k), Math.max(1.5, h * k));
  };
  switch (p.t) {
    case 'ramp': line(p.a[0], p.a[1], p.b[0], p.b[1], COLORS.wood, Math.max(2, 14 * k)); break;
    case 'ice': line(p.a[0], p.a[1], p.b[0], p.b[1], COLORS.ice, Math.max(2, 14 * k)); break;
    case 'curve': {
      ctx.strokeStyle = COLORS.curve; ctx.lineWidth = Math.max(2, 14 * k); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(X(p.a[0]), Y(p.a[1])); ctx.quadraticCurveTo(X(p.c[0]), Y(p.c[1]), X(p.b[0]), Y(p.b[1])); ctx.stroke();
      break;
    }
    case 'loop':
      ctx.strokeStyle = COLORS.loop; ctx.lineWidth = Math.max(1.5, 10 * k);
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.bottom - p.r), p.r * k, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'hoop':
      ctx.strokeStyle = COLORS.hoop; ctx.lineWidth = Math.max(1.5, 6 * k);
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), Math.max(3, 30 * k), 0, Math.PI * 2); ctx.stroke();
      break;
    case 'boost': {
      const m = Math.hypot(p.dir[0], p.dir[1]) || 1;
      const dx = (p.dir[0] / m) * p.len / 2, dy = (p.dir[1] / m) * p.len / 2;
      line(p.x - dx, p.y - dy, p.x + dx, p.y + dy, COLORS.boost, Math.max(2, p.thick * k));
      break;
    }
    case 'spinner': line(p.x - p.len / 2, p.y, p.x + p.len / 2, p.y, COLORS.spinner, Math.max(1.5, 8 * k)); break;
    case 'wrecker': {
      const bx = p.pivot[0], by = p.pivot[1] + p.chain;
      line(p.pivot[0], p.pivot[1], bx, by, COLORS.wrecker, 1);
      dot(bx, by, 26, COLORS.wrecker);
      break;
    }
    case 'pad': box(p.x, p.y, p.w, 14, COLORS.pad); break;
    case 'breakable': box(p.x, p.y, p.w, p.h, COLORS.crate); break;
    case 'wall': box(p.x, p.y, p.w, p.h, COLORS.wall); break;
    case 'block': box(p.x, p.y, p.w, p.h, COLORS.block); break;
    case 'peg': dot(p.x, p.y, Math.max(p.r, 14), COLORS.bumper); break;
    case 'ppeg': dot(p.x, p.y, Math.max(p.r, 9), p.color === 'orange' ? COLORS.orange : p.color === 'green' ? COLORS.item : COLORS.blue); break;
    case 'itembox': box(p.x, p.y, 30, 30, COLORS.itembox); break;
    case 'bucket': box(W / 2, p.y, 110, 30, COLORS.bucket); break;
  }
}

export function drawTrackMap(canvas: HTMLCanvasElement, def: TrackDef, width: number) {
  const k = width / W;
  const height = Math.max(40, Math.round(def.height * k));
  const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  // every 1000 u, a faint line so length reads at a glance
  ctx.fillStyle = COLORS.grid;
  for (let y = 1000; y < def.height; y += 1000) ctx.fillRect(0, y * k, width, 1);
  // start gate and finish
  ctx.fillStyle = '#e8b04a';
  ctx.fillRect(0, (START_H - 60) * k, width, Math.max(2, 8 * k));
  const fy = (def.height - FINISH_H + 40) * k;
  const sq = 5;
  for (let x = 0, i = 0; x < width; x += sq, i++) {
    ctx.fillStyle = i % 2 ? '#111' : '#eee';
    ctx.fillRect(x, fy, sq, sq);
    ctx.fillStyle = i % 2 ? '#eee' : '#111';
    ctx.fillRect(x, fy + sq, sq, sq);
  }
  for (const p of def.pieces) drawPiece(ctx, p, k);
}

export default function TrackMap({ def, width = 120, label }: { def: TrackDef; width?: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (visible && ref.current) drawTrackMap(ref.current, def, width);
  }, [visible, def, width]);
  return <canvas ref={ref} className="track-map" width={width} height={Math.round(def.height * (width / W))} role="img" aria-label={label ?? `Map of ${def.name}`} />;
}
