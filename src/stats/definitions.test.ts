import { describe, expect, it } from 'vitest';
import { PITCH } from '../game/constants';
import { createMatch } from '../game/match';
import type { Ball } from '../game/types';
import {
  DANGER_ZONE,
  PROGRESSIVE_GAIN,
  SHOT_RANGE,
  SHOT_WIDE_MARGIN,
  ballFate,
  inDangerZone,
  isProgressive,
  readKick,
} from './definitions';

const { posts, ball: centre } = createMatch({ home: [], away: [], seed: 1 });
const ballAt = (x: number, y: number, vx: number, vy: number): Ball => ({ ...centre, x, y, vx, vy });
/** A ball at (x, y) heading for a point on the right-hand goal line at `speed`. */
function toward(x: number, y: number, lineY: number, speed = 600): Ball {
  const dx = PITCH.right - x;
  const dy = lineY - y;
  const d = Math.hypot(dx, dy);
  return ballAt(x, y, (dx / d) * speed, (dy / d) * speed);
}

describe('ballFate', () => {
  it('follows an untouched ball into the net', () => {
    const fate = ballFate(toward(900, 330, 330), posts);
    expect(fate.goal).toBe(0);
    expect(fate.lineIn).toBeLessThanOrEqual(fate.deadIn);
  });

  it('lets a ball that runs out of pace die short of goal', () => {
    const fate = ballFate(toward(500, 330, 330, 300), posts);
    expect(fate.goal).toBeNull();
    expect(fate.lineIn).toBe(Infinity);
    expect(fate.deadIn).toBeLessThan(600);
  });

  it('plays bounces off the boards: a ball banked in off the top board scores', () => {
    const a = (-60 * Math.PI) / 180;
    const ball = ballAt(1000, 120, Math.cos(a) * 600, Math.sin(a) * 600);
    const straightLineY = ball.y + (ball.vy * (PITCH.right - ball.x)) / ball.vx;
    expect(straightLineY).toBeLessThan(PITCH.goalTop);
    expect(ballFate(ball, posts).goal).toBe(0);
  });

  it('never moves the posts', () => {
    const before = JSON.stringify(posts);
    ballFate(toward(1100, 300, PITCH.goalTop), posts);
    expect(JSON.stringify(posts)).toBe(before);
  });
});

describe('readKick', () => {
  it('reads a kick that would score as a shot on target', () => {
    expect(readKick(toward(900, 330, 300), posts, 0)).toMatchObject({ shot: true, onTarget: true });
  });

  it('reads a kick just wide, within the margin, as a shot off target', () => {
    const wide = readKick(toward(900, 330, PITCH.goalBottom + SHOT_WIDE_MARGIN - 20), posts, 0);
    expect(wide).toMatchObject({ shot: true, onTarget: false });
  });

  it('reads a kick wider than the margin as no shot', () => {
    const wider = readKick(toward(900, 330, PITCH.goalBottom + SHOT_WIDE_MARGIN + 20), posts, 0);
    expect(wider.shot).toBe(false);
  });

  it('reads a kick from beyond shooting range as no shot, even one that would score', () => {
    const far = toward(PITCH.right - SHOT_RANGE - 30, 330, 330, 680);
    expect(ballFate(far, posts).goal).toBe(0);
    expect(readKick(far, posts, 0).shot).toBe(false);
  });

  it('reads a kick banked in off the boards as on target', () => {
    const a = (-60 * Math.PI) / 180;
    const bank = ballAt(1000, 120, Math.cos(a) * 600, Math.sin(a) * 600);
    expect(readKick(bank, posts, 0)).toMatchObject({ shot: true, onTarget: true });
  });

  it('reads shots for the side attacking left too', () => {
    const ball = ballAt(300, 330, -600, 0);
    expect(readKick(ball, posts, 1)).toMatchObject({ shot: true, onTarget: true });
    expect(readKick(ball, posts, 0)).toMatchObject({ shot: false, clearance: false });
  });

  it('marks a kick away from your own danger zone as a possible clearance, and one toward it not', () => {
    expect(readKick(ballAt(PITCH.left + 100, 330, 500, 100), posts, 0).clearance).toBe(true);
    expect(readKick(ballAt(PITCH.left + 100, 330, -500, 100), posts, 0).clearance).toBe(false);
    expect(readKick(ballAt(PITCH.left + DANGER_ZONE + 50, 330, 500, 0), posts, 0).clearance).toBe(false);
  });
});

describe('zones', () => {
  it('measure the danger zone from your own goal line', () => {
    expect(inDangerZone({ x: PITCH.left + DANGER_ZONE, y: 330 }, 0)).toBe(true);
    expect(inDangerZone({ x: PITCH.left + DANGER_ZONE + 1, y: 330 }, 0)).toBe(false);
    expect(inDangerZone({ x: PITCH.right - DANGER_ZONE, y: 100 }, 1)).toBe(true);
  });

  it('call a pass progressive when it gains PROGRESSIVE_GAIN on the rival goal, either way round', () => {
    const from = { x: 500, y: 330 };
    expect(isProgressive(from, { x: 500 + PROGRESSIVE_GAIN + 1, y: 330 }, 0)).toBe(true);
    expect(isProgressive(from, { x: 500 + PROGRESSIVE_GAIN - 1, y: 330 }, 0)).toBe(false);
    expect(isProgressive(from, { x: 500 - PROGRESSIVE_GAIN - 1, y: 330 }, 1)).toBe(true);
    // From the wing into the middle gains ground on goal without going forward.
    expect(isProgressive({ x: 1100, y: 75 }, { x: 1100, y: 330 }, 0)).toBe(true);
  });
});
