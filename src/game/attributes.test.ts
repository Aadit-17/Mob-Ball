import { describe, expect, it } from 'vitest';
import { liveDuel, spec } from '../test/fixtures';
import {
  ATTRIBUTE_CAPS,
  ATTRIBUTES,
  bargeCooldownOf,
  BARGE_CAP,
  capAttributes,
  fatigueFactor,
  knockbackOf,
  levelOf,
  NO_ATTRIBUTES,
  PACE_CAP,
  paceFactor,
  SHOT_CAP,
  shotFactor,
  STAMINA_CAP,
  STRENGTH_CAP,
  strengthFactor,
  stunOf,
  type Attributes,
} from './attributes';
import { BUILDS, KNIGHT, PITCH, STEP } from './constants';
import { createMatch, stepMatch, type KnightSpec } from './match';
import { collide, stepKnight } from './physics';
import { NO_INPUT, type Role } from './types';
import { MatchRunner } from '../modes/runner';
import { setTeamTier } from '../setup/squads';

const only = (attribute: keyof Attributes, level: number): Attributes => ({
  ...NO_ATTRIBUTES,
  [attribute]: level,
});
const MAXED: Attributes = {
  pace: PACE_CAP,
  shot: SHOT_CAP,
  strength: STRENGTH_CAP,
  barge: BARGE_CAP,
  stamina: STAMINA_CAP,
};
const ROLES: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];

/** A whole bot match, every ball and knight position each step, so any difference at all shows. */
function trace(home: readonly KnightSpec[], away: readonly KnightSpec[], seed: number): string {
  const runner = new MatchRunner({ home, away, seed });
  const steps: string[] = [];
  while (!runner.ended && steps.length < 30_000) {
    runner.advanceOne();
    const { ball, knights } = runner.state;
    steps.push([ball.x, ball.y, ...knights.flatMap((k) => [k.x, k.y, k.stun, k.bargeCooldown])].join(','));
  }
  return `${runner.state.score.join('-')}|${steps.join(';')}`;
}

describe('a knight without attributes', () => {
  it('has factors of exactly 1, so the engine multiplies by nothing', () => {
    expect(paceFactor(NO_ATTRIBUTES)).toBe(1);
    expect(shotFactor(NO_ATTRIBUTES)).toBe(1);
    expect(strengthFactor(NO_ATTRIBUTES)).toBe(1);
    expect(bargeCooldownOf(NO_ATTRIBUTES)).toBe(KNIGHT.bargeCooldown);
    expect(knockbackOf(NO_ATTRIBUTES, NO_ATTRIBUTES)).toBe(KNIGHT.knockback);
    expect(stunOf(NO_ATTRIBUTES, NO_ATTRIBUTES)).toBe(KNIGHT.stunDuration);
  });

  it('weighs exactly his build', () => {
    const state = createMatch({
      home: BUILDS.map((_, build) => spec('mid', { look: { ...spec('mid').look, build } })),
      away: [spec('fwd')],
      seed: 1,
    });
    BUILDS.forEach((b, i) => {
      expect(state.knights[i]?.mass).toBe(b.mass);
    });
  });

  it('plays a whole match step for step as one given no training at all', () => {
    const plain = setTeamTier(
      ROLES.map((r) => spec(r)),
      3,
    );
    const zero = plain.map((s) => ({ ...s, attributes: NO_ATTRIBUTES }));
    expect(trace(zero, zero, 7)).toBe(trace(plain, plain, 7));
  });

  it('plays a whole match step for step the same with only stamina trained: the match never reads it', () => {
    const plain = setTeamTier(
      ROLES.map((r) => spec(r)),
      2,
    );
    const rested = plain.map((s) => ({ ...s, attributes: only('stamina', STAMINA_CAP) }));
    expect(trace(rested, plain, 3)).toBe(trace(plain, plain, 3));
  });
});

