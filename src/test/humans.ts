// Scripted human-style play for the human's slot, to check ratings are fair to how people play rather
// than only to the bots they were fitted on. Deterministic: inputs read the state alone.
import { PITCH } from '../game/constants';
import { NO_INPUT, type Input, type Knight, type MatchState } from '../game/types';

export type HumanProfile = 'beginner' | 'improver' | 'decent';
export const HUMAN_PROFILES: readonly HumanProfile[] = ['beginner', 'improver', 'decent'];

const goalOf = (k: Knight) => ({ x: k.team === 0 ? PITCH.right + 20 : PITCH.left - 20, y: PITCH.centerY });
const toward = (k: Knight, x: number, y: number, kick = false, barge = false): Input => ({
  moveX: x - k.x,
  moveY: y - k.y,
  kick,
  barge,
});

// A beginner chases the ball straight on, holds kick so every touch is a kick (wherever it goes), and
// barges any rival near the ball. No positioning, no passing.
function beginner(state: MatchState, k: Knight): Input {
  const { ball } = state;
  const rivalNear = state.knights.some(
    (r) =>
      r.team !== k.team &&
      Math.hypot(r.x - ball.x, r.y - ball.y) < 40 &&
      Math.hypot(r.x - k.x, r.y - k.y) < 60,
  );
  return toward(k, ball.x, ball.y, true, rivalNear);
}

// An improver gets behind the ball before pushing it at goal, shoots from range, and when a rival is
// on him and a teammate is ahead, plays it to the teammate.
function improver(state: MatchState, k: Knight): Input {
  const { ball } = state;
  const goal = goalOf(k);
  const dir = k.team === 0 ? 1 : -1;
  const pressed = state.knights.some((r) => r.team !== k.team && Math.hypot(r.x - ball.x, r.y - ball.y) < 45);
  const mate = state.knights.find((m) => m.team === k.team && m !== k && (m.x - ball.x) * dir > 80);
  const target = pressed && mate ? mate : goal;
  const tx = target.x - ball.x;
  const ty = target.y - ball.y;
  const tl = Math.hypot(tx, ty) || 1;
  const behind = {
    x: ball.x - (tx / tl) * (k.radius + ball.radius + 4),
    y: ball.y - (ty / tl) * (k.radius + ball.radius + 4),
  };
  if (Math.hypot(behind.x - k.x, behind.y - k.y) > 14) return toward(k, behind.x, behind.y);
  const shoot = target === goal && Math.abs(goal.x - ball.x) < 380;
  return toward(k, target.x, target.y, shoot || target !== goal);
}

/** The input for the human's knight; null hands him to the bot brain (the decent player, at his tier). */
export function humanInput(profile: HumanProfile, state: MatchState, k: Knight): Input | null {
  if (state.phase !== 'play') return NO_INPUT;
  return profile === 'beginner' ? beginner(state, k) : profile === 'improver' ? improver(state, k) : null;
}
