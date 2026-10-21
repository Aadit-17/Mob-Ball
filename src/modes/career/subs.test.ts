import { describe, expect, it } from 'vitest';
import type { Input, Knight } from '../../game/types';
import { DEFAULT_LOOK } from '../../knight/look';
import type { MatchStats } from '../../stats/types';
import { REST_GAIN, SUB_AT } from '../manager/stamina';
import { MatchRunner, type Manager } from '../runner';
import {
  HOOK_RATING,
  planFixture,
  playerFixture,
  PLAYER_ID,
  POSITIONS,
  selection,
  simulate,
  startCareer,
  type CareerOutcome,
  type CareerState,
  type FixturePlan,
  type FixtureRecord,
} from './career';
import { squadOfClub } from './clubs';
import { APPEARANCE, comesOn, type Selection } from './form';

const start = (seed: number, position: (typeof POSITIONS)[number] = 'fwd'): CareerState =>
  startCareer({ seed, look: DEFAULT_LOOK, position });

/** His club's knights all made `tier`, so his place turns on how he measures against them. */
function clubAt(c: CareerState, tier: number): CareerState {
  const squad = squadOfClub(c.world, c.player.club).map((k) => ({ ...k, tier }));
  return { ...c, world: { ...c.world, squads: { ...c.world.squads, [c.player.club]: squad } } };
}

/** Eight matches of form `residual` from par, the last on the matchday just gone. */
const withForm = (c: CareerState, residual: number): CareerState => ({
  ...c,
  player: { ...c.player, form: Array.from({ length: 8 }, (_, i) => ({ day: i - 8, residual })) },
});

/** The career with the first form, best first, that leaves him out of the four but brings him on at the hour. */
function nearMiss(c: CareerState): CareerState {
  for (let residual = 2; residual >= -2; residual -= 0.05) {
    const near = withForm(c, residual);
    const pick = selection(near);
    if (!pick.starts && comesOn(pick, 1 - SUB_AT)) return near;
  }
  throw new Error('No form leaves him a near miss');
}

interface Run {
  readonly plan: FixturePlan;
  readonly runner: MatchRunner;
  readonly after: CareerState;
  readonly record: FixtureRecord;
}

/** What his manager reads of the match, with `ownGoals` more own goals put on his knight: a stinker, live. */
const stinker =
  (slot: number, ownGoals: number) => (stats: (() => MatchStats) | undefined) => (): MatchStats => {
    const s = stats?.();
    if (!s) throw new Error('The runner gives managers the stats');
    return {
      ...s,
      knights: s.knights.map((k) =>
        k.team === 0 && k.id === slot ? { ...k, ownGoals: k.ownGoals + ownGoals } : k,
      ),
    };
  };

/** Plays his club's fixture through the runner in uneven chunks, keeping events as the screen does. `human` drives his
 * knight in a played match; `ownGoals` doctors what his manager reads of him. */
function play(
  c: CareerState,
  mode: 'play' | 'sim',
  opts: { ownGoals?: number; human?: (k: Knight) => Input | null; chunks?: readonly number[] } = {},
): Run {
  const ref = playerFixture(c);
  if (!ref) throw new Error('no fixture');
  const plan = planFixture(c, ref, mode);
  const config = plan.config();
  const [home, away] = config.managers ?? [null, null];
  const slot = plan.sheets[0].playerSlot;
  const doctor = opts.ownGoals && slot !== null ? stinker(slot, opts.ownGoals) : null;
  const managed: Manager | null =
    home && doctor ? (state, team, stats) => home(state, team, doctor(stats)) : home;
  const runner = new MatchRunner({ ...config, managers: [managed, away] });
  const chunks = opts.chunks ?? [1, 3, 17, 120, 2];
  for (let i = 0; !runner.ended; i++)
    for (let s = 0; s < (chunks[i % chunks.length] ?? 1); s++) {
      runner.advanceOne(opts.human);
      runner.state.events = [];
    }
  const outcome: CareerOutcome = { stats: runner.stats, steps: runner.step };
  const after = plan.finish(c, outcome);
  const record = after.season.records[ref.division]?.[plan.fixture.matchday]?.[ref.index];
  if (!record) throw new Error('no record');
  return { plan, runner, after, record };
}

