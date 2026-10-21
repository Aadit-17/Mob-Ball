// The game state the next-goal model reads: a coarse cell seen from the side on the ball. The recorder
// files one cell per step; the ratings look up how likely each side is to score next from it.
import { PITCH } from '../game/constants';
import type { Knight, MatchState, TeamId } from '../game/types';

/** Ball's distance from the goal line it attacks, in bands of a sixth of the pitch (180 px). */
export const DEPTH_BAND = (PITCH.right - PITCH.left) / 6;
export const DEPTHS = 6;
/** Across the pitch from the centre line: the goal mouth's half-width, the box, then wide. */
export const WIDTH_EDGES = [(PITCH.goalBottom - PITCH.goalTop) / 2, 215] as const;
// Pressure: the gap from the ball to the nearest rival body. Inside a stride he can touch it next;
// beyond about three knight widths the side on the ball has time.
export const PRESSURE_EDGES = [25, 90] as const;
/** Ball speed toward the goal it attacks, px/s: going back, still or rolling, going forward. */
export const PACE_EDGES = [-120, 120] as const;

export const FATES = ['none', 'for', 'against'] as const;
export type FateBand = (typeof FATES)[number];

export const FEATURES = {
  depth: DEPTHS,
  width: WIDTH_EDGES.length + 1,
  pressure: PRESSURE_EDGES.length + 1,
  pace: PACE_EDGES.length + 1,
  fate: FATES.length,
} as const;
export const CELLS = FEATURES.depth * FEATURES.width * FEATURES.pressure * FEATURES.pace * FEATURES.fate;
/** No side on the ball (a kick-off not yet touched) or the ball dead: no value is read there. */
export const NO_CELL = -1;

/** A cell, unpacked. */
export interface CellParts {
  readonly depth: number;
  readonly width: number;
  readonly pressure: number;
  readonly pace: number;
  readonly fate: number;
}

const band = (value: number, edges: readonly number[]): number => {
  let i = 0;
  while (i < edges.length && value >= (edges[i] ?? Infinity)) i++;
  return i;
};

export const packCell = (p: CellParts): number =>
  (((p.depth * FEATURES.width + p.width) * FEATURES.pressure + p.pressure) * FEATURES.pace + p.pace) *
    FEATURES.fate +
  p.fate;

export function unpackCell(cell: number): CellParts {
  let c = cell;
  const fate = c % FEATURES.fate;
  c = Math.floor(c / FEATURES.fate);
  const pace = c % FEATURES.pace;
  c = Math.floor(c / FEATURES.pace);
  const pressure = c % FEATURES.pressure;
  c = Math.floor(c / FEATURES.pressure);
  const width = c % FEATURES.width;
  return { depth: Math.floor(c / FEATURES.width), width, pressure, pace, fate };
}

/** The cell of the state after a step, seen from `side`, the side on the ball; `bound`: see netBound. */
export function stateCell(state: MatchState, side: TeamId, bound: TeamId | null): number {
  const { ball } = state;
  const ahead = side === 0 ? PITCH.right - ball.x : ball.x - PITCH.left;
  const depth = Math.min(DEPTHS - 1, Math.max(0, Math.floor(ahead / DEPTH_BAND)));
  const width = band(Math.abs(ball.y - PITCH.centerY), WIDTH_EDGES);
  const gap = (k: Knight): number => Math.hypot(k.x - ball.x, k.y - ball.y) - k.radius - ball.radius;
  const nearest = state.knights.reduce((g, k) => (k.team === side ? g : Math.min(g, gap(k))), Infinity);
  const pressure = band(nearest, PRESSURE_EDGES);
  const pace = band(side === 0 ? ball.vx : -ball.vx, PACE_EDGES);
  const fateBand = bound === null ? 0 : bound === side ? 1 : 2;
  return packCell({ depth, width, pressure, pace, fate: fateBand });
}

/** How likely each side is to score next within the model's horizon, from a cell: [on the ball, other]. */
export interface ValueModel {
  /** Seconds ahead a goal counts as "next". */
  readonly horizon: number;
  /** Per cell: P(the side on the ball scores next), P(the other side does). */
  readonly own: readonly number[];
  readonly other: readonly number[];
}

/** One step of the match as the ratings read it. Arrays are indexed by simulation step. */
export interface Trace {
  /** The state's cell after each step, from the side in possession; NO_CELL while dead or unowned. */
  readonly cells: readonly number[];
  /** The knight in possession after each step (the last to touch, deflections aside), or -1. */
  readonly owners: readonly number[];
  /** The knight who touched the ball on each step (the last of several), or -1. */
  readonly touchers: readonly number[];
}
