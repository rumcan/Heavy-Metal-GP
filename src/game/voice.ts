/**
 * P2-03 — the voice player.
 *
 * One line at a time, subtitles always. The content tickets (P2-13 tutorial, P2-14 story,
 * P2-15 workshop tour) only ever need three calls:
 *
 *     await playVoice('tutorial', 'steer-01');   // resolves when the line ends or is skipped
 *     preloadVoice('tutorial', 'steer-02');      // warm the next line while this one talks
 *     stopVoice();                               // the player quit / skipped ahead
 *
 * and one component, `<VoiceSubtitles />`, which paints whatever `playVoice` is saying.
 *
 * Design decisions worth knowing:
 *  - The mp3s are imported through a **lazy** `import.meta.glob`. Nothing is fetched or decoded
 *    at boot; the game's single-file build inlines them, and this just picks one at play time.
 *  - **No audio is not an error.** A line with no generated mp3 (the normal state until the
 *    reviewer runs the generator) still shows its subtitle, and still resolves its promise after
 *    an estimated reading time — so a scripted sequence keeps its pacing instead of collapsing.
 *  - The same goes for a muted game (M, `raceAudio`) or voice switched off in the settings: the
 *    caption still plays for its estimated length, the speaker makes no sound.
 *  - Settings live in `storage.ts` under `heavy-metal-gp:voice`, because RUN.world blocks
 *    `localStorage`.
 */
import castTable from '../voice/cast.json';
import { raceAudio } from './audio';
import { radio } from './sound/radio';
import * as storage from './storage';

// ────────────────────────────── types ──────────────────────────────

/** One spoken line, as `src/voice/manifests/<set>.json` declares it. */
export interface VoiceLine {
  id: string;
  speaker: string;
  text: string;
}

export interface VoiceCastEntry {
  /** Display name shown in the caption strip ("SPROCKET"). */
  name: string;
  voiceId: string;
  stability: number;
  speed: number;
  /** Performance note; part of what the generator hashes. */
  style: string;
}

/** One entry of `src/voice/generated/<set>.json`, written by `scripts/voice/generate.mjs`. */
export interface GeneratedEntry {
  /** Bundled file, relative to `src/assets/voice/` (`samples/narrator-welcome.mp3`). */
  file?: string | null;
  /** Hosted URL, only in `--remote` mode (`file` is absent then). */
  remote?: string;
  hash?: string;
  durationSec?: number;
}

export type VoiceSource =
  | { kind: 'local'; load: () => Promise<string> }
  | { kind: 'remote'; url: string };

/** Everything the player needs to say one line. `source: null` means subtitles only. */
export interface VoicePlan {
  line: VoiceLine;
  name: string;
  source: VoiceSource | null;
  /** How long the caption holds when there is nothing to listen to. */
  holdMs: number;
}

/** What the caption strip is showing right now. */
export interface VoiceState {
  line: VoiceLine | null;
  name: string;
  /** True while a line is in flight, whether it is audible or a caption. */
  active: boolean;
}

export interface VoiceSettings {
  enabled: boolean;
  volume: number;
}

export const VOICE_STORAGE_KEY = 'heavy-metal-gp:voice';
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { enabled: true, volume: 0.8 };

export const voiceCast = castTable as Record<string, VoiceCastEntry>;

const EMPTY: VoiceState = { line: null, name: '', active: false };

// ────────────────────────────── catalog ──────────────────────────────

// Vite rewrites these literals at build time. Node (the test runner) has no `import.meta.glob`,
// so each one degrades to an empty map and the player simply finds no lines — see story/assets.ts.
// `registerVoiceSet` is the seam for tests and for any host that ships manifests outside Vite.
const manifestModules = (() => {
  try { return import.meta.glob('../voice/manifests/*.json', { eager: true, import: 'default' }) as Record<string, unknown>; }
  catch { return {} as Record<string, unknown>; }
})();
const generatedModules = (() => {
  try { return import.meta.glob('../voice/generated/*.json', { eager: true, import: 'default' }) as Record<string, unknown>; }
  catch { return {} as Record<string, unknown>; }
})();
/** NOT eager on purpose: this is the map of mp3 selectors, not the audio itself. */
const audioModules = (() => {
  try { return import.meta.glob('../assets/voice/**/*.mp3', { import: 'default' }) as Record<string, () => Promise<string>>; }
  catch { return {} as Record<string, () => Promise<string>>; }
})();

