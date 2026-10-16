import { ROLES_BY_SIZE } from '../../game/formation';
import type { KnightSpec } from '../../game/match';
import { createRng } from '../../game/rng';
import type { Role } from '../../game/types';
import { KNIGHT_NAMES } from '../../knight/catalog';
import { encodeLook, normalizeLook, randomLook, type Look } from '../../knight/look';
import { REALM_HOUSES } from '../../setup/houses';
import { roster } from '../../setup/rosters';
import { withTier } from '../../setup/squads';
import { HOUSE_STYLES, SQUAD_SIZE, STARTERS, type HouseStyle, type SquadKnight } from './types';

export type DraftStyle = HouseStyle['draft'];

/**
 * Points a knight costs by level, tuned with the draft sim (see the value model below). A refit on 16000
 * matches puts a Knight only 0.07 ± 0.04 goals above a Squire, so it costs one point more, not two.
 */
export const PEASANT_COST = 1;
export const SQUIRE_COST = 2;
export const KNIGHT_COST = 3;
export const CHAMPION_COST = 6;
export const LEGEND_COST = 11;
export const TIER_COST: readonly number[] = [
  PEASANT_COST,
  SQUIRE_COST,
  KNIGHT_COST,
  CHAMPION_COST,
  LEGEND_COST,
];
/** Points each house has for its whole squad: exactly two Legends and four Peasants, the boldest squad allowed. */
export const BUDGET = 2 * LEGEND_COST + (SQUAD_SIZE - 2) * PEASANT_COST;
export const DRAFT_HOUSES: readonly string[] = REALM_HOUSES.map((h) => h.id);
export const TOTAL_PICKS = DRAFT_HOUSES.length * SQUAD_SIZE;
export const FORGED_ID = 'forged';
export const FORGED_TIER = 2;

/**
 * How many of the 80 knights (besides the forged one) land on each tier, Peasant to Legend. Twelve Legends
 * and sixteen Champions let every house reach for the top; the sim leaves some of every tier undrafted.
 */
export const POOL_TIERS: readonly number[] = [16, 22, 12, 18, 12];

const ROSTER_ROLES = ROLES_BY_SIZE[4];
const ROSTER_SIZE = REALM_HOUSES.length * ROSTER_ROLES.length;
const GENERATED = POOL_TIERS.reduce((sum, n) => sum + n, 0) - ROSTER_SIZE;
const POOL_STREAM = 1;
const ORDER_STREAM = 2;

/** Names for the knights who join the realm for the draft; the roster already uses most of the catalogue. */
const PROSPECT_NAMES = [
  'Ser Aldous',
  'Lady Isolde',
  'Ser Bertram',
  'Odo the Bold',
  'Ser Cedric',
  'Wynn Halfhand',
  'Ser Dunstan',
  'Maud Underhill',
  'Ser Everard',
  'Ffion',
  'Ser Garnier',
  'Hugh Longstep',
  'Ser Ingram',
  'Joan of Lea',
  'Ser Lambert',
  'Mildred',
  'Ser Neville',
  'Orla Fenwick',
  'Ser Percival',
  'Quenby',
  'Ser Reynard',
  'Sibyl',
  'Ser Tancred',
  'Ulric',
  'Ser Yvain',
  'Willa Thatch',
  'Brother Cuth',
  'Old Gammer',
  'Ser Lionel',
  'Edith Stout',
  'Ser Hector',
  'Rhosyn',
  'Ser Aymer',
  'Lady Beatrix',
  'Ser Clement',
  'Dulcie Marsh',
  'Ser Eustace',
  'Fenna',
  'Ser Geoffrey',
  'Hawise',
  'Ser Humphrey',
  'Idony',
  'Ser Jocelyn',
  'Kenric',
  'Ser Leofric',
  'Lady Melisende',
  'Ser Nigel',
  'Osanna',
  'Ser Piers',
  'Rohese',
  'Ser Simund',
  'Tib Crookleg',
  'Ser Turold',
  'Ulfa',
  'Ser Walter',
  'Wymarc',
  'Brother Silas',
  'Goody Pruett',
  'Ser Amis',
  'Lady Constance',
  'Hamund Reed',
  'Ser Gilbert',
  'Elfleda',
  'Ser Roland',
  'Agatha Hale',
  'Ser Brice',
  'Nell Cooper',
  'Ser Drogo',
] as const;

