import { createRng } from '../../game/rng';
import { randomLook } from '../../knight/look';
import { LEAGUE_SIZE, type TableRow } from '../manager/league';
import {
  CLUB_IDS,
  divisionOf,
  freshHelmet,
  freshName,
  recruitTier,
  RECRUIT_OLDEST,
  YOUNGEST,
  type CareerKnight,
  type World,
} from './clubs';

/** Clubs that go up from, and down from, each division every season. */
export const PROMOTED = 2;
export const RELEGATED = 2;

/** Next season's divisions from this season's final tables (one per division, Village League first): the top two
 * of each go up and the bottom two down, the top division sending none up and the bottom none down. */
export function promote(tables: readonly (readonly TableRow[])[]): string[][] {
  const clubs = (rows: readonly TableRow[] | undefined) => (rows ?? []).map((r) => r.house);
  const up = tables.map((rows, d) => (d < tables.length - 1 ? clubs(rows).slice(0, PROMOTED) : []));
  const down = tables.map((rows, d) => (d > 0 ? clubs(rows).slice(LEAGUE_SIZE - RELEGATED) : []));
  return tables.map((rows, d) => [
    ...clubs(rows).filter((c) => !(up[d] ?? []).includes(c) && !(down[d] ?? []).includes(c)),
    ...(down[d + 1] ?? []),
    ...(up[d - 1] ?? []),
  ]);
}

/** Bot knights retire at this age, and otherwise leave for elsewhere with this chance a season. */
export const RETIRE_AGE = 34;
export const MOVE_CHANCE = 0.08;

/** A summer of comings and goings: everyone ages, the old retire, a few move on, and each club signs young at the level
 * of the division it now plays in, so each division stays near its tier and a promoted club grows into it. */
export function churn(world: World, seed: number): World {
  const rng = createRng(seed);
  const taken = new Set(Object.values(world.squads).flatMap((s) => s.map((k) => k.look.name)));
  let next = world.nextKnight;
  const squads: Record<string, CareerKnight[]> = {};
  for (const club of CLUB_IDS) {
    const division = divisionOf(world, club);
    const squad: CareerKnight[] = [];
    for (const knight of world.squads[club] ?? []) {
      const age = knight.age + 1;
      const leaves = age >= RETIRE_AGE || rng.next() < MOVE_CHANCE;
      if (!leaves) {
        squad.push({ ...knight, age });
        continue;
      }
      const name = freshName(rng, taken);
      taken.add(name);
      const look = randomLook(rng, name, freshHelmet(rng, squad));
      const tier = recruitTier(division, rng);
      squad.push({
        id: `k${next++}`,
        look,
        tier,
        forged: false,
        age: YOUNGEST + rng.int(RECRUIT_OLDEST - YOUNGEST + 1),
      });
    }
    squads[club] = squad;
  }
  return { divisions: world.divisions, squads, nextKnight: next };
}
