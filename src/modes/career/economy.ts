import { ATTRIBUTE_CAPS, ATTRIBUTES, levelOf, type Attribute, type Attributes } from '../../game/attributes';
import { clamp } from '../../game/vec';
import type { Division } from './clubs';
import { UPGRADE_COST, upgradeCost } from './upgrades';

// Points ------------------------------------------------------------------------------------------

/** No points below this rating: 1.3 standard deviations under the mean match (6.96, sd 0.77), where it was set. */
export const POINT_FLOOR = 6;
/** Points = scale × (rating − floor)², rounded: 7.0 earns 2, 7.5 earns 4, 8.0 earns 7, 9.0 earns 15. The scale is
 * 1 / sd², so the curve keeps the shape in standard deviations it had when ratings ran at sd 1. */
export const POINT_SCALE = 1.7;

/** Points for one match: convex in the rating, so a standout match is worth several ordinary ones, and in proportion
 * to the share of it he played (the rating is already judged per minute, so a cameo at 8.0 earns a third of a match). */
export function matchPoints(rating: number, share = 1): number {
  if (!Number.isFinite(rating) || !Number.isFinite(share)) return 0;
  const above = Math.max(0, rating - POINT_FLOOR);
  return Math.round(POINT_SCALE * above * above * clamp(share, 0, 1));
}

export type Honour = 'title' | 'promotion' | 'topScorer' | 'royalCall' | 'royalCrown';
export const HONOURS: readonly Honour[] = ['title', 'promotion', 'topScorer', 'royalCall', 'royalCrown'];

/** Points for each honour, by the division it was won in (royal honours count the same from any division). */
export const HONOUR_POINTS: Readonly<Record<Honour, Readonly<Record<Division, number>>>> = {
  title: { 0: 6, 1: 10, 2: 16 },
  promotion: { 0: 4, 1: 8, 2: 0 },
  topScorer: { 0: 3, 1: 5, 2: 8 },
  royalCall: { 0: 10, 1: 10, 2: 10 },
  royalCrown: { 0: 10, 1: 10, 2: 10 },
};

/** Appearances, starting or from the bench, a season's honours need to count for him: a title won from the stands
 * isn't his. */
export const TROPHY_MIN_APPS = 3;

export const honourPoints = (honours: readonly Honour[], division: Division): number =>
  honours.reduce((sum, h) => sum + HONOUR_POINTS[h][division], 0);

// Training and ageing -----------------------------------------------------------------------------

/** From this age stats fall each season; points then only slow the fall. */
export const DECLINE_AGE = 31;
/** Levels each stat loses at the start of a season at DECLINE_AGE, rising each year to the maximum. */
export const DECLINE_START = 1;
export const DECLINE_STEP = 0.25;
export const DECLINE_MAX = 1.5;
/** A guarded stat loses this share of its decline. Never 0: points slow the fall, never stop it. */
export const GUARDED_SHARE = 0.5;

/** The forged knight's trainable side, as the career keeps it. */
export interface Training {
  readonly age: number;
  readonly points: number;
  readonly attributes: Attributes;
  /** Each stat's decline carried over in part levels, in [0, 1): levels fall when it reaches a whole one. */
  readonly wear: Attributes;
  /** Stats guarded against the next season's decline. */
  readonly guarded: readonly Attribute[];
}

/** Levels a stat loses on turning `age`, before guarding. */
export const declineRate = (age: number): number =>
  age < DECLINE_AGE ? 0 : Math.min(DECLINE_MAX, DECLINE_START + DECLINE_STEP * (age - DECLINE_AGE));

/** Points raise stats only before the decline. */
export const canTrain = (age: number): boolean => age < DECLINE_AGE;
/** Guards can be bought the season before the first decline and every season after. */
export const canGuard = (age: number): boolean => age >= DECLINE_AGE - 1;

