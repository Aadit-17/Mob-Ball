import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK } from '../../knight/look';
import { MatchRunner } from '../runner';
import { isDraftComplete, squadOf } from './draft';
import { champion, isFinished, MATCHDAYS, playerFixture, table } from './league';
import {
  autoDraft,
  knightStamina,
  normalizeSeason,
  otherFixtures,
  planMatch,
  playerLineup,
  setPlan,
  startSeason,
  type SeasonState,
} from './season';
import { CHARGE, PLAY_COST, STAMINA_MAX } from './stamina';

const PLAYER = 'ember';

function drafted(seed = 5): SeasonState {
  let season = startSeason(seed, PLAYER, { ...DEFAULT_LOOK, name: 'Sir Rookie' });
  while (!season.league) season = autoDraft(season);
  return season;
}

const roundTrip = (season: SeasonState): SeasonState | null =>
  normalizeSeason(JSON.parse(JSON.stringify(season)) as unknown);

/** Plays a fixture headless; `dugout` may act on the runner part-way through, as the player would. */
function play(
  season: SeasonState,
  fixture: Parameters<typeof planMatch>[1],
  dugout?: (r: MatchRunner) => void,
) {
  const plan = planMatch(season, fixture);
  const runner = new MatchRunner(plan.config());
  runner.advance(6000);
  dugout?.(runner);
  runner.advance(Infinity);
  const [a, b] = runner.state.score;
  return plan.finish(season, { score: [a, b], steps: runner.step, timeline: runner.timeline });
}

function playMatchday(season: SeasonState): SeasonState {
  const mine = playerFixture(season.league ?? (null as never));
  if (!mine) throw new Error('No fixture');
  let next = play(season, mine);
  for (const fixture of otherFixtures(next)) next = play(next, fixture);
  return next;
}

describe('a season', () => {
  it('starts the league once the draft is done, with everyone fresh and a full team sheet', () => {
    const season = drafted();
    expect(isDraftComplete(season.draft)).toBe(true);
    expect(season.plan?.starters).toHaveLength(4);
    expect(playerLineup(season).bench).toHaveLength(2);
    for (const k of squadOf(season.draft, 'salt'))
      expect(knightStamina(season, 'salt', k.id)).toBe(STAMINA_MAX);
  });

  it('plays all fourteen matchdays to a champion, surviving a save and reload every matchday', () => {
    let season = drafted();
    for (let day = 0; day < MATCHDAYS; day++) {
      season = playMatchday(season);
      expect(roundTrip(season)).toEqual(season);
    }
    const league = season.league;
    if (!league) throw new Error('No league');
    expect(isFinished(league)).toBe(true);
    expect(champion(league)).toBe(table(league)[0]?.house);
    expect(table(league).every((row) => row.played === MATCHDAYS)).toBe(true);
  }, 60_000);

  it('charges the players who played and rests the bench', () => {
    const season = drafted();
    const sheet = playerLineup(season);
    const fixture = playerFixture(season.league ?? (null as never));
    if (!fixture) throw new Error('No fixture');
    const after = play(season, fixture);
    for (const s of sheet.starters)
      expect(knightStamina(after, PLAYER, s.knight.id)).toBe(STAMINA_MAX - PLAY_COST);
    for (const k of sheet.bench) expect(knightStamina(after, PLAYER, k.id)).toBe(STAMINA_MAX);
  });

  it("charges the dugout's substitution by the minutes each knight played", () => {
    const season = drafted();
    const sheet = playerLineup(season);
    const fixture = playerFixture(season.league ?? (null as never));
    const sub = sheet.bench[0];
    const off = sheet.starters[3];
    if (!fixture || !sub || !off) throw new Error('No fixture');
    const plan = planMatch(season, fixture);
    const after = play(season, fixture, (runner) => {
      runner.act(0, { kind: 'substitution', offId: 3, on: plan.sides[0].bench[0] ?? (null as never) });
      runner.act(0, { kind: 'tactics', tactics: CHARGE });
    });
    const offStamina = knightStamina(after, PLAYER, off.knight.id);
    const onStamina = knightStamina(after, PLAYER, sub.id);
    expect(offStamina).toBeGreaterThan(STAMINA_MAX - PLAY_COST);
    expect(onStamina).toBeLessThan(STAMINA_MAX);
    expect(STAMINA_MAX - offStamina + (STAMINA_MAX - onStamina)).toBeCloseTo(PLAY_COST, 6);
  });

  it('plays the same match from the same plan, watched in pieces or all at once', () => {
    const season = drafted();
    const fixture = playerFixture(season.league ?? (null as never));
    if (!fixture) throw new Error('No fixture');
    const plan = planMatch(season, fixture);
    const whole = new MatchRunner(plan.config());
    whole.advance(Infinity);
    const pieces = new MatchRunner(plan.config());
    while (!pieces.ended) pieces.advance(37);
    expect(pieces.state.score).toEqual(whole.state.score);
    expect(pieces.step).toBe(whole.step);
  });

  it('refuses a team sheet that is not four different knights from the squad', () => {
    const season = drafted();
    const [a, b, c] = season.plan?.starters ?? [];
    if (!a || !b || !c) throw new Error('No plan');
    const tactics = CHARGE;
    expect(() => setPlan(season, { starters: [a, b, c], tactics })).toThrow();
    expect(() => setPlan(season, { starters: [a, b, c, c], tactics })).toThrow();
    expect(() => setPlan(season, { starters: [a, b, c, 'gen:999'], tactics })).toThrow();
  });

  it('rejects saves that do not fit together', () => {
    const season = drafted();
    const raw = JSON.parse(JSON.stringify(season)) as Record<string, unknown>;
    expect(normalizeSeason({ ...raw, stamina: {} })).toBeNull();
    expect(normalizeSeason({ ...raw, plan: { starters: ['nobody'], tactics: CHARGE } })).toBeNull();
    expect(normalizeSeason({ ...raw, plan: { ...season.plan, tactics: { press: 'max' } } })).toBeNull();
    expect(normalizeSeason({ ...raw, league: { ...(raw.league as object), seed: 1 } })).toBeNull();
    expect(normalizeSeason(null)).toBeNull();
  });

  it('saves a draft in progress', () => {
    const season = startSeason(9, PLAYER, DEFAULT_LOOK);
    expect(season.league).toBeNull();
    expect(roundTrip(season)).toEqual(season);
  });
});
