// ══════════════════════════════════════════════════════════════════════════
// RK-05 (#59) — the rank badges, as the app loads them.
//
// One import per tier, through Vite, so a badge is a bundled asset with a
// hashed URL: no fetch at paint time, no broken image on a slow link, and the
// garage header's rating row renders in the same frame as the rest of the card.
//
// Ported from HexMatch's `src/ui/rank-badge.ts` (RANK-01 #147), same pipeline
// and same reasoning. Two adaptations, both forced by this game:
//
//   - the KEYS are this game's tier table (`RANK_TIERS` in `src/net/rating.ts`
//     — Scrap, Bronze Bolt, Iron, Steel, Gold Gear, Heavy Metal), not the
//     duel's metals. The ladder ORDER is `RANK_TIERS`' order, and the badge a
//     driver climbs into has one more star than the one below it;
//   - the list is DERIVED from `RANK_TIERS` instead of being typed out again,
//     so a tier cannot exist in the arithmetic and be missing from the panel.
//     `tests/rating.test.ts` pins the two against the PNGs on disk: a renamed
//     tier is a failing test rather than a blank square in the lobby.
//
// The PNGs are DERIVED, never hand-edited — `tools/make-rank-badges.mjs` builds
// all seven from the one painted medallion master in
// `assets/ui/rank/medallion-master.png`.
// ══════════════════════════════════════════════════════════════════════════
import { RANK_TIERS, UNRANKED_KEY } from '../net/rating';
import bronzeBolt from '../assets/ui/rank/bronze-bolt.png';
import goldGear from '../assets/ui/rank/gold-gear.png';
import heavyMetal from '../assets/ui/rank/heavy-metal.png';
import iron from '../assets/ui/rank/iron.png';
import scrap from '../assets/ui/rank/scrap.png';
import steel from '../assets/ui/rank/steel.png';
import unranked from '../assets/ui/rank/unranked.png';

/** Badge key → bundled URL. Keys match `RANK_TIERS[].key` + `UNRANKED_KEY`. */
export const RANK_BADGES: Readonly<Record<string, string>> = Object.freeze({
  [UNRANKED_KEY]: unranked,
  scrap,
  'bronze-bolt': bronzeBolt,
  iron,
  steel,
  'gold-gear': goldGear,
  'heavy-metal': heavyMetal,
});

/** The badge for a player with no rated match yet. */
export { UNRANKED_KEY } from '../net/rating';

/** Every badge key, lowest tier first — the order the ladder panel prints in. */
export const RANK_BADGE_KEYS: readonly string[] = Object.freeze([
  UNRANKED_KEY,
  ...RANK_TIERS.map((tier) => tier.key),
]);

/**
 * The URL for a badge key, falling back to `unranked` rather than to nothing:
 * a tier this build does not know (a rating file written by a newer version, a
 * renamed band) still shows a medal, which is what the player is looking at.
 */
export function badgeUrlFor(key: string): string {
  return RANK_BADGES[key] ?? RANK_BADGES[UNRANKED_KEY];
}

/**
 * The metal of a tier, as a colour the UI can paint text and borders with.
 *
 * The art is where the badge's colour really lives (the plates are tinted, not
 * CSS-filtered), so this table exists only for the places where a tier has to
 * tint TEXT — the chip's label, the results row's accent. Keys are the badge
 * keys; a key this table does not know gets the muted steel of `unranked`.
 */
export const RANK_TIER_COLORS: Readonly<Record<string, string>> = Object.freeze({
  [UNRANKED_KEY]: '#8d99a8',
  scrap: '#b8ae9c',
  'bronze-bolt': '#d29a63',
  iron: '#9fb0c2',
  steel: '#c9d6de',
  'gold-gear': '#e9a83e',
  'heavy-metal': '#e8785f',
});

/** The colour for a badge key, muted rather than nothing for an unknown tier. */
export function tierColorFor(key: string): string {
  return RANK_TIER_COLORS[key] ?? RANK_TIER_COLORS[UNRANKED_KEY];
}
