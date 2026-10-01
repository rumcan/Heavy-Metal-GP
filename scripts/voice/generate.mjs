#!/usr/bin/env node
/**
 * P2-03 — the voice-over generator.
 *
 * One command turns the casting table (`src/voice/cast.json`) plus a text manifest
 * (`src/voice/manifests/<set>.json`) into audio for the game:
 *
 *     node scripts/voice/generate.mjs --set samples --dry-run
 *     node scripts/voice/generate.mjs --set samples
 *
 * What it guarantees, because TTS costs RUN.world credits:
 *   - CACHE BY HASH. Every line's audio is keyed by sha256(voiceId + text + settings +
 *     mode). A line whose key matches `src/voice/generated/<set>.json` is never sent to
 *     the CLI again. `--force <id>` overrides that for one line.
 *   - DRY RUN FIRST. `--dry-run` prints the line count, what is cached and an estimated
 *     credit cost without touching the network or the disk.
 *   - A CAP. A real run refuses to spend more than `--cap` credits (default 1000, the
 *     P2-03 ticket cap) unless the caller raises it.
 *   - A BUDGET. All bundled voice must stay under `--max-mb` (default 8 MB) because the
 *     game ships as ONE html file with every mp3 inlined.
 *
 * Output:
 *   src/assets/voice/<set>/<id>.mp3   the audio (mono 48 kbps when ffmpeg is available)
 *   src/voice/generated/<set>.json    id → { file, hash, durationSec }
 *
 * `--remote` keeps the hosted URL from the CLI's `--json` output instead of the mp3 and
 * writes id → { remote, hash, durationSec }. Read `src/voice/README.md` before using it:
 * nobody has yet verified that RUN's content security policy allows hosted media.
 *
 * The pure helpers at the bottom are exported for `tests/voice.test.ts`; nothing runs
 * unless this file is executed directly.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

export const DEFAULT_MODEL = 'eleven_v3';
/** The P2-03 ticket cap: 3 sample lines + a designed voice stay inside 1000 credits. */
export const DEFAULT_CAP = 1000;
/** Every mp3 is inlined into the single-file build, so the whole library is capped. */
export const DEFAULT_MAX_MB = 8;
/** Targets: how many characters fit in the sample set. Used by the dry run's advice only. */
export const CHARS_PER_CREDIT = { eleven_v3: 1, eleven_multilingual_v2: 1, eleven_turbo_v2_5: 0.5, eleven_flash_v2_5: 0.5 };

const CAST_FILE = 'src/voice/cast.json';
const MANIFEST_DIR = 'src/voice/manifests';
const GENERATED_DIR = 'src/voice/generated';
const AUDIO_DIR = 'src/assets/voice';

// ────────────────────────────── arguments ──────────────────────────────

export const USAGE = `Voice generator (P2-03)

  node scripts/voice/generate.mjs --set <name> [options]

Options
  --set <name>      manifest set to generate (repeatable, comma separated, or "all")
  --dry-run         print the line count, the cache hits and the credit estimate; write nothing
  --force <id>      regenerate this line even if it is cached (repeatable, or "all")
  --remote          record the hosted URL instead of saving an mp3 (see src/voice/README.md)
  --model <id>      TTS model (default ${DEFAULT_MODEL})
  --cap <credits>   refuse a real run whose estimate exceeds this (default ${DEFAULT_CAP}; 0 disables)
  --max-mb <mb>     bundled-audio budget for ALL sets (default ${DEFAULT_MAX_MB})
  --list            list the manifest sets and their line counts, then exit
  --cli <path>      rundot CLI to call (default: rundot on PATH)
  --root <dir>      repo root holding src/voice and src/assets/voice (default: this checkout)
  --help            this text`;

