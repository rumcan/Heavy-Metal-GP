// Generates the game's music and sound effects from src/game/sound/manifest.json with `rundot generate music|sfx`.
// Every file that is missing is made; files already on disk are kept (delete one to remake it). Files land in
// public/audio/music/<id>.mp3, public/audio/stingers/<id>.mp3 and public/audio/sfx/<id>.mp3: Vite copies public/
// next to index.html, so they ship as files and are never inlined into the single-file build.
//
//   node scripts/audio/generate.mjs              make everything missing
//   node scripts/audio/generate.mjs --dry-run    list what would be made and the credit estimate
//   node scripts/audio/generate.mjs --only sfx   only one section (music | stingers | sfx)
//   node scripts/audio/generate.mjs --id ui-buy  only these ids (repeatable)
//
// RUN rate-limits generation ("Rate limited; retry in N seconds"): the script waits as told and tries again.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'src/game/sound/manifest.json'), 'utf8'));
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const ids = args.flatMap((a, i) => (a === '--id' ? [args[i + 1]] : []));

const DIRS = { music: 'music', stingers: 'stingers', sfx: 'sfx', announcer: 'voice' };
const jobs = [];
// music first (Infinity's own tracks before the rest), then the stingers, the announcer and the sound effects
for (const section of ['music', 'stingers', 'announcer', 'sfx']) {
  if (only && only !== section) continue;
  const entries = [...(manifest[section] ?? [])].sort((x, y) => (y.station === 'infinity') - (x.station === 'infinity'));
  for (const e of entries) {
    if (ids.length && !ids.includes(e.id)) continue;
    const out = path.join(ROOT, 'public/audio', DIRS[section], `${e.id}.mp3`);
    if (existsSync(out)) continue;
    jobs.push({ section, ...e, out });
  }
}

function rundot(argv) {
  // The CLI is .NET: it parses '0.5' with the machine's number format (a comma locale rejects it). Invariant culture.
  return spawnSync('rundot', argv, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1 << 24, env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } });
}
const quote = (s) => (process.platform === 'win32' ? `"${String(s).replace(/"/g, '\\"')}"` : String(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`${jobs.length} to make${dry ? ' (dry run)' : ''}`);
let spent = 0, made = 0, failed = 0;
for (const job of jobs) {
  const music = job.section === 'music' || job.section === 'stingers';
  const v = manifest.announcerVoice;
  const argv = job.section === 'announcer'
    ? ['generate', 'tts', '--text', quote(job.text), '--voice-id', v.voiceId, '--stability', String(v.stability), '--speed', String(v.speed), '--out', quote(job.out), '--json']
    : music
    ? ['generate', 'music', '--prompt', quote(job.prompt), '--duration', String(job.duration), '--out', quote(job.out), '--json']
    : ['generate', 'sfx', '--description', quote(job.prompt), '--duration', String(job.duration), '--out', quote(job.out), '--json'];
  if (dry) {
    const est = job.section === 'announcer' ? rundot(['generate', 'estimate', 'tts', '--text', quote(job.text)]) : rundot(['generate', 'estimate', music ? 'music' : 'sfx', '--duration', String(job.duration)]);
    const m = /Estimated cost: ([\d,]+)/.exec(est.stdout + est.stderr);
    const c = m ? Number(m[1].replace(/,/g, '')) : 0;
    spent += c;
    console.log(`  ${job.section}/${job.id}  ${job.duration ?? ''}s  ~${c}`);
    continue;
  }
  mkdirSync(path.dirname(job.out), { recursive: true });
  let done = false;
  for (let attempt = 1; attempt <= 12 && !done; attempt++) {
    const r = rundot(argv);
    const text = `${r.stdout}\n${r.stderr}`;
    const wait = /retry in (\d+) seconds?/i.exec(text);
    if (/content moderation/i.test(text)) { console.log(`  refused by content moderation (${job.id}): reword its prompt`); break; }
    if (wait) { console.log(`  rate limited (${job.id}), waiting ${wait[1]} s`); await sleep((Number(wait[1]) + 3) * 1000); continue; }
    const json = text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
    if (json && existsSync(job.out)) {
      const used = JSON.parse(json)?.credits?.used ?? 0;
      spent += used; made++; done = true;
      rmSync(`${job.out}.json`, { force: true });
      console.log(`  made ${job.section}/${job.id} (${used} credits, ${spent} so far)`);
    } else {
      console.log(`  attempt ${attempt} failed for ${job.id}: ${text.trim().split('\n').slice(-2).join(' | ').slice(0, 300)}`);
      await sleep(15000);
    }
  }
  if (!done) failed++;
}
console.log(dry ? `estimate: ${spent} credits` : `made ${made}, failed ${failed}, ${spent} credits`);
