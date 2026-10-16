import type { TeamSize } from '../../game/formation';
import { createRng } from '../../game/rng';
import type { House } from '../../setup/houses';
import { rosterLineup } from '../../setup/rosters';
import { rollRivals } from '../../setup/squads';
import { MatchRunner } from '../runner';
import type { Score } from './bracket';

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
  const runner = new MatchRunner({ home: lineup(houses[0]), away: lineup(houses[1]), seed });
  return {
    advance(steps) {
      runner.advance(steps);
      const { score } = runner.state;
      return runner.ended ? [score[0], score[1]] : null;
    },
  };
}

/** Plays a whole simulated match at once, for tests and tools. */
export function playOut(match: SimulatedMatch): Score {
  const score = match.advance(Infinity);
  if (!score) throw new Error('Simulated match did not finish');
  return score;
}
