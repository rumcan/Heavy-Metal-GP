// The owner's twenty premium skills (spells and weapons from bullet-hell roguelikes): what they DO in a race. Like
// effects.ts: a preflight (can it be used now, is there a target?), the effect, and the per-step upkeep for their shots
// (bubbles, boomerangs, cluster bombs, turret rounds) and the things they leave in the world (wells, mines, walls,
// turrets, the mega bomb, lasers, leech tethers, the shadow twin). Everything runs on the host with the race rng.
import Matter from 'matter-js';
import type { Game, Marble } from '../engine';
import type { ItemType } from '../types';
import { MARBLE_RADIUS } from '../types';
import { SKILLS } from './catalog';
import type { SkillId } from './catalog';
import { floorAt } from '../platformer/course';
import type { Lane } from '../platformer/course';
import { switchLane, applyLaneMask } from '../engine/platformer';
import type { Decoy } from './effects';

const { Body } = Matter;

export const PREMIUM_SKILLS = [
  'swap', 'telekinesis', 'well', 'warp', 'rewind', 'shrink', 'bubble', 'leech', 'chain', 'twin',
  'thorns', 'spikewall', 'mines', 'cluster', 'megabomb', 'blades', 'boomerang', 'laser', 'turret', 'blank',
] as const;
export type PremiumSkill = typeof PREMIUM_SKILLS[number];
export const isPremium = (id: string): id is PremiumSkill => (PREMIUM_SKILLS as readonly string[]).includes(id);

/** A premium shot in flight. */
export interface Shot {
  id: number; kind: 'bubble' | 'boomerang' | 'cluster' | 'bomblet' | 'turret';
  owner: number; target: number; x: number; y: number; vx: number; vy: number; at: number; until: number; lane: number;
  /** who it already hit (a boomerang hits each rival once) */
  hits: number[];
  turned?: boolean;
}
/** Something a premium skill left in the world. */
export interface Zone {
  id: number; kind: 'well' | 'mine' | 'wall' | 'turret' | 'mega' | 'laser' | 'leech' | 'twin';
  owner: number; target: number; x: number; y: number; lane: number; at: number; until: number;
  /** next tick (lasers, leeches, turrets), and the height of a spike wall */
  nextAt?: number; h?: number;
  /** a twin's decoy (bolts chase it) */
  decoy?: Decoy;
  /** per-rival cooldowns (the twin's and the wall's knocks) */
  hitAt?: Record<number, number>;
}

/** Per-marble premium timers (they live on `m.fx` with the P2-08 ones). */
export interface PremiumFx {
  liftUntil?: number; liftX?: number; liftY?: number; liftBy?: number;
  bubbleUntil?: number; shrinkUntil?: number; slowUntil?: number; thornsUntil?: number;
  bladesUntil?: number; blades?: number; laserUntil?: number; zapUntil?: number;
}
type Fx = PremiumFx & { reflectUntil?: number; shieldUntil?: number };
const fxOf = (m: Marble): Fx => (m.fx ??= {}) as Fx;
const tfx = (m: Marble | null | undefined, stat: string): number => m?.tfx?.[stat] ?? 0;
const offence = (owner: Marble | null | undefined, base: number): number => Math.round(base * (1 + tfx(owner, 'offenceDamagePct') / 100));

/** One sample of where a marble was (rewind and the shadow twin), every PAST_EVERY ms, for PAST_KEEP ms. */
export interface PastSample { t: number; x: number; y: number; vx: number; vy: number; lane: number; hp: number }
const PAST_EVERY = 100, PAST_KEEP = 3300;

const R = MARBLE_RADIUS;
const isPlatformer = (game: Game) => !!game.track.platformer;
const laneOf = (game: Game, m: Marble) => (isPlatformer(game) ? (m.lane ?? 1) : 0);
const sameLane = (game: Game, a: Marble, b: Marble) => !isPlatformer(game) || (a.lane ?? 1) === (b.lane ?? 1);
const racing = (o: Marble) => o.finishedAt === null && !o.dnf && !o.hold;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** "Forward" along the course: right on a platformer, down on a drop track. */
const fwd = (game: Game) => (isPlatformer(game) ? { x: 1, y: 0 } : { x: 0, y: 1 });
const along = (game: Game, p: { x: number; y: number }) => (isPlatformer(game) ? p.x : p.y);

function nearest(game: Game, m: Marble, range: number, pick: (o: Marble) => boolean): Marble | null {
  let best: Marble | null = null, bestD = range;
  for (const o of game.marbles) {
    if (o === m || !racing(o) || !pick(o)) continue;
    const d = dist(o.body.position, m.body.position);
    if (d < bestD) { best = o; bestD = d; }
  }
  return best;
}
const nearestSameLane = (game: Game, m: Marble, range: number) => nearest(game, m, range, (o) => sameLane(game, m, o));
const nearestBehind = (game: Game, m: Marble, range: number) => nearest(game, m, range, (o) => sameLane(game, m, o) && along(game, o.body.position) < along(game, m.body.position) - 10);

