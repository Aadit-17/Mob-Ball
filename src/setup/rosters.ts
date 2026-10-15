import { TOP_TIER } from '../ai/skills';
import { ROLES_BY_SIZE, type TeamSize } from '../game/formation';
import type { KnightSpec } from '../game/match';
import { createRng, type Rng } from '../game/rng';
import type { Role } from '../game/types';
import { HELMETS, KNIGHT_NAMES } from '../knight/catalog';
import { randomLook, type Look } from '../knight/look';
import { REALM_HOUSES, type House } from './houses';
import { rollRivals, setTeamTier, type SquadLevels, type Squads } from './squads';

/** Changing this recasts every house in the realm. */
const REALM_SEED = 1066;
const ROSTER_ROLES = ROLES_BY_SIZE[4];

let realm: ReadonlyMap<string, readonly Look[]> | null = null;

/**
 * Casts every house's knights from one seed in house order, so new houses go at the end to keep
 * today's faces. Names are unique across the realm; helmets are unique within a house.
 */
function castRealm(): ReadonlyMap<string, readonly Look[]> {
  const rng = createRng(REALM_SEED);
  const names = rng.shuffle(KNIGHT_NAMES);
  if (names.length < REALM_HOUSES.length * ROSTER_ROLES.length)
    throw new Error('Not enough names to cast the realm');
  let next = 0;
  return new Map(
    REALM_HOUSES.map((house) => {
      const helmets = rng.shuffle(HELMETS.map((_, i) => i));
      const knights = ROSTER_ROLES.map((_, i) => randomLook(rng, names[next++] ?? 'Ser Nobody', helmets[i]));
      return [house.id, knights];
    }),
  );
}

/** A house's permanent knight for each role, the same in every match and on every machine. */
export function roster(house: House): Readonly<Record<Role, Look>> {
  realm ??= castRealm();
  const knights = realm.get(house.id);
  if (!knights) throw new Error(`House ${house.id} has no roster`);
  const byRole = (role: Role): Look => {
    const look = knights[ROSTER_ROLES.indexOf(role)];
    if (!look) throw new Error(`House ${house.id} has no ${role}`);
    return look;
  };
  return { gk: byRole('gk'), def: byRole('def'), mid: byRole('mid'), fwd: byRole('fwd') };
}

/** A house's bots for a match of this size, before any levels are set. */
export function rosterLineup(house: House, teamSize: TeamSize): KnightSpec[] {
  const knights = roster(house);
  return ROLES_BY_SIZE[teamSize].map((role) => ({
    look: knights[role],
    role,
    human: false,
    tier: 0,
    speedFactor: 1,
  }));
}

/**
 * Keeps every helmet and name on the pitch unique, as Exhibition does. The player never changes;
 * a bot whose helmet or name is taken wears a spare helmet, or a spare name, for this match only.
 */
function dressApart(specs: readonly KnightSpec[]): KnightSpec[] {
  const spareHelmets = HELMETS.map((_, i) => i).filter((i) => !specs.some((s) => s.look.helmet === i));
  const spareNames = KNIGHT_NAMES.filter((n) => !specs.some((s) => s.look.name === n));
  const player = specs.filter((s) => s.human).map((s) => s.look);
  const helmets = new Set(player.map((look) => look.helmet));
  const names = new Set(player.map((look) => look.name));
  return specs.map((spec) => {
    if (spec.human) return spec;
    let { helmet, name } = spec.look;
    if (helmets.has(helmet)) helmet = spareHelmets.shift() ?? helmet;
    if (names.has(name)) name = spareNames.shift() ?? name;
    helmets.add(helmet);
    names.add(name);
    return helmet === spec.look.helmet && name === spec.look.name
      ? spec
      : { ...spec, look: { ...spec.look, helmet, name } };
  });
}

/** Both line-ups for a match between two houses: the player takes their own house's forward place. */
export function rosterSquads(
  player: Look,
  house: House,
  rival: House,
  teamSize: TeamSize,
  levels: SquadLevels,
  rng: Rng,
): Squads {
  const home = setTeamTier(
    rosterLineup(house, teamSize).map((spec) =>
      spec.role === 'fwd' ? { ...spec, look: player, human: true, tier: TOP_TIER } : spec,
    ),
    levels.teammateTier,
  );
  const away = rollRivals(rosterLineup(rival, teamSize), levels.rivalMeanTier, rng);
  const dressed = dressApart([...home, ...away]);
  return { home: dressed.slice(0, home.length), away: dressed.slice(home.length) };
}