export interface DraftState {
  readonly seed: number;
  readonly playerHouse: string;
  /** The player's knight as forged when the season began. */
  readonly forged: Look;
  /** Houses in first-round order; the snake runs forwards in even rounds and backwards in odd ones. */
  readonly order: readonly string[];
  /** Knight ids in pick order; who made each pick follows from `order`. */
  readonly picks: readonly string[];
}

/** An independent random stream per use of the season seed, so changing one never reshuffles another. */
const streamSeed = (seed: number, stream: number): number =>
  (Math.imul(seed ^ 0x9e3779b9, 31) + stream * 0x85ebca6b) >>> 0;

/**
 * The season's pool: the forged knight first, then every house's roster knight (same faces as
 * everywhere else), then knights generated for this season. Tiers are dealt from POOL_TIERS.
 */
export function draftPool(seed: number, forged: Look): readonly SquadKnight[] {
  const rostered = REALM_HOUSES.flatMap((house) => {
    const knights = roster(house);
    return ROSTER_ROLES.map((role) => ({ id: `roster:${house.id}:${role}`, look: knights[role] }));
  });
  const rng = createRng(streamSeed(seed, POOL_STREAM));
  const taken = new Set([forged.name, ...rostered.map((k) => k.look.name)]);
  const names = rng.shuffle([...KNIGHT_NAMES, ...PROSPECT_NAMES].filter((name) => !taken.has(name)));
  if (names.length < GENERATED) throw new Error('Not enough names for the draft pool');
  const generated = names
    .slice(0, GENERATED)
    .map((name, i) => ({ id: `gen:${i}`, look: randomLook(rng, name) }));
  const tiers = rng.shuffle(POOL_TIERS.flatMap((count, tier) => Array.from({ length: count }, () => tier)));
  return [
    { id: FORGED_ID, look: forged, tier: FORGED_TIER, forged: true },
    ...[...rostered, ...generated].map((k, i) => ({ ...k, tier: tiers[i] ?? 0, forged: false })),
  ];
}

export function startDraft(seed: number, playerHouse: string, forged: Look): DraftState {
  if (!DRAFT_HOUSES.includes(playerHouse)) throw new Error(`Unknown house ${playerHouse}`);
  const order = createRng(streamSeed(seed, ORDER_STREAM)).shuffle(DRAFT_HOUSES);
  return { seed, playerHouse, forged, order, picks: [] };
}

/** The house making pick number `pick` (from 0), or null once the draft is over. */
export function houseForPick(order: readonly string[], pick: number): string | null {
  if (pick < 0 || pick >= order.length * SQUAD_SIZE) return null;
  const slot = pick % order.length;
  const forwards = Math.floor(pick / order.length) % 2 === 0;
  return order[forwards ? slot : order.length - 1 - slot] ?? null;
}

export const houseOnTheClock = (draft: DraftState): string | null =>
  houseForPick(draft.order, draft.picks.length);

export const isDraftComplete = (draft: DraftState): boolean => draft.picks.length >= TOTAL_PICKS;

export const tierCost = (tier: number): number => TIER_COST[tier] ?? Infinity;

/** A season's pool, kept for the last seed and forged knight asked about: every check needs it. */
let cachedPool: { readonly key: string; readonly pool: readonly SquadKnight[] } | null = null;

function poolOf(draft: DraftState): readonly SquadKnight[] {
  const key = `${draft.seed}|${encodeLook(draft.forged)}`;
  if (cachedPool?.key !== key) cachedPool = { key, pool: draftPool(draft.seed, draft.forged) };
  return cachedPool.pool;
}

/** What a house still has to do: picks to make and points to make them with. */
interface Need {
  readonly picks: number;
  readonly budget: number;
}

