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
import { humanInput } from '../test/humans';
import { kickOnce, stage, walk } from '../test/stage';
import { planFixture, playerFixture as careerFixture, startCareer } from '../modes/career/career';
import { breakdownParts } from '../ui/ratings';
import {
  BASE,
  MAX_RATING,
  MIN_RATING,
  MIN_SHARE,
  REGULATION_STEPS,
  manOfTheMatch,
  outcomeCredit,
  possessionsOf,
  rateMatch,
  ratingBreakdown,
  ratingsFrom,
  scoreOf,
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
    expect(scored - saved).toBeGreaterThan(RATING_MODEL.outcome.goal);
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
      const motm = ratings.knights.find((k) => k.id === ratings.motm);
      if (!motm) throw new Error('no man of the match');
      const [home, away] = [stats.teams[0].goals, stats.teams[1].goals];
      const winner = home > away ? 0 : away > home ? 1 : null;
      const best = (pick: (team: TeamId) => boolean) =>
        Math.max(...ratings.knights.filter((k) => pick(k.team)).map((k) => k.score));
      if (winner === null) expect(motm.score).toBe(best(() => true));
      else if (motm.team === winner) expect(motm.score).toBe(best((t) => t === winner));
      else expect(motm.score).toBeGreaterThanOrEqual(best((t) => t === winner) + RATING_MODEL.motmMargin);
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

describe('outcome credit', () => {
  const { outcome } = RATING_MODEL;
  const full = REGULATION_STEPS;
  const none = { goals: 0, assists: 0, ownGoals: 0, saves: 0, cleanSheet: false, possession: 0 };
  const fwd = steps({ fwd: full });
  const gk = steps({ gk: full });

  it('is calibrated to give a goal real weight, an assist half of it, an own goal the same cost, a save weight', () => {
    // The harness fits the goal so a forward's single goal reads 7.3; with its process value a goal lifts a
    // forward about 0.75 in all, the outcome weight about a third of it.
    expect(outcome.goal).toBeGreaterThan(0.2);
    expect(outcome.goal).toBeLessThan(1);
    expect(outcome.assist).toBeCloseTo(outcome.goal / 2, 3);
    expect(outcome.ownGoal).toBe(outcome.goal);
    expect(outcome.save).toBeGreaterThan(0);
    expect(RATING_MODEL.motmMargin).toBe(0.5);
  });

  it('lifts an otherwise equal knight by the calibrated amount for each goal, assist and save, and sinks him for an own goal', () => {
    const at = (o: Partial<typeof none>) => scoreOf(0.3, { ...none, ...o }, fwd, RATING_MODEL);
    expect(at({ goals: 1 }) - at({})).toBeCloseTo(outcome.goal, 9);
    expect(at({ goals: 2 }) - at({})).toBeCloseTo(2 * outcome.goal, 9);
    expect(at({ goals: 3 }) - at({ goals: 2 })).toBeCloseTo(outcome.goal, 9);
    expect(at({ assists: 1 }) - at({})).toBeCloseTo(outcome.assist, 9);
    expect(at({ ownGoals: 1 }) - at({})).toBeCloseTo(-outcome.ownGoal, 9);
    const keeper = (o: Partial<typeof none>) => scoreOf(0, { ...none, ...o }, gk, RATING_MODEL);
    expect(keeper({ saves: 2 }) - keeper({})).toBeCloseTo(2 * outcome.save, 9);
    // A clean sheet never costs a keeper, and counts only for his time in goal.
    expect(keeper({ cleanSheet: true }) - keeper({})).toBeCloseTo(outcome.cleanSheet, 9);
    expect(scoreOf(0, { ...none, cleanSheet: true }, steps({ gk: full / 2 }), RATING_MODEL)).toBeLessThan(
      scoreOf(0, { ...none, cleanSheet: true }, gk, RATING_MODEL) + outcome.cleanSheet,
    );
  });

  it('puts a brace above the same match without it, and the brace scorer above an equal defender', () => {
    const brace = scoreOf(0.3, { ...none, goals: 2 }, fwd, RATING_MODEL);
    expect(brace).toBeGreaterThan(scoreOf(0.3, none, fwd, RATING_MODEL));
    // Same standing in process value (his position's par plus one spread) for each.
    const { roles } = RATING_MODEL;
    const defender = scoreOf(roles.def.mean + roles.def.sd, none, steps({ def: full }), RATING_MODEL);
    const forward = scoreOf(roles.fwd.mean + roles.fwd.sd, { ...none, goals: 2 }, fwd, RATING_MODEL);
    expect(forward).toBeGreaterThan(defender);
  });

  it('counts a goal in full whoever scores it: no par of goals is taken off a forward', () => {
    expect(outcomeCredit(none, fwd, RATING_MODEL)).toBe(0);
    expect(outcomeCredit({ ...none, goals: 1 }, fwd, RATING_MODEL)).toBeCloseTo(outcome.goal, 9);
    expect(outcomeCredit({ ...none, goals: 1 }, steps({ def: full }), RATING_MODEL)).toBeCloseTo(
      outcome.goal,
      9,
    );
  });

  it("reads an ordinary match (his position's par, nothing decisive) 6.6, and a match of no worth about 6.0", () => {
    const { roles } = RATING_MODEL;
    for (const role of ['def', 'mid', 'fwd'] as const) {
      const whole = steps({ [role]: full });
      expect(scoreOf(roles[role].mean, none, whole, RATING_MODEL)).toBeCloseTo(6.6, 6);
      const nothing = scoreOf(0, none, whole, RATING_MODEL);
      expect(nothing).toBeGreaterThanOrEqual(6 - 1e-3);
      expect(nothing).toBeLessThan(6.1);
    }
  });

  it('a forward at par who scores reads about 7.3; a dominant midfielder still beats a poor one who scores', () => {
    const { roles } = RATING_MODEL;
    // His goal's own process value is about 0.6 (the table of action values in npm run ratings).
    const scorer = scoreOf(roles.fwd.mean + 0.6, { ...none, goals: 1 }, fwd, RATING_MODEL);
    expect(scorer).toBeGreaterThan(7);
    expect(scorer).toBeLessThan(7.3);
    const poor = scoreOf(roles.fwd.mean - roles.fwd.sd, { ...none, goals: 1 }, fwd, RATING_MODEL);
    const dominant = scoreOf(roles.mid.mean + 1.5 * roles.mid.sd, none, steps({ mid: full }), RATING_MODEL);
    expect(dominant).toBeGreaterThan(poor);
  });
});

describe('a possession change', () => {
  it('shares its swing between the two in the duel: what the loser is charged, the winner earns', () => {
    let duels = 0;
    for (const stats of REAL) {
      const actions = valueActions(stats);
      const won = new Map(
        actions
          .filter((a) => ['tackle', 'interception', 'recovery', 'scramble'].includes(a.kind))
          .map((a) => [a.step, a]),
      );
      for (const loss of actions.filter((a) => a.kind === 'loss' && a.value < 0)) {
        const win = won.get(loss.step);
        if (!win) continue;
        expect(win.value + loss.value, `step ${loss.step}`).toBeCloseTo(0, 12);
        duels++;
      }
    }
    expect(duels).toBeGreaterThan(100);
  });

  it('only goes under 6 for a net minus: value below nothing, or an own goal', () => {
    for (const stats of REAL)
      for (const k of rateMatch(stats).knights)
        if (k.score < 5.95)
          expect(k.value < 0 || (stats.knights.find((q) => q.id === k.id)?.ownGoals ?? 0) > 0).toBe(true);
  });
});

describe('the human in My Career', () => {
  // The owner's report: a human who scored and won the ball over and over rated about 6, whatever he did.
  // Before the fix these four rated 5.43, 6.39, 5.64 and 5.62; won balls high up earned nothing, every
  // lost one cost the whole swing, and a forward's goal earned only what it beat his position's par by.
  it('rates a forward who scores and keeps winning the ball well above 6.5', { timeout: 60_000 }, () => {
    for (const seed of [4, 6, 7, 10]) {
      const career = startCareer({ seed, look: DEFAULT_LOOK, position: 'fwd' });
      const ref = careerFixture(career);
      if (!ref) throw new Error('no fixture');
      const runner = new MatchRunner(planFixture(career, ref, 'play').config());
      while (!runner.ended) {
        runner.advanceOne((k) => (k.human ? humanInput('improver', runner.state, k) : null));
        runner.state.events = [];
      }
      const me = runner.state.knights.find((k) => k.human);
      const line = runner.stats.knights.find((k) => k.id === me?.id);
      if (!me || !line) throw new Error('no human');
      expect(line.goals, `seed ${seed}`).toBe(1);
      expect(line.tackles + line.interceptions + line.recoveries, `seed ${seed}`).toBeGreaterThanOrEqual(8);
      expect(ratingOf(rateMatch(runner.stats), me.id), `seed ${seed}`).toBeGreaterThan(6.5);
    }
  });
});

describe('the rating breakdown', () => {
  it('adds up, base and every line, to the rating before the clamp, for every knight', () => {
    for (const stats of REAL) {
      const ratings = rateMatch(stats);
      for (const k of ratings.knights) {
        const b = ratingBreakdown(stats, k.id);
        if (!b) throw new Error(`no breakdown for ${k.id}`);
        expect(b.score).toBeCloseTo(k.score, 9);
        expect(b.rating).toBe(k.rating);
        expect(b.base + b.lines.reduce((sum, l) => sum + l.points, 0)).toBeCloseTo(k.score, 9);
        // The base is a match of no worth for his roles and minutes: everything he did is in a line.
        const line = stats.knights.find((q) => q.id === k.id);
        if (!line) throw new Error('no line');
        const nothing = { goals: 0, assists: 0, ownGoals: 0, saves: 0, cleanSheet: false, possession: 0 };
        expect(b.base).toBeCloseTo(scoreOf(0, nothing, line.roleSteps, RATING_MODEL), 9);
      }
    }
  });

  it('shows parts to one decimal that sum to the rating shown, with any rounding or cap said out loud', () => {
    for (const stats of REAL)
      for (const k of rateMatch(stats).knights) {
        const b = ratingBreakdown(stats, k.id);
        if (!b) throw new Error('no breakdown');
        const parts = breakdownParts(b);
        const sum = parts.reduce((total, p) => total + Number(p.value.replace('−', '-')), 0);
        expect(sum).toBeCloseTo(Math.round(k.rating * 10) / 10, 6);
      }
  });

  it("names a goal's credit under Goals and a clean sheet under its own line", () => {
    const stats = REAL.find((st) => st.knights.some((k) => k.goals > 0));
    const scorer = stats?.knights.find((k) => k.goals > 0);
    if (!stats || !scorer) throw new Error('no scorer');
    const goals = ratingBreakdown(stats, scorer.id)?.lines.find((l) => l.label === 'Goals');
    expect(goals?.count).toBe(`×${scorer.goals}`);
    expect(goals?.points).toBeGreaterThan(RATING_MODEL.outcome.goal * scorer.goals);
    expect(ratingBreakdown(stats, 999)).toBeNull();
  });
});

describe('possession value', () => {
  const full = REGULATION_STEPS;
  const none = { goals: 0, assists: 0, ownGoals: 0, saves: 0, cleanSheet: false, possession: 0 };
  it('rises toward the goal attacked: a ball won high up leads to a shot more often than one won deep', () => {
    const { shot } = RATING_MODEL.possession;
    expect(shot).toHaveLength(6);
    expect(Math.min(shot[0] ?? 0, shot[1] ?? 0)).toBeGreaterThan(
      Math.max(shot[3] ?? 1, shot[4] ?? 1, shot[5] ?? 1),
    );
    expect(RATING_MODEL.possession.weight).toBeGreaterThan(0);
  });

  it("credits the winner with each ball's possession value, and never charges the loser twice", () => {
    const unweighted = { ...RATING_MODEL, possession: { ...RATING_MODEL.possession, weight: 0 } };
    for (const stats of REAL)
      for (const [id, line] of possessionsOf(stats)) {
        const lines = (m: typeof RATING_MODEL) => ratingBreakdown(stats, id, m)?.lines ?? [];
        const points = (m: typeof RATING_MODEL, label: string) =>
          lines(m).find((l) => l.label === label)?.points ?? 0;
        expect(points(RATING_MODEL, 'Won the ball') - points(unweighted, 'Won the ball')).toBeCloseTo(
          RATING_MODEL.possession.weight * line.won,
          9,
        );
        expect(points(RATING_MODEL, 'Lost the ball')).toBeCloseTo(points(unweighted, 'Lost the ball'), 9);
      }
  });

  it('lifts a knight for every ball he wins, more the higher up he wins it', () => {
    const at = (possession: number) =>
      scoreOf(0.5, { ...none, possession }, steps({ mid: full }), RATING_MODEL);
    const { shot } = RATING_MODEL.possession;
    expect(at(8 * (shot[1] ?? 0))).toBeGreaterThan(at(8 * (shot[4] ?? 0)));
    expect(at(8 * (shot[4] ?? 0))).toBeGreaterThan(at(0));
  });
});

describe('man of the match', () => {
  const m = RATING_MODEL.motmMargin;
  const goals = () => 0;
  const k = (id: number, team: TeamId, score: number) => ({ id, team, score });

  it("goes to the winners' best unless a loser out-rates him by the margin or more", () => {
    expect(manOfTheMatch([k(1, 0, 8), k(2, 1, 8 + m - 0.01)], [2, 1], goals, m)).toBe(1);
    expect(manOfTheMatch([k(1, 0, 8), k(2, 1, 8 + m)], [2, 1], goals, m)).toBe(2);
    expect(manOfTheMatch([k(1, 0, 8), k(2, 1, 9.5)], [0, 1], goals, m)).toBe(2);
    expect(manOfTheMatch([k(1, 0, 8.3), k(3, 0, 7), k(2, 1, 7.9)], [0, 1], goals, m)).toBe(2);
  });

  it('goes to the best overall in a draw, by goals then the lower id when level', () => {
    expect(manOfTheMatch([k(1, 0, 7), k(2, 1, 7.3)], [1, 1], goals, m)).toBe(2);
    expect(manOfTheMatch([k(4, 0, 7), k(2, 1, 7)], [1, 1], goals, m)).toBe(2);
    expect(manOfTheMatch([k(4, 0, 7), k(2, 1, 7)], [1, 1], (id) => (id === 4 ? 1 : 0), m)).toBe(4);
    expect(manOfTheMatch([], [0, 0], goals, m)).toBeNull();
  });
});

describe('position fairness (the harness checks this on 800 matches)', () => {
  it('gives each position a similar centre and spread', { timeout: 60_000 }, () => {
    const byRole = new Map<Role, number[]>();
    for (let i = 0; i < 30; i++) {
      const tier = i % 5;
      const stats = played(fixture(700 + i, [tier, Math.min(4, tier + (i % 2))])).stats;
      for (const k of rateMatch(stats).knights) {
        byRole.set(k.role, [...(byRole.get(k.role) ?? []), k.rating]);
      }
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
  1: '2-0 | 0gk:7.26 1def:8.55 2mid:7.28 3fwd:6.38 4gk:7.78 5def:6.32 6mid:6.46 7fwd:6.66 | motm 1',
  3: '3-4 | 0gk:6.78 1def:7.92 2mid:5.80 3fwd:8.30 4gk:7.33 5def:7.12 6mid:8.13 7fwd:8.51 | motm 7',
  5: '3-2 | 0gk:7.37 1def:6.25 2mid:8.66 3fwd:7.48 4gk:8.26 5def:6.44 6mid:7.12 7fwd:7.32 | motm 2',
  7: '1-3 | 0gk:5.70 1def:6.04 2mid:7.30 3fwd:7.45 4gk:6.48 5def:7.06 6mid:7.17 7fwd:7.83 | motm 7',
  9: '0-3 | 0gk:5.89 1def:6.14 2mid:6.46 3fwd:6.54 4gk:7.07 5def:6.51 6mid:8.70 7fwd:7.41 | motm 6',
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
