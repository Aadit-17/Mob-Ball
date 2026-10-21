import type { AppContext } from '../app';
import { randomSeed } from '../game/rng';
import type { Role } from '../game/types';
import {
  careerDay,
  fixtureAt,
  isSeasonOver,
  matchday,
  planFixture,
  playerDivision,
  playerFixture,
  selection,
  simulate,
  startCareer,
  type CareerState,
  type FixturePlan,
} from './career/career';
import { clubById, DIVISION_NAMES } from './career/clubs';
import { formResidual } from './career/form';
import { ordinal } from './manager';
import { FRESH } from './manager/stamina';
import { MATCHDAYS, table, type LeagueFixture } from './manager/league';
import type { GameMode, MatchResult, MatchSession } from './mode';

/** His club's place in its division (1 to 8) and whether anyone has played yet. */
export function clubPlace(career: CareerState): { place: number; started: boolean } {
  const league = career.season.leagues[playerDivision(career)];
  const rows = league ? table(league) : [];
  const place = rows.findIndex((r) => r.house === career.player.club) + 1;
  return { place, started: (rows[0]?.played ?? 0) > 0 };
}

/** "Season 3 · Shire League · Ashby Vale · 2nd", the line on the home card. */
export function careerLine(career: CareerState): string {
  const { place, started } = clubPlace(career);
  const parts = [
    `Season ${career.season.number + 1}`,
    DIVISION_NAMES[playerDivision(career)],
    clubById(career.player.club).name,
  ];
  return [...parts, started ? ordinal(place) : 'Matchday 1 to come'].join(' · ');
}

/** Take your forged knight from a village pitch to the royal squad, season after season. */
export const career: GameMode = {
  id: 'career',
  name: 'My Career',
  blurb: 'Take your knight from village team to royal squad.',
  available: true,
  progress(app) {
    const run = app.career;
    if (!run) return null;
    if (run.review || isSeasonOver(run))
      return { note: `${careerLine(run)} · season over`, action: 'See the season' };
    return { note: careerLine(run), action: 'Continue career' };
  },
  start(app) {
    app.go('career');
  },
};

/** A new career for the forged knight as he looks now, at the village club the seed draws. */
export const newCareer = (app: AppContext, position: Role, seed: number = randomSeed()): CareerState =>
  startCareer({ seed, look: app.look, position });

/** His club's fixture this matchday, home side first. */
export function nextFixture(run: CareerState): LeagueFixture | null {
  const ref = playerFixture(run);
  return ref ? fixtureAt(run, ref) : null;
}

/** Whether he starts this matchday, and the manager's reason in a few words. */
export function teamNews(run: CareerState): { starts: boolean; reason: string } {
  const pick = selection(run);
  const rival = pick.incumbent.knight.look.name;
  const form = formResidual(run.player.form, careerDay(run));
  const stamina = Math.round(run.player.stamina);
  if (pick.starts) {
    if (form >= 0.15) return { starts: true, reason: 'In form: the manager keeps faith.' };
    if (stamina < FRESH)
      return { starts: true, reason: `Tired (stamina ${stamina}), but picked all the same.` };
    return { starts: true, reason: `Picked ahead of ${rival}.` };
  }
  const why =
    stamina < FRESH
      ? `Resting: stamina ${stamina}. ${rival} starts.`
      : form <= -0.15
        ? `Out of form. ${rival} starts in your place.`
        : `${rival} is preferred this matchday.`;
  return { starts: false, reason: `${why} You may yet come on.` };
}

/** Matchday N of 14, counting from one. */
export const matchdayLabel = (run: CareerState): string =>
  `Matchday ${Math.min(matchday(run) + 1, MATCHDAYS)} of ${MATCHDAYS}`;

/** Records his match from the full-time screen, once: a second press or a stale screen changes nothing. */
function recordPlayed(
  app: AppContext,
  plan: FixturePlan,
  result: Pick<MatchResult, 'stats' | 'steps'>,
): void {
  const run = app.career;
  if (!run || run.review || fixtureAt(run, plan.ref).score) return;
  app.setCareer(plan.finish(run, { stats: result.stats, steps: result.steps }));
}

/** His match this matchday, simmed: the sim's bot plays him at his stars. */
export function simPlayerMatch(app: AppContext): void {
  const run = app.career;
  const ref = run && !run.review ? playerFixture(run) : null;
  if (!run || !ref || fixtureAt(run, ref).score) return;
  const plan = planFixture(run, ref, 'sim');
  app.setCareer(plan.finish(run, simulate(plan)));
}

/** His match this matchday, on the pitch under his control; watched from the bench when he isn't picked. */
export function careerSession(app: AppContext): MatchSession | null {
  const run = app.career;
  const ref = run && !run.review ? playerFixture(run) : null;
  if (!run || !ref || fixtureAt(run, ref).score) return null;
  const plan = planFixture(run, ref, 'play');
  const [mine, theirs] = plan.sheets;
  // On the bench he may still come on, as the human: the controls wait for him.
  const benched = mine.playerBench !== null;
  return {
    home: mine.starters.map((s) => s.spec),
    away: theirs.starters.map((s) => s.spec),
    homeHouse: clubById(mine.club),
    awayHouse: clubById(theirs.club),
    quitTo: 'career',
    fixture: () => plan.config(),
    spectate: mine.playerSlot === null && !benched,
    benched,
    restartable: false,
    resultActions(result) {
      recordPlayed(app, plan, result);
      return [
        {
          label: 'Results across the realm',
          primary: true,
          run: () => {
            app.go('career');
          },
        },
      ];
    },
  };
}
