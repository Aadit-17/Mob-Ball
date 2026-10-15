import { describe, expect, it } from 'vitest';
import { houseById, type House } from '../../setup/houses';
import { playOut, simulateMatch } from './simulate';

const tie: [House, House] = [houseById('mud'), houseById('salt')];

describe('simulateMatch', () => {
  it('plays the same match, goal for goal, from the same seed', () => {
    for (const seed of [1, 2, 3]) {
      expect(playOut(simulateMatch(tie, 4, 2, seed))).toEqual(playOut(simulateMatch(tie, 4, 2, seed)));
    }
  });

  it('gives the same result however the match is split into chunks', () => {
    const chunked = simulateMatch(tie, 3, 2, 9);
    let score = chunked.advance(1);
    while (!score) score = chunked.advance(997);
    expect(score).toEqual(playOut(simulateMatch(tie, 3, 2, 9)));
  });

  it('always produces a winner, and different seeds produce different matches', () => {
    const scores = [11, 12, 13, 14, 15].map((seed) => playOut(simulateMatch(tie, 4, 2, seed)));
    for (const [a, b] of scores) expect(a).not.toBe(b);
    expect(new Set(scores.map((s) => s.join('-'))).size).toBeGreaterThan(1);
  });
});
