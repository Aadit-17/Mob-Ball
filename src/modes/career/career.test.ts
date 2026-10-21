import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK } from '../../knight/look';
import { currentMatchday, fixtures, isFinished, MATCHDAYS, table } from '../manager/league';
import { MatchRunner } from '../runner';
import { atClub, byRanking, fakeSeason } from '../../test/career';
import {
  endSeason,
  isSeasonOver,
  leagueSeed,
  matchday,
  nextSeason,
  pendingFixtures,
  planFixture,
  playerFixture,
  PLAYER_ID,
  simMatchday,
  simulate,
  startCareer,
  START_AGE,
  type CareerState,
  type FixturePlan,
} from './career';
import { DIVISIONS, divisionOf, squadOfClub } from './clubs';
import { HONOUR_POINTS } from './economy';
import { normalizeCareer } from './save';

const start = (seed = 11): CareerState => startCareer({ seed, look: DEFAULT_LOOK, position: 'mid' });

describe('a new career', () => {
  it('starts at 17 at a Village League club, with three leagues drawn from the seed', () => {
    const c = start();
    expect(c.player.age).toBe(START_AGE);
    expect(divisionOf(c.world, c.player.club)).toBe(0);
    expect(c.season.leagues.map((l) => [...l.houses].sort())).toEqual(
      c.world.divisions.map((d) => [...d].sort()),
    );
    DIVISIONS.forEach((d) => {
      expect(c.season.leagues[d]?.seed).toBe(leagueSeed(c.seed, 0, d));
    });
    expect(c.season.leagues[0]?.playerHouse).toBe(c.player.club);
    expect(matchday(c)).toBe(0);
    expect(playerFixture(c)?.division).toBe(0);
  });

  it('starts at the chosen Village club, and refuses any other', () => {
    expect(startCareer({ seed: 1, look: DEFAULT_LOOK, position: 'gk', club: 'mill' }).player.club).toBe(
      'mill',
    );
    expect(() => startCareer({ seed: 1, look: DEFAULT_LOOK, position: 'gk', club: 'ember' })).toThrow();
  });
});

describe('a season across three divisions', () => {
  const c0 = start();
  const village = c0.world.divisions[0] ?? [];
  // His club wins the Village League; everywhere else the table runs in division order.
  const ranking = [c0.player.club, ...c0.world.divisions.flat().filter((c) => c !== c0.player.club)];
  const done = fakeSeason(c0, byRanking(ranking, { player: 7.4 }));

  it('plays every fixture of all three leagues over 14 matchdays', () => {
    expect(isSeasonOver(done)).toBe(true);
    expect(done.season.leagues.every(isFinished)).toBe(true);
    for (const league of done.season.leagues)
      for (const row of table(league)) expect(row.played).toBe(MATCHDAYS);
  });

  it('crowns his club, promotes it, and pays the honours', () => {
    const ended = endSeason(done);
    const summary = ended.history[0];
    expect(summary?.finish).toBe(1);
    expect(summary?.honours).toEqual(expect.arrayContaining(['title', 'promotion', 'topScorer']));
    expect(summary?.honourPoints).toBe(
      HONOUR_POINTS.title[0] + HONOUR_POINTS.promotion[0] + HONOUR_POINTS.topScorer[0],
    );
    expect(ended.player.points).toBe(done.player.points + (summary?.honourPoints ?? 0));
    expect(summary?.apps).toBe(MATCHDAYS);
    expect(summary?.average).toBeCloseTo(7.4);
    expect(() => endSeason(ended)).toThrow();
  });

  it('moves exactly two up and two down at each boundary, his club with them, and ages him a year', () => {
    const ended = endSeason(done);
    const next = nextSeason(ended, null);
    expect(next.player.age).toBe(START_AGE + 1);
    expect(next.season.number).toBe(1);
    expect(divisionOf(next.world, next.player.club)).toBe(1);
    const tables = done.season.leagues.map((l) => table(l).map((r) => r.house));
    for (let d = 0; d < 2; d++) {
      const up = (next.world.divisions[d + 1] ?? []).filter((club) =>
        done.world.divisions[d]?.includes(club),
      );
      const down = (next.world.divisions[d] ?? []).filter((club) =>
        done.world.divisions[d + 1]?.includes(club),
      );
      expect(up.sort()).toEqual(tables[d]?.slice(0, 2).sort());
      expect(down.sort()).toEqual(tables[d + 1]?.slice(6).sort());
    }
    expect(next.season.leagues[1]?.playerHouse).toBe(next.player.club);
    expect(next.season.leagues.every((l) => currentMatchday(l) === 0)).toBe(true);
    expect(village).toContain(next.player.club);
  });

  it('takes him to the club whose offer he accepts, and only an offer he has', () => {
    const ended = endSeason(done);
    const offer = ended.review?.offers[0];
    if (offer) expect(nextSeason(ended, offer.club).player.club).toBe(offer.club);
    expect(() => nextSeason(ended, 'not-a-club')).toThrow();
    expect(() => nextSeason(done, null)).toThrow();
  });

  it('relegates his club from the Shire when it finishes in the bottom two', () => {
    const host = c0.world.divisions[1]?.[0] ?? '';
    const shire = atClub(c0, host);
    const last = [...ranking.filter((c) => c !== host), host];
    const ended = endSeason(fakeSeason(shire, byRanking(last, { player: 6 })));
    expect(ended.history[0]?.relegated).toBe(true);
    expect(ended.history[0]?.honours).toEqual([]);
    expect(divisionOf(nextSeason(ended, null).world, host)).toBe(0);
  });
});

