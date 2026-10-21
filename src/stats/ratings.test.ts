import { describe, expect, it } from 'vitest';
import { PITCH, STEP } from '../game/constants';
import type { Role, TeamId } from '../game/types';
import { DEFAULT_LOOK } from '../knight/look';
import { playerFixture } from '../modes/manager/league';
import { autoDraft, planMatch, startSeason } from '../modes/manager/season';
import { MatchRunner, type FixtureConfig, type TimedAction } from '../modes/runner';
import { REALM_HOUSES } from '../setup/houses';
import { rosterLineup } from '../setup/rosters';
import { setTeamTier } from '../setup/squads';
import { spec } from '../test/fixtures';
import { kickOnce, stage, walk } from '../test/stage';
import {
  BASE,
  MAX_RATING,
  MIN_RATING,
  MIN_SHARE,
  REGULATION_STEPS,
  rateMatch,
  ratingsFrom,
  standardise,
  toRating,
  valueActions,
  type MatchRatings,
  type ValueKind,
} from './ratings';
import { tally, type StepCounters } from './tally';
import type { MatchStats } from './types';
import { RATING_MODEL } from './value-model';

const GOAL = { x: PITCH.right + 20, y: PITCH.centerY };

function fixture(seed: number, tiers: readonly [number, number], draws = true): FixtureConfig {
  const home = REALM_HOUSES[seed % REALM_HOUSES.length];
  const away = REALM_HOUSES[(seed + 3) % REALM_HOUSES.length];
  if (!home || !away) throw new Error('No houses');
  return {
    home: setTeamTier(rosterLineup(home, 4), tiers[0]),
    away: setTeamTier(rosterLineup(away, 4), tiers[1]),
    seed,
    draws,
  };
}

/** A swap for the home side at 30 s and a substitution for the away side at 60 s. */
const CHANGES: readonly TimedAction[] = [
  { step: 30 / STEP, team: 0, action: { kind: 'positions', a: 1, b: 3 } },
  { step: 60 / STEP, team: 1, action: { kind: 'substitution', offId: 6, on: spec('mid', { tier: 3 }) } },
];

function played(config: FixtureConfig, scheduled: readonly TimedAction[] = []): MatchRunner {
  const runner = new MatchRunner(config, scheduled);
  runner.advance(Infinity);
  return runner;
}

/** Plays a runner the way the match screen does: uneven chunks, reading the ratings between them. */
function watched(runner: MatchRunner, between: (r: MatchRunner) => void = () => undefined): MatchRunner {
  const chunks = [1, 7, 120, 3, 997, 64];
  for (let i = 0; !runner.ended; i++) {
    runner.advance(chunks[i % chunks.length] ?? 1);
    rateMatch(runner.stats);
    between(runner);
  }
  return runner;
}

const ratingOf = (ratings: MatchRatings, id: number): number => {
  const r = ratings.knights.find((k) => k.id === id);
  if (!r) throw new Error(`knight ${id} not rated`);
  return r.rating;
};

/** A sample of real matches across tiers, some with a swap, a substitution and golden goals. */
const REAL: readonly MatchStats[] = [
  [101, [0, 0]],
  [102, [1, 2]],
  [103, [2, 2]],
  [104, [3, 3]],
  [105, [4, 3]],
  [106, [4, 4]],
].map(
  ([seed, tiers], i) =>
    played(fixture(seed as number, tiers as [number, number], i % 2 === 0), i % 3 === 0 ? CHANGES : []).stats,
);

describe('determinism', () => {
  it('rates a match the same watched in uneven chunks, stepped, skipped and replayed from its timeline', () => {
    const config = fixture(31, [3, 3], false);
    const live = watched(new MatchRunner(config), (r) => {
      if (r.step > 3000 && r.timeline.length === 0) r.act(0, { kind: 'positions', a: 1, b: 2 });
      if (r.step > 6000 && r.subsLeft(0) > 0) r.act(0, { kind: 'substitution', offId: 2, on: spec('mid') });
    });
    expect(live.timeline).toHaveLength(2);
    const stepped = new MatchRunner(config, live.timeline);
    while (!stepped.ended) {
      stepped.advanceOne();
      stepped.state.events = [];
    }
    const replayed = played(config, live.timeline);
    const ratings = rateMatch(live.stats);
    expect(ratings.knights).toHaveLength(9);
    expect(rateMatch(replayed.stats)).toEqual(ratings);
    expect(rateMatch(stepped.stats)).toEqual(ratings);
    expect(rateMatch(live.stats)).toEqual(ratings);
  });

  it('rates a Manager match the same watched with its rival managers or simmed by the Skip', () => {
    let season = startSeason(8, 'ember', { ...DEFAULT_LOOK, name: 'Sir Rookie' });
    while (!season.league) season = autoDraft(season);
    const next = playerFixture(season.league);
    if (!next) throw new Error('no fixture');
    const plan = planMatch(season, next);
    const seen = watched(new MatchRunner(plan.config()));
    const skipped = played(plan.config());
    expect(rateMatch(skipped.stats)).toEqual(rateMatch(seen.stats));
  });
});

