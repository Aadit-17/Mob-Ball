import { describe, expect, it } from 'vitest';
import { skillFor } from '../../ai/skills';
import { DEFAULT_TACTICS, type Tactics } from '../../ai/tactics';
import { MATCH } from '../../game/constants';
import { createMatch, type KnightSpec } from '../../game/match';
import type { MatchState, Role } from '../../game/types';
import { DEFAULT_LOOK } from '../../knight/look';
import { MatchRunner, type ManagerAction } from '../runner';
import {
  afterMatchday,
  CHARGE,
  CHASING_SUB_AT,
  chooseLineup,
  createRivalManager,
  FRESH,
  freshStamina,
  HOLD,
  LATE,
  leverage,
  PLAY_COST,
  playingShares,
  pointsPerGoal,
  REST_GAIN,
  rivalTactics,
  squadKnightSpec,
  STAMINA_MAX,
  staminaFactor,
  SUB_AT,
  TIRED_FLOOR,
  type MatchdayPlay,
  type RivalSetup,
  type Stamina,
} from './stamina';
import type { HouseStyle, SquadKnight } from './types';

const NIMBLE = 0;
const STANDARD = 1;
const HEFTY = 2;
const MATCHDAYS = 14;
const ROLES: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];

const knight = (id: string, tier = 2, build = STANDARD): SquadKnight => ({
  id,
  look: { ...DEFAULT_LOOK, build },
  tier,
  forged: false,
});

const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];
const evenSquad = IDS.map((id) => knight(id));
const balanced: HouseStyle = { draft: 'balanced', tactics: DEFAULT_TACTICS };

const full = (starters: readonly string[]): MatchdayPlay => ({
  starters,
  substitution: null,
  matchSteps: 12_000,
});

describe('staminaFactor', () => {
  it('leaves a fresh knight at full speed and slows a tired one in a straight line to the floor', () => {
    expect(staminaFactor(STAMINA_MAX)).toBe(1);
    expect(staminaFactor(FRESH)).toBe(1);
    expect(staminaFactor(0)).toBeCloseTo(TIRED_FLOOR, 12);
    expect(staminaFactor(FRESH / 2)).toBeCloseTo((1 + TIRED_FLOOR) / 2, 12);
    expect(staminaFactor(FRESH - 1)).toBeLessThan(1);
  });

  it('treats stamina outside 0–100 as the nearest end', () => {
    expect(staminaFactor(-20)).toBe(staminaFactor(0));
    expect(staminaFactor(140)).toBe(1);
  });
});

describe('squadKnightSpec', () => {
  it('is the tier’s own speed, slowed by tiredness, in the given role and played by a bot', () => {
    const legend = knight('x', 4, HEFTY);
    expect(squadKnightSpec(legend, STAMINA_MAX, 'gk')).toEqual({
      look: legend.look,
      role: 'gk',
      human: false,
      tier: 4,
      speedFactor: skillFor(4).speed,
    });
    expect(squadKnightSpec(legend, 0, 'fwd').speedFactor).toBeCloseTo(skillFor(4).speed * TIRED_FLOOR, 12);
  });
});

