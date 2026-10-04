// Leaves on the wind over a platformer race, the same drifting autumn leaves as Infinity mode (InfinityPainter). Screen
// space, three depths, blown by a slow gusty wind and carried by the camera (nearer leaves slide past faster). A fixed
// pool: nothing is allocated in the frame loop. Pure decoration: drawn after the world, never touches the race.

interface Leaf { x: number; y: number; z: number; vx: number; vy: number; size: number; phase: number; spin: number }

/** Leaves on a 1280x720 screen; scaled with the screen's area and cut back on a slow frame or with Reduce motion. */
const BASE = 46;

export class WindLeaves {
  private leaves: Leaf[] = [];
  private lastCam: { x: number; y: number } | null = null;
  private t = 0;
  private seed = 0x1eaf;

  private rand(): number {
    this.seed = (Math.imul(this.seed ^ (this.seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return this.seed / 0x100000000;
  }

  private reset(l: Leaf, w: number, h: number, anywhere: boolean, fromRight: boolean): void {
    l.z = [0.4, 0.75, 1.15][Math.floor(this.rand() * 3)];
    l.vx = -0.8 - this.rand() * 1.0;
    l.vy = 0.35 + this.rand() * 0.5;
    l.size = (3 + this.rand() * 3) * l.z;
    l.phase = this.rand() * Math.PI * 2;
    l.spin = (this.rand() - 0.5) * 0.08;
    if (anywhere) { l.x = this.rand() * w; l.y = this.rand() * h; return; }
    if (this.rand() < 0.6) { l.x = this.rand() * w; l.y = -20; } else { l.x = fromRight ? w + 20 : -20; l.y = this.rand() * h * 0.8; }
  }

  /** Draws the leaves over the frame. `camera` is the race camera (world units, scale), `dtMs` the frame time. */
  paint(ctx: CanvasRenderingContext2D, camera: { x: number; y: number; scale: number }, w: number, h: number, dtMs: number, reduceMotion = false): void {
    if (w < 1 || h < 1) return;
    const want = Math.round(BASE * Math.min(2, (w * h) / (1280 * 720)) * (reduceMotion ? 0.25 : 1) * (dtMs > 24 ? 0.5 : 1));
    while (this.leaves.length < want) { const l = { x: 0, y: 0, z: 1, vx: 0, vy: 0, size: 1, phase: 0, spin: 0 }; this.reset(l, w, h, true, true); this.leaves.push(l); }
    if (this.leaves.length > want) this.leaves.length = want;
    // the camera's movement this frame, in screen pixels (a big jump is a respawn or a restart: ignore it)
    let camDx = 0, camDy = 0;
    if (this.lastCam) {
      camDx = (camera.x - this.lastCam.x) * camera.scale;
      camDy = (camera.y - this.lastCam.y) * camera.scale;
      if (Math.abs(camDx) > 300 || Math.abs(camDy) > 300) { camDx = 0; camDy = 0; }
    }
    this.lastCam = { x: camera.x, y: camera.y };
    const dt = Math.min(50, dtMs);
    this.t += dt;
    const slow = reduceMotion ? 0.35 : 1;
    const wind = Math.sin(this.t / 7000) * 0.5 + 0.6;
    ctx.save();
    ctx.setTransform(ctx.getTransform().a, 0, 0, ctx.getTransform().d, 0, 0);
    for (const l of this.leaves) {
      l.x += (l.vx * wind * slow * dt) / 16 - camDx * l.z;
      l.y += (l.vy * slow * dt) / 16 - camDy * l.z * 0.6;
      l.phase += (l.spin * slow * dt) / 16;
      if (l.x < -40 || l.x > w + 40 || l.y < -40 || l.y > h + 40) this.reset(l, w, h, false, camDx >= 0);
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.phase);
      ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(l.phase * 1.7)));
      ctx.fillStyle = `rgba(${200 + Math.round(l.z * 40)},${90 + Math.round(l.z * 50)},30,0.85)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, l.size, l.size * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
