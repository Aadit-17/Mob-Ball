import { describe, expect, it } from 'vitest';
import { BALL, PITCH, STEP } from '../game/constants';
import { createMatch, stepMatch } from '../game/match';
import { NO_INPUT } from '../game/types';
import { spec } from '../test/fixtures';
import { BotBrain } from './brain';
import { TIERS, TOP_TIER } from './skills';

/** A bot on the ball with it pinned against the top touchline and a rival closing in. */
function pinnedOnWall(tier: number) {
  const state = createMatch({ home: [spec('fwd', { tier })], away: [spec('def', { tier: 0 })], seed: 3 });
  state.phase = 'play';
  const [bot, rival] = state.knights;
  if (!bot || !rival) throw new Error('missing knights');
  Object.assign(state.ball, { x: 500, y: PITCH.top + BALL.radius + 4 });
  Object.assign(bot, { x: 500, y: PITCH.top + BALL.radius + 4 + bot.radius + BALL.radius + 2 });
  Object.assign(rival, { x: 610, y: PITCH.top + 60 });
  const brain = new BotBrain();
  let closestToWall = state.ball.y;
  for (let t = 0; t < 1.2; t += STEP) {
    stepMatch(state, (k) => (k === bot ? brain.input(state, k) : NO_INPUT));
    closestToWall = Math.min(closestToWall, state.ball.y);
  }
  return { ball: state.ball, closestToWall };
}

describe('wall lift', () => {
  it('Legends tap the ball off the wall and carry it into the middle', () => {
    const { ball } = pinnedOnWall(TOP_TIER);
    expect(ball.y).toBeGreaterThan(PITCH.top + 80);
  });

  it('is a top-tier technique only', () => {
    expect(TIERS.filter((t) => t.wallLift).map((t) => t.name)).toEqual(['Legend']);
  });
});

describe('own goals', () => {
  /** A bot standing upfield of a loose ball that sits just in front of its own goal. */
  function ballBehindDefender(role: 'gk' | 'def', ballY: number) {
    const state = createMatch({
      home: [spec(role, { tier: TOP_TIER })],
      away: [spec('fwd', { tier: 0 })],
      seed: 7,
    });
    state.phase = 'play';
    const [bot, rival] = state.knights;
    if (!bot || !rival) throw new Error('missing knights');
    Object.assign(state.ball, { x: PITCH.left + 45, y: ballY, vx: 0, vy: 0 });
    Object.assign(bot, { x: PITCH.left + 110, y: ballY });
    Object.assign(rival, { x: PITCH.right - 100, y: PITCH.centerY });
    const brain = new BotBrain();
    for (let t = 0; t < 3; t += STEP) stepMatch(state, (k) => (k === bot ? brain.input(state, k) : NO_INPUT));
    return state;
  }

  it.each([
    ['gk', PITCH.centerY],
    ['gk', PITCH.goalTop + 20],
    ['def', PITCH.centerY],
    ['def', PITCH.goalBottom - 20],
  ] as const)('a %s with the ball behind it (y=%i) gets round it instead of pushing it in', (role, y) => {
    const state = ballBehindDefender(role, y);
    expect(state.score).toEqual([0, 0]);
  });
});

describe('opening a shooting lane', () => {
  /** A bot in shooting range with a defender standing square in its lane to goal. */
  function blockedShooter(tier: number) {
    const state = createMatch({ home: [spec('fwd', { tier })], away: [spec('def', { tier: 0 })], seed: 12 });
    state.phase = 'play';
    const [shooter, blocker] = state.knights;
    if (!shooter || !blocker) throw new Error('missing knights');
    Object.assign(shooter, { x: PITCH.right - 250, y: PITCH.centerY });
    Object.assign(state.ball, { x: PITCH.right - 250 + shooter.radius + BALL.radius + 1, y: PITCH.centerY });
    Object.assign(blocker, { x: PITCH.right - 120, y: PITCH.centerY });
    const brain = new BotBrain();
    let blockerTouched = false;
    for (let t = 0; t < 4 && state.score[0] === 0; t += STEP) {
      stepMatch(state, (k) => (k === shooter ? brain.input(state, k) : NO_INPUT));
      blockerTouched ||= state.ball.teamTouch[1] !== null;
    }
    return { state, blockerTouched };
  }

  it('a Knight dribbles to open a lane and scores past a static defender, never shooting into him', () => {
    const { state, blockerTouched } = blockedShooter(2);
    expect(blockerTouched).toBe(false);
    expect(state.score).toEqual([1, 0]);
  });

  it('is a Knight-and-above skill', () => {
    expect(TIERS.map((t) => t.opensLanes)).toEqual([false, false, true, true, true]);
  });
});

