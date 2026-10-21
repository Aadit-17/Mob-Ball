import { describe, expect, it } from 'vitest';
import type { Role } from '../../game/types';
import { DEFAULT_LOOK } from '../../knight/look';
import { rateMatch } from '../../stats/ratings';
import { MatchRunner } from '../runner';
import { DRAFT_HOUSES, squadOf } from './draft';
import {
  currentForm,
  MIN_APPEARANCES,
  playerOfTheSeason,
  qualifying,
  recentRatings,
  seasonForm,
  squadByForm,
  teamOfTheSeason,
  topRated,
} from './form';
import { fixtures, MATCHDAYS, playerFixture } from './league';
import {
  autoDraft,
  otherFixtures,
  planMatch,
  startSeason,
  type FixtureRating,
  type FixtureRecord,
  type SeasonState,
} from './season';

const PLAYER = 'ember';

function drafted(seed = 5): SeasonState {
  let season = startSeason(seed, PLAYER, { ...DEFAULT_LOOK, name: 'Sir Rookie' });
  while (!season.league) season = autoDraft(season);
  return season;
}

/** One knight's line in a made-up fixture: squad id, rating and position. */
type Line = readonly [id: string, rating: number, role?: Role];

/** A season whose records are exactly `days`, one fixture a matchday, the rest unplayed. Form never
 * reads the league, so the records needn't match it. */
function withRecords(season: SeasonState, days: readonly (readonly Line[])[], motms: readonly string[] = []) {
  const records = Array.from({ length: MATCHDAYS }, (_, d): (FixtureRecord | null)[] => {
    const lines = days[d];
    const record: FixtureRecord | null = lines
      ? {
          goals: [],
          ratings: Object.fromEntries(
            lines.map(([id, rating, role]): [string, FixtureRating] => [id, [rating, role ?? 'mid']]),
          ),
          motm: motms[d] ?? lines[0]?.[0] ?? '',
        }
      : null;
    return [record, null, null, null];
  });
  return { ...season, records };
}

const season0 = drafted();
const squad = (house: string) => squadOf(season0.draft, house);
const [a, b, c, d] = squad('ember');
const [e, f] = squad('salt');
if (!a || !b || !c || !d || !e || !f) throw new Error('No squads');

describe('season form', () => {
  it('averages every rating, counts appearances and men of the match, and keeps ratings oldest first', () => {
    const season = withRecords(
      season0,
      [
        [
          [a.id, 7],
          [b.id, 6],
        ],
        [[a.id, 8]],
        [
          [a.id, 6.5],
          [b.id, 9],
        ],
      ],
      [a.id, a.id, b.id],
    );
    const form = seasonForm(season);
    expect(form.get(a.id)).toMatchObject({ house: 'ember', ratings: [7, 8, 6.5], appearances: 3, motm: 2 });
    expect(form.get(a.id)?.average).toBeCloseTo(7.1667, 4);
    expect(form.get(b.id)).toMatchObject({ ratings: [6, 9], appearances: 2, average: 7.5, motm: 1 });
    expect(form.has(c.id)).toBe(false);
  });

  it('gives each knight the position he played most, a tie to the latest', () => {
    const season = withRecords(season0, [
      [
        [a.id, 7, 'def'],
        [b.id, 7, 'fwd'],
      ],
      [
        [a.id, 7, 'mid'],
        [b.id, 7, 'fwd'],
      ],
      [
        [a.id, 7, 'def'],
        [b.id, 7, 'mid'],
      ],
      [[a.id, 7, 'mid']],
    ]);
    const form = seasonForm(season);
    expect(form.get(a.id)?.role).toBe('mid');
    expect(form.get(b.id)?.role).toBe('fwd');
  });

  it('reads current form from the last three ratings', () => {
    const season = withRecords(season0, [[[a.id, 9]], [[a.id, 5]], [[a.id, 6]], [[a.id, 7]]]);
    const k = seasonForm(season).get(a.id);
    if (!k) throw new Error('No form');
    expect(recentRatings(k)).toEqual([5, 6, 7]);
    expect(currentForm(k)).toBe(6);
  });

  it('asks for half the matchdays played, up to five appearances', () => {
    const played = (n: number) =>
      withRecords(
        season0,
        Array.from({ length: n }, () => []),
      );
    const full = (n: number): SeasonState => ({
      ...played(n),
      records: played(n).records.map((day, i) => (i < n ? day.map(() => day[0] ?? null) : day)),
    });
    expect([0, 1, 2, 3, 8, 9, 14].map((n) => qualifying(full(n)))).toEqual([1, 1, 1, 2, 4, 5, 5]);
    expect(MIN_APPEARANCES).toBe(5);
  });
});

