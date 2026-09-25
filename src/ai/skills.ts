import type { Rng } from '../game/rng';
import { clamp } from '../game/vec';

/**
 * What a bot knows. Each tier adds knowledge rather than just speed: where to stand,
 * when to pass, where to aim, and HaxBall techniques such as bank passes and the wall lift.
 */
export interface Skill {
  readonly name: string;
  /** Seconds between decisions. */
  readonly reaction: number;
  readonly speed: number;
  /** Max angular error, in radians, applied to every aim. */
  readonly aimError: number;
  /** How the bot predicts where the ball is going. */
  readonly anticipation: 'none' | 'linear' | 'bounces';
  /** swarm: everyone chases. roles: hold a position. support: push up, offer width, make runs. */
  readonly positioning: 'swarm' | 'roles' | 'support';
  readonly passing: 'never' | 'when-blocked' | 'open-lanes' | 'through-balls';
  /** Dribble until this close to goal, then shoot. */
  readonly shotRange: number;
  readonly aimsOpenSide: boolean;
  /** With the shot blocked and no pass on, dribble sideways to open a lane instead of shooting into a defender. */
  readonly opensLanes: boolean;
  readonly bankPasses: boolean;
  readonly wallLift: boolean;
  /** Chance per decision to barge an opponent on the ball. */
  readonly bargeRate: number;
  readonly keeping: 'line' | 'angle';
}

export const TIERS: readonly Skill[] = [
  {
    name: 'Peasant',
    reaction: 0.32,
    speed: 0.82,
    aimError: 0.3,
    anticipation: 'none',
    positioning: 'swarm',
    passing: 'never',
    shotRange: Infinity,
    aimsOpenSide: false,
    opensLanes: false,
    bankPasses: false,
    wallLift: false,
    bargeRate: 0.06,
    keeping: 'line',
  },
  {
    name: 'Squire',
    reaction: 0.24,
    speed: 0.88,
    aimError: 0.18,
    anticipation: 'linear',
    positioning: 'roles',
    passing: 'when-blocked',
    shotRange: 420,
    aimsOpenSide: false,
    opensLanes: false,
    bankPasses: false,
    wallLift: false,
    bargeRate: 0.12,
    keeping: 'line',
  },
  {
    name: 'Knight',
    reaction: 0.17,
    speed: 0.94,
    aimError: 0.1,
    anticipation: 'linear',
    positioning: 'support',
    passing: 'open-lanes',
    shotRange: 300,
    aimsOpenSide: true,
    opensLanes: true,
    bankPasses: false,
    wallLift: false,
    bargeRate: 0.2,
    keeping: 'angle',
  },
  {
    name: 'Champion',
    reaction: 0.11,
    speed: 0.98,
    aimError: 0.05,
    anticipation: 'bounces',
    positioning: 'support',
    passing: 'open-lanes',
    shotRange: 270,
    aimsOpenSide: true,
    opensLanes: true,
    bankPasses: true,
    wallLift: false,
    bargeRate: 0.3,
    keeping: 'angle',
  },
  {
    name: 'Legend',
    reaction: 0.07,
    speed: 1,
    aimError: 0.025,
    anticipation: 'bounces',
    positioning: 'support',
    passing: 'through-balls',
    shotRange: 260,
    aimsOpenSide: true,
    opensLanes: true,
    bankPasses: true,
    wallLift: true,
    bargeRate: 0.35,
    keeping: 'angle',
  },
];

export const TOP_TIER = TIERS.length - 1;

export function skillFor(tier: number): Skill {
  const skill = TIERS[clamp(Math.round(tier), 0, TOP_TIER)];
  if (!skill) throw new Error(`No skill tier ${tier}`);
  return skill;
}

export interface Difficulty {
  readonly id: string;
  readonly label: string;
  /** Rival tiers are rolled around this. */
  readonly meanTier: number;
}

export const DIFFICULTIES: readonly Difficulty[] = [
  { id: 'squire', label: 'Squire', meanTier: 1 },
  { id: 'knight', label: 'Knight', meanTier: 2 },
  { id: 'champion', label: 'Champion', meanTier: 3 },
];

/** Each rival lands on the mean tier, or one either side of it, so squads are uneven like real teams. */
export function rollRivalTiers(meanTier: number, count: number, rng: Rng): number[] {
  return Array.from({ length: count }, () => clamp(meanTier + rng.pick([-1, 0, 0, 1]), 0, TOP_TIER));
}
