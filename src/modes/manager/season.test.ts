import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK } from '../../knight/look';
import { knightById } from '../../game/match';
import { MatchRunner } from '../runner';
import { DRAFT_HOUSES, isDraftComplete, squadOf } from './draft';
import {
  champion,
  fixtures,
  isFinished,
  MATCHDAYS,
  playerFixture,
  table,
  type LeagueFixture,
} from './league';
import {
  autoDraft,
  knightStamina,
  normalizeSeason,
  otherFixtures,
  planMatch,
  playerLineup,
  runnerSquadIds,
  setPlan,
  startSeason,
  topScorers,
  type FixtureGoal,
  type SeasonState,
} from './season';
import { CHARGE, PLAY_COST, STAMINA_MAX } from './stamina';
import { STARTERS } from './types';

const PLAYER = 'ember';

function drafted(seed = 5): SeasonState {
  let season = startSeason(seed, PLAYER, { ...DEFAULT_LOOK, name: 'Sir Rookie' });
  while (!season.league) season = autoDraft(season);
  return season;
}

const roundTrip = (season: SeasonState): SeasonState | null =>
  normalizeSeason(JSON.parse(JSON.stringify(season)) as unknown);

/** Plays a fixture headless; `dugout` may act on the runner part-way through, as the player would. */
function playFixture(season: SeasonState, fixture: LeagueFixture, dugout?: (r: MatchRunner) => void) {
  const plan = planMatch(season, fixture);
  const runner = new MatchRunner(plan.config());
  runner.advance(6000);
  dugout?.(runner);
  runner.advance(Infinity);
  const [a, b] = runner.state.score;
  const outcome = {
    score: [a, b] as const,
    steps: runner.step,
    timeline: runner.timeline,
    goals: runner.goals,
  };
  return { season: plan.finish(season, outcome), runner, plan };
}

type Played = ReturnType<typeof playFixture>;

const play = (season: SeasonState, fixture: LeagueFixture, dugout?: (r: MatchRunner) => void): SeasonState =>
  playFixture(season, fixture, dugout).season;

const recordOf = (season: SeasonState, fixture: LeagueFixture) =>
  season.records[fixture.matchday]?.[fixture.index] ?? null;

/** Every fixture of a matchday, the player's first; `dugout` acts in the player's match only. */
function matchdayRuns(season: SeasonState, dugout?: (r: MatchRunner, s: SeasonState) => void): Played[] {
  const mine = playerFixture(season.league ?? (null as never));
  if (!mine) throw new Error('No fixture');
  const act =
    dugout &&
    ((r: MatchRunner): void => {
      dugout(r, season);
    });
  const runs = [playFixture(season, mine, act)];
  for (const fixture of otherFixtures(runs[0]?.season ?? season))
    runs.push(playFixture(runs.at(-1)?.season ?? season, fixture));
  return runs;
}

const playMatchday = (season: SeasonState): SeasonState => matchdayRuns(season).at(-1)?.season ?? season;

const squadName = (season: SeasonState, id: string | null): string | null =>
  id === null
    ? null
    : (DRAFT_HOUSES.flatMap((h) => squadOf(season.draft, h)).find((k) => k.id === id)?.look.name ?? '?');

/** The saved scorers must name the knights the runner credited. Names are unique across the pool, so
 * the runner knight's name pins down the squad knight without trusting the id mapping under test. */
function expectScorersAsRun({ season, runner, plan }: Played): void {
  const playerAway = plan.fixture.away === season.draft.playerHouse;
  const credited = runner.goals.map((g) => ({
    side: playerAway ? 1 - g.team : g.team,
    scorer: g.scorerId === null ? null : (knightById(runner.state, g.scorerId)?.look.name ?? '?'),
    ownGoal: g.ownGoal,
  }));
  const saved = (recordOf(season, plan.fixture)?.goals ?? []).map((g) => ({
    ...g,
    scorer: squadName(season, g.scorer),
  }));
  expect(saved).toEqual(credited);
}

/** Goals by knights who came off the bench (runner ids past the eight starters). */
const subGoals = (runs: readonly Played[]): number =>
  runs.flatMap((r) => r.runner.goals).filter((g) => (g.scorerId ?? 0) >= STARTERS * 2).length;