/** His side of his own fixture in its record: 0 at home, 1 away. */
const mySide = (run: Run): 0 | 1 => (run.plan.fixture.home === run.plan.sheets[0].club ? 0 : 1);
const idle = (k: Knight): Input | null =>
  k.human ? { moveX: 0, moveY: 0, kick: false, barge: false } : null;

describe('coming on from the bench', () => {
  /** A choice where he falls `perMatch` tiers short (negative) of the incumbent a full match, playing time counted. */
  const pick = (perMatch: number): Selection => ({
    starts: perMatch + APPEARANCE >= 0,
    value: perMatch + APPEARANCE,
    incumbent: { knight: { id: 'k0', look: DEFAULT_LOOK, tier: 2, forged: false }, role: 'fwd' },
    incumbentValue: 0,
  });

  it('weighs what he lacks by the minutes he would play, against what getting on is worth', () => {
    // Short of a start, but the last third costs a third as much and getting on is worth the same.
    expect(pick(-2 * APPEARANCE).starts).toBe(false);
    expect(comesOn(pick(-2 * APPEARANCE), 1)).toBe(false);
    expect(comesOn(pick(-2 * APPEARANCE), 1 / 3)).toBe(true);
    // Further short stays out at the hour, though not for the last quarter.
    expect(comesOn(pick(-4 * APPEARANCE), 1 / 3)).toBe(false);
    expect(comesOn(pick(-4 * APPEARANCE), 1 / 4)).toBe(true);
    expect(comesOn(pick(0), 1)).toBe(true);
  });

  // An untrained forward at a club of Champions, his form set so he is benched but near enough to come on.
  const benched = nearMiss(clubAt(start(21), 3));

  it('puts him last on the bench, played by his own hands when he plays', () => {
    const pickNow = selection(benched);
    expect(pickNow.starts).toBe(false);
    const ref = playerFixture(benched);
    if (!ref) throw new Error('no fixture');
    for (const mode of ['play', 'sim'] as const) {
      const [mine] = planFixture(benched, ref, mode).sheets;
      expect(mine.playerSlot).toBeNull();
      expect(mine.playerBench).toBe(mine.bench.length - 1);
      const me = mine.bench[mine.bench.length - 1];
      expect(me?.id).toBe(PLAYER_ID);
      expect(me?.spec.human).toBe(mode === 'play');
      expect(mine.starters.map((s) => s.id)).not.toContain(PLAYER_ID);
    }
  });

  it('brings him on in the second half for the starter in his position, the club’s one change', () => {
    expect(comesOn(selection(benched), 1 - SUB_AT)).toBe(true);
    const run = play(benched, 'sim');
    const [mine] = run.plan.sheets;
    const incumbent = mine.starters[POSITIONS.indexOf('fwd')]?.id;
    const ours = run.record.subs.filter((s) => s.side === mySide(run));
    expect(ours).toEqual([
      {
        side: mySide(run),
        off: incumbent,
        on: PLAYER_ID,
        minute: expect.any(Number) as number,
        share: expect.any(Number) as number,
      },
    ]);
    const [sub] = ours;
    expect(sub?.minute).toBeGreaterThanOrEqual(46);
    expect(sub?.minute).toBeLessThanOrEqual(62);
    expect(run.record.ratings[PLAYER_ID]).toBeDefined();
    // He played the rest of the match: his stamina and form count it as that share.
    const share = 1 - (sub?.share ?? 0);
    expect(run.after.player.form.at(-1)?.share).toBeCloseTo(share);
    expect(run.after.player.stamina).toBeLessThan(benched.player.stamina);
    expect(run.after.player.stamina).toBeGreaterThan(benched.player.stamina - 8 * share - 0.01);
  });

  it('leaves him out when he falls too far short, and he rests', () => {
    const legends = withForm(clubAt(start(21), 4), -1);
    expect(comesOn(selection(legends), 1 - SUB_AT)).toBe(false);
    const run = play(legends, 'sim');
    expect(run.record.subs.some((s) => s.on === PLAYER_ID)).toBe(false);
    expect(run.record.ratings[PLAYER_ID]).toBeUndefined();
    expect(run.after.player.stamina).toBe(Math.min(100, legends.player.stamina + REST_GAIN));
    expect(run.after.player.form).toEqual(legends.player.form);
  });

  it('decides the same watched, headless or in other chunks, and hands the human his knight when he comes on', () => {
    const plan = planFixture(benched, playerFixture(benched) ?? { division: 0, index: 0 }, 'sim');
    const headless = plan.finish(benched, simulate(plan));
    expect(play(benched, 'sim').after).toEqual(headless);
    expect(play(benched, 'sim', { chunks: [240] }).after).toEqual(headless);

    const played = play(benched, 'play', { human: idle });
    expect(played.record.subs.some((s) => s.on === PLAYER_ID)).toBe(true);
    expect(played.runner.state.knights.find((k) => k.human)?.team).toBe(0);
    expect(play(benched, 'play', { human: idle, chunks: [7, 1] }).after).toEqual(played.after);
  });
});