describe('real matches', () => {
  /** Plays a plan the way the match screen does: a frame at a time in uneven chunks, keeping every event. */
  function watched(plan: FixturePlan) {
    const runner = new MatchRunner(plan.config());
    const chunks = [1, 3, 17, 120, 2];
    for (let i = 0; !runner.ended; i++) {
      const frames = chunks[i % chunks.length] ?? 1;
      for (let s = 0; s < frames; s++) runner.advanceOne(() => null);
    }
    return { stats: runner.stats, steps: runner.step };
  }

  it('give the same result watched or headless, and only the forged knight’s spec differs played or simmed', () => {
    const c = start(21);
    const ref = playerFixture(c);
    if (!ref) throw new Error('no fixture');
    const sim = planFixture(c, ref, 'sim');
    const headless = sim.finish(c, simulate(sim));
    const screen = planFixture(c, ref, 'sim');
    expect(screen.finish(c, watched(screen))).toEqual(headless);

    const played = planFixture(c, ref, 'play');
    expect(played.finish(c, watched(played))).toEqual(
      played.finish(c, simulate(planFixture(c, ref, 'play'))),
    );
    const [a, b] = [sim.config(), played.config()];
    const slot = sim.sheets[0].playerSlot;
    expect(slot).not.toBeNull();
    a.home.forEach((spec, i) => {
      if (i === slot) expect(spec).not.toEqual(b.home[i]);
      else expect(spec).toEqual(b.home[i]);
    });
    expect(a.away).toEqual(b.away);
    expect(a.seed).toBe(b.seed);
  });

  it('record every knight’s rating and the scorers for his match, and change stamina and form', () => {
    const c = start(21);
    const ref = playerFixture(c);
    if (!ref) throw new Error('no fixture');
    const plan = planFixture(c, ref);
    const after = plan.finish(c, simulate(plan));
    const record = after.season.records[ref.division]?.[0]?.[ref.index];
    expect(record).not.toBeNull();
    expect(Object.keys(record?.ratings ?? {})).toContain(PLAYER_ID);
    expect(Object.keys(record?.ratings ?? {}).length).toBeGreaterThanOrEqual(8);
    const score = after.season.leagues[ref.division]?.results[0]?.[ref.index];
    expect(record?.goals.length).toBeLessThanOrEqual((score?.[0] ?? 0) + (score?.[1] ?? 0));
    expect(after.player.stamina).toBeLessThan(c.player.stamina);
    expect(after.player.form).toHaveLength(1);
    expect(pendingFixtures(after)).toHaveLength(11);
    expect(normalizeCareer(JSON.parse(JSON.stringify(after)))).toEqual(after);
  });

  it('are the same career from the same seed and choices, and another from another seed', () => {
    const two = (seed: number) => simMatchday(simMatchday(start(seed)));
    const a = two(5);
    expect(two(5)).toEqual(a);
    expect(two(6)).not.toEqual(a);
    expect(matchday(a)).toBe(2);
    expect(normalizeCareer(JSON.parse(JSON.stringify(a)))).toEqual(a);
  }, 60_000);

  it('play out a whole season in all three divisions, ratings for every fixture, and save at its end', () => {
    let c = start(8);
    while (!isSeasonOver(c)) c = simMatchday(c);
    for (const d of DIVISIONS)
      for (let md = 0; md < MATCHDAYS; md++)
        for (const f of c.season.leagues[d] ? fixtures(c.season.leagues[d], md) : []) {
          const record = c.season.records[d]?.[md]?.[f.index];
          expect(record).toBeTruthy();
          const mine = f.home === c.player.club || f.away === c.player.club;
          const ids = Object.keys(record?.ratings ?? {});
          const squads = [f.home, f.away].flatMap((club) => squadOfClub(c.world, club).map((k) => k.id));
          expect(ids.every((id) => squads.includes(id) || (mine && id === PLAYER_ID))).toBe(true);
        }
    const ended = endSeason(c);
    expect(ended.history[0]?.apps).toBeGreaterThan(0);
    expect(normalizeCareer(JSON.parse(JSON.stringify(ended)))).toEqual(ended);
    const next = nextSeason(ended, null);
    expect(normalizeCareer(JSON.parse(JSON.stringify(next)))).toEqual(next);
  }, 120_000);
});