export function parseArgs(argv = []) {
  const args = {
    sets: [], force: [], dryRun: false, remote: false, list: false, help: false,
    model: DEFAULT_MODEL, cap: DEFAULT_CAP, maxMb: DEFAULT_MAX_MB, cli: 'rundot', root: REPO_ROOT,
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith('--') ? argv[i].split(/=(.*)/s) : [argv[i], undefined];
    const take = () => {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    switch (flag) {
      case '--set': args.sets.push(...take().split(',').map((s) => s.trim()).filter(Boolean)); break;
      case '--force': args.force.push(...take().split(',').map((s) => s.trim()).filter(Boolean)); break;
      case '--dry-run': args.dryRun = true; break;
      case '--remote': args.remote = true; break;
      case '--list': args.list = true; break;
      case '--help': args.help = true; break;
      case '--model': args.model = take(); break;
      case '--cap': args.cap = Number(take()); break;
      case '--max-mb': args.maxMb = Number(take()); break;
      case '--cli': args.cli = take(); break;
      case '--root': args.root = path.resolve(take()); break;
      default: throw new Error(`unknown option ${argv[i]}\n\n${USAGE}`);
    }
  }
  if (!args.sets.length && !args.list && !args.help) throw new Error(`--set is required\n\n${USAGE}`);
  for (const [name, value] of [['cap', args.cap], ['max-mb', args.maxMb]]) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a number ≥ 0`);
  }
  return args;
}

// ────────────────────────────── hashing & estimates ──────────────────────────────

/** The exact settings a line is synthesized with. Changing any of them invalidates the cache. */
export function lineSettings(cast, speaker, args = {}) {
  const voice = cast[speaker];
  if (!voice) throw new Error(`speaker "${speaker}" is not in ${CAST_FILE}`);
  return {
    voiceId: voice.voiceId,
    model: args.model ?? DEFAULT_MODEL,
    stability: voice.stability ?? 0.5,
    speed: voice.speed ?? 1.0,
    style: voice.style ?? '',
    mode: args.remote ? 'remote' : 'bundled',
  };
}

/**
 * sha256 over the settings that decide what a line sounds like. Field order is fixed so the
 * same inputs always hash the same — the cache is what stops us paying for a line twice.
 */
export function hashLine(text, cast, speaker, args = {}) {
  const s = lineSettings(cast, speaker, args);
  const canonical = JSON.stringify({
    voiceId: s.voiceId, text, model: s.model, stability: s.stability, speed: s.speed, style: s.style, mode: s.mode,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function creditsPerChar(model) {
  return CHARS_PER_CREDIT[model] ?? 1;
}

/** Credits for one line: characters × the model's rate. An ESTIMATE — the CLI's own count wins. */
export function estimateCredits(text, cast, speaker, args = {}) {
  const model = cast[speaker]?.model ?? args.model ?? DEFAULT_MODEL;
  return Math.ceil(text.length * creditsPerChar(model));
}

/** Problems with a manifest, as a list of sentences. Empty means it is safe to generate. */
export function validateManifest(set, lines, cast) {
  const problems = [];
  if (!Array.isArray(lines)) return [`${set}: manifest must be an array of { id, speaker, text }`];
  const seen = new Set();
  lines.forEach((line, index) => {
    const where = `${set}[${index}]`;
    if (!line || typeof line !== 'object') { problems.push(`${where}: not an object`); return; }
    if (typeof line.id !== 'string' || !/^[a-z0-9-]+$/.test(line.id)) problems.push(`${where}: id must be kebab-case (got ${JSON.stringify(line.id)})`);
    else if (seen.has(line.id)) problems.push(`${where}: duplicate id "${line.id}"`);
    else seen.add(line.id);
    if (typeof line.speaker !== 'string' || !cast[line.speaker]) problems.push(`${where}: speaker ${JSON.stringify(line.speaker)} is not in the cast`);
    if (typeof line.text !== 'string' || !line.text.trim()) problems.push(`${where}: text is empty`);
    else if (line.text.length > 400) problems.push(`${where}: ${line.text.length} characters is a very long line for one mp3`);
  });
  return problems;
}

/**
 * Duration of an mp3 in seconds, from its MPEG frame headers (no ffprobe needed).
 * Walks the frames when it can and falls back to a constant-bitrate estimate. 0 = unknown.
 */
export function mp3DurationSec(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const SAMPLES = { 1: { 1: 1152, 2: 1152, 3: 384 }, 2: { 1: 576, 2: 576, 3: 192 } }; // [version][layer]
  const BITRATES = {
    1: { 1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], 2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] },
    2: { 1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], 3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] },
  };
  const RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };
  const header = (at) => {
    if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;
    const versionBits = (bytes[at + 1] >> 3) & 0x03;
    if (versionBits === 1) return null;
    const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
    const layerBits = (bytes[at + 1] >> 1) & 0x03;
    if (layerBits === 0) return null;
    const layer = 4 - layerBits;
    const bitrate = BITRATES[version === 1 ? 1 : 2][layer]?.[(bytes[at + 2] >> 4) & 0x0f] ?? 0;
    const rate = RATES[version]?.[(bytes[at + 2] >> 2) & 0x03] ?? 0;
    if (!bitrate || !rate) return null;
    const samples = SAMPLES[version === 1 ? 1 : 2][layer];
    const padding = (bytes[at + 2] >> 1) & 0x01;
    return { bitrate, rate, samples, length: Math.floor((samples / 8) * bitrate * 1000 / rate) + padding };
  };
  let at = 0;
  while (at + 4 <= bytes.length && !header(at)) at++; // ID3 tags and junk before the first frame
  const first = header(at);
  if (!first) return 0;
  let frames = 0;
  let cursor = at;
  while (cursor + 4 <= bytes.length) {
    const frame = header(cursor);
    if (!frame) break;
    frames++;
    cursor += Math.max(1, frame.length);
  }
  if (frames > 1) return (frames * first.samples) / first.rate;
  return first.bitrate ? ((bytes.length - at) * 8) / (first.bitrate * 1000) : 0;
}

// ────────────────────────────── CLI plumbing ──────────────────────────────

/** The `rundot generate tts` argv for one line. Kept here so tests can assert on it. */
export function ttsArgs({ text, voiceId, out, model, stability, speed }) {
  return [
    'generate', 'tts',
    '--text', text,
    '--voice-id', voiceId,
    '--out', out,
    '--model', model,
    '--stability', String(stability),
    '--speed', String(speed),
    '--json',
  ];
}

/** The last JSON object in a CLI's stdout: peers print progress lines before the payload. */
export function parseCliJson(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return null;
  const whole = tryJson(text);
  if (whole) return whole;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const hit = tryJson(lines[i]);
    if (hit) return hit;
  }
  let end = text.lastIndexOf('}');
  while (end >= 0) {
    let depth = 0;
    for (let start = end; start >= 0; start--) {
      if (text[start] === '}') depth++;
      else if (text[start] === '{') {
        depth--;
        if (depth === 0) {
          const hit = tryJson(text.slice(start, end + 1));
          if (hit) return hit;
          break;
        }
      }
    }
    end = text.lastIndexOf('}', end - 1);
  }
  return null;
}

function tryJson(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

function pick(value, paths) {
  for (const key of paths) {
    let node = value;
    let ok = true;
    for (const part of key.split('.')) {
      if (node && typeof node === 'object' && part in node) node = node[part];
      else { ok = false; break; }
    }
    if (ok && node !== null && node !== undefined && node !== '') return node;
  }
  return undefined;
}

/** What the CLI said the line cost: hosted URL, duration (seconds) and credits. All optional. */
export function readCliResult(payload) {
  const url = pick(payload, ['url', 'audioUrl', 'audio_url', 'hostedUrl', 'hosted_url', 'fileUrl', 'file_url', 'mediaUrl', 'media_url', 'output_url', 'audio.url']);
  const seconds = pick(payload, ['durationSec', 'duration_sec', 'durationSeconds', 'duration_seconds', 'audio_duration_secs', 'audioDurationSecs', 'duration']);
  const millis = pick(payload, ['durationMs', 'duration_ms', 'audio_duration_ms']);
  const credits = pick(payload, ['credits', 'creditsUsed', 'credits_used', 'cost.credits', 'usage.credits', 'billing.credits']);
  let durationSec = 0;
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) durationSec = seconds;
  else if (typeof millis === 'number' && Number.isFinite(millis) && millis > 0) durationSec = millis / 1000;
  return {
    url: typeof url === 'string' ? url : null,
    durationSec,
    credits: typeof credits === 'number' && Number.isFinite(credits) ? credits : null,
  };
}

function rundot(args, { cli, cwd }) {
  // Invariant culture: on a machine whose locale writes decimals with a comma (e.g. en-ZA) the .NET CLI
  // otherwise refuses "--stability 0.55".
  const env = { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' };
  const opts = { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 };
  // Spawn without a shell so line text (spaces, quotes, "!") reaches the CLI as ONE argument.
  const direct = spawnSync(cli, args, opts);
  if (!(direct.error && direct.error.code === 'ENOENT' && process.platform === 'win32')) return direct;
  // Windows `.cmd` shims only run through a shell: quote every argument for cmd.exe.
  const quote = (a) => `"${String(a).replace(/"/g, '""')}"`;
  return spawnSync([cli, ...args].map(quote).join(' '), { ...opts, shell: true });
}

