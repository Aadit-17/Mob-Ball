import { describe, expect, it } from 'vitest';
import { BALL, PITCH } from '../game/constants';
import { stepBall } from '../game/physics';
import type { Ball } from '../game/types';
import { bankShot, laneBlocked, predictBall } from './geometry';

const ballAt = (x: number, y: number, vx = 0, vy = 0): Ball => ({
  x,
  y,
  vx,
  vy,
  radius: BALL.radius,
  mass: BALL.mass,
  lastTouch: null,
  teamTouch: [null, null],
  spin: 0,
});

describe('laneBlocked', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };
  it('sees an obstacle sitting on the path', () => {
    expect(laneBlocked(from, to, [{ x: 50, y: 5, radius: 10 }], 5)).toBe(true);
  });
  it('ignores obstacles off to the side or behind', () => {
    expect(laneBlocked(from, to, [{ x: 50, y: 40, radius: 10 }], 5)).toBe(false);
    expect(laneBlocked(from, to, [{ x: -30, y: 0, radius: 10 }], 5)).toBe(false);
  });
});

describe('bankShot', () => {
  it('finds an aim that really does reach the target off the wall', () => {
    const from = { x: 400, y: 200 };
    const target = { x: 700, y: 260 };
    const wallY = PITCH.top + BALL.radius;
    const shot = bankShot(from, target, wallY, BALL.wallRestitution);
    expect(shot).not.toBeNull();
    if (!shot) return;
    const d = Math.hypot(shot.aim.x - from.x, shot.aim.y - from.y);
    const ball = ballAt(from.x, from.y, ((shot.aim.x - from.x) / d) * 680, ((shot.aim.y - from.y) / d) * 680);
    while (ball.x < target.x && Math.hypot(ball.vx, ball.vy) > 1) stepBall(ball, 1 / 240);
    expect(ball.y).toBeCloseTo(target.y, -1);
  });

  it('refuses when the target is on the far side of the wall line', () => {
    expect(bankShot({ x: 400, y: 200 }, { x: 700, y: 50 }, 80, 0.75)).toBeNull();
  });
});

describe('predictBall', () => {
  it('reflects the prediction off the touchline', () => {
    const ball = ballAt(500, PITCH.top + 30, 0, -400);
    expect(predictBall(ball, 0.3).y).toBeGreaterThan(PITCH.top + BALL.radius);
  });
});