/** The rating `who` gets in each of two staged versions of a moment, run for the same time. */
function staged(build: (variant: boolean) => { stats: MatchStats; id: number }): [number, number] {
  const [a, b] = [build(true), build(false)];
  return [ratingOf(rateMatch(a.stats), a.id), ratingOf(rateMatch(b.stats), b.id)];
}

describe('staged moments: the right knight earns, the right knight pays', () => {
  function shotAt(keeperInPath: boolean) {
    const s = stage(['fwd'], ['gk']);
    const [fwd, gk] = [s.home('fwd'), s.away('gk')];
    Object.assign(fwd, { x: 900, y: 330 });
    if (keeperInPath) Object.assign(gk, { x: PITCH.right - 25, y: 330 });
    s.lineUp(fwd, GOAL);
    s.run(1.5, kickOnce(fwd));
    return { s, fwd, gk };
  }

  it('a save lifts the keeper above the same shot conceded: a clean sheet helps him', () => {
    const [saved, conceded] = staged((v) => {
      const { s, gk } = shotAt(v);
      expect(s.state.score).toEqual(v ? [0, 0] : [1, 0]);
      return { stats: s.recorder.stats, id: gk.id };
    });
    expect(saved).toBeGreaterThan(conceded);
    expect(saved).toBeGreaterThan(BASE + RATING_MODEL.lift);
  });

  it('the goal lifts the shooter above the same shot saved', () => {
    const [scored, saved] = staged((v) => {
      const { s, fwd } = shotAt(!v);
      return { stats: s.recorder.stats, id: fwd.id };
    });
    expect(scored).toBeGreaterThan(saved);
  });

  it('a block lifts the defender who made it above standing aside', () => {
    const [blocked, aside] = staged((v) => {
      const s = stage(['fwd'], ['gk', 'def']);
      const [fwd, def] = [s.home('fwd'), s.away('def')];
      Object.assign(fwd, { x: 850, y: 330 });
      Object.assign(def, v ? { x: 1050, y: 330 } : { x: 1050, y: 560 });
      s.lineUp(fwd, GOAL);
      s.run(1.5, kickOnce(fwd));
      expect(s.line(def).blocks).toBe(v ? 1 : 0);
      return { stats: s.recorder.stats, id: def.id };
    });
    expect(blocked).toBeGreaterThan(aside);
  });

  function passPast(defInLane: boolean) {
    const s = stage(['mid', 'fwd'], ['def']);
    const [mid, fwd, def] = [s.home('mid'), s.home('fwd'), s.away('def')];
    Object.assign(mid, { x: 500, y: 330 });
    Object.assign(fwd, { x: 900, y: 330 });
    Object.assign(def, defInLane ? { x: 700, y: 330 } : { x: 700, y: 560 });
    s.lineUp(mid, fwd);
    s.run(2, kickOnce(mid));
    return { s, mid, def };
  }

  it('an interception lifts the interceptor and costs the passer', () => {
    const [intercepted, missed] = staged((v) => {
      const { s, def } = passPast(v);
      expect(s.line(def).interceptions).toBe(v ? 1 : 0);
      return { stats: s.recorder.stats, id: def.id };
    });
    expect(intercepted).toBeGreaterThan(missed);
    const [lost, completed] = staged((v) => {
      const { s, mid } = passPast(v);
      return { stats: s.recorder.stats, id: mid.id };
    });
    expect(lost).toBeLessThan(completed);
  });

  it('an own goal sinks the defender below the same ball played upfield', () => {
    const [own, upfield] = staged((v) => {
      const s = stage(['def', 'gk'], ['fwd']);
      const def = s.home('def');
      Object.assign(def, { x: 300, y: 330 });
      s.lineUp(def, v ? { x: PITCH.left - 20, y: 330 } : { x: 700, y: 330 });
      s.run(1.5, kickOnce(def));
      expect(s.line(def).ownGoals).toBe(v ? 1 : 0);
      return { stats: s.recorder.stats, id: def.id };
    });
    expect(own).toBeLessThan(upfield);
    expect(own).toBeLessThan(BASE);
  });

  it('being tackled costs the carrier, deep in his own half, against carrying on', () => {
    const [tackled, clear] = staged((v) => {
      const s = stage(['def', 'gk'], ['fwd']);
      const [def, fwd] = [s.home('def'), s.away('fwd')];
      Object.assign(def, { x: 260, y: 330 });
      Object.assign(fwd, v ? { x: 420, y: 330 } : { x: 900, y: 560 });
      s.lineUp(def, { x: 700, y: 330 });
      // The defender carries upfield into the forward, who stands his ground and keeps the ball.
      s.run(1.2, walk(def, { x: 700, y: 330 }), () => v && s.state.ball.teamTouch[1]?.age === 0);
      if (v) {
        Object.assign(def, { x: 260, y: 560, vx: 0, vy: 0 });
        Object.assign(s.state.ball, { vx: 0, vy: 0 });
      }
      s.run(v ? 1.2 - s.state.phaseTime : 0.6);
      expect(s.line(def).turnovers).toBe(v ? 1 : 0);
      if (v) {
        const loss = valueActions(s.recorder.stats).find((a) => a.kind === 'loss' && a.knightId === def.id);
        expect(loss?.value).toBeLessThan(-0.02);
      }
      return { stats: s.recorder.stats, id: def.id };
    });
    expect(tackled).toBeLessThan(clear);
  });

  it('an assist is never worth less than the same pass with the shot saved', () => {
    const [assisted, saved] = staged((v) => {
      const s = stage(['mid', 'fwd'], ['gk']);
      const [mid, fwd, gk] = [s.home('mid'), s.home('fwd'), s.away('gk')];
      Object.assign(mid, { x: 700, y: 200 });
      Object.assign(fwd, { x: 900, y: 330 });
      if (!v) Object.assign(gk, { x: PITCH.right - 25, y: 330 });
      s.lineUp(mid, fwd);
      s.run(1, kickOnce(mid));
      const ball = s.state.ball;
      const back = Math.hypot(GOAL.x - ball.x, GOAL.y - ball.y);
      Object.assign(fwd, {
        x: ball.x - ((GOAL.x - ball.x) / back) * 30,
        y: ball.y - ((GOAL.y - ball.y) / back) * 30,
        vx: 0,
        vy: 0,
      });
      Object.assign(ball, { vx: 0, vy: 0 });
      s.run(1.5, kickOnce(fwd));
      expect(s.line(mid).assists).toBe(v ? 1 : 0);
      return { stats: s.recorder.stats, id: mid.id };
    });
    expect(assisted).toBeGreaterThanOrEqual(saved);
  });
});

