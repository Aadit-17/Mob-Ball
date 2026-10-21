// Staged situations for the stats tests: bodies placed by hand, the real engine stepping them, and a
// recorder watching every step. Knights stand still unless a test scripts them.
import { BALL, PITCH, STEP } from '../game/constants';
import { createMatch, stepMatch } from '../game/match';
import { NO_INPUT, type Input, type Knight, type Role } from '../game/types';
import { spec } from './fixtures';
import { StatsRecorder } from '../stats/recorder';
import type { Action, ActionKind } from '../stats/types';

export type Script = (k: Knight, t: number) => Input | null;

export function stage(home: readonly Role[], away: readonly Role[], seed = 1) {
  const state = createMatch({ home: home.map((r) => spec(r)), away: away.map((r) => spec(r)), seed });
  state.phase = 'play';
  // Everyone starts parked along the touchlines, out of play, until a test places him.
  state.knights.forEach((k, i) => {
    Object.assign(k, { x: PITCH.left + 60 + i * 60, y: k.team === 0 ? PITCH.top + 25 : PITCH.bottom - 25 });
  });
  const recorder = new StatsRecorder(state);
  let step = 0;
  let time = 0;
  const knight = (team: 0 | 1, role: Role): Knight => {
    const k = state.knights.find((q) => q.team === team && q.role === role);
    if (!k) throw new Error(`no ${role} on side ${team}`);
    return k;
  };
  return {
    state,
    recorder,
    home: (role: Role) => knight(0, role),
    away: (role: Role) => knight(1, role),
    /** Steps the match for `seconds`, or until `until` holds, with scripted inputs (null: stand still). */
    run(seconds: number, script: Script = () => null, until: () => boolean = () => false): void {
      for (let i = 0; i < Math.round(seconds / STEP) && !until(); i++) {
        stepMatch(state, (k) => script(k, time) ?? NO_INPUT);
        recorder.observe(state, step++, state.events);
        state.events = [];
        time += STEP;
      }
    },
    /** Puts the ball at rest on the line from `k` toward `target`, just inside his kicking reach. */
    lineUp(k: Knight, target: { x: number; y: number }): void {
      const d = Math.hypot(target.x - k.x, target.y - k.y);
      const gap = k.radius + BALL.radius + 2;
      Object.assign(state.ball, {
        x: k.x + ((target.x - k.x) / d) * gap,
        y: k.y + ((target.y - k.y) / d) * gap,
        vx: 0,
        vy: 0,
      });
    },
    actions: (kind?: ActionKind): Action[] =>
      recorder.stats.actions.filter((a) => kind === undefined || a.kind === kind),
    line: (k: Knight) => {
      const line = recorder.stats.knights.find((q) => q.id === k.id);
      if (!line) throw new Error(`no stats for ${k.id}`);
      return line;
    },
  };
}

/** `k` kicks on the first step he can, once. */
export function kickOnce(k: Knight): Script {
  let done = false;
  return (q) => {
    if (q !== k || done) return null;
    done = true;
    return { ...NO_INPUT, kick: true };
  };
}

/** `k` walks toward a point at full pace. */
export const walk =
  (k: Knight, to: { x: number; y: number }): Script =>
  (q) =>
    q === k ? { moveX: to.x - q.x, moveY: to.y - q.y, kick: false, barge: false } : null;
