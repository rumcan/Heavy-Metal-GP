import * as storage from './storage';
import { officialTrack } from './official-tracks';
import type { TrackDef } from './trackdef';
import { GrandPrix, HeatResult, MarbleInfo, POINTS, FASTEST_BONUS, HEATS_PER_GP, TEAMS, Team, TrackProfile, CIRCUIT_LENGTH_MULTIPLIER, TRACK_THEMES, ThemeId } from './types';

const P = (segments: number, weights: Record<string, number>, theme: ThemeId): TrackProfile => ({ segments: segments * CIRCUIT_LENGTH_MULTIPLIER, weights, theme: TRACK_THEMES[theme] });

export const CALENDAR: GrandPrix[] = [
  { id: 0, name: 'Marblehurst Grand Prix', short: 'MARBLEHURST', location: 'Marblehurst Park', flag: '🇬🇧', desc: 'Seeded fairground switchbacks with weight cuts, spring shelves and timed ferries.', profile: P(10, { 'Rope Crossing': 1.4, 'Teeter Crossing': 1.3, 'Catapult Ledge': 1.4, 'Fan Garden': 1.3, 'Drawbridge Gap': 1.2 }, 'classic') },
  { id: 1, name: 'Monte Pipo Street Circuit', short: 'MONTE PIPO', location: 'Monte Pipo Harbour', flag: '🇲🇨', desc: 'Harbour switchbacks with jump-access burrows, cargo cuts and crane duels.', profile: P(11, { Chicane: 3, Funnel: 2.5, 'Zigzag Pipes': 1.5, 'Ice Slide': 0.2, Splitter: 0.3, 'Crumbling Wall': 1.6, 'Trapdoor Drop': 1.3, 'Crusher Alley': 1.5, 'Mace Sweep': 1.2, 'Wheel Lift': 1.5, 'Cannon Run': 1.5, 'Tar Flats': 1.2, 'Target Gate': 1.2 }, 'street') },
  { id: 2, name: 'Silverpeg Grand Prix', short: 'SILVERPEG', location: 'Silverpeg Circuit', flag: '🎯', desc: 'Small scoring pockets, express gaps and rebound shelves built into a connected race.', profile: P(11, { 'Peggle Board': 3.5, 'Peg Field': 2.5, Chicane: 0.4, 'Lodestone Way': 1.2, 'Turnstile Square': 1.2 }, 'silver') },
  { id: 3, name: 'Spa-Francoroll', short: 'SPA', location: 'Ardennes Chutes', flag: '🇧🇪', desc: 'Fast beltways and momentum gaps through the forest, with useful inside cuts.', profile: P(12, { 'Ice Slide': 3, 'Zigzag Pipes': 2, Splitter: 1.5, 'Peg Field': 0.3, 'Tunnel Shortcut': 1.4, 'Boulder Run': 1.4, 'Screw Tower': 1.3, 'Scoop Subway': 0.9, 'Skipping Pools': 1.0, 'Vortex Bowl': 1.0 }, 'forest') },
  { id: 4, name: 'Suzuka Spiral', short: 'SUZUKA', location: 'Suzuka Spiral', flag: '🇯🇵', desc: 'Canyon machinery, weight routes and timed ferries connected by banked roads.', profile: P(11, { Spinners: 3, Splitter: 2.5, Funnel: 1.5, 'Switchback Lanes': 1.7, 'Blade Gauntlet': 1.6, 'Saw Slot': 1.4, 'Beltway': 1.6, 'Teeter Crossing': 1.2, 'Flipper Alley': 1.6, 'Sling Chute': 1.5, 'Vent Field': 1.3, 'Trampoline Alley': 1.2 }, 'worg') },
  { id: 5, name: 'Yas Marble Finale', short: 'YAS MARBLE', location: 'Yas Marble Island', flag: '🏁', desc: 'A seeded forge finale of pressure gates, upper shortcuts and a clean finishing straight.', profile: P(14, { 'Crack Wall Shortcut': 1.6, 'Bounce Ramp': 1.6, 'Peggle Board': 1.5, 'Tunnel Shortcut': 1.3, 'Switchback Lanes': 1.3, 'Crumbling Wall': 1.2, 'Trapdoor Drop': 1.2, 'Blade Gauntlet': 1.2, 'Saw Slot': 1.2, 'Crusher Alley': 1.2, 'Boulder Run': 1.3, 'Mace Sweep': 1.2, 'Wheel Lift': 1.1, 'Screw Tower': 1.1, 'Beltway': 1.1, 'Teeter Crossing': 1.1, 'Rope Crossing': 1.1, 'Cannon Run': 1.1, 'Catapult Ledge': 1.05, 'Flipper Alley': 1.05, 'Sling Chute': 1.05, 'Scoop Subway': 1.05, 'Fan Garden': 1.05, 'Lodestone Way': 1.0, 'Tar Flats': 1.0, 'Skipping Pools': 1.0, 'Vent Field': 1.0, 'Trampoline Alley': 1.0, 'Turnstile Square': 0.9, 'Target Gate': 0.9, 'Vortex Bowl': 0.9, 'Drawbridge Gap': 1.0 }, 'dwarven') },
];

