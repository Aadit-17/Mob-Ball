import { createRng } from '../../game/rng';

export const LEAGUE_SIZE = 8;
/** Each house meets the other seven once in each half of the season. */
const HALF = LEAGUE_SIZE - 1;
export const MATCHDAYS = HALF * 2;
export const FIXTURES_PER_MATCHDAY = LEAGUE_SIZE / 2;
export const FORM_LENGTH = 5;

export const POINTS = { win: 3, draw: 1, loss: 0 } as const;

/** Goals for the home house, then the away house. League matches can be drawn. */
export type Score = readonly [number, number];

export type FormResult = 'W' | 'D' | 'L';

export interface LeagueState {
  readonly seed: number;
  readonly playerHouse: string;
  /** All eight houses in draw order: their slots in the schedule, and the last tiebreak. */
  readonly houses: readonly string[];
  /** Scores per matchday in fixture order; null until played. */
  readonly results: readonly (readonly (Score | null)[])[];
}

export interface LeagueEntry {
  readonly seed: number;
  readonly playerHouse: string;
}

export interface LeagueFixture {
  readonly matchday: number;
  readonly index: number;
  readonly home: string;
  readonly away: string;
  readonly score: Score | null;
}

export interface TableRow {
  readonly house: string;
  readonly played: number;
  readonly won: number;
  readonly drawn: number;
  readonly lost: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalDifference: number;
  readonly points: number;
  /** The last five results, newest last. */
  readonly form: readonly FormResult[];
}

type Pairing = readonly [home: number, away: number];

/** The circle method on draw slots: slot 7 stays put while the others rotate. Flipping every pairing
 * on odd matchdays alternates venues, so no house is at home or away three times running. */
function firstHalf(): Pairing[][] {
  return Array.from({ length: HALF }, (_, day) => {
    const pairs: Pairing[] = [[HALF, day]];
    for (let k = 1; k < FIXTURES_PER_MATCHDAY; k++) pairs.push([(day + k) % HALF, (day - k + HALF) % HALF]);
    return day % 2 === 0 ? pairs : pairs.map(([home, away]) => [away, home]);
  });
}

const FIRST_HALF = firstHalf();

// Matchdays 8–14 mirror 1–7. Guaranteed: one match per house per matchday, each pair meets home and away,
// 7 home and 7 away each, and never more than two home or two away in a row (across the 7–8 seam too).
const PAIRINGS: readonly (readonly Pairing[])[] = [
  ...FIRST_HALF,
  ...FIRST_HALF.map((day) => day.map(([home, away]): Pairing => [away, home])),
];

const emptyResults = (): (Score | null)[][] =>
  PAIRINGS.map((day) => Array.from({ length: day.length }, () => null));

/** Salted so the league draw doesn't line up with anything else drawn from the season seed. */
const drawSeed = (seed: number): number => (seed ^ 0x5bd1e995) >>> 0;

/** Draws the schedule at random from `houses`, which must be eight distinct houses including the player's. */
export function createLeague(entry: LeagueEntry, houses: readonly string[]): LeagueState {
  if (
    houses.length !== LEAGUE_SIZE ||
    new Set(houses).size !== LEAGUE_SIZE ||
    !houses.includes(entry.playerHouse)
  )
    throw new Error('A league needs eight distinct houses, the player’s among them');
  return {
    ...entry,
    houses: createRng(drawSeed(entry.seed)).shuffle(houses),
    results: emptyResults(),
  };
}

const houseAt = (league: LeagueState, slot: number): string => {
  const house = league.houses[slot];
  if (house === undefined) throw new Error('A league needs eight houses');
  return house;
};

export function fixtures(league: LeagueState, matchday: number): LeagueFixture[] {
  return (PAIRINGS[matchday] ?? []).map(([home, away], index) => ({
    matchday,
    index,
    home: houseAt(league, home),
    away: houseAt(league, away),
    score: league.results[matchday]?.[index] ?? null,
  }));
}

const hasHouse = (fixture: LeagueFixture, house: string): boolean =>
  fixture.home === house || fixture.away === house;

/** The first matchday with a fixture still to play, or MATCHDAYS once the season is over. */
export function currentMatchday(league: LeagueState): number {
  const matchday = PAIRINGS.findIndex((_, day) => fixtures(league, day).some((f) => !f.score));
  return matchday === -1 ? MATCHDAYS : matchday;
}

export const isFinished = (league: LeagueState): boolean => currentMatchday(league) === MATCHDAYS;

/** The player's fixture on `matchday` (by default the current one), played or not. */
export function playerFixture(
  league: LeagueState,
  matchday: number = currentMatchday(league),
): LeagueFixture | null {
  return fixtures(league, matchday).find((f) => hasHouse(f, league.playerHouse)) ?? null;
}

/** The other fixtures of the current matchday, played out once the player has played theirs. */
export function pendingSimulations(league: LeagueState): LeagueFixture[] {
  if (!playerFixture(league)?.score) return [];
  return fixtures(league, currentMatchday(league)).filter((f) => !f.score);
}

const isGoals = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 100;

/** Records a fixture of the current matchday; earlier matchdays are settled, later ones wait. */
export function recordResult(
  league: LeagueState,
  matchday: number,
  index: number,
  score: Score,
): LeagueState {
  const fixture = fixtures(league, matchday)[index];
  if (!fixture || fixture.score || matchday !== currentMatchday(league))
    throw new Error('That fixture cannot be played');
  if (!isGoals(score[0]) || !isGoals(score[1])) throw new Error('A score is two goal counts');
  return {
    ...league,
    results: league.results.map((day, d) =>
      d === matchday ? day.map((s, i) => (i === index ? score : s)) : day,
    ),
  };
}