const catalog = new Map<string, VoiceLine[]>();
const generated = new Map<string, Record<string, GeneratedEntry>>();
const audioLoaders = new Map<string, () => Promise<string>>();
const audioKey = (set: string, id: string) => `${set}/${id}`;

function setFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.json$/, '');
}

for (const [path, lines] of Object.entries(manifestModules)) catalog.set(setFromPath(path), normalizeLines(lines));
for (const [path, entries] of Object.entries(generatedModules)) generated.set(setFromPath(path), normalizeGenerated(entries));
for (const [path, load] of Object.entries(audioModules)) {
  const parts = path.split('/');                       // ../assets/voice/<set>/<id>.mp3
  const file = parts.pop() ?? '';
  const set = parts.pop() ?? '';
  audioLoaders.set(audioKey(set, file.replace(/\.mp3$/, '')), load);
}

/** A tolerant reader: a malformed line is dropped, never a crash. */
function normalizeLines(raw: unknown): VoiceLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: VoiceLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { id, speaker, text } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof text !== 'string' || !text.trim()) continue;
    lines.push({ id, speaker: typeof speaker === 'string' ? speaker : '', text });
  }
  return lines;
}

function normalizeGenerated(raw: unknown): Record<string, GeneratedEntry> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries: Record<string, GeneratedEntry> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as GeneratedEntry;
    if (typeof entry.file === 'string' || typeof entry.remote === 'string') entries[id] = entry;
  }
  return entries;
}

/**
 * Teach the player a set by hand: lines, the generated table, and (optionally) how to load
 * each line's audio. The game does this automatically from the Vite globs above; tests and
 * non-Vite hosts use it.
 */
export function registerVoiceSet(
  set: string,
  lines: unknown,
  options: { generated?: Record<string, GeneratedEntry>; audio?: Record<string, () => Promise<string>> } = {},
): VoiceLine[] {
  const parsed = normalizeLines(lines);
  catalog.set(set, parsed);
  if (options.generated) generated.set(set, normalizeGenerated(options.generated));
  for (const [id, load] of Object.entries(options.audio ?? {})) audioLoaders.set(audioKey(set, id), load);
  return parsed;
}

export function voiceSetNames(): string[] {
  return [...catalog.keys()].sort();
}

export function voiceLines(set: string): VoiceLine[] {
  return catalog.get(set) ?? [];
}

export function voiceLine(set: string, id: string): VoiceLine | null {
  return voiceLines(set).find((line) => line.id === id) ?? null;
}

/** The name the caption strip shows. Unknown speakers fall back to their id. */
export function speakerName(speaker: string): string {
  return voiceCast[speaker]?.name ?? speaker ?? 'Voice';
}

/**
 * The `eleven_v3` model understands inline performance tags — `[whispers]`, `[shouts]`,
 * `[laughs]`, `[sighs]`, `[excited]` (plus anything else in brackets: `[dramatic pause]`).
 * They are directions for the voice, not words, so the caption drops them.
 */
export function subtitleText(text: string): string {
  const stripped = text.replace(/\[[^\]]{1,40}\]\s*/g, '').replace(/\s{2,}/g, ' ').trim();
  return stripped || text.trim();     // a line that is nothing but a tag still gets a caption
}

// ────────────────────────────── settings ──────────────────────────────

let settings: VoiceSettings | null = null;
const listeners = new Set<() => void>();

