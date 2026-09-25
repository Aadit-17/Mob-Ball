import { createMatch, type KnightSpec } from '../game/match';
import type { Role } from '../game/types';
import { DEFAULT_LOOK } from '../knight/look';

export const spec = (role: Role, overrides: Partial<KnightSpec> = {}): KnightSpec => ({
  look: DEFAULT_LOOK,
  role,
  human: false,
  tier: 2,
  speedFactor: 1,
  ...overrides,
});

/** A 1v1 match with the ball live, for placing bodies by hand. */
export function liveDuel(home: Partial<KnightSpec> = {}, away: Partial<KnightSpec> = {}, seed = 1) {
  const state = createMatch({ home: [spec('fwd', home)], away: [spec('fwd', away)], seed });
  state.phase = 'play';
  const [h, a] = state.knights;
  if (!h || !a) throw new Error('fixture needs two knights');
  return { state, home: h, away: a };
}
