// P2-25: the mood layer painted over the Infinity world after the race renderer has drawn it: stars and an aurora at
// night, the biome's colour grade (warm at dawn and dusk, deep blue at night), haze low in the frame, drifting
// particles (petals, leaves, snow, fireflies, mist, motes, drops) at three depths, a soft glowing trail behind the
// ball, dust when it lands, a quiet kilometre label, and a vignette. Draws only what is on screen, allocates nothing
// per frame once warmed up (particles are recycled), and caches every gradient against its inputs.
import { biomeAt, dayAt, gradeAt, particleBudget, particlesAt } from '../../game/infinity-look';
import type { Particle } from '../../game/infinity-look';
import { mulberry32 } from '../../game/types';

export interface PaintFrame {
  width: number;
  height: number;
  camera: { x: number; y: number; scale: number };
  dtMs: number;
  /** Smoothed frame time, for the particle budget. */
  frameMs: number;
  km: number;
  elapsedMs: number;
  ball: { x: number; y: number; vx: number; vy: number; grounded: boolean };
  reduceMotion: boolean;
  paused: boolean;
}

interface Mote { x: number; y: number; z: number; vx: number; vy: number; size: number; phase: number; spin: number; kind: Particle; alive: boolean }
interface Puff { x: number; y: number; r: number; life: number; vx: number }

const TRAIL = 28;
const STARS = 140;

export class InfinityPainter {
  private motes: Mote[] = [];
  private puffs: Puff[] = [];
  private trail: { x: number; y: number }[] = [];
  private stars: { x: number; y: number; r: number; tw: number }[];
  private lastCamX: number | null = null;
  private lastCamY: number | null = null;
  private wasAirborne = false;
  private peakVy = 0;
  private lastKm = -1;
  private label: { text: string; age: number } | null = null;
  private vignette: { w: number; h: number; g: CanvasGradient } | null = null;
  private rng: () => number;
  /** Called when the ball passes a whole kilometre (the screen plays the chime). */
  onKm?: (km: number) => void;

  constructor(private readonly seed: number) {
    this.rng = mulberry32(seed ^ 0x5eed1e);
    const r = mulberry32(seed ^ 0x57a25);
    this.stars = Array.from({ length: STARS }, () => ({ x: r(), y: r() * 0.62, r: 0.4 + r() * 1.3, tw: r() * Math.PI * 2 }));
  }

