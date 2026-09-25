import { describe, expect, it } from 'vitest';
import { BotBrain } from '../ai/brain';
import { liveDuel, spec } from '../test/fixtures';
import { KNIGHT, MATCH, PITCH, STEP } from './constants';
import { createMatch, kickDirection, stepMatch } from './match';
import { NO_INPUT, type Input, type Knight, type MatchState } from './types';

const idle = (): Input => NO_INPUT;
const run = (state: MatchState, seconds: number, input: (k: Knight) => Input = idle) => {
  for (let t = 0; t < seconds; t += STEP) stepMatch(state, input);
};

describe('match flow', () => {
  it('holds play for the kick-off pause, then goes live', () => {
    const state = createMatch({ home: [spec('fwd')], away: [spec('fwd')], seed: 1 });
    run(state, MATCH.kickoffPause - 0.1);
    expect(state.phase).toBe('kickoff');
    run(state, 0.2);
    expect(state.phase).toBe('play');
  });

  it('credits a goal to the last knight to touch the ball', () => {
    const { state, home } = liveDuel();
    Object.assign(state.ball, { x: PITCH.right - 2, y: PITCH.centerY, vx: 400, vy: 0, lastTouch: home.id });
    run(state, 0.2);
    expect(state.score).toEqual([1, 0]);
    expect(state.phase).toBe('goal');
    expect(state.events).toContainEqual({ type: 'goal', team: 0, scorerId: home.id, ownGoal: false });
  });

  it('marks an own goal when the defending side touched it last', () => {
    const { state, away } = liveDuel();
    Object.assign(state.ball, { x: PITCH.right - 2, y: PITCH.centerY, vx: 400, vy: 0, lastTouch: away.id });
    run(state, 0.2);
    expect(state.events).toContainEqual({ type: 'goal', team: 0, scorerId: away.id, ownGoal: true });
  });

  it('credits a shot that deflects in off a defender to the shooter', () => {
    const { state, home, away } = liveDuel();
    Object.assign(home, { x: PITCH.right - 200, y: PITCH.centerY });
    Object.assign(away, { x: PITCH.right - 60, y: PITCH.centerY + 26 });
    Object.assign(state.ball, {
      x: PITCH.right - 200 + home.radius + state.ball.radius + 2,
      y: PITCH.centerY,
    });
    stepMatch(state, (k) => (k === home ? { ...NO_INPUT, kick: true } : NO_INPUT));
    run(state, 1.2);
    expect(state.ball.lastTouch).toBe(away.id);
    expect(state.events).toContainEqual({ type: 'goal', team: 0, scorerId: home.id, ownGoal: false });
  });

  it('credits a dribble that deflects in off a defender to the dribbler', () => {
    const { state, home, away } = liveDuel();
    Object.assign(state.ball, {
      x: PITCH.right - 2,
      y: PITCH.centerY,
      vx: 300,
      vy: 0,
      lastTouch: away.id,
      teamTouch: [
        { knightId: home.id, age: 0.4 },
        { knightId: away.id, age: 0 },
      ],
    });
    run(state, 0.2);
    expect(state.events).toContainEqual({ type: 'goal', team: 0, scorerId: home.id, ownGoal: false });
  });

  it('still calls it an own goal when nobody on the scoring side shot recently', () => {
    const { state, home, away } = liveDuel();
    Object.assign(home, { x: PITCH.right - 200, y: PITCH.centerY });
    Object.assign(state.ball, {
      x: PITCH.right - 200 + home.radius + state.ball.radius + 2,
      y: PITCH.centerY,
    });
    stepMatch(state, (k) => (k === home ? { ...NO_INPUT, kick: true } : NO_INPUT));
    Object.assign(state.ball, { x: PITCH.left + 400, vx: 0, vy: 0 });
    run(state, 2);
    Object.assign(state.ball, { x: PITCH.right - 2, y: PITCH.centerY, vx: 400, vy: 0, lastTouch: away.id });
    run(state, 0.2);
    expect(state.events).toContainEqual({ type: 'goal', team: 0, scorerId: away.id, ownGoal: true });
  });

  it('does not score when the ball hits the goal line outside the mouth', () => {
    const { state } = liveDuel();
    Object.assign(state.ball, { x: PITCH.right - 20, y: PITCH.goalTop - 40, vx: 500, vy: 0 });
    run(state, 0.3);
    expect(state.score).toEqual([0, 0]);
  });

  it('goes to golden goal on a draw at full time, and ends on the next goal', () => {
    const state = createMatch({ home: [spec('fwd')], away: [spec('fwd')], seed: 1, duration: 2 });
    run(state, MATCH.kickoffPause + 2.1);
    expect(state.goldenGoal).toBe(true);
    expect(state.phase).toBe('play');
    expect(state.events).toContainEqual({ type: 'golden-goal' });
    Object.assign(state.ball, { x: PITCH.left + 2, y: PITCH.centerY, vx: -400, vy: 0 });
    run(state, MATCH.celebration + 0.3);
    expect(state.phase).toBe('ended');
    expect(state.score).toEqual([0, 1]);
  });

  it('ends at full time when one side leads', () => {
    const state = createMatch({ home: [spec('fwd')], away: [spec('fwd')], seed: 1, duration: 1 });
    state.score[0] = 1;
    run(state, MATCH.kickoffPause + 1.1);
    expect(state.phase).toBe('ended');
    expect(state.events).toContainEqual({ type: 'full-time' });
  });
});

