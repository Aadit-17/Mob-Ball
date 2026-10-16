import type { AppContext } from '../app';
import { skillFor } from '../ai/skills';
import { BUILDS } from '../game/constants';
import { randomSeed } from '../game/rng';
import { houseById } from '../setup/houses';
import { squadOf, TOTAL_PICKS } from './manager/draft';
import { champion, currentMatchday, isFinished, MATCHDAYS, playerFixture, table } from './manager/league';
import { knightStamina, planMatch, startSeason, type MatchPlan, type SeasonState } from './manager/season';
import { CHARGE, HOLD } from './manager/stamina';
import { MatchRunner } from './runner';
import type { GameMode, MatchResult, MatchSession } from './mode';
import { SQUAD_SIZE } from './manager/types';

/** "1st", "12th", "23rd". */
export const ordinal = (n: number): string => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
};

/** Where the player's house stands, e.g. "3rd, 2 pts off top" or "Top by 4 pts". */
export function standing(season: SeasonState): string {
  const league = season.league;
  if (!league) return '';
  const rows = table(league);
  const place = rows.findIndex((r) => r.house === season.draft.playerHouse);
  const mine = rows[place];
  const top = rows[0];
  const second = rows[1];
  if (!mine || !top || !second) return '';
  if (place === 0)
    return mine.points === second.points
      ? 'Top on goal difference'
      : `Top by ${mine.points - second.points} pts`;
  return `${ordinal(place + 1)}, ${top.points - mine.points} pts off top`;
}

/** One season in charge of a house: the draft, then fourteen league matchdays. */
export const manager: GameMode = {
  id: 'manager',
  name: 'Manager',
  blurb: 'Run a house for a season: draft six knights, pick the team, set tactics, win the league.',
  available: true,
  progress(app) {
    const season = app.season;
    if (!season) return null;
    const league = season.league;
    if (!league) {
      const picked = squadOf(season.draft, season.draft.playerHouse).length;
      return { note: `Draft under way: ${picked} of ${SQUAD_SIZE} picked`, action: 'Continue draft' };
    }
    if (isFinished(league)) {
      const won = champion(league) === season.draft.playerHouse;
      return {
        note: won ? 'Champions of the realm!' : `Season over: ${standing(season)}`,
        action: 'See the table',
      };
    }
    return {
      note: `Matchday ${currentMatchday(league) + 1} of ${MATCHDAYS} · ${standing(season)}`,
      action: 'Continue season',
    };
  },
  start(app) {
    app.go(app.season?.league ? 'manager' : 'draft');
  },
};

/** A new season for the player's chosen house, starting with the draft. */
export function enterSeason(app: AppContext, houseId: string): void {
  app.setSeason(startSeason(randomSeed(), houseId, app.look));
}

export const draftProgress = (season: SeasonState): number => season.draft.picks.length / TOTAL_PICKS;

/** Records the player's match and, if it settled the title for them, the honour. */
function finishPlayerMatch(
  app: AppContext,
  plan: MatchPlan,
  result: Pick<MatchResult, 'score' | 'steps' | 'timeline'>,
): void {
  const season = app.season;
  if (!season?.league || playerFixture(season.league)?.score) return;
  app.setSeason(plan.finish(season, { score: result.score, steps: result.steps, timeline: result.timeline }));
}

/** Plays the player's match of the current matchday without watching it: the same match, instantly. */
export function skipPlayerMatch(app: AppContext): void {
  const fixture = app.season?.league && playerFixture(app.season.league);
  if (!app.season || !fixture || fixture.score) return;
  const plan = planMatch(app.season, fixture);
  const runner = new MatchRunner(plan.config());
  runner.advance(Infinity);
  const [a, b] = runner.state.score;
  finishPlayerMatch(app, plan, { score: [a, b], steps: runner.step, timeline: runner.timeline });
}

/** Credits a league title once, when the last matchday is in and the player's house is top. */
export function settleSeason(app: AppContext): void {
  const season = app.season;
  if (!season?.league || !isFinished(season.league) || season.titleCounted) return;
  if (champion(season.league) === season.draft.playerHouse) app.addLeagueWin();
  app.setSeason({ ...season, titleCounted: true });
}

/** The player's match of the current matchday, watched, with the dugout open to them. */
export function managerSession(app: AppContext): MatchSession | null {
  const season = app.season;
  const fixture = season?.league && playerFixture(season.league);
  if (!season || !fixture || fixture.score) return null;
  const plan = planMatch(season, fixture);
  const [mine, theirs] = plan.sides;
  const describe = (house: string, id: string, tier: number, build: number): string =>
    `${skillFor(tier).name} · ${BUILDS[build]?.name ?? ''} · stamina ${Math.round(knightStamina(season, house, id))}`;
  const details: Record<string, string> = {};
  for (const s of mine.lineup.starters)
    details[s.knight.look.name] = describe(mine.house, s.knight.id, s.knight.tier, s.knight.look.build);
  for (const k of mine.lineup.bench) details[k.look.name] = describe(mine.house, k.id, k.tier, k.look.build);

  return {
    home: mine.specs,
    away: theirs.specs,
    homeHouse: houseById(mine.house),
    awayHouse: houseById(theirs.house),
    quitTo: 'manager',
    fixture: () => plan.config(),
    spectate: true,
    dugout: {
      bench: mine.bench,
      details,
      presets: [
        { label: 'Charge!', tactics: CHARGE },
        { label: 'Hold!', tactics: HOLD },
        { label: 'Team plan', tactics: mine.tactics },
      ],
    },
    resultActions(result) {
      finishPlayerMatch(app, plan, result);
      return [
        {
          label: 'Results across the realm',
          primary: true,
          run: () => {
            app.go('manager');
          },
        },
      ];
    },
  };
}
