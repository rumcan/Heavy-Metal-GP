import { useEffect, useMemo, useState } from 'react';
import { Flag, SlidersHorizontal, Trophy, CircleDot, ArrowRight, Coins, GraduationCap, Play, Square, Volume2 } from 'lucide-react';
import Dialog from './Dialog';
import ItemGlyph from './ItemGlyph';
import VoiceSubtitles from './VoiceSubtitles';
import TutorialRace from './story/TutorialRace';
import { completeTutorial, loadStory, saveStory } from '../game/story/state';
import type { StoryDriver } from '../game/story/state';
import { currentVoice, getVoiceSettings, playVoice, setVoiceEnabled, setVoiceVolume, stopVoice, subscribeVoice, voiceLines } from '../game/voice';
import { ITEM_INFO } from '../game/types';
import type { ItemType } from '../game/types';
import loopRing from '../assets/game/loop-ring.webp';
import fireHoop from '../assets/game/fire-hoop.webp';
import wreckingBall from '../assets/game/wrecking-ball.webp';
import sheepSpring from '../assets/game/sheep-spring.webp';
import bumper from '../assets/game/bumper-crown.webp';
import minecart from '../assets/game/minecart.webp';
import crate from '../assets/game/crate-tall.webp';

const HAZARDS: [string, string, string][] = [
  [loopRing, 'Loop-the-loop', 'Carry speed in. Too slow and you roll back out the bottom.'],
  [fireHoop, 'Fire hoop', 'Fly through the flames for a burst of speed.'],
  [wreckingBall, 'Wrecking ball', 'Swings across the drop. Time it or get launched.'],
  [sheepSpring, 'Spring sheep', 'Land on its back to launch up to the high ledges.'],
  [minecart, 'Minecart', 'Shuttles under the peg boards. Land in it for an express launch down.'],
  [bumper, 'Crown bumper', 'Solid iron. Bounce off and find a line around it.'],
  [crate, 'SMASH crate', 'Heavy marbles break through to the shortcut.'],
];

