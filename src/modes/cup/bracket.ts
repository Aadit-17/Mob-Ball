import { TOP_TIER } from '../../ai/skills';
import type { TeamSize } from '../../game/formation';
import { createRng } from '../../game/rng';
import { clamp } from '../../game/vec';

export const ROUNDS = ['Quarter-final', 'Semi-final', 'Final'] as const;
export const CUP_SIZE = 2 ** ROUNDS.length;

/** Goals for the first-listed house of a tie, then the second. Cup ties are never drawn. */
export type Score = readonly [number, number];

export interface CupState {
  readonly seed: number;
  /** One of the difficulty presets; the rounds are played around its level. */
  readonly levelId: string;
  readonly teamSize: TeamSize;
  readonly playerHouse: string;
  /** All eight houses in bracket order: the quarter-finals are 0 v 1, 2 v 3, 4 v 5 and 6 v 7. */
  readonly draw: readonly string[];
  /** Scores per round in bracket order; null until played. */
  readonly results: readonly (readonly (Score | null)[])[];
}

export interface Fixture {
  readonly round: number;
  readonly index: number;
  /** Null while the tie that feeds this slot is still to be played. */
  readonly houses: readonly [string | null, string | null];
  readonly score: Score | null;
}

export type CupStatus = 'playing' | 'won' | 'out';

export interface CupEntry {
  readonly seed: number;
  readonly levelId: string;
  readonly teamSize: TeamSize;
  readonly playerHouse: string;
}

const tiesIn = (round: number): number => CUP_SIZE >> (round + 1);

const emptyResults = (): (Score | null)[][] =>
  ROUNDS.map((_, round) => Array.from({ length: tiesIn(round) }, () => null));

/** Draws the bracket at random from `houses`, which must be eight distinct houses including the player's. */
export function drawCup(entry: CupEntry, houses: readonly string[]): CupState {
  if (houses.length !== CUP_SIZE || new Set(houses).size !== CUP_SIZE || !houses.includes(entry.playerHouse))
    throw new Error('A cup needs eight distinct houses, the player’s among them');
  return {
    ...entry,
    draw: createRng(entry.seed).shuffle(houses),
    results: emptyResults(),
  };
}

export const winnerOf = (fixture: Fixture): string | null => {
  const [a, b] = fixture.houses;
  if (!fixture.score || a === null || b === null) return null;
  return fixture.score[0] > fixture.score[1] ? a : b;
};

export function fixtures(cup: CupState, round: number): Fixture[] {
  const feeders = round === 0 ? null : fixtures(cup, round - 1).map(winnerOf);
  return Array.from({ length: tiesIn(round) }, (_, index) => ({
    round,
    index,
    houses: [
      (feeders ? feeders[index * 2] : cup.draw[index * 2]) ?? null,
      (feeders ? feeders[index * 2 + 1] : cup.draw[index * 2 + 1]) ?? null,
    ],
    score: cup.results[round]?.[index] ?? null,
  }));
}

const hasPlayer = (cup: CupState, fixture: Fixture): boolean => fixture.houses.includes(cup.playerHouse);

/** The earliest round with a tie still to play, or the number of rounds once the final is played. */
export function currentRound(cup: CupState): number {
  const round = ROUNDS.findIndex((_, r) => fixtures(cup, r).some((f) => !f.score));
  return round === -1 ? ROUNDS.length : round;
}

export function cupStatus(cup: CupState): CupStatus {
  for (let round = 0; round < ROUNDS.length; round++) {
    const mine = fixtures(cup, round).find((f) => hasPlayer(cup, f));
    if (!mine?.score) return 'playing';
    if (winnerOf(mine) !== cup.playerHouse) return 'out';
  }
  return 'won';
}