/** The rival one place ahead of `m` in the race (Soul Swap's partner). */
function placeAhead(game: Game, m: Marble): Marble | null {
  const order = game.ranking().filter((r) => !r.finished && !r.dnf).map((r) => r.marble);
  const i = order.indexOf(m);
  const o = i > 0 ? order[i - 1] : null;
  return o && !o.hold ? o : null;
}
function leaderOf(game: Game, m: Marble): Marble | null {
  const order = game.ranking().filter((r) => !r.finished && !r.dnf).map((r) => r.marble);
  return (order[0] !== m ? order[0] : order[1]) ?? null;
}

function pop(game: Game, x: number, y: number, color: string, ttl = 24) {
  game.effects.push({ type: 'ring', x, y, ttl, maxTtl: ttl, color });
}
/** A knock away from a point, scaled to the marble's mass (a shrunken marble flies twice as far). */
function knock(game: Game, m: Marble, fromX: number, fromY: number, strength: number) {
  const dx = m.body.position.x - fromX, dy = m.body.position.y - fromY, d = Math.hypot(dx, dy) || 1;
  const small = (fxOf(m).shrinkUntil ?? 0) > game.time ? 2 : 1;
  const v = Body.getVelocity(m.body), k = (strength * small) / Math.sqrt(m.body.mass / 0.8);
  Body.setVelocity(m.body, { x: v.x + (dx / d) * k, y: v.y + (dy / d) * k - 1.5 });
}
/** A Mirror Plate turns a premium hex back on its sender (true: the victim is safe). */
function mirrored(game: Game, victim: Marble): boolean {
  if ((fxOf(victim).reflectUntil ?? 0) <= game.time) return false;
  pop(game, victim.body.position.x, victim.body.position.y, '#e0f2fe');
  return true;
}
/** A Bubble Shield pops instead of the victim being caught by a hex (true: safe). */
function shielded(game: Game, victim: Marble): boolean {
  const fx = fxOf(victim);
  if ((fx.shieldUntil ?? 0) <= game.time) return false;
  fx.shieldUntil = 0;
  pop(game, victim.body.position.x, victim.body.position.y, '#60a5fa');
  return true;
}
/** An explosion: everyone in range (`lane` null: every lane) is knocked, rivals hurt; the owner too when `self`. */
function blast(game: Game, owner: Marble | null, x: number, y: number, radius: number, damage: number, strength: number, lane: number | null, self = false) {
  game.effects.push({ type: 'ring', x, y, ttl: 26, maxTtl: 26, color: '#fb923c' });
  game.effects.push({ type: 'debris', x, y, ttl: 30, maxTtl: 30, color: '#fb923c', particles: game.makeParticles(x, y, Math.round(radius / 12), 5) });
  game.shake = Math.max(game.shake, Math.min(16, radius / 22));
  for (const o of game.marbles) {
    if (!racing(o) || (o === owner && !self)) continue;
    if (lane !== null && isPlatformer(game) && (o.lane ?? 1) !== lane) continue;
    const d = Math.hypot(o.body.position.x - x, o.body.position.y - y);
    if (d > radius) continue;
    knock(game, o, x, y, strength * (1 - d / (radius * 1.15)));
    game.damage(o, offence(owner, damage), owner ? owner.info.id : null, 'bomb');
  }
}
/** Teleport a marble (Soul Swap, Rewind): off any rail or loop it rode, into a lane. */
function place(game: Game, m: Marble, x: number, y: number, vx: number, vy: number, lane?: number) {
  m.track = undefined; m.rail = undefined; m.loopPhase = undefined; m.loopStuckSince = undefined;
  if (isPlatformer(game) && lane !== undefined) { m.lane = lane; m.laneFrom = lane; m.laneAt = undefined; applyLaneMask(game, m); }
  Body.setPosition(m.body, { x, y });
  Body.setVelocity(m.body, { x: vx, y: vy });
  m.trail = [];
}
/** The ground of a lane at x (platformer), or `fallback`. */
function groundAt(game: Game, lane: number, x: number, fallback: number): number {
  const plan = game.track.platformer?.plan;
  if (!plan) return fallback;
  return floorAt(plan, lane as Lane, x) ?? fallback;
}
const durationOf = (m: Marble, id: PremiumSkill) => Math.round((SKILLS as Record<string, { durationMs: number }>)[id].durationMs * (1 + tfx(m, 'skillDurationPct') / 100));

/** The past sample of a marble `ago` ms back (the oldest one when it has not been around that long). */
function pastOf(m: Marble, game: Game, ago: number): PastSample | null {
  const past = m.past;
  if (!past?.length) return null;
  const want = game.time - ago;
  let best = past[0];
  for (const s of past) if (Math.abs(s.t - want) < Math.abs(best.t - want)) best = s;
  return best;
}

