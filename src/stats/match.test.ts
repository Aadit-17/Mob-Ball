import { describe, expect, it } from 'vitest';
import { STEP } from '../game/constants';
import { MatchRunner, type FixtureConfig, type TimedAction } from '../modes/runner';
import { REALM_HOUSES, houseById } from '../setup/houses';
import { rosterLineup } from '../setup/rosters';
import { setTeamTier } from '../setup/squads';
import { matchFingerprint } from '../test/fingerprint';
import { spec } from '../test/fixtures';
import { stage } from '../test/stage';
import { invariantBreaks } from './tally';

function fixture(seed: number, tier: number, draws = true): FixtureConfig {
  const home = REALM_HOUSES[seed % REALM_HOUSES.length];
  const away = REALM_HOUSES[(seed + 3) % REALM_HOUSES.length];
  if (!home || !away) throw new Error('No houses');
  return {
    home: setTeamTier(rosterLineup(home, 4), tier),
    away: setTeamTier(rosterLineup(away, 4), tier),
    seed,
    draws,
  };
}

const bench = spec('mid', { tier: 3 });
/** A positions swap for the home side at 30 s and a substitution for the away side at 60 s. */
const CHANGES: readonly TimedAction[] = [
  { step: 30 / STEP, team: 0, action: { kind: 'positions', a: 2, b: 3 } },
  { step: 60 / STEP, team: 1, action: { kind: 'substitution', offId: 6, on: bench } },
];

function played(config: FixtureConfig, scheduled: readonly TimedAction[] = []): MatchRunner {
  const runner = new MatchRunner(config, scheduled);
  runner.advance(Infinity);
  return runner;
}

describe('match stats over real matches', () => {
  it('hold every invariant at every tier, with changes from the touchline and golden goals', () => {
    let checked = 0;
    for (let tier = 0; tier <= 4; tier++) {
      for (let seed = 1; seed <= 4; seed++) {
        const runner = played(fixture(100 * tier + seed, tier, seed % 2 === 0), seed > 2 ? CHANGES : []);
        expect(invariantBreaks(runner.stats, runner.state.score), `tier ${tier} seed ${seed}`).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBe(20);
  });

  it('see the actions a match is made of', () => {
    const { stats } = played(fixture(7, 3));
    const kinds = new Set(stats.actions.map((a) => a.kind));
    for (const kind of ['pass', 'shot', 'barge', 'recovery', 'interception'] as const)
      expect(kinds).toContain(kind);
    const passes = stats.knights.reduce((n, k) => n + k.passes, 0);
    expect(passes).toBeGreaterThan(5);
  });

  it('do not change the match being watched', () => {
    for (const [seed, tier] of [
      [3, 2],
      [7, 4],
    ] as const) {
      const config = fixture(seed, tier, false);
      const runner = new MatchRunner(config);
      const goals: number[] = [];
      let hash = 0;
      for (let step = 0; !runner.ended; step++) {
        runner.advanceOne();
        if (runner.state.events.some((e) => e.type === 'goal')) goals.push(step);
        runner.state.events = [];
        const { ball } = runner.state;
        if (step % 24 === 0)
          hash = (Math.imul(hash, 31) + Math.round(ball.x * 10) * 7919 + Math.round(ball.y * 10)) | 0;
      }
      const seen = `${runner.state.score.join('-')}|${goals.join(',')}|${(hash >>> 0).toString(36)}`;
      expect(seen).toBe(matchFingerprint(seed, tier, tier));
    }
  });
});

describe('determinism', () => {
  it('gives the same stats for the same match, every time', () => {
    const config = fixture(11, 2);
    expect(played(config, CHANGES).stats).toEqual(played(config, CHANGES).stats);
  });

  it('gives the same stats skipped, stepped one at a time, or watched in uneven chunks', () => {
    const config = fixture(12, 3);
    const skipped = played(config);
    const stepped = new MatchRunner(config);
    while (!stepped.ended) {
      stepped.advanceOne();
      stepped.state.events = [];
    }
    const chunked = new MatchRunner(config);
    const chunks = [1, 7, 120, 3, 997, 64];
    // A screen showing live stats reads them between chunks; reading must change nothing.
    for (let i = 0; !chunked.ended; i++) {
      chunked.advance(chunks[i % chunks.length] ?? 1);
      expect(chunked.stats.liveSteps).toBeLessThanOrEqual(chunked.step);
    }
    expect(stepped.stats).toEqual(skipped.stats);
    expect(chunked.stats).toEqual(skipped.stats);
  });

  it('gives a watched match with changes made between chunks the same stats when replayed from its timeline', () => {
    const config: FixtureConfig = {
      home: setTeamTier(rosterLineup(houseById('mud'), 4), 3),
      away: setTeamTier(rosterLineup(houseById('salt'), 4), 3),
      seed: 21,
    };
    const live = new MatchRunner(config);
    const chunks = [1, 7, 120, 3, 997, 64];
    for (let i = 0; !live.ended; i++) {
      live.advance(chunks[i % chunks.length] ?? 1);
      if (live.step > 3000 && live.timeline.length === 0) live.act(0, { kind: 'positions', a: 1, b: 2 });
      if (live.step > 6000 && live.subsLeft(0) > 0)
        live.act(0, { kind: 'substitution', offId: 2, on: bench });
    }
    expect(live.timeline.map((t) => t.action.kind)).toEqual(['positions', 'substitution']);
    const replayed = played(config, live.timeline);
    expect(replayed.stats).toEqual(live.stats);
    expect(invariantBreaks(live.stats, live.state.score)).toEqual([]);
  });
});

describe('minutes', () => {
  it('follow substitutes on and off, and a positions swap from one role to another', () => {
    const runner = played(fixture(5, 3), CHANGES);
    const { stats } = runner;
    const line = (id: number) => stats.knights.find((k) => k.id === id);
    const [mid, fwd, off, on] = [line(2), line(3), line(6), line(8)];
    if (!mid || !fwd || !off || !on) throw new Error('missing knight');
    // Swapped at 30 s: each spent time in both his old and his new role, all of it adding up.
    expect(mid.roleSteps.mid).toBeGreaterThan(0);
    expect(mid.roleSteps.fwd).toBeGreaterThan(mid.roleSteps.mid);
    expect(fwd.roleSteps.mid).toBeGreaterThan(fwd.roleSteps.fwd);
    expect(mid.playedSteps).toBe(stats.liveSteps);
    // The away midfielder went off at 60 s; his replacement played the rest, in his role.
    expect(off.playedSteps + on.playedSteps).toBe(stats.liveSteps);
    expect(off.playedSteps).toBeGreaterThan(on.playedSteps);
    expect(on.roleSteps.mid).toBe(on.playedSteps);
    expect(on.team).toBe(1);
    expect(stats.knights).toHaveLength(9);
    expect(stats.knights.reduce((n, k) => n + k.playedSteps, 0)).toBe(stats.liveSteps * 8);
  });
});

describe('a match settled by lot', () => {
  it('counts the goal the runner awarded, so goals still equal the score', () => {
    const s = stage(['fwd'], ['fwd']);
    s.run(0.5);
    s.state.score[1] += 1;
    s.state.phase = 'ended';
    s.recorder.decidedByLot(1);
    s.run(STEP);
    const { stats } = s.recorder;
    expect(stats.teams[1].goals).toBe(1);
    expect(stats.decidedByLot).toBe(1);
    expect(invariantBreaks(stats, s.state.score)).toEqual([]);
  });
});