/** Everything the rules ask of a draft, worked out once per question. */
interface Board {
  readonly available: readonly SquadKnight[];
  readonly squads: ReadonlyMap<string, readonly SquadKnight[]>;
  /** Knights available per tier. Knights of a tier cost the same, so the reserve rule only needs counts. */
  readonly counts: readonly number[];
}

function boardOf(draft: DraftState): Board {
  const pool = poolOf(draft);
  const byId = new Map(pool.map((k) => [k.id, k]));
  const squads = new Map<string, SquadKnight[]>(draft.order.map((h) => [h, []]));
  draft.picks.forEach((id, pick) => {
    const knight = byId.get(id);
    const house = houseForPick(draft.order, pick);
    if (knight && house !== null) squads.get(house)?.push(knight);
  });
  const picked = new Set(draft.picks);
  const available = pool.filter((k) => !picked.has(k.id));
  return { available, squads, counts: TIER_COST.map((_, t) => available.filter((k) => k.tier === t).length) };
}

const spent = (squad: readonly SquadKnight[]): number => squad.reduce((sum, k) => sum + tierCost(k.tier), 0);

const needOf = (board: Board, house: string): Need => {
  const squad = board.squads.get(house) ?? [];
  return { picks: SQUAD_SIZE - squad.length, budget: BUDGET - spent(squad) };
};

/** The knights still to be drafted, in pool order. */
export const availableKnights = (draft: DraftState): SquadKnight[] => [...boardOf(draft).available];

/** A house's picks so far, in the order it made them. */
export const squadOf = (draft: DraftState, house: string): SquadKnight[] => [
  ...(boardOf(draft).squads.get(house) ?? []),
];

export const budgetLeft = (draft: DraftState, house: string): number => BUDGET - spent(squadOf(draft, house));

/** The cheapest total for `picks` knights from `counts`, or Infinity if there are not enough. */
function cheapestTotal(counts: readonly number[], picks: number): number {
  let left = picks;
  let total = 0;
  counts.forEach((count, tier) => {
    const take = Math.min(count, left);
    total += take * tierCost(tier);
    left -= take;
  });
  return left > 0 ? Infinity : total;
}

/**
 * Calls `visit` with every way to take exactly `picks` knights from `counts` for at most `budget`
 * points (as counts per tier), stopping as soon as `visit` returns true.
 */
function someCombo(
  counts: readonly number[],
  picks: number,
  budget: number,
  visit: (take: readonly number[]) => boolean,
): boolean {
  const take = counts.map(() => 0);
  const walk = (tier: number, left: number, points: number): boolean => {
    if (left === 0) return visit(take);
    if (tier >= counts.length) return false;
    const cost = tierCost(tier);
    for (let n = Math.min(left, counts[tier] ?? 0); n >= 0; n--) {
      if (points < n * cost) continue;
      take[tier] = n;
      if (walk(tier + 1, left - n, points - n * cost)) return true;
    }
    take[tier] = 0;
    return false;
  };
  return walk(0, picks, budget);
}

/**
 * Whether every house can still complete its squad within budget at the same time. Only the
 * cheapest knights matter (swapping any knight for a cheaper unused one keeps a plan affordable),
 * so this searches ways to share those out, tightest house first, remembering dead ends.
 */
function everyoneCanComplete(counts: readonly number[], needs: readonly Need[]): boolean {
  const open = needs.filter((n) => n.picks > 0).sort((a, b) => a.budget / a.picks - b.budget / b.picks);
  let wanted = open.reduce((sum, n) => sum + n.picks, 0);
  const cheapest = counts.map((count) => {
    const take = Math.min(count, wanted);
    wanted -= take;
    return take;
  });
  if (wanted > 0) return false;
  const deadEnds = new Set<string>();
  const share = (house: number, left: readonly number[]): boolean => {
    const need = open[house];
    if (!need) return true;
    const key = `${house}:${left.join()}`;
    if (deadEnds.has(key)) return false;
    const ok = someCombo(left, need.picks, need.budget, (take) =>
      share(
        house + 1,
        left.map((n, tier) => n - (take[tier] ?? 0)),
      ),
    );
    if (!ok) deadEnds.add(key);
    return ok;
  };
  return share(0, cheapest);
}

