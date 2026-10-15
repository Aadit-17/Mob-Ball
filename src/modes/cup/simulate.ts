import { BotBrain } from '../../ai/brain';
import type { TeamSize } from '../../game/formation';
import { createMatch, stepMatch } from '../../game/match';
import { createRng } from '../../game/rng';
import { STEP } from '../../game/constants';
import type { House } from '../../setup/houses';
import { rosterLineup } from '../../setup/rosters';
import { rollRivals } from '../../setup/squads';
import type { Score } from './bracket';

/** Ten minutes of golden goal: bots settle it well within one, so this only guards the loop. */
const GOLDEN_GOAL_LIMIT = 600 / STEP;

export interface SimulatedMatch {
  /** Plays up to `steps` simulation steps; returns the score once the match is over, else null. */
  advance(steps: number): Score | null;
}

/** Two houses' permanent squads, bot v bot on the real simulation; a seed always plays the same match. */
export function simulateMatch(
  houses: readonly [House, House],
  teamSize: TeamSize,
  meanTier: number,
  seed: number,
): SimulatedMatch {
  const rng = createRng(seed);
  const lineup = (house: House) => rollRivals(rosterLineup(house, teamSize), meanTier, rng);
  const state = createMatch({ home: lineup(houses[0]), away: lineup(houses[1]), seed });
  const brain = new BotBrain();
  let goldenSteps = 0;
  return {
    advance(steps) {
      for (let i = 0; i < steps && state.phase !== 'ended'; i++) {
        stepMatch(state, (k) => brain.input(state, k));
        state.events = [];
        if (state.goldenGoal && ++goldenSteps > GOLDEN_GOAL_LIMIT) {
          // Never seen in testing; settle it by lot so the bracket can always go on.
          state.score[rng.next() < 0.5 ? 0 : 1] += 1;
          state.phase = 'ended';
        }
      }
      return state.phase === 'ended' ? [state.score[0], state.score[1]] : null;
    },
  };
}

/** Plays a whole simulated match at once, for tests and tools. */
export function playOut(match: SimulatedMatch): Score {
  const score = match.advance(Infinity);
  if (!score) throw new Error('Simulated match did not finish');
  return score;
}