describe('forward runs', () => {
  it('a midfielder whose teammate has the ball runs into open space ahead of it', () => {
    const state = createMatch({
      home: [spec('mid', { tier: TOP_TIER }), spec('fwd', { human: true })],
      away: [spec('def', { tier: 0 })],
      seed: 4,
    });
    state.phase = 'play';
    const [runner, carrier, defender] = state.knights;
    if (!runner || !carrier || !defender) throw new Error('missing knights');
    Object.assign(carrier, { x: 560, y: PITCH.centerY });
    Object.assign(state.ball, { x: 560 + carrier.radius + BALL.radius + 1, y: PITCH.centerY });
    Object.assign(runner, { x: 450, y: PITCH.centerY + 120 });
    Object.assign(defender, { x: 760, y: PITCH.centerY });
    const brain = new BotBrain();
    for (let t = 0; t < 1.2; t += STEP)
      stepMatch(state, (k) => (k === runner ? brain.input(state, k) : NO_INPUT));
    expect(runner.x).toBeGreaterThan(state.ball.x + 60);
    expect(Math.hypot(runner.x - defender.x, runner.y - defender.y)).toBeGreaterThan(90);
  });
});

describe('passing', () => {
  it('a Knight passes to an open teammate when the shot is blocked', () => {
    const state = createMatch({
      home: [spec('def', { tier: 2 }), spec('fwd', { tier: 2 })],
      away: [spec('def', { tier: 0 })],
      seed: 5,
    });
    state.phase = 'play';
    const [carrier, mate, blocker] = state.knights;
    if (!carrier || !mate || !blocker) throw new Error('missing knights');
    Object.assign(carrier, { x: 700, y: PITCH.centerY + 6 });
    Object.assign(state.ball, { x: 700 + carrier.radius + BALL.radius + 1, y: PITCH.centerY });
    Object.assign(blocker, { x: 800, y: PITCH.centerY });
    Object.assign(mate, { x: 880, y: PITCH.centerY - 170 });
    const brain = new BotBrain();
    let reachedMate = false;
    for (let t = 0; t < 2 && !reachedMate; t += STEP) {
      stepMatch(state, (k) => (k === blocker ? NO_INPUT : k === mate ? NO_INPUT : brain.input(state, k)));
      reachedMate = state.ball.lastTouch === mate.id;
    }
    expect(reachedMate).toBe(true);
  });

  it('a Peasant never passes', () => {
    expect(TIERS[0]?.passing).toBe('never');
  });
});

describe('skill tiers', () => {
  it('get strictly quicker and more accurate with each tier', () => {
    for (let i = 1; i < TIERS.length; i++) {
      const [prev, next] = [TIERS[i - 1], TIERS[i]];
      expect(next?.reaction).toBeLessThan(prev?.reaction ?? 0);
      expect(next?.aimError).toBeLessThan(prev?.aimError ?? 0);
    }
  });
});

describe('a full bot match', () => {
  it('plays 90 seconds of 4v4 without the ball escaping or anything going NaN', () => {
    const roles = ['gk', 'def', 'mid', 'fwd'] as const;
    const state = createMatch({
      home: roles.map((r, i) => spec(r, { tier: i + 1 })),
      away: roles.map((r, i) => spec(r, { tier: 4 - i })),
      seed: 11,
    });
    const brain = new BotBrain();
    for (let t = 0; t < 200 && state.phase !== 'ended'; t += STEP) {
      stepMatch(state, (k) => brain.input(state, k));
      for (const b of [...state.knights, state.ball]) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      }
      expect(state.ball.y).toBeGreaterThanOrEqual(PITCH.top);
      expect(state.ball.y).toBeLessThanOrEqual(PITCH.bottom);
    }
    expect(state.phase).toBe('ended');
  });
});
