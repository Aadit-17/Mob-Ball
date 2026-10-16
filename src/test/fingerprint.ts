import { BotBrain } from '../ai/brain';
import { createMatch, stepMatch } from '../game/match';
import { REALM_HOUSES } from '../setup/houses';
import { rosterLineup } from '../setup/rosters';
import { setTeamTier } from '../setup/squads';

/** Every fifth of a second of play goes into the trace. */
const TRACE_EVERY = 24;
const MAX_STEPS = 120 * 60 * 5;

/** One full bot-v-bot match as score, goal steps and a hash of the ball's path: any change to bot decisions shows. */
export function matchFingerprint(seed: number, homeTier: number, awayTier: number): string {
  const home = REALM_HOUSES[seed % REALM_HOUSES.length];
  const away = REALM_HOUSES[(seed + 3) % REALM_HOUSES.length];
  if (!home || !away) throw new Error('No houses');
  const state = createMatch({
    home: setTeamTier(rosterLineup(home, 4), homeTier),
    away: setTeamTier(rosterLineup(away, 4), awayTier),
    seed,
  });
  const brain = new BotBrain();
  const goals: number[] = [];
  let hash = 0;
  for (let step = 0; step < MAX_STEPS && state.phase !== 'ended'; step++) {
    stepMatch(state, (k) => brain.input(state, k));
    if (state.events.some((e) => e.type === 'goal')) goals.push(step);
    state.events = [];
    if (step % TRACE_EVERY === 0)
      hash = (Math.imul(hash, 31) + Math.round(state.ball.x * 10) * 7919 + Math.round(state.ball.y * 10)) | 0;
  }
  return `${state.score[0]}-${state.score[1]}|${goals.join(',')}|${(hash >>> 0).toString(36)}`;
}

/** Matches across every pairing of levels, for golden tests of bot behaviour. */
export const FINGERPRINT_CASES: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [2, 1, 1],
  [3, 2, 2],
  [4, 3, 3],
  [5, 4, 4],
  [6, 1, 3],
  [7, 4, 2],
  [8, 0, 4],
  [9, 3, 1],
  [10, 2, 4],
];
