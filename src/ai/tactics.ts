import type { TeamId } from '../game/types';

/** How a team plays: tier decides how well a knight does each job, tactics which jobs. Peasants just swarm. */
export interface Tactics {
  /** low: sit off the carrier until our half, then two press. high: two press deep in the rivals' half. */
  readonly press: 'low' | 'mid' | 'high';
  /** early: shoot from further out and pass less. patient: work it closer before shooting. */
  readonly shooting: 'patient' | 'normal' | 'early';
}

export type TeamTactics = readonly [Tactics, Tactics];

/** How every team played before tactics existed; Exhibition and the Realm Cup use it. */
export const DEFAULT_TACTICS: Tactics = { press: 'mid', shooting: 'normal' };

export const BOTH_DEFAULT: TeamTactics = [DEFAULT_TACTICS, DEFAULT_TACTICS];

export const withTactics = (all: TeamTactics, team: TeamId, tactics: Tactics): TeamTactics =>
  team === 0 ? [tactics, all[1]] : [all[0], tactics];

export const sameTactics = (a: Tactics, b: Tactics): boolean =>
  a.press === b.press && a.shooting === b.shooting;
