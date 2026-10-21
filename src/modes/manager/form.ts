// Season ratings: what the saved fixture ratings add up to. One match rating is mostly noise; a run of
// them is not, so everything here is an average over a minimum number of appearances.
import type { Role } from '../../game/types';
import { DRAFT_HOUSES, squadOf } from './draft';
import type { SeasonState } from './season';
import type { SquadKnight } from './types';

/** Appearances a knight needs for the season's honours and the league's top rated, once enough matchdays
 * are played; earlier, half the matchdays played (rounded up) is enough. */
export const MIN_APPEARANCES = 5;
/** Matches the form chips show, and that a knight's current form is the average of. */
export const FORM_MATCHES = 3;

const ROLES: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];

/** One knight's season so far. Only knights who have played have one. */
export interface KnightSeason {
  readonly knight: SquadKnight;
  readonly house: string;
  /** Every rating, oldest first. */
  readonly ratings: readonly number[];
  readonly appearances: number;
  /** Mean of his match ratings. */
  readonly average: number;
  readonly motm: number;
  /** The position he played most; level counts go to the one he played most recently. */
  readonly role: Role;
}

// Summed in whole tenths and divided once, so equal averages compare equal: six 7.4s and five 7.4s
// would otherwise differ in the last bit and break the tiebreaks.
const mean = (xs: readonly number[]): number =>
  xs.reduce((sum, x) => sum + Math.round(x * 10), 0) / (10 * xs.length);

/** The position played most often, ties to the latest of them. */
function usualRole(roles: readonly Role[]): Role {
  const count = (role: Role): number => roles.filter((r) => r === role).length;
  const most = Math.max(...ROLES.map(count));
  return [...roles].reverse().find((r) => count(r) === most) ?? 'mid';
}

/** Every knight who has played this season, by squad id. */
export function seasonForm(season: SeasonState): Map<string, KnightSeason> {
  const plays = new Map<string, { ratings: number[]; roles: Role[]; motm: number }>();
  // Matchdays in order, and a knight plays at most once a matchday, so ratings come out oldest first.
  for (const record of season.records.flat()) {
    if (!record) continue;
    for (const [id, [rating, role]] of Object.entries(record.ratings)) {
      const play = plays.get(id) ?? { ratings: [], roles: [], motm: 0 };
      play.ratings.push(rating);
      play.roles.push(role);
      if (record.motm === id) play.motm++;
      plays.set(id, play);
    }
  }
  const form = new Map<string, KnightSeason>();
  for (const house of DRAFT_HOUSES)
    for (const knight of squadOf(season.draft, house)) {
      const play = plays.get(knight.id);
      if (!play) continue;
      form.set(knight.id, {
        knight,
        house,
        ratings: play.ratings,
        appearances: play.ratings.length,
        average: mean(play.ratings),
        motm: play.motm,
        role: usualRole(play.roles),
      });
    }
  return form;
}

/** The last few ratings, oldest first. */
export const recentRatings = (k: KnightSeason): readonly number[] => k.ratings.slice(-FORM_MATCHES);

/** Average of the last few ratings. */
export const currentForm = (k: KnightSeason): number => mean(recentRatings(k));

/** Matchdays with every fixture played. */
const matchdaysPlayed = (season: SeasonState): number =>
  season.records.filter((day) => day.length > 0 && day.every((r) => r !== null)).length;

/** Appearances needed to be ranked: MIN_APPEARANCES, or half the matchdays so far early in the season. */
export const qualifying = (season: SeasonState): number =>
  Math.max(1, Math.min(MIN_APPEARANCES, Math.ceil(matchdaysPlayed(season) / 2)));

/** Better average first; then more appearances, more men of the match, name and squad id. */
export const byAverage = (a: KnightSeason, b: KnightSeason): number =>
  b.average - a.average ||
  b.appearances - a.appearances ||
  b.motm - a.motm ||
  a.knight.look.name.localeCompare(b.knight.look.name) ||
  a.knight.id.localeCompare(b.knight.id);

/** The league's best averages among knights with enough appearances. */
export function topRated(season: SeasonState, min = qualifying(season)): KnightSeason[] {
  return [...seasonForm(season).values()].filter((k) => k.appearances >= min).sort(byAverage);
}

/** The best average with enough appearances, or null if nobody has played enough. */
export const playerOfTheSeason = (season: SeasonState, min = qualifying(season)): KnightSeason | null =>
  topRated(season, min)[0] ?? null;

/** One per position, keeper first: the best average among knights who played there most. A position
 * nobody qualifies for is null. */
export function teamOfTheSeason(
  season: SeasonState,
  min = qualifying(season),
): readonly { readonly role: Role; readonly knight: KnightSeason | null }[] {
  const ranked = topRated(season, min);
  return ROLES.map((role) => ({ role, knight: ranked.find((k) => k.role === role) ?? null }));
}

/** A house's squad, best current form first (then season average, then name); knights yet to play last. */
export function squadByForm(
  season: SeasonState,
  house: string,
): { readonly knight: SquadKnight; readonly form: KnightSeason | null }[] {
  const form = seasonForm(season);
  const rows = squadOf(season.draft, house).map((knight) => ({ knight, form: form.get(knight.id) ?? null }));
  const name = (a: SquadKnight, b: SquadKnight): number =>
    a.look.name.localeCompare(b.look.name) || a.id.localeCompare(b.id);
  return rows.sort((a, b) => {
    if (!a.form || !b.form) return Number(!a.form) - Number(!b.form) || name(a.knight, b.knight);
    return (
      currentForm(b.form) - currentForm(a.form) || b.form.average - a.form.average || name(a.knight, b.knight)
    );
  });
}
