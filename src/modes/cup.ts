import type { AppContext } from '../app';
import { DIFFICULTIES, type Difficulty } from '../ai/skills';
import { createRng, randomSeed } from '../game/rng';
import { houseById, REALM_HOUSES } from '../setup/houses';
import { rosterSquads } from '../setup/rosters';
import {
  cupStatus,
  currentRound,
  drawCup,
  fixtureSeed,
  knockedOutIn,
  playerFixture,
  recordPlayerResult,
  ROUNDS,
  roundTier,
  type CupState,
  type Fixture,
} from './cup/bracket';
import type { GameMode, MatchSession } from './mode';

/** "quarter-final", for use mid-sentence. */
export const roundName = (round: number): string => (ROUNDS[round] ?? 'Final').toLowerCase();

export function cupLevel(run: CupState): Difficulty {
  const level = DIFFICULTIES.find((d) => d.id === run.levelId) ?? DIFFICULTIES[0];
  if (!level) throw new Error('No difficulties defined');
  return level;
}

/** The house the player meets in a fixture. */
export const opponentOf = (run: CupState, fixture: Fixture): string | null =>
  fixture.houses.find((id) => id !== run.playerHouse) ?? null;

/** An eight-house knockout against the realm's permanent squads, getting harder each round. */
export const cup: GameMode = {
  id: 'cup',
  name: 'Realm Cup',
  blurb: 'Eight houses, one knockout. Win three ties against fixed rival squads to lift the cup.',
  available: true,
  progress(app) {
    const run = app.cup;
    if (!run) return null;
    const status = cupStatus(run);
    // A finished run stays on the card until its result screen is dismissed.
    if (status === 'won') return { note: 'Champions! The cup is yours', action: 'See the cup' };
    const outIn = knockedOutIn(run);
    if (outIn !== null) return { note: `Knocked out in the ${roundName(outIn)}`, action: 'See the bracket' };
    const next = playerFixture(run);
    const opponent = next && opponentOf(run, next);
    const round = ROUNDS[next?.round ?? currentRound(run) + 1] ?? 'Final';
    return {
      note: opponent ? `${round} next, against ${houseById(opponent).name}` : `${round} next`,
      action: 'Continue cup',
    };
  },
  start(app) {
    app.go('cup');
  },
};

/** Draws a new cup from the player's current house, level and team size. */
export function enterCup(app: AppContext): void {
  app.setCup(
    drawCup(
      {
        seed: randomSeed(),
        levelId: app.difficulty.id,
        teamSize: app.prefs.teamSize,
        playerHouse: app.house.id,
      },
      REALM_HOUSES.map((h) => h.id),
    ),
  );
}

const sameTie = (a: Fixture | null, b: Fixture): boolean => a?.round === b.round && a.index === b.index;

export function cupSession(app: AppContext, run: CupState, fixture: Fixture): MatchSession {
  const homeHouse = houseById(run.playerHouse);
  const awayHouse = houseById(opponentOf(run, fixture) ?? '');
  const { home, away } = rosterSquads(
    app.look,
    homeHouse,
    awayHouse,
    run.teamSize,
    {
      teammateTier: app.prefs.teammateTier,
      rivalMeanTier: roundTier(cupLevel(run).meanTier, fixture.round),
    },
    createRng(fixtureSeed(run.seed, fixture.round, fixture.index)),
  );
  return {
    home,
    away,
    homeHouse,
    awayHouse,
    quitTo: 'cup',
    resultActions(result) {
      const [us, them] = result.score;
      // Golden goal means a level score never reaches full time, but a tie must have a winner to be recorded.
      if (app.cup && us !== them && sameTie(playerFixture(app.cup), fixture)) {
        app.setCup(recordPlayerResult(app.cup, fixture, result.score));
        if (cupStatus(app.cup) === 'won') app.addCupWin();
      }
      const status = app.cup ? cupStatus(app.cup) : 'out';
      return [
        {
          label:
            status === 'won' ? 'Lift the cup' : status === 'out' ? 'Leave the field' : 'Back to the bracket',
          primary: true,
          run: () => {
            app.go('cup');
          },
        },
      ];
    },
  };
}