describe('afterMatchday', () => {
  const start: Stamina = { a: 80, b: 80, c: 80, d: 80, e: 80, f: 80 };

  it('charges a full match to each starter and gives the knights who sat out their rest', () => {
    expect(afterMatchday(start, full(['a', 'b', 'c', 'd']))).toEqual({
      a: 80 - PLAY_COST,
      b: 80 - PLAY_COST,
      c: 80 - PLAY_COST,
      d: 80 - PLAY_COST,
      e: 80 + REST_GAIN,
      f: 80 + REST_GAIN,
    });
  });

  it('splits the match by minutes: off at the hour played two thirds, the substitute one third', () => {
    const play: MatchdayPlay = {
      starters: ['a', 'b', 'c', 'd'],
      substitution: { offId: 'b', onId: 'e', step: 8_000 },
      matchSteps: 12_000,
    };
    expect(playingShares(play).get('b')).toBeCloseTo(2 / 3, 12);
    expect(playingShares(play).get('e')).toBeCloseTo(1 / 3, 12);
    const after = afterMatchday(start, play);
    expect(after.a).toBe(80 - PLAY_COST);
    expect(after.b).toBeCloseTo(80 - (PLAY_COST * 2) / 3, 12);
    expect(after.e).toBeCloseTo(80 - PLAY_COST / 3, 12);
    expect(after.f).toBe(80 + REST_GAIN);
  });

  it('never goes above the cap or below empty', () => {
    const after = afterMatchday({ ...start, a: 3, e: STAMINA_MAX - 1 }, full(['a', 'b', 'c', 'd']));
    expect(after.a).toBe(0);
    expect(after.e).toBe(STAMINA_MAX);
  });

  it('refuses a match that could not have happened', () => {
    const bad = (play: Partial<MatchdayPlay>) => () =>
      afterMatchday(start, { ...full(['a', 'b', 'c', 'd']), ...play });
    expect(bad({ starters: ['a', 'b', 'c'] })).toThrow();
    expect(bad({ starters: ['a', 'b', 'c', 'c'] })).toThrow();
    expect(bad({ starters: ['a', 'b', 'c', 'zz'] })).toThrow();
    expect(bad({ substitution: { offId: 'e', onId: 'f', step: 10 } })).toThrow();
    expect(bad({ substitution: { offId: 'a', onId: 'b', step: 10 } })).toThrow();
    expect(bad({ substitution: { offId: 'a', onId: 'e', step: 12_001 } })).toThrow();
    expect(bad({ substitution: { offId: 'a', onId: 'e', step: -1 } })).toThrow();
    expect(bad({ substitution: { offId: 'a', onId: 'e', step: 10 }, matchSteps: 0 })).toThrow();
  });
});

/** Every way to pick which of the 14 matchdays a knight starts, `starts` of them. */
function rotations(starts: number): boolean[][] {
  const out: boolean[][] = [];
  for (let mask = 0; mask < 1 << MATCHDAYS; mask++) {
    const days = Array.from({ length: MATCHDAYS }, (_, d) => ((mask >> d) & 1) === 1);
    if (days.filter(Boolean).length === starts) out.push(days);
  }
  return out;
}

/** Knight a's stamina going into each matchday and after the last, starting the days marked true. */
function seasonOf(starts: readonly boolean[]): number[] {
  let stamina = freshStamina(evenSquad);
  const before: number[] = [];
  for (const plays of starts) {
    before.push(stamina.a ?? NaN);
    const others = IDS.filter((id) => id !== 'a').slice(0, plays ? 3 : 4);
    stamina = afterMatchday(stamina, full(plays ? ['a', ...others] : others));
  }
  return [...before, stamina.a ?? NaN];
}

const pattern = (days: readonly boolean[]): string => days.map((d) => (d ? 'S' : 'r')).join('');

/** Nine starts in eleven days, the one squeeze a 10-start rotation with short runs can't absorb. */
const SQUEEZE = 'SSSrSSSrSSS';

const longestRun = (days: readonly boolean[]): number =>
  Math.max(
    ...days
      .map((d) => (d ? 'S' : 'r'))
      .join('')
      .split('r')
      .map((run) => run.length),
  );

