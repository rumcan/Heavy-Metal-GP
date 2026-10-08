// How the premium skills look (skills/premium.ts). Vector drawing like draw.ts, so it works with any skin: the hexes and
// auras on a ball, and the shots and things in the world, each in the lane it belongs to.
import type { Game, Marble } from '../engine';
import { MARBLE_RADIUS } from '../types';
import { LASER_LEN, bladePoints } from './premium';
import type { PremiumFx } from './premium';

const R = MARBLE_RADIUS;
const TAU = Math.PI * 2;

function spikes(ctx: CanvasRenderingContext2D, x: number, y: number, r0: number, r1: number, n: number, rot: number) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU, b = rot + ((i + 0.5) / n) * TAU, c = rot + ((i + 1) / n) * TAU;
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    ctx.lineTo(x + Math.cos(b) * r1, y + Math.sin(b) * r1);
    ctx.lineTo(x + Math.cos(c) * r0, y + Math.sin(c) * r0);
  }
  ctx.fill();
}

function saw(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.fillStyle = '#e2e8f0';
  spikes(ctx, x, y, r * 0.7, r, 8, rot);
  ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0, TAU); ctx.fill();
  ctx.fillStyle = '#64748b';
  ctx.beginPath(); ctx.arc(x, y, r * 0.25, 0, TAU); ctx.fill();
}

function bomb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lit: boolean) {
  ctx.fillStyle = '#1f2937';
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#a16207'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + r * 0.5, y - r * 0.8); ctx.quadraticCurveTo(x + r, y - r * 1.5, x + r * 1.3, y - r * 1.3); ctx.stroke();
  ctx.fillStyle = lit ? '#fde047' : '#f97316';
  ctx.beginPath(); ctx.arc(x + r * 1.3, y - r * 1.3, lit ? 3.5 : 2.5, 0, TAU); ctx.fill();
}

/** The hexes and auras on one ball (world space, at its position). */
export function drawPremiumAura(ctx: CanvasRenderingContext2D, game: Game, m: Marble, t: number) {
  const fx = m.fx as PremiumFx | undefined;
  if (!fx) return;
  const now = game.time, { x, y } = m.body.position;
  ctx.save();
  if ((fx.liftUntil ?? 0) > now) {
    // a violet telekinetic glow, and wisps rising off it
    const g = ctx.createRadialGradient(x, y, R * 0.5, x, y, R * 2.6);
    g.addColorStop(0, 'rgba(168,85,247,0)'); g.addColorStop(1, 'rgba(168,85,247,0.55)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 2.6, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(216,180,254,0.9)'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const a = t / 260 + i * 1.57; ctx.beginPath(); ctx.arc(x, y, R * (1.6 + 0.3 * Math.sin(t / 120 + i)), a, a + 0.8); ctx.stroke(); }
  }
  if ((fx.bubbleUntil ?? 0) > now) {
    const r = R * 2.1 + Math.sin(t / 140) * 1.5;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(103,232,249,0.15)'); g.addColorStop(1, 'rgba(103,232,249,0.55)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(207,250,254,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  }
  if ((fx.shrinkUntil ?? 0) > now) {
    ctx.strokeStyle = `rgba(236,72,153,${(0.6 + 0.3 * Math.sin(t / 90)).toFixed(2)})`; ctx.lineWidth = 2; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(x, y, R * 1.2, t / 200, t / 200 + TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  if ((fx.slowUntil ?? 0) > now) {
    // an amber clock face ticking round
    ctx.strokeStyle = 'rgba(217,119,6,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, R * 1.7, 0, TAU); ctx.stroke();
    const a = (t / 1000) * TAU * 0.25;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * R * 1.5, y + Math.sin(a) * R * 1.5); ctx.stroke();
  }
  if ((fx.thornsUntil ?? 0) > now) { ctx.fillStyle = '#65a30d'; spikes(ctx, x, y, R * 1.02, R * 1.65, 12, t / 900); }
  if ((fx.bladesUntil ?? 0) > now) for (const b of bladePoints(m, now)) saw(ctx, b.x, b.y, 8, t / 40);
  if (((fx as { zapUntil?: number }).zapUntil ?? 0) > now) {
    ctx.strokeStyle = '#bfdbfe'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + t / 50; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * R, y + Math.sin(a) * R); ctx.lineTo(x + Math.cos(a + 0.3) * R * 1.8, y + Math.sin(a + 0.3) * R * 1.8); ctx.stroke(); }
  }
  ctx.restore();
}

