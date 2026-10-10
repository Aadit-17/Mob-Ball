import { PITCH } from '../game/constants';
import { stepBall } from '../game/physics';
import type { Ball } from '../game/types';
import type { Vec } from '../game/vec';

interface Circle extends Vec {
  radius: number;
}

/** Whether any obstacle sits within `margin` of the straight path from `from` to `to`. */
export function laneBlocked(from: Vec, to: Vec, obstacles: readonly Circle[], margin: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return obstacles.some((o) => {
    const t = ((o.x - from.x) * dx + (o.y - from.y) * dy) / len;
    if (t < 0 || t > len) return false;
    const px = from.x + (dx / len) * t;
    const py = from.y + (dy / len) * t;
    return Math.hypot(o.x - px, o.y - py) < o.radius + margin;
  });
}

/** The point `distance` along the way from `from` to `to`, stopping at `to`. */
export function toward(from: Vec, to: Vec, distance: number): Vec {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  const t = d > 0 ? Math.min(1, distance / d) : 0;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

export interface BankShot {
  /** Point to kick toward: the target mirrored through the wall. */
  aim: Vec;
  /** Where the ball meets the wall. */
  bounce: Vec;
}

/**
 * Aim point for playing the ball off a touchline to reach `target`. A bounce keeps the ball's
 * speed along the wall but scales the speed away from it by `restitution`, so the target is
 * mirrored and stretched by 1/restitution. Uniform rolling friction does not bend the path.
 */
export function bankShot(from: Vec, target: Vec, wallY: number, restitution: number): BankShot | null {
  const d0 = Math.abs(from.y - wallY);
  const d1 = Math.abs(target.y - wallY);
  const side = Math.sign(from.y - wallY);
  if (side === 0 || Math.sign(target.y - wallY) !== side) return null;
  const aim = { x: target.x, y: wallY - side * (d1 / restitution) };
  const f = d0 / (d0 + d1 / restitution);
  const bounce = { x: from.x + (aim.x - from.x) * f, y: wallY };
  if (bounce.x < PITCH.left || bounce.x > PITCH.right) return null;
  return { aim, bounce };
}

/** Where the ball will be after `seconds`, bouncing off walls but ignoring knights. */
export function predictBall(ball: Ball, seconds: number, dt = 1 / 30): Vec {
  const ghost: Ball = { ...ball };
  for (let t = 0; t < seconds; t += dt) stepBall(ghost, dt);
  return { x: ghost.x, y: ghost.y };
}