export default function RulesDialog({ onClose }: { onClose: () => void }) {
  // Voice settings (P2-03): read from storage, written straight back, and re-read if another
  // screen changes them. `raceAudio`'s mute (M) is separate and always wins.
  const [voice, setVoice] = useState(getVoiceSettings);
  const [spoken, setSpoken] = useState(currentVoice);
  // P2-13: the tutorial replays from here. While it runs it REPLACES the dialog — a race
  // cannot live inside the dialog shell — and afterwards the briefing comes back.
  const [playingTutorial, setPlayingTutorial] = useState(false);
  // The learner drives the story save's marble when there is one, a balanced goblin otherwise.
  const tutorialDriver = useMemo<StoryDriver>(() => loadStory()?.driver
    ?? { name: 'You', color: '#d63e2e', portrait: 0, stats: { weight: 5, speed: 5, bounce: 5 } }, [playingTutorial]);
  const endTutorial = () => {
    // A replay still banks completion, so a save that skipped long ago stops being asked.
    const saved = loadStory();
    if (saved) saveStory(completeTutorial(saved));
    setPlayingTutorial(false);
  };
  useEffect(() => subscribeVoice(() => { setVoice(getVoiceSettings()); setSpoken(currentVoice()); }), []);
  // The caption strip lives in this dialog, so closing it has to cut the line: audio talking
  // with no caption on screen is the one thing the player must never do.
  useEffect(() => stopVoice, []);
  // After every hook: returning before them crashed React ("Rendered fewer hooks") on Play the tutorial.
  if (playingTutorial) {
    return <div className="tutorial-takeover"><TutorialRace driver={tutorialDriver} subtitle="HOW TO PLAY · TRAINING GROUNDS" onDone={endTutorial} onSkip={endTutorial} /></div>;
  }
  const samples = voiceLines('samples');
  const playSamples = async () => {
    for (const line of samples) await playVoice('samples', line.id);
  };
  return <Dialog onClose={onClose} titleId="rules-title" className="rules-dialog">
    <span className="eyebrow"><Flag size={15} /> THE RACE BRIEFING</span>
    <h2 id="rules-title">Know your way down.</h2>
    <div className="rules-tutorial" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '12px 14px', marginBottom: 18, border: '1px solid rgba(125,211,252,0.35)', borderRadius: 12, background: 'rgba(125,211,252,0.07)' }}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45 }}>New to the drop? One voiced lap of the Training Grounds: steering, the Magic Engine, skills, jumps and shortcuts. Nobody can hurt you.</p>
      <button className="button-secondary" style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 8 }} onClick={() => { stopVoice(); setPlayingTutorial(true); }}><GraduationCap size={16} /> Play the tutorial</button>
    </div>
    <div className="rules-steps">
      <section><SlidersHorizontal /><div><h3>Build your advantage.</h3><p>Weight, speed, and bounce share 15 points. Heavy marbles break shortcut walls; bouncy ones clear jump lips. More speed means less drag.</p></div></section>
      <section><Trophy /><div><h3>Race for the championship.</h3><p>Six Grands Prix, three heats on the exact same circuit. Finishers score 25, 18, 15, 12, 10, 8, 6, 4, 2, or 1 point. The fastest heat of each GP adds one bonus point. Your teammate also scores for Apex Racing.</p></div></section>
      <section><CircleDot /><div><h3>Go three times farther.</h3><p>Circuits now have three times as many sectors. Hit blue or orange pegs and they pop away. Glowing, orbiting pegs contain the marked item. Drop into the minecart shuttling under a peg board for an express ride down. The course map shows the whole field and your camera position.</p></div></section>
      <section><Coins /><div><h3>Win credits. Stock your toolbar.</h3><p>Every finish pays 60 to 500 credits, plus 5 per orange peg. Spend them in the pit shop on eight single-use power-ups. Bought and collected charges carry over to your next race. Click a slot or press 1-8 to deploy; Space repeats your last selection. A/D or arrows nudge. P pauses the clock and every effect timer.</p></div></section>
    </div>
    <h3 className="rules-subhead">Track hazards</h3>
    <div className="rules-hazards">{HAZARDS.map(([src, name, desc]) => <div key={name}><img src={src} alt="" /><div><strong>{name}</strong><p>{desc}</p></div></div>)}</div>
    <h3 className="rules-subhead">Power-ups</h3>
    <div className="rules-items">{(Object.keys(ITEM_INFO) as ItemType[]).map((item) => <div key={item}><span style={{ color: ITEM_INFO[item].color }}><ItemGlyph item={item} /></span><div><strong>{ITEM_INFO[item].name}</strong><p>{ITEM_INFO[item].desc}</p></div></div>)}</div>
    <h3 className="rules-subhead"><Volume2 size={14} /> Voice</h3>
    <div className="voice-settings">
      <div className="voice-settings-row">
        <label className="voice-switch"><input type="checkbox" checked={voice.enabled} onChange={(e) => setVoiceEnabled(e.target.checked)} /><b>Voice-over</b></label>
        <span className="voice-settings-note">Goblin speech in the tutorial, story and Workshop tour.</span>
      </div>
      <div className="voice-settings-row">
        <span>Volume</span>
        <input type="range" min="0" max="1" step="0.05" value={voice.volume} disabled={!voice.enabled} aria-label="Voice volume" onChange={(e) => setVoiceVolume(Number(e.target.value))} />
        <output>{Math.round(voice.volume * 100)}%</output>
      </div>
      <p className="voice-settings-note">M mutes everything, voice included. Captions stay on, so you never miss a line.</p>
      {import.meta.env.DEV && <div className="voice-settings-row">
        <button className="text-button" disabled={!samples.length} onClick={() => (spoken.active ? stopVoice() : void playSamples())}>
          {spoken.active ? <Square size={13} /> : <Play size={13} />}{spoken.active ? 'Stop' : `Play the ${samples.length} voice samples`}
        </button>
        <span className="voice-settings-note">Dev only. Audio needs <code>node scripts/voice/generate.mjs --set samples</code>; the captions play either way.</span>
      </div>}
    </div>
    <VoiceSubtitles />
    <p className="rules-safety">A race marshal gently frees stationary marbles. A local reset is the last resort, applied equally to every racer. Freeze and oil penalties are never cancelled by recovery.</p>
    <button className="button-primary" onClick={onClose}>Let's race <ArrowRight size={17} /></button>
  </Dialog>;
}