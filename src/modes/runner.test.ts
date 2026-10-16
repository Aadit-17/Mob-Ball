import { describe, expect, it } from 'vitest';
import { DEFAULT_TACTICS, type Tactics } from '../ai/tactics';
import { createMatch, knightById, stepMatch } from '../game/match';
import { houseById } from '../setup/houses';
import { rosterLineup } from '../setup/rosters';
import { setTeamTier } from '../setup/squads';
import { spec } from '../test/fixtures';
import { MatchRunner, type FixtureConfig, type Manager } from './runner';

const config: FixtureConfig = {
  home: setTeamTier(rosterLineup(houseById('mud'), 4), 3),
  away: setTeamTier(rosterLineup(houseById('salt'), 4), 3),
  seed: 21,
};
const CHARGE: Tactics = { press: 'high', line: 'high', shooting: 'early' };
const bench = spec('mid', { tier: 4, speedFactor: 1 });

/** Where the match ended up, precisely enough that any divergence shows. */
const outcome = (r: MatchRunner) =>
  `${r.state.score.join('-')} @${r.step} ball ${r.state.ball.x.toFixed(6)},${r.state.ball.y.toFixed(6)}`;

/** Plays the fixture the way the match screen does: uneven chunks, with changes made between them. */
function watched(): MatchRunner {
  const runner = new MatchRunner(config);
  const chunks = [1, 7, 120, 3, 997, 64];
  for (let i = 0; !runner.ended; i++) {
    runner.advance(chunks[i % chunks.length] ?? 1);
    if (runner.step > 3000 && runner.timeline.length === 0)
      runner.act(0, { kind: 'tactics', tactics: CHARGE });
    if (runner.step > 6000 && runner.subsLeft(0) > 0)
      runner.act(0, { kind: 'substitution', offId: 2, on: bench });
  }
  return runner;
}

describe('MatchRunner', () => {
  it('replays a watched match exactly from its recorded timeline', () => {
    const live = watched();
    expect(live.timeline.map((t) => t.action.kind)).toEqual(['tactics', 'substitution']);
    const replayed = new MatchRunner(config, live.timeline);
    replayed.advance(Infinity);
    expect(outcome(replayed)).toBe(outcome(live));
  });

  // A one-step shift can legitimately change nothing (no bot may decide on that step), so these
  // check the changes are applied at all, and at their own steps rather than whenever.
  it('plays a different match without the recorded changes, or with them five seconds late', () => {
    const live = watched();
    const without = new MatchRunner(config);
    without.advance(Infinity);
    const late = new MatchRunner(
      config,
      live.timeline.map((t) => ({ ...t, step: t.step + 600 })),
    );
    late.advance(Infinity);
    expect(outcome(without)).not.toBe(outcome(live));
    expect(outcome(late)).not.toBe(outcome(live));
  });

  it('allows one substitution per side: the sub keeps the role, the knight taken off keeps his record', () => {
    const runner = new MatchRunner(config);
    const off = runner.state.knights[2];
    if (!off) throw new Error('missing knight');
    runner.act(0, { kind: 'substitution', offId: off.id, on: bench });
    runner.act(0, { kind: 'substitution', offId: 3, on: bench });
    runner.advance(1);
    const on = runner.state.knights[2];
    expect(on?.id).toBe(8);
    expect(on?.role).toBe(off.role);
    expect(on?.tier).toBe(4);
    expect(runner.state.knights[3]?.id).toBe(3);
    expect(runner.subsLeft(0)).toBe(0);
    expect(runner.subsLeft(1)).toBe(1);
    expect(knightById(runner.state, off.id)).toBe(off);
    expect(runner.timeline).toHaveLength(1);
  });

  it('ignores a substitution for a knight on the other side', () => {
    const runner = new MatchRunner(config);
    runner.act(1, { kind: 'substitution', offId: 0, on: bench });
    runner.advance(1);
    expect(runner.state.knights[0]?.id).toBe(0);
    expect(runner.subsLeft(1)).toBe(1);
  });

  it('lets AI managers act, and makes the same changes again on replay', () => {
    const chase: Manager = (state, team) =>
      state.clock < 45 && state.score[team] <= state.score[team === 0 ? 1 : 0]
        ? { kind: 'tactics', tactics: CHARGE }
        : null;
    const managed: FixtureConfig = { ...config, managers: [null, chase] };
    const first = new MatchRunner(managed);
    first.advance(Infinity);
    expect(first.timeline).toEqual([]);
    const plain = new MatchRunner(config);
    plain.advance(Infinity);
    const again = new MatchRunner(managed);
    again.advance(Infinity);
    expect(outcome(again)).toBe(outcome(first));
    expect(outcome(first)).not.toBe(outcome(plain));
    expect(first.tacticsOf(0)).toEqual(DEFAULT_TACTICS);
  });
});

describe('draws', () => {
  function levelAtFullTime(draws: boolean) {
    const state = createMatch({ home: [spec('fwd')], away: [spec('fwd')], seed: 1, draws });
    state.phase = 'play';
    state.clock = 0.001;
    stepMatch(state, () => ({ moveX: 0, moveY: 0, kick: false, barge: false }));
    return state;
  }

  it('end a league match level at full time', () => {
    const state = levelAtFullTime(true);
    expect(state.phase).toBe('ended');
    expect(state.goldenGoal).toBe(false);
  });

  it('otherwise go to golden goal', () => {
    const state = levelAtFullTime(false);
    expect(state.phase).toBe('play');
    expect(state.goldenGoal).toBe(true);
  });
});
