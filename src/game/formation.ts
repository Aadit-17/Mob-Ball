import { PITCH } from './constants';
import type { Role, TeamId } from './types';
import type { Vec } from './vec';

/** Outfield roles for each team size, deepest first. The home human always plays forward. */
export const ROLES_BY_SIZE: Readonly<Record<3 | 4, readonly Role[]>> = {
  3: ['gk', 'def', 'fwd'],
  4: ['gk', 'def', 'mid', 'fwd'],
};

export type TeamSize = keyof typeof ROLES_BY_SIZE;

/** Kick-off spots for the home side; the away side is the point reflection through the centre spot. */
const HOME_SPOTS: Readonly<Record<Role, Vec>> = {
  gk: { x: PITCH.left + 60, y: PITCH.centerY },
  def: { x: PITCH.left + 250, y: PITCH.centerY + 60 },
  mid: { x: PITCH.left + 400, y: PITCH.centerY - 110 },
  fwd: { x: PITCH.centerX - 100, y: PITCH.centerY },
};

export function kickoffSpot(role: Role, team: TeamId): Vec {
  const spot = HOME_SPOTS[role];
  return team === 0 ? { ...spot } : { x: PITCH.width - spot.x, y: 2 * PITCH.centerY - spot.y };
}
