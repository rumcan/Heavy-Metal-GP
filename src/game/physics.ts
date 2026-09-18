import Matter from 'matter-js';
import { MARBLE_RADIUS, statsToPhysics } from './types';
import type { MarbleInfo } from './types';

export const PHYSICS_STEP = 1000 / 120;
export const BASE_TICK = 1000 / 60;
export const HEAT_TIME_LIMIT = 540000;

export interface RampSurface {
  start: Matter.Vector;
  end: Matter.Vector;
  tangent: Matter.Vector;
  normal: Matter.Vector;
  length: number;
}

export function rampSurface(a: Matter.Vector, b: Matter.Vector): RampSurface {
  const [start, end] = a.x <= b.x ? [a, b] : [b, a];
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  return { start, end, length, tangent, normal: { x: tangent.y, y: -tangent.x } };
}

export function downhill(surface: RampSurface): Matter.Vector {
  const direction = surface.tangent.y < 0 ? -1 : 1;
  return { x: surface.tangent.x * direction, y: surface.tangent.y * direction };
}

export function createMarble(info: MarbleInfo, position: Matter.Vector): Matter.Body {
  const props = statsToPhysics(info.stats);
  // Bodies.circle uses only 14 sides at this radius. A 48-gon removes the flat spots.
  const body = Matter.Bodies.polygon(position.x, position.y, 48, MARBLE_RADIUS, {
    density: props.density,
    restitution: props.restitution,
    friction: 0.004,
    frictionStatic: 0,
    frictionAir: props.frictionAir,
    slop: 0.025,
    label: 'marble',
    // wall | marble | sensor | loop-up | fragile (MB-10A barricades — Ghost drops the bit at runtime)
    collisionFilter: { category: 0x0002, mask: 0x0001 | 0x0002 | 0x0004 | 0x0008 | 0x0020, group: 0 },
    plugin: { kind: 'marble', id: info.id },
  });
  Matter.Body.setMass(body, props.mass);
  Matter.Body.setInertia(body, 0.4 * props.mass * MARBLE_RADIUS ** 2);
  return body;
}

/** Gameplay assistance on supported slopes only; free-fall remains entirely gravity-driven. */
export function assistRolling(body: Matter.Body, surface: RampSurface, speedStat: number, dt: number): boolean {
  const relative = { x: body.position.x - surface.start.x, y: body.position.y - surface.start.y };
  const distance = relative.x * surface.normal.x + relative.y * surface.normal.y;
  const along = relative.x * surface.tangent.x + relative.y * surface.tangent.y;
  if (distance < 0 || distance > MARBLE_RADIUS + 2.5 || along < -3 || along > surface.length + 3) return false;

  const velocity = Matter.Body.getVelocity(body);
  const separating = velocity.x * surface.normal.x + velocity.y * surface.normal.y;
  if (separating > 1.2) return false;
  const direction = downhill(surface);
  const slope = direction.y;
  const speed = velocity.x * direction.x + velocity.y * direction.y;
  const target = 6.5 + speedStat * 0.55 + Math.min(slope, 0.3) * 10;
  if (slope > 0.002 && speed < target) {
    const acceleration = (0.085 + slope * 0.9) * (0.9 + speedStat * 0.02);
    const gain = Math.min(target - speed, acceleration * dt / BASE_TICK);
    Matter.Body.setVelocity(body, { x: velocity.x + direction.x * gain, y: velocity.y + direction.y * gain });
  }
  const v = Matter.Body.getVelocity(body);
  const rollingSpin = (v.x * surface.tangent.x + v.y * surface.tangent.y) / MARBLE_RADIUS;
  const blend = 1 - Math.exp(-dt / 90);
  Matter.Body.setAngularVelocity(body, body.angularVelocity + (rollingSpin - body.angularVelocity) * blend);
  return true;
}

export function formatTime(ms: number): string {
  const centiseconds = Math.max(0, Math.floor(ms / 10));
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor(centiseconds / 100) % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
}