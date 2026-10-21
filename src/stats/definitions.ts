// What each football word means in MOB BALL: named windows and distances, and small pure readings.
// The recorder applies them step by step; the tests pin each one on staged situations.
import { KNIGHT, PITCH, POST, STEP } from '../game/constants';
import { collide, stepBall } from '../game/physics';
import type { Ball, Body, TeamId } from '../game/types';
import type { Vec } from '../game/vec';

const toSteps = (seconds: number): number => Math.round(seconds / STEP);

/** Slower than this a ball is loose, not travelling: the balance harness's 40 px/s for a dead shot. */
export const DEAD_SPEED = 40;

/** The fastest ball (680 px/s ×1.69 boost) slows below DEAD_SPEED in under 5 s, so 6 s reaches an end. */
export const FATE_HORIZON = toSteps(6);

/** Shots come from within this of the rival goal line: the balance and tactics harnesses' 500 px. */
export const SHOT_RANGE = 500;

// Off target still counts as a shot if its line crosses this far outside a post: a third of the 250 px
// mouth, wide enough for a Peasant's wild aim, narrow enough to leave out a ball rolled across goal.
export const SHOT_WIDE_MARGIN = 80;

/** Your own danger zone, from your goal line: inside the 360 px where bots guard against own goals. */
export const DANGER_ZONE = 300;

/** Progressive: 15% of the 1080 px pitch closer to the rival goal, the usual 15 m on a 105 m pitch. */
export const PROGRESSIVE_GAIN = 0.15 * (PITCH.right - PITCH.left);

// An assist must come this soon before the goal. Possessions in a 90-second match last a few seconds;
// past this the scorer made the goal himself. The stats harness reports how many fall outside.
export const ASSIST_WINDOW = toSteps(5);

// A change of possession stands once the new side keeps the ball this long or plays it on (a kick, a
// second knight). The bots' own TRANSITION_SETTLE: a scramble is one contest, not a run of tackles.
export const POSSESSION_HOLD = toSteps(0.3);

/** A knight has had the ball, and so can lose it, once it has been under control (below) this long. */
export const CONTROL_STEPS = toSteps(0.1);

// Under control: at his feet (the bots' CONTROL_GAP) and moving with him. A push at full pace sends the
// ball off at about half a knight's 230 px/s top speed; a ball faster than this past him is going by.
export const CONTROL_SPEED = 160;

/** A barge on the carrier wins the ball if his side loses it while he is still stunned, whoever takes it. */
export const BARGE_TACKLE_WINDOW = toSteps(KNIGHT.stunDuration);

/** Goal-side means in front of the ball and within this of its line: an 18 px body, the ball, a stride. */
export const DRIBBLE_LANE = 60;
/** ...and close enough to contest it: about three knight widths. */
export const DRIBBLE_ENGAGE = 100;

export const rivalOf = (team: TeamId): TeamId => (team === 0 ? 1 : 0);
/** +1 if the team attacks toward larger x. */
export const attackDir = (team: TeamId): 1 | -1 => (team === 0 ? 1 : -1);
const rivalGoalLineX = (team: TeamId): number => (team === 0 ? PITCH.right : PITCH.left);
const ownGoalLineX = (team: TeamId): number => (team === 0 ? PITCH.left : PITCH.right);

export const inDangerZone = (p: Vec, team: TeamId): boolean =>
  Math.abs(p.x - ownGoalLineX(team)) <= DANGER_ZONE;

/** Distance from a point to the centre of the goal the team attacks. */
export const toRivalGoal = (p: Vec, team: TeamId): number =>
  Math.hypot(rivalGoalLineX(team) - p.x, PITCH.centerY - p.y);

export const isProgressive = (from: Vec, to: Vec, team: TeamId): boolean =>
  toRivalGoal(from, team) - toRivalGoal(to, team) >= PROGRESSIVE_GAIN;

/** Where the ball would go if nobody touched it again, in steps from now. */
export interface BallFate {
  /** The side that would score, if it would end in a net. */
  readonly goal: TeamId | null;
  /** Steps until it is slower than DEAD_SPEED or in a net. */
  readonly deadIn: number;
  /** Steps until it reaches either goal line (a net or the end boards), or Infinity. */
  readonly lineIn: number;
}

// Plays the ball on alone with the engine's ball physics and posts, in the engine's order (move, posts,
// goal check). Untouched, the real ball does exactly this: "on target" means the engine would score it.
export function ballFate(ball: Ball, posts: readonly Body[]): BallFate {
  const b: Ball = { ...ball, teamTouch: [null, null] };
  const fixed = posts.map((p) => ({ ...p }));
  let lineIn = Infinity;
  for (let i = 1; i <= FATE_HORIZON; i++) {
    stepBall(b, STEP);
    for (const p of fixed) collide(b, p, POST.ballRestitution);
    if (b.x < PITCH.left - b.radius) return { goal: 1, deadIn: i, lineIn: Math.min(lineIn, i) };
    if (b.x > PITCH.right + b.radius) return { goal: 0, deadIn: i, lineIn: Math.min(lineIn, i) };
    if (lineIn === Infinity && (b.x <= PITCH.left + b.radius || b.x >= PITCH.right - b.radius)) lineIn = i;
    if (Math.hypot(b.vx, b.vy) < DEAD_SPEED) return { goal: null, deadIn: i, lineIn };
  }
  return { goal: null, deadIn: FATE_HORIZON, lineIn };
}

/** A kick as the stats read it the moment it leaves the foot. */
export interface KickReading {
  readonly shot: boolean;
  /** Would cross the rival goal line between the posts if nobody touched it. */
  readonly onTarget: boolean;
  /** Maybe a clearance: from your own danger zone, heading away from your goal. The rest are passes. */
  readonly clearance: boolean;
  readonly fate: BallFate;
}

// A shot is a kick from within SHOT_RANGE that would score unopposed (on target), or whose line heads
// at the goal mouth give or take SHOT_WIDE_MARGIN (off target). Read from the ball just after the kick.
export function readKick(ball: Ball, posts: readonly Body[], team: TeamId): KickReading {
  const fate = ballFate(ball, posts);
  const toLine = rivalGoalLineX(team) - ball.x;
  const inRange = Math.abs(toLine) <= SHOT_RANGE;
  const heading = ball.vx !== 0 && Math.sign(ball.vx) === Math.sign(toLine);
  const crossY = heading ? ball.y + (ball.vy * toLine) / ball.vx : NaN;
  const aimed = crossY > PITCH.goalTop - SHOT_WIDE_MARGIN && crossY < PITCH.goalBottom + SHOT_WIDE_MARGIN;
  const onTarget = inRange && fate.goal === team;
  const shot = onTarget || (inRange && aimed);
  const clearance = !shot && inDangerZone(ball, team) && Math.sign(ball.vx) === attackDir(team);
  return { shot, onTarget, clearance, fate };
}
