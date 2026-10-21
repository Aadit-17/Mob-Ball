import type { Role, TeamId } from '../game/types';

/** What became of a shot: decided by the first knight to touch it, or by the net. */
export type ShotOutcome =
  /** In, credited to the shooter (a deflection off a rival still counts, as in football). */
  | 'goal'
  /** The rival keeper touched an on-target shot and it no longer goes in. */
  | 'saved'
  /** A rival outfielder touched it while it was still travelling. */
  | 'blocked'
  /** The rival keeper took an off-target shot while it was still travelling. */
  | 'claimed'
  /** It went wide or died, and a rival took the loose ball. */
  | 'missed'
  /** The shooter or a teammate touched it next (a rebound off a post, a knock-on). */
  | 'rebound'
  /** A rival turned it into his own net. */
  | 'own-goal'
  /** Still unresolved at full time. */
  | 'unresolved';

interface Base {
  /** Simulation step the action started on. */
  readonly step: number;
  readonly knightId: number;
  /** The acting knight's side. */
  readonly team: TeamId;
  /** Where the ball was. */
  readonly x: number;
  readonly y: number;
}

/** A football action, in the order it started. Counts are tallied from these, ratings will value them. */
export type Action =
  | (Base & {
      readonly kind: 'pass';
      readonly completed: boolean;
      /** The knight who touched it next: a teammate if completed, a rival if not. */
      readonly receiverId: number;
      readonly toX: number;
      readonly toY: number;
      readonly progressive: boolean;
    })
  | (Base & {
      readonly kind: 'shot';
      readonly onTarget: boolean;
      readonly outcome: ShotOutcome;
      /** The keeper or outfielder who saved, blocked or claimed it. */
      readonly stopperId: number | null;
      /** The rival keeper facing it when it was decided, for shots on target. */
      readonly keeperId: number | null;
    })
  | (Base & { readonly kind: 'clearance'; readonly toX: number; readonly toY: number })
  /** Possession won from `fromId`'s side: from his carry, his pass in flight, or a loose ball. */
  | (Base & { readonly kind: 'tackle' | 'interception' | 'recovery'; readonly fromId: number })
  /** Possession lost without a pass or shot (tackled, or let it get loose). */
  | (Base & { readonly kind: 'turnover'; readonly byId: number })
  | (Base & { readonly kind: 'dribble'; readonly pastId: number })
  | (Base & { readonly kind: 'barge'; readonly victimId: number })
  /** `team` is the scoring side; `knightId` the knight credited (a rival for an own goal), if anyone. */
  | (Omit<Base, 'knightId'> & {
      readonly kind: 'goal';
      readonly knightId: number | null;
      readonly ownGoal: boolean;
      /** The teammate who set the scorer up, if within ASSIST_WINDOW of the goal. */
      readonly assistId: number | null;
      /** Steps from that teammate's touch to the goal, recorded even outside the window. */
      readonly assistGap: number | null;
      readonly fromShot: boolean;
      /** The conceding side's keeper on the pitch. */
      readonly keeperId: number | null;
    });

export type ActionKind = Action['kind'];

export const COUNTS = [
  'touches',
  'kicks',
  'carrySteps',
  'passes',
  'passesCompleted',
  'passesLost',
  'progressivePasses',
  'passDistance',
  'shots',
  'shotsOnTarget',
  'shotsBlocked',
  'goalsFromShots',
  'goals',
  'ownGoals',
  'assists',
  'saves',
  'shotsOnTargetFaced',
  'goalsConceded',
  'claims',
  'blocks',
  'lastDitchBlocks',
  'tackles',
  'interceptions',
  'recoveries',
  'clearances',
  'dribbles',
  'turnovers',
  'bargeAttempts',
  'bargesWon',
  'bargesLost',
] as const;
export type Count = (typeof COUNTS)[number];

/** What one knight did in a match. Steps are fixed simulation steps of live play. */
export type KnightStats = Readonly<Record<Count, number>> & {
  readonly id: number;
  readonly team: TeamId;
  /** Live steps on the pitch in each role (a positions swap moves him between them). */
  readonly roleSteps: Readonly<Record<Role, number>>;
  readonly playedSteps: number;
};

export interface TeamStats {
  /** Goals from the engine's goal events, plus one if the runner settled the match by lot. */
  readonly goals: number;
  /** Live steps with this side's knight on the ball, by the bots' own reading. */
  readonly possessionSteps: number;
  /** Share of the steps anyone had the ball (0.5 each if nobody ever did). */
  readonly possession: number;
}

export interface MatchStats {
  /** Steps with the ball live (the clock running, golden goal included). */
  readonly liveSteps: number;
  /** Knights on the pitch at once. */
  readonly onPitch: number;
  readonly teams: readonly [TeamStats, TeamStats];
  /** Everyone who played, by id. */
  readonly knights: readonly KnightStats[];
  readonly actions: readonly Action[];
  readonly decidedByLot: TeamId | null;
}
