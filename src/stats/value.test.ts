import { describe, expect, it } from 'vitest';
import { PITCH } from '../game/constants';
import { createMatch } from '../game/match';
import type { MatchState, TeamId } from '../game/types';
import { spec } from '../test/fixtures';
import { ballFate, netBound } from './definitions';
import { RATING_MODEL } from './value-model';
import { CELLS, DEPTHS, FATES, FEATURES, packCell, stateCell, unpackCell, type CellParts } from './value';

const { value: model } = RATING_MODEL;

/** A match with one knight a side, the ball placed by hand, knights parked far from it. */
function scene(x: number, y: number, vx: number, vy: number): MatchState {
  const state = createMatch({ home: [spec('mid')], away: [spec('mid')], seed: 1 });
  state.phase = 'play';
  state.knights.forEach((k, i) => Object.assign(k, { x: 200 + 800 * i, y: PITCH.top + 20 }));
  Object.assign(state.ball, { x, y, vx, vy });
  return state;
}
const cellOf = (state: MatchState, side: TeamId) =>
  unpackCell(stateCell(state, side, netBound(state.ball, state.posts)));
const mirror = (x: number) => PITCH.left + PITCH.right - x;

describe('the net a ball is bound for', () => {
  it(
    'agrees with following the ball all the way, while skipping balls too slow to reach a goal line',
    { timeout: 20_000 },
    () => {
      const { posts, ball: template } = scene(0, 0, 0, 0);
      let [skipped, goals] = [0, 0];
      for (let x = PITCH.left - 25; x < PITCH.right + 60; x += 60)
        for (let y = PITCH.top + 12; y < PITCH.bottom; y += 65)
          for (const speed of [0, 30, 90, 200, 420, 700])
            for (let a = 0; a < 12; a++) {
              const [vx, vy] = [
                speed * Math.cos((a * Math.PI) / 6 + 0.1),
                speed * Math.sin((a * Math.PI) / 6 + 0.1),
              ];
              const ball = { ...template, x, y, vx, vy };
              const full = ballFate(ball, posts).goal;
              expect(netBound(ball, posts), `${x},${y} at ${speed}`).toBe(full);
              if (full !== null) goals++;
              if (
                x > PITCH.left &&
                x < PITCH.right &&
                Math.abs(vx) * 1.45 < (vx > 0 ? PITCH.right - x : x - PITCH.left) - 18
              )
                skipped++;
            }
      expect(goals).toBeGreaterThan(50);
      expect(skipped).toBeGreaterThan(1000);
    },
  );
});

describe('state cells', () => {
  it('pack and unpack every cell, one to one', () => {
    const seen = new Set<number>();
    for (let c = 0; c < CELLS; c++) {
      const parts = unpackCell(c);
      expect(packCell(parts)).toBe(c);
      seen.add(packCell(parts));
    }
    expect(seen.size).toBe(CELLS);
    expect(CELLS).toBe(FEATURES.depth * FEATURES.width * FEATURES.pressure * FEATURES.pace * FEATURES.fate);
  });

  it('read the same for either side when the pitch is mirrored', () => {
    for (const [x, y, vx, vy] of [
      [1000, 330, 500, 0],
      [300, 500, -200, 80],
      [640, 120, 30, -10],
      [1150, 300, 650, 0],
    ] as const) {
      expect(cellOf(scene(mirror(x), y, -vx, vy), 1)).toEqual(cellOf(scene(x, y, vx, vy), 0));
    }
  });

  it('band depth from the goal attacked, width from the centre line, pace toward goal, and fate', () => {
    const near: CellParts = cellOf(scene(PITCH.right - 60, PITCH.centerY, 600, 0), 0);
    expect(near).toMatchObject({ depth: 0, width: 0, pace: 2, fate: FATES.indexOf('for'), pressure: 2 });
    const back = cellOf(scene(PITCH.left + 60, PITCH.bottom - 15, -300, 0), 0);
    expect(back).toMatchObject({ depth: DEPTHS - 1, width: 2, pace: 0 });
    // The same ball, seen by the side defending that goal: deep in its own end, heading into its own net.
    const theirs = cellOf(scene(PITCH.right - 60, PITCH.centerY, 600, 0), 1);
    expect(theirs).toMatchObject({ depth: DEPTHS - 1, fate: FATES.indexOf('against'), pace: 0 });
  });

  it('read pressure from the nearest rival body, not a teammate', () => {
    const state = scene(640, 330, 0, 0);
    const [home, away] = state.knights;
    if (!home || !away) throw new Error('knights');
    Object.assign(home, { x: 640 - 30, y: 330 });
    expect(cellOf(state, 0).pressure).toBe(2);
    Object.assign(away, { x: 640 + 40, y: 330 });
    expect(cellOf(state, 0).pressure).toBe(0);
  });
});

/** The model's chance for the side on the ball, for a loose central ball with no rival near. */
const own = (parts: Partial<CellParts>) =>
  model.own[packCell({ depth: 0, width: 0, pressure: 2, pace: 1, fate: 0, ...parts })] ?? NaN;
const other = (parts: Partial<CellParts>) =>
  model.other[packCell({ depth: 0, width: 0, pressure: 2, pace: 1, fate: 0, ...parts })] ?? NaN;

describe('the fitted next-goal model', () => {
  it('holds a probability for each side in every cell, never more than one between them', () => {
    expect(model.own).toHaveLength(CELLS);
    expect(model.other).toHaveLength(CELLS);
    for (let c = 0; c < CELLS; c++) {
      const [p, q] = [model.own[c] ?? NaN, model.other[c] ?? NaN];
      expect(p).toBeGreaterThanOrEqual(0);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(p + q).toBeLessThanOrEqual(1);
    }
  });

  it('says what football says: nearer their goal is better, a ball going in is best, one going into your own net worst', () => {
    // The side on the ball scores more often from the final third than from its own.
    expect(own({ depth: 0 })).toBeGreaterThan(own({ depth: 3 }));
    expect(own({ depth: 1 })).toBeGreaterThan(own({ depth: 4 }));
    expect(other({ depth: 5 })).toBeGreaterThan(other({ depth: 1 }));
    // Within 360 px. From further out a ball bound for the net is a long shot the keeper mostly takes,
    // worth less than a ball still at the attack's feet, which the model rightly says.
    for (let depth = 0; depth < 2; depth++) {
      const going = (fate: number) => own({ depth, fate, pace: 2 }) - other({ depth, fate, pace: 2 });
      expect(going(FATES.indexOf('for'))).toBeGreaterThan(going(FATES.indexOf('none')));
    }
    for (let depth = 0; depth < DEPTHS; depth++) {
      const going = (fate: number) => own({ depth, fate, pace: 0 }) - other({ depth, fate, pace: 0 });
      expect(going(FATES.indexOf('against'))).toBeLessThan(going(FATES.indexOf('none')));
    }
    // A ball bound for the net from close range goes in more often than not.
    expect(own({ depth: 0, pace: 2, fate: FATES.indexOf('for') })).toBeGreaterThan(0.5);
  });

  it('looks ahead a few seconds: long enough for a move to finish, short of the next one', () => {
    expect(model.horizon).toBeGreaterThanOrEqual(3);
    expect(model.horizon).toBeLessThanOrEqual(8);
  });
});