describe('a season', () => {
  it('starts the league once the draft is done, with everyone fresh and a full team sheet', () => {
    const season = drafted();
    expect(isDraftComplete(season.draft)).toBe(true);
    expect(season.plan?.starters).toHaveLength(4);
    expect(playerLineup(season).bench).toHaveLength(2);
    for (const k of squadOf(season.draft, 'salt'))
      expect(knightStamina(season, 'salt', k.id)).toBe(STAMINA_MAX);
  });

  it('plays all fourteen matchdays to a champion, surviving a save and reload every matchday', () => {
    let season = drafted();
    for (let day = 0; day < MATCHDAYS; day++) {
      const runs = matchdayRuns(season);
      for (const run of runs) expectScorersAsRun(run);
      season = runs.at(-1)?.season ?? season;
      expect(roundTrip(season)).toEqual(season);
    }
    const league = season.league;
    if (!league) throw new Error('No league');
    expect(isFinished(league)).toBe(true);
    expect(champion(league)).toBe(table(league)[0]?.house);
    expect(table(league).every((row) => row.played === MATCHDAYS)).toBe(true);
  }, 60_000);

  it('charges the players who played and rests the bench', () => {
    const season = drafted();
    const sheet = playerLineup(season);
    const fixture = playerFixture(season.league ?? (null as never));
    if (!fixture) throw new Error('No fixture');
    const after = play(season, fixture);
    for (const s of sheet.starters)
      expect(knightStamina(after, PLAYER, s.knight.id)).toBe(STAMINA_MAX - PLAY_COST);
    for (const k of sheet.bench) expect(knightStamina(after, PLAYER, k.id)).toBe(STAMINA_MAX);
  });

  it("charges the dugout's substitution by the minutes each knight played", () => {
    const season = drafted();
    const sheet = playerLineup(season);
    const fixture = playerFixture(season.league ?? (null as never));
    const sub = sheet.bench[0];
    const off = sheet.starters[3];
    if (!fixture || !sub || !off) throw new Error('No fixture');
    const plan = planMatch(season, fixture);
    const after = play(season, fixture, (runner) => {
      runner.act(0, { kind: 'substitution', offId: 3, on: plan.sides[0].bench[0] ?? (null as never) });
      runner.act(0, { kind: 'tactics', tactics: CHARGE });
    });
    const offStamina = knightStamina(after, PLAYER, off.knight.id);
    const onStamina = knightStamina(after, PLAYER, sub.id);
    expect(offStamina).toBeGreaterThan(STAMINA_MAX - PLAY_COST);
    expect(onStamina).toBeLessThan(STAMINA_MAX);
    expect(STAMINA_MAX - offStamina + (STAMINA_MAX - onStamina)).toBeCloseTo(PLAY_COST, 6);
  });

  it('plays the same match from the same plan, watched in pieces or all at once', () => {
    const season = drafted();
    const fixture = playerFixture(season.league ?? (null as never));
    if (!fixture) throw new Error('No fixture');
    const plan = planMatch(season, fixture);
    const whole = new MatchRunner(plan.config());
    whole.advance(Infinity);
    const pieces = new MatchRunner(plan.config());
    while (!pieces.ended) pieces.advance(37);
    expect(pieces.state.score).toEqual(whole.state.score);
    expect(pieces.step).toBe(whole.step);
  });

  it('refuses a team sheet that is not four different knights from the squad', () => {
    const season = drafted();
    const [a, b, c] = season.plan?.starters ?? [];
    if (!a || !b || !c) throw new Error('No plan');
    const tactics = CHARGE;
    expect(() => setPlan(season, { starters: [a, b, c], tactics })).toThrow();
    expect(() => setPlan(season, { starters: [a, b, c, c], tactics })).toThrow();
    expect(() => setPlan(season, { starters: [a, b, c, 'gen:999'], tactics })).toThrow();
  });

  it('rejects saves that do not fit together', () => {
    const season = drafted();
    const raw = JSON.parse(JSON.stringify(season)) as Record<string, unknown>;
    expect(normalizeSeason({ ...raw, stamina: {} })).toBeNull();
    expect(normalizeSeason({ ...raw, plan: { starters: ['nobody'], tactics: CHARGE } })).toBeNull();
    expect(normalizeSeason({ ...raw, plan: { ...season.plan, tactics: { press: 'max' } } })).toBeNull();
    expect(normalizeSeason({ ...raw, league: { ...(raw.league as object), seed: 1 } })).toBeNull();
    expect(normalizeSeason(null)).toBeNull();
  });

  it('saves a draft in progress', () => {
    const season = startSeason(9, PLAYER, DEFAULT_LOOK);
    expect(season.league).toBeNull();
    expect(roundTrip(season)).toEqual(season);
  });
});

