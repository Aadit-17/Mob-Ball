import { describe, expect, it } from 'vitest';
import { ratingBand, shownRating } from './ratings';

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
