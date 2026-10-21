import { ATTRIBUTE_CAPS, ATTRIBUTES, NO_ATTRIBUTES, type Attribute } from '../../game/attributes';
import { GOALS_PER_LEVEL, PLACE_TIER_VALUE, staminaTiers } from './stars';

/** Goals a match a tier is worth where the forged knight lives (Knight to Champion): stamina's tiers in goals. */
export const TIER_GOALS = (PLACE_TIER_VALUE[3] ?? 0) - (PLACE_TIER_VALUE[2] ?? 0);

/** Measured goals a match a level: the fit for match stats; for stamina, the season tiredness it saves. */
export const goalsPerLevel = (stat: Attribute): number =>
  stat === 'stamina'
    ? (staminaTiers({ ...NO_ATTRIBUTES, stamina: ATTRIBUTE_CAPS.stamina }) / ATTRIBUTE_CAPS.stamina) *
      TIER_GOALS
    : GOALS_PER_LEVEL[stat];

// Points a level, so that a point buys about the same measured value whatever it goes to. Goals a match a level:
// pace 0.044, shot 0.035, strength 0.034 (stars.ts), stamina 0.0128 tiers × 0.708 = 0.009. At 0.003 goals a point
// that is 14.7, 11.7, 11.3, 3.0, rounded to 15, 12, 11, 3: every stat within 4% of 335 points a goal. The unit puts
// a career near its caps in the late twenties (scripts/career.sim.ts).
export const UPGRADE_COST: Readonly<Record<Attribute, number>> = {
  pace: 15,
  shot: 12,
  strength: 11,
  stamina: 3,
};

/** Points for the next level of `stat` from `fromLevel`, or null at its cap (or past it): nothing to buy. */
export function upgradeCost(stat: Attribute, fromLevel: number): number | null {
  if (!Number.isFinite(fromLevel)) return null;
  return Math.max(0, Math.floor(fromLevel)) < ATTRIBUTE_CAPS[stat] ? UPGRADE_COST[stat] : null;
}

/** Points to take an untrained knight to every cap. */
export const maxedCost: number = ATTRIBUTES.reduce((sum, a) => sum + UPGRADE_COST[a] * ATTRIBUTE_CAPS[a], 0);
