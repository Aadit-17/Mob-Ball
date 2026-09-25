import { describe, expect, it } from 'vitest';
import { BALL, PITCH } from './constants';
import { collide, stepBall } from './physics';
import type { Ball, Body } from './types';

const body = (x: number, vx: number, mass = 1): Body => ({ x, y: 0, vx, vy: 0, radius: 10, mass });
const ball = (x: number, y: number, vx: number, vy: number): Ball => ({
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

describe('collide', () => {
  it('swaps velocities of equal masses in a perfectly elastic head-on hit', () => {
    const a = body(0, 100);
    const b = body(19, -50);
    expect(collide(a, b, 1)).toBe(true);
    expect(a.vx).toBeCloseTo(-50);
    expect(b.vx).toBeCloseTo(100);
  });

  it('never moves an infinitely heavy goalpost', () => {
    const post = body(0, 0, Infinity);
    const b = body(15, -200);
    collide(b, post, 0.6);
    expect(post.x).toBe(0);
    expect(post.vx).toBe(0);
    expect(b.vx).toBeCloseTo(120);
  });

  it('ignores bodies that are not touching', () => {
    expect(collide(body(0, 0), body(21, 0), 1)).toBe(false);
  });
});

describe('stepBall', () => {
  it('bounces off the touchline, losing a quarter of its speed', () => {
    const b = ball(400, PITCH.top + BALL.radius + 0.5, 0, -200);
    stepBall(b, 1 / 120);
    expect(b.vy).toBeGreaterThan(0);
    expect(b.vy).toBeCloseTo(200 * Math.pow(BALL.damping, 1 / 120) * BALL.wallRestitution, 0);
  });

  it('bounces off the goal line outside the mouth', () => {
    const b = ball(PITCH.left + BALL.radius + 0.5, PITCH.goalTop - 40, -300, 0);
    stepBall(b, 1 / 120);
    expect(b.vx).toBeGreaterThan(0);
  });

  it('rolls through the goal mouth and is held by the net', () => {
    const b = ball(PITCH.left + 20, PITCH.centerY, -600, 0);
    for (let i = 0; i < 60; i++) stepBall(b, 1 / 120);
    expect(b.x).toBeLessThan(PITCH.left);
    expect(b.x).toBeGreaterThanOrEqual(PITCH.left - PITCH.goalDepth + BALL.radius);
  });
});