export type PickProblem =
  'complete' | 'out-of-turn' | 'unknown' | 'taken' | 'over-budget' | 'own-reserve' | 'rival-reserve';

export type PickCheck = { readonly ok: true } | { readonly ok: false; readonly problem: PickProblem };

/** What the draft board says when a pick is refused. */
export const PICK_PROBLEMS: Readonly<Record<PickProblem, string>> = {
  complete: 'The draft is over.',
  'out-of-turn': 'It is another house’s pick.',
  unknown: 'That knight is not in this draft.',
  taken: 'That knight has already been drafted.',
  'over-budget': 'Not enough points left for that knight.',
  'own-reserve': 'That would leave too few points to fill your squad.',
  'rival-reserve': 'That would leave another house unable to fill its squad.',
};

/**
 * Whether `house` may draft `knightId` now. The reserve rule: after paying, this house and every
 * other house must still be able to fill their squads together from what is left, so none gets stuck.
 */
export function checkPick(draft: DraftState, house: string, knightId: string): PickCheck {
  const onTheClock = houseOnTheClock(draft);
  if (onTheClock === null) return { ok: false, problem: 'complete' };
  if (house !== onTheClock) return { ok: false, problem: 'out-of-turn' };
  const knight = poolOf(draft).find((k) => k.id === knightId);
  if (!knight) return { ok: false, problem: 'unknown' };
  if (draft.picks.includes(knightId)) return { ok: false, problem: 'taken' };
  const problem = tierProblem(boardOf(draft), house, knight.tier);
  return problem ? { ok: false, problem } : { ok: true };
}

/** The budget and reserve checks, which depend only on the knight's tier. */
function tierProblem(board: Board, house: string, tier: number): PickProblem | null {
  const need = needOf(board, house);
  const left = need.budget - tierCost(tier);
  if (left < 0) return 'over-budget';
  const after = board.counts.map((n, t) => (t === tier ? n - 1 : n));
  if (cheapestTotal(after, need.picks - 1) > left) return 'own-reserve';
  const needs = [...board.squads.keys()].map((h) =>
    h === house ? { picks: need.picks - 1, budget: left } : needOf(board, h),
  );
  return everyoneCanComplete(after, needs) ? null : 'rival-reserve';
}

const legalOn = (board: Board, house: string): SquadKnight[] => {
  const legalTiers = TIER_COST.map((_, tier) => tierProblem(board, house, tier) === null);
  return board.available.filter((k) => legalTiers[k.tier]);
};

/** Every knight the house on the clock may draft now, in pool order. */
export function legalPicks(draft: DraftState): SquadKnight[] {
  const house = houseOnTheClock(draft);
  return house === null ? [] : legalOn(boardOf(draft), house);
}

/** The draft after `house` picks `knightId`; throws for an illegal or out-of-turn pick. */
export function applyPick(draft: DraftState, house: string, knightId: string): DraftState {
  const check = checkPick(draft, house, knightId);
  if (!check.ok) throw new Error(PICK_PROBLEMS[check.problem]);
  return { ...draft, picks: [...draft.picks, knightId] };
}

// Value model ---------------------------------------------------------------------------------
// Checked in scripts/draft.sim.ts (bench rotated as in a league, 120 drafts, ± 2 SE): managed drafts beat
// random legal drafts 62.2% ± 2.0%; balanced v depth 51.5% ± 3.1%, balanced v stars 46.2% ± 3.0%,
// depth v stars 49.0% ± 3.2%. Undrafted per draft, Peasant to Legend: 6.5 8.9 7.8 4.4 5.5 of 16 22 12 18 12.
// With the knights measured one at a time instead, Squires looked 0.3 worse.