  paint(ctx: CanvasRenderingContext2D, f: PaintFrame): void {
    const { width: w, height: h } = f;
    if (w < 2 || h < 2) return;
    const grade = gradeAt(f.km, f.elapsedMs, this.seed);
    const day = dayAt(f.km, f.elapsedMs);
    const biome = biomeAt(f.km, this.seed);
    const camDx = this.lastCamX === null ? 0 : (f.camera.x - this.lastCamX) * f.camera.scale;
    const camDy = this.lastCamY === null ? 0 : (f.camera.y - this.lastCamY) * f.camera.scale;
    this.lastCamX = f.camera.x;
    this.lastCamY = f.camera.y;
    const dt = f.paused ? 0 : Math.min(50, f.dtMs);
    const toScreen = (x: number, y: number) => ({ x: (x - f.camera.x) * f.camera.scale + w / 2, y: (y - f.camera.y) * f.camera.scale + h / 2 });

    ctx.save();
    // ---- the trail: a soft glow behind the ball, longer at speed
    if (!f.paused) {
      this.trail.push({ x: f.ball.x, y: f.ball.y });
      if (this.trail.length > TRAIL) this.trail.shift();
    }
    const speed = Math.hypot(f.ball.vx, f.ball.vy);
    if (this.trail.length > 2 && speed > 2) {
      ctx.globalCompositeOperation = 'lighter';
      const glow = `${Math.round(grade.glow[0])},${Math.round(grade.glow[1])},${Math.round(grade.glow[2])}`;
      for (let i = 1; i < this.trail.length; i++) {
        const k = i / this.trail.length;
        const p = toScreen(this.trail[i].x, this.trail[i].y);
        ctx.fillStyle = `rgba(${glow},${(k * k * Math.min(1, (speed - 2) / 10) * 0.18).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (4 + k * 9) * f.camera.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---- landing dust
    if (!f.ball.grounded) { this.wasAirborne = true; this.peakVy = Math.max(this.peakVy, f.ball.vy); }
    else if (this.wasAirborne) {
      if (this.peakVy > 4) for (let i = 0; i < (f.reduceMotion ? 3 : 7); i++) this.puffs.push({ x: f.ball.x + (this.rng() - 0.5) * 20, y: f.ball.y + 12, r: 4 + this.rng() * 5, life: 1, vx: (this.rng() - 0.5) * 1.6 });
      this.wasAirborne = false;
      this.peakVy = 0;
    }
    for (const p of this.puffs) {
      p.life -= dt / 700;
      p.x += p.vx * dt / 16;
      p.r += dt / 60;
      if (p.life <= 0) continue;
      const s = toScreen(p.x, p.y);
      ctx.fillStyle = `rgba(222,206,180,${(p.life * 0.35).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, p.r * f.camera.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    this.puffs = this.puffs.filter((p) => p.life > 0);

    // ---- stars and the aurora (night only; drawn as light, so the sky glows through the grade)
    if (day.stars > 0.02) {
      ctx.globalCompositeOperation = 'screen';
      const drift = (f.camera.x * 0.02) % w;
      for (const s of this.stars) {
        const tw = f.reduceMotion ? 1 : 0.65 + 0.35 * Math.sin(s.tw + f.elapsedMs / 900);
        ctx.fillStyle = `rgba(255,250,235,${(day.stars * tw * 0.9).toFixed(3)})`;
        const x = ((s.x * w - drift) % w + w) % w;
        ctx.fillRect(x, s.y * h, s.r, s.r);
      }
      const auroraOn = (biome.from.id === 'night' ? 1 - biome.t : 0) + (biome.to.id === 'night' ? biome.t : 0);
      if (auroraOn > 0.02) {
        for (let band = 0; band < 3; band++) {
          ctx.beginPath();
          for (let x = 0; x <= w; x += 24) {
            const y = h * (0.12 + band * 0.07) + Math.sin(x / 160 + band * 1.7 + (f.reduceMotion ? 0 : f.elapsedMs / 4000)) * h * 0.04;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = band === 1 ? `rgba(160,120,255,${(0.10 * auroraOn * day.stars).toFixed(3)})` : `rgba(110,255,190,${(0.14 * auroraOn * day.stars).toFixed(3)})`;
          ctx.lineWidth = h * 0.05;
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---- the colour grade
    const rgb = (c: [number, number, number]) => `${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])}`;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(${rgb(grade.tint)},${grade.tintAlpha.toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    if (grade.night > 0.01) {
      ctx.fillStyle = `rgba(38,48,104,${grade.night.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'screen';
    if (grade.glowAlpha > 0.005) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, `rgba(${rgb(grade.glow)},${grade.glowAlpha.toFixed(3)})`);
      g.addColorStop(0.6, `rgba(${rgb(grade.glow)},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (grade.haze > 0.01) {
      const g = ctx.createLinearGradient(0, h * 0.45, 0, h);
      g.addColorStop(0, `rgba(${rgb(grade.tint)},0)`);
      g.addColorStop(1, `rgba(${rgb(grade.tint)},${(grade.haze * 0.4 * (1 - day.dark * 0.5)).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, h * 0.45, w, h * 0.55);
    }
    ctx.globalCompositeOperation = 'source-over';

    // ---- particles: keep the count at the budget, split between the biomes being blended
    const budget = particleBudget(w, h, f.frameMs, f.reduceMotion);
    const mix = particlesAt(f.km, this.seed);
    const totalShare = mix.reduce((s, m) => s + m.share, 0) || 1;
    const want = new Map(mix.map((m) => [m.kind, Math.round(budget * (m.share / totalShare) * Math.min(1, totalShare))]));
    const have = new Map<Particle, number>();
    for (const m of this.motes) if (m.alive) have.set(m.kind, (have.get(m.kind) ?? 0) + 1);
    for (const [kind, n] of want) for (let i = have.get(kind) ?? 0; i < n; i++) this.spawn(kind, w, h, true);
    const slow = f.reduceMotion ? 0.35 : 1;
    const wind = Math.sin(f.elapsedMs / 7000) * 0.5 + 0.6;
    for (const m of this.motes) {
      if (!m.alive) continue;
      // too many of this kind (the blend moved on): let it fade out by not respawning it
      m.x += (m.vx * wind * slow * dt) / 16 - camDx * m.z;
      m.y += (m.vy * slow * dt) / 16 - camDy * m.z * 0.6;
      m.phase += (m.spin * slow * dt) / 16;
      if (m.x < -40 || m.x > w + 40 || m.y < -40 || m.y > h + 40) {
        const over = (want.get(m.kind) ?? 0) < (have.get(m.kind) ?? 0);
        if (over) { m.alive = false; have.set(m.kind, (have.get(m.kind) ?? 1) - 1); continue; }
        this.respawnAtEdge(m, w, h, camDx);
      }
      this.drawMote(ctx, m, day.dark);
    }
    if (this.motes.length > 400) this.motes = this.motes.filter((m) => m.alive);

    // ---- vignette (cached per size)
    if (!this.vignette || this.vignette.w !== w || this.vignette.h !== h) {
      const g = ctx.createRadialGradient(w / 2, h * 0.48, Math.min(w, h) * 0.35, w / 2, h * 0.5, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(6,8,16,0.42)');
      this.vignette = { w, h, g };
    }
    ctx.fillStyle = this.vignette.g;
    ctx.fillRect(0, 0, w, h);

    // ---- the kilometre label: a soft number that fades in and out under the top edge
    const whole = Math.floor(f.km);
    if (this.lastKm < 0) this.lastKm = whole;
    if (whole > this.lastKm) { this.lastKm = whole; this.label = { text: `${whole} km`, age: 0 }; this.onKm?.(whole); }
    if (this.label) {
      this.label.age += dt;
      const a = Math.min(1, this.label.age / 600) * Math.max(0, 1 - Math.max(0, this.label.age - 2200) / 900);
      if (a <= 0) this.label = null;
      else {
        ctx.font = `600 ${Math.round(Math.max(18, Math.min(30, h * 0.05)))}px "Fraunces", Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(255,248,230,${(a * 0.85).toFixed(3)})`;
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 12;
        ctx.fillText(this.label.text, w / 2, h * 0.2);
        ctx.font = `500 ${Math.round(Math.max(10, Math.min(14, h * 0.024)))}px system-ui, sans-serif`;
        ctx.fillStyle = `rgba(255,248,230,${(a * 0.6).toFixed(3)})`;
        ctx.fillText(biome.t > 0.5 ? biome.to.name : biome.from.name, w / 2, h * 0.2 + Math.max(16, h * 0.035));
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }

  private spawn(kind: Particle, w: number, h: number, anywhere: boolean): void {
    const m = this.motes.find((x) => !x.alive) ?? (this.motes[this.motes.length] = { x: 0, y: 0, z: 1, vx: 0, vy: 0, size: 1, phase: 0, spin: 0, kind, alive: false });
    const r = this.rng;
    m.kind = kind;
    m.alive = true;
    m.z = [0.35, 0.7, 1.15][Math.floor(r() * 3)];
    m.phase = r() * Math.PI * 2;
    m.spin = (r() - 0.5) * 0.08;
    const zs = m.z;
    switch (kind) {
      case 'snow': m.vx = -0.3 - r() * 0.4; m.vy = 0.5 + r() * 0.7 * zs; m.size = (1.2 + r() * 2.2) * zs; break;
      case 'petals': m.vx = -0.6 - r() * 0.8; m.vy = 0.15 + r() * 0.4; m.size = (2.5 + r() * 2.5) * zs; break;
      case 'leaves': m.vx = -0.8 - r() * 1.0; m.vy = 0.35 + r() * 0.5; m.size = (3 + r() * 3) * zs; break;
      case 'fireflies': m.vx = (r() - 0.5) * 0.3; m.vy = (r() - 0.5) * 0.25; m.size = (1.4 + r() * 1.8) * zs; break;
      case 'mist': m.vx = -0.15 - r() * 0.2; m.vy = (r() - 0.5) * 0.05; m.size = (60 + r() * 120) * zs; break;
      case 'drops': m.vx = -0.1; m.vy = 0.12 + r() * 0.2; m.size = (1 + r() * 1.5) * zs; break;
      default: m.vx = -0.2 - r() * 0.3; m.vy = (r() - 0.5) * 0.12; m.size = (0.8 + r() * 1.6) * zs; break;
    }
    if (anywhere) { m.x = r() * w; m.y = kind === 'mist' ? h * (0.45 + r() * 0.5) : kind === 'fireflies' ? h * (0.3 + r() * 0.65) : r() * h; }
  }

  private respawnAtEdge(m: Mote, w: number, h: number, camDx: number): void {
    const r = this.rng;
    const kind = m.kind;
    this.spawn(kind, w, h, false);
    // falling things come back at the top; drifting things on the side the world is coming from
    if (kind === 'snow' || kind === 'leaves' || kind === 'petals' || kind === 'drops') {
      if (r() < 0.6) { m.x = r() * w; m.y = -20; } else { m.x = camDx >= 0 ? w + 20 : -20; m.y = r() * h * 0.8; }
    } else {
      m.x = camDx >= 0 || m.vx < 0 ? w + 30 : -30;
      m.y = kind === 'mist' ? h * (0.45 + r() * 0.5) : kind === 'fireflies' ? h * (0.3 + r() * 0.65) : r() * h;
    }
  }

  private drawMote(ctx: CanvasRenderingContext2D, m: Mote, dark: number): void {
    switch (m.kind) {
      case 'snow':
        ctx.fillStyle = `rgba(255,255,255,${(0.55 + m.z * 0.25).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2); ctx.fill();
        break;
      case 'petals':
      case 'leaves': {
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.phase);
        ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(m.phase * 1.7)));
        ctx.fillStyle = m.kind === 'petals' ? `rgba(255,${190 + Math.round(m.z * 20)},${210 + Math.round(m.z * 15)},0.8)` : `rgba(${200 + Math.round(m.z * 40)},${90 + Math.round(m.z * 50)},30,0.85)`;
        ctx.beginPath(); ctx.ellipse(0, 0, m.size, m.size * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'fireflies': {
        const pulse = 0.5 + 0.5 * Math.sin(m.phase * 6);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(200,255,140,${(0.25 + 0.6 * pulse * (0.4 + dark * 0.6)).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.size * (1 + pulse), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(220,255,170,${(0.08 * pulse).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.size * 6, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'mist':
        ctx.fillStyle = `rgba(230,238,240,${(0.035 * m.z).toFixed(3)})`;
        ctx.beginPath(); ctx.ellipse(m.x, m.y, m.size * 1.8, m.size * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'drops':
        ctx.fillStyle = `rgba(200,225,255,${(0.35 + 0.3 * Math.abs(Math.sin(m.phase * 3))).toFixed(3)})`;
        ctx.fillRect(m.x, m.y, m.size, m.size);
        break;
      default:
        ctx.fillStyle = `rgba(255,236,170,${(0.25 + 0.35 * Math.abs(Math.sin(m.phase * 2))).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2); ctx.fill();
    }
  }
}