describe('each attribute changes its own physics', () => {
  it('pace: runs faster, by exactly his pace factor', () => {
    const speedAfter = (attributes: Attributes): number => {
      const { state, home } = liveDuel({ attributes });
      Object.assign(home, { x: 300, y: 300 });
      for (let t = 0; t < 0.5; t += STEP) stepKnight(home, { ...NO_INPUT, moveX: 1 }, state.ball, STEP);
      return home.vx;
    };
    expect(speedAfter(only('pace', PACE_CAP)) / speedAfter(NO_ATTRIBUTES)).toBeCloseTo(
      paceFactor(only('pace', PACE_CAP)),
      10,
    );
    expect(paceFactor(only('pace', PACE_CAP))).toBeGreaterThan(1);
  });

  it('shot: kicks harder, by exactly his shot factor, even past the usual top ball speed', () => {
    const kickSpeed = (attributes: Attributes): number => {
      const { state, home } = liveDuel({ attributes });
      Object.assign(home, { x: 500, y: PITCH.top + 60 });
      Object.assign(state.ball, { x: 500 + home.radius + state.ball.radius + 2, y: PITCH.top + 60 });
      stepMatch(state, (k) => (k === home ? { ...NO_INPUT, kick: true } : NO_INPUT));
      return Math.hypot(state.ball.vx, state.ball.vy);
    };
    const factor = shotFactor(only('shot', SHOT_CAP));
    expect(kickSpeed(NO_ATTRIBUTES)).toBeCloseTo(KNIGHT.kickPower, 6);
    expect(kickSpeed(only('shot', SHOT_CAP))).toBeCloseTo(KNIGHT.kickPower * factor, 6);
  });

  it('strength: heavier, so he is moved less in a collision', () => {
    const { home, away } = liveDuel({ attributes: only('strength', STRENGTH_CAP) });
    expect(home.mass).toBeCloseTo(away.mass * strengthFactor(only('strength', STRENGTH_CAP)), 12);
    Object.assign(home, { x: 300, y: 300, vx: 100, vy: 0 });
    Object.assign(away, { x: 300 + home.radius + away.radius - 1, y: 300, vx: -100, vy: 0 });
    collide(home, away, KNIGHT.restitution);
    expect(home.vx).toBeGreaterThan(0);
    expect((100 - home.vx) / (away.vx + 100)).toBeCloseTo(away.mass / home.mass, 10);
  });

  it('strength: knocks a weaker knight further, and is knocked back less and stunned less himself', () => {
    const barged = (attacker: Attributes, victim: Attributes): { speed: number; stun: number } => {
      const { state, home, away } = liveDuel({ attributes: attacker }, { attributes: victim });
      Object.assign(home, { x: 500, y: 200 });
      Object.assign(away, { x: 540, y: 200 });
      for (let i = 0; i < 60 && !state.events.some((e) => e.type === 'barge'); i++)
        stepMatch(state, (k) => (k === home ? { moveX: 1, moveY: 0, kick: false, barge: true } : NO_INPUT));
      return { speed: Math.hypot(away.vx, away.vy), stun: away.stun };
    };
    const strong = only('strength', STRENGTH_CAP);
    const plain = barged(NO_ATTRIBUTES, NO_ATTRIBUTES);
    expect(plain.speed).toBeCloseTo(KNIGHT.knockback, 6);
    expect(plain.stun).toBeCloseTo(KNIGHT.stunDuration, 6);
    const ratio = strengthFactor(strong);
    const byStrong = barged(strong, NO_ATTRIBUTES);
    expect(byStrong.speed).toBeCloseTo(KNIGHT.knockback * ratio, 6);
    expect(byStrong.stun).toBeCloseTo(KNIGHT.stunDuration, 6);
    const onStrong = barged(NO_ATTRIBUTES, strong);
    expect(onStrong.speed).toBeCloseTo(KNIGHT.knockback / ratio, 6);
    expect(onStrong.stun).toBeCloseTo(KNIGHT.stunDuration / ratio, 6);
  });

  it('barge: barges again sooner, after exactly his cooldown', () => {
    const readyAfter = (attributes: Attributes): number => {
      const { state, home } = liveDuel({ attributes });
      Object.assign(home, { x: 300, y: 300 });
      const input = { ...NO_INPUT, barge: true };
      stepKnight(home, input, state.ball, STEP);
      let steps = 0;
      while (home.bargeCooldown > 0) {
        stepKnight(home, NO_INPUT, state.ball, STEP);
        steps++;
      }
      return steps * STEP;
    };
    // Ready on the first step the cooldown has run out: within one step of it.
    const within = (a: number, b: number): boolean => Math.abs(a - b) <= STEP;
    const quick = only('barge', BARGE_CAP);
    expect(within(readyAfter(NO_ATTRIBUTES) + STEP, KNIGHT.bargeCooldown)).toBe(true);
    expect(within(readyAfter(quick) + STEP, bargeCooldownOf(quick))).toBe(true);
    expect(bargeCooldownOf(quick)).toBeLessThan(KNIGHT.bargeCooldown);
  });

  it('never lets a barge stun last until the next one, at any training', () => {
    const shortest = bargeCooldownOf(MAXED);
    for (const attacker of [NO_ATTRIBUTES, MAXED])
      for (const victim of [NO_ATTRIBUTES, MAXED]) expect(stunOf(attacker, victim)).toBeLessThan(shortest);
  });

  it('stamina: slows season fatigue, and nothing else', () => {
    expect(fatigueFactor(NO_ATTRIBUTES)).toBe(1);
    expect(fatigueFactor(only('stamina', STAMINA_CAP))).toBeLessThan(1);
    expect(fatigueFactor(only('stamina', STAMINA_CAP))).toBeGreaterThan(0);
  });
});

describe('levels', () => {
  it('are whole and capped, so a bad save can never buy more than the cap', () => {
    for (const a of ATTRIBUTES) {
      expect(levelOf(only(a, ATTRIBUTE_CAPS[a] + 5), a)).toBe(ATTRIBUTE_CAPS[a]);
      expect(levelOf(only(a, -3), a)).toBe(0);
      expect(levelOf(only(a, 2.7), a)).toBe(2);
      expect(levelOf(only(a, Number.NaN), a)).toBe(0);
    }
    expect(capAttributes({ pace: 99, shot: -1, strength: 3.5, barge: 4, stamina: Infinity })).toEqual({
      pace: PACE_CAP,
      shot: 0,
      strength: 3,
      barge: 4,
      stamina: 0,
    });
  });

  it('beyond a cap play exactly as at the cap', () => {
    expect(paceFactor(only('pace', PACE_CAP + 4))).toBe(paceFactor(only('pace', PACE_CAP)));
    expect(shotFactor(only('shot', SHOT_CAP + 4))).toBe(shotFactor(only('shot', SHOT_CAP)));
    expect(strengthFactor(only('strength', STRENGTH_CAP + 4))).toBe(
      strengthFactor(only('strength', STRENGTH_CAP)),
    );
    expect(bargeCooldownOf(only('barge', BARGE_CAP + 4))).toBe(bargeCooldownOf(only('barge', BARGE_CAP)));
  });
});
