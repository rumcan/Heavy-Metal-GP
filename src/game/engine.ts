import Matter from 'matter-js';
import { generateTrack, meta, Track, CAT_MARBLE, CAT_WALL, CAT_SENSOR, CAT_LOOP_UP, CAT_LOOP_CLOSE, W } from './track';
import { ItemType, MarbleInfo, MARBLE_RADIUS, statsToPhysics, mulberry32, TrackProfile, emptyInventory, normalizeInventory, ITEM_TYPES, ITEM_INFO, MAX_ITEM_STACK } from './types';
import type { Inventory } from './types';
import { gridSlots } from './season';
import { assistRolling, BASE_TICK, createMarble, downhill } from './physics';
import type { RampSurface } from './physics';
import type { SoundEvent, SoundType } from './audio';

export interface GameOptions {
  profile?: TrackProfile;
  gridOrder?: number[]; // marble ids, P1 first
  track?: Track;
  recovery?: boolean;
  effects?: boolean;
  aiItems?: boolean;
  inventory?: Partial<Inventory>;
}

const { Engine, Bodies, Body, Composite, Events, Query } = Matter;

const ITEM_POOL = ITEM_TYPES;
const TICK = 1000 / 60;

export interface Marble {
  info: MarbleInfo;
  body: Matter.Body;
  baseDensity: number;
  restitution: number;
  frictionAir: number;
  maxSpeed: number;
  inventory: Inventory;
  itemCooldownUntil: number;
  aeroUntil: number;
  jumpUntil: number;
  aiUseAt: number;
  frozenUntil: number;
  ghostUntil: number;
  /** 0 = entering a loop (rising quarter solid), 1 = past the top (closing quarter solid). */
  loopStage: 0 | 1;
  anvilUntil: number;
  rocketUntil: number;
  padCooldownUntil: number;
  frozen: boolean;
  inOil: boolean;
  finishedAt: number | null;
  stuckTime: number;
  lastPickupAt: number;
  trail: { x: number; y: number }[];
  pegs: number;
  gridSlot: number;
  grounded: number; // ticks since last floor contact
  motionAnchor: Matter.Vector;
  motionAt: number;
  depthAt: number;
  deepestY: number;
  lastRecoveryAt: number;
  recoveryUntil: number;
  recoveries: number;
  nudges: number;
}

export interface OilSlick {
  x: number;
  y: number;
  r: number;
  ownerId: number;
  expiresAt: number;
}

export interface Effect {
  type: 'ring' | 'beam' | 'debris' | 'text' | 'flash' | 'snow';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  ttl: number;
  maxTtl: number;
  color: string;
  text?: string;
  particles?: { x: number; y: number; vx: number; vy: number; s: number }[];
}

export interface RankEntry {
  marble: Marble;
  rank: number;
  finished: boolean;
  time: number | null;
}

export class Game {
  engine: Matter.Engine;
  world: Matter.World;
  track: Track;
  marbles: Marble[] = [];
  player: Marble;
  oils: OilSlick[] = [];
  effects: Effect[] = [];
  /** Sound cues for the race screen to play and clear each frame. */
  sounds: SoundEvent[] = [];
  time = 0;
  started = false;
  gateOpen = false;
  finishOrder: Marble[] = [];
  nudge = 0;
  rng: () => number;
  shake = 0;
  raceStartTime = 0;
  private byId = new Map<number, Marble>();
  private supports = new Map<number, RampSurface>();
  private recoveryEnabled: boolean;
  private effectsEnabled: boolean;
  private aiItemsEnabled: boolean;
  private pendingLaunches = new Map<number, Matter.Vector>();
  private lastWallToast = -9999;
  private pendingBreaks: { body: Matter.Body; marble: Marble; v: { x: number; y: number } }[] = [];
  onEvent?: (msg: string, color?: string) => void;
  onInventoryChange?: (inventory: Inventory) => void;
  private poppingPegs = new Set<Matter.Body>();
  private staticBins = new Map<number, Matter.Body[]>();
  private globalBodies: Matter.Body[] = [];
  private loadedBodies = new Map<number, Matter.Body>();
  private loadedCells = '';
  private streaming = false;

