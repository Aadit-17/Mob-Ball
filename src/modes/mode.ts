import type { AppContext, ScreenId } from '../app';
import type { Tactics } from '../ai/tactics';
import type { KnightSpec } from '../game/match';
import type { TeamId } from '../game/types';
import type { House } from '../setup/houses';
import type { FixtureConfig, GoalLog, TimedAction } from './runner';

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
  /** Simulation steps the match lasted. */
  readonly steps: number;
  /** Changes made from the dugout, with the step each took effect. */
  readonly timeline: readonly TimedAction[];
  /** Every goal with the runner knight credited, for modes that keep scorers. */
  readonly goalLog: readonly GoalLog[];
}

export interface Dugout {
  readonly bench: readonly KnightSpec[];
  /** One-line summaries keyed by knight name, e.g. "Champion · Hefty · stamina 84". */
  readonly details: Readonly<Record<string, string>>;
  readonly presets: readonly { readonly label: string; readonly tactics: Tactics }[];
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
  /**
   * For modes whose matches must replay identically: a fresh runner config, rival managers and all, for
   * every kick-off. Otherwise the line-ups above with a random seed, default tactics and golden goal.
   */
  readonly fixture?: () => FixtureConfig;
  /** Nobody on the pitch is the player's: the match is watched, with speed controls and a skip. */
  readonly spectate?: boolean;
  /** The home manager's options when a watched match is paused: substitutes and one-tap tactics. */
  readonly dugout?: Dugout;
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
