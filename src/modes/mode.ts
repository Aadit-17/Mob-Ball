import type { AppContext, ScreenId } from '../app';
import type { KnightSpec } from '../game/match';
import type { TeamId } from '../game/types';
import type { House } from '../setup/houses';

export interface GoalRecord {
  readonly team: TeamId;
  /** Display name, or "You" for the player. */
  readonly scorer: string;
  readonly byPlayer: boolean;
  readonly ownGoal: boolean;
  /** Minute on a 90-minute football clock, e.g. "34" or "90+". */
  readonly minute: string;
}

export interface MatchResult {
  readonly score: readonly [number, number];
  readonly goals: readonly GoalRecord[];
}

export interface ResultAction {
  readonly label: string;
  readonly primary?: boolean;
  readonly run: () => void;
}

/**
 * Everything the match screen needs, supplied by whichever mode started the match.
 * The match screen never knows which mode it is serving.
 */
export interface MatchSession {
  readonly home: readonly KnightSpec[];
  readonly away: readonly KnightSpec[];
  readonly homeHouse: House;
  readonly awayHouse: House;
  /** Where "quit" from the pause menu goes. */
  readonly quitTo: ScreenId;
  /** Buttons on the full-time screen; this is where a mode records results and moves on. */
  resultActions(result: MatchResult): readonly ResultAction[];
}

export interface GameMode {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly available: boolean;
  start(app: AppContext): void;
}