describe('barging', () => {
  it('stuns an opponent it hits and records the hit', () => {
    const { state, home, away } = liveDuel();
    Object.assign(home, { x: 500, y: 300 });
    Object.assign(away, { x: 540, y: 300 });
    stepMatch(state, (k) => (k === home ? { moveX: 1, moveY: 0, kick: false, barge: true } : NO_INPUT));
    run(state, 0.1);
    expect(away.stun).toBeGreaterThan(0);
    expect(state.events.some((e) => e.type === 'barge' && e.victimId === away.id)).toBe(true);
  });

  it('never stuns a teammate', () => {
    const state = createMatch({ home: [spec('def'), spec('fwd')], away: [spec('fwd')], seed: 1 });
    state.phase = 'play';
    const [a, b] = state.knights;
    if (!a || !b) throw new Error('missing knights');
    Object.assign(a, { x: 500, y: 300 });
    Object.assign(b, { x: 540, y: 300 });
    stepMatch(state, (k) => (k === a ? { moveX: 1, moveY: 0, kick: false, barge: true } : NO_INPUT));
    run(state, 0.1);
    expect(b.stun).toBe(0);
  });
});

describe('kicking', () => {
  it('sends the ball away from the kicker at kick power', () => {
    const { state, home } = liveDuel();
    Object.assign(home, { x: 500, y: 300 });
    Object.assign(state.ball, { x: 500 + home.radius + state.ball.radius + 2, y: 300 });
    stepMatch(state, (k) => (k === home ? { ...NO_INPUT, kick: true } : NO_INPUT));
    expect(state.ball.vx).toBeGreaterThan(KNIGHT.kickPower * 0.9);
    expect(Math.abs(state.ball.vy)).toBeLessThan(1);
  });

  it('hits shots at goal from close range harder than passes', () => {
    const kickSpeed = (fromGoal: number, towardGoal: boolean) => {
      const { state, home } = liveDuel();
      const y = towardGoal ? PITCH.centerY : PITCH.top + 60;
      Object.assign(home, { x: PITCH.right - fromGoal - 30, y });
      Object.assign(state.ball, { x: PITCH.right - fromGoal, y, vx: 0, vy: 0 });
      stepMatch(state, (k) => (k === home ? { ...NO_INPUT, kick: true } : NO_INPUT));
      return Math.hypot(state.ball.vx, state.ball.vy);
    };
    const pass = kickSpeed(700, true);
    expect(kickSpeed(250, true)).toBeGreaterThan(pass * 1.3);
    expect(kickSpeed(250, false)).toBeCloseTo(pass, 0);
  });

  it('adds power to a first-time kick of a moving ball', () => {
    const kickSpeed = (incoming: number) => {
      const { state, home, away } = liveDuel();
      const y = PITCH.top + 60;
      Object.assign(home, { x: 500, y });
      Object.assign(state.ball, {
        x: 500 + home.radius + state.ball.radius + 1,
        y,
        vx: -incoming,
        vy: 0,
        lastTouch: away.id,
      });
      stepMatch(state, (k) => (k === home ? { ...NO_INPUT, kick: true } : NO_INPUT));
      return state.ball.vx;
    };
    const controlled = kickSpeed(0);
    expect(kickSpeed(300)).toBeGreaterThan(controlled * 1.15);
  });

  it("bends the human's shots toward the open side of goal, but not a bot's", () => {
    const shotAt = (human: boolean) => {
      const state = createMatch({ home: [spec('fwd', { human })], away: [spec('gk')], seed: 1 });
      const [shooter, keeper] = state.knights;
      if (!shooter || !keeper) throw new Error('missing knights');
      Object.assign(keeper, { x: PITCH.right - 30, y: PITCH.centerY + 40 });
      Object.assign(shooter, { x: PITCH.right - 300, y: PITCH.centerY });
      Object.assign(state.ball, { x: PITCH.right - 270, y: PITCH.centerY });
      return kickDirection(state, shooter);
    };
    expect(shotAt(false).y).toBeCloseTo(0);
    // Keeper stands low, so the assisted shot goes high (negative y).
    expect(shotAt(true).y).toBeLessThan(-0.1);
  });
});

describe('determinism', () => {
  it('replays identically from the same seed', () => {
    const play = () => {
      const state = createMatch({
        home: [spec('gk'), spec('def'), spec('fwd')],
        away: [spec('gk'), spec('def'), spec('fwd')],
        seed: 42,
      });
      const brain = new BotBrain();
      run(state, 20, (k) => brain.input(state, k));
      return state.knights.map((k) => [k.x, k.y]).concat([[state.ball.x, state.ball.y]]);
    };
    expect(play()).toEqual(play());
  });
});
