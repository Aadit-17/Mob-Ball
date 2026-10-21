import { describe, expect, it } from 'vitest';
import { NO_ATTRIBUTES } from '../../game/attributes';
import type { SeasonSummary } from './career';
import { BEST_AVERAGE_APPS, careerRecords } from './records';

const season = (n: number, over: Partial<SeasonSummary>): SeasonSummary => ({
  season: n,
  age: 17 + n,
  club: 'mill',
  division: 0,
  position: 'fwd',
  finish: 4,
  apps: 14,
  starts: 14,
  subOns: 0,
  subOffs: 0,
  goals: 0,
  assists: 0,
  motm: 0,
  average: 6.8,
  matchPoints: 0,
  honourPoints: 0,
  honours: [],
  relegated: false,
  fame: 0,
  stars: 2.3,
  attributes: NO_ATTRIBUTES,
  offers: [],
  ...over,
});

describe('career records', () => {
  const history = [
    season(0, { goals: 5, assists: 2, motm: 1, average: 6.5 }),
    season(1, { goals: 12, assists: 1, motm: 4, average: 7.6, honours: ['title', 'promotion', 'topScorer'] }),
    season(2, {
      club: 'ash',
      division: 1,
      goals: 12,
      assists: 6,
      motm: 2,
      average: 7.0,
      honours: ['royalCall'],
    }),
    season(3, { club: 'ember', division: 2, apps: 3, goals: 1, average: 9.5 }),
    season(4, { club: 'mill', apps: 0, average: null }),
  ];
  const r = careerRecords(history);

  it('sums the career and counts every club once, in the order he joined them', () => {
    expect(r.seasons).toBe(5);
    expect(r.apps).toBe(14 * 3 + 3);
    expect(r.goals).toBe(30);
    expect(r.assists).toBe(9);
    expect(r.motm).toBe(7);
    expect(r.clubs).toEqual(['mill', 'ash', 'ember']);
    expect(r.average).toBeCloseTo((6.5 * 14 + 7.6 * 14 + 7.0 * 14 + 9.5 * 3) / 45);
  });

  it('keeps the best season of each, the first on a tie, and a best average only over enough matches', () => {
    expect(r.best.goals).toEqual({ value: 12, season: 1 });
    expect(r.best.assists).toEqual({ value: 6, season: 2 });
    expect(r.best.motm).toEqual({ value: 4, season: 1 });
    expect(r.best.average).toEqual({ value: 7.6, season: 1 });
    expect(3).toBeLessThan(BEST_AVERAGE_APPS);
  });

  it('counts honours and trophies: a title, a golden boot, a royal crown', () => {
    expect(r.honours).toEqual({ title: 1, promotion: 1, topScorer: 1, royalCall: 1, royalCrown: 0 });
    expect(r.trophies).toBe(2);
  });

  it('is empty before the first season ends', () => {
    const none = careerRecords([]);
    expect(none.average).toBeNull();
    expect(none.best.goals).toBeNull();
    expect(none.clubs).toEqual([]);
  });
});
