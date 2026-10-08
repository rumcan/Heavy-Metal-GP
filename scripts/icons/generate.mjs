#!/usr/bin/env node
/**
 * Skill button art for the 16 skills added in P2-08 and the 20 premium skills (the first 8 have hand-made art in
 * src/assets/ui/item-*.webp).
 * Each button is generated in the same style as the originals (they are passed as reference images): a riveted iron and
 * red-wood plaque, a painted icon in the middle, the skill's name on the cream label and a chequered strip below.
 *
 *     node scripts/icons/generate.mjs --dry-run          # what would be generated, and the credit estimate
 *     node scripts/icons/generate.mjs                    # generate every missing one
 *     node scripts/icons/generate.mjs --only shield,ram  # just these
 *     node scripts/icons/generate.mjs --force bomb       # regenerate this one
 *
 * Output: src/assets/ui/item-<id>.webp, 309x240 with transparency (the size of the originals), webp under 40 KB.
 * Needs `rundot` logged in and `sharp` (a dev dependency already).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UI = path.join(ROOT, 'src', 'assets', 'ui');
const REFERENCES = ['item-rocket.webp', 'item-freeze.webp', 'item-shock.webp'].map((f) => path.join(UI, f));
const CREDITS_EACH = 147;
const MODEL = 'gemini-3.1-flash-image-preview';
/** The rundot CLI (no shell: the prompts are long and full of spaces). Override with RUNDOT_CLI. */
const RUNDOT = process.env.RUNDOT_CLI || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Rundot', 'rundot.exe') : 'rundot');

/** id, the label painted on the plaque, and what the icon shows. */
export const ICONS = [
  ['shield', 'Bubble Shield', 'a glowing translucent blue soap-bubble force field dome with a small steel shield inside'],
  ['ram', 'Battering Ram', 'a heavy iron-capped wooden battering ram log charging forward with motion lines'],
  ['repair', 'Repair Kit', 'a green first-aid toolbox with a crossed wrench and bandage, a small green heart glowing'],
  ['brake', 'Air Brake', 'a grey parachute air brake billowing open behind a small rusty iron plate'],
  ['bolt', 'Homing Bolt', 'an orange glowing crossbow bolt curving through the air toward a red target reticle'],
  ['overdrive', 'Overdrive', 'a red speedometer gauge with the needle slammed into the red zone, flames bursting out'],
  ['spikes', 'Caltrops', 'a scatter of four sharp grey iron caltrop spikes on the ground'],
  ['decoy', 'Decoy', 'two identical golden marbles side by side, one of them half transparent like a hologram'],
  ['grapple', 'Grapple Hook', 'a three-pronged iron grappling hook flying on a brown rope'],
  ['bomb', 'Sticky Bomb', 'a round black bomb dripping green sticky goo with a lit fizzing fuse'],
  ['reflect', 'Mirror Plate', 'a polished silver mirror shield reflecting a bright beam back with a flash'],
  ['blink', 'Blink', 'a purple marble teleporting: a burst of violet sparkles and a faded copy of the marble behind it'],
  ['emp', 'EMP', 'a crackling cyan electric pulse ring expanding from a small black device with an antenna'],
  ['lightning', 'Lightning Strike', 'a bright yellow lightning bolt striking down from a dark storm cloud'],
  ['drill', 'Drill', 'a big spinning steel drill bit boring downward through rock with dust flying'],
  ['charm', "Shaman's Charm", 'a green glowing goblin shaman totem charm on a cord with feathers and a carved skull bead'],
  // the owner's twenty premium spells and weapons (src/game/skills/premium.ts)
  ['swap', 'Soul Swap', 'two marbles, one magenta and one gold, trading places along two curved magenta arrows with a swirl of magic sparks'],
  ['telekinesis', 'Telekinesis', 'a glowing violet magic hand lifting a small marble into the air with purple psychic waves'],
  ['well', 'Gravity Well', 'a small swirling black hole with a purple accretion ring sucking in sparkles'],
  ['warp', 'Time Warp', 'an ornate golden hourglass with glowing amber sand and a clock face warping behind it'],
  ['rewind', 'Rewind', 'a cyan glowing clock with its hands spinning backward and a curved rewind arrow around it'],
  ['shrink', 'Shrink Hex', 'a pink magic wand zapping a tiny marble that is shrinking, with a pink hex sigil'],
  ['bubble', 'Bubble Trap', 'a big shiny translucent cyan bubble with a tiny marble trapped floating inside'],
  ['leech', 'Life Leech', 'a crimson vampire fang tether draining red glowing drops of life along a red ribbon'],
  ['chain', 'Chain Lightning', 'pale blue forked lightning jumping between three small marbles in a chain'],
  ['twin', 'Shadow Twin', 'a red marble and its dark smoky shadow copy following right behind it with violet eyes'],
  ['thorns', 'Thorn Shell', 'a green marble covered in sharp wooden thorns and vines like a spiky shell'],
  ['spikewall', 'Spike Wall', 'a tall iron wall bristling with sharp steel spikes rising out of the ground with dust'],
  ['mines', 'Mine Field', 'three round iron landmines half buried in dirt, each with a blinking red light'],
  ['cluster', 'Cluster Bomb', 'a black bomb bursting open into four small bomblets flying out with orange sparks'],
  ['megabomb', 'Mega Bomb', 'a huge black bomb with a skull and crossbones and a radiation symbol, fuse lit, sparks flying'],
  ['blades', 'Orbit Blades', 'three spinning silver circular saw blades orbiting around a small marble with motion trails'],
  ['boomerang', 'Boomerang', 'a carved golden wooden boomerang spinning through the air with curved motion lines'],
  ['laser', 'Laser Beam', 'a bright red laser beam firing out of a small brass cannon lens with a hot glow'],
  ['turret', 'Sentry Turret', 'a small steel goblin sentry turret on a tripod with a barrel firing a tracer round'],
  ['blank', 'Blank', 'a brilliant white shockwave ring bursting outward and shattering little bullets into dust'],
];