/**
 * Goal difference per match against an all-Knight side, fitted on 8000 matches between random line-ups
 * ('draft values' in scripts/draft.sim.ts, about ±0.06 at 1 SE), so worth is measured in mixed squads.
 */
export const OUTFIELD_TIER_VALUE: readonly number[] = [-0.71, -0.03, 0, 0.65, 1];
/** Each tier of spread between the best and worst outfield starter: one star lifts those around them. */
export const SPREAD_VALUE = 0.13;
/** No keeper tier or build fitted clearly away from zero, so none is credited and the keeper is free. */
export const KEEPER_TIER_VALUE: readonly number[] = [0, 0, 0, 0, 0];
export const KEEPER_BUILD_VALUE: readonly number[] = [0, 0, 0];
/** Outfield builds (Nimble, Standard, Hefty) against Standard. */
export const OUTFIELD_BUILD_VALUE: readonly number[] = [0.09, 0, -0.11];

/**
 * How much a bench knight counts against a starter. The plan's stamina target has starters start about
 * 10 of 14 matches, leaving the two on the bench 8 each: 8 / 10 = 0.8.
 */
export const BENCH_WEIGHT = 0.8;

/**
 * Each style's belief in top tiers, as the curvature of value above a Peasant: stars (convex) pay up for
 * Legends, depth (concave) spreads points over mid tiers, balanced trusts the measured values.
 */
export const STYLE_CURVE: Readonly<Record<DraftStyle, number>> = { stars: 2, balanced: 1, depth: 0.5 };

/** A knight for valuing a squad; `build` is null for a future pick whose build is not known yet. */
interface Prospect {
  readonly tier: number;
  readonly build: number | null;
}

const prospect = (k: SquadKnight): Prospect => ({ tier: k.tier, build: k.look.build });

interface Valuer {
  readonly keeper: (k: Prospect) => number;
  readonly outfield: (k: Prospect) => number;
}

/** Tier values bent by a style's curve, keeping Peasant and Legend where they were measured. */
function valuer(style: DraftStyle): Valuer {
  const bend = (values: readonly number[]): number[] => {
    const low = values[0] ?? 0;
    const span = (values[values.length - 1] ?? 0) - low;
    return values.map((v) => (span === 0 ? v : low + span * ((v - low) / span) ** STYLE_CURVE[style]));
  };
  const outfield = bend(OUTFIELD_TIER_VALUE);
  const keeper = bend(KEEPER_TIER_VALUE);
  const build = (table: readonly number[], k: Prospect): number =>
    k.build === null ? 0 : (table[k.build] ?? 0);
  return {
    keeper: (k) => (keeper[k.tier] ?? 0) + build(KEEPER_BUILD_VALUE, k),
    outfield: (k) => (outfield[k.tier] ?? 0) + build(OUTFIELD_BUILD_VALUE, k),
  };
}

/** The best keeper for a squad and the squad's worth with them in goal and the best three outfield starting. */
function bestShape(squad: readonly Prospect[], value: Valuer): { keeper: number; value: number } {
  let best = { keeper: -1, value: -Infinity };
  squad.forEach((keeper, k) => {
    const outfield = squad
      .filter((_, i) => i !== k)
      .map((p) => ({ tier: p.tier, worth: value.outfield(p) }))
      .sort((a, b) => b.worth - a.worth);
    const starting = outfield.slice(0, STARTERS - 1).map((p) => p.tier);
    const spread = starting.length > 0 ? Math.max(...starting) - Math.min(...starting) : 0;
    const total = outfield.reduce(
      (sum, p, i) => sum + (i < STARTERS - 1 ? p.worth : BENCH_WEIGHT * p.worth),
      value.keeper(keeper) + SPREAD_VALUE * spread,
    );
    if (total > best.value) best = { keeper: k, value: total };
  });
  return best;
}

/** A squad's worth by the value model, in goals per match against an all-Knight side (bench weighted). */
export const squadValue = (squad: readonly SquadKnight[], style: DraftStyle = 'balanced'): number =>
  bestShape(squad.map(prospect), valuer(style)).value;

