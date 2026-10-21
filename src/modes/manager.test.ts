import { describe, expect, it } from 'vitest';
import type { AppContext } from '../app';
import { knightById } from '../game/match';
import { DEFAULT_LOOK } from '../knight/look';
import { rateMatch } from '../stats/ratings';
import { managerSession, skipPlayerMatch } from './manager';
import { DRAFT_HOUSES, squadOf } from './manager/draft';
import { playerFixture } from './manager/league';
import { autoDraft, planMatch, startSeason, type SeasonState } from './manager/season';
import { MatchRunner } from './runner';

function drafted(): SeasonState {
  let season = startSeason(5, 'ember', { ...DEFAULT_LOOK, name: 'Sir Rookie' });
  while (!season.league) season = autoDraft(season);
  return season;
}

/** Just enough of the app for the Manager functions under test: the season and its setter. */
function fakeApp(season: SeasonState): AppContext & { season: SeasonState | null } {
  const app = {
    season: season as SeasonState | null,
    setSeason(next: SeasonState | null) {
      app.season = next;
    },
  };
  return app as unknown as AppContext & { season: SeasonState | null };
}

/** The player's saved record for matchday 1, every rating turned to the knight's name. */
function savedByName(season: SeasonState | null) {
  const fixture = season?.league && playerFixture(season.league, 0);
  const record = fixture && season.records[0]?.[fixture.index];
  if (!season || !record) throw new Error('No record');
  const pool = DRAFT_HOUSES.flatMap((h) => squadOf(season.draft, h));
  const name = (id: string): string => pool.find((k) => k.id === id)?.look.name ?? '?';
  return {
    ratings: Object.fromEntries(Object.entries(record.ratings).map(([id, r]) => [name(id), r])),
    motm: name(record.motm),
  };
}

const ranByName = (runner: MatchRunner) => {
  const name = (id: number): string => knightById(runner.state, id)?.look.name ?? '?';
  const ratings = rateMatch(runner.stats);
  return {
    ratings: Object.fromEntries(
      ratings.knights.map((k) => [name(k.id), [Math.round(k.rating * 10) / 10, k.role]]),
    ),
    motm: name(ratings.motm ?? -1),
  };
};

describe("the player's match", () => {
  it('saves the ratings of a skipped match, as the same match run in full rates them', () => {
    const season = drafted();
    const app = fakeApp(season);
    skipPlayerMatch(app);
    const fixture = playerFixture(season.league ?? (null as never));
    if (!fixture) throw new Error('No fixture');
    const runner = new MatchRunner(planMatch(season, fixture).config());
    runner.advance(Infinity);
    expect(savedByName(app.season)).toEqual(ranByName(runner));
  });

  it('saves the ratings of a watched match with a dugout substitution, from the full-time result', () => {
    const app = fakeApp(drafted());
    const session = managerSession(app);
    if (!session?.fixture || !session.dugout) throw new Error('No session');
    const runner = new MatchRunner(session.fixture());
    runner.advance(6000);
    const on = session.dugout.bench[0];
    if (!on) throw new Error('No bench');
    runner.act(0, { kind: 'substitution', offId: 3, on });
    runner.advance(Infinity);
    const [a, b] = runner.state.score;
    session.resultActions({
      score: [a, b],
      goals: [],
      steps: runner.step,
      timeline: runner.timeline,
      goalLog: runner.goals,
      ratings: rateMatch(runner.stats),
    });
    const saved = savedByName(app.season);
    expect(saved).toEqual(ranByName(runner));
    expect(Object.keys(saved.ratings)).toContain(on.look.name);
  });
});