describe('top rated and the season honours', () => {
  /** Five appearances each, at these averages and positions, unless `apps` says otherwise. */
  function league(rows: readonly { id: string; avg: number; role: Role; apps?: number; motm?: number }[]) {
    const days = Array.from({ length: 6 }, (_, day) =>
      rows.filter((r) => day < (r.apps ?? 5)).map((r): Line => [r.id, r.avg, r.role]),
    );
    const motms = days.map((_, day) => rows.find((r) => day < (r.motm ?? 0))?.id ?? '');
    return withRecords(season0, days, motms);
  }

  it('ranks by average among knights with enough appearances, ties by appearances, men of the match, then name', () => {
    const season = league([
      { id: a.id, avg: 7.4, role: 'mid' },
      { id: b.id, avg: 8.5, role: 'fwd', apps: 4 },
      { id: c.id, avg: 7.4, role: 'def', apps: 6 },
      { id: d.id, avg: 7.4, role: 'gk', motm: 2 },
      { id: e.id, avg: 7.4, role: 'gk' },
      { id: f.id, avg: 6.1, role: 'fwd' },
    ]);
    // Level on 7.4: c has an extra appearance, d two men of the match, and a and e go by name.
    const byName = [a, e].sort((x, y) => x.look.name.localeCompare(y.look.name));
    expect(topRated(season, 5).map((k) => k.knight.id)).toEqual([
      c.id,
      d.id,
      ...byName.map((k) => k.id),
      f.id,
    ]);
    expect(topRated(season, 4)[0]?.knight.id).toBe(b.id);
    expect(playerOfTheSeason(season, 5)?.knight.id).toBe(c.id);
    expect(playerOfTheSeason(season, 7)).toBeNull();
  });

  it('picks the best average in each position, keeper first, and leaves a position nobody qualifies for empty', () => {
    const season = league([
      { id: a.id, avg: 7.0, role: 'gk' },
      { id: e.id, avg: 7.0, role: 'gk', apps: 6 },
      { id: b.id, avg: 9.0, role: 'def', apps: 3 },
      { id: c.id, avg: 6.2, role: 'mid' },
      { id: f.id, avg: 6.8, role: 'mid' },
      { id: d.id, avg: 8.1, role: 'fwd' },
    ]);
    expect(teamOfTheSeason(season, 5).map((s) => [s.role, s.knight?.knight.id ?? null])).toEqual([
      ['gk', e.id],
      ['def', null],
      ['mid', f.id],
      ['fwd', d.id],
    ]);
  });

  it("sorts a house's squad by current form, then season average, with knights yet to play last", () => {
    const season = withRecords(season0, [
      [
        [a.id, 9],
        [b.id, 6],
        [c.id, 6],
      ],
      [
        [a.id, 5],
        [b.id, 7],
        [c.id, 7],
      ],
      [
        [a.id, 5],
        [b.id, 8],
        [c.id, 5],
      ],
      [
        [a.id, 5],
        [c.id, 9],
      ],
    ]);
    // Last three: b 7.0 (season 7.0), c 7.0 (season 6.75), a 5.0.
    const order = squadByForm(season, 'ember').map((r) => r.knight.id);
    expect(order.slice(0, 3)).toEqual([b.id, c.id, a.id]);
    const rest = squad('ember')
      .filter((k) => ![a, b, c].includes(k))
      .sort((x, y) => x.look.name.localeCompare(y.look.name))
      .map((k) => k.id);
    expect(order.slice(3)).toEqual(rest);
    expect(squadByForm(season, 'ember')[3]?.form).toBeNull();
  });
});

describe('a played season', () => {
  it('adds up to every saved rating, with one man of the match per fixture', () => {
    let season = drafted();
    for (let day = 0; day < 6; day++) {
      const mine = playerFixture(season.league ?? (null as never));
      if (!mine) throw new Error('No fixture');
      for (const fixture of [
        mine,
        ...fixtures(season.league ?? (null as never), day).filter((x) => x.index !== mine.index),
      ]) {
        const plan = planMatch(season, fixture);
        const runner = new MatchRunner(plan.config());
        runner.advance(Infinity);
        const [l, r] = runner.state.score;
        season = plan.finish(season, {
          score: [l, r],
          steps: runner.step,
          timeline: [],
          goals: runner.goals,
          ratings: rateMatch(runner.stats),
        });
      }
      expect(otherFixtures(season)).toEqual([]);
    }
    const form = [...seasonForm(season).values()];
    const saved = season.records.flat().flatMap((r) => (r ? Object.values(r.ratings) : []));
    expect(form.reduce((n, k) => n + k.appearances, 0)).toBe(saved.length);
    expect(form.reduce((n, k) => n + k.motm, 0)).toBe(6 * 4);
    expect(qualifying(season)).toBe(3);
    const team = teamOfTheSeason(season);
    expect(team.map((s) => s.role)).toEqual(['gk', 'def', 'mid', 'fwd']);
    for (const slot of team) if (slot.knight) expect(slot.knight.appearances).toBeGreaterThanOrEqual(3);
    expect(DRAFT_HOUSES.flatMap((h) => squadByForm(season, h))).toHaveLength(DRAFT_HOUSES.length * 6);
  }, 30_000);
});
