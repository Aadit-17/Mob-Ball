import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_CAPS, ATTRIBUTES, NO_ATTRIBUTES, type Attributes } from '../../game/attributes';
import { overallStars } from './stars';
import { UPGRADE_COST } from './upgrades';
import {
  age,
  canTrain,
  DECLINE_AGE,
  declineRate,
  FAME_MAX,
  guard,
  guardCost,
  matchPoints,
  nextFame,
  train,
  trainCost,
  type Training,
} from './economy';

const MAXED: Attributes = { pace: 8, shot: 8, strength: 8, stamina: 10 };
const young = (points: number, attributes: Attributes = NO_ATTRIBUTES): Training => ({
  age: 20,
  points,
  attributes,
  wear: NO_ATTRIBUTES,
  guarded: [],
});

describe('match points', () => {
  it('pay nothing for a poor match, a little for a typical one and much more for a standout one', () => {
    expect(matchPoints(5)).toBe(0);
    expect(matchPoints(5.5)).toBe(0);
    expect(matchPoints(6.8)).toBe(2);
    expect(matchPoints(8)).toBe(6);
    expect(matchPoints(9)).toBe(12);
    expect(matchPoints(10)).toBe(20);
    expect(matchPoints(Number.NaN)).toBe(0);
  });

  it('never fall as the rating rises, and rise faster the higher it goes', () => {
    let last = 0;
    for (let r = 3; r <= 10; r += 0.01) {
      expect(matchPoints(r)).toBeGreaterThanOrEqual(last);
      last = matchPoints(r);
    }
    expect(matchPoints(9) - matchPoints(8)).toBeGreaterThan(matchPoints(8) - matchPoints(7));
  });
});

describe('training', () => {
  it('charges each level what upgrades.ts prices it at, and stops at the cap', () => {
    let t = young(10_000);
    for (const stat of ATTRIBUTES) {
      for (let level = 0; level < ATTRIBUTE_CAPS[stat]; level++) {
        expect(trainCost(t, stat)).toBe(UPGRADE_COST[stat]);
        const before = t.points;
        t = train(t, stat);
        expect(before - t.points).toBe(UPGRADE_COST[stat]);
      }
      expect(trainCost(t, stat)).toBeNull();
      expect(() => train(t, stat)).toThrow();
    }
    expect(t.attributes).toEqual(MAXED);
  });

  it('needs the points', () => {
    expect(trainCost(young(9), 'pace')).toBeNull();
    expect(trainCost(young(10), 'pace')).toBe(10);
  });

  it('raises stats only before the decline age; after it points can only guard', () => {
    expect(canTrain(DECLINE_AGE - 1)).toBe(true);
    expect(canTrain(DECLINE_AGE)).toBe(false);
    const old: Training = { ...young(100, MAXED), age: DECLINE_AGE, attributes: { ...MAXED, pace: 5 } };
    expect(trainCost(old, 'pace')).toBeNull();
    expect(guardCost(old, 'pace')).toBe(UPGRADE_COST.pace);
    expect(guardCost(young(100, MAXED), 'pace')).toBeNull();
    const guarded = guard(old, 'pace');
    expect(guarded.attributes).toEqual(old.attributes);
    expect(guardCost(guarded, 'pace')).toBeNull();
    expect(guardCost({ ...old, attributes: { ...MAXED, shot: 0 } }, 'shot')).toBeNull();
  });
});

describe('ageing', () => {
  /** A maxed knight from 26, aged a season at a time, guarding everything or nothing. */
  function career(guardAll: boolean): Training[] {
    let t: Training = { ...young(0, MAXED), age: 26 };
    const out = [t];
    while (t.age < 38) {
      if (guardAll)
        for (const stat of ATTRIBUTES)
          if (guardCost({ ...t, points: 1000 }, stat) !== null) t = guard({ ...t, points: 1000 }, stat);
      t = age({ ...t, points: 0 });
      out.push(t);
    }
    return out;
  }
  const at = (ts: Training[], years: number) => ts.find((t) => t.age === years) ?? ts[0];
  const stars = (t: Training | undefined) => overallStars(1, t?.attributes ?? NO_ATTRIBUTES);

  it('leaves stats alone until the decline age', () => {
    const ts = career(false);
    expect(at(ts, DECLINE_AGE - 1)?.attributes).toEqual(MAXED);
    expect(at(ts, DECLINE_AGE)?.attributes).not.toEqual(MAXED);
    expect(declineRate(DECLINE_AGE - 1)).toBe(0);
  });

  it('then takes more each year, up to its maximum', () => {
    for (let a = DECLINE_AGE; a < 40; a++) expect(declineRate(a + 1)).toBeGreaterThanOrEqual(declineRate(a));
    expect(declineRate(60)).toBe(declineRate(40));
  });

  it('leaves a 34-year-old useful but clearly fading, and guarding slows the fall without stopping it', () => {
    const open = career(false);
    const guarded = career(true);
    const peak = stars(at(open, 30));
    expect(stars(at(open, 34))).toBeLessThan(peak - 0.5);
    expect(stars(at(open, 34))).toBeGreaterThan(2.5);
    expect(stars(at(guarded, 34))).toBeGreaterThan(stars(at(open, 34)));
    expect(stars(at(guarded, 34))).toBeLessThan(peak);
    for (let a = DECLINE_AGE; a <= 38; a++)
      expect(stars(at(guarded, a))).toBeLessThan(stars(at(guarded, a - 1)) + 1e-9);
    expect(stars(at(guarded, 38))).toBeLessThan(stars(at(guarded, 34)));
  });

  it('spends guards each season and keeps levels whole and within their caps', () => {
    const ts = career(true);
    for (const t of ts) {
      expect(t.guarded).toEqual([]);
      for (const stat of ATTRIBUTES) {
        expect(Number.isInteger(t.attributes[stat])).toBe(true);
        expect(t.attributes[stat]).toBeGreaterThanOrEqual(0);
        expect(t.wear[stat]).toBeGreaterThanOrEqual(0);
        expect(t.wear[stat]).toBeLessThan(1);
      }
    }
  });
});

describe('fame', () => {
  it('grows with ratings, goals and honours, counts more higher up, and fades slowly', () => {
    const season = { division: 2 as const, average: 7.5, goals: 10, honours: [] };
    expect(nextFame(0, season)).toBeGreaterThan(nextFame(0, { ...season, division: 0 }));
    expect(nextFame(0, { ...season, goals: 20 })).toBeGreaterThan(nextFame(0, season));
    expect(nextFame(0, { ...season, honours: ['title', 'royalCall'] })).toBeGreaterThan(nextFame(0, season));
    const quiet = { division: 2 as const, average: null, goals: 0, honours: [] };
    expect(nextFame(50, quiet)).toBeLessThan(50);
    expect(nextFame(50, quiet)).toBeGreaterThan(40);
    expect(nextFame(99, { ...season, honours: ['title', 'royalCall', 'royalCrown', 'topScorer'] })).toBe(
      FAME_MAX,
    );
  });
});