  constructor(seed: number, roster: MarbleInfo[], opts: GameOptions = {}) {
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.engine = Engine.create({
      enableSleeping: false,
      positionIterations: 10,
      velocityIterations: 8,
    });
    this.engine.gravity.y = 1;
    this.world = this.engine.world;
    this.track = opts.track ?? generateTrack(seed, opts.profile);
    this.recoveryEnabled = opts.recovery !== false;
    this.effectsEnabled = opts.effects !== false;
    this.aiItemsEnabled = opts.aiItems !== false;
    Composite.add(this.world, this.track.bodies);

    const order = opts.gridOrder && opts.gridOrder.length === roster.length ? opts.gridOrder : roster.map((r) => r.id);
    const slots = gridSlots(order);
    roster.forEach((info) => {
      const ph = statsToPhysics(info.stats);
      const slot = slots.find((s) => s.id === info.id)!;
      const body = createMarble(info, { x: slot.x, y: this.track.startY });
      const m: Marble = {
        info,
        body,
        baseDensity: body.density,
        restitution: ph.restitution,
        frictionAir: ph.frictionAir,
        maxSpeed: ph.maxSpeed,
        inventory: info.isPlayer ? normalizeInventory(opts.inventory) : emptyInventory(),
        itemCooldownUntil: 0,
        aeroUntil: 0,
        jumpUntil: 0,
        aiUseAt: 0,
        frozenUntil: 0,
        ghostUntil: 0,
        anvilUntil: 0,
        rocketUntil: 0,
        padCooldownUntil: 0,
        frozen: false,
        inOil: false,
        finishedAt: null,
        stuckTime: 0,
        loopStage: 0,
        lastPickupAt: 0,
        trail: [],
        pegs: 0,
        gridSlot: slot.slot,
        grounded: 99,
        motionAnchor: { ...body.position },
        motionAt: 0,
        depthAt: 0,
        deepestY: this.track.startY,
        lastRecoveryAt: -10000,
        recoveryUntil: 0,
        recoveries: 0,
        nudges: 0,
      };
      this.marbles.push(m);
      this.byId.set(info.id, m);
    });
    this.marbles.sort((a, b) => a.info.id - b.info.id);
    Composite.add(
      this.world,
      this.marbles.map((m) => m.body),
    );
    this.player = this.marbles.find((m) => m.info.isPlayer) ?? this.marbles[0];
    if (!this.player) throw new Error('A race needs at least one marble.');
    this.streaming = this.track.bodies.length > 350;
    if (this.streaming) {
      for (const body of this.track.bodies) {
        this.loadedBodies.set(body.id, body);
        if (body.bounds.max.y - body.bounds.min.y > 1800) this.globalBodies.push(body);
        else {
          const from = Math.floor(body.bounds.min.y / 400);
          const to = Math.floor(body.bounds.max.y / 400);
          for (let cell = from; cell <= to; cell++) this.staticBins.set(cell, [...(this.staticBins.get(cell) ?? []), body]);
        }
      }
      this.syncTrack();
    }

    Events.on(this.engine, 'collisionStart', (e) => this.onCollisionStart(e));
    Events.on(this.engine, 'collisionActive', (e) => this.onCollisionActive(e));
  }

  marbleOf(body: Matter.Body): Marble | undefined {
    if (body.label !== 'marble') return undefined;
    const id = (body.plugin as { id: number }).id;
    return this.byId.get(id);
  }

  start() {
    this.started = true;
  }

  private syncTrack() {
    if (!this.streaming) return;
    const cells = new Set<number>();
    for (const marble of this.marbles) {
      if (marble.finishedAt !== null && !this.allFinished()) continue;
      const y = marble.body.position.y;
      if (!Number.isFinite(y)) continue;
      for (let cell = Math.floor((y - 380) / 400); cell <= Math.floor((y + 380) / 400); cell++) cells.add(cell);
    }
    const key = [...cells].sort((a, b) => a - b).join(',');
    if (key === this.loadedCells) return;
    this.loadedCells = key;
    const wanted = new Map<number, Matter.Body>();
    for (const body of this.globalBodies) if (!meta(body).destroyed) wanted.set(body.id, body);
    for (const cell of cells) for (const body of this.staticBins.get(cell) ?? []) if (!meta(body).destroyed) wanted.set(body.id, body);
    // Only nearby track geometry enters the solver; the renderer and map retain the full circuit.
    for (const [id, body] of this.loadedBodies) if (!wanted.has(id)) Composite.remove(this.world, body);
    const arriving = [...wanted.values()].filter((body) => !this.loadedBodies.has(body.id));
    if (arriving.length) Composite.add(this.world, arriving);
    this.loadedBodies = wanted;
  }

  private removeTrackBody(body: Matter.Body) {
    meta(body).destroyed = true;
    Composite.remove(this.world, body);
    this.loadedBodies.delete(body.id);
  }

  openGate() {
    if (this.gateOpen) return;
    this.gateOpen = true;
    this.raceStartTime = this.time;
    this.sfx('go', this.player, W / 2, 0);
    // trapdoor opens: marbles start from rest and let gravity do the work
    this.removeTrackBody(this.track.gate);
    this.marbles.forEach((m) => {
      Body.setVelocity(m.body, { x: 0, y: 0 });
      m.motionAt = m.depthAt = this.time;
      m.motionAnchor = { ...m.body.position };
      m.deepestY = m.body.position.y;
    });
  }

  // ---------- collisions ----------
  private onCollisionStart(e: Matter.IEventCollision<Matter.Engine>) {
    for (const pair of e.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const ma = this.marbleOf(a);
      const mb = this.marbleOf(b);
      if (ma && !mb) {
        this.contactSurface(ma, b, pair);
        this.marbleHits(ma, b);
      } else if (mb && !ma) {
        this.contactSurface(mb, a, pair);
        this.marbleHits(mb, a);
      }
      else if (ma && mb) {
        const sp = Math.hypot(ma.body.velocity.x - mb.body.velocity.x, ma.body.velocity.y - mb.body.velocity.y);
        if (sp > 4) {
          this.sfx('clack', ma.info.isPlayer ? ma : mb, a.position.x, a.position.y);
          this.effects.push({
            type: 'flash',
            x: (a.position.x + b.position.x) / 2,
            y: (a.position.y + b.position.y) / 2,
            ttl: 10,
            maxTtl: 10,
            color: '#ffffff',
          });
        }
      }
    }
  }

