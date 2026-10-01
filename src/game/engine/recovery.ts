// The race marshal: spotting a stuck marble and putting it back on track.
// Split out of engine.ts (P2-00a). Every function takes the Game as `game`; Game's methods delegate here.
import Matter from 'matter-js';
import { meta, W } from '../track';


import { MARBLE_RADIUS } from '../types';


import { createMarble, downhill } from '../physics';




import { Game, Bodies, Body, Composite, MACHINE_HOLD_MS, Marble, Query } from '../engine';


export function updateRecovery(game: Game, m: Marble, dt: number) {
  if (!game.recoveryEnabled || m.finishedAt !== null) return;
  // Deliberate item penalties pause the watchdog; recovery must not cancel a freeze or oil hit.
  if (m.frozen || m.inOil) {
    m.motionAt += dt;
    m.depthAt += dt;
    return;
  }
  const p = m.body.position;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < -MARBLE_RADIUS || p.x > W + MARBLE_RADIUS || p.y < -60) {
    game.recoverMarble(m);
    return;
  }
  if (Math.hypot(p.x - m.motionAnchor.x, p.y - m.motionAnchor.y) > 26) {
    m.motionAnchor = { ...p };
    m.motionAt = game.time;
  }
  if (p.y > m.deepestY + 16) {
    m.deepestY = p.y;
    m.depthAt = game.time;
    // New depth is the one thing that refills a machine's credit: the race is a descent, and
    // a marble that is genuinely deeper than it has ever been is not stuck, whatever carried
    // it there. Motion alone does not count — a crusher rides a marble down and back up.
    m.machineHeld = MACHINE_HOLD_MS;
  }
  // MB-10B: kinematic machines glide; they never prove the marble itself moved. A marble
  // pinned by a crusher or boxed in by a blade is stalling, not travelling — so contact
  // with a machine only HOLDS the watchdog, and only while the marble has credit left.
  // A machine that is genuinely carrying the marble refills the credit by moving it (above);
  // one that has it pinned spends the credit and then loses it.
  if (m.machineHeld > 0 && game.machineUnder(m)) {
    m.machineHeld -= dt;
    // Hold both clocks (a marble riding a machine is not stalling) and the anchor, so a
    // machine that only rocks the marble in place cannot buy itself a fresh 26-unit move.
    // `deepestY` is deliberately left alone: a crusher that carries a marble down and back
    // up again has made no depth, and it is depth — not motion — that refills the credit.
    m.motionAnchor = { ...p };
    m.motionAt = m.depthAt = game.time;
  }
  const stalled = game.time - m.motionAt;
  const noDescent = game.time - m.depthAt;
  m.stuckTime = Math.max(stalled, noDescent);
  if (game.time - m.lastRecoveryAt < 1800) return;

  if (stalled > 4700 || noDescent > 8500) {
    game.recoverMarble(m);
  } else if (stalled > 1300) {
    const surface = game.supports.get(m.info.id);
    const direction = surface ? downhill(surface).x : p.x < W / 2 ? 1 : -1;
    const v = Body.getVelocity(m.body);
    Body.setVelocity(m.body, { x: direction * (3.2 + (m.info.id % 3) * 0.4), y: Math.min(v.y, -2.8) });
    m.lastRecoveryAt = game.time;
    m.nudges++;
  }
}

export function machineUnder(game: Game, m: Marble): boolean  {
  if (!game.machines.length) return false;
  const bounds = m.body.bounds;
  for (const body of game.machines) {
    const md = meta(body);
    if (md.destroyed) continue;
    const b = body.bounds;
    if (bounds.min.x > b.max.x || bounds.max.x < b.min.x) continue;
    if (bounds.min.y > b.max.y || bounds.max.y < b.min.y) continue;
    return true;
  }
  return false;
}

export function recoverMarble(game: Game, m: Marble) {
  const p = m.body.position;
  const origin = {
    x: Number.isFinite(p.x) ? Math.max(35, Math.min(W - 35, p.x)) : W / 2,
    y: Number.isFinite(p.y) ? Math.max(game.track.startY, p.y) : m.deepestY,
  };
  // Kinematic machines still occupy their slice of track, but the marshal must not refuse a
  // spot just for touching one — they glide away on their own clock between frames.
  const blockers = [...game.track.bodies.filter((body) => !meta(body).destroyed && !meta(body).motion), ...game.marbles.map((marble) => marble.body)].filter((body) => body !== m.body && !body.isSensor);
  const probe = Bodies.circle(0, 0, MARBLE_RADIUS + 4);
  const direction = origin.x < W / 2 ? 1 : -1;
  let destination: Matter.Vector | undefined;
  // Move just below the local obstruction, never to the next checkpoint or past the finish.
  for (const dy of [60, 100, 140, 190, 240, 290]) {
    for (const dx of [0, 42, -42, 84, -84, 140, -140, 220, -220, 320, -320]) {
      const point = {
        x: Math.max(32, Math.min(W - 32, origin.x + dx * direction)),
        y: Math.min(game.track.finishY - 45, origin.y + dy),
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
    m.lastRecoveryAt = game.time;
    return;
  }
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || m.body.vertices.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y))) {
    Composite.remove(game.world, m.body);
    m.body = createMarble(m.info, destination);
    if (m.anvilUntil > game.time) Body.setDensity(m.body, m.baseDensity * 3);
    Composite.add(game.world, m.body);
  } else Body.setPosition(m.body, destination);
  m.loopStage = 0;
  game.applyMask(m);
  Body.setVelocity(m.body, { x: 0, y: 1 });
  Body.setAngularVelocity(m.body, 0);
  m.trail = [];
  m.motionAnchor = { ...destination };
  m.motionAt = m.depthAt = m.lastRecoveryAt = game.time;
  m.deepestY = destination.y;
  m.machineHeld = MACHINE_HOLD_MS; // a fresh start deserves a whole credit
  m.recoveryUntil = game.time + 1600;
  m.recoveries++;
  game.effects.push({ type: 'ring', ...destination, ttl: 30, maxTtl: 30, color: '#d63e2e' });
  if (m.info.isPlayer) game.onEvent?.('Race marshal: back on track', '#d63e2e');
  game.onRecover?.(m.info.id, { x: origin.x, y: origin.y });
}
