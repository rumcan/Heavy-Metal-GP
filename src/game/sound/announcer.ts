// The race announcer: the Narrator's booming voice calling out your race (src/game/sound/manifest.json "announcer").
// `decide` is pure (tested): given what changed since the last frame it picks at most one call, with a pause between
// calls so he never talks over himself. The lines ship as files (public/audio/voice/) and play through the sample bank,
// not the caption strip: a commentator, not dialogue. Story and tutorial races keep him quiet (they have their own
// voices); the voice setting (on/off, volume) covers him like every other voice.
import manifest from './manifest.json';

export type Call = 'start' | 'lead' | 'overtaken' | 'half' | 'final' | 'ko' | 'out' | 'lowhp' | 'win' | 'podium' | 'finish' | 'air' | 'trial';

/** What the announcer watches, once a frame, for your own ball. */
export interface RaceFrame {
  /** Game time, ms. */
  time: number;
  /** The lights are out. */
  started: boolean;
  /** Your place (1 = leading) and how many are racing. */
  rank: number;
  field: number;
  /** 0..1 along the course. */
  progress: number;
  /** Rivals you have knocked out. */
  kos: number;
  hp: number;
  maxHp: number;
  healthOn: boolean;
  finished: boolean;
  dnf: boolean;
  /** How long you have been in the air, ms. */
  airMs: number;
  /** A trial skill sits in your Tab slot. */
  pickup: boolean;
}

export interface AnnouncerMemory {
  last: RaceFrame | null;
  saidAt: number;
  /** One-shot calls already made this race. */
  once: Set<Call>;
  /** When each repeatable call was last made. */
  at: Partial<Record<Call, number>>;
}

export const newAnnouncerMemory = (): AnnouncerMemory => ({ last: null, saidAt: -Infinity, once: new Set(), at: {} });

/** Quiet time after any call (ms), and before a repeatable call may come again. */
export const GAP_MS = 3500;
const REPEAT_MS: Partial<Record<Call, number>> = { lead: 15000, overtaken: 15000, ko: 4000, lowhp: 20000, air: 12000 };
/** These cut in even inside the quiet time: they are the race's big moments. */
const URGENT = new Set<Call>(['out', 'win', 'podium', 'finish']);

/** The call for this frame, or null. Updates `mem` (pure otherwise: no clock, no audio). */
export function decide(mem: AnnouncerMemory, f: RaceFrame): Call | null {
  const prev = mem.last;
  mem.last = f;
  if (!prev) return null;
  const wants: Call[] = [];
  if (f.dnf && !prev.dnf) wants.push('out');
  if (f.finished && !prev.finished) wants.push(f.rank === 1 ? 'win' : f.rank <= 3 ? 'podium' : 'finish');
  if (!f.finished && !f.dnf && f.started) {
    if (f.kos > prev.kos) wants.push('ko');
    const settled = f.time > 4000; // the grid sorts itself out first
    if (settled && f.rank === 1 && prev.rank > 1 && f.field > 1) wants.push('lead');
    if (settled && prev.time > 4000 && f.rank > 1 && prev.rank === 1) wants.push('overtaken'); // you held the lead after the start shuffle
    if (f.progress >= 0.85 && prev.progress < 0.85) wants.push('final');
    if (f.progress >= 0.5 && prev.progress < 0.5) wants.push('half');
    if (f.healthOn && f.hp > 0 && f.hp < f.maxHp * 0.3 && prev.hp >= prev.maxHp * 0.3) wants.push('lowhp');
    if (f.pickup && !prev.pickup) wants.push('trial');
    if (f.airMs > 1100 && prev.airMs <= 1100) wants.push('air');
  }
  if (f.started && !prev.started) wants.push('start');
  for (const call of wants) {
    const oneShot = call === 'start' || call === 'half' || call === 'final' || call === 'trial' || URGENT.has(call);
    if (oneShot && mem.once.has(call)) continue;
    if (!URGENT.has(call) && f.time - mem.saidAt < GAP_MS) continue;
    const again = REPEAT_MS[call];
    if (again !== undefined && f.time - (mem.at[call] ?? -Infinity) < again) continue;
    if (oneShot) mem.once.add(call);
    mem.at[call] = f.time;
    mem.saidAt = f.time;
    return call;
  }
  return null;
}

/** Every take of a call (ann-<call>-<n>), from the manifest. */
export const TAKES: Record<Call, string[]> = (() => {
  const out = {} as Record<Call, string[]>;
  for (const l of (manifest as { announcer?: { id: string; call: string }[] }).announcer ?? []) (out[l.call as Call] ??= []).push(l.id);
  return out;
})();

/** A take of the call, not the one used last time if there is another. */
export function pickTake(call: Call, lastId: string | null, rng: () => number = Math.random): string | null {
  const takes = TAKES[call] ?? [];
  if (!takes.length) return null;
  const pool = takes.length > 1 ? takes.filter((t) => t !== lastId) : takes;
  return pool[Math.floor(rng() * pool.length)];
}
