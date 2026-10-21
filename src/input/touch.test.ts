import { describe, expect, it } from 'vitest';
import { STEP } from '../game/constants';
import { stepKnight } from '../game/physics';
import type { Input } from '../game/types';
import { liveDuel } from '../test/fixtures';
import { followThumb, knobOffset, STICK, stickMove, touchInput } from './stick';

const NO_BUTTONS = { kickHeld: false, bargeHeld: false, bargeTapped: false };
const length = (v: { x: number; y: number }): number => Math.hypot(v.x, v.y);

/** The speed a knight settles at after two seconds of this input, with the ball far away. */
function topSpeed(input: Input): number {
  const { state, home } = liveDuel();
  state.ball.x = -1000;
  for (let t = 0; t < 2; t += STEP) stepKnight(home, input, state.ball, STEP);
  return Math.hypot(home.vx, home.vy);
}

describe('stick mapping', () => {
  it('ignores a thumb resting inside the dead zone', () => {
    const inside = STICK.radius * STICK.deadZone * 0.95;
    expect(stickMove(inside, 0)).toEqual({ x: 0, y: 0 });
    expect(stickMove(0, -inside)).toEqual({ x: 0, y: 0 });
  });

  it('reaches full speed well before the edge of the ring', () => {
    const full = stickMove(STICK.radius * STICK.fullAt, 0);
    expect(full.x).toBeCloseTo(1);
    expect(STICK.fullAt).toBeLessThanOrEqual(0.7);
    expect(length(stickMove(STICK.radius * 3, STICK.radius * 3))).toBeCloseTo(1);
  });

  it('is analog between the dead zone and full speed, in the thumb direction', () => {
    const halfway = ((STICK.deadZone + STICK.fullAt) / 2) * STICK.radius;
    const move = stickMove(0, halfway);
    expect(move.x).toBe(0);
    expect(move.y).toBeCloseTo(0.5);
    const diagonal = stickMove(-STICK.radius, -STICK.radius);
    expect(diagonal.x).toBeCloseTo(diagonal.y);
    expect(diagonal.x).toBeLessThan(0);
  });

  it('runs a knight as fast as the keyboard does, and slower on a partial push', () => {
    const keyboard = topSpeed({ moveX: 1, moveY: 0, kick: false, barge: false });
    const fullStick = topSpeed(touchInput(stickMove(STICK.radius * STICK.fullAt, 0), NO_BUTTONS));
    const halfStick = topSpeed(touchInput(stickMove(STICK.radius * 0.37, 0), NO_BUTTONS));
    expect(fullStick).toBeCloseTo(keyboard, 6);
    expect(halfStick).toBeLessThan(keyboard * 0.75);
    expect(halfStick).toBeGreaterThan(keyboard * 0.25);
  });

  it('keeps the knob on the ring and drags the centre after a thumb that leaves it', () => {
    expect(knobOffset(10, 0, 50)).toEqual({ x: 10, y: 0 });
    expect(knobOffset(0, 200, 50)).toEqual({ x: 0, y: 50 });
    const centre = { x: 100, y: 100 };
    expect(followThumb(centre, { x: 120, y: 100 }, 50)).toBe(centre);
    expect(followThumb(centre, { x: 100, y: 250 }, 50)).toEqual({ x: 100, y: 200 });
  });
});

describe('touch buttons', () => {
  it('holds kick while the button is held, like Space', () => {
    expect(touchInput({ x: 0, y: 0 }, { ...NO_BUTTONS, kickHeld: true }).kick).toBe(true);
    expect(touchInput({ x: 0, y: 0 }, NO_BUTTONS).kick).toBe(false);
  });

  it('barges on a tap even if the finger lifted before the step read it', () => {
    expect(touchInput({ x: 0, y: 0 }, { ...NO_BUTTONS, bargeTapped: true }).barge).toBe(true);
    expect(touchInput({ x: 0, y: 0 }, { ...NO_BUTTONS, bargeHeld: true }).barge).toBe(true);
    expect(touchInput({ x: 0, y: 0 }, NO_BUTTONS).barge).toBe(false);
  });

  it('barges a knight toward the stick direction', () => {
    const { state, home } = liveDuel();
    state.ball.x = home.x - 300;
    const input = touchInput(stickMove(0, STICK.radius), { ...NO_BUTTONS, bargeTapped: true });
    stepKnight(home, input, state.ball, STEP);
    expect(home.bargeTime).toBeGreaterThan(0);
    expect(home.bargeDirY).toBeCloseTo(1);
  });
});