export function parseVoiceSettings(raw: string | null): VoiceSettings {
  if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
  try {
    const value = JSON.parse(raw) as Partial<VoiceSettings>;
    const volume = Number(value?.volume);
    return {
      enabled: value?.enabled !== false,
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_VOICE_SETTINGS.volume,
    };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

/** Read once (storage is preloaded at boot) and served synchronously from then on. */
export function getVoiceSettings(): VoiceSettings {
  if (!settings) settings = parseVoiceSettings(storage.getItem(VOICE_STORAGE_KEY));
  return settings;
}

export function setVoiceSettings(patch: Partial<VoiceSettings>): VoiceSettings {
  const next: VoiceSettings = { ...getVoiceSettings(), ...patch };
  next.volume = Math.min(1, Math.max(0, Number(next.volume)));
  next.enabled = next.enabled !== false;
  settings = next;
  storage.setItem(VOICE_STORAGE_KEY, JSON.stringify(next));
  if (active?.audio) active.audio.volume = next.volume;
  if (!next.enabled) stopVoice();
  emit();
  return next;
}

export const setVoiceEnabled = (enabled: boolean) => setVoiceSettings({ enabled });
export const setVoiceVolume = (volume: number) => setVoiceSettings({ volume });

// ────────────────────────────── state ──────────────────────────────

let state: VoiceState = EMPTY;
const emit = () => { for (const listener of listeners) listener(); };
function setState(line: VoiceLine | null): void {
  state = line ? { line: { ...line, text: subtitleText(line.text) }, name: speakerName(line.speaker), active: true } : EMPTY;
  emit();
}

/** Subscribe to "what is being said" and to the settings. Returns the unsubscribe function. */
export function subscribeVoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The current line, as a stable object for `useSyncExternalStore`. */
export function currentVoice(): VoiceState {
  return state;
}

// ────────────────────────────── planning ──────────────────────────────

/**
 * Reading speed for the caption of a line with no audio: 14 characters per second (about
 * 170 words per minute), floored so a one-word line is still readable and capped so a bad
 * manifest cannot hand the caller a promise that never resolves.
 */
export function holdMsFor(text: string, durationSec = 0): number {
  if (durationSec > 0) return Math.min(30_000, Math.max(500, Math.round(durationSec * 1000)));
  return Math.min(15_000, Math.max(900, Math.round((text.length / 14) * 1000)));
}

/** True when the line has real audio to play (not just a caption). */
export function hasVoiceAudio(set: string, id: string): boolean {
  return !!planVoice(set, id)?.source;
}

/** What playing this line would do — the unit-testable half of `playVoice`. */
export function planVoice(set: string, id: string): VoicePlan | null {
  const line = voiceLine(set, id);
  if (!line) return null;
  const entry = generated.get(set)?.[id];
  let source: VoiceSource | null = null;
  const loader = audioLoaders.get(audioKey(set, id));
  if (entry?.remote) source = { kind: 'remote', url: entry.remote };
  else if (entry?.file && loader) source = { kind: 'local', load: loader };
  return { line, name: speakerName(line.speaker), source, holdMs: holdMsFor(line.text, entry?.durationSec ?? 0) };
}

// ────────────────────────────── playback ──────────────────────────────

interface ActiveLine {
  plan: VoicePlan;
  resolve: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  watcher: ReturnType<typeof setInterval> | null;
  audio: HTMLAudioElement | null;
}

let active: ActiveLine | null = null;
/** One in-flight resolve per lazy mp3 loader, so a preload and a play share the same fetch. */
const urlCache = new Map<() => Promise<string>, Promise<string>>();

/** The game's saved mute preference is read the first time the voice player needs it. */
let muteSynced = false;
function mutedNow(): boolean {
  if (!muteSynced) { muteSynced = true; raceAudio.loadPreference(); }
  return raceAudio.muted;
}

function loadSource(source: VoiceSource): Promise<string> {
  if (source.kind === 'remote') return Promise.resolve(source.url);
  const cached = urlCache.get(source.load);
  if (cached) return cached;
  const promise = source.load().then((url) => {
    if (typeof url !== 'string' || !url) throw new Error('voice: empty audio url');
    return url;
  });
  urlCache.set(source.load, promise);
  promise.catch(() => urlCache.delete(source.load));
  return promise;
}

function endActive(): void {
  const entry = active;
  if (!entry) return;
  active = null;
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.watcher) clearInterval(entry.watcher);
  if (entry.audio) radio.duck(false); // the music comes back up
  try { entry.audio?.pause(); } catch { /* a pause on a torn-down element is not an error */ }
  setState(null);
  entry.resolve();
}

/**
 * Speak one line. Resolves when the line ends, when it is skipped (`stopVoice`, a newer
 * line, or a mute) — never rejects, and never throws when the audio is missing.
 */
export function playVoice(set: string, id: string): Promise<void> {
  const plan = planVoice(set, id);
  if (!plan) return Promise.resolve();          // unknown line: nothing to say, nothing to crash

  stopVoice();                                   // one line at a time
  return new Promise<void>((resolve) => {
    const entry: ActiveLine = { plan, resolve, timer: null, watcher: null, audio: null };
    active = entry;
    setState(plan.line);

    const fallback = () => { entry.timer = setTimeout(() => { if (active === entry) endActive(); }, plan.holdMs); };
    const settingsNow = getVoiceSettings();
    if (!plan.source || !settingsNow.enabled || mutedNow()) {
      fallback();                                // subtitles only, held for its reading time
      return;
    }

    loadSource(plan.source).then((url) => {
      if (active !== entry) return;              // a newer line took over while this one loaded
      if (typeof Audio === 'undefined') {        // no DOM to play in: the caption runs the line
        fallback();
        return;
      }
      let audio: HTMLAudioElement;
      try {
        audio = new Audio(url);
        audio.preload = 'auto';
        audio.volume = settingsNow.volume;
      } catch {
        fallback();
        return;
      }
      entry.audio = audio;
      radio.duck(true); // the music dips under the line
      audio.addEventListener('ended', () => { if (active === entry) endActive(); });
      // A hard stop in case 'ended' never fires, but never before the line can finish: the stored length is a hint
      // (it was once 40% short and cut lines off), so wait for the real one from the file plus a margin.
      const safety = (ms: number) => {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => { if (active === entry) endActive(); }, ms);
      };
      safety(plan.holdMs * 2 + 4000);
      audio.addEventListener('loadedmetadata', () => {
        if (active === entry && Number.isFinite(audio.duration) && audio.duration > 0) safety(Math.max(plan.holdMs, audio.duration * 1000) + 1500);
      });
      void audio.play().catch(() => { /* autoplay blocked: the caption still runs */ });
      entry.watcher = setInterval(() => {
        if (active !== entry) { if (entry.watcher) clearInterval(entry.watcher); return; }
        const live = getVoiceSettings();
        if (!live.enabled || mutedNow()) { endActive(); return; }   // M or "voice off" cuts the line
        if (entry.audio && Math.abs(entry.audio.volume - live.volume) > 0.001) entry.audio.volume = live.volume;
      }, 200);
    }).catch(() => { if (active === entry) fallback(); });
  });
}

