/**
 * ACT I — THE ROOKIE (ST-04). Chapters 1–2: Marblehurst and Monte Pipo.
 *
 * The underdog walks in. Ace Spadegrin is the arrogant champion, Duchess Vex starts counting what Sprocket
 * is worth, Old Smokey agrees to teach, and The Hood says almost nothing from inside a folded shadow.
 *
 * Voice: full, plain sentences. Never assume the player knows racing words, the cast or the tracks:
 * every character is introduced when they first appear, and every track is described before it is raced.
 * Every line ≤ 90 characters.
 * This file owns Act I scenes, dialogue and objectives — nothing else.
 */
import type { ChapterDef, Line, Scene } from '../types';
import type { StoryProp } from '../assets';
import type { CastId } from '../cast';

const L = (who: CastId, mood: string, text: string, prop?: StoryProp): Line => (prop ? { who, mood, text, prop } : { who, mood, text });

export const ACT1_CHAPTERS: readonly ChapterDef[] = [
  {
    chapter: 1, act: 1, gp: 0, title: 'The Scrapyard Kid',
    objectives: [
      { id: 'c1-finish', label: 'Finish all three races', kind: 'finish', target: 1, scope: 'chapter' },
      { id: 'c1-ace', label: 'Finish a race ahead of Ace', kind: 'ahead', rival: 'ace', scope: 'heat', bonus: true, flag: 'beatAceEarly' },
    ],
  },
  {
    chapter: 2, act: 1, gp: 1, title: 'Street Smarts',
    objectives: [
      { id: 'c2-pegs', label: 'Hit 10 orange pegs in one race', kind: 'counter', counter: 'orangePegs', target: 10, scope: 'heat', flag: 'streetSmart' },
      { id: 'c2-hood', label: 'Finish a race ahead of The Hood', kind: 'ahead', rival: 'hood', scope: 'heat', bonus: true },
    ],
  },
];

