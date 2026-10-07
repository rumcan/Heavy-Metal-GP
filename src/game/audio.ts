import * as storage from './storage';
import { SampleBank } from './sound/bank';
import type { LoopVoice } from './sound/bank';
import type { ItemType } from './types';

/**
 * Procedural race sound effects (Web Audio, no files). The engine queues SoundEvents; the race screen hands them here
 * with the camera so the player's own marble is loud and rivals are quieter, only when on screen.
 */

export type SoundType =
  | 'peg' | 'bump' | 'thud' | 'clack' | 'spring' | 'hoop' | 'clang' | 'crack' | 'smash'
  | 'pickup' | 'bucket' | 'loop' | 'finish' | 'item' | 'go' | 'light'
  // MB-10A: shortcuts and secrets — the crowd, the rock, the hinge, the lever
  | 'cheer' | 'rumble' | 'creak' | 'click'
  // MB-10B: blades and crushers — the caught squeal, the bite, the dock
  | 'shriek' | 'grind' | 'slam'
  // MB-10C: movers — the bucket splash/dunk, the timber groan, the screw hum
  | 'splash' | 'groan' | 'whirr'
  // MB-10D: launchers — the cannon blast, the sling band, the flipper snap, the kickback spring
  | 'bang' | 'twang' | 'snap' | 'boing'
  // MB-10E: fields — the geyser hiss, the mud squelch, the magnet arc
  | 'steam' | 'gurgle' | 'zap'
  // MB-10F: set pieces — the turnstile crank, the target drop, the gate bonus, the funnel whoosh
  | 'crank' | 'ding' | 'bonus' | 'whoosh'
  // story mode UI: dialogue tick and chapter/act sting
  | 'blip' | 'sting'
  // the recorded sounds (sound/manifest.json): jumps and landings, lane hops, rings, the Tab pickup, damage and
  // knock-outs, the boost pad, the Magic Engine overheating, a wrecking ball's hit and a sticky bomb going off
  | 'jump' | 'land' | 'lane' | 'ring' | 'trial' | 'hit' | 'ko' | 'boost' | 'overheat' | 'wrecker' | 'bomb';

export interface SoundEvent {
  type: SoundType;
  x: number;
  y: number;
  player: boolean;
  color?: 'blue' | 'orange' | 'green';
  rank?: number;
  /** 'item': the skill used (each has its own recording). */
  item?: ItemType;
  /** 'land': how hard (vertical speed, px per step). */
  power?: number;
}

/**
 * The recordings behind the race sounds: a list of takes (one is picked at random), their level, and how much the
 * pitch may wander so a sound heard often never sounds like a loop. Anything not here (and any recording not loaded
 * yet) plays its synth recipe below.
 */
export const RECORDED: Partial<Record<SoundType, { ids: readonly string[]; vol: number; jitter?: number }>> = {
  light: { ids: ['race-beep'], vol: 0.7 },
  go: { ids: ['race-go'], vol: 0.8 },
  bang: { ids: ['cannon-1', 'cannon-2'], vol: 0.6, jitter: 0.06 },
  jump: { ids: ['jump-1', 'jump-2'], vol: 0.45, jitter: 0.08 },
  lane: { ids: ['lane-change'], vol: 0.5, jitter: 0.05 },
  spring: { ids: ['spring-sheep'], vol: 0.6, jitter: 0.05 },
  pickup: { ids: ['item-box'], vol: 0.55, jitter: 0.04 },
  trial: { ids: ['trial-pickup'], vol: 0.6 },
  ring: { ids: ['ring-1', 'ring-2'], vol: 0.4, jitter: 0.04 },
  smash: { ids: ['crate-smash-1', 'crate-smash-2'], vol: 0.6, jitter: 0.08 },
  clack: { ids: ['clack-1', 'clack-2'], vol: 0.35, jitter: 0.1 },
  hoop: { ids: ['fire-ring'], vol: 0.55, jitter: 0.05 },
  steam: { ids: ['geyser'], vol: 0.45 },
  loop: { ids: ['loop-whoosh'], vol: 0.55 },
  finish: { ids: ['finish-line'], vol: 0.7 },
  hit: { ids: ['hit-1', 'hit-2'], vol: 0.55, jitter: 0.06 },
  ko: { ids: ['ko-boom'], vol: 0.75 },
  boost: { ids: ['boost-pad'], vol: 0.45, jitter: 0.05 },
  overheat: { ids: ['engine-overheat'], vol: 0.55 },
  wrecker: { ids: ['wrecker-hit'], vol: 0.65, jitter: 0.05 },
  bomb: { ids: ['skill-bomb-boom'], vol: 0.7, jitter: 0.05 },
};