/** The round the player went out in, if they did. */
export function knockedOutIn(cup: CupState): number | null {
  if (cupStatus(cup) !== 'out') return null;
  const round = ROUNDS.findIndex((_, r) => {
    const mine = fixtures(cup, r).find((f) => hasPlayer(cup, f));
    return mine !== undefined && winnerOf(mine) !== cup.playerHouse;
  });
  return round === -1 ? null : round;
}

/** The player's next match, once every tie of the rounds before it is settled. */
export function playerFixture(cup: CupState): Fixture | null {
  if (cupStatus(cup) !== 'playing') return null;
  const mine = fixtures(cup, currentRound(cup)).find((f) => hasPlayer(cup, f));
  return mine && !mine.score ? mine : null;
}

/** The other ties of the current round, played out once the player has played theirs. */
export function pendingSimulations(cup: CupState): Fixture[] {
  if (cupStatus(cup) !== 'playing' || playerFixture(cup)) return [];
  return fixtures(cup, currentRound(cup)).filter((f) => !f.score && !hasPlayer(cup, f));
}

export function recordResult(cup: CupState, round: number, index: number, score: Score): CupState {
  const fixture = fixtures(cup, round)[index];
  if (!fixture || fixture.score || fixture.houses.includes(null))
    throw new Error('That tie cannot be played');
  if (score[0] === score[1]) throw new Error('A cup tie needs a winner');
  return {
    ...cup,
    results: cup.results.map((ties, r) =>
      r === round ? ties.map((s, i) => (i === index ? score : s)) : ties,
    ),
  };
}

/** Records the player's match, given as [player, rival] the way the match screen reports it. */
export function recordPlayerResult(cup: CupState, fixture: Fixture, [us, them]: Score): CupState {
  const playerFirst = fixture.houses[0] === cup.playerHouse;
  return recordResult(cup, fixture.round, fixture.index, playerFirst ? [us, them] : [them, us]);
}

/** The quarter-final is a level below the cup's, the semi-final at it and the final a level above. */
export const roundTier = (meanTier: number, round: number): number =>
  clamp(meanTier + round - 1, 0, TOP_TIER);

/** A seed for one tie, so a replayed or resumed cup plays every tie the same way. */
export const fixtureSeed = (cupSeed: number, round: number, index: number): number =>
  (Math.imul(cupSeed ^ 0x9e3779b9, 31) + round * 8 + index) >>> 0;

const isGoals = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 100;

function normalizeScore(raw: unknown): Score | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [a, b] = raw as unknown[];
  return isGoals(a) && isGoals(b) && a !== b ? [a, b] : null;
}

/** Reads a saved cup, or null for anything that is not a real bracket of `houses` played in order. */
export function normalizeCup(
  raw: unknown,
  houses: readonly string[],
  levelIds: readonly string[],
): CupState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const { seed, levelId, teamSize, playerHouse, draw, results } = source;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0) return null;
  if (typeof levelId !== 'string' || !levelIds.includes(levelId)) return null;
  if (teamSize !== 3 && teamSize !== 4) return null;
  if (typeof playerHouse !== 'string' || !Array.isArray(draw) || !Array.isArray(results)) return null;
  const drawn = draw.filter((id): id is string => typeof id === 'string' && houses.includes(id));
  if (drawn.length !== CUP_SIZE || new Set(drawn).size !== CUP_SIZE || !drawn.includes(playerHouse))
    return null;

  let cup: CupState = { seed, levelId, teamSize, playerHouse, draw: drawn, results: emptyResults() };
  // Replaying each score through recordResult rejects any result for a tie that could not yet be played.
  for (let round = 0; round < ROUNDS.length; round++) {
    const ties: unknown = results[round];
    if (!Array.isArray(ties) || ties.length !== tiesIn(round)) return null;
    for (let index = 0; index < ties.length; index++) {
      if (ties[index] === null) continue;
      const score = normalizeScore(ties[index]);
      const fixture = fixtures(cup, round)[index];
      if (!score || !fixture || fixture.houses.includes(null)) return null;
      cup = recordResult(cup, round, index, score);
    }
  }
  return cup;
}
