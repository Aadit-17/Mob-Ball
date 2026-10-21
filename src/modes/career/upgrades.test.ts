import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_CAPS, ATTRIBUTES, type Attribute } from '../../game/attributes';
import { goalsPerLevel, maxedCost, UPGRADE_COST, upgradeCost } from './upgrades';

/** How far any stat's points per measured goal may stray from the average across stats. */
const BAND = 0.1;
const costPerGoal = (a: Attribute): number => UPGRADE_COST[a] / goalsPerLevel(a);

describe('upgrade prices', () => {
  it('rise with how much a level is measured to be worth: pace dearest, stamina cheapest', () => {
    const byValue = [...ATTRIBUTES].sort((a, b) => goalsPerLevel(b) - goalsPerLevel(a));
    expect(byValue[0]).toBe('pace');
    expect(byValue.at(-1)).toBe('stamina');
    for (let i = 1; i < byValue.length; i++) {
      const [dearer, cheaper] = [byValue[i - 1], byValue[i]] as [Attribute, Attribute];
      expect(UPGRADE_COST[dearer], `${dearer} v ${cheaper}`).toBeGreaterThanOrEqual(UPGRADE_COST[cheaper]);
    }
    expect(UPGRADE_COST.pace).toBeGreaterThan(UPGRADE_COST.stamina);
  });

  it(`buy about the same measured value a point whatever the stat: within ${BAND * 100}% of the average`, () => {
    const average = ATTRIBUTES.reduce((s, a) => s + costPerGoal(a), 0) / ATTRIBUTES.length;
    for (const a of ATTRIBUTES) {
      expect(goalsPerLevel(a), a).toBeGreaterThan(0);
      expect(Math.abs(costPerGoal(a) / average - 1), a).toBeLessThanOrEqual(BAND);
    }
  });

  it('are friendly whole numbers', () => {
    for (const a of ATTRIBUTES) {
      expect(Number.isInteger(UPGRADE_COST[a]), a).toBe(true);
      expect(UPGRADE_COST[a]).toBeGreaterThan(0);
    }
  });

  it('charge every level up to the cap, and nothing is for sale at or past it', () => {
    for (const a of ATTRIBUTES) {
      for (let level = 0; level < ATTRIBUTE_CAPS[a]; level++)
        expect(upgradeCost(a, level)).toBe(UPGRADE_COST[a]);
      expect(upgradeCost(a, ATTRIBUTE_CAPS[a])).toBeNull();
      expect(upgradeCost(a, ATTRIBUTE_CAPS[a] + 3)).toBeNull();
      expect(upgradeCost(a, Number.NaN)).toBeNull();
    }
  });

  it('total the full set of caps for a maxed knight', () => {
    let total = 0;
    for (const a of ATTRIBUTES)
      for (let level = 0; ; level++) {
        const cost = upgradeCost(a, level);
        if (cost === null) break;
        total += cost;
      }
    expect(maxedCost).toBe(total);
    expect(maxedCost).toBe(ATTRIBUTES.reduce((s, a) => s + UPGRADE_COST[a] * ATTRIBUTE_CAPS[a], 0));
  });
});