// ------------------------------------------------------------------ preflight
/** Why this premium skill cannot be used now, or null when it can (a refused skill keeps its charge). */
export function preflight(game: Game, m: Marble, item: ItemType): string | null {
  switch (item as PremiumSkill) {
    case 'swap': return placeAhead(game, m) ? null : 'Nobody ahead to swap with';
    case 'telekinesis': return nearestSameLane(game, m, 450) ? null : 'No rival in reach';
    case 'shrink': return leaderOf(game, m) ? null : 'Nobody to hex';
    case 'leech': return !game.healthOn ? 'Health is off on this track' : nearestSameLane(game, m, 320) ? null : 'No rival in reach';
    case 'chain': return nearestSameLane(game, m, 450) ? null : 'No rival in range';
    case 'spikewall': return nearestBehind(game, m, 900) ? null : 'Nobody behind you';
    case 'rewind': { const s = pastOf(m, game, 3000); return s && game.time - s.t >= 2000 ? null : 'Nothing to rewind to yet'; }
    default: return null;
  }
}

// ------------------------------------------------------------------ effects
/** Run a premium skill's effect (the charge is already spent). */
export function apply(game: Game, m: Marble, item: ItemType): void {
  const id = item as PremiumSkill;
  const t = game.time, p = m.body.position, v = Body.getVelocity(m.body), fx = fxOf(m), dur = durationOf(m, id);
  const lane = laneOf(game, m), color = SKILLS[id as SkillId].color, f = fwd(game);
  const zone = (z: Omit<Zone, 'id' | 'owner' | 'at'>): Zone => {
    const made: Zone = { ...z, id: game.nextProjectileId++, owner: m.info.id, at: t };
    game.zones.push(made);
    game.emit({ kind: 'skillfx', fx: `z-${made.kind}`, seat: m.info.id, target: made.target, x: made.x, y: made.y, until: made.until });
    return made;
  };
  const shoot = (s: Omit<Shot, 'id' | 'owner' | 'at' | 'hits'>) => {
    const made: Shot = { ...s, id: game.nextProjectileId++, owner: m.info.id, at: t, hits: [] };
    game.shots.push(made);
    game.emit({ kind: 'skillfx', fx: `s-${made.kind as 'bubble' | 'boomerang' | 'cluster' | 'turret'}`, seat: m.info.id, target: made.target, x: made.x, y: made.y, until: made.until });
  };
  const aura = (o: Marble, kind: 'lift' | 'slow' | 'shrink' | 'zap' | 'thorns' | 'blades' | 'bubble', until: number) => game.emit({ kind: 'skillfx', fx: `a-${kind}`, seat: m.info.id, target: o.info.id, x: o.body.position.x, y: o.body.position.y, until });
  switch (id) {
    case 'swap': {
      const o = placeAhead(game, m);
      if (!o) break;
      game.effects.push({ type: 'beam', x: p.x, y: p.y, x2: o.body.position.x, y2: o.body.position.y, ttl: 18, maxTtl: 18, color });
      if (mirrored(game, o)) break;
      const a = { x: p.x, y: p.y, vx: v.x, vy: v.y, lane: m.lane }, ov = Body.getVelocity(o.body);
      const b = { x: o.body.position.x, y: o.body.position.y, vx: ov.x, vy: ov.y, lane: o.lane };
      pop(game, a.x, a.y, color); pop(game, b.x, b.y, color);
      place(game, m, b.x, b.y, b.vx, b.vy, b.lane);
      place(game, o, a.x, a.y, a.vx, a.vy, a.lane);
      game.sfx('item', m, b.x, b.y, { item });
      if (o.info.isPlayer) game.onEvent?.(`${m.info.name} swapped places with you!`, color);
      if (m.info.isPlayer) game.onEvent?.(`Swapped with ${o.info.name}!`, color);
      break;
    }
    case 'telekinesis': {
      const o = nearestSameLane(game, m, 450);
      if (!o) break;
      game.effects.push({ type: 'beam', x: p.x, y: p.y, x2: o.body.position.x, y2: o.body.position.y, ttl: 16, maxTtl: 16, color });
      if (mirrored(game, o) || shielded(game, o)) break;
      if (o.anvilUntil > t) { game.effects.push({ type: 'text', x: o.body.position.x, y: o.body.position.y - 26, ttl: 40, maxTtl: 40, color, text: 'TOO HEAVY' }); break; }
      const of = fxOf(o);
      of.liftUntil = t + dur; of.liftX = o.body.position.x; of.liftY = o.body.position.y - 110; of.liftBy = m.info.id;
      aura(o, 'lift', of.liftUntil);
      if (o.info.isPlayer) game.onEvent?.(`${m.info.name} has you in a telekinetic grip!`, color);
      break;
    }
    case 'well': {
      const x = p.x - f.x * 150, y = p.y - f.y * 150;
      zone({ kind: 'well', target: -1, x, y, lane, until: t + dur });
      break;
    }
    case 'warp': {
      for (const o of game.marbles) {
        if (o === m || !racing(o)) continue;
        if ((fxOf(o).reflectUntil ?? 0) > t) continue;
        fxOf(o).slowUntil = t + dur;
        aura(o, 'slow', t + dur);
      }
      pop(game, p.x, p.y, color, 34);
      break;
    }
    case 'rewind': {
      const s = pastOf(m, game, 3000);
      if (!s) break;
      pop(game, p.x, p.y, color);
      place(game, m, s.x, s.y, s.vx, s.vy, isPlatformer(game) ? s.lane : undefined);
      if (m.health && s.hp > m.health.hp) m.health = { ...m.health, hp: s.hp };
      pop(game, s.x, s.y, color, 30);
      break;
    }
    case 'shrink': {
      const o = leaderOf(game, m);
      if (!o) break;
      game.effects.push({ type: 'beam', x: o.body.position.x, y: o.body.position.y - 400, x2: o.body.position.x, y2: o.body.position.y, ttl: 14, maxTtl: 14, color });
      if (mirrored(game, o) || shielded(game, o)) break;
      fxOf(o).shrinkUntil = t + dur;
      aura(o, 'shrink', t + dur);
      if (o.info.isPlayer) game.onEvent?.(`${m.info.name} shrank you!`, color);
      break;
    }
    case 'bubble': shoot({ kind: 'bubble', target: -1, x: p.x + f.x * (R + 6), y: p.y + f.y * (R + 6) - 4, vx: f.x * 9 + v.x * 0.5, vy: f.y * 9, until: t + 2600, lane }); break;
    case 'leech': {
      const o = nearestSameLane(game, m, 320);
      if (o) zone({ kind: 'leech', target: o.info.id, x: o.body.position.x, y: o.body.position.y, lane, until: t + dur, nextAt: t + 300 });
      break;
    }
    case 'chain': {
      const hit = new Set<Marble>();
      let from: Marble = m, next = nearestSameLane(game, m, 450);
      while (next && hit.size < 4) {
        hit.add(next);
        game.effects.push({ type: 'beam', x: from.body.position.x, y: from.body.position.y, x2: next.body.position.x, y2: next.body.position.y, ttl: 16, maxTtl: 16, color });
        if (!mirrored(game, next)) {
          knock(game, next, from.body.position.x, from.body.position.y, 3);
          game.damage(next, offence(m, 15), m.info.id, 'lightning');
          fxOf(next).zapUntil = t + 400;
          aura(next, 'zap', t + 400);
        }
        from = next;
        const at: Marble = from;
        next = nearest(game, at, 260, (o) => o !== m && !hit.has(o) && sameLane(game, at, o));
      }
      game.sfx('item', m, p.x, p.y, { item });
      break;
    }
    case 'twin': {
      const decoy: Decoy = { x: p.x - f.x * 60, y: p.y - f.y * 60, owner: m.info.id, until: t + dur, lane, color: m.info.color };
      game.decoys.push(decoy);
      zone({ kind: 'twin', target: -1, x: decoy.x, y: decoy.y, lane, until: t + dur, decoy, hitAt: {} });
      break;
    }
    case 'thorns': fx.thornsUntil = t + dur; aura(m, 'thorns', fx.thornsUntil); pop(game, p.x, p.y, color); break;
    case 'spikewall': {
      const o = nearestBehind(game, m, 900);
      if (!o) break;
      // between you and them, across their lane
      const x = isPlatformer(game) ? o.body.position.x + 150 : o.body.position.x;
      const y = isPlatformer(game) ? groundAt(game, o.lane ?? 1, x, o.body.position.y + R) : o.body.position.y + 150;
      zone({ kind: 'wall', target: o.info.id, x, y, lane: laneOf(game, o), until: t + dur, h: 72, hitAt: {} });
      break;
    }
    case 'mines': {
      const plan = game.track.platformer?.plan;
      const lanes: number[] = plan ? [...(plan.lanes ?? [0, 1, 2])] : [0];
      for (let k = 0; k < 5; k++) {
        const l = plan ? lanes[(Math.max(0, lanes.indexOf(lane)) + k) % lanes.length] : 0;
        const x = plan ? p.x - 170 - k * 110 : p.x + (k - 2) * 55;
        const y = plan ? groundAt(game, l, x, p.y + R) - 7 : p.y - 70 - k * 30;
        zone({ kind: 'mine', target: -1, x, y, lane: l, until: t + dur, nextAt: t + 500 });
      }
      break;
    }
    case 'cluster': shoot({ kind: 'cluster', target: -1, x: p.x, y: p.y - 8, vx: isPlatformer(game) ? 8 + Math.max(0, v.x) * 0.5 : v.x * 0.4, vy: isPlatformer(game) ? -9 : 6, until: t + 1100, lane }); break;
    case 'megabomb': zone({ kind: 'mega', target: -1, x: p.x, y: p.y, lane, until: t + dur }); break;
    case 'blades': fx.bladesUntil = t + dur; fx.blades = 3; aura(m, 'blades', fx.bladesUntil); pop(game, p.x, p.y, color); break;
    case 'boomerang': shoot({ kind: 'boomerang', target: -1, x: p.x + f.x * (R + 4), y: p.y + f.y * (R + 4) - 6, vx: f.x * 14 + v.x * 0.4, vy: f.y * 14, until: t + 2600, lane }); break;
    case 'laser': {
      fx.laserUntil = t + dur;
      zone({ kind: 'laser', target: -1, x: p.x, y: p.y, lane, until: t + dur, nextAt: t });
      break;
    }
    case 'turret': {
      const y = isPlatformer(game) ? groundAt(game, lane, p.x, p.y + R) : p.y;
      zone({ kind: 'turret', target: -1, x: p.x, y, lane, until: t + dur, nextAt: t + 500 });
      break;
    }
    case 'blank': {
      const near = (q: { x: number; y: number }) => dist(q, p) < 340;
      game.projectiles = game.projectiles.filter((s) => s.owner === m.info.id || !near(s));
      game.shots = game.shots.filter((s) => s.owner === m.info.id || !near(s));
      game.bombs = game.bombs.filter((b) => b.target !== m.info.id);
      game.spikes = game.spikes.filter((s) => s.owner === m.info.id || !near(s));
      game.oils = game.oils.filter((o) => o.ownerId === m.info.id || !near(o));
      game.zones = game.zones.filter((z) => z.owner === m.info.id || z.kind === 'laser' || (z.kind === 'leech' ? z.target !== m.info.id : !near(z)));
      for (const k of ['liftUntil', 'bubbleUntil', 'shrinkUntil', 'slowUntil'] as const) fx[k] = 0;
      if (m.frozen) { m.frozenUntil = t; game.setFrozen(m, false); }
      // the shockwave: rivals near are thrown off, on a platformer into a lane beside theirs
      const plan = game.track.platformer?.plan;
      const lanes: number[] = plan ? [...(plan.lanes ?? [0, 1, 2])] : [];
      for (const o of game.marbles) {
        if (o === m || !racing(o)) continue;
        const d = dist(o.body.position, p);
        if (d > 230) continue;
        knock(game, o, p.x, p.y, 10 * (1 - d / 260));
        if (plan && sameLane(game, m, o)) {
          const l = o.lane ?? 1;
          const side = lanes.filter((x) => Math.abs(x - l) === 1);
          if (side.length) switchLane(game, o, side[Math.floor(game.rng() * side.length)] as Lane);
        }
      }
      game.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 34, maxTtl: 34, color: '#f8fafc' });
      game.effects.push({ type: 'flash', x: p.x, y: p.y, ttl: 12, maxTtl: 12, color: '#f8fafc' });
      game.shake = Math.max(game.shake, 6);
      break;
    }
  }
}

