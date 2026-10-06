/** Fixed simulation step. Physics and AI always advance in these increments. */
export const STEP = 1 / 120;

export const PITCH = {
  width: 1260,
  height: 660,
  left: 90,
  right: 1170,
  top: 70,
  bottom: 590,
  centerX: 630,
  centerY: 330,
  goalTop: 205,
  goalBottom: 455,
  goalDepth: 36,
  /** How far knights may stray past the touchlines. */
  runoff: 22,
} as const;

export const BALL = {
  radius: 10,
  mass: 0.5,
  /** Fraction of speed kept after one second of rolling. */
  damping: 0.5,
  wallRestitution: 0.75,
  /** The net absorbs the ball, so it can't roll back out during the celebration. */
  netRestitution: 0,
  maxSpeed: 680,
} as const;

export const KNIGHT = {
  accel: 1200,
  drag: 5.2,
  kickingAccelFactor: 0.78,
  kickPower: 460,
  /** Kicks at the rival goal from within `shotRange` get this much more power, so attack can beat defence. */
  shotBoost: 1.35,
  shotRange: 400,
  /** Kicking a moving ball first time, without controlling it, adds power. Rewards quick passing. */
  oneTouchBoost: 1.25,
  oneTouchMinSpeed: 150,
  kickReach: 5,
  kickCooldown: 0.22,
  bargeSpeed: 470,
  bargeDuration: 0.18,
  bargeCooldown: 2.2,
  stunDuration: 0.85,
  knockback: 360,
  restitution: 0.3,
  ballRestitution: 0.5,
} as const;

export const POST = { radius: 8, ballRestitution: 0.6, knightRestitution: 0.2 } as const;

export const MATCH = {
  /** A goal within this many seconds of the scoring side's last touch is theirs, even if it deflects in. */
  deflectionWindow: 1.5,
  duration: 90,
  kickoffPause: 1,
  celebration: 2.4,
} as const;

export interface BuildStats {
  readonly name: string;
  readonly radius: number;
  readonly mass: number;
  readonly speed: number;
  readonly kick: number;
  /** Speed / power / weight out of 5, shown in the forge. */
  readonly rating: readonly [number, number, number];
}

export const BUILDS: readonly BuildStats[] = [
  { name: 'Nimble', radius: 16, mass: 0.85, speed: 1.07, kick: 0.9, rating: [5, 2, 2] },
  { name: 'Standard', radius: 18, mass: 1, speed: 1, kick: 1, rating: [4, 3, 3] },
  { name: 'Hefty', radius: 20.5, mass: 1.3, speed: 0.92, kick: 1.12, rating: [2, 5, 5] },
];
