import { KNIGHT } from './constants';
import { clamp } from './vec';

/** A knight's trained stats in whole levels up to each cap, on top of his build. Every level is a real
 * input to the simulation (stamina: to the season's fatigue), never a hidden dice roll. */
export interface Attributes {
  /** Run speed: acceleration, top speed and barge speed. */
  readonly pace: number;
  /** Shots at goal: their power, top speed and the range they keep it from. Passes are untouched. */
  readonly shot: number;
  /** Mass (who moves whom in a collision, with knights and the ball alike) and time between barges. */
  readonly strength: number;
  /** How slowly a season's matches tire him. The match itself never reads it. */
  readonly stamina: number;
}

export type Attribute = keyof Attributes;

export const ATTRIBUTES: readonly Attribute[] = ['pace', 'shot', 'strength', 'stamina'];

/** Every knight before training, and every knight outside My Career. */
export const NO_ATTRIBUTES: Attributes = { pace: 0, shot: 0, strength: 0, stamina: 0 };

/** Caps per stat, for playtest tuning. scripts/attributes.sim.ts measures what the caps are worth. Match stats stop
 * at 8: at 10, with the reworked shot, a maxed knight measured +0.09 ± 0.07 goals over a Legend bot. */
export const PACE_CAP = 8;
export const SHOT_CAP = 8;
export const STRENGTH_CAP = 8;
export const STAMINA_CAP = 10;
export const ATTRIBUTE_CAPS: Readonly<Record<Attribute, number>> = {
  pace: PACE_CAP,
  shot: SHOT_CAP,
  strength: STRENGTH_CAP,
  stamina: STAMINA_CAP,
};

/** Speed multiplier gained per pace level (a Legend bot runs 6% faster than a Knight bot). */
export const PACE_PER_LEVEL = 0.01;
/** Power (and the ball's top speed) of his shots at goal gained per shot level. Alone it is worth little to a
 * bot: +40% at the cap measured +0.037 ± 0.045 goals. */
export const SHOT_PER_LEVEL = 0.05;
/** Pixels per shot level added to the range his shots keep the shot boost from, and that a bot shoots from. Most
 * of the stat's worth is the bot shooting from further out: +0.23 ± 0.05 alone, of +0.27 at the cap. */
export const SHOT_RANGE_PER_LEVEL = 20;
/** Mass multiplier gained per strength level (Hefty is 30% heavier than Standard). */
export const STRENGTH_PER_LEVEL = 0.08;
/** Share of the barge cooldown cut per strength level (once its own stat, worth +0.005 a level alone).
 * Cooldown, not knockback: +50% knockback measured -0.02 ± 0.10 goals. Capped so it always outlasts a stun. */
export const COOLDOWN_PER_LEVEL = 0.05;
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
  stamina: levelOf(attributes, 'stamina'),
});

// Each factor is exactly 1 at level 0, so a knight without attributes plays bit for bit as before.
export const paceFactor = (a: Attributes): number => 1 + PACE_PER_LEVEL * levelOf(a, 'pace');
export const shotFactor = (a: Attributes): number => 1 + SHOT_PER_LEVEL * levelOf(a, 'shot');
export const strengthFactor = (a: Attributes): number => 1 + STRENGTH_PER_LEVEL * levelOf(a, 'strength');

/** Pixels beyond his tier's (or the engine's) shot range that he shoots from: 0 untrained. */
export const extraShotRange = (a: Attributes): number => SHOT_RANGE_PER_LEVEL * levelOf(a, 'shot');

/** Seconds between barges. */
export const bargeCooldownOf = (a: Attributes): number =>
  KNIGHT.bargeCooldown * (1 - COOLDOWN_PER_LEVEL * levelOf(a, 'strength'));

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
