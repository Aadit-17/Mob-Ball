import { describe, expect, it } from 'vitest';
import { NO_ATTRIBUTES } from '../../game/attributes';
import { DEFAULT_LOOK } from '../../knight/look';
import { STAMINA_MAX } from '../manager/stamina';
import { careerDay, selection, startCareer, type CareerState } from './career';
import {
  addForm,
  APPEARANCE,
  PLAYING_TIME,
  expectedRating,
  FORM_KEEP,
  FORM_PRIOR,
  formResidual,
  formTiers,
  RATING_FIT,
  selectPlayer,
  type FormEntry,
} from './form';
import { squadOfClub } from './clubs';

describe('form', () => {
  it('reads nothing into no evidence, and shrinks a single match towards his stars', () => {
    expect(formResidual([], 10)).toBe(0);
    expect(formResidual([{ day: 10, residual: -2 }], 10)).toBeCloseTo(-2 / (FORM_PRIOR + 1));
  });

  it('weighs a part match by the share of it he played', () => {
    expect(formResidual([{ day: 10, residual: -2, share: 0.5 }], 10)).toBeCloseTo(-1 / (FORM_PRIOR + 0.5));
    expect(formResidual([{ day: 10, residual: -2, share: 1 / 3 }], 10)).toBeGreaterThan(
      formResidual([{ day: 10, residual: -2 }], 10),
    );
  });

  it('weighs recent matches most, so old evidence fades while he sits out', () => {
    const bad: FormEntry[] = [{ day: 0, residual: -2 }];
    expect(formResidual(bad, 0)).toBeLessThan(formResidual(bad, 5));
    expect(formResidual(bad, 5)).toBeLessThan(formResidual(bad, 20));
    expect(formResidual(bad, 20)).toBeLessThan(0);
  });

  it('keeps the last few entries only', () => {
    let form: FormEntry[] = [];
    for (let day = 0; day < 20; day++) form = addForm(form, { day, residual: 1 });
    expect(form).toHaveLength(FORM_KEEP);
    expect(form[0]?.day).toBe(20 - FORM_KEEP);
  });

  it('expects par of an outfielder and of a keeper, each measured on its own', () => {
    expect(expectedRating('mid')).toBe(RATING_FIT.outfield.par);
    expect(expectedRating('fwd')).toBe(RATING_FIT.outfield.par);
    expect(expectedRating('gk')).toBe(RATING_FIT.gk.par);
  });

  it('turns a long bad run into a real drop, and a single bad match into a small one', () => {
    const one = formTiers([{ day: 4, residual: -1 }], 4);
    const run = formTiers(
      Array.from({ length: 5 }, (_, i) => ({ day: i, residual: -1 })),
      4,
    );
    expect(run).toBeLessThan(-0.4);
    expect(one).toBeGreaterThan(-0.2);
  });
});

describe('selection', () => {
  const career = startCareer({ seed: 3, look: DEFAULT_LOOK, position: 'fwd' });
  /** Form entries of one residual on the matchdays just gone. */
  const run = (residual: number, matches: number, endingOn: number): FormEntry[] =>
    Array.from({ length: matches }, (_, i) => ({ day: endingOn - matches + 1 + i, residual }));
  const withForm = (c: CareerState, form: FormEntry[]): CareerState => ({
    ...c,
    player: { ...c.player, form },
  });
  /** His club's knights all made Knights, as strong as he is untrained, so form and stamina decide. */
  function level(c: CareerState): CareerState {
    const squad = squadOfClub(c.world, c.player.club).map((k) => ({ ...k, tier: 2 }));
    return { ...c, world: { ...c.world, squads: { ...c.world.squads, [c.player.club]: squad } } };
  }
  const even = level(career);
  const today = careerDay(even);

  it('starts the untrained forged knight at a Village club on his stars', () => {
    expect(selection(career).starts).toBe(true);
    expect(selection(even).starts).toBe(true);
  });

  it('drops him after a long bad run, and he wins his place back with good matches', () => {
    expect(selection(withForm(even, run(-2.5, FORM_KEEP, today))).starts).toBe(false);
    expect(selection(withForm(even, [...run(-2.5, 5, today - 3), ...run(2.5, 3, today)])).starts).toBe(true);
  });

  it('keeps him in the side through a run that would drop a knight of the club, for what playing him is worth', () => {
    const pick = selection(withForm(even, run(-1.25, FORM_KEEP, today)));
    expect(pick.value - PLAYING_TIME - APPEARANCE).toBeLessThan(pick.incumbentValue);
    expect(pick.starts).toBe(true);
  });

  it('brings him back once a bad run is old enough, as the manager forgets', () => {
    const bad = run(-3, FORM_KEEP, 0);
    const lineup = selection(even);
    const pick = (day: number) =>
      selectPlayer({
        role: 'fwd',
        strength: 2.34,
        form: formTiers(bad, day),
        stamina: STAMINA_MAX,
        attributes: NO_ATTRIBUTES,
        lineup: {
          starters: [lineup.incumbent, lineup.incumbent, lineup.incumbent, lineup.incumbent],
          bench: [],
        },
        style: 'balanced',
        matchdaysLeft: 10,
        incumbentStamina: STAMINA_MAX,
      });
    expect(pick(0).starts).toBe(false);
    expect(pick(30).starts).toBe(true);
  });

  it('rests him when he is tired and the knight in his place is fresh', () => {
    expect(selection({ ...even, player: { ...even.player, stamina: 20 } }).starts).toBe(false);
  });

  it('judges a keeper on form: no keeper tier is worth anything', () => {
    const keeper = { ...career, player: { ...career.player, position: 'gk' as const } };
    expect(selection(keeper).starts).toBe(true);
    expect(selection(withForm(keeper, run(-2.5, FORM_KEEP, today))).starts).toBe(false);
    expect(selection(withForm(keeper, run(1, 3, today))).starts).toBe(true);
  });
});
