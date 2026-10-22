import { describe, expect, it } from 'vitest';
import { MODES } from '../modes';
import { HORIZON } from './releases';

describe('the Chronicle horizon', () => {
  it('never lists a mode that is already playable as coming soon', () => {
    const playable = MODES.filter((m) => m.available).map((m) => m.name.toLowerCase());
    for (const item of HORIZON) expect(playable).not.toContain(item.name.toLowerCase());
  });
});
