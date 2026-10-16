import { describe, expect, it } from 'vitest';
import {
  champion,
  createLeague,
  currentMatchday,
  fixtureSeed,
  fixtures,
  FIXTURES_PER_MATCHDAY,
  isFinished,
  MATCHDAYS,
  normalizeLeague,
  pendingSimulations,
  playerFixture,
  recordPlayerResult,
  recordResult,
  table,
  type LeagueFixture,
  type LeagueState,
  type Score,
} from './league';

const HOUSES = ['ember', 'corvane', 'thorn', 'grey', 'mud', 'hollow', 'ox', 'salt'];
const entry = { seed: 11, playerHouse: 'thorn' } as const;
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919);

const allFixtures = (league: LeagueState): LeagueFixture[] =>
  Array.from({ length: MATCHDAYS }, (_, day) => fixtures(league, day)).flat();

/** Venues of one house across the season, e.g. "HAHH…". */
const venues = (league: LeagueState, house: string): string =>
  Array.from({ length: MATCHDAYS }, (_, day) =>
    fixtures(league, day).find((f) => f.home === house) ? 'H' : 'A',
  ).join('');

function playerMatch(league: LeagueState): LeagueFixture {
  const fixture = playerFixture(league);
  if (!fixture) throw new Error('The player has no match to play');
  return fixture;
}

/** Plays the current matchday: the player's match as [us, them], every other match 1–1. */
function playMatchday(league: LeagueState, mine: Score = [2, 0]): LeagueState {
  const played = recordPlayerResult(league, playerMatch(league), mine);
  return pendingSimulations(played).reduce((l, f) => recordResult(l, f.matchday, f.index, [1, 1]), played);
}

/** A league in fixed draw order (HOUSES), so tests can lean on the draw-order fallback. */
const fixedLeague = (): LeagueState => ({ ...createLeague(entry, HOUSES), houses: HOUSES });

/** Writes hand-picked results straight into the season, ignoring play order (the table doesn't care). */
function withResults(league: LeagueState, games: readonly (readonly [string, string, number, number])[]) {
  const results = league.results.map((day) => [...day]);
  for (const [home, away, homeGoals, awayGoals] of games) {
    const fixture = allFixtures(league).find((f) => f.home === home && f.away === away);
    if (!fixture) throw new Error(`No fixture ${home} v ${away}`);
    const day = results[fixture.matchday];
    if (!day) throw new Error('No such matchday');
    day[fixture.index] = [homeGoals, awayGoals];
  }
  return { ...league, results };
}

const order = (league: LeagueState): string[] => table(league).map((r) => r.house);
const rowOf = (league: LeagueState, house: string) => table(league).find((r) => r.house === house);

describe('the schedule', () => {
  it.each(SEEDS)(
    'has 14 matchdays of 4 fixtures with every house playing once a matchday (seed %i)',
    (seed) => {
      const league = createLeague({ ...entry, seed }, HOUSES);
      for (let day = 0; day < MATCHDAYS; day++) {
        const today = fixtures(league, day);
        expect(today).toHaveLength(FIXTURES_PER_MATCHDAY);
        expect(today.flatMap((f) => [f.home, f.away]).sort()).toEqual([...HOUSES].sort());
      }
    },
  );

  it.each(SEEDS)('pairs every house with every other once at home and once away (seed %i)', (seed) => {
    const league = createLeague({ ...entry, seed }, HOUSES);
    const pairs = allFixtures(league).map((f) => `${f.home}>${f.away}`);
    const expected = HOUSES.flatMap((home) =>
      HOUSES.filter((a) => a !== home).map((away) => `${home}>${away}`),
    );
    expect(pairs.sort()).toEqual(expected.sort());
  });

  it.each(SEEDS)('gives every house 7 home matches, never 3 at home or away in a row (seed %i)', (seed) => {
    const league = createLeague({ ...entry, seed }, HOUSES);
    for (const house of HOUSES) {
      const sequence = venues(league, house);
      expect(sequence.replace(/A/g, '')).toHaveLength(7);
      expect(sequence).not.toMatch(/HHH|AAA/);
    }
  });

  it('mirrors matchdays 1–7 in 8–14 with home and away swapped', () => {
    const league = createLeague(entry, HOUSES);
    for (let day = 0; day < 7; day++) {
      const mirrored = fixtures(league, day + 7).map((f) => [f.away, f.home]);
      expect(mirrored).toEqual(fixtures(league, day).map((f) => [f.home, f.away]));
    }
  });

  it('draws the same schedule for the same seed and a different one for another', () => {
    expect(createLeague(entry, HOUSES)).toEqual(createLeague(entry, HOUSES));
    const draws = new Set(SEEDS.map((seed) => createLeague({ ...entry, seed }, HOUSES).houses.join()));
    expect(draws.size).toBeGreaterThan(SEEDS.length / 2);
  });

  it('refuses a field without the player, with a house twice or of the wrong size', () => {
    expect(() => createLeague({ ...entry, playerHouse: 'nowhere' }, HOUSES)).toThrow();
    expect(() => createLeague(entry, [...HOUSES.slice(0, 7), 'thorn'])).toThrow();
    expect(() => createLeague(entry, HOUSES.slice(0, 6))).toThrow();
  });
});

