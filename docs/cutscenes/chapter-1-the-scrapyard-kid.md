# Heavy metal GP: Chapter 1, "The Scrapyard Kid" (cut-scene script)

Act I: The Rookie. The track is Marblehurst Grand Prix.

This is a shot-by-shot script for a video AI. The dialogue is word for word from the game (`src/game/story/script/act1.ts`). The descriptions of places, faces and actions come from the story art listed next to each scene. Attach those images as references.

---

## Global style (paste this at the top of every prompt)

- **Look:** painted, chunky fantasy-cartoon style with warm light and heavy texture, like a hand-painted game cinematic. Rusty iron, riveted steel, weathered wood and torn red cloth everywhere.
- **Colour:** midnight navy shadows, rust brown, parchment cream, race red (#D63E2E). The racing brand is a white crown on red banners.
- **World:** goblins race giant steel marbles down huge wooden-and-iron tracks. The tracks have loops, ramps and waterfalls, and hang on towers along cliffs.
- **Characters:** goblins with big pointed ears, oversized heads, expressive faces, leather jackets, goggles and rivets. Small bodies, big attitudes. Keep each goblin's face, colours and costume the same in every shot.
- **Camera:** mostly medium and close shots for dialogue, with a wide establishing shot at the start of each scene. Slow push-ins on important lines.
- **Mood:** cheeky, loud and underdog-hopeful. Comedy first, heart second.

## Cast in Chapter 1 (reference images)

| Character | Look (keep consistent) | Personality | Reference art |
|---|---|---|---|
| **Sprocket** (hero) | Young green goblin. Brown leather aviator cap with round blue goggles pushed up, sharp toothy grin, scruffy brown leather jacket. | Cocky, scrappy, hopeful rookie. Talks big. | `src/assets/story/portraits/sprocket_*.webp` (happy, smug, sad, shocked) |
| **Zapp Gutwrench** | Orange-yellow goblin with a spiky purple mohawk, big brass goggles on his forehead, black leather jacket with a yellow lightning-bolt patch. | Apex Racing's mechanic. Gruff but kind, grumbles, secretly roots for the kid. | `src/assets/story/portraits/zapp-gutwrench_*.webp` |
| **Ace Spadegrin** | Green goblin in a white-and-red racing helmet with a black spade on it, green goggles, red scarf, brown leather jacket. | Two-time champion. Arrogant, sneering, loud. | `src/assets/story/portraits/ace-spadegrin_*.webp` |
| **Duchess Vex** | Pink-skinned goblin woman, tall white hair in a bun, brass goggles, earrings, white fur collar. Fancy and elegant. | Owns a rival team and lends drivers money. Silky, amused, always pricing people up. | `src/assets/story/portraits/duchess-vex_*.webp` |
| **Big Grubba** (mid-race only) | Huge round green goblin, aviator cap and goggles, leather jacket with a "8" patch. | Heavy, happy bully. | `src/assets/portraits/r02_happy.webp` |
| **Red Morrigan** (loss ending only) | Green goblin woman with long, thick red braided hair and goggles. | Sharp-tongued rival with a soft spot. | `src/assets/portraits/r07_surprised.webp` |

**Sprocket's marble:** a heavy steel ball covered in rivets, painted with a big red crown. It sits on an anvil in the scrapyard. The same ball stands on a red cushioned stand in the Apex garage.

**Title card:** `src/assets/story/titles/act-1-the-rookie.webp`, then `src/assets/story/titles/chapter-1-the-scrapyard-kid.webp`.

---

## Scene 0: Title cards (about 6 s)

**Reference:** the two title images above.

1. Black screen. A rusty iron sign with a skull on top slams down into frame with a metallic clang and a puff of dust: **"ACT I: THE ROOKIE"**. It shakes and settles.
2. It swings off-screen. A wooden plank sign bolted with iron, with a wrench painted on its left, swings in on chains: **"CHAPTER 1: THE SCRAPYARD KID"**.
3. Hold for a beat, then fade to warm orange sunset light.

---

## Scene 1: The scrapyard at dusk (about 60 s)

**Background:** `src/assets/story/backgrounds/scrapyard-at-dusk.webp`

**Setting:** a huge goblin junkyard at sunset. Mountains of rusty gears, chains, barrels and broken track pieces. A giant broken loop wheel stands on the left. A little lamp-lit workshop shack is covered in torn red crown banners. In the foreground, a steel marble painted with a red crown sits on a black anvil. In the far distance, glowing racing towers, loops and waterfalls stand against a golden sky with the sun setting. Dust drifts in the warm light.

**Shot list:**

1. **Wide establishing shot, slow drift left to right** across the junk piles toward the distant racing towers. A few banners flap. A crane chain creaks and swings.
2. **Push in on the anvil.** Sprocket's hand slaps down proudly on top of the crown marble. We pan up to Sprocket, who leans on the anvil grinning, the sunset behind him.
   - **Sprocket** (happy, speaking to the camera): *"My name is Sprocket, and I have lived in this scrapyard my whole life."*
3. **Sprocket climbs onto a stack of crates** and points dramatically at the distant racing towers and loops.
   - **Sprocket** (happy): *"Every year, the goblins hold a marble racing season called the Heavy Metal GP."*
4. **Quick imagination cut** (a painted daydream look with a slightly faded edge): ten goblin marbles thunder down a giant wooden track full of loops and traps. Sparks and chunks of wood fly.
   - **Sprocket** (smug, voice-over): *"Ten goblin drivers each steer a marble down a giant track full of traps."*
   - **Sprocket** (happy, voice-over): *"The season visits six different tracks, and the best driver overall is champion."*
5. **Back in the scrapyard.** Sprocket hops down, spins the marble on the anvil with one finger and polishes it with his sleeve. He shows off a bolt in his other hand.
   - **Sprocket** (smug): *"I built my own racing marble out of an old ball bearing and a bolt."*
6. **Sprocket rests his chin on top of the marble** and gazes at the towers, wistful.
   - **Sprocket** (happy, softer): *"All I need now is a racing team that will let me drive it."*
7. **A loud CLANG off-screen.** A rusty fence panel falls over. **Zapp Gutwrench** stomps through the gap with a huge wrench on his shoulder, goggles up and mohawk bouncing. He points the wrench at Sprocket.
   - **Zapp** (surprised): *"Hey! You are the kid who keeps climbing over my fence to watch the races."*
8. **Zapp plants the wrench** on the ground like a walking stick and thumbs at his lightning-bolt patch.
   - **Zapp** (happy): *"I am Zapp Gutwrench, the mechanic for Apex Racing, the team next door."*
9. **Sprocket's eyes go huge.** He scrambles right up to Zapp's face.
   - **Sprocket** (shocked): *"Apex Racing? Is it true that your best driver disappeared last season?"*
10. **Zapp's face darkens.** He looks away toward the distant towers, jaw tight.
    - **Zapp** (angry): *"It is true. They missed the last race, and nobody has heard from them since."*
11. **Zapp's shoulders slump.** He kicks a pebble and turns out an empty pocket.
    - **Zapp** (sad): *"Now Apex has an empty seat, no money, and a new season starting this week."*
12. **Sprocket slaps his marble**, which rolls off the anvil and straight into Zapp's boot. Zapp stops it with his foot. Sprocket grins his biggest grin and thumbs at himself.
    - **Sprocket** (smug): *"Then give that seat to me. I work cheap, and my marble really does roll."*
13. **Hold on Zapp** looking down at the marble under his boot, then up at Sprocket. He raises one eyebrow. Cut.

---

## Scene 2: The try-out in the Apex Racing garage (about 50 s)

**Background:** `src/assets/story/backgrounds/apex-racing-garage.webp`

**Setting:** a cluttered wooden-and-iron team garage lit by one hanging warm lamp. A big "APEX RACING" banner with a white crown hangs over walls of wrenches and gears, with red crown pennants strung across the ceiling. In the centre, a giant riveted steel marble with a red crown sits on a red cushioned stand. On the right, a chalkboard shows a squiggly track map, a goblin face and the words "FASTER! HIGHER! BIGGER!" with the checklist "BUILD, TUNE, RACE, WIN!". Red toolboxes, a stool and a stack of tyres fill the room. Through the big door on the left, you can see the racing towers and a loop at sunset.

**Shot list:**

1. **Wide shot.** Zapp hauls open the big garage door. Warm light floods in. Sprocket runs in behind him, gasping at everything, and presses his face against the giant marble.
   - **Zapp** (smug, arms crossed): *"All right, kid, I will give you one chance. Listen carefully."*
2. **Zapp walks to the chalkboard** and taps it with his wrench. Chalk dust puffs off.
   - **Zapp** (happy): *"Each track in the season hosts three races in a row, and you drive in all three."*
3. **Zapp draws three big chalk ticks.** Sprocket leans in beside him, nodding fast.
   - **Zapp** (happy): *"If you finish all three races at the first track, the Apex seat is yours."*
4. **Sprocket spins the stool around** and sits backwards on it, eager.
   - **Sprocket** (happy): *"Where is the first track, and what is it like?"*
5. **Zapp points out of the open garage door** at the distant loops and towers. The camera follows his arm out to the view.
   - **Zapp** (happy): *"It is called Marblehurst, and it is the track where every season begins."*
   - **Zapp** (happy): *"It has a little bit of everything, so it is a fair test for a new driver."*
6. **Zapp mimes steering**, leaning his whole body left and right, then winces and mimes smacking into a wall.
   - **Zapp** (angry, jabbing a finger): *"Steer left and right to choose your path, and try not to bounce off the walls."*
7. **Zapp kicks a small wooden item crate** across the floor to Sprocket.
   - **Zapp** (smug): *"Grab the item crates on the way down, because items can win you a race."*
8. **Sprocket catches the crate**, pulls a wrench and bolt out of it (prop: `src/assets/story/props/wrench-and-bolt.webp`) and twirls the wrench like a gunslinger.
   - **Sprocket** (smug): *"Steer, grab crates, and do not hit walls. That sounds easy enough to me."*
9. **Close-up on Zapp**, deadpan, one eye half-closed. Behind him, a trophy on the shelf wobbles and falls over with a clunk.
   - **Zapp** (smug): *"Every new driver says that before Marblehurst. Very few say it afterwards."*
10. Cut to black.

---

## Scene 3: Race day at the grandstand, before the race (about 45 s)

**Background:** `src/assets/story/backgrounds/grandstand-race-day.webp`

**Setting:** a sunny, packed goblin race paddock. Tall wooden grandstands on the left are crammed with cheering goblins under an "APEX RACING" banner and a "GO LOUDER BIGGER FASTER!" banner. Red and chequered tents and toolboxes line a muddy dirt lane. A red crown airship floats in a blue sky with fluffy clouds. In the background, huge track towers, two wooden loops and waterfalls pour off the cliffs. On the right, a giant wooden leaderboard numbered 1 to 8 stands beside a "SMALL GOBLINS BIG DREAMS" banner. Stacks of tyres, puddles and bunting everywhere.

**Shot list:**

1. **Wide crane shot** down from the airship over the roaring crowd to the paddock lane. Sprocket walks in carrying his crown marble under one arm, and Zapp walks beside him. Sprocket waves at the crowd; nobody waves back.
2. **Ace Spadegrin swaggers in front of them**, spinning his helmet strap, and blocks the path. He sniffs the air and pinches his nose.
   - **Ace** (smug): *"Did Apex Racing really hire a goblin who smells like a rusty bucket?"*
3. **Zapp steps between them** and pushes Sprocket back with one arm, glaring at Ace.
   - **Zapp** (angry, muttering to Sprocket): *"Ignore him, kid. That is Ace Spadegrin, the champion from last season."*
4. **Ace holds up two fingers** right in Sprocket's face, then flicks the bolt sticking out of Sprocket's marble.
   - **Ace** (smug): *"I have won the championship twice, and you are driving a bolt with ideas."*
5. **Duchess Vex glides in** from the side, fur collar and white hair gleaming in the sun, and lays one gloved hand on Ace's shoulder. Ace stiffens.
   - **Vex** (smug): *"Be nice, Ace. Every champion was a nobody once, even you."*
6. **Sprocket tugs Zapp's sleeve** and whispers out of the side of his mouth, staring at Vex.
   - **Sprocket** (shocked, whispering): *"Zapp, who is the lady in the fancy hat?"*
7. **Zapp's face falls.** He leans down to Sprocket and keeps his eyes on Vex.
   - **Zapp** (sad, low): *"That is Duchess Vex. She owns a rival team and lends money to half the drivers."*
8. **Vex bends down to Sprocket's height** and lifts his chin with one finger, smiling like she is reading a price tag.
   - **Vex** (happy): *"I always notice new drivers, Sprocket. They are so easy to put a price on."*
9. **Ace jams his spade helmet on**, snaps the goggles down and walks backwards toward the start gate, pointing at Sprocket.
   - **Ace** (angry): *"Enjoy the start line, rookie, because you will not see me again after it."*
10. **Close-up on Sprocket** gulping, then setting his jaw and pulling his blue goggles down. Crowd roar swells. Cut to the race.

---

## Scene 4: The race at Marblehurst (gameplay, with two mid-race call-outs)

**Background for the call-outs:** `src/assets/story/backgrounds/grandstand-race-day.webp`. Race art comes from the game's sprite kit (`src/assets/game/`).

**Setting:** a giant vertical marble run. Wooden plank ramps with iron end caps zigzag down between riveted steel walls. Glowing blue and orange gems act as pegs, and a red crown bumper sends marbles flying. Crates with "?" hold items, red boost strips carry arrows, and a chequered finish banner waits at the bottom. Ten coloured steel marbles race down at once.

**Start:**

1. **Five pairs of red start lights** light one at a time over the start gate. Ten marbles wobble in a line on a hazard-striped gate. Sprocket's crown marble sits in the middle.
2. **Lights out.** The gate drops, and all ten marbles plunge down the first ramp in a clatter of sparks.

**Call-out 1, sector 5: Ace barges past**

3. **Sprocket's marble takes a clean line** down a wooden ramp. **Ace's marble** slams into it from behind, knocks it sideways into a steel wall and bounces ahead.
4. **Picture-in-picture comic panel** pops up in a corner: Ace's angry face in a speech bubble.
   - **Ace** (angry): *"Get out of my way, scrapyard goblin, this is my racing line!"*
5. **Sprocket's marble recovers**, grabs a "?" crate and gets a speed boost. Flames trail behind it.

**Call-out 2, sector 17: Big Grubba squashes**

6. **A huge, heavy marble** (Grubba's) drops onto a ramp right beside Sprocket's. The whole ramp bends and shakes, and smaller marbles bounce off it like popcorn.
7. **Comic panel pops up:** Grubba's big happy face.
   - **Grubba** (happy): *"I am Big Grubba, and I always squash the new drivers!"*
8. **Sprocket's marble squeezes through a gap** between Grubba's marble and a wall, pings off a string of orange gems and heads for the chequered finish banner.

**Finish:** marbles cross under the chequered banner. The result decides which ending plays: Scene 5A, 5B or 5C.

---

## Scene 5A: After the race, Sprocket wins (about 25 s)

**Background:** `src/assets/story/backgrounds/grandstand-race-day.webp`

1. **Sprocket's crown marble rolls to a stop** in the paddock. Its steel is scratched and it smokes a little. Sprocket pops out on top of it with his arms up, and the crowd roars. The leaderboard flips a plank to put Sprocket's name at number 1.
2. **Ace's marble rolls in second.** Ace climbs out, rips his helmet off and stares at the bolt on Sprocket's marble in disbelief.
   - **Ace** (shocked): *"A marble made from a ball bearing and a bolt just beat me at Marblehurst?"*
3. **Vex watches from a tent's shade** and taps a folded fan against her chin, eyes narrowed with interest.
   - **Vex** (surprised): *"How interesting. The little scrapyard goblin can actually race."*
4. **Zapp runs over**, grabs Sprocket in a headlock hug and ruffles his cap.
   - **Zapp** (happy): *"You finished all three races and came out on top, kid. The Apex seat is yours."*
5. **Ace storms off**, and over his shoulder points at the distant track.
   - **Ace** (angry): *"Enjoy it while it lasts, rookie. The next track is full of walls."*

## Scene 5B: After the race, Sprocket finishes on the podium (about 20 s)

**Background:** `src/assets/story/backgrounds/grandstand-race-day.webp`

1. **Sprocket bounces up and down** on top of his marble, holding up three fingers. The leaderboard shows his name in 3rd.
   - **Sprocket** (happy): *"I finished in the top three at my very first track!"*
2. **Ace strolls past** polishing his helmet and doesn't even look at him.
   - **Ace** (smug): *"Third place is where scrap belongs, so do not get too excited."*
3. **Zapp claps Sprocket on the back** so hard the kid nearly falls off the marble.
   - **Zapp** (happy): *"A top three finish on your first try is great. The Apex seat is yours."*
4. **Vex writes something in a little notebook** and snaps it shut with a sly smile.
   - **Vex** (happy): *"People with money will start asking about you now, Sprocket."*

## Scene 5C: After the race, Sprocket finishes low (about 25 s)

**Background:** `src/assets/story/backgrounds/grandstand-race-day.webp`

1. **Sprocket's marble limps in last**, dented and wobbling, with a wisp of smoke. Sprocket slides off it and slumps against it, cap askew and covered in dust.
   - **Sprocket** (sad): *"I think I bounced off every single wall in Marblehurst."*
2. **Red Morrigan leans over the fence**, flicks her long red braid over her shoulder and gives a crooked grin.
   - **Red Morrigan** (surprised): *"Everybody has a terrible first race, rookie. My marble caught fire in mine."*
3. **Zapp crouches next to Sprocket** and hands him a rag to wipe his face.
   - **Zapp** (sad, gentle): *"You still finished all three races, and that was our deal. The seat is yours."*
4. **Ace walks past** and drops a spare bolt onto Sprocket's lap.
   - **Ace** (smug): *"Keep that seat warm, rookie, until Apex finds a real driver."*
5. **Sprocket squeezes the bolt**, and his sad face slowly turns determined.

---

## Scene 6: Back in the scrapyard at dusk (about 25 s)

**Background:** `src/assets/story/backgrounds/scrapyard-at-dusk.webp` (same sunset scrapyard as Scene 1, with the sun lower and more orange)

1. **Wide shot.** Sprocket and Zapp sit side by side on the anvil and share a flask. The dented crown marble rests between their feet. The racing towers glow in the distance.
2. **Zapp unrolls a crumpled track map** of a town full of narrow streets and a harbour.
   - **Zapp** (happy): *"Our next track is Monte Pipo, which runs through the streets of a harbour town."*
3. **Zapp traces the tight zigzag corners** with a greasy finger and frowns.
   - **Zapp** (angry): *"The streets are narrow and the corners are tight, so passing people is hard."*
4. **Sprocket jumps up onto the anvil** and punches the air toward the sunset.
   - **Sprocket** (smug): *"Then I will get in front at the start and stay there the whole way."*
5. **Zapp looks up at him**, amused, then glances over his shoulder toward a small dark shed at the back of the garage. A single lamp flickers on inside it.
   - **Zapp** (surprised): *"You need a proper teacher, kid, and I know an old goblin who can help."*
6. **Slow push in on the flickering lamp** in the shed window. A puff of cigar smoke drifts out. Fade to black.

**END OF CHAPTER 1**

---

### Notes for the video AI

- **Branching:** Scenes 5A, 5B and 5C are alternatives. Generate all three if you want every result covered.
- **Voice direction:** the mood in brackets is the facial expression to use for that line. It matches a portrait file with the same name, so use it as the face reference.
- **Length:** about 3.5 to 4 minutes in total, with one ending.
- **Content:** keep it family-friendly slapstick. No real injuries; crashes are dust puffs, sparks and dents.