/**
 * Tier counts this house can expect at each of its later turns if every rival takes the best tier it
 * can afford while keeping enough to fill its squad: a simple, pessimistic model of who takes what.
 */
function forecast(draft: DraftState, board: Board, house: string, counts: readonly number[]): number[][] {
  const left = [...counts];
  const needs = new Map([...board.squads.keys()].map((h) => [h, { ...needOf(board, h) }]));
  const turns = (needs.get(house)?.picks ?? 0) - 1;
  const snapshots: number[][] = [];
  for (let pick = draft.picks.length + 1; pick < TOTAL_PICKS && snapshots.length < turns; pick++) {
    const picker = houseForPick(draft.order, pick);
    if (picker === house) {
      snapshots.push([...left]);
      continue;
    }
    const need = picker === null ? undefined : needs.get(picker);
    if (!need || need.picks === 0) continue;
    for (let tier = left.length - 1; tier >= 0; tier--) {
      if ((left[tier] ?? 0) === 0) continue;
      const after = left.map((n, t) => (t === tier ? n - 1 : n));
      if (tierCost(tier) + cheapestTotal(after, need.picks - 1) > need.budget) continue;
      left[tier] = after[tier] ?? 0;
      need.picks--;
      need.budget -= tierCost(tier);
      break;
    }
  }
  return snapshots;
}

/** Whether a plan (tiers, best first) fits the forecast: its i-th knight must still be there at turn i. */
const fitsForecast = (plan: readonly number[], snapshots: readonly (readonly number[])[]): boolean =>
  plan.every((tier, i) => (snapshots[i]?.[tier] ?? 0) > plan.slice(0, i).filter((t) => t === tier).length);

/** The best value of `squad` completed by `picks` future knights for at most `budget` points, or -Infinity. */
function bestCompletion(
  squad: readonly Prospect[],
  counts: readonly number[],
  picks: number,
  budget: number,
  snapshots: readonly (readonly number[])[] | null,
  value: Valuer,
): number {
  let best = -Infinity;
  someCombo(counts, picks, budget, (take) => {
    const plan = take.flatMap((n, tier) => Array.from({ length: n }, () => tier)).reverse();
    if (snapshots && !fitsForecast(plan, snapshots)) return false;
    const future = plan.map((tier) => ({ tier, build: null }));
    best = Math.max(best, bestShape([...squad, ...future], value).value);
    return false;
  });
  return best;
}

/**
 * The pick a house's manager makes, also behind the player's Auto-pick. For each legal kind of knight
 * (tier and build) it plans the best affordable rest of the squad from what the forecast leaves at its
 * later turns, and takes the kind whose plan is worth most; the first such knight in pool order.
 */
export function chooseDraftPick(draft: DraftState, style?: DraftStyle): string {
  const house = houseOnTheClock(draft);
  if (house === null) throw new Error('The draft is over');
  const value = valuer(style ?? styleOf(draft, house));
  const board = boardOf(draft);
  const squad = (board.squads.get(house) ?? []).map(prospect);
  const need = needOf(board, house);
  const kinds = new Map<string, SquadKnight>();
  for (const k of legalOn(board, house)) {
    const kind = `${k.tier}:${k.look.build}`;
    if (!kinds.has(kind)) kinds.set(kind, k);
  }

  const worth = (k: SquadKnight, useForecast: boolean): number => {
    const after = board.counts.map((n, t) => (t === k.tier ? n - 1 : n));
    const snapshots = useForecast ? forecast(draft, board, house, after) : null;
    const budget = need.budget - tierCost(k.tier);
    return bestCompletion([...squad, prospect(k)], after, need.picks - 1, budget, snapshots, value);
  };
  const best = (useForecast: boolean): SquadKnight | null => {
    let top: { knight: SquadKnight; value: number } | null = null;
    for (const knight of kinds.values()) {
      const v = worth(knight, useForecast);
      if (v === -Infinity) continue;
      // Equal plans: secure the higher tier now, as it is the one rivals take first.
      if (!top || v > top.value + 1e-9 || (v > top.value - 1e-9 && knight.tier > top.knight.tier))
        top = { knight, value: v };
    }
    return top?.knight ?? null;
  };
  // The forecast is pessimistic; if it leaves no plan at all, plan from the knights left now.
  const choice = best(true) ?? best(false);
  if (!choice) throw new Error('No legal pick');
  return choice.id;
}

