import type { Attributes } from '../../game/attributes';
import { fatigueFactor } from '../../game/attributes';
import type { Role } from '../../game/types';
import { PLAY_COST, REST_GAIN, STAMINA_MAX, tiredCost, type Lineup, type Starter } from '../manager/stamina';
import { clamp } from '../../game/vec';
import { matchGoals, tierForGoals } from './stars';

// Form is how far the forged knight's ratings run from par, as his manager reads it: a decaying average shrunk
// towards par, then weighed in tiers, the scale every line-up choice is made on.

/** His mean rating and its spread a match, by role. scripts/career.sim.ts refits them on whole simmed careers, and
 * finds no lean on his stars or his side (outfield: +0.17 ± 0.12 a tier of stars over the rivals, +0.02 ± 0.12 a
 * tier of teammates, 1346 matches): ratings are judged per position within a match, so par is one number. */
export interface RatingFit {
  readonly par: number;
  readonly sd: number;
}

export const RATING_FIT: Readonly<Record<'gk' | 'outfield', RatingFit>> = {
  outfield: { par: 6.7, sd: 1.02 },
  gk: { par: 6.67, sd: 0.88 },
};

/** The forged knight's strength in a match, in tiers: his stars without stamina, which acts between matches. */
export const matchStrength = (build: number, attributes: Attributes): number =>
  tierForGoals(matchGoals(build, attributes));

/** The rating his manager expects of him in this role. */
export const expectedRating = (role: Role): number =>
  (role === 'gk' ? RATING_FIT.gk : RATING_FIT.outfield).par;

/** One rating's surprise: how far it ran from par, on the matchday counted across the career. */
export interface FormEntry {
  readonly day: number;
  readonly residual: number;
  /** The share of the match he played, if not all of it: a cameo says less about him, so it weighs less. */
  readonly share?: number;
}

/** Entries kept: older ones weigh under 0.85^8 ≈ 0.27 of a fresh one and barely move the reading. */
export const FORM_KEEP = 8;
/** Each matchday old a rating counts this much less: a manager remembers the last few weeks best. */
export const FORM_DECAY = 0.85;
/** Matches' worth of par the reading starts from, so a single match moves it a fifth as much as a long run. */
export const FORM_PRIOR = 5;
/** Tiers a rating point of form is worth to the manager. Ratings measured no lean on stars, so this is a judgement,
 * not a fit: a run a full match's spread (about a point) below par counts as a tier's drop. */
export const FORM_TIERS = 1;

/** The manager's reading of his form in rating points: 0 is exactly as his stars predict. */
export function formResidual(form: readonly FormEntry[], today: number): number {
  let weighted = 0;
  let weight = FORM_PRIOR;
  for (const { day, residual, share = 1 } of form) {
    const w = share * FORM_DECAY ** Math.max(0, today - day);
    weighted += w * residual;
    weight += w;
  }
  return weighted / weight;
}

export const formTiers = (form: readonly FormEntry[], today: number): number =>
  FORM_TIERS * formResidual(form, today);

export const addForm = (form: readonly FormEntry[], entry: FormEntry): FormEntry[] =>
  [...form, entry].slice(-FORM_KEEP);

/** chooseLineup's lookahead (private to stamina.ts): later matches priced by the house style. */
const LOOKAHEAD = { stars: 0.5, balanced: 0.75, depth: 1 } as const;

/** chooseLineup's startValue, for a knight whose matches cost `cost` stamina (his stamina stat lowers it). */
function startValue(strength: number, stamina: number, cost: number, weight: number): number {
  return (
    strength - tiredCost(stamina) - weight * (tiredCost(stamina - cost) - tiredCost(stamina + REST_GAIN))
  );
}

export interface SelectionInput {
  readonly role: Role;
  /** Tiers: his match strength (outfield), plus his form. */
  readonly strength: number;
  readonly form: number;
  readonly stamina: number;
  readonly attributes: Attributes;
  /** The club's own choice of four without him, and its manager's style. */
  readonly lineup: Lineup;
  readonly style: keyof typeof LOOKAHEAD;
  readonly matchdaysLeft: number;
  /** Stamina of the knight he would replace. */
  readonly incumbentStamina: number;
}

export interface Selection {
  readonly starts: boolean;
  readonly value: number;
  /** The knight in his place in the club's own four, and that knight's value. */
  readonly incumbent: Starter;
  readonly incumbentValue: number;
}

/** What playing him is worth to his manager on top of his strength, in tiers: the club signed him to play, and a
 * career on the bench is no career. PLAYING_TIME a full match (a cameo earns its share), APPEARANCE for getting on at
 * all. Fitted in scripts/career.sim.ts: good form always starts, poor form still plays about four matches in five. */
export const PLAYING_TIME = 0.5;
export const APPEARANCE = 0.05;

/** Whether the manager starts him over the knight the club would play in his place, on chooseLineup's measure:
 * strength less tiredness, now and later, plus what playing him is worth. In goal no tier counts, so a keeper's claim is his form.
 * Ties go to him. */
export function selectPlayer(input: SelectionInput): Selection {
  const index = ['gk', 'def', 'mid', 'fwd'].indexOf(input.role);
  const incumbent = input.lineup.starters[index];
  if (!incumbent) throw new Error('A line-up needs four starters');
  const weight = Math.max(0, input.matchdaysLeft - 1) * LOOKAHEAD[input.style];
  const keeper = input.role === 'gk';
  const ownCost = PLAY_COST * fatigueFactor(input.attributes);
  const value =
    startValue(
      (keeper ? 0 : input.strength) + input.form,
      clamp(input.stamina, 0, STAMINA_MAX),
      ownCost,
      weight,
    ) +
    PLAYING_TIME +
    APPEARANCE;
  const incumbentValue = startValue(
    keeper ? 0 : incumbent.knight.tier,
    clamp(input.incumbentStamina, 0, STAMINA_MAX),
    PLAY_COST,
    weight,
  );
  return { starts: value >= incumbentValue, value, incumbent, incumbentValue };
}

/** Whether a benched forged knight comes on with `left` of the match to play: what he falls short by, and what his
 * minutes are worth, count only for the minutes he would play (stamina too is spent by the minute), while APPEARANCE is
 * earned whatever the length. So a near miss comes on, and one well short of a place stays out. */
export function comesOn(selection: Selection, left: number): boolean {
  const perMatch = selection.value - APPEARANCE - selection.incumbentValue;
  return perMatch * clamp(left, 0, 1) + APPEARANCE >= 0;
}
