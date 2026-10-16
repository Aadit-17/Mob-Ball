import { skillFor } from '../../ai/skills';
import type { Tactics } from '../../ai/tactics';
import { MATCH, STEP } from '../../game/constants';
import type { KnightSpec } from '../../game/match';
import type { MatchState, Role, TeamId } from '../../game/types';
import { clamp } from '../../game/vec';
import type { Manager, ManagerAction } from '../runner';
import { SQUAD_SIZE, STARTERS, type HouseStyle, type SquadKnight } from './types';

export const STAMINA_MAX = 100;
/** Tuned (and pinned in the tests) so a knight starting 10 of 14 with a rest every third stays at full
 * strength, 12 always tires him, and 14 straight leaves him near the floor for the run-in. */
export const PLAY_COST = 8;
export const REST_GAIN = 18;
export const FRESH = 70;
/** Speed at stamina 0. scripts/stamina.sim.ts, 600 Knight-tier matches a line: stamina 0 v fresh -0.64
 * ± 0.13 goals, stamina 35 -0.23 ± 0.13; a tier up +1.92 ± 0.15, down -0.64 ± 0.13: about half a tier. */
export const TIRED_FLOOR = 0.96;
/** Stamina 0 in tiers (measured above); line-ups and substitutions weigh tiredness with it. */
export const TIRED_TIER_COST = 0.5;

/** Stamina by squad knight id. */
export type Stamina = Readonly<Record<string, number>>;

export const freshStamina = (squad: readonly SquadKnight[]): Stamina =>
  Object.fromEntries(squad.map((k) => [k.id, STAMINA_MAX]));

const capped = (stamina: number): number => clamp(stamina, 0, STAMINA_MAX);

/** How far below FRESH, from 0 (fresh) to 1 (empty). */
const deficit = (stamina: number): number => Math.max(0, FRESH - capped(stamina)) / FRESH;

/** Multiplies a knight's speed: 1 at or above FRESH, falling in a straight line to TIRED_FLOOR at 0. */
export const staminaFactor = (stamina: number): number => 1 - (1 - TIRED_FLOOR) * deficit(stamina);

/** A squad knight as the match sees him: his tier's speed, slowed by tiredness. Bots play every knight. */
export const squadKnightSpec = (knight: SquadKnight, stamina: number, role: Role): KnightSpec => ({
  look: knight.look,
  role,
  human: false,
  tier: knight.tier,
  speedFactor: skillFor(knight.tier).speed * staminaFactor(stamina),
});

/** Expected strength in tiers, the scale every line-up and substitution choice is made on. */
const strength = (tier: number, stamina: number): number => tier - TIRED_TIER_COST * deficit(stamina);

const tiredCost = (stamina: number): number => TIRED_TIER_COST * deficit(stamina);

/** The one substitution of a match: who went off, who came on, and the simulation step it happened. */
export interface Substitution {
  readonly offId: string;
  readonly onId: string;
  readonly step: number;
}

export interface MatchdayPlay {
  /** The knights who started, by squad id. */
  readonly starters: readonly string[];
  readonly substitution: Substitution | null;
  /** Steps the match lasted (the runner's step at full time), so a sub's minutes are a share of it. */
  readonly matchSteps: number;
}

/** The share of the match gone at `step`. */
export function shareGone(step: number, matchSteps: number): number {
  if (!(matchSteps > 0) || !Number.isInteger(step) || step < 0 || step > matchSteps)
    throw new Error('A substitution must happen within the match');
  return step / matchSteps;
}

/** The share of the match each knight played, by squad id; knights who sat out are not listed. */
export function playingShares(play: MatchdayPlay): ReadonlyMap<string, number> {
  const shares = new Map(play.starters.map((id) => [id, 1]));
  if (shares.size !== STARTERS || play.starters.length !== STARTERS)
    throw new Error(`A line-up needs ${STARTERS} different starters`);
  const sub = play.substitution;
  if (sub) {
    if (!shares.has(sub.offId) || shares.has(sub.onId))
      throw new Error('A substitution takes a starter off for a knight from the bench');
    const gone = shareGone(sub.step, play.matchSteps);
    shares.set(sub.offId, gone);
    shares.set(sub.onId, 1 - gone);
  }
  return shares;
}