/** Sounds worth having decoded before the lights go out (the rest load the first time they are needed). */
export const PREWARM: readonly string[] = [
  'race-beep', 'race-go', 'cannon-1', 'cannon-2', 'jump-1', 'jump-2', 'land-soft', 'land-hard', 'roll-loop', 'wind-loop',
  'engine-loop', 'lane-change', 'item-box', 'trial-pickup', 'ring-1', 'ring-2', 'crate-smash-1', 'crate-smash-2', 'clack-1',
  'clack-2', 'finish-line', 'hit-1', 'hit-2', 'ui-click', 'ui-tab', 'ui-back', 'ui-open',
];

/** The menu and Workshop sounds: one recording each, played flat (no position). */
export type UiSound = 'click' | 'tab' | 'open' | 'back' | 'buy' | 'coin' | 'error' | 'unlock' | 'equip' | 'place' | 'delete' | 'snap' | 'undo';
export const UI_FILE: Record<UiSound, { id: string; vol: number }> = {
  click: { id: 'ui-click', vol: 0.35 }, tab: { id: 'ui-tab', vol: 0.35 }, open: { id: 'ui-open', vol: 0.35 }, back: { id: 'ui-back', vol: 0.35 },
  buy: { id: 'ui-buy', vol: 0.55 }, coin: { id: 'ui-coin', vol: 0.3 }, error: { id: 'ui-error', vol: 0.4 }, unlock: { id: 'ui-unlock', vol: 0.6 },
  equip: { id: 'ui-equip', vol: 0.45 }, place: { id: 'ws-place', vol: 0.45 }, delete: { id: 'ws-delete', vol: 0.45 }, snap: { id: 'ws-snap', vol: 0.4 },
  undo: { id: 'ws-undo', vol: 0.35 },
};

/** What the followed ball is doing this frame: drives the rolling, the wind and the Magic Engine loops. */
export interface DriveState {
  /** Speed in px per step. */
  speed: number;
  grounded: boolean;
  /** The Magic Engine is pushing. */
  engine: boolean;
  /** 0..1: how close a cheering crowd is (the finish straight, a goblin stand). */
  crowd?: number;
}

export interface Listener { x: number; y: number; halfHeight: number }

const MUTE_KEY = 'heavy-metal-gp:muted';
// Peggle-style rising run: a major scale that keeps climbing while the streak lasts
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const STREAK_WINDOW = 1600;
const MIN_GAP: Partial<Record<SoundType, number>> = { peg: 25, bump: 60, thud: 90, clack: 70, crack: 90, clang: 80, hoop: 80, spring: 120, blip: 26, cheer: 500, rumble: 250, creak: 200, click: 60, shriek: 220, grind: 180, slam: 320, splash: 200, groan: 300, whirr: 400, bang: 400, twang: 200, snap: 150, boing: 250, steam: 600, gurgle: 280, zap: 500, crank: 320, ding: 90, bonus: 900, whoosh: 420 };

class RaceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();
  private streak = 0;
  private streakAt = 0;
  muted = false;
  /** The recordings (sound/bank.ts): they play through the same master, so mute and the compressor cover them. */
  readonly bank = new SampleBank(() => this.ctx, () => this.master);
  private drive: { roll: LoopVoice; wind: LoopVoice; engine: LoopVoice; crowd: LoopVoice } | null = null;
  private amb: { id: string; voice: LoopVoice } | null = null;

  /** The context (null before the first gesture), for the music player's stingers. */
  get context(): AudioContext | null { return this.ctx; }

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
      this.bank.prewarm('sfx', PREWARM);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** A menu or Workshop sound (flat, no position). */
  ui(sound: UiSound) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const f = UI_FILE[sound];
    const nowMs = ctx.currentTime * 1000;
    if (nowMs - (this.last.get(`ui:${sound}`) ?? -1e9) < 45) return;
    this.last.set(`ui:${sound}`, nowMs);
    if (!this.bank.play('sfx', f.id, { vol: f.vol })) this.tone(ctx.currentTime + 0.005, 1150, 0.04, 'square', 0.1, 0, 760);
  }

  /**
   * Every frame of a race or an Infinity run, for the ball the camera follows: the rolling sound follows its speed on
   * the ground, the wind its speed (louder in the air), the engine loop runs while the Magic Engine pushes, and a crowd
   * swells near the finish. `null` (pausing) fades them all out.
   */
  setDrive(state: DriveState | null) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!state || this.muted) { if (this.drive) for (const v of Object.values(this.drive)) v.set(0); return; }
    this.drive ??= { roll: this.bank.loop('roll-loop'), wind: this.bank.loop('wind-loop'), engine: this.bank.loop('engine-loop'), crowd: this.bank.loop('crowd-loop') };
    const s = Math.max(0, state.speed);
    this.drive.roll.set(state.grounded ? Math.min(0.32, s * 0.022) : 0, 0.75 + Math.min(0.6, s * 0.03));
    this.drive.wind.set(Math.min(0.28, Math.max(0, s - 7) * (state.grounded ? 0.012 : 0.026)), 0.9 + Math.min(0.3, s * 0.012));
    this.drive.engine.set(state.engine ? 0.3 : 0, 0.9 + Math.min(0.35, s * 0.015));
    this.drive.crowd.set(Math.min(1, state.crowd ?? 0) * 0.35);
  }

  /** Stop the drive loops (the race is over or left). */
  stopDrive() {
    if (!this.drive) return;
    for (const v of Object.values(this.drive)) v.stop();
    this.drive = null;
  }

  /** A quiet ambience bed under the music (the forest by day, crickets by night, wind high up); null stops it. */
  setAmbience(id: 'amb-forest' | 'amb-night' | 'amb-sky' | null, level = 0.16) {
    if (!this.ctx) return;
    if (this.amb && this.amb.id !== id) { const old = this.amb.voice; old.set(0); setTimeout(() => old.stop(), 1500); this.amb = null; }
    if (!id) return;
    this.amb ??= { id, voice: this.bank.loop(id) };
    this.amb.voice.set(this.muted ? 0 : level);
  }

  private muteListeners = new Set<() => void>();
  /** Called whenever the mute changes (the radio follows it). */
  onMute(fn: () => void): () => void { this.muteListeners.add(fn); return () => { this.muteListeners.delete(fn); }; }

  setMuted(muted: boolean) {
    this.muted = muted;
    for (const fn of this.muteListeners) fn();
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
    // The recording, when there is one and it is loaded (else the synth recipe below; the load is under way).
    if (this.recorded(e, vol, pan)) return;
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
      case 'cheer': {
        // the crowd roars: a noisy swell plus a rising whoop
        this.noiseHit(t, 0.7, 1100, 0.3 * vol, pan, 'bandpass');
        return this.arp(t + 0.04, [72, 76, 79, 84], 0.07, 'triangle', 0.14 * vol, pan);
      }
      case 'rumble': {
        // muffled rock: low noise with a slow sub thump
        this.noiseHit(t, 0.45, 160, 0.42 * vol, pan, 'lowpass');
        return this.tone(t, 55, 0.4, 'sine', 0.2 * vol, pan, 38);
      }
      case 'creak': return this.tone(t, 140, 0.5, 'triangle', 0.16 * vol, pan, 90);
      case 'click': return this.tone(t, 1150, 0.045, 'square', 0.16 * vol, pan, 760);
      // MB-10B: blades and crushers
      case 'shriek': {
        // scraping steel with a rising wail
        this.noiseHit(t, 0.22, 3200, 0.35 * vol, pan, 'bandpass');
        return this.tone(t, 1500, 0.28, 'sawtooth', 0.14 * vol, pan, 2600);
      }
      case 'grind': {
        // the saw bites: band noise with a low chew
        this.noiseHit(t, 0.3, 1900, 0.4 * vol, pan, 'bandpass');
        return this.tone(t, 130, 0.24, 'sawtooth', 0.16 * vol, pan, 90);
      }
      // MB-10C: movers
      case 'splash': {
        // the bucket dunks: bright noise with a plop behind it
        this.noiseHit(t, 0.3, 2400, 0.34 * vol, pan, 'bandpass');
        return this.tone(t, 420, 0.22, 'sine', 0.2 * vol, pan, 190);
      }
      case 'groan': return this.tone(t, 105, 0.65, 'sawtooth', 0.15 * vol, pan, 62); // timber under load
      case 'whirr': {
        // the screw turns: soft band hum with a tick
        this.tone(t, 260, 0.4, 'sawtooth', 0.08 * vol, pan, 320);
        return this.noiseHit(t, 0.4, 900, 0.1 * vol, pan, 'bandpass');
      }
      case 'slam': {
        // the piston docks: a boom under a dust of noise
        this.noiseHit(t, 0.32, 420, 0.65 * vol, pan, 'lowpass');
        return this.tone(t, 68, 0.42, 'sine', 0.55 * vol, pan, 34);
      }
      // MB-10D launchers
      case 'bang': {
        // black powder: a big noise burst over a sub drop
        this.noiseHit(t, 0.5, 1200, 0.85 * vol, pan, 'lowpass');
        return this.tone(t, 70, 0.4, 'sine', 0.7 * vol, pan, 34);
      }
      case 'twang': return this.tone(t, 240 + Math.random() * 60, 0.28, 'sawtooth', 0.3 * vol, pan, 110); // rubber band
      case 'snap': { this.noiseHit(t, 0.05, 2600, 0.35 * vol, pan, 'bandpass'); return this.tone(t, 320, 0.07, 'square', 0.2 * vol, pan, 140); }
      case 'crank': { this.tone(t, 90, 0.16, 'square', 0.22 * vol, pan, 70); return this.tone(t + 0.05, 140, 0.14, 'square', 0.18 * vol, pan, 110); }
      case 'ding': { return this.tone(t, 1250, 0.09, 'triangle', 0.22 * vol, pan, 960); }
      case 'bonus': { this.tone(t, 660, 0.1, 'triangle', 0.24 * vol, pan, 500); this.tone(t + 0.09, 880, 0.1, 'triangle', 0.24 * vol, pan, 640); return this.tone(t + 0.18, 1180, 0.16, 'triangle', 0.26 * vol, pan, 760); }
      case 'whoosh': { return this.noiseHit(t, 0.22, 900, 0.22 * vol, pan, 'bandpass'); }
      case 'boing': { this.tone(t, 180, 0.12, 'sine', 0.3 * vol, pan, 420); return this.tone(t + 0.1, 320, 0.1, 'sine', 0.2 * vol, pan, 520); }
      case 'blip': return this.tone(t, 1500 + Math.random() * 220, 0.028, 'square', 0.07, 0);
      case 'sting': return this.sting(t);
      // the recorded-only sounds: a small synth stand-in until their file has loaded
      case 'jump': return this.tone(t, 260, 0.14, 'triangle', 0.25 * vol, pan, 520);
      case 'land': return this.noiseHit(t, 0.08, 400, Math.min(0.4, 0.06 * (e.power ?? 3)) * vol, pan, 'lowpass');
      case 'lane': return this.whoosh(t, 0.35, 500, 2200, 0.25 * vol, pan);
      case 'ring': return this.tone(t, 1760, 0.12, 'sine', 0.2 * vol, pan);
      case 'trial': return this.arp(t, [74, 79, 83, 86], 0.05, 'triangle', 0.3 * vol, pan);
      case 'hit': return this.noiseHit(t, 0.12, 700, 0.45 * vol, pan, 'lowpass');
      case 'ko': this.noiseHit(t, 0.5, 600, 0.7 * vol, pan, 'lowpass'); return this.tone(t, 80, 0.5, 'sine', 0.5 * vol, pan, 40);
      case 'boost': return this.whoosh(t, 0.3, 600, 3000, 0.3 * vol, pan);
      case 'overheat': return this.noiseHit(t, 0.6, 4000, 0.25 * vol, pan, 'highpass');
      case 'wrecker': return this.clang(t, vol, pan);
      case 'bomb': this.noiseHit(t, 0.45, 900, 0.75 * vol, pan, 'lowpass'); return this.tone(t, 75, 0.4, 'sine', 0.6 * vol, pan, 35);
    }
  }

  /** Play the recording for this event if it is loaded. Skills each have their own; landings pick soft or hard. */
  private recorded(e: SoundEvent, vol: number, pan: number): boolean {
    let ids: readonly string[] | undefined, level = 0.6, jitter = 0;
    if (e.type === 'item' && e.item) { ids = [`skill-${e.item}`]; level = 0.65; }
    else if (e.type === 'land') { const hard = (e.power ?? 0) > 7; ids = [hard ? 'land-hard' : 'land-soft']; level = Math.min(0.6, 0.12 + 0.05 * (e.power ?? 3)); jitter = 0.06; }
    else { const r = RECORDED[e.type]; if (r) { ids = r.ids; level = r.vol; jitter = r.jitter ?? 0; } }
    if (!ids?.length) return false;
    const id = ids[Math.floor(Math.random() * ids.length)];
    return this.bank.play('sfx', id, { vol: level * vol, pan, rate: 1 + (Math.random() * 2 - 1) * jitter });
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

  /** Story sting: a held minor triad with a low swell, for act banners, chapter plaques and reveals. */
  private sting(t: number) {
    this.whoosh(t, 0.5, 300, 2600, 0.24, 0);
    this.arp(t + 0.04, [45, 52, 57, 60], 0.34, 'sawtooth', 0.1, 0);
    this.arp(t + 0.04, [33, 40, 45, 48], 0.34, 'triangle', 0.16, 0);
    this.tone(t + 0.02, 70, 0.7, 'sine', 0.3, 0, 52);
  }
}

function midi(n: number) {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export const raceAudio = new RaceAudio();