describe('the season tuning target', () => {
  it('lets a knight start 10 of 14 at full strength all season, resting every third matchday', () => {
    const days = Array.from({ length: MATCHDAYS }, (_, d) => d % 3 !== 2);
    expect(days.filter(Boolean)).toHaveLength(10);
    const stamina = seasonOf(days);
    expect(Math.min(...stamina)).toBeGreaterThanOrEqual(FRESH);
  });

  it('keeps 10 starts fresh for every spread with at most three in a row, bar three such runs back to back', () => {
    const spread = rotations(10).filter((days) => longestRun(days) <= 3);
    const tiring = spread.filter((days) => Math.min(...seasonOf(days)) < FRESH);
    expect(spread).toHaveLength(101);
    expect(tiring.map(pattern)).toEqual(spread.map(pattern).filter((p) => p.includes(SQUEEZE)));
    expect(tiring).toHaveLength(6);
  });

  it('drops a knight who starts 12 of 14 below FRESH before the end, however the rests fall', () => {
    for (const days of rotations(12)) {
      const stamina = seasonOf(days);
      const tiredAt = stamina.findIndex((s) => s < FRESH);
      expect(tiredAt).toBeGreaterThan(0);
      expect(tiredAt).toBeLessThan(MATCHDAYS);
    }
  });

  it('makes a knight who starts all 14 clearly slower over the last four', () => {
    const before = seasonOf(Array.from({ length: MATCHDAYS }, () => true)).slice(0, MATCHDAYS);
    expect(before.slice(0, 3).map(staminaFactor)).toEqual([1, 1, 1]);
    for (const s of before.slice(-4)) expect(staminaFactor(s)).toBeLessThan((1 + TIRED_FLOOR) / 2);
  });

  it('keeps a squad of six fresh when the two rests rotate: 56 starts, 9 or 10 each', () => {
    let stamina = freshStamina(evenSquad);
    const starts = new Map<string, number>();
    for (let day = 0; day < MATCHDAYS; day++) {
      const resting = [IDS[(2 * day) % 6], IDS[(2 * day + 1) % 6]];
      const starters = IDS.filter((id) => !resting.includes(id));
      for (const id of starters) {
        expect(stamina[id]).toBeGreaterThanOrEqual(FRESH);
        starts.set(id, (starts.get(id) ?? 0) + 1);
      }
      stamina = afterMatchday(stamina, full(starters));
    }
    expect([...starts.values()].reduce((a, b) => a + b, 0)).toBe(56);
    for (const n of starts.values()) expect([9, 10]).toContain(n);
    for (const s of Object.values(stamina)) expect(s).toBeGreaterThanOrEqual(FRESH);
  });
});

