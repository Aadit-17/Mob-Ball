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
  const b = (base: number, points: number[], score: number, rating = score) => ({
    base,
    lines: points.map((p, i) => ({ label: `Part ${String(i)}`, count: i === 0 ? '×2' : '', points: p })),
    score,
    rating,
  });

  it('shows each part to one decimal, says any rounding out loud, and adds up to the rating shown', () => {
    const parts = breakdownParts(b(6.04, [0.74, 0.04, -0.02], 6.8));
    expect(parts.map((p) => `${p.label} ${p.value}`)).toEqual([
      'Base 6.0',
      'Part 0 ×2 +0.7',
      'Part 1 0.0',
      'Part 2 0.0',
      'Rounding +0.1',
    ]);
  });

  it('names a cap at 10 as its own part', () => {
    const parts = breakdownParts(b(6, [4.6], 10.6, 10));
    expect(parts.at(-1)).toEqual({ label: 'Capped at 10', value: '−0.6' });
  });
});
