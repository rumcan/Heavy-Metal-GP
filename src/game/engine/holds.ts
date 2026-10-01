// Rides that hold a marble: cannons, catapults, and the release at the end of any hold.
// Split out of engine.ts (P2-00a). Every function takes the Game as `game`; Game's methods delegate here.
import Matter from 'matter-js';
import { meta, cannonAim } from '../track';










import { Game, Body, MACHINE_HOLD_MS, Marble } from '../engine';


export function tryLoadCannon(game: Game, m: Marble, mouth: Matter.Body) {
  const md = meta(mouth);
  if (m.hold || m.frozen || m.finishedAt !== null || !md.cannon || md.cannon.loaded || game.time < m.tunnelSafeUntil) return;
  if (Math.hypot(m.body.position.x - mouth.position.x, m.body.position.y - mouth.position.y) > 52) return;
  const cn = md.cannon;
  // seeded wait, then the shot: AIs take their time; the player pulls the trigger early (step()).
  const fireAt = game.time + cn.autoMs + game.rng() * 500;
  cn.loaded = { seat: m.info.id, at: game.time, fireAt };
  m.hold = { kind: 'cannon', until: fireAt, at: game.time, body: mouth, transit: 0 };
  m.body.isSensor = true;
  Body.setPosition(m.body, { x: mouth.position.x, y: mouth.position.y });
  Body.setVelocity(m.body, { x: 0, y: 0 });
  Body.setAngularVelocity(m.body, 0);
  m.trail = [];
  game.sfx('clang', m, mouth.position.x, mouth.position.y);
  game.emit({ kind: 'sound', cue: 'crate' });
  game.emit({ kind: 'hold', seat: m.info.id, until: fireAt, of: 'cannon' });
}

export function tryLoadCatapult(game: Game, m: Marble, spoon: Matter.Body) {
  const md = meta(spoon);
  if (m.hold || m.frozen || m.finishedAt !== null || !md.catapult || md.catapult.loadedAt !== null || game.time < m.tunnelSafeUntil) return;
  if (Math.hypot(m.body.position.x - spoon.position.x, m.body.position.y - spoon.position.y) > 46) return;
  const ct = md.catapult;
  ct.loadedAt = game.time;
  ct.firedAt = null;
  const until = game.time + ct.reloadMs + ct.swingMs;
  m.hold = { kind: 'catapult', until, at: game.time, body: spoon, transit: 0 };
  m.body.isSensor = true;
  Body.setPosition(m.body, { x: ct.px + Math.cos(ct.restA) * ct.len, y: ct.py + Math.sin(ct.restA) * ct.len });
  Body.setVelocity(m.body, { x: 0, y: 0 });
  Body.setAngularVelocity(m.body, 0);
  m.trail = [];
  game.sfx('bucket', m, spoon.position.x, spoon.position.y);
  game.emit({ kind: 'sound', cue: 'bucket' });
  game.emit({ kind: 'hold', seat: m.info.id, until, of: 'catapult' });
}