// ------------------------------------------------------------------ upkeep
/** Each physics step on the host: history, shots, zones and the per-marble timers. */
export function step(game: Game, dt: number): void {
  const t = game.time, k = dt / 16.7;
  // where everyone was (Rewind, the shadow twin)
  for (const m of game.marbles) {
    const past = (m.past ??= []);
    const last = past[past.length - 1];
    if (!last || t - last.t >= PAST_EVERY) {
      const v = m.body.velocity;
      past.push({ t, x: m.body.position.x, y: m.body.position.y, vx: v.x, vy: v.y, lane: m.lane ?? 1, hp: m.health?.hp ?? 100 });
      while (past.length && t - past[0].t > PAST_KEEP) past.shift();
    }
  }
  stepShots(game, dt);
  stepZones(game, dt);
  for (const m of game.marbles) {
    const fx = m.fx as Fx | undefined;
    if (!fx || !racing(m)) continue;
    const p = m.body.position, v = Body.getVelocity(m.body);
    // held in a telekinetic grip, then thrown back down the course
    if ((fx.liftUntil ?? 0) > 0) {
      if (fx.liftUntil! > t) {
        const tx = fx.liftX ?? p.x, ty = fx.liftY ?? p.y;
        Body.setPosition(m.body, { x: p.x + (tx - p.x) * 0.12 * k, y: p.y + (ty - p.y) * 0.12 * k });
        Body.setVelocity(m.body, { x: 0, y: 0 });
      } else {
        const f = fwd(game);
        Body.setVelocity(m.body, { x: -f.x * 10 + (isPlatformer(game) ? 0 : 0), y: isPlatformer(game) ? -4 : -10 });
        const by = game.byIdOrNull(fx.liftBy ?? -1);
        game.damage(m, offence(by, 10), by ? by.info.id : null, 'shock');
        fx.liftUntil = 0;
      }
    }
    // a bubble floats up and keeps no speed
    if ((fx.bubbleUntil ?? 0) > t) Body.setVelocity(m.body, { x: v.x * 0.85, y: Math.max(-1.6, v.y * 0.6 - 0.9) });
    // slowed by Time Warp, or shrunk: a lower speed limit
    const cap = (fx.slowUntil ?? 0) > t ? 5 : (fx.shrinkUntil ?? 0) > t ? 7 : Infinity;
    const sp = Math.hypot(v.x, v.y);
    if (sp > cap) { const s = 1 - (1 - cap / sp) * Math.min(1, 0.25 * k); Body.setVelocity(m.body, { x: v.x * s, y: v.y * s }); }
    // a laser's recoil
    if ((fx.laserUntil ?? 0) > t) Body.setVelocity(m.body, { x: v.x * (1 - 0.006 * k), y: v.y });
    // Thorn Shell: whoever touches you is pricked and thrown off
    if ((fx.thornsUntil ?? 0) > t) {
      for (const o of game.marbles) {
        if (o === m || !racing(o) || !sameLane(game, m, o) || dist(o.body.position, p) > R * 2 + 6) continue;
        if (t - (o.thornAt ?? -1000) < 600) continue;
        o.thornAt = t;
        knock(game, o, p.x, p.y, 8);
        game.damage(o, offence(m, 15), m.info.id, 'spikes');
      }
    }
    // Orbit Blades: three saws around you, each breaks on its first rival
    if ((fx.bladesUntil ?? 0) > t && (fx.blades ?? 0) > 0) {
      for (const b of bladePoints(m, t)) {
        for (const o of game.marbles) {
          if (o === m || !racing(o) || !sameLane(game, m, o) || dist(o.body.position, b) > R + 8) continue;
          if (t - (o.bladeAt ?? -1000) < 300) continue;
          o.bladeAt = t;
          knock(game, o, p.x, p.y, 6);
          game.damage(o, offence(m, 12), m.info.id, 'blade');
          game.effects.push({ type: 'flash', x: b.x, y: b.y, ttl: 10, maxTtl: 10, color: '#cbd5e1' });
          fx.blades = (fx.blades ?? 1) - 1;
          if (fx.blades <= 0) fx.bladesUntil = 0;
          break;
        }
        if ((fx.blades ?? 0) <= 0) break;
      }
    }
  }
}

