import type { AppContext, ScreenId } from '../app';
import type { TeamTactics } from '../ai/tactics';
import type { KnightSpec } from '../game/match';
import type { TeamId } from '../game/types';
import type { House } from '../setup/houses';
import type { Manager } from './runner';

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
  /** Set by modes whose matches must replay identically; otherwise a fresh seed, default tactics, golden goal. */
  readonly fixture?: {
    readonly seed: number;
    readonly tactics?: TeamTactics;
    readonly draws?: boolean;
    readonly managers?: readonly [Manager | null, Manager | null];
  };
  /** Nobody on the pitch is the player's: the match is watched, with speed controls and a skip. */
  readonly spectate?: boolean;
  /** Buttons on the full-time screen; this is where a mode records results and moves on. */
  resultActions(result: MatchResult): readonly ResultAction[];
}

/** A run in progress, or finished but not yet dismissed, shown on the mode's home card. */
export interface ModeProgress {
  readonly note: string;
  /** The home card's button, e.g. "Continue cup". */
  readonly action: string;
}

export interface GameMode {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly available: boolean;
  progress?(app: AppContext): ModeProgress | null;
  start(app: AppContext): void;
}
