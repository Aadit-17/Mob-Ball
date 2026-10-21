import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_CAPS, ATTRIBUTES, NO_ATTRIBUTES, type Attribute } from '../../game/attributes';
import { DEFAULT_LOOK } from '../../knight/look';
import { endSeason, PLAYER_ID, startCareer, type CareerState } from '../../modes/career/career';
import { DECLINE_AGE, guardCost, trainCost, type Training } from '../../modes/career/economy';
import { UPGRADE_COST } from '../../modes/career/upgrades';
import { fixtures } from '../../modes/manager/league';
import { fakeMatchday, fakeSeason } from '../../test/career';
import {
  appsNote,
  bestMatch,
  BENCH_MARGIN,
  clubSpells,
  effectNow,
  effectPerLevel,
  FIRST_CHOICE_MARGIN,
  guardState,
  knockoutRound,
  levelsLost,
  placeAt,
  royalOutcome,
  seasonVerdict,
  starScore,
  starsPreview,
  trainState,
  wearPreview,
  wearText,
} from './career-views';

const training = (over: Partial<Training> = {}): Training => ({
  age: 20,
  points: 0,
  attributes: NO_ATTRIBUTES,
  wear: NO_ATTRIBUTES,
  guarded: [],
  ...over,
});

const start = (): CareerState => startCareer({ seed: 5, look: DEFAULT_LOOK, position: 'fwd' });

describe('stars on screen', () => {
  it('reads the 0–4 tier scale out of five, clamped', () => {
    expect(starScore(0)).toBe('1.0');
    expect(starScore(2.34)).toBe('3.3');
    expect(starScore(2.345, 2)).toBe('3.35');
    expect(starScore(9)).toBe('5.0');
    expect(starScore(-1)).toBe('1.0');
  });

  it('previews a level of every match stat as a rise, and nothing past the cap', () => {
    for (const stat of ['pace', 'shot', 'strength'] as const) {
      const p = starsPreview(1, NO_ATTRIBUTES, stat);
      expect(p.next).toBeGreaterThan(p.now);
      const capped = starsPreview(1, { ...NO_ATTRIBUTES, [stat]: ATTRIBUTE_CAPS[stat] }, stat);
      expect(capped.next).toBe(capped.now);
    }
  });
});

describe('stat effects in words', () => {
  it('says each level from the engine constants', () => {
    expect(effectPerLevel('pace')).toBe('+1% run speed a level');
    expect(effectPerLevel('shot')).toContain('5% harder');
    expect(effectPerLevel('strength')).toContain('+8% weight');
    expect(effectPerLevel('stamina')).toBe('Matches tire you 4% less a level');
  });

  it('adds the levels up', () => {
    expect(effectNow('pace', 0)).toBe('Untrained');
    expect(effectNow('pace', 6)).toBe('+6% run speed');
    expect(effectNow('stamina', 6)).toBe('Tires 24% slower');
  });
});

describe('buying', () => {
  // The view's buttons must never offer what the core would refuse, nor refuse what it would sell.
  it('can train exactly when the core can, at the core price', () => {
    for (const stat of ATTRIBUTES)
      for (const age of [17, DECLINE_AGE - 1, DECLINE_AGE, 36])
        for (let level = 0; level <= ATTRIBUTE_CAPS[stat]; level++)
          for (const points of [0, 1, 2, 7, 8, 9, 10, 40]) {
            const t = training({ age, points, attributes: { ...NO_ATTRIBUTES, [stat]: level } });
            const state = trainState(t, stat);
            const cost = trainCost(t, stat);
            expect(state.kind === 'ready' ? state.cost : null).toBe(cost);
          }
  });

  it('says why a level cannot be bought', () => {
    expect(trainState(training({ points: 1 }), 'pace')).toEqual({ kind: 'short', cost: UPGRADE_COST.pace });
    expect(trainState(training({ points: 99, attributes: { ...NO_ATTRIBUTES, pace: 8 } }), 'pace').kind).toBe(
      'cap',
    );
    expect(trainState(training({ age: DECLINE_AGE, points: 99 }), 'pace').kind).toBe('aged');
  });

  it('can guard exactly when the core can, at the core price', () => {
    for (const stat of ATTRIBUTES)
      for (const age of [20, DECLINE_AGE - 1, DECLINE_AGE, 35])
        for (const level of [0, 1, 5])
          for (const points of [0, 2, 8, 10, 30])
            for (const guarded of [[], [stat]] as Attribute[][]) {
              const t = training({ age, points, guarded, attributes: { ...NO_ATTRIBUTES, [stat]: level } });
              const state = guardState(t, stat);
              expect(state.kind === 'ready' ? state.cost : null).toBe(guardCost(t, stat));
            }
  });
});