/** Everyone who played pays for the minutes they played; everyone else recovers. */
export function afterMatchday(stamina: Stamina, play: MatchdayPlay): Stamina {
  const shares = playingShares(play);
  for (const id of shares.keys()) if (!(id in stamina)) throw new Error(`${id} is not in the squad`);
  return Object.fromEntries(
    Object.entries(stamina).map(([id, s]) => {
      const share = shares.get(id);
      return [id, capped(share === undefined ? s + REST_GAIN : s - PLAY_COST * share)];
    }),
  );
}

export interface Starter {
  readonly knight: SquadKnight;
  readonly role: Role;
}

export interface Lineup {
  /** Keeper, defender, midfielder, forward. */
  readonly starters: readonly Starter[];
  /** Best substitute first. */
  readonly bench: readonly SquadKnight[];
}

/** Stamina spent now is missed in every later match played below FRESH, so it is priced per matchday
 * left. Star houses discount that future and lean on their stars; depth houses don't. */
const LOOKAHEAD: Readonly<Record<HouseStyle['draft'], number>> = { stars: 0.5, balanced: 0.75, depth: 1 };

const futureWeight = (style: HouseStyle, matchdaysLeft: number): number => {
  if (!Number.isInteger(matchdaysLeft) || matchdaysLeft < 1) throw new Error('No matchdays left to play');
  return (matchdaysLeft - 1) * LOOKAHEAD[style.draft];
};

/** Strength now, less what starting costs later compared with resting. */
const startValue = (knight: SquadKnight, stamina: number, weight: number): number =>
  strength(knight.tier, stamina) - weight * (tiredCost(stamina - PLAY_COST) - tiredCost(stamina + REST_GAIN));

const ROLES: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];

/** The heaviest build in goal (a Hefty covers the most of it), then heaviest to lightest up the pitch. */
function assignRoles(starters: readonly SquadKnight[]): Starter[] {
  const byBuild = [...starters].sort(
    (a, b) => b.look.build - a.look.build || b.tier - a.tier || a.id.localeCompare(b.id),
  );
  const keeper = byBuild[0];
  if (!keeper) throw new Error('No starters');
  const outfield = byBuild
    .slice(1)
    .sort((a, b) => b.look.build - a.look.build || a.tier - b.tier || a.id.localeCompare(b.id));
  return [keeper, ...outfield].map((knight, i) => ({ knight, role: ROLES[i] ?? 'mid' }));
}

function staminaOf(stamina: Stamina, id: string): number {
  const s = stamina[id];
  if (s === undefined || !Number.isFinite(s)) throw new Error(`No stamina for ${id}`);
  return s;
}

/** The four worth most once stamina is priced in: each knight's value is independent, so that is the
 * best total. Ties go to the fresher knight, so equal squads rotate themselves. */
export function chooseLineup(
  squad: readonly SquadKnight[],
  stamina: Stamina,
  style: HouseStyle,
  matchdaysLeft: number,
): Lineup {
  if (squad.length !== SQUAD_SIZE || new Set(squad.map((k) => k.id)).size !== SQUAD_SIZE)
    throw new Error(`A squad needs ${SQUAD_SIZE} different knights`);
  const weight = futureWeight(style, matchdaysLeft);
  const ranked = squad
    .map((knight) => ({ knight, s: staminaOf(stamina, knight.id) }))
    .map(({ knight, s }) => ({ knight, s, value: startValue(knight, s, weight) }))
    .sort((a, b) => b.value - a.value || b.s - a.s || a.knight.id.localeCompare(b.knight.id))
    .map((r) => r.knight);
  return { starters: assignRoles(ranked.slice(0, STARTERS)), bench: ranked.slice(STARTERS) };
}

/** All in when chasing the game late: press high, push up, shoot on sight. */
export const CHARGE: Tactics = { press: 'high', shooting: 'early' };
/** Seeing it out: sit deep, press only in our half, keep the ball until the chance is clear. */
export const HOLD: Tactics = { press: 'low', shooting: 'patient' };

/** The second-half point a rival makes his substitution, or half-time when behind. */
export const SUB_AT = 2 / 3;
export const CHASING_SUB_AT = 1 / 2;
/** From here a rival behind charges and one ahead holds. */
export const LATE = 3 / 4;
/** The runner polls managers once a second; the poll count gives the step a sub happened on. */
const POLL_STEPS = Math.round(1 / STEP);

export interface BenchOption {
  readonly spec: KnightSpec;
  readonly stamina: number;
}

