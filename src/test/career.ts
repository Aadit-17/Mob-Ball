import {
  fixtures,
  MATCHDAYS,
  recordResult,
  type LeagueFixture,
  type LeagueState,
  type Score,
} from '../modes/manager/league';
import {
  leagueHost,
  matchday,
  PLAYER_ID,
  type CareerGoal,
  type CareerState,
  type FixtureRecord,
} from '../modes/career/career';
import { squadOfClub, type Division } from '../modes/career/clubs';

const leagueAt = (leagues: readonly LeagueState[], d: Division): LeagueState => {
  const league = leagues[d];
  if (!league) throw new Error(`No league ${d}`);
  return league;
};

export interface FakeMatch {
  readonly score: Score;
  /** Every knight's rating, the forged knight's included when he plays. */
  readonly rating?: number;
  /** The forged knight's rating, or undefined to leave him out of the match. */
  readonly player?: number;
}

/** Fills in the current matchday without the runner: scores, goals by each side's fourth knight (his, if he plays),
 * and ratings for each side's first four (6.5 to 6.8 unless set). Stamina and form are left alone. */
export function fakeMatchday(
  career: CareerState,
  match: (division: Division, fixture: LeagueFixture) => FakeMatch,
): CareerState {
  const day = matchday(career);
  let { leagues, records } = career.season;
  for (const division of [0, 1, 2] as const) {
    for (const fixture of fixtures(leagueAt(leagues, division), day)) {
      if (fixture.score) continue;
      const m = match(division, fixture);
      const ratings: Record<string, number> = {};
      const goals: CareerGoal[] = [];
      ([fixture.home, fixture.away] as const).forEach((club, side) => {
        const four = squadOfClub(career.world, club).slice(0, 4);
        const mine = club === career.player.club && m.player !== undefined;
        // A tenth apart within each side, so knights rank: every club's fourth knight is its best.
        for (const [i, k] of (mine ? four.slice(0, 3) : four).entries())
          ratings[k.id] = (m.rating ?? 6.5) + i / 10;
        if (mine) ratings[PLAYER_ID] = m.player ?? 6.5;
        const scorer = mine ? PLAYER_ID : (four[3]?.id ?? null);
        for (let g = 0; g < (side === 0 ? m.score[0] : m.score[1]); g++)
          goals.push({ side: side as 0 | 1, scorer, assist: null, ownGoal: false });
      });
      const record: FixtureRecord = { goals, ratings, motm: null, subs: [] };
      leagues = leagues.map((l, d) => (d === division ? recordResult(l, day, fixture.index, m.score) : l));
      records = records.map((div, d) =>
        d === division
          ? div.map((r, md) => (md === day ? r.map((x, i) => (i === fixture.index ? record : x)) : r))
          : div,
      );
    }
  }
  return { ...career, season: { ...career.season, leagues, records } };
}

/** The whole season, faked matchday by matchday. */
export function fakeSeason(
  career: CareerState,
  match: (division: Division, fixture: LeagueFixture) => FakeMatch,
): CareerState {
  let c = career;
  while (matchday(c) < MATCHDAYS) c = fakeMatchday(c, match);
  return c;
}

/** Home wins by the clubs' order in `ranking`: the earlier club always wins, so the table follows the ranking. */
export const byRanking =
  (ranking: readonly string[], extra: Partial<FakeMatch> = {}) =>
  (_: Division, f: LeagueFixture): FakeMatch => {
    const homeFirst = ranking.indexOf(f.home) < ranking.indexOf(f.away);
    return { score: homeFirst ? [2, 0] : [0, 2], ...extra };
  };

/** The same career with him at another club (the schedule's draw doesn't depend on whose league it is). */
export function atClub(c: CareerState, club: string): CareerState {
  return {
    ...c,
    player: { ...c.player, club },
    season: {
      ...c.season,
      leagues: c.season.leagues.map((l, d) => ({
        ...l,
        playerHouse: leagueHost(c.world.divisions[d] ?? [], club),
      })),
    },
  };
}