describe('chooseLineup', () => {
  const ids = (knights: readonly { readonly id: string }[]) => knights.map((k) => k.id);
  const starterIds = (squad: readonly SquadKnight[], stamina: Stamina, style = balanced, left = 10) =>
    ids(chooseLineup(squad, stamina, style, left).starters.map((s) => s.knight));

  it('names four starters in role order and two on the bench, a Hefty in goal and the lightest up front', () => {
    const squad = [
      knight('a', 2, NIMBLE),
      knight('b'),
      knight('c', 2, HEFTY),
      knight('d'),
      knight('e', 1),
      knight('f', 1),
    ];
    const lineup = chooseLineup(squad, freshStamina(squad), balanced, MATCHDAYS);
    expect(lineup.starters.map((s) => s.role)).toEqual(ROLES);
    expect(lineup.starters.map((s) => s.knight.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(ids(lineup.bench).sort()).toEqual(['e', 'f']);
  });

  it('puts the starter the outfield would miss least in goal, not a heavy star', () => {
    const squad = [
      knight('legend', 4, HEFTY),
      knight('champion', 3),
      knight('knight', 2, NIMBLE),
      knight('squire', 1),
      knight('p1', 0),
      knight('p2', 0),
    ];
    const lineup = chooseLineup(squad, freshStamina(squad), balanced, MATCHDAYS);
    expect(lineup.starters[0]?.knight.id).toBe('squire');
    expect(lineup.starters.map((s) => s.knight.id)).toContain('legend');
  });

  it('rests a knight below FRESH when a fresher one of the same tier is on the bench', () => {
    const stamina = { a: 62, b: 100, c: 100, d: 100, e: 100, f: 90 };
    expect(starterIds(evenSquad, stamina)).not.toContain('a');
  });

  it('starts a tired Legend over a fresh Peasant', () => {
    const squad = [knight('a', 4), ...IDS.slice(1).map((id) => knight(id, 0))];
    expect(starterIds(squad, { ...freshStamina(squad), a: 10 })).toContain('a');
  });

  it('rests a worn Legend for a fresh Champion mid-season, but plays him on the last matchday', () => {
    const squad = [
      knight('a', 4),
      knight('b', 3),
      knight('c', 3),
      knight('d', 3),
      knight('e', 3),
      knight('f', 0),
    ];
    const stamina = { ...freshStamina(squad), a: 52 };
    expect(starterIds(squad, stamina, balanced, 10)).not.toContain('a');
    expect(starterIds(squad, stamina, balanced, 1)).toContain('a');
  });

  it('lets a star house lean on its Legend where a depth house rotates him', () => {
    const squad = [
      knight('a', 4),
      knight('b', 3),
      knight('c', 3),
      knight('d', 3),
      knight('e', 3),
      knight('f', 0),
    ];
    const stamina = { ...freshStamina(squad), a: 56 };
    expect(starterIds(squad, stamina, { ...balanced, draft: 'stars' }, 8)).toContain('a');
    expect(starterIds(squad, stamina, { ...balanced, draft: 'depth' }, 8)).not.toContain('a');
  });

  it('rotates an even squad through a season with every start at full strength', () => {
    let stamina = freshStamina(evenSquad);
    const starts = new Map<string, number>();
    for (let day = 0; day < MATCHDAYS; day++) {
      const starters = starterIds(evenSquad, stamina, balanced, MATCHDAYS - day);
      for (const id of starters) {
        expect(stamina[id]).toBeGreaterThanOrEqual(FRESH);
        starts.set(id, (starts.get(id) ?? 0) + 1);
      }
      stamina = afterMatchday(stamina, full(starters));
    }
    expect([...starts.values()].sort((x, y) => x - y)).toEqual([9, 9, 9, 9, 10, 10]);
  });

  it('chooses the same line-up whatever order the squad comes in', () => {
    const squad = [
      knight('a', 3),
      knight('b', 2, HEFTY),
      knight('c'),
      knight('d', 1),
      knight('e'),
      knight('f', 2, NIMBLE),
    ];
    const stamina = { a: 64, b: 90, c: 71, d: 100, e: 40, f: 75 };
    const lineup = chooseLineup(squad, stamina, balanced, 6);
    expect(chooseLineup([...squad].reverse(), stamina, balanced, 6)).toEqual(lineup);
  });

  it('refuses a squad of the wrong size, a knight twice, missing stamina or no matchdays left', () => {
    const stamina = freshStamina(evenSquad);
    expect(() => chooseLineup(evenSquad.slice(1), stamina, balanced, 5)).toThrow();
    expect(() => chooseLineup([...evenSquad.slice(1), knight('b')], stamina, balanced, 5)).toThrow();
    expect(() => chooseLineup(evenSquad, { ...stamina, a: NaN }, balanced, 5)).toThrow();
    expect(() => chooseLineup(evenSquad, { b: 100 }, balanced, 5)).toThrow();
    expect(() => chooseLineup(evenSquad, stamina, balanced, 0)).toThrow();
  });
});

describe('rivalTactics', () => {
  const style: HouseStyle = { draft: 'depth', tactics: { press: 'mid', shooting: 'patient' } };

  it('plays the house’s own way until late, then charges when behind and holds when ahead', () => {
    expect(rivalTactics(style, LATE - 0.01, -1)).toBe(style.tactics);
    expect(rivalTactics(style, LATE, -1)).toBe(CHARGE);
    expect(rivalTactics(style, LATE, 2)).toBe(HOLD);
    expect(rivalTactics(style, 0.95, 0)).toBe(style.tactics);
  });

  it('gives Charge and Hold the opposite levers', () => {
    expect(CHARGE).toEqual({ press: 'high', shooting: 'early' });
    expect(HOLD).toEqual({ press: 'low', shooting: 'patient' });
  });
});

describe('createRivalManager', () => {
  const tier2 = (stamina: number, role: Role): KnightSpec => squadKnightSpec(knight('x'), stamina, role);
  const starters = [100, 40, 90, 75];
  const bench = [
    { spec: tier2(100, 'mid'), stamina: 100 },
    { spec: tier2(80, 'mid'), stamina: 80 },
  ];
  const setup: RivalSetup = { style: balanced, starters, bench, matchdaysLeft: 6 };
  const match = (): MatchState =>
    createMatch({
      home: ROLES.map((role, i) => tier2(starters[i] ?? 100, role)),
      away: ROLES.map((role) => tier2(100, role)),
      seed: 3,
      draws: true,
    });

  /** Polls the manager for team 0 once a second over `seconds` of clock, with the given score. */
  function poll(
    rival: ReturnType<typeof createRivalManager>,
    state: MatchState,
    from: number,
    to: number,
    score: [number, number],
  ) {
    const actions: { at: number; action: ManagerAction }[] = [];
    state.score[0] = score[0];
    state.score[1] = score[1];
    for (let t = from; t < to; t++) {
      state.clock = MATCH.duration - t;
      const action = rival.manage(state, 0);
      if (action) actions.push({ at: t, action });
    }
    return actions;
  }

  it('takes the most tired starter off for the best bench knight at the set point, and only once', () => {
    const rival = createRivalManager(setup);
    const state = match();
    const actions = poll(rival, state, 0, MATCH.duration, [1, 1]);
    expect(actions).toHaveLength(1);
    const [only] = actions;
    expect(only?.at).toBe(Math.ceil(MATCH.duration * SUB_AT));
    expect(only?.action).toEqual({ kind: 'substitution', offId: 1, on: bench[0]?.spec });
    expect(rival.substitution()).toEqual({ offSlot: 1, benchSlot: 0, step: (only?.at ?? 0) * 120 });
  });

  it('makes the change at half-time when chasing the game', () => {
    const actions = poll(createRivalManager(setup), match(), 0, 60, [0, 1]);
    expect(actions[0]?.at).toBe(MATCH.duration * CHASING_SUB_AT);
    expect(actions[0]?.action.kind).toBe('substitution');
  });

  it('charges once when behind late, holds once when ahead late, and goes back to its own way once level', () => {
    const lateAt = Math.ceil(MATCH.duration * LATE);
    const rival = createRivalManager({ ...setup, bench: [] });
    const state = match();
    expect(poll(rival, state, 0, lateAt, [0, 1])).toEqual([]);
    expect(poll(rival, state, lateAt, 80, [0, 1]).map((a) => a.action)).toEqual([
      { kind: 'tactics', tactics: CHARGE },
    ]);
    expect(poll(rival, state, 80, 85, [1, 1]).map((a) => a.action)).toEqual([
      { kind: 'tactics', tactics: DEFAULT_TACTICS },
    ]);
    expect(poll(rival, state, 85, MATCH.duration, [2, 1]).map((a) => a.action)).toEqual([
      { kind: 'tactics', tactics: HOLD },
    ]);
  });

  it('sends nothing when its own tactics already are the late preset', () => {
    const holding: Tactics = { ...HOLD };
    const rival = createRivalManager({ ...setup, bench: [], style: { draft: 'depth', tactics: holding } });
    expect(poll(rival, match(), 0, MATCH.duration, [3, 0])).toEqual([]);
  });

  it('keeps a fresh line-up on when the bench is weaker', () => {
    const weak = [{ spec: squadKnightSpec(knight('p', 0), 100, 'mid'), stamina: 100 }];
    const rival = createRivalManager({ ...setup, starters: [100, 100, 100, 100], bench: weak });
    expect(poll(rival, match(), 0, MATCH.duration, [0, 0])).toEqual([]);
    expect(rival.substitution()).toBeNull();
  });

  it('refuses to manage without every starter’s stamina or with no matchdays left', () => {
    expect(() => createRivalManager({ ...setup, starters: [100, 100, 100] })).toThrow();
    expect(() => createRivalManager({ ...setup, starters: [100, 100, NaN, 100] })).toThrow();
    expect(() => createRivalManager({ ...setup, matchdaysLeft: 0 })).toThrow();
  });

  it('reports the step the runner made the substitution on, and plays the same match every time', () => {
    const play = () => {
      const home = createRivalManager(setup);
      const away = createRivalManager({ ...setup, starters: [100, 100, 100, 30] });
      const runner = new MatchRunner({
        home: ROLES.map((role, i) => tier2(starters[i] ?? 100, role)),
        away: ROLES.map((role) => tier2(100, role)),
        seed: 11,
        draws: true,
        managers: [home.manage, away.manage],
      });
      const subSteps: [number | null, number | null] = [null, null];
      while (!runner.ended) {
        const before = [0, 1].map((t) => runner.state.substituted.filter((k) => k.team === t).length);
        const step = runner.step;
        runner.advanceOne();
        for (const t of [0, 1] as const)
          if (runner.state.substituted.filter((k) => k.team === t).length > (before[t] ?? 0))
            subSteps[t] = step;
      }
      return {
        reported: [home.substitution(), away.substitution()],
        subSteps,
        score: [...runner.state.score],
      };
    };
    const first = play();
    expect(first.subSteps[0]).not.toBeNull();
    expect(first.reported[0]?.step).toBe(first.subSteps[0]);
    expect(first.reported[1]?.offSlot).toBe(3);
    expect(play()).toEqual(first);
  });

  it('reports a tactical substitution at the step the runner made it, from a fresh line-up', () => {
    const peasantUpFront = ROLES.map((role, i) =>
      squadKnightSpec(knight(`s${String(i)}`, i === 3 ? 0 : 2), 100, role),
    );
    const legend = { spec: squadKnightSpec(knight('L', 4), 100, 'mid'), stamina: 100 };
    const rival = createRivalManager({
      style: balanced,
      starters: [100, 100, 100, 100],
      bench: [legend],
      matchdaysLeft: 6,
    });
    const runner = new MatchRunner({
      home: ROLES.map((role) => tier2(100, role)),
      away: peasantUpFront,
      seed: 11,
      draws: true,
      managers: [null, rival.manage],
    });
    let subStep: number | null = null;
    while (!runner.ended) {
      const step = runner.step;
      runner.advanceOne();
      if (subStep === null && runner.state.substituted.some((k) => k.team === 1)) subStep = step;
    }
    expect(subStep).not.toBeNull();
    expect(rival.substitution()).toEqual({ offSlot: 3, benchSlot: 0, step: subStep });
    expect(runner.state.substituted.map((k) => k.id)).toEqual([7]);
  });
});

describe('tactical substitutions', () => {
  const side = (tiers: readonly number[]): KnightSpec[] =>
    ROLES.map((role, i) => squadKnightSpec(knight(`s${String(i)}`, tiers[i] ?? 2), 100, role));
  const matchOf = (home: readonly KnightSpec[]): MatchState =>
    createMatch({ home, away: side([2, 2, 2, 2]), seed: 3, draws: true });
  /** A Legend rested because he is worn: worth bringing on only when the match is still in the balance. */
  const tiredLegend = { spec: squadKnightSpec(knight('L', 4), 40, 'mid'), stamina: 40 };
  const rivalWith = (bench: RivalSetup['bench']) =>
    createRivalManager({ style: balanced, starters: [100, 100, 100, 100], bench, matchdaysLeft: 10 });

  /** The manager's substitutions for team 0, polled once a second through `spans` of [from, to, score]. */
  function subsOver(
    rival: ReturnType<typeof createRivalManager>,
    home: readonly KnightSpec[],
    spans: readonly (readonly [number, number, readonly [number, number]])[],
  ) {
    const state = matchOf(home);
    const subs: { at: number; action: ManagerAction }[] = [];
    for (const [from, to, [us, them]] of spans) {
      state.score[0] = us;
      state.score[1] = them;
      for (let t = from; t < to; t++) {
        state.clock = MATCH.duration - t;
        const action = rival.manage(state, 0);
        if (action?.kind === 'substitution') subs.push({ at: t, action });
      }
    }
    return subs;
  }
  const whole = (score: readonly [number, number]) => [[0, MATCH.duration, score]] as const;

  it('brings a stronger knight on for its weakest outfield one when behind, from half-time', () => {
    const home = side([2, 2, 2, 0]);
    const rival = rivalWith([tiredLegend]);
    const subs = subsOver(rival, home, whole([0, 1]));
    expect(subs).toEqual([
      {
        at: MATCH.duration * CHASING_SUB_AT,
        action: { kind: 'substitution', offId: 3, on: tiredLegend.spec },
      },
    ]);
    expect(rival.substitution()).toEqual({
      offSlot: 3,
      benchSlot: 0,
      step: MATCH.duration * CHASING_SUB_AT * 120,
    });
  });

  it('protects a lead late by bringing the stronger knight on in defence', () => {
    const home = side([2, 0, 2, 2]);
    const subs = subsOver(rivalWith([tiredLegend]), home, whole([2, 1]));
    expect(subs).toEqual([
      {
        at: Math.ceil(MATCH.duration * SUB_AT),
        action: { kind: 'substitution', offId: 1, on: tiredLegend.spec },
      },
    ]);
  });

  it('spends a tired star’s stamina only while the match is in the balance, not once it is settled', () => {
    const home = side([2, 2, 2, 0]);
    expect(subsOver(rivalWith([tiredLegend]), home, whole([1, 1]))).toHaveLength(1);
    expect(subsOver(rivalWith([tiredLegend]), home, whole([0, 3]))).toEqual([]);
    expect(subsOver(rivalWith([tiredLegend]), home, whole([3, 0]))).toEqual([]);
  });

  it('takes the keeper off only to rest him, never for a tactical change', () => {
    const keeperAt = (stamina: number) =>
      createRivalManager({
        style: balanced,
        starters: [stamina, 100, 100, 100],
        bench: [{ spec: squadKnightSpec(knight('b', 0), 100, 'mid'), stamina: 100 }],
        matchdaysLeft: 10,
      });
    const home = side([0, 2, 2, 2]);
    for (const score of [
      [0, 1],
      [1, 1],
      [2, 1],
    ] as const) {
      expect(subsOver(keeperAt(FRESH + 5), home, whole(score))).toEqual([]);
    }
    expect(subsOver(keeperAt(20), home, whole([1, 1])).map((s) => s.action)).toEqual([
      { kind: 'substitution', offId: 0, on: squadKnightSpec(knight('b', 0), 100, 'mid') },
    ]);
  });

  it('never substitutes when the bench is no better, whatever the score', () => {
    const equal = { spec: squadKnightSpec(knight('e'), 100, 'mid'), stamina: 100 };
    const weaker = { spec: squadKnightSpec(knight('w', 1), 100, 'mid'), stamina: 100 };
    for (const score of [
      [0, 1],
      [1, 1],
      [2, 1],
      [0, 3],
    ] as const) {
      const rival = rivalWith([equal, weaker]);
      expect(subsOver(rival, side([2, 2, 2, 2]), whole(score))).toEqual([]);
      expect(rival.substitution()).toBeNull();
    }
  });

  it('makes one substitution at most, however the match turns', () => {
    const fresh = (id: string) => ({ spec: squadKnightSpec(knight(id, 4), 100, 'mid'), stamina: 100 });
    const rival = rivalWith([fresh('L1'), fresh('L2')]);
    const subs = subsOver(rival, side([2, 0, 0, 2]), [
      [0, 60, [0, 1]],
      [60, 75, [1, 1]],
      [75, MATCH.duration, [2, 1]],
    ]);
    expect(subs).toHaveLength(1);
    expect(rival.substitution()?.offSlot).toBe(1);
  });
});

describe('pointsPerGoal', () => {
  it('is exact at full time: a goal from level is worth 1.5 points, from one behind 0.5, one ahead 1', () => {
    expect(pointsPerGoal(0, 0)).toBeCloseTo(1.5, 12);
    expect(pointsPerGoal(-1, 0)).toBeCloseTo(0.5, 12);
    expect(pointsPerGoal(1, 0)).toBeCloseTo(1, 12);
    expect(pointsPerGoal(2, 0)).toBe(0);
  });

  it('weighs a close match late above a future match and a settled one far below', () => {
    expect(leverage(0, 1)).toBeCloseTo(1, 12);
    const late = 1 / 3;
    expect(leverage(0, late)).toBeGreaterThan(leverage(1, late));
    expect(leverage(1, late)).toBeGreaterThan(leverage(-1, late));
    expect(leverage(-1, late)).toBeGreaterThan(0.5);
    expect(leverage(-3, late)).toBeLessThan(0.15);
    expect(leverage(3, late)).toBeLessThan(0.15);
  });
});