export const QUICK_PROFILE: TrackProfile = P(11, {}, 'classic');

export interface SeasonState {
  seed: number;
  roster: MarbleInfo[];
  round: number; // current GP index
  heat: number; // current heat index inside the GP
  results: HeatResult[][][]; // [round][heat] -> results
  fastest: (number | null)[]; // marble id awarded fastest-heat bonus per round
  complete: boolean;
  /**
   * Per round, a player-built circuit that replaces the round's official circuit (null/missing = the
   * archived official track). A copy of the def, not a My-tracks id, so editing or deleting the saved
   * track can't change a season.
   */
  tracks?: (TrackDef | null)[];
}

/**
 * The circuit a round races: the player's swap-in, else the shipped archive, else null (the
 * seeded generator inside `Game`). Calendar rounds race the archived official circuits in
 * `src/game/official-tracks` — generated once in the Workshop, hand-fixed, archived — so the
 * same saved layout runs in the menu demo and in every heat, and nothing generates at race time.
 */
export function roundTrack(season: SeasonState, round: number): TrackDef | null {
  const custom = season.tracks?.[round];
  if (custom) return custom;
  return officialTrack(round);
}

/** Display name of a round's circuit: the custom track's name, or the Grand Prix name. */
export function roundName(season: SeasonState, round: number): string {
  return roundTrack(season, round)?.name ?? CALENDAR[round].name;
}

/** A round can change track until its first heat has been raced. */
export function canChangeRoundTrack(season: SeasonState, round: number): boolean {
  return !season.complete && round >= season.round && (season.results[round]?.length ?? 0) === 0;
}

/** Swap a round's track (null = back to the calendar). Returns the season unchanged if the round has started. */
export function setRoundTrack(season: SeasonState, round: number, def: TrackDef | null): SeasonState {
  if (!canChangeRoundTrack(season, round)) return season;
  const tracks = CALENDAR.map((_, i) => season.tracks?.[i] ?? null);
  tracks[round] = def ? (JSON.parse(JSON.stringify(def)) as TrackDef) : null;
  return { ...season, tracks };
}

export function gpSeed(seasonSeed: number, round: number): number {
  return (seasonSeed ^ (0x51ed270b + round * 0x9e3779b9)) >>> 0;
}

export function newSeason(roster: MarbleInfo[]): SeasonState {
  return {
    seed: Math.floor(Math.random() * 0xffffffff),
    roster,
    round: 0,
    heat: 0,
    results: CALENDAR.map(() => []),
    fastest: CALENDAR.map(() => null),
    complete: false,
  };
}

export interface Standing {
  id: number;
  points: number;
  wins: number;
  podiums: number;
  heatsWon: number;
  fastest: number;
  best: number;
  last: number | null;
}

export function pointsFor(rank: number): number {
  return POINTS[rank - 1] ?? 0;
}

export function computeStandings(s: SeasonState): Standing[] {
  const map = new Map<number, Standing>();
  for (const m of s.roster) map.set(m.id, { id: m.id, points: 0, wins: 0, podiums: 0, heatsWon: 0, fastest: 0, best: 99, last: null });
  s.results.forEach((gp, r) => {
    const gpPoints = new Map<number, number>();
    gp.forEach((heat) => {
      for (const hr of heat) {
        const st = map.get(hr.id)!;
        const p = hr.time === null ? 0 : pointsFor(hr.rank);
        st.points += p;
        gpPoints.set(hr.id, (gpPoints.get(hr.id) ?? 0) + p);
        if (hr.rank === 1 && hr.time !== null) st.heatsWon++;
        st.last = hr.rank;
      }
    });
    if (gp.length === HEATS_PER_GP) {
      const fid = s.fastest[r];
      if (fid !== null && map.has(fid)) {
        map.get(fid)!.points += FASTEST_BONUS;
        map.get(fid)!.fastest++;
        gpPoints.set(fid, (gpPoints.get(fid) ?? 0) + FASTEST_BONUS);
      }
      const gpOrder = gpRanking(gp, s.fastest[r]);
      gpOrder.forEach((id, i) => {
        const st = map.get(id)!;
        if ((gpPoints.get(id) ?? 0) === 0) return;
        if (i === 0) st.wins++;
        if (i < 3) st.podiums++;
        st.best = Math.min(st.best, i + 1);
      });
    }
  });
  return [...map.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || a.best - b.best || a.id - b.id);
}

