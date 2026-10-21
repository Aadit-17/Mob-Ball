import { HELMETS, KNIGHT_NAMES } from '../../knight/catalog';
import { randomLook, NAME_MAX_LENGTH } from '../../knight/look';
import { createRng, type Rng } from '../../game/rng';
import { clamp } from '../../game/vec';
import { TOP_TIER } from '../../ai/skills';
import { REALM_HOUSES, type House } from '../../setup/houses';
import { roster } from '../../setup/rosters';
import { LEAGUE_SIZE } from '../manager/league';
import { HOUSE_STYLES, SQUAD_SIZE, type HouseStyle, type SquadKnight } from '../manager/types';

/** 0 Village League, 1 Shire League, 2 Great Houses. */
export type Division = 0 | 1 | 2;
export const DIVISIONS: readonly Division[] = [0, 1, 2];
export const TOP_DIVISION: Division = 2;
export const DIVISION_NAMES: Readonly<Record<Division, string>> = {
  0: 'Village League',
  1: 'Shire League',
  2: 'Great Houses',
};

// Squire, Knight, Champion, each knight a tier either side a quarter of the time (as rollRivalTiers). The untrained
// forged knight measures 2.3 stars: the best on a Village pitch, level in the Shire, short of the Great Houses, where
// he needs about half his training (stars 3) to hold a place; maxed (stars 4) he leads anywhere.
export const DIVISION_TIER: Readonly<Record<Division, number>> = { 0: 1, 1: 2, 2: 3 };
const TIER_SPREAD = [-1, 0, 0, 1] as const;

/** What the UI draws on a club's shield. */
export type Crest =
  | 'flame'
  | 'crow'
  | 'thorn'
  | 'tower'
  | 'boar'
  | 'moon'
  | 'ox'
  | 'wave'
  | 'oak'
  | 'briar'
  | 'hill'
  | 'heron'
  | 'gate'
  | 'kestrel'
  | 'raven'
  | 'sheaf'
  | 'cobble'
  | 'goose'
  | 'wheel'
  | 'nettle'
  | 'frog'
  | 'sheep'
  | 'turnip'
  | 'hurdle';

export interface Club extends House {
  readonly crest: Crest;
  /** How its manager picks the side and sets tactics, as a Manager mode house. */
  readonly style: HouseStyle;
  /** The division it starts the first season in. */
  readonly startDivision: Division;
}

const HOUSE_CRESTS: Readonly<Record<string, Crest>> = {
  ember: 'flame',
  corvane: 'crow',
  thorn: 'thorn',
  grey: 'tower',
  mud: 'boar',
  hollow: 'moon',
  ox: 'ox',
  salt: 'wave',
};

const clubStyle = (
  draft: HouseStyle['draft'],
  press: 'low' | 'mid' | 'high',
  shooting: 'patient' | 'normal' | 'early',
) => ({ draft, tactics: { press, shooting } }) as const;

const greatHouses: Club[] = REALM_HOUSES.map((house) => {
  const houseStyle = HOUSE_STYLES[house.id];
  const crest = HOUSE_CRESTS[house.id];
  if (!houseStyle || !crest) throw new Error(`House ${house.id} has no style or crest`);
  return { ...house, crest, style: houseStyle, startDivision: 2 };
});

/** The realm's eight houses, then the shires, then the villages. New clubs go at the end: casting runs in this
 * order, so appending one never changes a face already cast. */
