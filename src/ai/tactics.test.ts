import { describe, expect, it } from 'vitest';
import { FINGERPRINT_CASES, matchFingerprint } from '../test/fingerprint';

/** Recorded before tactics existed. Default tactics must play every one of these matches identically. */
const BEFORE_TACTICS: Readonly<Record<number, string>> = {
  1: '2-0|827,9310|sbkqm8',
  2: '0-1|11360|ggnt92',
  3: '3-4|1463,3480,4311,6844,9113,12457,13328|1oi0z0l',
  4: '2-1|6745,9806,13859|al1qbj',
  5: '3-2|4357,6606,8528,11377,17535|t1p76i',
  6: '0-2|2997,6810|jtmeab',
  7: '7-0|738,1861,3627,8128,9045,9877,13130|qmiy5b',
  8: '0-3|1028,2903,4154|htrdx9',
  9: '6-0|2252,3634,4553,8167,9205,10772|cqrfq8',
  10: '0-1|10400|1tvg8s7',
};

describe('default tactics', () => {
  it.each(FINGERPRINT_CASES)(
    'replay seed %i (tiers %i v %i) exactly as before tactics',
    (seed, home, away) => {
      expect(matchFingerprint(seed, home, away)).toBe(BEFORE_TACTICS[seed]);
    },
  );
});