describe('wear', () => {
  const veteran = training({ age: DECLINE_AGE - 1, attributes: { ...NO_ATTRIBUTES, pace: 6 } });

  it('previews the next birthday, guarded and not', () => {
    expect(wearPreview(training({ attributes: { ...NO_ATTRIBUTES, pace: 6 } }), 'pace')).toEqual({
      unguarded: 0,
      guarded: 0,
    });
    expect(wearPreview(veteran, 'pace')).toEqual({ unguarded: 1, guarded: 0 });
    expect(wearPreview({ ...veteran, guarded: ['pace'] }, 'pace')).toEqual({ unguarded: 1, guarded: 0 });
    // Nothing left to lose at level 0.
    expect(wearPreview(veteran, 'shot')).toEqual({ unguarded: 0, guarded: 0 });
  });

  it('says it plainly', () => {
    expect(wearText({ unguarded: 0, guarded: 0 }, false)).toBe('Holds next season');
    expect(wearText({ unguarded: 1, guarded: 0 }, false)).toBe('Next season: −1 level, none if guarded');
    expect(wearText({ unguarded: 2, guarded: 1 }, false)).toBe('Next season: −2 levels, −1 level if guarded');
    expect(wearText({ unguarded: 1, guarded: 0 }, true)).toBe('Guarded: holds next season');
    expect(wearText({ unguarded: 2, guarded: 1 }, true)).toBe('Next season: −1 level, guarded');
  });

  it('counts only the falls between two seasons', () => {
    const before = { pace: 6, shot: 2, strength: 0, stamina: 4 };
    expect(levelsLost(before, { pace: 5, shot: 3, strength: 0, stamina: 2 })).toEqual([
      { stat: 'pace', levels: 1 },
      { stat: 'stamina', levels: 2 },
    ]);
    expect(levelsLost(undefined, before)).toEqual([]);
  });
});

describe('an offer', () => {
  it('reads his place against the incumbent', () => {
    expect(placeAt(2.5 + FIRST_CHOICE_MARGIN, 2.5)).toBe('first');
    expect(placeAt(2.5, 2.5)).toBe('contest');
    expect(placeAt(2.5 - BENCH_MARGIN + 0.01, 2.5)).toBe('contest');
    expect(placeAt(2.5 - BENCH_MARGIN, 2.5)).toBe('bench');
  });
});

describe('the season in review', () => {
  it('finds his best match, the earliest on a tie, from his side of the score', () => {
    const ratings = [6.1, 8.4, 7.0, 8.4];
    let c = start();
    for (const player of ratings) c = fakeMatchday(c, () => ({ score: [2, 1], player }));
    const best = bestMatch(c, 0, c.player.club);
    const league = c.season.leagues[0];
    if (!league) throw new Error('no league');
    const fixture = fixtures(league, 1).find((f) => f.home === c.player.club || f.away === c.player.club);
    if (!best || !fixture) throw new Error('no best match');
    const home = fixture.home === c.player.club;
    expect(best).toEqual({
      rating: 8.4,
      matchday: 1,
      opponent: home ? fixture.away : fixture.home,
      score: home ? [2, 1] : [1, 2],
    });
    expect(bestMatch(start(), 0, c.player.club)).toBeNull();
  });

  it('heads the season with the proudest thing first', () => {
    const summary = endSeason(fakeSeason(start(), () => ({ score: [1, 1], player: 6.5 }))).history[0];
    if (!summary) throw new Error('no summary');
    expect(seasonVerdict({ ...summary, honours: ['title', 'royalCall', 'royalCrown'] })).toBe('crown');
    expect(seasonVerdict({ ...summary, honours: ['promotion', 'title', 'topScorer'] })).toBe('title');
    expect(seasonVerdict({ ...summary, honours: ['royalCall'], relegated: true })).toBe('royal');
    expect(seasonVerdict({ ...summary, honours: ['topScorer', 'promotion'] })).toBe('promotion');
    expect(seasonVerdict({ ...summary, honours: ['topScorer'], relegated: true })).toBe('boot');
    expect(seasonVerdict({ ...summary, honours: [], relegated: true })).toBe('relegated');
    expect(seasonVerdict({ ...summary, honours: [], relegated: false })).toBe('finish');
  });

  it('splits his appearances into starts and the bench only when he came on or off', () => {
    const summary = endSeason(fakeSeason(start(), () => ({ score: [1, 0], player: 7 }))).history[0];
    if (!summary) throw new Error('no summary');
    const line = { ...summary, apps: 12, starts: 9, subOns: 3, subOffs: 0 };
    expect(appsNote(line)).toBe('9 started · 3 off the bench');
    expect(appsNote({ ...line, subOffs: 2 })).toBe('9 started · 3 off the bench · taken off 2 times');
    expect(appsNote({ ...line, starts: 12, subOns: 0, subOffs: 1 })).toBe('taken off once');
    expect(appsNote({ ...line, starts: 12, subOns: 0 })).toBeUndefined();
  });

  it('keeps every club spell, a return counting again', () => {
    const summary = endSeason(fakeSeason(start(), () => ({ score: [1, 0], player: 7 }))).history[0];
    if (!summary) throw new Error('no summary');
    const at = (season: number, club: string) => ({ ...summary, season, club });
    expect(clubSpells([at(0, 'mill'), at(1, 'mill'), at(2, 'raven'), at(3, 'mill')])).toEqual([
      { club: 'mill', from: 0, to: 1 },
      { club: 'raven', from: 2, to: 2 },
      { club: 'mill', from: 3, to: 3 },
    ]);
  });
});

describe('the royal knockout', () => {
  const match = (score: [number, number]) => ({ opponent: 'Round', score, rating: 7, goals: 0, motm: false });

  it('names its rounds', () => {
    expect([0, 1, 2].map((r) => knockoutRound(r, 3))).toEqual(['First round', 'Semi-final', 'Final']);
  });

  it('says where he went out, or that he was crowned', () => {
    const squad = [PLAYER_ID, 'a', 'b', 'c'];
    expect(royalOutcome({ squad, matches: [match([0, 1])], crowned: false }, 3)).toBe(
      'Out in the first round',
    );
    expect(royalOutcome({ squad, matches: [match([1, 0]), match([2, 3])], crowned: false }, 3)).toBe(
      'Out in the semi-final',
    );
    expect(
      royalOutcome({ squad, matches: [match([1, 0]), match([1, 0]), match([2, 0])], crowned: true }, 3),
    ).toBe('Crowned');
  });
});
