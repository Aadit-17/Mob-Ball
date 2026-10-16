import { describe, expect, it } from 'vitest';
import { DEFAULT_TACTICS, type Tactics } from '../ai/tactics';
import { MATCH, PITCH, STEP } from '../game/constants';
import { BotBrain } from '../ai/brain';
import { createMatch, knightById, stepMatch, swapRoles } from '../game/match';
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
const CHARGE: Tactics = { press: 'high', shooting: 'early' };
const bench = spec('mid', { tier: 4, speedFactor: 1 });
const steps = (seconds: number): number => seconds / STEP;

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
    if (runner.step > 4500 && runner.timeline.length === 1) runner.act(0, { kind: 'positions', a: 1, b: 2 });
    if (runner.step > 6000 && runner.subsLeft(0) > 0)
      runner.act(0, { kind: 'substitution', offId: 2, on: bench });
  }
  return runner;
}

describe('MatchRunner', () => {
  it('replays a watched match exactly from its recorded timeline', () => {
    const live = watched();
    expect(live.timeline.map((t) => t.action.kind)).toEqual(['tactics', 'positions', 'substitution']);
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

  it('logs every goal, even when the events are discarded, crediting a knight on the scoring side', () => {
    const runner = new MatchRunner(config);
    runner.advance(Infinity);
    const [home, away] = runner.state.score;
    expect(runner.goals).toHaveLength(home + away);
    expect(runner.goals.filter((g) => g.team === 0)).toHaveLength(home);
    for (const g of runner.goals.filter((g) => !g.ownGoal && g.scorerId !== null))
      expect(runner.state.knights.find((k) => k.id === g.scorerId)?.team).toBe(g.team);
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

  it("swaps two knights' roles without using the substitution, and a sub takes the role he is playing", () => {
    const runner = new MatchRunner(config);
    runner.act(0, { kind: 'positions', a: 0, b: 3 });
    runner.advance(1);
    expect(runner.state.knights.slice(0, 4).map((k) => k.role)).toEqual(['fwd', 'def', 'mid', 'gk']);
    expect(runner.subsLeft(0)).toBe(1);
    expect(runner.timeline).toEqual([{ step: 0, team: 0, action: { kind: 'positions', a: 0, b: 3 } }]);
    runner.act(0, { kind: 'substitution', offId: 3, on: bench });
    runner.advance(1);
    expect(runner.state.knights[3]?.role).toBe('gk');
    expect(runner.subsLeft(0)).toBe(0);
  });

  it('ignores a swap across teams, with an unknown knight, or of a knight with himself', () => {
    const runner = new MatchRunner(config);
    for (const [a, b] of [
      [0, 4],
      [4, 5],
      [0, 99],
      [2, 2],
    ] as const)
      runner.act(0, { kind: 'positions', a, b });
    runner.advance(1);
    expect(runner.state.knights.map((k) => k.role).join()).toBe('gk,def,mid,fwd,gk,def,mid,fwd');
    expect(runner.timeline).toEqual([]);
  });

  it('plays the new keeper in goal, and the old one out of it, straight after a swap', () => {
    const runner = new MatchRunner(config);
    runner.advance(steps(20));
    runner.act(0, { kind: 'positions', a: 0, b: 3 });
    const [oldKeeper, newKeeper] = [runner.state.knights[0], runner.state.knights[3]];
    if (!oldKeeper || !newKeeper) throw new Error('missing knight');
    let deepest = 0;
    let furthest = 0;
    for (let i = 0; i < steps(8); i++) {
      runner.advance(1);
      if (i > steps(3)) deepest = Math.max(deepest, newKeeper.x - PITCH.left);
      furthest = Math.max(furthest, oldKeeper.x - PITCH.left);
    }
    expect(deepest).toBeLessThan(150);
    expect(furthest).toBeGreaterThan(400);
  });

  // Reaction times hold a plan for a moment, so at some of these times the forward is mid-run.
  it('has a knight given a new role drop his old plan and decide again at once', () => {
    let checked = 0;
    for (let at = 10; at < MATCH.duration; at += 5) {
      const state = createMatch(config);
      const brain = new BotBrain();
      while (MATCH.duration - state.clock < at || state.phase !== 'play')
        stepMatch(state, (k) => brain.input(state, k));
      const forward = state.knights[3];
      if (!forward || forward.x < PITCH.left + 300) continue;
      swapRoles(state, 0, 3);
      brain.reassign(0);
      brain.reassign(3);
      expect(brain.input(state, forward).moveX, `at ${String(at)}s`).toBeLessThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(4);
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