/** Rival houses draft by their style; the player's own house drafts balanced when auto-picking. */
const styleOf = (draft: DraftState, house: string): DraftStyle =>
  house === draft.playerHouse ? 'balanced' : (HOUSE_STYLES[house]?.draft ?? 'balanced');

/** Plays rival picks until it is the player's turn or the draft is over. */
export function runRivalPicks(draft: DraftState): DraftState {
  let state = draft;
  for (let house = houseOnTheClock(state); house !== null && house !== state.playerHouse;) {
    state = applyPick(state, house, chooseDraftPick(state));
    house = houseOnTheClock(state);
  }
  return state;
}

/** The player's Auto-pick button. */
export function autoPick(draft: DraftState): DraftState {
  return applyPick(draft, draft.playerHouse, chooseDraftPick(draft, 'balanced'));
}

// Line-ups and saves --------------------------------------------------------------------------

/** Tier and build measured alike in every outfield role, so the best outfield knight simply leads. */
const OUTFIELD_ROLES: readonly Role[] = ['def', 'mid', 'fwd'];

export const toSpec = (knight: SquadKnight, role: Role): KnightSpec =>
  withTier({ look: knight.look, role, human: false, tier: knight.tier, speedFactor: 1 }, knight.tier);

export interface Lineup {
  /** Keeper, defender, midfielder and forward, in that order. */
  readonly starters: readonly KnightSpec[];
  readonly bench: readonly SquadKnight[];
}

/** A sensible starting four by the measured values: the keeper who costs the outfield least, then the best three. */
export function defaultLineup(squad: readonly SquadKnight[]): Lineup {
  if (squad.length < STARTERS) throw new Error('A line-up needs four knights');
  const value = valuer('balanced');
  const { keeper } = bestShape(squad.map(prospect), value);
  const gk = squad[keeper];
  if (!gk) throw new Error('No keeper');
  const outfield = squad
    .filter((_, i) => i !== keeper)
    .map((k, i) => ({ k, i, v: value.outfield(prospect(k)) }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map(({ k }) => k);
  const starters = OUTFIELD_ROLES.map((role, i) => {
    const k = outfield[i];
    if (!k) throw new Error('A line-up needs four knights');
    return toSpec(k, role);
  });
  return { starters: [toSpec(gk, 'gk'), ...starters], bench: outfield.slice(OUTFIELD_ROLES.length) };
}

/** Reads a saved draft, or null for anything malformed or for any pick that was not legal in turn. */
export function normalizeDraft(raw: unknown): DraftState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { seed, playerHouse, forged, order, picks } = raw as Record<string, unknown>;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed >= 2 ** 32) return null;
  if (typeof playerHouse !== 'string' || !DRAFT_HOUSES.includes(playerHouse)) return null;
  if (typeof forged !== 'object' || forged === null) return null;
  if (!Array.isArray(order) || !Array.isArray(picks) || picks.length > TOTAL_PICKS) return null;
  const houses = order.filter((h): h is string => typeof h === 'string' && DRAFT_HOUSES.includes(h));
  if (houses.length !== order.length || houses.length !== DRAFT_HOUSES.length) return null;
  if (new Set(houses).size !== DRAFT_HOUSES.length) return null;

  let draft: DraftState = { seed, playerHouse, forged: normalizeLook(forged), order: houses, picks: [] };
  // Replaying every pick through checkPick rejects out-of-turn, repeated, unaffordable or stranding picks.
  for (const id of picks as unknown[]) {
    const house = houseOnTheClock(draft);
    if (typeof id !== 'string' || house === null || !checkPick(draft, house, id).ok) return null;
    draft = { ...draft, picks: [...draft.picks, id] };
  }
  return draft;
}