/** Ranking of a GP (marble ids) by GP points, tie-break by best heat finish. */
export function gpRanking(gp: HeatResult[][], fastestId: number | null): number[] {
  const pts = new Map<number, number>();
  const best = new Map<number, number>();
  for (const heat of gp)
    for (const hr of heat) {
      pts.set(hr.id, (pts.get(hr.id) ?? 0) + (hr.time === null ? 0 : pointsFor(hr.rank)));
      best.set(hr.id, Math.min(best.get(hr.id) ?? 99, hr.rank));
    }
  if (fastestId !== null && pts.has(fastestId)) pts.set(fastestId, pts.get(fastestId)! + FASTEST_BONUS);
  return [...pts.keys()].sort((a, b) => pts.get(b)! - pts.get(a)! || best.get(a)! - best.get(b)! || a - b);
}

export function gpPointsTable(gp: HeatResult[][], fastestId: number | null): Map<number, number> {
  const pts = new Map<number, number>();
  for (const heat of gp) for (const hr of heat) pts.set(hr.id, (pts.get(hr.id) ?? 0) + (hr.time === null ? 0 : pointsFor(hr.rank)));
  if (fastestId !== null && pts.has(fastestId)) pts.set(fastestId, pts.get(fastestId)! + FASTEST_BONUS);
  return pts;
}

export interface TeamStanding {
  team: Team;
  points: number;
}

export function computeTeamStandings(st: Standing[]): TeamStanding[] {
  return TEAMS.map((team) => ({ team, points: team.members.reduce((s, id) => s + (st.find((x) => x.id === id)?.points ?? 0), 0) })).sort((a, b) => b.points - a.points);
}

/** Record a heat. Returns the updated season state (immutable). */
export function recordHeat(s: SeasonState, results: HeatResult[]): SeasonState {
  if (s.complete) return s;
  const ids = new Set(results.map((r) => r.id));
  const ranks = new Set(results.map((r) => r.rank));
  if (results.length !== s.roster.length || ids.size !== s.roster.length || ranks.size !== s.roster.length
    || results.some((r) => !s.roster.some((m) => m.id === r.id) || !Number.isInteger(r.rank) || r.rank < 1 || r.rank > results.length
      || (r.time !== null && (!Number.isFinite(r.time) || r.time < 0)))) {
    throw new Error('Invalid heat classification. Every marble needs one unique finishing position.');
  }
  const next: SeasonState = { ...s, results: s.results.map((r) => r.map((h) => [...h])), fastest: [...s.fastest] };
  next.results[s.round].push(results);
  if (next.results[s.round].length >= HEATS_PER_GP) {
    // fastest heat time of the GP earns a bonus point
    let bestT = Infinity;
    let bestId: number | null = null;
    for (const heat of next.results[s.round]) for (const hr of heat) if (hr.time !== null && hr.time < bestT) (bestT = hr.time), (bestId = hr.id);
    next.fastest[s.round] = bestId;
    if (s.round + 1 >= CALENDAR.length) {
      next.complete = true;
      next.heat = HEATS_PER_GP;
    } else {
      next.round = s.round + 1;
      next.heat = 0;
    }
  } else {
    next.heat = s.heat + 1;
  }
  return next;
}

/** Starting grid: marble ids in slot order (P1 first). Heat 1 uses championship order; later heats use previous heat finish order. */
export function gridOrder(s: SeasonState): number[] {
  const gp = s.results[s.round] ?? [];
  if (gp.length > 0) {
    const prev = gp[gp.length - 1];
    return [...prev].sort((a, b) => a.rank - b.rank).map((r) => r.id);
  }
  const st = computeStandings(s);
  if (st.every((x) => x.points === 0)) {
    // opening round: shuffle deterministically by seed
    const ids = s.roster.map((m) => m.id);
    let a = s.seed >>> 0;
    for (let i = ids.length - 1; i > 0; i--) {
      a = (a * 1664525 + 1013904223) >>> 0;
      const j = a % (i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  }
  return st.map((x) => x.id);
}

// The start grid moved to `grid.ts` (pure geometry, no SDK) so the simulation
// no longer imports the season — and through it the SDK — just to place ten
// marbles on a line. Re-exported here: the season still hands out grid orders.
export { gridSlots } from './grid';

const KEY = 'mrr-season-v1';
export function saveSeason(s: SeasonState | null) {
  try {
    if (s) storage.setItem(KEY, JSON.stringify(s));
    else storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
export function loadSeason(): SeasonState | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SeasonState;
    if (!s.roster || !s.results) return null;
    return s;
  } catch {
    return null;
  }
}
