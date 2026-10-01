#!/usr/bin/env node
/**
 * P2-03 — casting sheet: every speaker in `src/voice/cast.json` with the preview URL of
 * the voice it is cast with, so the owner can listen and approve before any audio is paid for.
 *
 *     node scripts/voice/previews.mjs
 *     node scripts/voice/previews.mjs --json > cast-sheet.json
 *
 * Reads the library with `rundot generate list-voices --json` (743 voices on RUN.world).
 * A cast voice that is not in the library is reported as MISSING rather than silently skipped:
 * that is the first thing to check when a line fails.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

export function parseArgs(argv = []) {
  const args = { cli: 'rundot', root: REPO_ROOT, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith('--') ? argv[i].split(/=(.*)/s) : [argv[i], undefined];
    const take = () => {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    if (flag === '--cli') args.cli = take();
    else if (flag === '--root') args.root = path.resolve(take());
    else if (flag === '--json') args.json = true;
    else if (flag === '--help') args.help = true;
    else throw new Error(`unknown option ${argv[i]}`);
  }
  return args;
}

/** Every voice in a `list-voices --json` payload, whatever shape the CLI wraps it in. */
export function voicesFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of ['voices', 'items', 'data', 'results']) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }
  return [];
}

export function voiceIdOf(voice) {
  return voice?.voiceId ?? voice?.voice_id ?? voice?.id ?? '';
}

export function previewOf(voice) {
  return voice?.previewUrl ?? voice?.preview_url ?? voice?.preview ?? voice?.sampleUrl ?? '';
}

export function nameOf(voice) {
  return voice?.name ?? voice?.displayName ?? voice?.display_name ?? '';
}

const line = (speaker, cast, voice) => ({
  speaker,
  character: cast[speaker].name ?? speaker,
  voiceId: cast[speaker].voiceId,
  voiceName: voice ? nameOf(voice) : '',
  previewUrl: voice ? previewOf(voice) : '',
  found: !!voice,
});

export async function main(argv = process.argv.slice(2), log = console.log) {
  const args = parseArgs(argv);
  if (args.help) {
    log('Casting sheet (P2-03)\n\n  node scripts/voice/previews.mjs [--cli <path>] [--root <dir>] [--json]');
    return 0;
  }
  const cast = JSON.parse(readFileSync(path.join(args.root, 'src/voice/cast.json'), 'utf8'));
  const run = spawnSync(args.cli, ['generate', 'list-voices', '--json'], { cwd: args.root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
  if (run.error || run.status !== 0) {
    throw new Error(`could not list voices with \`${args.cli} generate list-voices --json\`${run.error ? ` (${run.error.message})` : ''}:\n  ${(run.stderr || '').trim().split('\n').slice(-3).join('\n  ')}`);
  }
  let payload;
  try {
    payload = JSON.parse(run.stdout);
  } catch {
    throw new Error(`\`${args.cli} generate list-voices --json\` did not print JSON (first 200 characters): ${String(run.stdout).slice(0, 200)}`);
  }
  const byId = new Map(voicesFrom(payload).map((voice) => [voiceIdOf(voice), voice]));
  const sheet = Object.keys(cast).map((speaker) => line(speaker, cast, byId.get(cast[speaker].voiceId)));

  if (args.json) {
    log(JSON.stringify(sheet, null, 2));
  } else {
    log(`Casting sheet — ${sheet.length} speakers (${byId.size} voices in the library)\n`);
    log('| Speaker | Voice | Voice id | Preview |');
    log('|---|---|---|---|');
    for (const row of sheet) {
      log(`| ${row.character} | ${row.found ? row.voiceName : '**MISSING**'} | \`${row.voiceId}\` | ${row.previewUrl || '—'} |`);
    }
    if (!existsSync(path.join(args.root, 'src/voice/cast.json'))) log('\nNo cast.json found — is --root right?');
    if (sheet.some((row) => !row.found)) log('\nMISSING voices are not in the library: they were probably typed from the ticket. Check `list-voices` for a replacement.');
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(`\nvoice-previews: ${error.message}\n`); process.exitCode = 1; },
  );
}