describe('fixtureSeed', () => {
  it('gives every fixture of a season its own seed, the same every time', () => {
    const seeds = allFixtures(createLeague(entry, HOUSES)).map((f) => fixtureSeed(11, f.matchday, f.index));
    expect(new Set(seeds).size).toBe(MATCHDAYS * FIXTURES_PER_MATCHDAY);
    expect(fixtureSeed(11, 5, 2)).toBe(fixtureSeed(11, 5, 2));
    expect(fixtureSeed(11, 5, 2)).not.toBe(fixtureSeed(12, 5, 2));
  });
});

describe('playing the season', () => {
  it('starts on matchday 1 with the player’s match and nothing else to simulate yet', () => {
    const league = createLeague(entry, HOUSES);
    expect(currentMatchday(league)).toBe(0);
    const mine = playerMatch(league);
    expect([mine.home, mine.away]).toContain('thorn');
    expect(mine.score).toBeNull();
    expect(pendingSimulations(league)).toEqual([]);
  });

  it('plays out the other three fixtures once the player has played, then moves to the next matchday', () => {
    const league = createLeague(entry, HOUSES);
    const played = recordPlayerResult(league, playerMatch(league), [1, 0]);
    const others = pendingSimulations(played);
    expect(others).toHaveLength(3);
    expect(others.every((f) => f.home !== 'thorn' && f.away !== 'thorn')).toBe(true);
    expect(currentMatchday(played)).toBe(0);
    expect(currentMatchday(playMatchday(league))).toBe(1);
  });

  it('records the player’s score the right way round whether they are home or away', () => {
    let league = createLeague(entry, HOUSES);
    for (let day = 0; day < MATCHDAYS; day++) {
      const mine = playerMatch(league);
      league = playMatchday(league, [3, 1]);
      const score = fixtures(league, day)[mine.index]?.score;
      expect(score).toEqual(mine.home === 'thorn' ? [3, 1] : [1, 3]);
    }
  });

  it('accepts a draw', () => {
    const league = createLeague(entry, HOUSES);
    const drawn = recordPlayerResult(league, playerMatch(league), [2, 2]);
    expect(playerFixture(drawn, 0)?.score).toEqual([2, 2]);
  });

  it('refuses a fixture played twice, out of order, or with impossible goals', () => {
    const league = createLeague(entry, HOUSES);
    const mine = playerMatch(league);
    const played = recordPlayerResult(league, mine, [1, 0]);
    expect(() => recordPlayerResult(played, mine, [1, 0])).toThrow();
    expect(() => recordResult(league, 1, 0, [1, 0])).toThrow();
    expect(() => recordResult(league, MATCHDAYS, 0, [1, 0])).toThrow();
    expect(() => recordResult(league, 0, FIXTURES_PER_MATCHDAY, [1, 0])).toThrow();
    expect(() => recordResult(league, 0, 0, [-1, 0])).toThrow();
    expect(() => recordResult(league, 0, 0, [1.5, 0])).toThrow();
  });

  it('finishes after 14 matchdays and crowns the top of the table', () => {
    let league = createLeague(entry, HOUSES);
    for (let day = 0; day < MATCHDAYS; day++) {
      expect(isFinished(league)).toBe(false);
      expect(champion(league)).toBeNull();
      league = playMatchday(league);
    }
    expect(currentMatchday(league)).toBe(MATCHDAYS);
    expect(isFinished(league)).toBe(true);
    expect(playerFixture(league)).toBeNull();
    expect(pendingSimulations(league)).toEqual([]);
    // The player won all 14 and everyone else drew the rest.
    expect(champion(league)).toBe('thorn');
    expect(rowOf(league, 'thorn')).toMatchObject({ played: 14, won: 14, points: 42, goalsFor: 28 });
    expect(table(league).every((r) => r.played === 14)).toBe(true);
  });
});

