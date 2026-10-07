// P2-25: the sound of an Infinity run that is Infinity's own: a quiet chime at every kilometre. The music is the radio
// (Infinity Skies, src/game/sound/radio.ts; the owner removed the old synth pad: "if the person wants music they can use
// the radio"), and the rolling, the wind and the forest are the shared recorded loops (raceAudio.setDrive / setAmbience).
// Web Audio only, silent while muted (it follows the game's one mute setting).

export const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

const MASTER = 0.55;

export class InfinityAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
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
    void this.seed;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : MASTER, this.ctx.currentTime, 0.2);
  }

  /** The biome's key, for the kilometre chime. */
  setRoot(root: number): void {
    this.root = root;
  }

  /** A quiet two-note bell. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.02;
    [0, 7].forEach((interval, i) => this.tone(midiToHz(this.root + 24 + interval), t + i * 0.18, 2.4, 0.07));
  }

  stop(): void {
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') void ctx.close();
  }

  /** One soft sine note with a long release. */
  private tone(freq: number, at: number, length: number, level: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}
