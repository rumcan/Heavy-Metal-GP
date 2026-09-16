import * as storage from './storage';

/**
 * Procedural race sound effects (Web Audio, no files). The engine queues SoundEvents; the race screen hands them here
 * with the camera so the player's own marble is loud and rivals are quieter, only when on screen.
 */

export type SoundType =
  | 'peg' | 'bump' | 'thud' | 'clack' | 'spring' | 'hoop' | 'clang' | 'crack' | 'smash'
  | 'pickup' | 'bucket' | 'loop' | 'finish' | 'item' | 'go' | 'light';

export interface SoundEvent {
  type: SoundType;
  x: number;
  y: number;
  player: boolean;
  color?: 'blue' | 'orange' | 'green';
  rank?: number;
}

export interface Listener { x: number; y: number; halfHeight: number }

const MUTE_KEY = 'heavy-metal-gp:muted';
// Peggle-style rising run: a major scale that keeps climbing while the streak lasts
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const STREAK_WINDOW = 1600;
const MIN_GAP: Partial<Record<SoundType, number>> = { peg: 25, bump: 60, thud: 90, clack: 70, crack: 90, clang: 80, hoop: 80, spring: 120 };

class RaceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();
  private streak = 0;
  private streakAt = 0;
  muted = false;

  /** Read the saved mute preference (storage is preloaded at boot, so call this after startup, not at import). */
  loadPreference() {
    this.muted = storage.getItem(MUTE_KEY) === '1';
    if (this.master && this.ctx) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }

  /** Create or resume the audio context; call from a user gesture (browsers block audio before one). */
  unlock() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(comp);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    storage.setItem(MUTE_KEY, muted ? '1' : '0');
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  play(e: SoundEvent, listener: Listener) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    // rivals are quieter and only audible near the camera
    let vol = 1;
    if (!e.player) {
      const d = Math.abs(e.y - listener.y) / Math.max(200, listener.halfHeight * 1.1);
      if (d >= 1) return;
      vol = 0.28 * (1 - d * 0.7);
    }
    const key = `${e.type}:${e.player ? 'p' : 'r'}`;
    const nowMs = ctx.currentTime * 1000;
    const gap = MIN_GAP[e.type] ?? 0;
    if (gap && nowMs - (this.last.get(key) ?? -1e9) < (e.player ? gap : gap * 2.5)) return;
    this.last.set(key, nowMs);
    const pan = Math.max(-0.8, Math.min(0.8, (e.x - 450) / 560));
    const t = ctx.currentTime + 0.005;
    switch (e.type) {
      case 'peg': return this.peg(e, t, vol, pan);
      case 'bump': return this.tone(t, 330, 0.12, 'sine', 0.5 * vol, pan, 140);
      case 'thud': return this.noiseHit(t, 0.07, 500, 0.22 * vol, pan, 'lowpass');
      case 'clack': return this.tone(t, 1900 + Math.random() * 500, 0.05, 'triangle', 0.18 * vol, pan);
      case 'spring': return this.spring(t, vol, pan, e.player);
      case 'hoop': return this.whoosh(t, 0.45, 350, 2600, 0.55 * vol, pan);
      case 'clang': return this.clang(t, vol, pan);
      case 'crack': return this.noiseHit(t, 0.09, 900, 0.35 * vol, pan, 'bandpass');
      case 'smash': this.noiseHit(t, 0.4, 700, 0.8 * vol, pan, 'lowpass'); return this.tone(t, 90, 0.35, 'sine', 0.6 * vol, pan, 40);
      case 'pickup': return this.arp(t, [72, 76, 79, 84], 0.06, 'triangle', 0.35 * vol, pan);
      case 'bucket': return this.arp(t, [60, 64, 67, 72, 76, 79, 84], 0.05, 'square', 0.18 * vol, pan);
      case 'loop': return this.whoosh(t, 0.7, 200, 1400, 0.4 * vol, pan);
      case 'item': this.whoosh(t, 0.25, 900, 3000, 0.35 * vol, pan); return this.tone(t, 520, 0.18, 'sawtooth', 0.12 * vol, pan, 1040);
      case 'light': return this.tone(t, 440, 0.16, 'square', 0.22, 0);
      case 'go': return this.tone(t, 880, 0.45, 'square', 0.28, 0);
      case 'finish': return this.finish(t, e.rank ?? 10);
    }
  }

  private out(pan: number): AudioNode {
    const ctx = this.ctx!;
    if (!ctx.createStereoPanner || !pan) return this.master!;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master!);
    return p;
  }

  private env(t: number, dur: number, vol: number, dest: AudioNode, attack = 0.004) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(dest);
    return g;
  }

  private tone(t: number, freq: number, dur: number, type: OscillatorType, vol: number, pan: number, slideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    o.connect(this.env(t, dur, vol, this.out(pan)));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseHit(t: number, dur: number, freq: number, vol: number, pan: number, type: BiquadFilterType) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f);
    f.connect(this.env(t, dur, vol, this.out(pan), 0.002));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private whoosh(t: number, dur: number, from: number, to: number, vol: number, pan: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur * 0.6);
    src.connect(f);
    f.connect(this.env(t, dur, vol, this.out(pan), dur * 0.3));
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private arp(t: number, notes: number[], step: number, type: OscillatorType, vol: number, pan: number) {
    notes.forEach((n, i) => this.tone(t + i * step, midi(n), step * 2.2, type, vol, pan));
  }

  /** Bell-like peg hit; the player's streak climbs the scale like Peggle. */
  private peg(e: SoundEvent, t: number, vol: number, pan: number) {
    let note: number;
    if (e.player) {
      const now = this.ctx!.currentTime * 1000;
      this.streak = now - this.streakAt < STREAK_WINDOW ? this.streak + 1 : 0;
      this.streakAt = now;
      const s = Math.min(this.streak, 20);
      note = 64 + SCALE[s % 7] + 12 * Math.floor(s / 7);
    } else note = 72 + SCALE[Math.floor(Math.random() * 7)];
    const f = midi(note);
    const bright = e.color === 'orange' ? 1.25 : 1;
    this.tone(t, f, 0.32, 'sine', 0.42 * vol * bright, pan);
    this.tone(t, f * 2.01, 0.14, 'triangle', 0.12 * vol * bright, pan);
    if (e.color === 'green') this.arp(t + 0.05, [note + 12, note + 16, note + 19], 0.045, 'triangle', 0.2 * vol, pan);
  }

  private spring(t: number, vol: number, pan: number, player: boolean) {
    const ctx = this.ctx!;
    // boing: a pitch sweep with wobble
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(620, t + 0.22);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const depth = ctx.createGain();
    depth.gain.value = 40;
    lfo.connect(depth);
    depth.connect(o.frequency);
    o.connect(this.env(t, 0.34, 0.5 * vol, this.out(pan)));
    o.start(t); lfo.start(t);
    o.stop(t + 0.36); lfo.stop(t + 0.36);
    if (player && Math.random() < 0.55) this.baa(t + 0.12, vol, pan);
  }

  /** A little sheep bleat: buzzy tone with vibrato through a vowel-ish filter. */
  private baa(t: number, vol: number, pan: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.linearRampToValueAtTime(360, t + 0.35);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const depth = ctx.createGain();
    depth.gain.value = 18;
    lfo.connect(depth);
    depth.connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100;
    f.Q.value = 2;
    o.connect(f);
    f.connect(this.env(t, 0.4, 0.22 * vol, this.out(pan), 0.03));
    o.start(t); lfo.start(t);
    o.stop(t + 0.42); lfo.stop(t + 0.42);
  }

  private clang(t: number, vol: number, pan: number) {
    for (const [ratio, gain] of [[1, 0.4], [2.76, 0.25], [5.4, 0.14], [8.93, 0.08]]) this.tone(t, 210 * ratio, 0.6 / ratio + 0.1, 'sine', gain * vol, pan);
    this.noiseHit(t, 0.05, 3000, 0.25 * vol, pan, 'highpass');
  }

  private finish(t: number, rank: number) {
    const win = rank === 1;
    const notes = win ? [60, 64, 67, 72, 67, 72, 76, 79, 84] : rank <= 3 ? [60, 64, 67, 72, 76] : [60, 64, 67];
    this.arp(t, notes, win ? 0.11 : 0.09, 'square', 0.16, 0);
    this.arp(t, notes.map((n) => n - 12), win ? 0.11 : 0.09, 'triangle', 0.2, 0);
    if (win) this.whoosh(t + notes.length * 0.11, 1.2, 800, 5000, 0.3, 0);
  }
}

function midi(n: number) {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export const raceAudio = new RaceAudio();