export function releaseHold(game: Game, m: Marble) {
  const hold = m.hold;
  m.hold = null;
  if (!hold) return;
  let exit: { x: number; y: number; dir: { x: number; y: number }; speed: number };
  let safe = 900;
  if (hold.kind === 'wheel' && hold.arc) {
    // MB-10C: wherever the bucket is at release time, the marble drops off moving with the wheel
    const a = hold.arc.omega * (game.time - (hold.at ?? game.time)) + hold.arc.fromA;
    const px = hold.arc.x + Math.cos(a) * hold.arc.r;
    const py = hold.arc.y + Math.sin(a) * hold.arc.r;
    const sense = Math.sign(hold.arc.omega) || 1;
    exit = { x: px, y: py, dir: { x: -Math.sin(a) * sense, y: Math.cos(a) * sense }, speed: Math.max(2.6, Math.abs(hold.arc.omega) * hold.arc.r * 16.667 + 0.8) };
    safe = 1100;
  } else if (hold.kind === 'cannon') {
    // MB-10D: the barrel fires along wherever the aim fan is AT game clock — guests don't need
    // the shot because their copy glides positions from the frames; `until` was the contract.
    const md = hold.body ? meta(hold.body) : null;
    const mo = md?.motion, cn = md?.cannon;
    if (mo?.mode !== 'aim' || !cn) return;
    const a = cannonAim(mo, game.time);
    // weight stats 1..10 → heavy flies shorter (issue rule)
    const massF = 1.35 - (m.info.stats.weight ?? 5) * 0.05;
    const sp = Math.max(3.5, cn.power * massF);
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const mx = mo.pivot.x + dir.x * (cn.len + 16), my = mo.pivot.y + dir.y * (cn.len + 16);
    exit = { x: mx, y: my, dir, speed: sp };
    safe = 850;
    cn.loaded = null;
    cn.lastFiredAt = game.time;
    game.sfx('bang', m, mx, my);
    game.emit({ kind: 'sound', cue: 'bang' });
    game.effects.push({ type: 'debris', x: mx, y: my, ttl: 22, maxTtl: 22, color: '#fcd34d', particles: game.makeParticles(mx, my, 10, 3.2) });
    game.shake = Math.max(game.shake, 6);
  } else if (hold.kind === 'catapult') {
    // MB-10D: the arm whips to the release angle; the rider leaves with the arm-tip velocity,
    // taxed by weight (bouncy marbles gain a little height on the way out).
    const md = hold.body ? meta(hold.body) : null;
    const ct = md?.catapult;
    if (!ct) return;
    const vTip = (Math.abs(ct.releaseA - ct.restA) / ct.swingMs) * ct.len * 16.667;
    const massF = 1.3 - (m.info.stats.weight ?? 5) * 0.045;
    const lift = 1 + ((m.info.stats.bounce ?? 5) - 5) * 0.03;
    // clamped into the speed-cap neighbourhood so the arc the launch draws survives the cap
    const sp = Math.max(8, Math.min(13, vTip * 0.28 * massF)) * Math.max(0.85, Math.min(1.15, lift));
    const a = ct.releaseA;
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const mx = ct.px + dir.x * (ct.len + 10), my = ct.py + dir.y * (ct.len + 10);
    exit = { x: mx, y: my, dir, speed: sp };
    safe = 850;
    ct.loadedAt = null;
    ct.firedAt = game.time;
    ct.lastFiredAt = game.time;
    game.sfx('boing', m, mx, my);
    game.emit({ kind: 'sound', cue: 'boing' });
    game.effects.push({ type: 'ring', x: mx, y: my, ttl: 14, maxTtl: 14, color: '#fda4af' });
  } else {
    if (!hold.exit) return;
    exit = hold.exit;
    if (hold.kind === 'screw') safe = 800;
    if (hold.kind === 'loop') safe = 700;
  }
  m.body.isSensor = false;
  Body.setPosition(m.body, { x: exit.x, y: exit.y });
  Body.setVelocity(m.body, { x: exit.dir.x * exit.speed, y: exit.dir.y * exit.speed });
  Body.setAngularVelocity(m.body, 0);
  m.tunnelSafeUntil = game.time + safe;
  m.motionAnchor = { ...m.body.position };
  m.motionAt = m.depthAt = game.time;
  m.deepestY = m.body.position.y;
  m.machineHeld = MACHINE_HOLD_MS;
  if (hold.kind === 'tunnel') {
    game.sfx('rumble', m, exit.x, exit.y);
    game.effects.push({ type: 'snow', x: exit.x, y: exit.y, ttl: 26, maxTtl: 26, color: '#b8a88f', particles: game.makeParticles(exit.x, exit.y, 8, 2.5) });
  } else if (hold.kind === 'wheel') {
    game.sfx('splash', m, exit.x, exit.y);
    game.effects.push({ type: 'ring', x: exit.x, y: exit.y, ttl: 16, maxTtl: 16, color: '#7dd3fc' });
  }
}
