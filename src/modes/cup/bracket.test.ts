import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, TOP_TIER } from '../../ai/skills';
import {
  cupStatus,
  currentRound,
  drawCup,
  fixtures,
  knockedOutIn,
  normalizeCup,
  pendingSimulations,
  playerFixture,
  recordPlayerResult,
  recordResult,
  roundTier,
  type CupState,
} from './bracket';

const HOUSES = ['ember', 'corvane', 'thorn', 'grey', 'mud', 'hollow', 'ox', 'salt'];
const LEVELS = DIFFICULTIES.map((d) => d.id);
const entry = { seed: 7, levelId: 'knight', teamSize: 4, playerHouse: 'thorn' } as const;

function playerMatch(cup: CupState) {
  const fixture = playerFixture(cup);
  if (!fixture) throw new Error('The player has no match to play');
  return fixture;
}

/** Plays the other ties of the round, the first-listed house always winning 2–1. */
const settleOthers = (cup: CupState): CupState =>
  pendingSimulations(cup).reduce((c, f) => recordResult(c, f.round, f.index, [2, 1]), cup);

const win = (cup: CupState): CupState => settleOthers(recordPlayerResult(cup, playerMatch(cup), [3, 1]));

describe('drawCup', () => {
  it('puts the player in a bracket of eight with seven different rival houses', () => {
    const cup = drawCup(entry, HOUSES);
    expect([...cup.draw].sort()).toEqual([...HOUSES].sort());
    expect(cup.draw.filter((h) => h !== 'thorn')).toHaveLength(7);
    expect(fixtures(cup, 0)).toHaveLength(4);
    expect(fixtures(cup, 0).filter((f) => f.houses.includes('thorn'))).toHaveLength(1);
  });

  it('draws the same bracket for the same seed and a different one for another', () => {
    expect(drawCup(entry, HOUSES).draw).toEqual(drawCup(entry, HOUSES).draw);
    const draws = new Set([1, 2, 3, 4, 5].map((seed) => drawCup({ ...entry, seed }, HOUSES).draw.join()));
    expect(draws.size).toBeGreaterThan(1);
  });

  it('refuses a field without the player or with a house twice', () => {
    expect(() => drawCup({ ...entry, playerHouse: 'nowhere' }, HOUSES)).toThrow();
    expect(() => drawCup(entry, [...HOUSES.slice(0, 7), 'thorn'])).toThrow();
  });
});

describe('playing the cup', () => {
  it('starts with the player’s quarter-final and no other tie to simulate yet', () => {
    const cup = drawCup(entry, HOUSES);
    expect(playerMatch(cup).round).toBe(0);
    expect(pendingSimulations(cup)).toEqual([]);
    expect(cupStatus(cup)).toBe('playing');
  });

  it('plays out the other quarter-finals once the player has won theirs, then moves on to the semi-final', () => {
    const cup = drawCup(entry, HOUSES);
    const won = recordPlayerResult(cup, playerMatch(cup), [2, 0]);
    expect(playerFixture(won)).toBeNull();
    expect(pendingSimulations(won)).toHaveLength(3);
    const settled = settleOthers(won);
    expect(currentRound(settled)).toBe(1);
    const semi = playerMatch(settled);
    expect(semi.round).toBe(1);
    // The semi-final rival is the winner of the neighbouring quarter-final.
    const neighbour = fixtures(settled, 0)[semi.index * 2 + (semi.houses[0] === 'thorn' ? 1 : 0)];
    expect(semi.houses).toContain(neighbour?.houses[0]);
  });

  it('records the player’s score the right way round whichever side of the tie they were drawn', () => {
    const cup = drawCup(entry, HOUSES);
    const mine = playerMatch(cup);
    const won = recordPlayerResult(cup, mine, [1, 0]);
    const score = fixtures(won, 0)[mine.index]?.score;
    expect(score).toEqual(mine.houses[0] === 'thorn' ? [1, 0] : [0, 1]);
    expect(cupStatus(won)).toBe('playing');
  });

  it('ends the run when the player loses', () => {
    const semi = win(drawCup(entry, HOUSES));
    const lost = recordPlayerResult(semi, playerMatch(semi), [1, 2]);
    expect(cupStatus(lost)).toBe('out');
    expect(knockedOutIn(lost)).toBe(1);
    expect(playerFixture(lost)).toBeNull();
    expect(pendingSimulations(lost)).toEqual([]);
  });

  it('crowns the player after winning three matches', () => {
    let cup = drawCup(entry, HOUSES);
    for (let round = 0; round < 3; round++) {
      expect(cupStatus(cup)).toBe('playing');
      cup = win(cup);
    }
    expect(cupStatus(cup)).toBe('won');
    expect(knockedOutIn(cup)).toBeNull();
    expect(playerFixture(cup)).toBeNull();
  });

  it('refuses a drawn tie or a tie played twice', () => {
    const cup = drawCup(entry, HOUSES);
    const mine = playerMatch(cup);
    expect(() => recordPlayerResult(cup, mine, [1, 1])).toThrow();
    const won = recordPlayerResult(cup, mine, [1, 0]);
    expect(() => recordPlayerResult(won, mine, [1, 0])).toThrow();
  });
});

describe('roundTier', () => {
  it.each(DIFFICULTIES)('rises a level each round around $label', ({ meanTier }) => {
    expect([0, 1, 2].map((round) => roundTier(meanTier, round))).toEqual([
      meanTier - 1,
      meanTier,
      meanTier + 1,
    ]);
  });

  it('stays within the skill tiers', () => {
    expect([0, 1, 2].map((round) => roundTier(0, round))).toEqual([0, 0, 1]);
    expect([0, 1, 2].map((round) => roundTier(TOP_TIER, round))).toEqual([TOP_TIER - 1, TOP_TIER, TOP_TIER]);
  });
});

describe('normalizeCup', () => {
  const played = win(win(drawCup(entry, HOUSES)));
  const saved = (): Record<string, unknown> => JSON.parse(JSON.stringify(played)) as Record<string, unknown>;

  it('reads back a saved cup exactly', () => {
    expect(normalizeCup(saved(), HOUSES, LEVELS)).toEqual(played);
  });

  it.each([
    ['nothing', null],
    ['text', 'cup'],
    ['an old save', { round: 2, opponents: ['mud'] }],
    ['an unknown level', { ...saved(), levelId: 'legendary' }],
    ['a bad team size', { ...saved(), teamSize: 11 }],
    ['a negative seed', { ...saved(), seed: -1 }],
    ['a house twice', { ...saved(), draw: [...HOUSES.slice(0, 7), 'ember'] }],
    ['an unknown house', { ...saved(), draw: [...HOUSES.slice(0, 7), 'atlantis'] }],
    ['the player missing', { ...saved(), playerHouse: 'atlantis' }],
    ['a missing round', { ...saved(), results: [[null, null, null, null]] }],
    ['a drawn score', { ...saved(), results: [[[1, 1], null, null, null], [null, null], [null]] }],
    ['a broken score', { ...saved(), results: [[[1, 'two'], null, null, null], [null, null], [null]] }],
    [
      'a final before the semi-finals',
      { ...saved(), results: [[null, null, null, null], [null, null], [[1, 0]]] },
    ],
  ])('drops %s instead of crashing', (_, raw) => {
    expect(normalizeCup(raw, HOUSES, LEVELS)).toBeNull();
  });
});
