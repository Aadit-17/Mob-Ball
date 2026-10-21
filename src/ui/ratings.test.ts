import { describe, expect, it } from 'vitest';
import { breakdownParts, ratingBand, shownRating } from './ratings';

describe('ratings on the full-time screen', () => {
  it('shows a rating to one decimal and colours it by the band of what is shown', () => {
    expect(shownRating(6.96)).toBe('7.0');
    expect(shownRating(10)).toBe('10.0');
    expect([5.94, 5.96, 6.94, 6.96, 7.94, 7.96].map(ratingBand)).toEqual([
      'low',
      'fair',
      'fair',
      'good',
      'good',
      'great',
    ]);
  });
});

describe('the rating breakdown as shown', () => {
  const b = (base: number, lines: [string, number][], score: number, rating = score) => ({
    base,
    lines: lines.map(([label, points]) => ({ label, count: label === 'Won the ball' ? '×8' : '', points })),
    score,
    rating,
  });

  it('puts decisive parts first and the rest by size, folds parts under 0.05 into Other play, and adds up', () => {
    const parts = breakdownParts(
      b(
        6.04,
        [
          ['Passes', 0.12],
          ['Won the ball', 0.44],
          ['Goals', 0.92],
          ['Shots', 0.04],
          ['Clearances', 0.04],
          ['Lost the ball', -0.02],
        ],
        7.58,
      ),
    );
    expect(parts.map((p) => `${p.label} ${p.value}`)).toEqual([
      'Base 6.0',
      'Goals +0.9',
      'Won the ball ×8 +0.4',
      'Passes +0.1',
      'Other play +0.1',
      'Rounding +0.1',
    ]);
    expect(parts.some((p) => p.value === '0.0')).toBe(false);
  });

  it('puts a decisive part before a bigger part of play', () => {
    const parts = breakdownParts(
      b(
        6,
        [
          ['Won the ball', 0.5],
          ['Assists', 0.2],
        ],
        6.7,
      ),
    );
    expect(parts.map((p) => p.label)).toEqual(['Base', 'Assists', 'Won the ball ×8']);
  });

  it('says rounding out loud when tiny parts fold to nothing, and names a cap at 10', () => {
    expect(breakdownParts(b(6.04, [['Passes', 0.04]], 6.08)).map((p) => p.label)).toEqual([
      'Base',
      'Rounding',
    ]);
    expect(breakdownParts(b(6, [['Goals', 4.6]], 10.6, 10)).at(-1)).toEqual({
      label: 'Capped at 10',
      value: '−0.6',
    });
  });
});