describe('league scorers', () => {
  /** The player's dugout sends the best bench knight on up front, a third of the way in. */
  const subForward = (runner: MatchRunner, season: SeasonState): void => {
    const fixture = playerFixture(season.league ?? (null as never));
    const on = fixture && planMatch(season, fixture).sides[0].bench[0];
    if (on) runner.act(0, { kind: 'substitution', offId: STARTERS - 1, on });
  };

  /** Seeds known to give a scoring substitute come first; the rest keep the test working if the draft
   * pool changes. Each run's scorers are checked whether or not a substitute scored. */
  const SEEDS = [5, 15, 27, ...Array.from({ length: 30 }, (_, i) => i + 1)];

  it("credits the player's substitute with the goals he scores", () => {
    const scored = SEEDS.slice(0, 12).some((seed) => {
      const [mine] = matchdayRuns(drafted(seed), subForward);
      if (!mine) throw new Error('No fixture');
      expectScorersAsRun(mine);
      return subGoals([mine]) > 0;
    });
    expect(scored).toBe(true);
  }, 30_000);

  it("credits a rival manager's substitute, numbered after the other side's", () => {
    // Rivals rotate tired knights out before kick-off, so a whole squad a little below fresh brings subs on.
    const scored = SEEDS.some((seed) => {
      const season = drafted(seed);
      return fixtures(season.league ?? (null as never), 0).some((fixture) => {
        if (fixture.home === PLAYER || fixture.away === PLAYER) return false;
        const stamina = { ...season.stamina };
        for (const house of [fixture.home, fixture.away])
          stamina[house] = Object.fromEntries(squadOf(season.draft, house).map((k) => [k.id, 70]));
        const run = playFixture({ ...season, stamina }, fixture);
        expectScorersAsRun(run);
        return run.runner.state.substituted.length === 2 && subGoals([run]) > 0;
      });
    });
    expect(scored).toBe(true);
  }, 60_000);

  it("logs as many goals for each side as the score, on the player's match and every rival fixture", () => {
    const season = matchdayRuns(drafted(), subForward).at(-1)?.season;
    if (!season?.league) throw new Error('No league');
    for (const fixture of fixtures(season.league, 0)) {
      const goals = recordOf(season, fixture)?.goals ?? [];
      expect(goals.filter((g) => g.side === 0)).toHaveLength(fixture.score?.[0] ?? -1);
      expect(goals.filter((g) => g.side === 1)).toHaveLength(fixture.score?.[1] ?? -1);
    }
  });

  it('numbers substitutes in the order they came on, the left side first within a step', () => {
    const season = drafted();
    const fixture = playerFixture(season.league ?? (null as never));
    if (!fixture) throw new Error('No fixture');
    const [left, right] = planMatch(season, fixture).sides;
    const starter = (lineup: typeof left.lineup, i: number): string => lineup.starters[i]?.knight.id ?? '';
    const bench = (lineup: typeof left.lineup): string => lineup.bench[0]?.id ?? '';
    const subL = { offId: starter(left.lineup, 3), onId: bench(left.lineup), step: 500 };
    const subR = { offId: starter(right.lineup, 0), onId: bench(right.lineup), step: 500 };
    const lineups = [left.lineup, right.lineup] as const;
    const same = runnerSquadIds(lineups, [subL, subR]);
    expect([same.get(0), same.get(4), same.get(8), same.get(9)]).toEqual([
      starter(left.lineup, 0),
      starter(right.lineup, 0),
      subL.onId,
      subR.onId,
    ]);
    const rightFirst = runnerSquadIds(lineups, [subL, { ...subR, step: 499 }]);
    expect([rightFirst.get(8), rightFirst.get(9)]).toEqual([subR.onId, subL.onId]);
    expect(runnerSquadIds(lineups, [null, null]).size).toBe(8);
  });

  /** The first matchday played, and a fixture of it where the home side scored. */
  function scoredFixture() {
    const season = playMatchday(drafted());
    const fixture = fixtures(season.league ?? (null as never), 0).find((f) => (f.score?.[0] ?? 0) > 0);
    if (!fixture?.score) throw new Error('No home goals on matchday 1');
    return { season, fixture, score: fixture.score };
  }

  /** The season's records with one fixture's record replaced, as a save might hold them. */
  const replaceRecord = <R>(season: SeasonState, fixture: LeagueFixture, record: R) =>
    season.records.map((day, d) =>
      d === fixture.matchday ? day.map((r, i) => (i === fixture.index ? record : r)) : day,
    );

  it('counts goals per knight, most first, and never an own goal or a goal nobody touched', () => {
    const { season, fixture } = scoredFixture();
    const [h0, h1] = squadOf(season.draft, fixture.home);
    const [a0] = squadOf(season.draft, fixture.away);
    if (!h0 || !h1 || !a0) throw new Error('No squads');
    const goals: FixtureGoal[] = [
      { side: 0, scorer: h1.id, ownGoal: false },
      { side: 1, scorer: h0.id, ownGoal: true },
      { side: 1, scorer: a0.id, ownGoal: false },
      { side: 1, scorer: a0.id, ownGoal: false },
      { side: 0, scorer: null, ownGoal: false },
    ];
    const only = {
      ...season,
      records: replaceRecord({ ...season, records: season.records.map((d) => d.map(() => null)) }, fixture, {
        goals,
      }),
    };
    expect(topScorers(only).map((r) => [r.knight.id, r.house, r.goals])).toEqual([
      [a0.id, fixture.away, 2],
      [h1.id, fixture.home, 1],
    ]);
  });

  it('sorts a whole season by goals, then name, and adds up to every goal a knight scored', () => {
    let season = drafted();
    for (let day = 0; day < 4; day++) season = playMatchday(season);
    const rows = topScorers(season);
    const credited = season.records
      .flat()
      .flatMap((r) => r?.goals ?? [])
      .filter((g) => g.scorer !== null && !g.ownGoal);
    expect(rows.reduce((n, r) => n + r.goals, 0)).toBe(credited.length);
    for (const [i, row] of rows.entries()) {
      const next = rows[i + 1];
      if (!next) continue;
      expect(
        row.goals > next.goals || (row.goals === next.goals && row.knight.look.name <= next.knight.look.name),
      ).toBe(true);
    }
  });

  it('saves the scorers and reads them back', () => {
    const season = playMatchday(drafted());
    expect(season.records.flat().filter(Boolean)).toHaveLength(4);
    expect(roundTrip(season)).toEqual(season);
  });

  it('rejects scorer records that cannot have happened', () => {
    const { season, fixture, score } = scoredFixture();
    const raw = JSON.parse(JSON.stringify(season)) as Record<string, unknown>;
    const withGoals = (goals: unknown): unknown => ({
      ...raw,
      records: replaceRecord(season, fixture, { goals }),
    });
    const [home] = squadOf(season.draft, fixture.home);
    const [away] = squadOf(season.draft, fixture.away);
    const outsider = DRAFT_HOUSES.filter((h) => h !== fixture.home && h !== fixture.away)
      .map((h) => squadOf(season.draft, h)[0])
      .at(0);
    if (!home || !away || !outsider) throw new Error('No squads');
    const goal = (side: 0 | 1, scorer: string | null, ownGoal = false) => ({ side, scorer, ownGoal });

    // Each case below is one goal for the home side, which did score: only the scorer is wrong.
    expect(normalizeSeason(withGoals([goal(0, home.id)]))).not.toBeNull();
    expect(normalizeSeason(withGoals([goal(0, away.id, true)]))).not.toBeNull();
    expect(normalizeSeason(withGoals([goal(0, outsider.id)]))).toBeNull();
    expect(normalizeSeason(withGoals([goal(0, away.id)]))).toBeNull();
    expect(normalizeSeason(withGoals([goal(0, home.id, true)]))).toBeNull();
    expect(
      normalizeSeason(withGoals(Array.from({ length: score[0] + 1 }, () => goal(0, home.id)))),
    ).toBeNull();
    expect(normalizeSeason(withGoals([{ side: 2, scorer: null, ownGoal: false }]))).toBeNull();
    expect(normalizeSeason(withGoals([{ side: 0, scorer: 7, ownGoal: false }]))).toBeNull();
    expect(normalizeSeason(withGoals([{ side: 0, scorer: null }]))).toBeNull();
    expect(normalizeSeason(withGoals(null))).toBeNull();
    expect(normalizeSeason({ ...raw, records: undefined })).toBeNull();
    // A played fixture needs a record, and an unplayed one has none yet.
    expect(
      normalizeSeason({
        ...raw,
        records: replaceRecord(season, fixture, null),
      }),
    ).toBeNull();
    const unplayed = season.records.map((day, d) => (d === 1 ? day.map(() => ({ goals: [] })) : day));
    expect(normalizeSeason({ ...raw, records: unplayed })).toBeNull();
  });
});
