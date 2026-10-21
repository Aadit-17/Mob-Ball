import { bargeCooldownOf, paceFactor } from './attributes';
import { BALL, KNIGHT, PITCH } from './constants';
import type { Ball, Body, Input, Knight } from './types';
import { clamp } from './vec';

/**
 * Resolves overlap between two circles and applies an impulse along the contact normal.
 * Bodies with infinite mass (goalposts) never move. Returns whether they were touching.
 */
export function collide(a: Body, b: Body, restitution: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const minDist = a.radius + b.radius;
  if (d >= minDist || d === 0) return false;
  const nx = dx / d;
  const ny = dy / d;
  const invA = 1 / a.mass;
  const invB = 1 / b.mass;
  const invSum = invA + invB;
  const overlap = minDist - d;
  a.x -= (nx * overlap * invA) / invSum;
  a.y -= (ny * overlap * invA) / invSum;
  b.x += (nx * overlap * invB) / invSum;
  b.y += (ny * overlap * invB) / invSum;
  const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (closing < 0) {
    const j = (-(1 + restitution) * closing) / invSum;
    a.vx -= j * invA * nx;
    a.vy -= j * invA * ny;
    b.vx += j * invB * nx;
    b.vy += j * invB * ny;
  }
  return true;
}

/** Applies one step of input, movement and pitch bounds to a knight. */
export function stepKnight(k: Knight, input: Input, ball: Ball, dt: number): void {
  const stunned = k.stun > 0;
  if (stunned) k.stun = Math.max(0, k.stun - dt);
  let ix = stunned ? 0 : input.moveX;
  let iy = stunned ? 0 : input.moveY;
  const len = Math.hypot(ix, iy);
  if (len > 1) {
    ix /= len;
    iy /= len;
  }
  const speed = k.build.speed * k.speedFactor * paceFactor(k.attributes);

  if (k.bargeTime > 0) {
    k.bargeTime = Math.max(0, k.bargeTime - dt);
    k.vx = k.bargeDirX * KNIGHT.bargeSpeed * speed;
    k.vy = k.bargeDirY * KNIGHT.bargeSpeed * speed;
  } else {
    const accel = KNIGHT.accel * speed * (input.kick ? KNIGHT.kickingAccelFactor : 1);
    k.vx += (ix * accel - KNIGHT.drag * k.vx) * dt;
    k.vy += (iy * accel - KNIGHT.drag * k.vy) * dt;
  }

  if (input.barge && !stunned && k.bargeCooldown <= 0) {
    // With no direction held, barge toward the ball.
    let dx = ix;
    let dy = iy;
    if (dx === 0 && dy === 0) {
      dx = ball.x - k.x;
      dy = ball.y - k.y;
    }
    const d = Math.hypot(dx, dy) || 1;
    k.bargeDirX = dx / d;
    k.bargeDirY = dy / d;
    k.bargeTime = KNIGHT.bargeDuration;
    k.bargeCooldown = bargeCooldownOf(k.attributes);
  }

  k.kickHeld = input.kick && !stunned;
  k.kickCooldown = Math.max(0, k.kickCooldown - dt);
  k.bargeCooldown = Math.max(0, k.bargeCooldown - dt);

  k.x += k.vx * dt;
  k.y += k.vy * dt;
  // Knights may step into the goal mouth and a little past the touchlines, but no further.
  const inMouth = k.y > PITCH.goalTop && k.y < PITCH.goalBottom;
  const minX = (inMouth ? PITCH.left - PITCH.goalDepth : PITCH.left - 14) + k.radius;
  const maxX = (inMouth ? PITCH.right + PITCH.goalDepth : PITCH.right + 14) - k.radius;
  k.x = clamp(k.x, minX, maxX);
  k.y = clamp(k.y, PITCH.top - PITCH.runoff + k.radius, PITCH.bottom + PITCH.runoff - k.radius);

  if (Math.abs(k.vx) > 25) k.facing = k.vx > 0 ? 1 : -1;
  const moving = Math.hypot(k.vx, k.vy);
  k.runPhase = moving > 30 ? k.runPhase + (dt * moving) / 11 : 0;
}

/** Moves the ball and bounces it off the touchlines, goal lines and nets. */
export function stepBall(ball: Ball, dt: number): void {
  const keep = Math.pow(BALL.damping, dt);
  ball.vx *= keep;
  ball.vy *= keep;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.spin += (Math.hypot(ball.vx, ball.vy) * dt) / ball.radius;

  const r = ball.radius;
  const e = BALL.wallRestitution;
  if (ball.y < PITCH.top + r) {
    ball.y = PITCH.top + r;
    ball.vy = Math.abs(ball.vy) * e;
  } else if (ball.y > PITCH.bottom - r) {
    ball.y = PITCH.bottom - r;
    ball.vy = -Math.abs(ball.vy) * e;
  }

  const inMouth = ball.y > PITCH.goalTop && ball.y < PITCH.goalBottom;
  if (!inMouth) {
    if (ball.x < PITCH.left + r) {
      ball.x = PITCH.left + r;
      ball.vx = Math.abs(ball.vx) * e;
    } else if (ball.x > PITCH.right - r) {
      ball.x = PITCH.right - r;
      ball.vx = -Math.abs(ball.vx) * e;
    }
  }

  // Inside the goal the net holds the ball.
  if (ball.x < PITCH.left || ball.x > PITCH.right) {
    ball.y = clamp(ball.y, PITCH.goalTop + r, PITCH.goalBottom - r);
    if (ball.x < PITCH.left - PITCH.goalDepth + r) {
      ball.x = PITCH.left - PITCH.goalDepth + r;
      ball.vx = Math.abs(ball.vx) * BALL.netRestitution;
    } else if (ball.x > PITCH.right + PITCH.goalDepth - r) {
      ball.x = PITCH.right + PITCH.goalDepth - r;
      ball.vx = -Math.abs(ball.vx) * BALL.netRestitution;
    }
  }
}

export function capSpeed(body: Body, max: number): void {
  const speed = Math.hypot(body.vx, body.vy);
  if (speed > max) {
    body.vx *= max / speed;
    body.vy *= max / speed;
  }
}