function parse(argv) {
  const out = { dryRun: false, only: null, force: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--only') out.only = new Set(argv[++i].split(','));
    else if (a === '--force') argv[++i].split(',').forEach((id) => out.force.add(id));
  }
  return out;
}

const promptFor = (label, icon) => [
  'A game UI skill button, exactly the same style, frame, size and layout as the reference images:',
  'a landscape plaque made of a dark slate-grey painted panel inside a chunky red-and-orange painted wooden frame with',
  'big riveted iron corner brackets, a cream painted label banner across the bottom third with dark brown bold text,',
  'and a small black-and-white chequered strip under the label.',
  `The label reads exactly "${label}" (spelled exactly like that, nothing else written anywhere).`,
  `In the middle of the slate panel, a bold, chunky, hand-painted icon: ${icon}.`,
  'The icon must read clearly when the whole button is shown at 40 pixels wide. Painted cartoon fantasy style, rich colour,',
  'soft rim lighting, the same brush style as the references. Plain empty background around the plaque.',
].join(' ');

async function main() {
  const args = parse(process.argv.slice(2));
  const todo = ICONS.filter(([id]) => (!args.only || args.only.has(id)) && (args.force.has(id) || !existsSync(path.join(UI, `item-${id}.webp`))));
  console.log(`${todo.length} icon(s) to generate: ${todo.map(([id]) => id).join(', ') || 'none'}`);
  console.log(`estimate: ${todo.length * CREDITS_EACH} credits (${CREDITS_EACH} each, ${MODEL} with background removal)`);
  if (args.dryRun || !todo.length) return;
  const sharp = (await import('sharp')).default;
  const work = path.join(tmpdir(), 'hmgp-icons');
  mkdirSync(work, { recursive: true });
  for (const [id, label, icon] of todo) {
    const raw = path.join(work, `${id}.png`);
    rmSync(raw, { force: true });
    const cli = ['generate', 'image', '--model', MODEL, '--aspect-ratio', '4:3', '--remove-background', '--out', raw, '--prompt', promptFor(label, icon)];
    for (const ref of REFERENCES) cli.push('--reference-image', ref);
    console.log(`→ ${id} (${label})`);
    // The image service rate-limits bursts: wait as long as it asks and try again (a few times).
    let r = spawnSync(RUNDOT, cli, { encoding: 'utf8', cwd: ROOT });
    for (let attempt = 0; attempt < 6 && (r.status !== 0 || !existsSync(raw)); attempt++) {
      const wait = Number(/retry in (d+) seconds/.exec(`${r.stdout}${r.stderr}`)?.[1] ?? 20) + 2;
      console.log(`  busy, retrying in ${wait} s`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait * 1000);
      r = spawnSync(RUNDOT, cli, { encoding: 'utf8', cwd: ROOT });
    }
    if (r.status !== 0 || !existsSync(raw)) { console.error(`  failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ')}`); continue; }
    const out = path.join(UI, `item-${id}.webp`);
    await sharp(raw).trim({ threshold: 4 }).resize(309, 240, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80, alphaQuality: 90, effort: 6 }).toFile(out);
    const { size } = (await import('node:fs')).statSync(out);
    console.log(`  saved ${path.relative(ROOT, out)} (${Math.round(size / 1024)} KB)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