describe('coming off when it isn’t his day', () => {
  // An untrained forward at his Village club: he starts.
  const c = start(21);

  it('keeps him on through an ordinary match, judged at the hour', () => {
    const run = play(c, 'sim');
    expect(run.plan.sheets[0].playerSlot).not.toBeNull();
    const judged = run.plan.judged();
    expect(judged).not.toBeNull();
    expect(judged ?? 0).toBeGreaterThanOrEqual(HOOK_RATING);
    expect(run.record.subs.some((s) => s.off === PLAYER_ID)).toBe(false);
  });

  it('takes him off at the hour for the knight he displaced when his live rating is under the bar, and uses the change', () => {
    const run = play(c, 'sim', { ownGoals: 10 });
    const [mine] = run.plan.sheets;
    expect(run.plan.judged() ?? 10).toBeLessThan(HOOK_RATING);
    const ours = run.record.subs.filter((s) => s.side === mySide(run));
    expect(ours).toHaveLength(1);
    expect(ours[0]?.off).toBe(PLAYER_ID);
    expect(ours[0]?.on).toBe(mine.bench[0]?.id);
    expect(ours[0]?.on).toBe(selection(c).incumbent.knight.id);
    expect(ours[0]?.minute).toBeGreaterThanOrEqual(60);
    expect(ours[0]?.minute).toBeLessThanOrEqual(62);
    // He is rated and earns for the share he played, and his form counts that share.
    expect(run.record.ratings[PLAYER_ID]).toBeDefined();
    expect(run.after.player.form.at(-1)?.share).toBeCloseTo(ours[0]?.share ?? 0);
  });

  it('judges a live stinker the same in any chunks, and the human watches once he is off', () => {
    const headless = play(c, 'sim', { ownGoals: 10, chunks: [100_000] });
    expect(play(c, 'sim', { ownGoals: 10 }).after).toEqual(headless.after);

    const played = play(c, 'play', { ownGoals: 10, human: idle });
    expect(played.record.subs.some((s) => s.off === PLAYER_ID)).toBe(true);
    expect(played.runner.state.knights.some((k) => k.human)).toBe(false);
    expect(played.runner.state.substituted.some((k) => k.human)).toBe(true);
    expect(play(c, 'play', { ownGoals: 10, human: idle, chunks: [1] }).after).toEqual(played.after);
  });
});
