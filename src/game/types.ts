import type { Look } from '../knight/look';
import type { Attributes } from './attributes';
import type { BuildStats } from './constants';
import type { Rng } from './rng';

export type TeamId = 0 | 1;
export type Role = 'gk' | 'def' | 'mid' | 'fwd';

/** What a controller (keyboard or bot) asks a knight to do this step. */
export interface Input {
  /** Desired direction; magnitudes above 1 are normalised. */
  moveX: number;
  moveY: number;
  /** Held kick: the knight kicks as soon as the ball is in reach. */
  kick: boolean;
  barge: boolean;
}

export const NO_INPUT: Readonly<Input> = { moveX: 0, moveY: 0, kick: false, barge: false };

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
}

export interface Knight extends Body {
  readonly id: number;
  readonly team: TeamId;
  /** Changed mid-match only by `swapRoles`, from the dugout. */
  role: Role;
  readonly look: Look;
  readonly build: BuildStats;
  readonly human: boolean;
  /** Bot skill tier (0 = Peasant … 4 = Legend). Humans carry the top tier for display only. */
  readonly tier: number;
  readonly speedFactor: number;
  readonly attributes: Attributes;
  facing: 1 | -1;
  kickHeld: boolean;
  kickCooldown: number;
  bargeTime: number;
  bargeCooldown: number;
  bargeDirX: number;
  bargeDirY: number;
  stun: number;
  runPhase: number;
}

export interface TeamTouch {
  knightId: number;
  age: number;
}

export interface Ball extends Body {
  /** Id of the knight who touched it last, for scorer credit. */
  lastTouch: number | null;
  /** Each team's most recent touch (kick or dribble) and seconds since, for crediting deflections. */
  teamTouch: [TeamTouch | null, TeamTouch | null];
  spin: number;
}

export type Phase = 'kickoff' | 'play' | 'goal' | 'ended';

export type MatchEvent =
  /** `boost` is the power multiplier from a close-range shot and/or a first-time kick (1 = none). */
  | { type: 'kick'; x: number; y: number; knightId: number; boost: number }
  | { type: 'barge'; x: number; y: number; attackerId: number; victimId: number }
  | { type: 'goal'; team: TeamId; scorerId: number | null; ownGoal: boolean }
  | { type: 'golden-goal' }
  | { type: 'substitution'; team: TeamId; offId: number; onId: number }
  | { type: 'full-time' };

export interface MatchState {
  readonly knights: Knight[];
  /** Knights substituted off, kept so their earlier goals and touches still credit them. */
  readonly substituted: Knight[];
  /** A level score at full time ends the match instead of going to golden goal. */
  readonly draws: boolean;
  readonly ball: Ball;
  readonly posts: readonly Body[];
  readonly score: [number, number];
  readonly rng: Rng;
  clock: number;
  phase: Phase;
  phaseTime: number;
  goldenGoal: boolean;
  /** Events raised since the consumer last drained them. */
  events: MatchEvent[];
}
