import { KNIGHT } from './constants';
import { clamp } from './vec';

/** A knight's trained stats in whole levels up to each cap, on top of his build. Every level is a real
 * input to the simulation (stamina: to the season's fatigue), never a hidden dice roll. */
export interface Attributes {
  /** Run speed: acceleration, top speed and barge speed. */
  readonly pace: number;
  /** Kick strength. */
  readonly shot: number;
  /** Mass: who moves whom in a collision, with knights and the ball alike. */
  readonly strength: number;
  /** Time between barges. */
  readonly barge: number;
  /** How slowly a season's matches tire him. The match itself never reads it. */
  readonly stamina: number;
}

export type Attribute = keyof Attributes;

export const ATTRIBUTES: readonly Attribute[] = ['pace', 'shot', 'strength', 'barge', 'stamina'];

/** Every knight before training, and every knight outside My Career. */
export const NO_ATTRIBUTES: Attributes = { pace: 0, shot: 0, strength: 0, barge: 0, stamina: 0 };

/** Caps per stat, for playtest tuning. scripts/attributes.sim.ts measures what the caps are worth. */
export const PACE_CAP = 10;
export const SHOT_CAP = 10;
export const STRENGTH_CAP = 10;
export const BARGE_CAP = 10;
export const STAMINA_CAP = 10;
export const ATTRIBUTE_CAPS: Readonly<Record<Attribute, number>> = {
  pace: PACE_CAP,
  shot: SHOT_CAP,
  strength: STRENGTH_CAP,
  barge: BARGE_CAP,
  stamina: STAMINA_CAP,
};

/** Speed multiplier gained per pace level (a Legend bot runs 6% faster than a Knight bot). */
export const PACE_PER_LEVEL = 0.01;
/** Kick power multiplier gained per shot level. */
export const SHOT_PER_LEVEL = 0.05;
/** Mass multiplier gained per strength level (Hefty is 30% heavier than Standard). */
export const STRENGTH_PER_LEVEL = 0.08;
/** Share of the barge cooldown cut per level. Cooldown, not knockback: +50% knockback measured -0.02 ± 0.10
 * goals. Capped so the cooldown always outlasts a stun. */
export const BARGE_PER_LEVEL = 0.05;
/** Share of a match's fatigue saved per stamina level. */
export const STAMINA_PER_LEVEL = 0.04;

/** A level as the engine uses it: whole, and within its cap. Anything else from a save is repaired. */
export function levelOf(attributes: Attributes, attribute: Attribute): number {
  const level = attributes[attribute];
  return Number.isFinite(level) ? clamp(Math.floor(level), 0, ATTRIBUTE_CAPS[attribute]) : 0;
}

/** A copy with every level whole and capped. */
export const capAttributes = (attributes: Attributes): Attributes => ({
  pace: levelOf(attributes, 'pace'),
  shot: levelOf(attributes, 'shot'),
  strength: levelOf(attributes, 'strength'),
  barge: levelOf(attributes, 'barge'),
  stamina: levelOf(attributes, 'stamina'),
});

// Each factor is exactly 1 at level 0, so a knight without attributes plays bit for bit as before.
export const paceFactor = (a: Attributes): number => 1 + PACE_PER_LEVEL * levelOf(a, 'pace');
export const shotFactor = (a: Attributes): number => 1 + SHOT_PER_LEVEL * levelOf(a, 'shot');
export const strengthFactor = (a: Attributes): number => 1 + STRENGTH_PER_LEVEL * levelOf(a, 'strength');

/** Seconds between barges. */
export const bargeCooldownOf = (a: Attributes): number =>
  KNIGHT.bargeCooldown * (1 - BARGE_PER_LEVEL * levelOf(a, 'barge'));

/** Trained strength against trained strength; builds were balanced without it, so they stay out of it. */
const strengthRatio = (attacker: Attributes, victim: Attributes): number =>
  strengthFactor(attacker) / strengthFactor(victim);

/** Speed a barge sends its victim off at. */
export const knockbackOf = (attacker: Attributes, victim: Attributes): number =>
  KNIGHT.knockback * strengthRatio(attacker, victim);

/** Seconds a barge stuns its victim: shorter on a stronger one, never longer, so it always ends before
 * the shortest barge cooldown and nobody can be stunned again and again. */
export const stunOf = (attacker: Attributes, victim: Attributes): number =>
  KNIGHT.stunDuration * Math.min(1, strengthRatio(attacker, victim));

/** Multiplies the stamina a match costs; the career's season layer reads it. */
export const fatigueFactor = (a: Attributes): number => 1 - STAMINA_PER_LEVEL * levelOf(a, 'stamina');