/** Where the three Orbit Blades are this instant (only the ones still whole). */
export function bladePoints(m: Marble, t: number): { x: number; y: number }[] {
  const fx = m.fx as Fx | undefined;
  const n = Math.max(0, Math.min(3, fx?.blades ?? 0));
  const p = m.body.position;
  return Array.from({ length: n }, (_, i) => { const a = t / 170 + (i * Math.PI * 2) / 3; return { x: p.x + Math.cos(a) * R * 2.6, y: p.y + Math.sin(a) * R * 2.6 }; });
}

function stepShots(game: Game, dt: number) {
  const t = game.time, k = dt / 16.7;
  const plan = game.track.platformer?.plan;
  for (let i = game.shots.length - 1; i >= 0; i--) {
    const s = game.shots[i];
    const owner = game.byIdOrNull(s.owner);
    const gone = () => game.shots.splice(i, 1);
    if (s.kind === 'cluster' || s.kind === 'bomblet') {
      s.vy += 0.35 * k;
      s.x += s.vx * k; s.y += s.vy * k;
      const ground = plan ? floorAt(plan, s.lane as Lane, s.x) : null;
      const landed = ground !== null && s.y > ground - 6 && s.vy > 0;
      if (t < s.until && !landed) continue;
      gone();
      if (s.kind === 'cluster') {
        blast(game, owner, s.x, s.y, 70, 10, 5, s.lane);
        for (let b = 0; b < 4; b++) {
          const made: Shot = { id: game.nextProjectileId++, kind: 'bomblet', owner: s.owner, target: -1, x: s.x, y: s.y - 8, vx: plan ? 2 + b * 2 + game.rng() * 1.5 : (b - 1.5) * 2.5, vy: -4 - game.rng() * 3, at: t, until: t + 500 + b * 140, lane: s.lane, hits: [] };
          game.shots.push(made);
        }
      } else blast(game, owner, s.x, s.y, 80, 12, 6, s.lane);
      game.sfx('bomb', owner ?? game.player, s.x, s.y);
      continue;
    }
    if (s.kind === 'boomerang') {
      // out along the lane, slowing, then home to the thrower
      const age = t - s.at;
      if (!s.turned && age > 650) s.turned = true;
      if (s.turned && owner) {
        const dx = owner.body.position.x - s.x, dy = owner.body.position.y - s.y, d = Math.hypot(dx, dy) || 1;
        s.vx += ((dx / d) * 15 - s.vx) * 0.12 * k; s.vy += ((dy / d) * 15 - s.vy) * 0.12 * k;
        if (d < 30) { gone(); continue; }
      } else { s.vx *= 1 - 0.025 * k; s.vy *= 1 - 0.025 * k; }
    }
    s.x += s.vx * k; s.y += s.vy * k;
    if (t > s.until) { gone(); continue; }
    // what it hits
    for (const o of game.marbles) {
      if (!racing(o) || o.info.id === s.owner || s.hits.includes(o.info.id)) continue;
      if (isPlatformer(game) && (o.lane ?? 1) !== s.lane) continue;
      if (dist(o.body.position, s) > R + (s.kind === 'bubble' ? 12 : 10)) continue;
      s.hits.push(o.info.id);
      if (s.kind === 'bubble') {
        gone();
        if (mirrored(game, o) || shielded(game, o)) break;
        fxOf(o).bubbleUntil = t + 2000;
        game.emit({ kind: 'skillfx', fx: 'a-bubble', seat: s.owner, target: o.info.id, x: o.body.position.x, y: o.body.position.y, until: t + 2000 });
        if (o.info.isPlayer) game.onEvent?.('Trapped in a bubble!', SKILLS.bubble.color);
        break;
      }
      knock(game, o, s.x, s.y, s.kind === 'boomerang' ? 6 : 4);
      game.damage(o, offence(owner, s.kind === 'boomerang' ? 15 : 10), s.owner, 'bolt');
      game.effects.push({ type: 'flash', x: s.x, y: s.y, ttl: 10, maxTtl: 10, color: SKILLS[s.kind as 'bubble' | 'boomerang' | 'turret'].color });
      if (s.kind === 'turret') { gone(); break; }
    }
  }
}

