import { TOP_TIER } from '../../ai/skills';
import { fatigueFactor, levelOf, type Attribute, type Attributes } from '../../game/attributes';
import type { KnightSpec } from '../../game/match';
import type { Role } from '../../game/types';
import { clamp } from '../../game/vec';
import type { Look } from '../../knight/look';
import { FORGED_TIER } from '../manager/draft';
import { MATCHDAYS } from '../manager/league';
import { PLAY_COST, STAMINA_MAX, tiredCost } from '../manager/stamina';

/** The player's forged knight: his looks (build included) and what he has trained. */
export interface ForgedKnight {
  readonly look: Look;
  readonly attributes: Attributes;
}

/** The sim's decisions for the forged knight, fixed: raising them with his stars counts training twice (a maxed
 * knight on a Legend brain measured +1.38 ± 0.08 goals over this one). Only his shot range moves one decision. */
export const SIM_BRAIN_TIER = FORGED_TIER;

export type MatchAttribute = Exclude<Attribute, 'stamina'>;

// Fitted in scripts/attributes.sim.ts: the sim's forged knight in one outfield place of a Knight-tier house,
// goal difference a match against a Knight-tier bot in that place, ± 2 SE. Per knight, as OUTFIELD_TIER_VALUE.
/** Untrained and Standard: +0.238 ± 0.045 (3000 mirrored seed pairs). */
export const FORGED_BASE_GOALS = 0.238;
/** Nimble, Standard, Hefty, from the fit below: +0.182 ± 0.032, 0, -0.213 ± 0.032. */
export const FORGED_BUILD_GOALS: readonly number[] = [0.182, 0, -0.213];
/** Linear in level (squared terms fit to zero within 2 SE), 40,000 matches of random builds and levels, caps of 8:
 * pace +0.044, shot +0.035, strength +0.034 a level, each ± 0.005 (± 0.040 at the cap). */
export const GOALS_PER_LEVEL: Readonly<Record<MatchAttribute, number>> = {
  pace: 0.044,
  shot: 0.035,
  strength: 0.034,
};
/** Each tier as a bot in that same place, 2000 pairs each, ± 0.06: worth more there than in the draft's mixed
 * line-ups (-0.71, -0.03, 0, +0.65, +1.00), so stars are read off these to keep both sides in one context. */
export const PLACE_TIER_VALUE: readonly number[] = [-0.78, -0.267, 0, 0.708, 1.145];
const MATCH_ATTRIBUTES = Object.keys(GOALS_PER_LEVEL) as MatchAttribute[];

/** What the knight is worth in goals a match against a Knight-tier bot in his place. */
export const matchGoals = (build: number, attributes: Attributes): number =>
  MATCH_ATTRIBUTES.reduce(
    (sum, a) => sum + GOALS_PER_LEVEL[a] * levelOf(attributes, a),
    FORGED_BASE_GOALS + (FORGED_BUILD_GOALS[build] ?? 0),
  );

/** Goals a match onto the tier scale, between the measured tier values; Peasant and Legend bound it. */
export function tierForGoals(goals: number): number {
  for (let t = 1; t < PLACE_TIER_VALUE.length; t++) {
    const [lo, hi] = [PLACE_TIER_VALUE[t - 1] ?? 0, PLACE_TIER_VALUE[t] ?? 0];
    if (goals <= hi) return clamp(t - 1 + (goals - lo) / (hi - lo), 0, TOP_TIER);
  }
  return TOP_TIER;
}

/** A season's tiredness, in tiers a match, for a knight who starts every matchday (the stamina model). */
function seasonTiredness(attributes: Attributes): number {
  const cost = PLAY_COST * fatigueFactor(attributes);
  let total = 0;
  for (let day = 0; day < MATCHDAYS; day++) total += tiredCost(STAMINA_MAX - cost * day);
  return total / MATCHDAYS;
}

/** Stamina only acts between matches: its worth is the season's tiredness it saves (measured as TIRED_TIER_COST). */
export const staminaTiers = (attributes: Attributes): number =>
  seasonTiredness({ ...attributes, stamina: 0 }) - seasonTiredness(attributes);

/** Overall stars on the 0–4 tier scale (Peasant to Legend), from build and training alone. */
export const overallStars = (build: number, attributes: Attributes): number =>
  clamp(tierForGoals(matchGoals(build, attributes)) + staminaTiers(attributes), 0, TOP_TIER);

/** Stars out of five to the nearest half, as the setup screen shows a tier: Peasant one star, Legend five. */
export function starText(stars: number): string {
  const halves = Math.round((clamp(stars, 0, TOP_TIER) + 1) * 2);
  const full = Math.floor(halves / 2);
  return '★'.repeat(full) + (halves % 2 ? '½' : '') + '☆'.repeat(TOP_TIER + 1 - full - (halves % 2));
}

/** The forged knight as the sim plays him: the measured decisions on the human's legs, with his training. */
export const simKnightSpec = (knight: ForgedKnight, role: Role): KnightSpec => ({
  look: knight.look,
  role,
  human: false,
  tier: SIM_BRAIN_TIER,
  speedFactor: 1,
  attributes: knight.attributes,
});

/** The forged knight under the player's control: his training applies; aim assist is as for any human. */
export const humanKnightSpec = (knight: ForgedKnight, role: Role): KnightSpec => ({
  look: knight.look,
  role,
  human: true,
  tier: TOP_TIER,
  speedFactor: 1,
  attributes: knight.attributes,
});
