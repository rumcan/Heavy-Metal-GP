# Connected championship course generator

Championship rounds now use seeded connected courses unless the player has selected a custom TrackDef. Archived championship JSONs remain available in the repository. Story mode explicitly retains the legacy generator because its objectives reference legacy sections.

## Design contract

`course-plan.ts` chooses 8–14 chapters from the existing profile's length, weights and theme. It guarantees mass, rebound, burrow, lift, Peggle and crane opportunities; avoids adjacent repeats; biases each theme towards a signature feature; and changes variants and order with the seed. `course-builder.ts` builds the geometry. Each chapter has a shared entry/exit side and a lower catch road. Only the whole course is mirrored, so independently flipped exits cannot break connections.

Every chapter contains an upper opportunity and a lower continuation. Missed jumps land on the course. The lower route has a pickup to offset the shortcut's time advantage. Chapter signs identify the relevant action. This is a designed-module generator with seeded variation, not arbitrary obstacle scatter or exhaustive seed validation.

| Chapter | Choice and item purpose |
| --- | --- |
| Foundry Cut | Heavy builds open a weight hatch to cut the outer bend; light builds cross it. Anvil is supplied on the approach. A booster clears stopped light marbles. |
| Spring Exchange | Bounce towards an upper tunnel shelf or land on the lower road. Jump helps reach the high line; a booster clears low-bounce marbles off the spring. |
| Smuggler Run | Time Jump from the marked approach to reach the raised tunnel and skip the switchback. The ordinary slope remains open. |
| Beltway | Carry conveyor momentum across a gap or drop inside. Aero supports momentum; Jump precedes the lower mud strip. |
| Peg Bank | Boost across the express gap or enter a scoring pocket. Rocket supplies a burst for the gap; pegs occupy the pocket rather than unrelated road space. |
| Sky Ferry | Board the moving lift, then jump/steer towards the upper tunnel dock, or drop onto the catch road. An upper booster clears stationary riders. |
| Crane Yard | Ghost through a fragile barrier or take the outside road past a swinging mace. Shock supplies an attack around the exposed bend. |

The six existing theme palettes/art remain. Theme identity also changes the frequency of signature chapters; these are related course families, not six wholly separate geometry systems.

## Reproduce

- `node --import tsx --test tests/course-generator.test.ts`: planner, no-rescue races, mirrored Jump time savings, heavy/light hatch and lift boarding tests.
- `node --import tsx scripts/course-sanity.mjs 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17`: 180 marbles, including extreme builds, across six themes. Disables recovery and AI items. All completed in the checked revision.
- `node --import tsx scripts/course-shots.mjs`: Linux browser screenshots in `tests/artifacts/course-*.png`.
- Workshop → My Tracks → Generated Circuits: load an editable seeded circuit.

Generated TrackDefs retain fixed supply items. Racing and editor rebuilds use the same geometry. Existing regression checks now enforce compact chapters, supply validity, determinism and streamed physics instead of the obsolete three-times-longer / 400-peg quota.

No-rescue tests establish baseline traversability; they do not prove competitive balance for every seed, player action or item interaction. Human playtesting should especially compare high-bounce access and lift risk/reward.