function ffmpegPath() {
  for (const candidate of ['ffmpeg', 'ffmpeg.exe']) {
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

function ffprobeSeconds(cli, file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) return 0;
  const seconds = Number(String(probe.stdout).trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

// ────────────────────────────── planning ──────────────────────────────

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(REPO_ROOT, file)} is not valid JSON: ${error.message}`);
  }
}

export function loadCast(root) {
  return readJson(path.join(root, CAST_FILE), {});
}

export function listSets(root) {
  const dir = path.join(root, MANIFEST_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length)).sort();
}

export function loadManifest(root, set) {
  return readJson(path.join(root, MANIFEST_DIR, `${set}.json`), null);
}

export function loadGenerated(root, set) {
  return readJson(path.join(root, GENERATED_DIR, `${set}.json`), {});
}

/**
 * What a run would do, without doing any of it: one entry per manifest line with its
 * settings, its hash, whether the audio is cached and what it would cost.
 */
export function planRun({ root, sets, cast, args }) {
  const forceAll = args.force.includes('all') || args.force.includes('*');
  const plan = [];
  for (const set of sets) {
    const lines = loadManifest(root, set);
    const problems = validateManifest(set, lines, cast);
    if (problems.length) throw new Error(`\n  ${problems.join('\n  ')}`);
    const generated = loadGenerated(root, set);
    const audio = path.join(root, AUDIO_DIR, set);
    plan.push({
      set,
      lines: lines.map((line) => {
        const settings = lineSettings(cast, line.speaker, args);
        const hash = hashLine(line.text, cast, line.speaker, args);
        const cached = generated[line.id]?.hash === hash;
        const file = path.join(audio, `${line.id}.mp3`);
        const remote = cached && !!generated[line.id]?.remote;
        const onDisk = remote || (cached && existsSync(file));
        const bytes = onDisk && !remote && existsSync(file) ? statSync(file).size : 0;
        const forced = forceAll || args.force.includes(line.id);
        return {
          ...line, hash, settings, file, bytes, cached: onDisk, forced,
          generate: !onDisk || forced,
          credits: estimateCredits(line.text, cast, line.speaker, args),
        };
      }),
    });
  }
  return plan;
}

function bundledBytes(root) {
  const dir = path.join(root, AUDIO_DIR);
  let total = 0;
  const walk = (at) => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const next = path.join(at, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith('.mp3')) total += statSync(next).size;
    }
  };
  walk(dir);
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

// ────────────────────────────── the run ──────────────────────────────

export async function main(argv = process.argv.slice(2), log = console.log) {
  const args = parseArgs(argv);
  if (args.help) { log(USAGE); return 0; }

  const all = listSets(args.root);
  if (args.list) {
    if (!all.length) { log(`No manifests in ${MANIFEST_DIR}/.`); return 0; }
    for (const set of all) {
      const lines = loadManifest(args.root, set) ?? [];
      const generated = loadGenerated(args.root, set);
      const done = lines.filter((line) => generated[line.id]).length;
      log(`${set}: ${lines.length} lines, ${done} generated`);
    }
    return 0;
  }
  const sets = args.sets.includes('all') ? all : args.sets;
  for (const set of sets) if (!all.includes(set)) throw new Error(`no manifest src/voice/manifests/${set}.json (have: ${all.join(', ') || 'none'})`);

  const cast = loadCast(args.root);
  const plan = planRun({ root: args.root, sets, cast, args });
  const todo = plan.flatMap((entry) => entry.lines.filter((line) => line.generate));
  const estimate = todo.reduce((sum, line) => sum + line.credits, 0);
  const totalLines = plan.reduce((sum, entry) => sum + entry.lines.length, 0);

  const mode = args.remote ? 'remote (hosted urls)' : 'bundled (mp3)';
  if (args.dryRun) {
    log(`Voice dry run — ${totalLines} line${totalLines === 1 ? '' : 's'} in ${sets.join(', ')}, ${todo.length} to generate, ${totalLines - todo.length} cached.`);
    for (const entry of plan) {
      log(`\n  ${entry.set}  (${entry.lines.length} lines)`);
      for (const line of entry.lines) {
        const flag = !line.generate ? 'cached' : line.forced ? 'forced' : 'new   ';
        log(`    ${flag}  ${line.id.padEnd(22)} ${line.speaker.padEnd(15)} ${String(line.text.length).padStart(4)} chars  ≈${String(line.credits).padStart(4)} credits`);
      }
    }
    log(`\nMode: ${mode}. Estimated cost: ≈${estimate} credits for ${todo.length} new line${todo.length === 1 ? '' : 's'}` +
      (args.cap > 0 ? ` (cap ${args.cap}).` : '.'));
    if (args.cap > 0 && estimate > args.cap) log(`WARNING: the estimate is over the cap — the real run will refuse unless you raise --cap.`);
    log('Dry run: nothing was synthesized and nothing was written.');
    return 0;
  }

  if (!todo.length) {
    log(`Nothing to do: all ${totalLines} line${totalLines === 1 ? '' : 's'} in ${sets.join(', ')} are cached. (--force <id> regenerates one.)`);
    return 0;
  }
  if (args.cap > 0 && estimate > args.cap) {
    throw new Error(`refusing to spend ≈${estimate} credits with --cap ${args.cap}. Raise --cap, or generate fewer sets.`);
  }

  const convert = ffmpegPath();
  const cliCheck = rundot(['whoami'], { cli: args.cli, cwd: args.root });
  if (cliCheck.error || cliCheck.status !== 0) {
    throw new Error(
      `could not run \`${args.cli} whoami\`${cliCheck.error ? ` (${cliCheck.error.message})` : ''}: the RUN.world CLI is what synthesizes the audio.\n` +
      `  Run this on a machine with the CLI installed and signed in, or pass --cli <path>. Nothing has been written.`,
    );
  }

  let spent = 0;
  let index = 0;
  for (const entry of plan) {
    const audioDir = path.join(args.root, AUDIO_DIR, entry.set);
    const generatedFile = path.join(args.root, GENERATED_DIR, `${entry.set}.json`);
    const previous = loadGenerated(args.root, entry.set);
    const next = {};
    mkdirSync(audioDir, { recursive: true });
    for (const line of entry.lines) {
      if (!line.generate) {
        next[line.id] = previous[line.id];
        log(`  cached  ${entry.set}/${line.id}`);
        continue;
      }
      index++;
      const tmp = path.join(tmpdir(), `hmgp-voice-${process.pid}-${index}.mp3`);
      let result;
      for (let attempt = 0; ; attempt++) {
        result = rundot(ttsArgs({ text: line.text, voiceId: line.settings.voiceId, out: tmp, model: line.settings.model, stability: line.settings.stability, speed: line.settings.speed }), { cli: args.cli, cwd: args.root });
        // RUN rate-limits generation ("Rate limited; retry in 45 seconds"): wait and retry instead of failing the run.
        const wait = /retry in (\d+) seconds/i.exec(`${result.stdout}${result.stderr}`);
        if (!wait || attempt >= 8) break;
        log(`  wait    rate limited — retrying ${entry.set}/${line.id} in ${Number(wait[1]) + 2}s`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, (Number(wait[1]) + 2) * 1000);
      }
      const payload = parseCliJson(result.stdout);
      if (result.error || result.status !== 0) {
        rmSync(tmp, { force: true });
        const detail = result.error ? result.error.message : (result.stderr || result.stdout || '').trim().split('\n').slice(-4).join('\n    ');
        throw new Error(`\`${args.cli} generate tts\` failed for ${entry.set}/${line.id}:\n    ${detail}`);
      }
      const told = readCliResult(payload);
      if (told.credits !== null) spent += told.credits;
      else spent += line.credits;
      if (args.remote) {
        if (!told.url) throw new Error(`--remote needs a hosted url in the CLI's --json output; ${entry.set}/${line.id} had none: ${String(result.stdout).trim().slice(0, 200)}`);
        next[line.id] = { remote: told.url, hash: line.hash, durationSec: round(told.durationSec) };
        log(`  remote  ${entry.set}/${line.id} → ${told.url}`);
      } else {
        if (!existsSync(tmp) || !statSync(tmp).size) throw new Error(`the CLI reported success but wrote no file for ${entry.set}/${line.id} (--out ${tmp})`);
        const target = path.join(audioDir, `${line.id}.mp3`);
        if (convert) {
          const small = `${target}.tmp.mp3`;
          const conv = spawnSync(convert, ['-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-b:a', '48k', small], { encoding: 'utf8' });
          if (conv.status === 0 && existsSync(small) && statSync(small).size) copyFileSync(small, target);
          else copyFileSync(tmp, target); // ffmpeg said no: ship the original rather than nothing
          rmSync(small, { force: true });
        } else {
          copyFileSync(tmp, target);
        }
        rmSync(tmp, { force: true });
        const durationSec = round(told.durationSec || (convert ? ffprobeSeconds(args.cli, target) : 0) || mp3DurationSec(readFileSync(target)));
        next[line.id] = { file: `${entry.set}/${line.id}.mp3`, hash: line.hash, durationSec };
        // Save progress after every line, so a failure later in the run never re-bills this one.
        if (!args.dryRun) {
          mkdirSync(path.dirname(generatedFile), { recursive: true });
          writeFileSync(generatedFile, `${JSON.stringify({ ...previous, ...next }, null, 2)}
`);
        }
        log(`  new     ${entry.set}/${line.id}  ${mb(statSync(target).size)}${convert ? ' (mono 48 kbps)' : ''}  ${durationSec ? `${durationSec}s` : 'duration unknown'}`);
      }
    }
    // Orphans (a line the manifest dropped) lose their entry but keep their mp3 on disk: deleting
    // committed audio without being asked is not this script's job.
    const orphans = Object.keys(previous).filter((id) => !entry.lines.some((line) => line.id === id));
    for (const id of orphans) log(`  note    ${entry.set}/${id} is no longer in the manifest; its entry was dropped and its file kept`);
    if (!args.dryRun) {
      mkdirSync(path.dirname(generatedFile), { recursive: true });
      writeFileSync(generatedFile, `${JSON.stringify(next, null, 2)}\n`);
    }
  }

  const bytes = bundledBytes(args.root);
  const budget = args.maxMb * 1024 * 1024;
  log(`\nSynthesized ${index} line${index === 1 ? '' : 's'} — ≈${Math.round(spent)} credits.`);
  log(`Bundled voice: ${mb(bytes)} of ${args.maxMb} MB budget (${Math.round((bytes / budget) * 100)}%).`);
  if (bytes > budget) throw new Error(`over the ${args.maxMb} MB voice budget: every mp3 is inlined into the single html build. Trim the sets or raise --max-mb deliberately.`);
  return 0;
}

const round = (seconds) => (seconds ? Math.round(seconds * 100) / 100 : 0);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(`\nvoice-generate: ${error.message}\n`); process.exitCode = 1; },
  );
}