const POSITIVE: readonly ValueKind[] = [
  'goal',
  'assist',
  'save',
  'block',
  'claim',
  'tackle',
  'interception',
  'recovery',
];
const NEGATIVE: readonly ValueKind[] = ['ownGoal', 'loss', 'conceded'];

describe('signs, on real matches', () => {
  it('goals, assists, saves, blocks, claims and won balls are never negative; own goals, losses and goals conceded never positive', () => {
    const seen = new Set<ValueKind>();
    for (const stats of REAL) {
      for (const a of valueActions(stats)) {
        seen.add(a.kind);
        if (POSITIVE.includes(a.kind)) expect(a.value, `${a.kind} at ${a.step}`).toBeGreaterThanOrEqual(0);
        if (NEGATIVE.includes(a.kind)) expect(a.value, `${a.kind} at ${a.step}`).toBeLessThanOrEqual(0);
      }
    }
    for (const kind of ['goal', 'save', 'tackle', 'interception', 'recovery', 'loss', 'conceded'] as const)
      expect(seen).toContain(kind);
  });

  it("taking away any one such action never moves the knight's rating the wrong way", () => {
    let checked = 0;
    for (const stats of REAL) {
      const actions = valueActions(stats);
      const full = ratingsFrom(stats, actions);
      actions.forEach((a, i) => {
        const sign = POSITIVE.includes(a.kind) ? 1 : NEGATIVE.includes(a.kind) ? -1 : 0;
        if (!sign) return;
        const without = ratingsFrom(
          stats,
          actions.filter((_, j) => j !== i),
        );
        const [before, after] = [ratingOf(full, a.knightId), ratingOf(without, a.knightId)];
        if (sign > 0) expect(after).toBeLessThanOrEqual(before);
        else expect(after).toBeGreaterThanOrEqual(before);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('charges each turnover the moment the ball is lost, and on average it costs', () => {
    const costs: number[] = [];
    let turnovers = 0;
    for (const stats of REAL) {
      const losses = valueActions(stats).filter((a) => a.kind === 'loss');
      for (const t of stats.actions) {
        if (t.kind !== 'turnover') continue;
        turnovers++;
        const loss = losses.find((a) => a.knightId === t.knightId && a.step === t.step);
        if (loss) costs.push(loss.value);
      }
    }
    // A few fall a step or two off the log's, where possession for valuing settled on another touch; and
    // not every one costs: losing it high up to a rival boxed in by the press can leave the chance as it was.
    expect(turnovers).toBeGreaterThan(50);
    expect(costs.length / turnovers).toBeGreaterThan(0.8);
    expect(costs.reduce((a, b) => a + b, 0) / costs.length).toBeLessThan(-0.03);
  });

  it('rates everyone who played, substitutes too, between 3 and 10, with a man of the match among them', () => {
    for (const stats of REAL) {
      const ratings = rateMatch(stats);
      expect(ratings.knights.map((k) => k.id)).toEqual(
        stats.knights.filter((k) => k.playedSteps > 0).map((k) => k.id),
      );
      for (const k of ratings.knights) {
        expect(k.rating).toBeGreaterThanOrEqual(MIN_RATING);
        expect(k.rating).toBeLessThanOrEqual(MAX_RATING);
        expect(Number.isFinite(k.score)).toBe(true);
      }
      const best = Math.max(...ratings.knights.map((k) => k.score));
      expect(ratings.knights.find((k) => k.id === ratings.motm)?.score).toBe(best);
    }
  });

  it("values a goal pushed in with the body like one kicked: the scorer's action ends at certainty", () => {
    let pushed = 0;
    for (const stats of REAL) {
      const actions = valueActions(stats);
      for (const g of stats.actions) {
        if (g.kind !== 'goal' || g.ownGoal || g.knightId === null) continue;
        const credit = actions.find((a) => a.kind === 'goal' && a.knightId === g.knightId && a.value > 0);
        expect(credit, `goal at ${g.step}`).toBeDefined();
        if (!g.fromShot) pushed++;
      }
    }
    expect(pushed).toBeGreaterThan(0);
  });
});

/** Steps in each role, as a stats line has them. */
const steps = (roles: Partial<Record<Role, number>>) => ({ gk: 0, def: 0, mid: 0, fwd: 0, ...roles });

describe('the rating scale', () => {
  const { roles } = RATING_MODEL;
  const full = REGULATION_STEPS;

  it("measures a knight against his position's norm, scaled to the time he played", () => {
    expect(standardise(roles.mid.mean, steps({ mid: full }), roles)).toBeCloseTo(0, 9);
    expect(standardise(roles.mid.mean + roles.mid.sd, steps({ mid: full }), roles)).toBeCloseTo(1, 9);
    // Half a match: half the par, and a spread √2 narrower.
    const half = steps({ mid: full / 2 });
    expect(standardise(roles.mid.mean / 2, half, roles)).toBeCloseTo(0, 9);
    expect(standardise(roles.mid.mean / 2 + roles.mid.sd / Math.SQRT2, half, roles)).toBeCloseTo(1, 9);
    // Swapped at half time: the par is half of each role's.
    const swapped = steps({ def: full / 2, fwd: full / 2 });
    expect(standardise((roles.def.mean + roles.fwd.mean) / 2, swapped, roles)).toBeCloseTo(0, 9);
  });

  it('judges a cameo as if he had played a quarter of the match, so one touch cannot send him to 10', () => {
    const cameo = steps({ fwd: full * 0.05 });
    const quarter = steps({ fwd: full * MIN_SHARE });
    const lucky = 0.6;
    const z = standardise(lucky, cameo, roles);
    const zQuarter = standardise(lucky + roles.fwd.mean * (MIN_SHARE - 0.05), quarter, roles);
    expect(z).toBeCloseTo(zQuarter, 9);
    expect(standardise(0, steps({}), roles)).toBe(0);
  });

  it('never lowers a rating for more value, at any time played, and clamps to 3–10', () => {
    for (const share of [0.02, 0.25, 0.5, 1, 1.3])
      for (const role of ['gk', 'def', 'mid', 'fwd'] as const) {
        let last = -Infinity;
        for (let v = -3; v <= 3; v += 0.05) {
          const r = toRating(BASE + 1 + standardise(v, steps({ [role]: full * share }), roles));
          expect(r).toBeGreaterThanOrEqual(last);
          last = r;
        }
      }
    expect(toRating(-50)).toBe(MIN_RATING);
    expect(toRating(50)).toBe(MAX_RATING);
  });

  it('breaks a tie for man of the match by the winning side, then the lower id', () => {
    const counters = (team: TeamId): StepCounters => ({
      team,
      roleSteps: steps({ mid: 100 }),
      touches: 0,
      kicks: 0,
      carrySteps: 0,
      bargeAttempts: 0,
    });
    const make = (goals: [number, number]): MatchStats =>
      tally(
        [],
        new Map([
          [0, counters(1)],
          [1, counters(0)],
          [2, counters(1)],
        ]),
        [0, 0],
        goals,
        100,
        3,
        null,
        { cells: [], owners: [], touchers: [] },
      );
    expect(rateMatch(make([1, 0])).motm).toBe(1);
    expect(rateMatch(make([0, 1])).motm).toBe(0);
    expect(rateMatch(make([0, 0])).motm).toBe(0);
  });
});

describe('position fairness (the harness checks this on 800 matches)', () => {
  it('gives each position a similar centre and spread', { timeout: 60_000 }, () => {
    const byRole = new Map<Role, number[]>();
    for (let i = 0; i < 30; i++) {
      const tier = i % 5;
      const stats = played(fixture(700 + i, [tier, Math.min(4, tier + (i % 2))])).stats;
      for (const k of rateMatch(stats).knights) byRole.set(k.role, [...(byRole.get(k.role) ?? []), k.rating]);
    }
    const all = [...byRole.values()].flat();
    const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = (xs: readonly number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
    expect(all).toHaveLength(240);
    expect(mean(all)).toBeGreaterThan(6.4);
    expect(mean(all)).toBeLessThan(7.1);
    for (const [role, xs] of byRole) {
      expect(Math.abs(mean(xs) - mean(all)), role).toBeLessThan(0.45);
      expect(sd(xs) / sd(all), role).toBeGreaterThan(0.6);
      expect(sd(xs) / sd(all), role).toBeLessThan(1.5);
    }
  });
});

/** Ratings to two decimals by knight, and the man of the match: any change to the model or the stats shows. */
const golden = (stats: MatchStats): string => {
  const r = rateMatch(stats);
  const score = `${stats.teams[0].goals}-${stats.teams[1].goals}`;
  return `${score} | ${r.knights.map((k) => `${k.id}${k.role}:${k.rating.toFixed(2)}`).join(' ')} | motm ${r.motm ?? '-'}`;
};

const GOLDEN: Readonly<Record<number, string>> = {
  1: '2-0 | 0gk:7.46 1def:7.81 2mid:6.40 3fwd:6.58 4gk:6.76 5def:6.21 6mid:6.58 7fwd:6.82 | motm 1',
  3: '3-4 | 0gk:6.16 1def:7.48 2mid:5.67 3fwd:8.23 4gk:6.78 5def:7.53 6mid:7.85 7fwd:7.96 | motm 3',
  5: '3-2 | 0gk:6.80 1def:5.89 2mid:7.93 3fwd:6.41 4gk:7.19 5def:6.27 6mid:6.31 7fwd:6.96 | motm 2',
  7: '1-3 | 0gk:5.28 1def:5.42 2mid:6.32 3fwd:7.45 4gk:6.50 5def:8.38 6mid:6.70 7fwd:7.64 | motm 5',
  9: '0-3 | 0gk:5.76 1def:6.12 2mid:6.82 3fwd:6.66 4gk:7.16 5def:5.06 6mid:9.08 7fwd:7.20 | motm 6',
};

describe('golden matches', () => {
  it.each([
    [1, 0, 0],
    [3, 2, 2],
    [5, 4, 4],
    [7, 4, 3],
    [9, 1, 2],
  ] as const)('seed %i (tiers %i v %i) rates as pinned', (seed, home, away) => {
    expect(golden(played(fixture(seed, [home, away], false)).stats)).toBe(GOLDEN[seed]);
  });
});