/** Records the player's match, given as [player, rival] the way the match screen reports it. */
export function recordPlayerResult(
  league: LeagueState,
  fixture: LeagueFixture,
  [us, them]: Score,
): LeagueState {
  const playerHome = fixture.home === league.playerHouse;
  return recordResult(league, fixture.matchday, fixture.index, playerHome ? [us, them] : [them, us]);
}

/** A seed for one fixture, so a replayed or resumed season plays every match the same way. */
export const fixtureSeed = (seasonSeed: number, matchday: number, index: number): number =>
  (Math.imul(seasonSeed ^ 0x85ebca6b, 31) + matchday * FIXTURES_PER_MATCHDAY + index) >>> 0;

interface Tally {
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  form: FormResult[];
}

const resultFor = (scored: number, conceded: number): FormResult =>
  scored > conceded ? 'W' : scored === conceded ? 'D' : 'L';

const pointsFor = (result: FormResult): number =>
  result === 'W' ? POINTS.win : result === 'D' ? POINTS.draw : POINTS.loss;

const played = (league: LeagueState): LeagueFixture[] =>
  PAIRINGS.flatMap((_, day) => fixtures(league, day)).filter((f) => f.score);

function toRow(house: string, tally: Tally): TableRow {
  const { won, drawn, lost, goalsFor, goalsAgainst, form } = tally;
  return {
    house,
    played: won + drawn + lost,
    won,
    drawn,
    lost,
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    points: won * POINTS.win + drawn * POINTS.draw,
    form: form.slice(-FORM_LENGTH),
  };
}

/** Points each house took from matches between the houses of `group` alone. */
function headToHead(matches: readonly LeagueFixture[], group: readonly string[]): Map<string, number> {
  const points = new Map(group.map((house) => [house, 0]));
  for (const { home, away, score } of matches) {
    if (!score || !points.has(home) || !points.has(away)) continue;
    points.set(home, (points.get(home) ?? 0) + pointsFor(resultFor(score[0], score[1])));
    points.set(away, (points.get(away) ?? 0) + pointsFor(resultFor(score[1], score[0])));
  }
  return points;
}

const level = (row: TableRow): string => `${row.points}/${row.goalDifference}/${row.goalsFor}`;

/** Sorted by points, goal difference, goals for, then head-to-head points in a mini-table of all the
 * houses still level on those three, and finally draw order (the order of `league.houses`). */
export function table(league: LeagueState): TableRow[] {
  const tallies = new Map<string, Tally>(
    league.houses.map((house) => [
      house,
      { won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, form: [] },
    ]),
  );
  const matches = played(league);
  for (const { home, away, score } of matches) {
    if (!score) continue;
    const sides = [
      [home, score[0], score[1]],
      [away, score[1], score[0]],
    ] as const;
    for (const [house, scored, conceded] of sides) {
      const tally = tallies.get(house);
      if (!tally) continue;
      const result = resultFor(scored, conceded);
      if (result === 'W') tally.won++;
      else if (result === 'D') tally.drawn++;
      else tally.lost++;
      tally.goalsFor += scored;
      tally.goalsAgainst += conceded;
      tally.form.push(result);
    }
  }
  const rows = [...tallies].map(([house, tally]) => toRow(house, tally));

  const h2h = new Map<string, number>();
  for (const key of new Set(rows.map(level))) {
    const group = rows.filter((r) => level(r) === key).map((r) => r.house);
    if (group.length > 1) for (const [house, pts] of headToHead(matches, group)) h2h.set(house, pts);
  }
  const slot = (house: string): number => league.houses.indexOf(house);
  return rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      (h2h.get(b.house) ?? 0) - (h2h.get(a.house) ?? 0) ||
      slot(a.house) - slot(b.house),
  );
}

/** The house top of the final table, once every fixture is played. */
export function champion(league: LeagueState): string | null {
  return isFinished(league) ? (table(league)[0]?.house ?? null) : null;
}

function normalizeScore(raw: unknown): Score | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [home, away] = raw as unknown[];
  return isGoals(home) && isGoals(away) ? [home, away] : null;
}

/** Reads the league part of a saved season, or null for anything that is not a real season played in order. */
export function normalizeLeague(raw: unknown, houses: readonly string[]): LeagueState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { seed, playerHouse, houses: drawn, results } = raw as Record<string, unknown>;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0) return null;
  if (typeof playerHouse !== 'string' || !Array.isArray(drawn) || !Array.isArray(results)) return null;
  if (drawn.length !== LEAGUE_SIZE || results.length !== MATCHDAYS) return null;
  if (!drawn.every((id): id is string => typeof id === 'string' && houses.includes(id))) return null;
  if (new Set(drawn).size !== LEAGUE_SIZE || !drawn.includes(playerHouse)) return null;

  let league: LeagueState = { seed, playerHouse, houses: drawn, results: emptyResults() };
  // Replaying each score through recordResult rejects any result on a matchday that could not yet be played.
  for (let matchday = 0; matchday < MATCHDAYS; matchday++) {
    const day: unknown = results[matchday];
    if (!Array.isArray(day) || day.length !== FIXTURES_PER_MATCHDAY) return null;
    for (let index = 0; index < day.length; index++) {
      if (day[index] === null) continue;
      const score = normalizeScore(day[index]);
      if (!score || matchday !== currentMatchday(league)) return null;
      league = recordResult(league, matchday, index, score);
    }
  }
  return league;
}