  private sfx(type: SoundType, m: Marble | null, x: number, y: number, extra: Partial<SoundEvent> = {}) {
    if (this.sounds.length < 48) this.sounds.push({ type, x, y, player: !!m?.info.isPlayer, ...extra });
  }

  private applyMask(m: Marble) {
    const ghost = m.ghostUntil > this.time;
    m.body.collisionFilter.mask = CAT_WALL | CAT_SENSOR | (ghost ? 0 : CAT_MARBLE) | (m.loopStage === 1 ? CAT_LOOP_CLOSE : CAT_LOOP_UP);
  }

  private setLoopStage(m: Marble, stage: 0 | 1) {
    if (m.loopStage === stage) return;
    m.loopStage = stage;
    this.applyMask(m);
  }

  private marbleHits(m: Marble, other: Matter.Body) {
    if (m.finishedAt !== null || m.frozen || !this.gateOpen) return;
    const md = meta(other);
    if (!md) return;
    switch (md.kind) {
      case 'loopTop':
        if (m.loopStage === 0) this.sfx('loop', m, other.position.x, other.position.y);
        this.setLoopStage(m, 1);
        break;
      case 'loopExit':
        this.setLoopStage(m, 0);
        break;
      case 'hoop': {
        const v = Body.getVelocity(m.body);
        const speed = Math.hypot(v.x, v.y);
        const dir = speed > 1.5 ? { x: v.x / speed, y: v.y / speed } : md.dir ?? { x: 0, y: 1 };
        const boosted = Math.min(20, Math.max(speed * 1.35, speed + 5));
        Body.setVelocity(m.body, { x: dir.x * boosted, y: dir.y * boosted });
        this.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 22, maxTtl: 22, color: '#fb923c' });
        this.sfx('hoop', m, other.position.x, other.position.y);
        break;
      }
      case 'wrecker': {
        const dx = m.body.position.x - other.position.x, dy = m.body.position.y - other.position.y;
        const d = Math.hypot(dx, dy) || 1;
        const v = Body.getVelocity(m.body);
        const push = 7;
        Body.setVelocity(m.body, { x: v.x * 0.4 + dx / d * push, y: v.y * 0.4 + dy / d * push });
        this.shake = Math.max(this.shake, 5);
        this.sfx('clang', m, other.position.x, other.position.y);
        this.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 14, maxTtl: 14, color: '#e2e8f0' });
        break;
      }
      case 'breakable': {
        const speed = Body.getSpeed(m.body);
        const dmg = m.body.mass * speed;
        md.hp = (md.hp ?? 0) - dmg;
        if (md.hp > 0 && dmg > 0.5) this.sfx('crack', m, other.position.x, other.position.y);
        this.effects.push({
          type: 'debris',
          x: other.position.x,
          y: other.position.y,
          ttl: 25,
          maxTtl: 25,
          color: '#fbbf24',
          particles: this.makeParticles(other.position.x, other.position.y, 6, 3),
        });
        if (md.hp <= 0) {
          md.hp = 0;
          // defer removal until after this physics step, and restore the marble's momentum so it plows through
          const v = Body.getVelocity(m.body);
          if (!this.pendingBreaks.some((p) => p.body === other)) {
            this.pendingBreaks.push({ body: other, marble: m, v: { x: v.x * 0.85, y: v.y } });
          }
          this.shake = 10;
          this.sfx('smash', m, other.position.x, other.position.y);
          this.effects.push({
            type: 'debris',
            x: other.position.x,
            y: other.position.y,
            ttl: 50,
            maxTtl: 50,
            color: '#f59e0b',
            particles: this.makeParticles(other.position.x, other.position.y, 22, 7),
          });
          if (m.info.isPlayer) this.onEvent?.('SMASH! Shortcut opened', '#f59e0b');
        } else if (m.info.isPlayer && this.time - this.lastWallToast > 1200 && dmg > 0.5) {
          this.lastWallToast = this.time;
          this.onEvent?.(`Too light! Wall at ${Math.round((md.hp / (md.maxHp ?? 1)) * 100)}%`, '#94a3b8');
        }
        break;
      }
      case 'pad': {
        if (this.time < m.padCooldownUntil) break;
        m.padCooldownUntil = this.time + 600;
        const dir = md.dir ?? { x: -1, y: -1 };
        const vy = Math.min(12.2, 3.5 + 9.5 * m.restitution);
        this.pendingLaunches.set(m.info.id, { x: dir.x * 4.5, y: -vy });
        this.sfx('spring', m, other.position.x, other.position.y);
        this.effects.push({ type: 'ring', x: other.position.x, y: other.position.y - 10, ttl: 20, maxTtl: 20, color: '#34d399' });
        if (m.info.isPlayer) this.onEvent?.(`Boing! Bounce power ${(m.restitution * 100).toFixed(0)}%`, '#34d399');
        break;
      }
      case 'itembox': {
        if (!md.active) break;
        const available = ITEM_POOL.filter((item) => m.inventory[item] < MAX_ITEM_STACK);
        if (!available.length) break;
        md.active = false;
        md.respawnAt = this.time + 7000;
        this.grantItem(m, available[Math.floor(this.rng() * available.length)]);
        this.sfx('pickup', m, other.position.x, other.position.y);
        this.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 18, maxTtl: 18, color: '#facc15' });
        break;
      }
      case 'ppeg': {
        if (md.hit) break;
        md.hit = true;
        md.hitAt = this.time;
        this.poppingPegs.add(other);
        const col = md.pegColor ?? 'blue';
        this.sfx('peg', m, other.position.x, other.position.y, { color: col });
        const pc = col === 'orange' ? '#fb923c' : col === 'green' ? '#4ade80' : '#60a5fa';
        this.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 14, maxTtl: 14, color: pc });
        this.effects.push({ type: 'debris', x: other.position.x, y: other.position.y, ttl: 22, maxTtl: 22, color: pc, particles: this.makeParticles(other.position.x, other.position.y, 6, 2.5) });
        if (col === 'orange') {
          m.pegs++;
          // orange pegs give a little kick of speed
          const v = Body.getVelocity(m.body);
          const sp = Math.hypot(v.x, v.y) || 1;
          Body.setVelocity(m.body, { x: v.x + (v.x / sp) * 1.5, y: v.y + (v.y / sp) * 1.5 + 0.5 });
          this.effects.push({ type: 'text', x: other.position.x, y: other.position.y - 20, ttl: 40, maxTtl: 40, color: '#fdba74', text: '+1 PEG' });
        } else if (col === 'green') {
          this.grantItem(m, md.itemDrop ?? ITEM_POOL[Math.floor(this.rng() * ITEM_POOL.length)]);
          this.effects.push({ type: 'text', x: other.position.x, y: other.position.y - 20, ttl: 40, maxTtl: 40, color: '#86efac', text: 'POWER!' });
        }
        break;
      }
      case 'bucket': {
        if (this.time < (md.cooldownUntil ?? 0)) break;
        md.cooldownUntil = this.time + 250;
        Body.setPosition(m.body, { x: other.position.x, y: other.position.y + 30 });
        this.pendingLaunches.set(m.info.id, { x: 0, y: 17 });
        this.sfx('bucket', m, other.position.x, other.position.y);
        m.trail = [];
        this.shake = 6;
        this.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 24, maxTtl: 24, color: '#fbbf24' });
        this.effects.push({ type: 'text', x: other.position.x, y: other.position.y - 30, ttl: 60, maxTtl: 60, color: '#fbbf24', text: 'ALL ABOARD!' });
        if (m.info.isPlayer) this.onEvent?.('ALL ABOARD! Minecart express', '#fbbf24');
        break;
      }
      case 'finish': {
        this.finishMarble(m);
        break;
      }
      case 'peg': {
        if (Body.getSpeed(m.body) > 2) this.sfx('bump', m, other.position.x, other.position.y);
        break;
      }
      case 'ramp':
      case 'wall':
      case 'loop':
        if (m.info.isPlayer && Body.getSpeed(m.body) > 6) this.sfx('thud', m, m.body.position.x, m.body.position.y);
        break;
      default:
        break;
    }
  }

  private onCollisionActive(e: Matter.IEventCollision<Matter.Engine>) {
    for (const pair of e.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const ma = this.marbleOf(a);
      const mb = this.marbleOf(b);
      const m = ma ?? mb;
      const other = ma ? b : a;
      if (!m || (ma && mb) || m.frozen || m.finishedAt !== null || !this.gateOpen) continue;
      const md = meta(other);
      if (!md) continue;
      this.contactSurface(m, other, pair);
      // A marble too slow to make the loop settles at the bottom; let it roll out instead of rocking forever.
      if (md.kind === 'loopBail' && m.loopStage === 0 && Body.getSpeed(m.body) < 2.5) this.setLoopStage(m, 1);
      if (md.kind === 'boost' && md.dir) {
        const v = Body.getVelocity(m.body);
        const k = 0.45 * Math.sqrt(1 / m.body.mass) * this.engine.timing.lastDelta / BASE_TICK;
        Body.setVelocity(m.body, { x: v.x + md.dir.x * k, y: v.y + md.dir.y * k });
        if (this.rng() < 0.3) {
          this.effects.push({
            type: 'debris',
            x: m.body.position.x,
            y: m.body.position.y,
            ttl: 14,
            maxTtl: 14,
            color: '#fb923c',
            particles: this.makeParticles(m.body.position.x, m.body.position.y, 2, 1.5),
          });
        }
      }
    }
  }

  private contactSurface(m: Marble, obstacle: Matter.Body, pair: Matter.Pair) {
    const surface = meta(obstacle)?.surface;
    if (!surface || m.frozen || m.finishedAt !== null) return;
    const offset = { x: m.body.position.x - surface.start.x, y: m.body.position.y - surface.start.y };
    if (offset.x * surface.normal.x + offset.y * surface.normal.y < 0) return;
    this.supports.set(m.info.id, surface);
    pair.friction = this.time < m.aeroUntil ? 0 : 0.002;
    pair.frictionStatic = 0;
    const velocity = Body.getVelocity(m.body);
    const impact = Math.abs(velocity.x * surface.normal.x + velocity.y * surface.normal.y);
    if (impact < 1.3) pair.restitution = 0;
  }

  private finishMarble(m: Marble) {
    if (m.finishedAt !== null || !this.gateOpen) return;
    m.finishedAt = this.raceTime();
    this.finishOrder.push(m);
    if (m.info.isPlayer) this.sfx('finish', m, m.body.position.x, m.body.position.y, { rank: this.finishOrder.length });
    m.body.frictionAir = 0.045;
    m.trail = [];
    this.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 30, maxTtl: 30, color: m.info.color });
  }

  private updateRecovery(m: Marble, dt: number) {
    if (!this.recoveryEnabled || m.finishedAt !== null) return;
    // Deliberate item penalties pause the watchdog; recovery must not cancel a freeze or oil hit.
    if (m.frozen || m.inOil) {
      m.motionAt += dt;
      m.depthAt += dt;
      return;
    }
    const p = m.body.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < -MARBLE_RADIUS || p.x > W + MARBLE_RADIUS || p.y < -60) {
      this.recoverMarble(m);
      return;
    }
    if (Math.hypot(p.x - m.motionAnchor.x, p.y - m.motionAnchor.y) > 26) {
      m.motionAnchor = { ...p };
      m.motionAt = this.time;
    }
    if (p.y > m.deepestY + 16) {
      m.deepestY = p.y;
      m.depthAt = this.time;
    }
    const stalled = this.time - m.motionAt;
    const noDescent = this.time - m.depthAt;
    m.stuckTime = Math.max(stalled, noDescent);
    if (this.time - m.lastRecoveryAt < 1800) return;

    if (stalled > 4700 || noDescent > 8500) {
      this.recoverMarble(m);
    } else if (stalled > 1300) {
      const surface = this.supports.get(m.info.id);
      const direction = surface ? downhill(surface).x : p.x < W / 2 ? 1 : -1;
      const v = Body.getVelocity(m.body);
      Body.setVelocity(m.body, { x: direction * (3.2 + (m.info.id % 3) * 0.4), y: Math.min(v.y, -2.8) });
      m.lastRecoveryAt = this.time;
      m.nudges++;
    }
  }

  private recoverMarble(m: Marble) {
    const p = m.body.position;
    const origin = {
      x: Number.isFinite(p.x) ? Math.max(35, Math.min(W - 35, p.x)) : W / 2,
      y: Number.isFinite(p.y) ? Math.max(this.track.startY, p.y) : m.deepestY,
    };
    const blockers = [...this.track.bodies.filter((body) => !meta(body).destroyed), ...this.marbles.map((marble) => marble.body)].filter((body) => body !== m.body && !body.isSensor);
    const probe = Bodies.circle(0, 0, MARBLE_RADIUS + 4);
    const direction = origin.x < W / 2 ? 1 : -1;
    let destination: Matter.Vector | undefined;
    // Move just below the local obstruction, never to the next checkpoint or past the finish.
    for (const dy of [60, 100, 140, 190, 240, 290]) {
      for (const dx of [0, 42, -42, 84, -84, 140, -140, 220, -220, 320, -320]) {
        const point = {
          x: Math.max(32, Math.min(W - 32, origin.x + dx * direction)),
          y: Math.min(this.track.finishY - 45, origin.y + dy),
        };
        Body.setPosition(probe, point);
        if (!Query.collides(probe, blockers).length) {
          destination = point;
          break;
        }
      }
      if (destination) break;
    }
    if (!destination) {
      m.lastRecoveryAt = this.time;
      return;
    }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || m.body.vertices.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y))) {
      Composite.remove(this.world, m.body);
      m.body = createMarble(m.info, destination);
      if (m.anvilUntil > this.time) Body.setDensity(m.body, m.baseDensity * 3);
      Composite.add(this.world, m.body);
    } else Body.setPosition(m.body, destination);
    m.loopStage = 0;
    this.applyMask(m);
    Body.setVelocity(m.body, { x: 0, y: 1 });
    Body.setAngularVelocity(m.body, 0);
    m.trail = [];
    m.motionAnchor = { ...destination };
    m.motionAt = m.depthAt = m.lastRecoveryAt = this.time;
    m.deepestY = destination.y;
    m.recoveryUntil = this.time + 1600;
    m.recoveries++;
    this.effects.push({ type: 'ring', ...destination, ttl: 30, maxTtl: 30, color: '#d63e2e' });
    if (m.info.isPlayer) this.onEvent?.('Race marshal: back on track', '#d63e2e');
  }

  makeParticles(x: number, y: number, n: number, sp: number) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      const s = sp * (0.4 + this.rng());
      arr.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, s: 2 + this.rng() * 3 });
    }
    return arr;
  }

  setFrozen(m: Marble, on: boolean) {
    if (m.frozen === on) return;
    m.frozen = on;
    if (on) {
      Body.setVelocity(m.body, { x: 0, y: 0 });
      Body.setAngularVelocity(m.body, 0);
      Body.setStatic(m.body, true);
    } else {
      Body.setStatic(m.body, false);
      // setStatic restores original mass; re-apply current density (anvil may be active)
      Body.setDensity(m.body, this.time < m.anvilUntil ? m.baseDensity * 3 : m.baseDensity);
      m.body.friction = this.time < m.aeroUntil ? 0 : 0.004;
      m.frozenUntil = 0;
    }
  }

  // ---------- items ----------
  grantItem(m: Marble, item: ItemType): boolean {
    if (m.inventory[item] >= MAX_ITEM_STACK) {
      if (m.info.isPlayer) this.onEvent?.(`${ITEM_INFO[item].name} storage full (${MAX_ITEM_STACK})`, '#a4b7c8');
      return false;
    }
    m.inventory[item]++;
    m.lastPickupAt = this.time;
    m.aiUseAt = this.time + 800 + this.rng() * 1800;
    if (m.info.isPlayer) {
      this.onInventoryChange?.({ ...m.inventory });
      this.onEvent?.(`+1 ${ITEM_INFO[item].name} / added to your loadout`, ITEM_INFO[item].color);
    }
    return true;
  }

  itemRemaining(m: Marble, item: ItemType): number {
    const end = { rocket: m.rocketUntil, jump: m.jumpUntil, aero: m.aeroUntil, anvil: m.anvilUntil, ghost: m.ghostUntil, oil: 0, shock: 0, freeze: 0 }[item];
    return Math.max(0, end - this.time);
  }

  availableItem(m: Marble = this.player): ItemType | undefined {
    return ITEM_TYPES.find((item) => m.inventory[item] > 0 && this.itemRemaining(m, item) === 0);
  }

  canUseItem(m: Marble, item: ItemType): boolean {
    return this.gateOpen && !m.frozen && m.finishedAt === null && m.inventory[item] > 0 && this.time >= m.itemCooldownUntil && this.itemRemaining(m, item) === 0;
  }

  speedLimit(m: Marble): number {
    return Math.min(32, m.maxSpeed + (this.time < m.rocketUntil ? 8 : 0) + (this.time < m.anvilUntil ? 4 : 0) + (this.time < m.aeroUntil ? 3 : 0));
  }

  usePlayerItem(item = this.availableItem()): boolean {
    return item ? this.useItem(this.player, item) : false;
  }

  useItem(m: Marble, item = this.availableItem(m)): boolean {
    if (!item || !this.canUseItem(m, item)) return false;
    const p = m.body.position;
    const freezeTarget = item === 'freeze' ? this.marbles
      .filter((rival) => rival !== m && rival.finishedAt === null && !rival.frozen && rival.body.position.y > p.y - 20 && Math.hypot(rival.body.position.x - p.x, rival.body.position.y - p.y) < 900)
      .sort((a, b) => Math.hypot(a.body.position.x - p.x, a.body.position.y - p.y) - Math.hypot(b.body.position.x - p.x, b.body.position.y - p.y))[0] : undefined;
    if (item === 'freeze' && !freezeTarget) {
      if (m.info.isPlayer) this.onEvent?.('No rival in range / freeze charge kept', '#7dd3fc');
      else m.aiUseAt = this.time + 1500;
      return false;
    }
    m.inventory[item]--;
    m.itemCooldownUntil = this.time + 450;
    this.sfx('item', m, p.x, p.y);
    switch (item) {
      case 'oil': {
        this.oils.push({ x: p.x, y: p.y - 10, r: 48, ownerId: m.info.id, expiresAt: this.time + 9000 });
        break;
      }
      case 'freeze': {
        const target = freezeTarget;
        if (target) {
          target.frozenUntil = this.time + 2500;
          this.setFrozen(target, true);
          this.effects.push({ type: 'beam', x: p.x, y: p.y, x2: target.body.position.x, y2: target.body.position.y, ttl: 20, maxTtl: 20, color: '#7dd3fc' });
          this.effects.push({ type: 'snow', x: target.body.position.x, y: target.body.position.y, ttl: 40, maxTtl: 40, color: '#bae6fd', particles: this.makeParticles(target.body.position.x, target.body.position.y, 12, 2) });
          if (target.info.isPlayer) this.onEvent?.(`${m.info.name} froze you!`, '#7dd3fc');
          if (m.info.isPlayer) this.onEvent?.(`Froze ${target.info.name}!`, '#7dd3fc');
        }
        break;
      }
      case 'rocket': {
        m.rocketUntil = this.time + ITEM_INFO.rocket.duration;
        break;
      }
      case 'jump': {
        const v = Body.getVelocity(m.body);
        Body.setVelocity(m.body, { x: v.x, y: -11.5 - m.info.stats.bounce * 0.12 });
        m.jumpUntil = this.time + ITEM_INFO.jump.duration;
        this.effects.push({ type: 'ring', x: p.x, y: p.y + MARBLE_RADIUS, ttl: 22, maxTtl: 22, color: ITEM_INFO.jump.color });
        break;
      }
      case 'aero': {
        m.aeroUntil = this.time + ITEM_INFO.aero.duration;
        m.body.frictionAir = m.frictionAir * 0.05;
        m.body.friction = 0;
        this.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 24, maxTtl: 24, color: ITEM_INFO.aero.color });
        break;
      }
      case 'shock': {
        this.shake = 8;
        this.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 30, maxTtl: 30, color: '#facc15' });
        for (const o of this.marbles) {
          if (o === m || o.finishedAt !== null) continue;
          const dx = o.body.position.x - p.x;
          const dy = o.body.position.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < 240 && d > 0.01) {
            this.setFrozen(o, false);
            const k = 11 * (1 - d / 240) / Math.sqrt(o.body.mass / 0.8);
            const v = Body.getVelocity(o.body);
            Body.setVelocity(o.body, { x: v.x + (dx / d) * k, y: v.y + (dy / d) * k - 2 });
          }
        }
        break;
      }
      case 'anvil': {
        m.anvilUntil = this.time + ITEM_INFO.anvil.duration;
        if (!m.frozen) Body.setDensity(m.body, m.baseDensity * 3);
        this.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 20, maxTtl: 20, color: '#cbd5e1' });
        break;
      }
      case 'ghost': {
        m.ghostUntil = this.time + ITEM_INFO.ghost.duration;
        this.applyMask(m);
        break;
      }
    }
    if (m.info.isPlayer) {
      this.onInventoryChange?.({ ...m.inventory });
      if (item !== 'freeze') this.onEvent?.(`${ITEM_INFO[item].name} deployed`, ITEM_INFO[item].color);
    }
    return true;
  }

  // ---------- main step ----------
  /** Advance the simulation by one fixed sub-step (dt in ms). */
  step(dt: number) {
    const s = dt / TICK; // fraction of a 60fps tick
    this.time += dt;
    if (!this.gateOpen) return;
    this.syncTrack();

    // item boxes respawn
    for (const box of this.track.itemBoxes) {
      const md = meta(box);
      if (!md.active && this.time >= (md.respawnAt ?? 0)) md.active = true;
    }
    // spinners
    for (const sp of this.track.spinners) {
      const md = meta(sp);
      (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(sp, sp.angle + (md.spin ?? 0) * s, true);
    }
    // wrecking balls swing on their chains (kinematic, so collisions see their velocity)
    for (const wb of this.track.wreckers) {
      const md = meta(wb);
      const angle = (md.amp ?? 0) * Math.sin(this.time * (md.spin ?? 0) + (md.phase ?? 0));
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(wb, { x: md.pivot!.x + Math.sin(angle) * md.chain!, y: md.pivot!.y + Math.cos(angle) * md.chain! }, true);
    }
    // oil expiry
    this.oils = this.oils.filter((o) => o.expiresAt > this.time);

    // Peggle buckets sweep side to side
    for (const bk of this.track.buckets) {
      const md = meta(bk);
      const x = W / 2 + Math.sin(this.time * 0.0011 + (md.phase ?? 0)) * (W / 2 - 90);
      Body.setPosition(bk, { x, y: md.baseY ?? bk.position.y });
    }
    // hit pegs pop away after a short glow
    for (const body of this.poppingPegs) {
      const md = meta(body);
      if (this.time > (md.hitAt ?? 0) + 150) {
        this.removeTrackBody(body);
        this.poppingPegs.delete(body);
        this.effects.push({ type: 'ring', x: body.position.x, y: body.position.y, ttl: 10, maxTtl: 10, color: 'rgba(255,255,255,0.6)' });
      }
    }

    for (const m of this.marbles) {
      const b = m.body;
      m.grounded += s;
      if (m.finishedAt !== null) continue;

      // timers
      if (m.aeroUntil && this.time >= m.aeroUntil) {
        m.aeroUntil = 0;
        b.frictionAir = m.frictionAir;
        if (!m.frozen) b.friction = 0.004;
      }
      if (m.anvilUntil && this.time > m.anvilUntil) {
        m.anvilUntil = 0;
        if (!m.frozen) Body.setDensity(b, m.baseDensity);
      }
      if (m.ghostUntil && this.time > m.ghostUntil) {
        m.ghostUntil = 0;
        this.applyMask(m);
      }

      if (m.frozen) {
        if (this.time >= m.frozenUntil) this.setFrozen(m, false);
        else {
          this.updateRecovery(m, dt);
          continue;
        }
      }

      if (!this.gateOpen) continue;

      let v = Body.getVelocity(b);

      // rocket
      if (this.time < m.rocketUntil) {
        const sp = Math.hypot(v.x, v.y);
        const dx = sp > 1 ? v.x / sp : 0;
        const dy = sp > 1 ? v.y / sp : 1;
        const k = 0.6 * s * Math.sqrt(0.8 / b.mass);
        v = { x: v.x + dx * k * 0.6, y: v.y + Math.max(dy, 0.3) * k };
        if (this.rng() < 0.5)
          this.effects.push({ type: 'debris', x: b.position.x, y: b.position.y, ttl: 16, maxTtl: 16, color: '#fb923c', particles: this.makeParticles(b.position.x, b.position.y, 2, 2) });
      }

      // oil
      m.inOil = false;
      for (const o of this.oils) {
        if (o.ownerId === m.info.id) continue;
        if (Math.hypot(o.x - b.position.x, o.y - b.position.y) < o.r + MARBLE_RADIUS) {
          m.inOil = true;
          v = { x: v.x * (1 - 0.07 * s) + (this.rng() - 0.5) * 0.4, y: v.y * (1 - 0.05 * s) };
          Body.setAngularVelocity(b, b.angularVelocity * 1.05 + (this.rng() - 0.5) * 0.1);
          break;
        }
      }

      // player nudge
      if (m.info.isPlayer && this.nudge !== 0) {
        if (Math.abs(v.x) < 9 || Math.sign(v.x) !== Math.sign(this.nudge)) v = { x: v.x + this.nudge * 0.16 * s, y: v.y };
      }

      // speed cap
      const cap = this.speedLimit(m);
      const sp = Math.hypot(v.x, v.y);
      if (sp > cap) v = { x: (v.x / sp) * cap, y: (v.y / sp) * cap };
      Body.setVelocity(b, v);

      // trail
      if (m.info.isPlayer || this.time < m.rocketUntil) {
        m.trail.push({ x: b.position.x, y: b.position.y });
        if (m.trail.length > 14) m.trail.shift();
      }

      // AI item usage
      const item = this.availableItem(m);
      if (this.aiItemsEnabled && !m.info.isPlayer && item && this.time > m.aiUseAt) {
        // simple smarts: don't waste freeze if nobody ahead, save shock if nobody near
        if (item === 'freeze' && !this.marbles.some((o) => o !== m && o.finishedAt === null && o.body.position.y > b.position.y - 20 && Math.abs(o.body.position.y - b.position.y) < 900)) {
          m.aiUseAt = this.time + 1500;
        } else if (item === 'shock' && !this.marbles.some((o) => o !== m && Math.hypot(o.body.position.x - b.position.x, o.body.position.y - b.position.y) < 200)) {
          m.aiUseAt = this.time + 700;
        } else this.useItem(m);
      }
    }

    // effects
    for (const e of this.effects) {
      e.ttl -= s;
      if (e.particles)
        for (const p of e.particles) {
          p.x += p.vx * s;
          p.y += p.vy * s;
          p.vy += 0.15 * s;
        }
    }
    this.effects = this.effects.filter((e) => e.ttl > 0);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - s);

    this.supports.clear();
    Engine.update(this.engine, dt);

    for (const m of this.marbles) {
      if (m.finishedAt !== null) {
        if (!m.body.isSensor) {
          Composite.remove(this.world, m.body);
          m.body.isSensor = true;
          Body.setPosition(m.body, { x: 80 + (m.info.id % 10) * 80, y: this.track.finishY + 75 });
          Body.setVelocity(m.body, { x: 0, y: 0 });
          Body.setAngularVelocity(m.body, 0);
        }
        continue;
      }
      if (m.frozen) continue;
      const surface = this.supports.get(m.info.id);
      if (surface && !m.inOil && assistRolling(m.body, surface, m.info.stats.speed + (this.time < m.aeroUntil ? 3 : 0), dt)) m.grounded = 0;
      const launch = this.pendingLaunches.get(m.info.id);
      if (launch) Body.setVelocity(m.body, launch);
      const cap = this.speedLimit(m);
      if (Body.getSpeed(m.body) > cap) Body.setSpeed(m.body, cap);
      if (m.body.position.y >= this.track.finishY && m.body.position.x >= 0 && m.body.position.x <= W) this.finishMarble(m);
      this.updateRecovery(m, dt);
    }
    this.pendingLaunches.clear();
    if (!this.effectsEnabled) this.effects = [];

    // apply deferred wall breaks after the solver ran
    if (this.pendingBreaks.length) {
      for (const pb of this.pendingBreaks) {
        this.removeTrackBody(pb.body);
        Body.setVelocity(pb.marble.body, pb.v);
      }
      this.pendingBreaks = [];
    }
  }

  ranking(): RankEntry[] {
    const finished = [...this.finishOrder];
    const rest = this.marbles.filter((m) => m.finishedAt === null).sort((a, b) => b.body.position.y - a.body.position.y);
    return [...finished, ...rest].map((m, i) => ({ marble: m, rank: i + 1, finished: m.finishedAt !== null, time: m.finishedAt }));
  }

  /** Force-classify anyone still on track (used when the heat timer expires). */
  classify(): RankEntry[] {
    return this.ranking();
  }

  raceTime(): number {
    return this.gateOpen ? this.time - this.raceStartTime : 0;
  }

  playerRank(): number {
    return this.ranking().find((r) => r.marble === this.player)!.rank;
  }

  allFinished(): boolean {
    return this.marbles.every((m) => m.finishedAt !== null);
  }

  destroy() {
    Events.off(this.engine, 'collisionStart');
    Events.off(this.engine, 'collisionActive');
    Composite.clear(this.world, false);
    Engine.clear(this.engine);
  }
}