/** Points for the next level of `stat`, or null if none can be bought now (cap, age, or too few points). */
export function trainCost(training: Training, stat: Attribute): number | null {
  if (!canTrain(training.age)) return null;
  const cost = upgradeCost(stat, levelOf(training.attributes, stat));
  return cost !== null && cost <= training.points ? cost : null;
}

export function train(training: Training, stat: Attribute): Training {
  const cost = trainCost(training, stat);
  if (cost === null) throw new Error(`Cannot train ${stat} now`);
  const level = levelOf(training.attributes, stat) + 1;
  return {
    ...training,
    points: training.points - cost,
    attributes: { ...training.attributes, [stat]: level },
  };
}

/** A guard costs what a level of the stat costs; there must be something left to lose. */
export function guardCost(training: Training, stat: Attribute): number | null {
  const cost = UPGRADE_COST[stat];
  const possible =
    canGuard(training.age) && !training.guarded.includes(stat) && levelOf(training.attributes, stat) > 0;
  return possible && cost <= training.points ? cost : null;
}

export function guard(training: Training, stat: Attribute): Training {
  const cost = guardCost(training, stat);
  if (cost === null) throw new Error(`Cannot guard ${stat} now`);
  return { ...training, points: training.points - cost, guarded: [...training.guarded, stat] };
}

/** A year older at the start of a season: past the decline age each stat wears by its rate (half if guarded),
 * losing a level for every whole level worn. Guards are spent. */
export function age(training: Training): Training {
  const next = training.age + 1;
  const rate = declineRate(next);
  const attributes = { ...training.attributes };
  const wear = { ...training.wear };
  for (const stat of ATTRIBUTES) {
    const worn = training.wear[stat] + rate * (training.guarded.includes(stat) ? GUARDED_SHARE : 1);
    const lost = Math.floor(worn);
    attributes[stat] = clamp(levelOf(training.attributes, stat) - lost, 0, ATTRIBUTE_CAPS[stat]);
    wear[stat] = worn - lost;
  }
  return { ...training, age: next, attributes, wear, guarded: [] };
}

// Fame --------------------------------------------------------------------------------------------

export const FAME_MAX = 100;
/** Share of fame kept from one season to the next: a star out of the spotlight fades over several. */
export const FAME_KEEP = 0.85;
/** How much the same season counts towards fame in each division. */
export const FAME_DIVISION_WEIGHT: Readonly<Record<Division, number>> = { 0: 0.4, 1: 0.7, 2: 1 };
/** Fame a season: per rating point of season average above FAME_PAR, per goal, and per honour. Par sits 0.3 sd under
 * the mean match (6.96, sd 0.77), and a standard deviation is worth 6, as when they were set at sd 1. */
export const FAME_PAR = 6.7;
export const FAME_PER_RATING = 8;
export const FAME_PER_GOAL = 0.25;
export const FAME_PER_HONOUR: Readonly<Record<Honour, number>> = {
  title: 4,
  promotion: 2,
  topScorer: 3,
  royalCall: 5,
  royalCrown: 4,
};

export interface FameSeason {
  readonly division: Division;
  readonly average: number | null;
  readonly goals: number;
  readonly honours: readonly Honour[];
}

/** Fame after a season: what was kept, plus what the season earned. Royal honours are not weighed by division. */
export function nextFame(fame: number, season: FameSeason): number {
  const weight = FAME_DIVISION_WEIGHT[season.division];
  const club = season.honours.filter((h) => h !== 'royalCall' && h !== 'royalCrown');
  const royal = season.honours.filter((h) => h === 'royalCall' || h === 'royalCrown');
  const earned =
    weight *
      (FAME_PER_RATING * Math.max(0, (season.average ?? FAME_PAR) - FAME_PAR) +
        FAME_PER_GOAL * season.goals +
        club.reduce((s, h) => s + FAME_PER_HONOUR[h], 0)) +
    royal.reduce((s, h) => s + FAME_PER_HONOUR[h], 0);
  return clamp(fame * FAME_KEEP + earned, 0, FAME_MAX);
}
