import { describe, expect, it } from 'vitest';
import type { AppContext } from '../app';
import { DEFAULT_LOOK } from '../knight/look';
import { rateMatch } from '../stats/ratings';
import { career, careerLine, careerSession, newCareer, simPlayerMatch, teamNews } from './career';
import { fixtureAt, PLAYER_ID, playerFixture, type CareerState } from './career/career';
import { MatchRunner } from './runner';

function fakeApp(): AppContext & { career: CareerState | null } {
  const app = {
    look: DEFAULT_LOOK,
    career: null as CareerState | null,
    setCareer(next: CareerState | null) {
      app.career = next;
    },
  };
  return app as unknown as AppContext & { career: CareerState | null };
}

const started = (): AppContext & { career: CareerState | null } => {
  const app = fakeApp();
  app.setCareer(newCareer(app, 'fwd', 11));
  return app;
};

/** His club's fixture this matchday, as saved. */
const mine = (run: CareerState | null) => {
  const ref = run && playerFixture(run);
  if (!run || !ref) throw new Error('No fixture');
  return { ref, fixture: fixtureAt(run, ref) };
};

describe('My Career mode', () => {
  it('says season, division, club and place on the home card', () => {
    const app = started();
    if (!app.career) throw new Error('No career');
    expect(career.progress?.(app)?.note).toMatch(/^Season 1 · Village League · .+ · Matchday 1 to come$/);
    simPlayerMatch(app);
    expect(careerLine(app.career)).toMatch(/^Season 1 · Village League · .+ · \d(st|nd|rd|th)$/);
  });

  it('records a played match from the full-time screen once, with his rating', () => {
    const app = started();
    // On a village pitch the untrained knight is the best there, so he starts matchday 1.
    expect(teamNews(app.career ?? (null as never)).starts).toBe(true);
    const session = careerSession(app);
    if (!session?.fixture) throw new Error('No session');
    expect(session.restartable).toBe(false);
    const runner = new MatchRunner(session.fixture());
    runner.advance(Infinity);
    const result = {
      score: [runner.state.score[0], runner.state.score[1]] as const,
      goals: [],
      steps: runner.step,
      timeline: runner.timeline,
      goalLog: runner.goals,
      ratings: rateMatch(runner.stats),
      stats: runner.stats,
    };
    session.resultActions(result);
    const once = app.career;
    const { ref, fixture } = mine(once);
    const home = fixture.home === once?.player.club;
    expect(fixture.score).toEqual(home ? result.score : [result.score[1], result.score[0]]);
    expect(once?.season.records[ref.division]?.[0]?.[ref.index]?.ratings[PLAYER_ID]).toBeDefined();
    session.resultActions(result);
    expect(app.career).toBe(once);
  });

  it('sims his match only while it is still to play', () => {
    const app = started();
    simPlayerMatch(app);
    const after = app.career;
    expect(mine(after).fixture.score).not.toBeNull();
    simPlayerMatch(app);
    expect(app.career).toBe(after);
    expect(careerSession(app)).toBeNull();
  });
});
