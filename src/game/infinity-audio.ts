// P2-25: the sound of an Infinity run: a slow evolving pad, a few soft plucked notes picked from the biome's scale, a
// rolling sound that follows the ball's speed, and a quiet chime at every kilometre. Web Audio only, quiet by default,
// silent while muted (it follows the game's one mute setting). The note choices are pure functions (tested).
import { mulberry32 } from './types';

export const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** The pad's chord for step `step`: three notes of `scale` (degrees i, i+2, i+4) above `root`, voiced low. */
export function chordFor(step: number, scale: readonly number[], root: number, seed: number): number[] {
  const rng = mulberry32((seed ^ (step * 0x9e3779b1)) >>> 0);
  const degree = Math.floor(rng() * scale.length);
  const note = (d: number) => root - 12 + scale[d % scale.length] + 12 * Math.floor(d / scale.length);
  return [note(degree), note(degree + 2), note(degree + 4)];
}

/** The plucked note for pluck `n`: a scale note one or two octaves above the root. Never outside the scale. */
export function pluckFor(n: number, scale: readonly number[], root: number, seed: number): number {
  const rng = mulberry32((seed ^ (n * 0x85ebca6b) ^ 0x51ed) >>> 0);
  return root + 12 * (1 + Math.floor(rng() * 2)) + scale[Math.floor(rng() * scale.length)];
}

/** Seconds to wait before the next pluck: unhurried, between 1.4 and 4.6 s. */
export function pluckGap(n: number, seed: number): number {
  const rng = mulberry32((seed ^ (n * 0x27d4eb2d)) >>> 0);
  return 1.4 + rng() * 3.2;
}

/** The rolling sound's level (0..0.06) and band frequency for a ball speed (px per step). */
export function rollingFor(speed: number, grounded: boolean): { gain: number; freq: number } {
  const s = Math.max(0, speed);
  return { gain: grounded ? Math.min(0.06, s * 0.004) : 0, freq: 260 + Math.min(1400, s * 70) };
}

export const PAD_SECONDS = 9;
const MASTER = 0.55;

export class InfinityAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private padBus: GainNode | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private padStep = 0;
  private nextPad = 0;
  private pluckN = 0;
  private nextPluck = 0;
  private scale: readonly number[] = [0, 2, 4, 7, 9];
  private root = 60;
  private muted = false;

  constructor(private readonly seed: number) {}

  /** Start (call from a user gesture: browsers only allow audio after one). */
  start(): void {
    if (this.ctx || typeof window === 'undefined') return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER;
    this.master.connect(ctx.destination);
    // A soft room: a short feedback delay under everything.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.33;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(this.master);
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.5;
    this.padBus.connect(this.master);
    this.padBus.connect(delay);
    // Rolling: looped noise through a band-pass whose level follows the ball.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    const rng = mulberry32(this.seed ^ 0x7ab1e);
    for (let i = 0; i < data.length; i++) data[i] = (rng() * 2 - 1) * 0.6;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'bandpass';
    this.rollFilter.Q.value = 0.8;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    src.connect(this.rollFilter).connect(this.rollGain).connect(this.master);
    src.start();
    this.nextPad = ctx.currentTime + 0.1;
    this.nextPluck = ctx.currentTime + 2.5;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : MASTER, this.ctx.currentTime, 0.2);
  }

  /** The biome's music (it changes at the next chord, never mid-note). */
  setScale(scale: readonly number[], root: number): void {
    this.scale = scale;
    this.root = root;
  }

  /** Call every frame: schedules the pad and the plucks a little ahead, and moves the rolling sound with the ball. */
  update(speed: number, grounded: boolean, dark: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.padBus || ctx.state === 'closed') return;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    if (now + 0.5 > this.nextPad) { this.pad(this.nextPad, dark); this.nextPad += PAD_SECONDS; this.padStep++; }
    if (now + 0.5 > this.nextPluck) { this.pluck(this.nextPluck); this.nextPluck += pluckGap(this.pluckN, this.seed); this.pluckN++; }
    const roll = rollingFor(speed, grounded);
    this.rollGain?.gain.setTargetAtTime(roll.gain, now, 0.12);
    this.rollFilter?.frequency.setTargetAtTime(roll.freq, now, 0.15);
  }

  /** A quiet two-note bell. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || !this.padBus) return;
    const t = ctx.currentTime + 0.02;
    [0, 7].forEach((interval, i) => this.tone(midiToHz(this.root + 24 + interval), t + i * 0.18, 2.4, 0.07, 'sine'));
  }

  stop(): void {
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') void ctx.close();
  }

  private pad(at: number, dark: number): void {
    const notes = chordFor(this.padStep, this.scale, this.root, this.seed);
    for (const n of notes) this.tone(midiToHz(n), at, PAD_SECONDS + 3, 0.035 * (1 - dark * 0.3), 'triangle', 900 - dark * 400, 2.6);
  }

  private pluck(at: number): void {
    this.tone(midiToHz(pluckFor(this.pluckN, this.scale, this.root, this.seed)), at, 2.2, 0.045, 'triangle', 2400, 0.01);
  }

  /** One note: an oscillator through a low-pass with an attack and a long release. */
  private tone(freq: number, at: number, length: number, level: number, type: OscillatorType, cutoff = 3000, attack = 0.02): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(filter).connect(gain).connect(this.padBus!);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}
