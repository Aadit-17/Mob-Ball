import type { SeasonSummary } from './career';
import type { Honour } from './economy';

/** A season average counts towards the best only over this many matches, so a cameo season can't top the list. */
export const BEST_AVERAGE_APPS = 7;

/** A best and the season it came in (the first such season on a tie); null before any season counts. */
export interface Best {
  readonly value: number;
  readonly season: number;
}

export interface CareerRecords {
  readonly seasons: number;
  readonly apps: number;
  readonly goals: number;
  readonly assists: number;
  readonly motm: number;
  /** Mean of every match rating of the career, null without an appearance. */
  readonly average: number | null;
  readonly honours: Readonly<Record<Honour, number>>;
  readonly trophies: number;
  /** Clubs he has played a season for, in the order he joined them. */
  readonly clubs: readonly string[];
  readonly best: {
    readonly goals: Best | null;
    readonly assists: Best | null;
    readonly motm: Best | null;
    readonly average: Best | null;
  };
}

function best(history: readonly SeasonSummary[], value: (s: SeasonSummary) => number | null): Best | null {
  let top: Best | null = null;
  for (const s of history) {
    const v = value(s);
    if (v !== null && (top === null || v > top.value)) top = { value: v, season: s.season };
  }
  return top;
}

/** Career totals and season bests from the history of finished seasons. */
export function careerRecords(history: readonly SeasonSummary[]): CareerRecords {
  const sum = (f: (s: SeasonSummary) => number): number => history.reduce((t, s) => t + f(s), 0);
  const apps = sum((s) => s.apps);
  const honours: Record<Honour, number> = {
    title: 0,
    promotion: 0,
    topScorer: 0,
    royalCall: 0,
    royalCrown: 0,
  };
  for (const h of history.flatMap((s) => s.honours)) honours[h]++;
  return {
    seasons: history.length,
    apps,
    goals: sum((s) => s.goals),
    assists: sum((s) => s.assists),
    motm: sum((s) => s.motm),
    average: apps ? sum((s) => (s.average ?? 0) * s.apps) / apps : null,
    honours,
    // Promotion with a title is one trophy, not two.
    trophies: honours.title + honours.topScorer + honours.royalCrown,
    clubs: [...new Set(history.map((s) => s.club))],
    best: {
      goals: best(history, (s) => (s.apps ? s.goals : null)),
      assists: best(history, (s) => (s.apps ? s.assists : null)),
      motm: best(history, (s) => (s.apps ? s.motm : null)),
      average: best(history, (s) => (s.apps >= BEST_AVERAGE_APPS ? s.average : null)),
    },
  };
}