function stepZones(game: Game, dt: number) {
  const t = game.time, k = dt / 16.7;
  for (let i = game.zones.length - 1; i >= 0; i--) {
    const z = game.zones[i];
    const owner = game.byIdOrNull(z.owner);
    if (z.kind === 'mega' && t >= z.until) {
      game.zones.splice(i, 1);
      blast(game, owner, z.x, z.y, 320, 40, 12, null, true);
      game.shake = Math.max(game.shake, 16);
      game.sfx('bomb', owner ?? game.player, z.x, z.y);
      continue;
    }
    if (t > z.until || (z.kind === 'twin' && z.decoy && !game.decoys.includes(z.decoy))) {
      if (z.decoy) { const j = game.decoys.indexOf(z.decoy); if (j >= 0) game.decoys.splice(j, 1); }
      game.zones.splice(i, 1);
      continue;
    }
    switch (z.kind) {
      case 'well': {
        // everyone but its owner, in every lane, is drawn toward it and slowed
        for (const o of game.marbles) {
          if (o.info.id === z.owner || !racing(o)) continue;
          const dx = z.x - o.body.position.x, dy = z.y - o.body.position.y;
          if (Math.abs(dx) > 320 || Math.abs(dy) > 420) continue;
          const v = Body.getVelocity(o.body), d = Math.hypot(dx, dy) || 1;
          Body.setVelocity(o.body, { x: v.x * (1 - 0.03 * k) + (dx / d) * 0.45 * k, y: v.y + (isPlatformer(game) ? 0 : (dy / d) * 0.3 * k) });
        }
        break;
      }
      case 'mine': {
        if (t < (z.nextAt ?? 0)) break;
        const hit = game.marbles.find((o) => o.info.id !== z.owner && racing(o) && (!isPlatformer(game) || (o.lane ?? 1) === z.lane) && dist(o.body.position, z) < R + 12);
        if (!hit) break;
        game.zones.splice(i, 1);
        blast(game, owner, z.x, z.y, 90, 20, 7, z.lane);
        game.sfx('bomb', hit, z.x, z.y);
        break;
      }
      case 'wall': {
        for (const o of game.marbles) {
          if (o.info.id === z.owner || !racing(o) || (isPlatformer(game) && (o.lane ?? 1) !== z.lane)) continue;
          const p = o.body.position;
          const inside = isPlatformer(game)
            ? Math.abs(p.x - z.x) < R + 8 && p.y + R > z.y - (z.h ?? 72)
            : Math.abs(p.y - z.y) < R + 8 && Math.abs(p.x - z.x) < 90;
          if (!inside || t - (z.hitAt![o.info.id] ?? -1000) < 700) continue;
          z.hitAt![o.info.id] = t;
          const v = Body.getVelocity(o.body);
          Body.setVelocity(o.body, isPlatformer(game) ? { x: -Math.abs(v.x) * 0.45 - 3, y: v.y - 2 } : { x: v.x, y: -Math.abs(v.y) * 0.45 - 3 });
          game.damage(o, offence(owner, 25), z.owner, 'spikes');
          game.effects.push({ type: 'flash', x: p.x, y: p.y, ttl: 10, maxTtl: 10, color: SKILLS.spikewall.color });
        }
        break;
      }
      case 'turret': {
        if (t < (z.nextAt ?? 0)) break;
        z.nextAt = t + 900;
        let best: Marble | null = null, bestD = 520;
        for (const o of game.marbles) {
          if (o.info.id === z.owner || !racing(o) || (isPlatformer(game) && (o.lane ?? 1) !== z.lane)) continue;
          const d = dist(o.body.position, { x: z.x, y: z.y - 30 });
          if (d < bestD) { best = o; bestD = d; }
        }
        if (!best) break;
        const sx = z.x, sy = z.y - 30, dx = best.body.position.x - sx, dy = best.body.position.y - sy, d = Math.hypot(dx, dy) || 1;
        const shot: Shot = { id: game.nextProjectileId++, kind: 'turret', owner: z.owner, target: best.info.id, x: sx, y: sy, vx: (dx / d) * 11, vy: (dy / d) * 11, at: t, until: t + 1500, lane: z.lane, hits: [] };
        game.shots.push(shot);
        game.emit({ kind: 'skillfx', fx: 's-turret', seat: z.owner, target: best.info.id, x: sx, y: sy, until: shot.until });
        game.sfx('bump', owner ?? game.player, sx, sy);
        break;
      }
      case 'laser': {
        if (!owner || !racing(owner)) { z.until = 0; break; }
        z.x = owner.body.position.x; z.y = owner.body.position.y;
        if (t < (z.nextAt ?? 0)) break;
        z.nextAt = t + 500;
        for (const o of game.marbles) {
          if (o === owner || !racing(o) || !sameLane(game, owner, o)) continue;
          const p = o.body.position;
          const inBeam = isPlatformer(game) ? p.x > z.x + R && p.x < z.x + LASER_LEN && Math.abs(p.y - z.y) < 45 : p.y > z.y + R && p.y < z.y + LASER_LEN && Math.abs(p.x - z.x) < 45;
          if (!inBeam) continue;
          const v = Body.getVelocity(o.body);
          Body.setVelocity(o.body, { x: v.x * 0.8, y: v.y * 0.8 });
          game.damage(o, offence(owner, 8), owner.info.id, 'lightning');
        }
        break;
      }
      case 'leech': {
        const victim = game.byIdOrNull(z.target);
        if (!owner || !victim || !racing(owner) || !racing(victim) || dist(owner.body.position, victim.body.position) > 450) { z.until = 0; break; }
        z.x = victim.body.position.x; z.y = victim.body.position.y;
        if (t < (z.nextAt ?? 0)) break;
        z.nextAt = t + 750;
        const before = victim.health?.hp ?? 0;
        game.damage(victim, offence(owner, 5), owner.info.id, 'bolt');
        const drained = Math.max(0, before - (victim.health?.hp ?? before));
        if (drained > 0 && owner.health) {
          owner.health = { ...owner.health, hp: Math.min(100, owner.health.hp + drained) };
          game.effects.push({ type: 'text', x: owner.body.position.x, y: owner.body.position.y - 26, ttl: 30, maxTtl: 30, color: '#f43f5e', text: `+${drained}` });
        }
        break;
      }
      case 'twin': {
        // it follows your own path a second behind you, and knocks any rival it touches
        const s = owner ? pastOf(owner, game, 900) : null;
        if (s) { z.x = s.x; z.y = s.y; z.lane = isPlatformer(game) ? s.lane : 0; }
        if (z.decoy) { z.decoy.x = z.x; z.decoy.y = z.y; z.decoy.lane = z.lane; }
        for (const o of game.marbles) {
          if (o.info.id === z.owner || !racing(o) || (isPlatformer(game) && (o.lane ?? 1) !== z.lane) || dist(o.body.position, z) > R * 2 + 4) continue;
          if (t - (z.hitAt![o.info.id] ?? -1000) < 800) continue;
          z.hitAt![o.info.id] = t;
          knock(game, o, z.x, z.y, 7);
          game.damage(o, offence(owner, 8), z.owner, 'ram');
        }
        break;
      }
      case 'mega': break;
    }
  }
}
/** How far a Laser Beam reaches. */
export const LASER_LEN = 640;

/** Premium skills that are something you wear (an aura on you): their timer, for the toolbar's countdown. */
export function premiumRemaining(m: Marble, item: ItemType, t: number): number {
  const fx = m.fx as Fx | undefined;
  if (!fx) return 0;
  const until = item === 'thorns' ? fx.thornsUntil : item === 'blades' ? fx.bladesUntil : item === 'laser' ? fx.laserUntil : 0;
  return Math.max(0, (until ?? 0) - t);
}