describe('the table', () => {
  it('counts 3 points a win, 1 a draw and none a loss, with goals and form', () => {
    const league = withResults(fixedLeague(), [
      ['ember', 'corvane', 3, 1],
      ['corvane', 'thorn', 2, 2],
      ['thorn', 'ember', 0, 1],
    ]);
    expect(rowOf(league, 'ember')).toEqual({
      house: 'ember',
      played: 2,
      won: 2,
      drawn: 0,
      lost: 0,
      goalsFor: 4,
      goalsAgainst: 1,
      goalDifference: 3,
      points: 6,
      form: ['W', 'W'],
    });
    expect(rowOf(league, 'corvane')).toMatchObject({
      played: 2,
      drawn: 1,
      lost: 1,
      points: 1,
      goalDifference: -2,
    });
    expect(rowOf(league, 'thorn')).toMatchObject({ played: 2, drawn: 1, lost: 1, points: 1, goalsFor: 2 });
  });

  it('keeps the last five results in the form guide, newest last', () => {
    let league = createLeague(entry, HOUSES);
    const mine: Score[] = [
      [0, 1],
      [2, 2],
      [1, 0],
      [1, 0],
      [0, 3],
      [1, 1],
    ];
    for (const score of mine) league = playMatchday(league, score);
    expect(rowOf(league, 'thorn')?.form).toEqual(['D', 'W', 'W', 'L', 'D']);
    expect(rowOf(league, 'thorn')?.played).toBe(6);
  });

  it('lists every house in draw order before a ball is kicked', () => {
    expect(order(fixedLeague())).toEqual(HOUSES);
  });

  it('ranks on points before goal difference', () => {
    // thorn: 6 pts, GD +2. corvane: 4 pts, GD +5.
    const league = withResults(fixedLeague(), [
      ['thorn', 'mud', 1, 0],
      ['thorn', 'hollow', 1, 0],
      ['corvane', 'ox', 5, 0],
      ['corvane', 'salt', 0, 0],
    ]);
    expect(order(league).slice(0, 2)).toEqual(['thorn', 'corvane']);
  });

  it('ranks level points on goal difference before goals for', () => {
    // thorn: 3 pts, GD +1, 2 scored. corvane: 3 pts, GD 0, 5 scored.
    const league = withResults(fixedLeague(), [
      ['thorn', 'mud', 2, 0],
      ['thorn', 'hollow', 0, 1],
      ['corvane', 'ox', 5, 0],
      ['corvane', 'salt', 0, 5],
    ]);
    expect(order(league).indexOf('thorn')).toBeLessThan(order(league).indexOf('corvane'));
  });

  it('ranks level points and goal difference on goals for, even against head-to-head', () => {
    // Both on 3 pts and GD +1; thorn scored 3, corvane 1 but won their meeting.
    const league = withResults(fixedLeague(), [
      ['corvane', 'thorn', 1, 0],
      ['thorn', 'mud', 3, 1],
    ]);
    expect(rowOf(league, 'thorn')).toMatchObject({ points: 3, goalDifference: 1, goalsFor: 3 });
    expect(rowOf(league, 'corvane')).toMatchObject({ points: 3, goalDifference: 1, goalsFor: 1 });
    expect(order(league).slice(0, 2)).toEqual(['thorn', 'corvane']);
  });

  it('ranks houses level on points, goal difference and goals on head-to-head', () => {
    // Both on 3 pts, GD 0, 1 scored; thorn won their meeting.
    const league = withResults(fixedLeague(), [
      ['thorn', 'corvane', 1, 0],
      ['thorn', 'mud', 0, 1],
      ['corvane', 'hollow', 1, 0],
    ]);
    expect(rowOf(league, 'thorn')).toMatchObject({ points: 3, goalDifference: 0, goalsFor: 1 });
    expect(rowOf(league, 'corvane')).toMatchObject({ points: 3, goalDifference: 0, goalsFor: 1 });
    expect(order(league).indexOf('thorn')).toBeLessThan(order(league).indexOf('corvane'));
  });

  it('settles a three-way tie on a mini-table of the matches between those three', () => {
    // All on 7 pts, GD +2, 4 scored. Between them: thorn 6 pts, corvane 3, ember 0.
    const league = withResults(fixedLeague(), [
      ['thorn', 'corvane', 1, 0],
      ['thorn', 'ember', 1, 0],
      ['corvane', 'ember', 1, 0],
      ['thorn', 'grey', 2, 2],
      ['corvane', 'mud', 3, 1],
      ['corvane', 'hollow', 0, 0],
      ['ember', 'ox', 2, 0],
      ['ember', 'salt', 2, 0],
      ['ember', 'grey', 0, 0],
    ]);
    for (const house of ['thorn', 'corvane', 'ember'])
      expect(rowOf(league, house)).toMatchObject({ points: 7, goalDifference: 2, goalsFor: 4 });
    expect(order(league).slice(0, 3)).toEqual(['thorn', 'corvane', 'ember']);
  });

  it('falls back to draw order when the mini-table is level too', () => {
    // Each beat one of the others 1–0: 3 pts apiece in the mini-table, so no pair decides it alone.
    const league = withResults(fixedLeague(), [
      ['thorn', 'corvane', 1, 0],
      ['corvane', 'ember', 1, 0],
      ['ember', 'thorn', 1, 0],
    ]);
    expect(order(league).slice(0, 3)).toEqual(['ember', 'corvane', 'thorn']);
  });
});