export const CLUBS: readonly Club[] = [
  ...greatHouses,
  {
    id: 'ashby',
    name: 'Ashby Vale',
    colour: '#7d8a2e',
    crest: 'oak',
    style: clubStyle('balanced', 'mid', 'normal'),
    startDivision: 1,
  },
  {
    id: 'briar',
    name: 'Briarwood',
    colour: '#8e2f4f',
    crest: 'briar',
    style: clubStyle('depth', 'high', 'normal'),
    startDivision: 1,
  },
  {
    id: 'dun',
    name: 'Dunmore',
    colour: '#5b6770',
    crest: 'hill',
    style: clubStyle('stars', 'low', 'patient'),
    startDivision: 1,
  },
  {
    id: 'fen',
    name: 'Fenwick',
    colour: '#3c7d6b',
    crest: 'heron',
    style: clubStyle('balanced', 'low', 'normal'),
    startDivision: 1,
  },
  {
    id: 'harrow',
    name: 'Harrowgate',
    colour: '#b5462f',
    crest: 'gate',
    style: clubStyle('stars', 'high', 'early'),
    startDivision: 1,
  },
  {
    id: 'kestrel',
    name: 'Kestrel Hill',
    colour: '#c08a2d',
    crest: 'kestrel',
    style: clubStyle('depth', 'mid', 'early'),
    startDivision: 1,
  },
  {
    id: 'raven',
    name: 'Ravenholt',
    colour: '#2c2c3a',
    crest: 'raven',
    style: clubStyle('balanced', 'high', 'patient'),
    startDivision: 1,
  },
  {
    id: 'wold',
    name: 'Wolds End',
    colour: '#a99a4e',
    crest: 'sheaf',
    style: clubStyle('depth', 'low', 'patient'),
    startDivision: 1,
  },
  {
    id: 'cobble',
    name: 'Cobblestead',
    colour: '#7a6a5a',
    crest: 'cobble',
    style: clubStyle('balanced', 'mid', 'patient'),
    startDivision: 0,
  },
  {
    id: 'goose',
    name: 'Goosefair',
    colour: '#e0b13a',
    crest: 'goose',
    style: clubStyle('stars', 'high', 'early'),
    startDivision: 0,
  },
  {
    id: 'mill',
    name: 'Millbrook',
    colour: '#4f7fa8',
    crest: 'wheel',
    style: clubStyle('depth', 'mid', 'normal'),
    startDivision: 0,
  },
  {
    id: 'nettle',
    name: 'Nettlebed',
    colour: '#5f9a3a',
    crest: 'nettle',
    style: clubStyle('balanced', 'high', 'normal'),
    startDivision: 0,
  },
  {
    id: 'puddle',
    name: 'Puddlecombe',
    colour: '#6f8f99',
    crest: 'frog',
    style: clubStyle('depth', 'low', 'early'),
    startDivision: 0,
  },
  {
    id: 'sheep',
    name: 'Sheepwash',
    colour: '#c9c2b0',
    crest: 'sheep',
    style: clubStyle('stars', 'mid', 'patient'),
    startDivision: 0,
  },
  {
    id: 'turnip',
    name: 'Turnipford',
    colour: '#9b4fa0',
    crest: 'turnip',
    style: clubStyle('balanced', 'low', 'early'),
    startDivision: 0,
  },
  {
    id: 'wattle',
    name: 'Wattlewick',
    colour: '#a0703f',
    crest: 'hurdle',
    style: clubStyle('depth', 'high', 'patient'),
    startDivision: 0,
  },
];

export const CLUB_IDS: readonly string[] = CLUBS.map((c) => c.id);

export function clubById(id: string): Club {
  const club = CLUBS.find((c) => c.id === id);
  if (!club) throw new Error(`No club ${id}`);
  return club;
}

/** A knight of a career club: a Manager mode squad knight who also ages. */
export interface CareerKnight extends SquadKnight {
  readonly age: number;
}

/** Who plays where: the clubs of each division, and every club's six knights. */
export interface World {
  /** Club ids per division, Village League first; eight each. */
  readonly divisions: readonly (readonly string[])[];
  readonly squads: Readonly<Record<string, readonly CareerKnight[]>>;
  /** The number the next knight to join the realm takes in his id, `k<n>`. */
  readonly nextKnight: number;
}

/** Bot knights' ages: cast between these, recruited young, and gone by the last. */
export const YOUNGEST = 18;
export const CAST_OLDEST = 32;
export const RECRUIT_OLDEST = 23;

// Bynames and first names for knights who join the career's clubs; the realm's own names stay with the houses.
const FIRST_NAMES = [
  'Ser Ade',
  'Ser Bran',
  'Ser Cole',
  'Ser Dag',
  'Ser Ebb',
  'Ser Fitz',
  'Ser Gil',
  'Ser Hal',
  'Ser Ivo',
  'Ser Jem',
  'Ser Kit',
  'Ser Lot',
  'Ser Ned',
  'Ser Odo',
  'Ser Rab',
  'Ser Sim',
  'Ser Tam',
  'Ser Wyn',
  'Ada',
  'Bea',
  'Cis',
  'Dot',
  'Eda',
  'Fay',
  'Gwen',
  'Hes',
  'Ida',
  'Jill',
  'Kat',
  'Lil',
  'Meg',
  'Nan',
  'Pru',
  'Ros',
  'Sal',
  'Tess',
  'Ulla',
  'Win',
  'Abel',
  'Bart',
  'Cuth',
  'Dick',
  'Ewan',
  'Finn',
  'Gus',
  'Huw',
  'Jack',
  'Lew',
  'Mog',
  'Noll',
  'Piers',
  'Rolf',
  'Stig',
  'Tom',
  'Wat',
] as const;
const BYNAMES = [
  'Ash',
  'Bell',
  'Brook',
  'Cole',
  'Crow',
  'Dale',
  'Dyke',
  'Fell',
  'Ford',
  'Frost',
  'Gale',
  'Hale',
  'Hay',
  'Holt',
  'Kemp',
  'Lark',
  'Marsh',
  'Moss',
  'Nash',
  'Oaks',
  'Pike',
  'Reed',
  'Rook',
  'Shaw',
  'Stone',
  'Thorpe',
  'Vane',
  'Ward',
  'Wick',
  'Wren',
  'Yew',
  'Bracken',
  'Cobb',
  'Dunn',
  'Fenn',
  'Gorse',
  'Heath',
  'Lowe',
  'Mead',
  'Penn',
] as const;

