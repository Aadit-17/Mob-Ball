import { describe, expect, it } from 'vitest';
import { createRng } from '../game/rng';
import { SLOTS } from './catalog';
import { DEFAULT_LOOK, decodeLook, encodeLook, normalizeLook, randomLook } from './look';

describe('normalizeLook', () => {
  it('repairs out-of-range, missing and wrongly typed slots from stored data', () => {
    const look = normalizeLook({ helmet: 99, topper: 'plume', eyes: 2, name: '   ' });
    expect(look.helmet).toBe(DEFAULT_LOOK.helmet);
    expect(look.topper).toBe(DEFAULT_LOOK.topper);
    expect(look.eyes).toBe(2);
    expect(look.name).toBe(DEFAULT_LOOK.name);
  });

  it('survives garbage', () => {
    expect(normalizeLook(null)).toEqual(DEFAULT_LOOK);
    expect(normalizeLook('knight')).toEqual(DEFAULT_LOOK);
  });
});

describe('share codes', () => {
  it('round-trip every random knight, including names with spaces and symbols', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const look = randomLook(rng, i % 2 ? 'Ser Pip & Co' : 'Æthelred');
      expect(decodeLook(encodeLook(look))).toEqual(look);
    }
  });

  it('rejects codes that are malformed or out of range', () => {
    expect(decodeLook('hello')).toBeNull();
    expect(decodeLook('MB1-123-Bob')).toBeNull();
    expect(decodeLook(`MB1-${'z'.repeat(SLOTS.length)}-Bob`)).toBeNull();
  });
});