export interface RivalSetup {
  readonly style: HouseStyle;
  /** Stamina of the starters in line-up order, as their specs were given to the runner. */
  readonly starters: readonly number[];
  readonly bench: readonly BenchOption[];
  /** Including this one. */
  readonly matchdaysLeft: number;
}

/** The substitution a rival made: line-up slot off, bench slot on, and the step, for afterMatchday. */
export interface RivalSub {
  readonly offSlot: number;
  readonly benchSlot: number;
  readonly step: number;
}

export interface RivalManager {
  /** Give it to the runner from the kick-off, for a side that starts on `style.tactics`. */
  readonly manage: Manager;
  substitution(): RivalSub | null;
}

/** The share of the match gone by the clock, so stoppages never count toward a decision. */
const clockGone = (state: MatchState): number => clamp(1 - state.clock / MATCH.duration, 0, 1);

const leadOf = (state: MatchState, team: TeamId): number =>
  state.score[team] - state.score[team === 0 ? 1 : 0];

/** Late on, behind charges and ahead holds; otherwise the house plays its own way. */
export function rivalTactics(style: HouseStyle, gone: number, lead: number): Tactics {
  if (gone < LATE || lead === 0) return style.tactics;
  return lead < 0 ? CHARGE : HOLD;
}

const sameTactics = (a: Tactics, b: Tactics): boolean => a.press === b.press && a.shooting === b.shooting;

interface OnPitch {
  readonly id: number;
  readonly tier: number;
  readonly stamina: number;
}

/** A substitution's worth in tiers: fresher legs for the rest of the match, plus the stamina the
 * starter saves, less what the bench knight spends instead of resting. */
function subValue(off: OnPitch, on: BenchOption, left: number, weight: number): number {
  const now = left * (strength(on.spec.tier, on.stamina) - strength(off.tier, off.stamina));
  const saved = tiredCost(off.stamina - PLAY_COST) - tiredCost(off.stamina - PLAY_COST * (1 - left));
  const spent = tiredCost(on.stamina - PLAY_COST * left) - tiredCost(on.stamina + REST_GAIN);
  return now + weight * (saved - spent);
}

/** A rival's touchline: one substitution when it helps, then tactics late on. At most one action a poll. */
export function createRivalManager(setup: RivalSetup): RivalManager {
  if (setup.starters.length !== STARTERS || !setup.starters.every(Number.isFinite))
    throw new Error(`A rival manager needs the stamina of all ${STARTERS} starters`);
  const weight = futureWeight(setup.style, setup.matchdaysLeft);
  let polls = 0;
  let pitch: readonly OnPitch[] | null = null;
  let made: RivalSub | null = null;
  let tactics = setup.style.tactics;

  /** The pair worth the most, if any is worth making; earlier slots win ties. */
  function bestSub(on: readonly OnPitch[], left: number): Omit<RivalSub, 'step'> | null {
    let best: Omit<RivalSub, 'step'> | null = null;
    let bestValue = 0;
    for (const [offSlot, off] of on.entries()) {
      for (const [benchSlot, option] of setup.bench.entries()) {
        const value = subValue(off, option, left, weight);
        if (value > bestValue) [best, bestValue] = [{ offSlot, benchSlot }, value];
      }
    }
    return best;
  }

  const manage: Manager = (state, team): ManagerAction | null => {
    const step = polls++ * POLL_STEPS;
    pitch ??= state.knights
      .filter((k) => k.team === team)
      .map((k, i) => ({ id: k.id, tier: k.tier, stamina: setup.starters[i] ?? STAMINA_MAX }));
    const gone = clockGone(state);
    const lead = leadOf(state, team);
    if (!made && gone >= (lead < 0 ? CHASING_SUB_AT : SUB_AT)) {
      const sub = bestSub(pitch, 1 - gone);
      const off = sub && pitch[sub.offSlot];
      const on = sub && setup.bench[sub.benchSlot];
      if (sub && off && on) {
        made = { offSlot: sub.offSlot, benchSlot: sub.benchSlot, step };
        return { kind: 'substitution', offId: off.id, on: on.spec };
      }
    }
    const wanted = rivalTactics(setup.style, gone, lead);
    if (sameTactics(wanted, tactics)) return null;
    tactics = wanted;
    return { kind: 'tactics', tactics };
  };

  return { manage, substitution: () => made };
}