/** Every name a career knight can take, in a fixed order; the realm's catalogue names are left to the houses. */
export const CAREER_NAMES: readonly string[] = FIRST_NAMES.flatMap((first) =>
  BYNAMES.map((by) => `${first} ${by}`),
).filter((name) => name.length <= NAME_MAX_LENGTH && !(KNIGHT_NAMES as readonly string[]).includes(name));

/** Changing this recasts every career club. */
const CAREER_REALM_SEED = 1215;

/** A tier around the division's, as rollRivalTiers rolls a rival around its mean. */
export const recruitTier = (division: Division, rng: Rng): number =>
  clamp(DIVISION_TIER[division] + rng.pick(TIER_SPREAD), 0, TOP_TIER);

/** A name no knight in `taken` has, drawn from CAREER_NAMES. */
export function freshName(rng: Rng, taken: ReadonlySet<string>): string {
  const free = CAREER_NAMES.filter((n) => !taken.has(n));
  if (free.length === 0) throw new Error('No names left for the career');
  return rng.pick(free);
}

/** A helmet none of `squad` wears, while one is left; helmets are unique within a club as in the realm. */
export function freshHelmet(rng: Rng, squad: readonly SquadKnight[]): number {
  const free = HELMETS.map((_, i) => i).filter((i) => !squad.some((k) => k.look.helmet === i));
  return free.length ? rng.pick(free) : rng.int(HELMETS.length);
}

/** The first season's realm, the same in every career: each house keeps its four roster faces and gains two, the
 * shires and villages are cast whole, tiers and ages drawn in the same pass, club by club in CLUBS order. */
function castWorld(): World {
  const rng = createRng(CAREER_REALM_SEED);
  const taken = new Set<string>(REALM_HOUSES.flatMap((h) => Object.values(roster(h)).map((l) => l.name)));
  let next = 0;
  const squads: Record<string, CareerKnight[]> = {};
  for (const club of CLUBS) {
    const house = REALM_HOUSES.find((h) => h.id === club.id);
    const squad: CareerKnight[] = [];
    const rostered = house ? Object.values(roster(house)) : [];
    for (let i = 0; i < SQUAD_SIZE; i++) {
      const cast = rostered[i];
      const name = cast?.name ?? freshName(rng, taken);
      taken.add(name);
      const look = cast ?? randomLook(rng, name, freshHelmet(rng, squad));
      const tier = recruitTier(club.startDivision, rng);
      const age = YOUNGEST + rng.int(CAST_OLDEST - YOUNGEST + 1);
      squad.push({ id: `k${next++}`, look, tier, forged: false, age });
    }
    squads[club.id] = squad;
  }
  const divisions = DIVISIONS.map((d) => CLUBS.filter((c) => c.startDivision === d).map((c) => c.id));
  if (!divisions.every((clubs) => clubs.length === LEAGUE_SIZE))
    throw new Error('Each division needs eight clubs');
  return { divisions, squads, nextKnight: next };
}

let firstWorld: World | null = null;

/** The realm as every career finds it in its first season. */
export function startingWorld(): World {
  firstWorld ??= castWorld();
  return firstWorld;
}

/** The division a club plays in this season. */
export function divisionOf(world: World, club: string): Division {
  const d = world.divisions.findIndex((clubs) => clubs.includes(club));
  if (d < 0 || d > TOP_DIVISION) throw new Error(`${club} plays in no division`);
  return d as Division;
}

export function squadOfClub(world: World, club: string): readonly CareerKnight[] {
  const squad = world.squads[club];
  if (!squad) throw new Error(`${club} has no squad`);
  return squad;
}

/** A club's strength as a starting four: the mean tier of its best four knights. */
export function clubLevel(world: World, club: string): number {
  const tiers = squadOfClub(world, club)
    .map((k) => k.tier)
    .sort((a, b) => b - a)
    .slice(0, 4);
  return tiers.reduce((s, t) => s + t, 0) / tiers.length;
}