/** Skip whatever is being said. The pending `playVoice` promise resolves. */
export function stopVoice(): void {
  endActive();
}

/**
 * Warm one line: resolve its audio now so the next `playVoice` starts instantly. Free —
 * it is one mp3, the same file `playVoice` would fetch anyway. Skipped when voice is off.
 */
export function preloadVoice(set: string, id: string): void {
  const plan = planVoice(set, id);
  if (!plan?.source || !getVoiceSettings().enabled || mutedNow() || typeof Audio === 'undefined') return;
  void loadSource(plan.source).then((url) => {
    try {
      const audio = new Audio(url);               // just holding it is enough to prefetch
      audio.preload = 'auto';
      audio.volume = 0;
      warm.set(audioKey(set, id), audio);
      while (warm.size > 3) {
        const oldest = warm.keys().next().value as string | undefined;
        if (!oldest) break;
        const stale = warm.get(oldest);
        warm.delete(oldest);
        try { stale?.pause(); stale?.removeAttribute('src'); stale?.load(); } catch { /* already gone */ }
      }
    } catch { /* nothing to warm: the caption will run instead */ }
  }).catch(() => { /* a line with no audio needs no warming */ });
}

const warm = new Map<string, HTMLAudioElement>();

/** Testing hook: the module keeps play state between tests otherwise. */
export function resetVoiceForTests(): void {
  stopVoice();
  settings = null;
  muteSynced = false;
  urlCache.clear();
  warm.clear();
}
