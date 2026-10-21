import { describe, expect, it } from 'vitest';
import { TOP_TIER } from '../../ai/skills';
import {
  ATTRIBUTE_CAPS,
  ATTRIBUTES,
  NO_ATTRIBUTES,
  paceFactor,
  strengthFactor,
  type Attributes,
} from '../../game/attributes';
import { BUILDS } from '../../game/constants';
import { createMatch, kickDirection } from '../../game/match';
import { DEFAULT_LOOK } from '../../knight/look';
import { spec } from '../../test/fixtures';
import {
  humanKnightSpec,
  matchGoals,
  overallStars,
  PLACE_TIER_VALUE,
  SIM_BRAIN_TIER,
  simKnightSpec,
  staminaTiers,
  starText,
  tierForGoals,
  type ForgedKnight,
} from './stars';

const trained = (level: (cap: number) => number): Attributes =>
  Object.fromEntries(ATTRIBUTES.map((a) => [a, level(ATTRIBUTE_CAPS[a])])) as unknown as Attributes;
const MAXED = trained((cap) => cap);
const STANDARD = 1;

describe('overall stars', () => {
  it('read the measured tier values back as their tiers', () => {
    PLACE_TIER_VALUE.forEach((goals, tier) => {
      expect(tierForGoals(goals)).toBeCloseTo(tier, 12);
    });
    expect(tierForGoals(-5)).toBe(0);
    expect(tierForGoals(5)).toBe(TOP_TIER);
  });

  it('rise with every level of every attribute, up to the cap, for every build', () => {
    for (const build of BUILDS.keys())
      for (const a of ATTRIBUTES)
        for (let level = 0; level < ATTRIBUTE_CAPS[a]; level++) {
          const before = overallStars(build, { ...NO_ATTRIBUTES, [a]: level });
          const after = overallStars(build, { ...NO_ATTRIBUTES, [a]: level + 1 });
          expect(after, `${a} ${level} → ${level + 1}, build ${build}`).toBeGreaterThan(before);
        }
  });

  it('never fall as training is added on top of other training, and stop at Legend', () => {
    for (const build of BUILDS.keys())
      for (const a of ATTRIBUTES)
        for (let level = 0; level < ATTRIBUTE_CAPS[a]; level++) {
          const before = overallStars(build, { ...MAXED, [a]: level });
          const after = overallStars(build, { ...MAXED, [a]: level + 1 });
          expect(after).toBeGreaterThanOrEqual(before);
          expect(after).toBeLessThanOrEqual(TOP_TIER);
        }
  });

  it('gain nothing past a cap', () => {
    for (const a of ATTRIBUTES)
      expect(overallStars(STANDARD, { ...NO_ATTRIBUTES, [a]: ATTRIBUTE_CAPS[a] + 3 })).toBe(
        overallStars(STANDARD, { ...NO_ATTRIBUTES, [a]: ATTRIBUTE_CAPS[a] }),
      );
  });

  it('put an untrained knight just above a Knight, and a maxed one a tier and a half to two above that', () => {
    const base = overallStars(STANDARD, NO_ATTRIBUTES);
    expect(base).toBeGreaterThan(2);
    expect(base).toBeLessThan(2.5);
    const gain = overallStars(STANDARD, MAXED) - base;
    expect(gain).toBeGreaterThanOrEqual(1.5);
    expect(gain).toBeLessThanOrEqual(2);
  });

  it('rank the builds as measured: Nimble, Standard, Hefty', () => {
    expect(overallStars(0, NO_ATTRIBUTES)).toBeGreaterThan(overallStars(1, NO_ATTRIBUTES));
    expect(overallStars(1, NO_ATTRIBUTES)).toBeGreaterThan(overallStars(2, NO_ATTRIBUTES));
  });

  it('count stamina only through the season tiredness it saves', () => {
    expect(staminaTiers(NO_ATTRIBUTES)).toBe(0);
    const rested = { ...NO_ATTRIBUTES, stamina: ATTRIBUTE_CAPS.stamina };
    expect(matchGoals(STANDARD, rested)).toBe(matchGoals(STANDARD, NO_ATTRIBUTES));
    expect(staminaTiers(rested)).toBeGreaterThan(0);
    expect(staminaTiers(rested)).toBeLessThan(0.5);
  });

  it('show as stars out of five, to the half, like a tier', () => {
    expect(starText(0)).toBe('★☆☆☆☆');
    expect(starText(TOP_TIER)).toBe('★★★★★');
    expect(starText(2)).toBe('★★★☆☆');
    expect(starText(2.3)).toBe('★★★½☆');
    expect(starText(9)).toBe('★★★★★');
  });
});

describe('the forged knight on the pitch', () => {
  const knight: ForgedKnight = {
    look: { ...DEFAULT_LOOK, build: 2 },
    attributes: { pace: 4, shot: 3, strength: 7, barge: 2, stamina: 5 },
  };

  it('when simmed, is a bot with the measured brain on the human legs, carrying his training', () => {
    const sim = simKnightSpec(knight, 'mid');
    expect(sim).toEqual({
      look: knight.look,
      role: 'mid',
      human: false,
      tier: SIM_BRAIN_TIER,
      speedFactor: 1,
      attributes: knight.attributes,
    });
    const [k] = createMatch({ home: [sim], away: [spec('fwd')], seed: 1 }).knights;
    expect(k?.attributes).toEqual(knight.attributes);
    expect(k?.mass).toBeCloseTo((BUILDS[2]?.mass ?? 0) * strengthFactor(knight.attributes), 12);
  });

  it('when played, is the human with his training and the usual aim assist', () => {
    const human = humanKnightSpec(knight, 'fwd');
    expect(human).toMatchObject({
      human: true,
      tier: TOP_TIER,
      speedFactor: 1,
      attributes: knight.attributes,
    });
    expect(paceFactor(human.attributes ?? NO_ATTRIBUTES)).toBeGreaterThan(1);
    // A kick toward goal from range bends toward the open corner for him and not for his sim.
    const aimFrom = (spec0: typeof human): number => {
      const state = createMatch({ home: [spec0], away: [spec('gk')], seed: 1 });
      const [shooter, keeper] = state.knights;
      if (!shooter || !keeper) throw new Error('missing knights');
      Object.assign(keeper, { x: 1150, y: 280 });
      Object.assign(shooter, { x: 860, y: 330 });
      Object.assign(state.ball, { x: 880, y: 330 });
      return kickDirection(state, shooter).y;
    };
    expect(aimFrom(human)).not.toBeCloseTo(aimFrom(simKnightSpec(knight, 'fwd')), 3);
  });
});