describe('normalizeLeague', () => {
  let midSeason = createLeague(entry, HOUSES);
  for (let day = 0; day < 5; day++) midSeason = playMatchday(midSeason, [day, 1]);
  // Half-way through matchday 6: the player has played, the others have not.
  midSeason = recordPlayerResult(midSeason, playerMatch(midSeason), [0, 0]);
  const saved = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(midSeason)) as Record<string, unknown>;
  const savedResults = (): unknown[][] => saved().results as unknown[][];

  it('reads back a saved season exactly, mid-matchday or finished', () => {
    expect(normalizeLeague(saved(), HOUSES)).toEqual(midSeason);
    let finished = pendingSimulations(midSeason).reduce(
      (l, f) => recordResult(l, f.matchday, f.index, [0, 2]),
      midSeason,
    );
    while (!isFinished(finished)) finished = playMatchday(finished);
    expect(normalizeLeague(JSON.parse(JSON.stringify(finished)), HOUSES)).toEqual(finished);
  });

  const withScore = (day: number, index: number, score: unknown) => {
    const results = savedResults();
    const matchday = results[day];
    if (matchday) matchday[index] = score;
    return { ...saved(), results };
  };

  it.each([
    ['nothing', null],
    ['text', 'league'],
    ['a cup save', { round: 2, draw: HOUSES, results: [] }],
    ['a negative seed', { ...saved(), seed: -1 }],
    ['a fractional seed', { ...saved(), seed: 1.5 }],
    ['a house twice', { ...saved(), houses: [...HOUSES.slice(0, 7), 'ember'] }],
    ['an unknown house', { ...saved(), houses: [...HOUSES.slice(0, 7), 'atlantis'] }],
    ['an extra house', { ...saved(), houses: [...HOUSES, 'atlantis'] }],
    ['seven houses', { ...saved(), houses: HOUSES.slice(0, 7) }],
    ['the player missing', { ...saved(), playerHouse: 'atlantis' }],
    ['a missing matchday', { ...saved(), results: savedResults().slice(0, MATCHDAYS - 1) }],
    ['a matchday short of a fixture', { ...saved(), results: savedResults().map((day) => day.slice(1)) }],
    ['a broken score', withScore(0, 0, [1, 'two'])],
    ['a score of three numbers', withScore(0, 0, [1, 0, 2])],
    ['negative goals', withScore(0, 0, [-1, 0])],
    ['fractional goals', withScore(0, 0, [1.5, 0])],
    ['a later matchday played before an earlier one is done', withScore(6, 0, [1, 0])],
  ])('drops %s instead of crashing', (_, raw) => {
    expect(normalizeLeague(raw, HOUSES)).toBeNull();
  });
});
