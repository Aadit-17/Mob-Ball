import { describe, expect, it } from 'vitest';
import { createLeague, recordResult, fixtures, MATCHDAYS, table, type LeagueState } from '../manager/league';
import { DIVISION_TIER, DIVISIONS, divisionOf, startingWorld, type World } from './clubs';
import { churn, MOVE_CHANCE, promote, RETIRE_AGE } from './world';

const world = startingWorld();

/** A finished league whose table runs in the order of `ranking`: the higher-ranked club wins every meeting. */
function finished(clubs: readonly string[], ranking: readonly string[]): LeagueState {
  let league = createLeague({ seed: 5, playerHouse: clubs[0] ?? '' }, clubs);
  for (let day = 0; day < MATCHDAYS; day++)
    for (const f of fixtures(league, day))
      league = recordResult(
        league,
        day,
        f.index,
        ranking.indexOf(f.home) < ranking.indexOf(f.away) ? [1, 0] : [0, 1],
      );
  return league;
}

describe('promotion and relegation', () => {
  const tables = DIVISIONS.map((d) => {
    const clubs = world.divisions[d] ?? [];
    return table(finished(clubs, [...clubs].reverse()));
  });
  const next = promote(tables);
  const order = tables.map((rows) => rows.map((r) => r.house));

  it('sends exactly the top two up and the bottom two down at each boundary', () => {
    expect(next.map((d) => d.length)).toEqual([8, 8, 8]);
    expect(new Set(next.flat()).size).toBe(24);
    for (let d = 0; d < 2; d++) {
      const up = order[d]?.slice(0, 2) ?? [];
      const down = order[d + 1]?.slice(6) ?? [];
      expect(next[d + 1]).toEqual(expect.arrayContaining(up));
      expect(next[d]).toEqual(expect.arrayContaining(down));
      expect((next[d + 1] ?? []).filter((c) => world.divisions[d]?.includes(c)).sort()).toEqual(
        [...up].sort(),
      );
      expect((next[d] ?? []).filter((c) => world.divisions[d + 1]?.includes(c)).sort()).toEqual(
        [...down].sort(),
      );
    }
  });

  it('keeps the third to sixth where they were, and nobody leaves the top or bottom of the pyramid', () => {
    for (let d = 0; d < 3; d++)
      for (const club of order[d]?.slice(2, 6) ?? []) expect(next[d]).toContain(club);
    for (const club of order[2]?.slice(0, 2) ?? []) expect(next[2]).toContain(club);
    for (const club of order[0]?.slice(6) ?? []) expect(next[0]).toContain(club);
  });
});

describe('the summer churn', () => {
  const after = churn(world, 77);
  const ids = (w: World) => Object.values(w.squads).flatMap((s) => s.map((k) => k.id));

  it('ages everyone who stays a year, retires everyone at the retiring age, and keeps six a club', () => {
    for (const [club, squad] of Object.entries(after.squads)) {
      expect(squad).toHaveLength(6);
      const before = world.squads[club] ?? [];
      for (const k of squad) {
        const was = before.find((b) => b.id === k.id);
        if (was) expect(k.age).toBe(was.age + 1);
      }
      for (const old of before.filter((k) => k.age + 1 >= RETIRE_AGE))
        expect(squad.map((k) => k.id)).not.toContain(old.id);
    }
  });

  it('signs young replacements around the tier of the division the club now plays in, with new ids and names', () => {
    const fresh = Object.entries(after.squads).flatMap(([club, squad]) =>
      squad.filter((k) => !ids(world).includes(k.id)).map((k) => ({ k, club })),
    );
    const leaving = Object.values(world.squads)
      .flat()
      .filter((k) => k.age + 1 < RETIRE_AGE).length;
    expect(fresh.length).toBeGreaterThan(0);
    // Moves happen at about MOVE_CHANCE: well within three standard deviations over this many knights.
    const moved =
      fresh.length -
      Object.values(world.squads)
        .flat()
        .filter((k) => k.age + 1 >= RETIRE_AGE).length;
    expect(Math.abs(moved - MOVE_CHANCE * leaving)).toBeLessThan(3 * Math.sqrt(leaving * MOVE_CHANCE));
    for (const { k, club } of fresh) {
      expect(Math.abs(k.tier - DIVISION_TIER[divisionOf(after, club)])).toBeLessThanOrEqual(1);
      expect(k.age).toBeLessThanOrEqual(23);
    }
    expect(new Set(ids(after)).size).toBe(ids(after).length);
    const names = Object.values(after.squads).flatMap((s) => s.map((k) => k.look.name));
    expect(new Set(names).size).toBe(names.length);
    expect(after.nextKnight).toBe(world.nextKnight + fresh.length);
  });

  it('recruits at the new division’s level once a club has moved', () => {
    const swapped: World = {
      ...world,
      divisions: [world.divisions[2] ?? [], world.divisions[1] ?? [], world.divisions[0] ?? []],
    };
    const moved = churn(swapped, 77);
    const fresh = (w: World, club: string) =>
      (w.squads[club] ?? []).filter((k) => !ids(world).includes(k.id));
    for (const club of world.divisions[0] ?? [])
      for (const k of fresh(moved, club)) expect(k.tier).toBeGreaterThanOrEqual(2);
    for (const club of world.divisions[2] ?? [])
      for (const k of fresh(moved, club)) expect(k.tier).toBeLessThanOrEqual(2);
  });

  it('is the same summer from the same seed, and a different one from another', () => {
    expect(churn(world, 77)).toEqual(after);
    expect(churn(world, 78)).not.toEqual(after);
  });
});