export const ACT1_SCENES: readonly Scene[] = [
  // ── chapter 1: The Scrapyard Kid (Marblehurst) ────────────────────────────
  {
    id: 'c1-intro-yard', chapter: 1, trigger: 'intro', background: 'scrapyard-at-dusk',
    lines: [
      L('sprocket', 'happy', 'My name is Sprocket, and I have lived in this scrapyard my whole life.'),
      L('sprocket', 'happy', 'Every year, the goblins hold a marble racing season called the Heavy Metal GP.'),
      L('sprocket', 'smug', 'Ten goblin drivers each steer a marble down a giant track full of traps.'),
      L('sprocket', 'happy', 'The season visits six different tracks, and the best driver overall is champion.'),
      L('sprocket', 'smug', 'I built my own racing marble out of an old ball bearing and a bolt.'),
      L('sprocket', 'happy', 'All I need now is a racing team that will let me drive it.'),
      L('zapp', 'surprised', 'Hey! You are the kid who keeps climbing over my fence to watch the races.'),
      L('zapp', 'happy', 'I am Zapp Gutwrench, the mechanic for Apex Racing, the team next door.'),
      L('sprocket', 'shocked', 'Apex Racing? Is it true that your best driver disappeared last season?'),
      L('zapp', 'angry', 'It is true. They missed the last race, and nobody has heard from them since.'),
      L('zapp', 'sad', 'Now Apex has an empty seat, no money, and a new season starting this week.'),
      L('sprocket', 'smug', 'Then give that seat to me. I work cheap, and my marble really does roll.'),
    ],
  },
  {
    id: 'c1-intro-tryout', chapter: 1, trigger: 'intro', background: 'apex-racing-garage',
    lines: [
      L('zapp', 'smug', 'All right, kid, I will give you one chance. Listen carefully.'),
      L('zapp', 'happy', 'Each track in the season hosts three races in a row, and you drive in all three.'),
      L('zapp', 'happy', 'If you finish all three races at the first track, the Apex seat is yours.'),
      L('sprocket', 'happy', 'Where is the first track, and what is it like?'),
      L('zapp', 'happy', 'It is called Marblehurst, and it is the track where every season begins.'),
      L('zapp', 'happy', 'It has a little bit of everything, so it is a fair test for a new driver.'),
      L('zapp', 'angry', 'Steer left and right to choose your path, and try not to bounce off the walls.'),
      L('zapp', 'smug', 'Grab the item crates on the way down, because items can win you a race.'),
      L('sprocket', 'smug', 'Steer, grab crates, and do not hit walls. That sounds easy enough to me.', 'wrench-and-bolt'),
      L('zapp', 'smug', 'Every new driver says that before Marblehurst. Very few say it afterwards.'),
    ],
  },
  {
    id: 'c1-pre-grid', chapter: 1, trigger: 'pre-race', background: 'grandstand-race-day',
    lines: [
      L('ace', 'smug', 'Did Apex Racing really hire a goblin who smells like a rusty bucket?'),
      L('zapp', 'angry', 'Ignore him, kid. That is Ace Spadegrin, the champion from last season.'),
      L('ace', 'smug', 'I have won the championship twice, and you are driving a bolt with ideas.'),
      L('vex', 'smug', 'Be nice, Ace. Every champion was a nobody once, even you.'),
      L('sprocket', 'shocked', 'Zapp, who is the lady in the fancy hat?'),
      L('zapp', 'sad', 'That is Duchess Vex. She owns a rival team and lends money to half the drivers.'),
      L('vex', 'happy', 'I always notice new drivers, Sprocket. They are so easy to put a price on.'),
      L('ace', 'angry', 'Enjoy the start line, rookie, because you will not see me again after it.'),
    ],
  },
  {
    id: 'c1-mid-ace', chapter: 1, trigger: 'mid-race', atSector: 5, background: 'grandstand-race-day',
    lines: [L('ace', 'angry', 'Get out of my way, scrapyard goblin, this is my racing line!')],
  },
  {
    id: 'c1-mid-grubba', chapter: 1, trigger: 'mid-race', atSector: 17, background: 'grandstand-race-day',
    lines: [L('grubba', 'happy', 'I am Big Grubba, and I always squash the new drivers!')],
  },
  {
    id: 'c1-post-win', chapter: 1, trigger: 'post-win', outcome: 'win', background: 'grandstand-race-day',
    lines: [
      L('ace', 'shocked', 'A marble made from a ball bearing and a bolt just beat me at Marblehurst?'),
      L('vex', 'surprised', 'How interesting. The little scrapyard goblin can actually race.'),
      L('zapp', 'happy', 'You finished all three races and came out on top, kid. The Apex seat is yours.'),
      L('ace', 'angry', 'Enjoy it while it lasts, rookie. The next track is full of walls.'),
    ],
  },
  {
    id: 'c1-post-podium', chapter: 1, trigger: 'post-podium', outcome: 'podium', background: 'grandstand-race-day',
    lines: [
      L('sprocket', 'happy', 'I finished in the top three at my very first track!'),
      L('ace', 'smug', 'Third place is where scrap belongs, so do not get too excited.'),
      L('zapp', 'happy', 'A top three finish on your first try is great. The Apex seat is yours.'),
      L('vex', 'happy', 'People with money will start asking about you now, Sprocket.'),
    ],
  },
  {
    id: 'c1-post-loss', chapter: 1, trigger: 'post-loss', outcome: 'loss', background: 'grandstand-race-day',
    lines: [
      L('sprocket', 'sad', 'I think I bounced off every single wall in Marblehurst.'),
      L('red', 'surprised', 'Everybody has a terrible first race, rookie. My marble caught fire in mine.'),
      L('zapp', 'sad', 'You still finished all three races, and that was our deal. The seat is yours.'),
      L('ace', 'smug', 'Keep that seat warm, rookie, until Apex finds a real driver.'),
    ],
  },
  {
    id: 'c1-outro-yard', chapter: 1, trigger: 'outro', background: 'scrapyard-at-dusk',
    lines: [
      L('zapp', 'happy', 'Our next track is Monte Pipo, which runs through the streets of a harbour town.'),
      L('zapp', 'angry', 'The streets are narrow and the corners are tight, so passing people is hard.'),
      L('sprocket', 'smug', 'Then I will get in front at the start and stay there the whole way.'),
      L('zapp', 'surprised', 'You need a proper teacher, kid, and I know an old goblin who can help.'),
    ],
  },

  // ── chapter 2: Street Smarts (Monte Pipo) ─────────────────────────────────
  {
    id: 'c2-intro-shack', chapter: 2, trigger: 'intro', background: 'old-smokey-training-shack',
    sets: ['metSmokey'],
    lines: [
      L('sprocket', 'shocked', 'Zapp, there is an old goblin asleep in the shed behind our garage.'),
      L('smokey', 'angry', 'I am not asleep. I am thinking with my eyes closed, which is different.'),
      L('zapp', 'happy', 'Sprocket, this is Old Smokey. He raced in the very first Heavy Metal GP.'),
      L('smokey', 'sad', 'I raced in it and I lost it. I have fixed marbles in this shed ever since.', 'old-racing-helmet'),
      L('sprocket', 'happy', 'Will you teach me how to race? I have never driven on a street track before.'),
      L('smokey', 'smug', 'Here is your first lesson. Do you see the orange pegs sticking out of the track?'),
      L('smokey', 'happy', 'Every orange peg you hit gives you credits, and credits buy you items.'),
      L('smokey', 'smug', 'Most new drivers ignore the pegs. Good drivers bounce off as many as they can.'),
      L('smokey', 'happy', 'Hit ten orange pegs in a single race at Monte Pipo, and I will teach you more.'),
    ],
  },
  {
    id: 'c2-pre-street', chapter: 2, trigger: 'pre-race', background: 'grandstand-race-day',
    lines: [
      L('red', 'angry', 'A narrow street track and a rookie with a bent marble. This will be fun to watch.'),
      L('sprocket', 'happy', 'I do not think we have met. Who are you?'),
      L('red', 'happy', 'I am Red Morrigan. Remember my braid, because you will watch it pass you.'),
      L('vex', 'smug', 'Hello again, Sprocket. I started keeping a file on you, but it is very thin.'),
      L('sprocket', 'smug', 'It is thin because I only just started racing.'),
      L('vex', 'happy', 'No, darling. It is thin because nobody has bought you yet.'),
    ],
  },
  {
    id: 'c2-pre-ace-wary', chapter: 2, trigger: 'pre-race', background: 'grandstand-race-day',
    when: { flag: 'beatAceEarly' },
    lines: [
      L('ace', 'angry', 'You only beat me at Marblehurst because my marble had a loose bolt.'),
      L('sprocket', 'smug', 'Of course it did, champion. I am sure that is exactly what happened.'),
      L('ace', 'smug', 'Say that again at the finish line, if you somehow get there before me.'),
    ],
  },
  {
    id: 'c2-mid-hood', chapter: 2, trigger: 'mid-race', atSector: 9, background: 'grandstand-race-day',
    lines: [
      L('hood', 'stern', 'You will not reach the finish line ahead of me, rookie.'),
      L('sprocket', 'shocked', 'Who is that driver in the hood? I never saw their face at the start.'),
    ],
  },
  {
    id: 'c2-mid-smokey', chapter: 2, trigger: 'mid-race', atSector: 20, background: 'old-smokey-training-shack',
    lines: [L('smokey', 'angry', 'Hit the orange pegs, kid! Every single one of them is worth credits!')],
  },
  {
    id: 'c2-post-win', chapter: 2, trigger: 'post-win', outcome: 'win', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'smug', 'You won at Monte Pipo. Your steering was messy, but you went after the pegs.'),
      L('sprocket', 'smug', 'Were you actually counting how many pegs I hit?'),
      L('smokey', 'happy', 'I have counted pegs in every race since my first season. It is an old habit.'),
      L('ace', 'angry', 'Who taught that scrapyard goblin how to race like that?'),
    ],
  },
  {
    id: 'c2-post-podium', chapter: 2, trigger: 'post-podium', outcome: 'podium', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'happy', 'A top three finish at Monte Pipo. Most new drivers leave that town in pieces.'),
      L('sprocket', 'happy', 'Does that mean I passed your lesson?'),
      L('smokey', 'smug', 'It means you are close. In my shed, being close is worth a lot.'),
    ],
  },
  {
    id: 'c2-post-loss', chapter: 2, trigger: 'post-loss', outcome: 'loss', background: 'old-smokey-training-shack',
    lines: [
      L('sprocket', 'sad', 'The walls at Monte Pipo do not move. I checked many times, with my marble.'),
      L('smokey', 'angry', 'Good. Now you know where those walls are. Most drivers take a year to learn that.'),
      L('smokey', 'sad', 'I hit that same corner in my first season. I still remember the sound it made.'),
    ],
  },
  {
    id: 'c2-outro-hood', chapter: 2, trigger: 'outro', background: 'pit-lane-at-night',
    sets: ['hoodSeen'],
    lines: [
      L('sprocket', 'happy', 'The pit lane is so quiet at night, once all the races are over.'),
      L('hood', 'stern', 'You steer your marble just like someone I used to know.'),
      L('sprocket', 'shocked', 'You are the driver in the hood from today. Who are you?'),
      L('hood', 'smirk', 'Nobody you need to worry about yet. Keep an eye on your bolts, rookie.'),
      L('sprocket', 'sad', 'Wait! Who do I drive like? Please tell me.'),
      L('hood', 'grimace', 'Ask Old Smokey why he never talks about the old mine under the last track.'),
    ],
  },
];