/** The premium shots and things in one lane (`lane` null: everything, for drop tracks). */
export function drawPremiumWorld(ctx: CanvasRenderingContext2D, game: Game, lane: number | null, t: number) {
  const platformer = !!game.track.platformer;
  const here = (l: number) => !platformer || lane === null || l === lane;
  const now = game.time;
  ctx.save();
  for (const z of game.zones) {
    if (!here(z.lane) && z.kind !== 'well' && z.kind !== 'mega') continue;
    const owner = game.byIdOrNull(z.owner);
    switch (z.kind) {
      case 'well': {
        // a black hole with a purple swirl, drawn in every lane it pulls
        const r = 34 + Math.sin(t / 200) * 3;
        const g = ctx.createRadialGradient(z.x, z.y, 4, z.x, z.y, r * 2.4);
        g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(0.35, 'rgba(46,16,101,0.85)'); g.addColorStop(1, 'rgba(109,40,217,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(z.x, z.y, r * 2.4, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(196,181,253,0.7)'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { const a = -t / 180 + i * 2.1; ctx.beginPath(); ctx.arc(z.x, z.y, r * (1.1 + i * 0.35), a, a + 1.6); ctx.stroke(); }
        break;
      }
      case 'mine': {
        const armed = now >= (z.nextAt ?? 0);
        ctx.fillStyle = '#374151'; ctx.beginPath(); ctx.ellipse(z.x, z.y, 11, 6, 0, Math.PI, 0); ctx.fill();
        ctx.fillRect(z.x - 12, z.y - 1, 24, 4);
        ctx.fillStyle = armed && Math.sin(t / 120) > 0 ? '#ef4444' : '#7f1d1d';
        ctx.beginPath(); ctx.arc(z.x, z.y - 6, 2.6, 0, TAU); ctx.fill();
        break;
      }
      case 'wall': {
        const h = z.h ?? 72;
        ctx.fillStyle = '#57534e';
        if (platformer) {
          ctx.fillRect(z.x - 6, z.y - h, 12, h);
          ctx.fillStyle = '#d6d3d1';
          for (let y = z.y - h; y < z.y; y += 12) { ctx.beginPath(); ctx.moveTo(z.x - 6, y); ctx.lineTo(z.x - 20, y + 6); ctx.lineTo(z.x - 6, y + 12); ctx.fill(); }
          ctx.beginPath(); ctx.moveTo(z.x - 6, z.y - h); ctx.lineTo(z.x, z.y - h - 14); ctx.lineTo(z.x + 6, z.y - h); ctx.fill();
        } else {
          ctx.fillRect(z.x - 90, z.y - 6, 180, 12);
          ctx.fillStyle = '#d6d3d1';
          for (let x = z.x - 90; x < z.x + 90; x += 12) { ctx.beginPath(); ctx.moveTo(x, z.y - 6); ctx.lineTo(x + 6, z.y - 20); ctx.lineTo(x + 12, z.y - 6); ctx.fill(); }
        }
        break;
      }
      case 'turret': {
        ctx.fillStyle = '#475569'; ctx.fillRect(z.x - 14, z.y - 22, 28, 22);
        ctx.fillStyle = '#334155'; ctx.beginPath(); ctx.arc(z.x, z.y - 26, 11, 0, TAU); ctx.fill();
        const target = game.byIdOrNull(z.target);
        const a = target ? Math.atan2(target.body.position.y - (z.y - 26), target.body.position.x - z.x) : platformer ? 0 : Math.PI / 2;
        ctx.save(); ctx.translate(z.x, z.y - 26); ctx.rotate(a); ctx.fillStyle = '#1e293b'; ctx.fillRect(0, -3, 20, 6); ctx.restore();
        ctx.fillStyle = Math.sin(t / 150) > 0 ? '#22c55e' : '#14532d'; ctx.beginPath(); ctx.arc(z.x, z.y - 12, 2.5, 0, TAU); ctx.fill();
        break;
      }
      case 'mega': {
        const left = Math.max(0, z.until - now), fast = left < 1000;
        bomb(ctx, z.x, z.y - 4, 20, fast ? Math.sin(t / 40) > 0 : Math.sin(t / 160) > 0);
        ctx.strokeStyle = `rgba(239,68,68,${fast ? 0.7 : 0.35})`; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
        ctx.beginPath(); ctx.arc(z.x, z.y, 320, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#fef2f2'; ctx.font = 'bold 14px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(Math.ceil(left / 1000)), z.x, z.y - 34);
        break;
      }
      case 'laser': {
        if (!owner) break;
        const p = owner.body.position, w = 8 + Math.sin(t / 30) * 3;
        ctx.globalCompositeOperation = 'lighter';
        const g = platformer ? ctx.createLinearGradient(p.x, 0, p.x + LASER_LEN, 0) : ctx.createLinearGradient(0, p.y, 0, p.y + LASER_LEN);
        g.addColorStop(0, 'rgba(254,202,202,0.95)'); g.addColorStop(1, 'rgba(239,68,68,0)');
        ctx.fillStyle = g;
        if (platformer) ctx.fillRect(p.x + R, p.y - w, LASER_LEN, w * 2); else ctx.fillRect(p.x - w, p.y + R, w * 2, LASER_LEN);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        if (platformer) ctx.fillRect(p.x + R, p.y - 2, LASER_LEN * 0.8, 4); else ctx.fillRect(p.x - 2, p.y + R, 4, LASER_LEN * 0.8);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'leech': {
        const victim = game.byIdOrNull(z.target);
        if (!owner || !victim) break;
        const a = owner.body.position, b = victim.body.position;
        ctx.strokeStyle = 'rgba(225,29,72,0.85)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a.x, a.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + Math.sin(t / 120) * 14;
        ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
        // drops of life flowing back along it
        ctx.fillStyle = '#fb7185';
        for (let i = 0; i < 3; i++) { const k = 1 - ((t / 500 + i / 3) % 1); const qx = (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * mx + k * k * b.x, qy = (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * my + k * k * b.y; ctx.beginPath(); ctx.arc(qx, qy, 3, 0, TAU); ctx.fill(); }
        break;
      }
      case 'twin': {
        ctx.globalAlpha = 0.55 + 0.15 * Math.sin(t / 100);
        const g = ctx.createRadialGradient(z.x, z.y, 2, z.x, z.y, R * 1.6);
        g.addColorStop(0, '#0f172a'); g.addColorStop(0.7, owner?.info.color ?? '#475569'); g.addColorStop(1, 'rgba(15,23,42,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(z.x, z.y, R * 1.6, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
    }
  }
  for (const s of game.shots) {
    if (!here(s.lane)) continue;
    switch (s.kind) {
      case 'bubble': {
        const r = 12 + Math.sin(t / 90) * 1.5;
        ctx.fillStyle = 'rgba(103,232,249,0.35)'; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(207,250,254,0.95)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(s.x - 4, s.y - 4, 3, 0, TAU); ctx.fill();
        break;
      }
      case 'boomerang': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(t / 45);
        ctx.strokeStyle = '#ca8a04'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-12, -6); ctx.quadraticCurveTo(0, -2, 0, 12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-12, -6); ctx.quadraticCurveTo(2, -10, 13, -4); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'cluster': bomb(ctx, s.x, s.y, 9, Math.sin(t / 60) > 0); break;
      case 'bomblet': bomb(ctx, s.x, s.y, 5, Math.sin(t / 40) > 0); break;
      case 'turret': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.atan2(s.vy, s.vx));
        ctx.fillStyle = 'rgba(148,163,184,0.4)'; ctx.fillRect(-14, -2, 14, 4);
        ctx.fillStyle = '#e2e8f0'; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
    }
  }
  ctx.restore();
}
