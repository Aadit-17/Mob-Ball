/**
 * Stamina harness: what tiredness costs on the real simulation, in goals and next to a tier.
 * Run with `npx vitest run --config scripts/vitest.config.ts scripts/stamina.sim.ts`.
 */
import { describe, it } from 'vitest';
import { skillFor } from '../src/ai/skills';
import type { Tactics, TeamTactics } from '../src/ai/tactics';
import { DEFAULT_TACTICS } from '../src/ai/tactics';
import type { KnightSpec } from '../src/game/match';
import type { Role } from '../src/game/types';
import { DEFAULT_LOOK } from '../src/knight/look';
import { createRivalManager, CHARGE, HOLD, staminaFactor, STAMINA_MAX } from '../src/modes/manager/stamina';
import type { HouseStyle } from '../src/modes/manager/types';
import { MatchRunner, type Manager } from '../src/modes/runner';

/** Seeds per comparison; each is played with the sides both ways round, so pairs cancel any side bias. */
const PAIRS = Number(process.env.PAIRS ?? 300);
const TIER = 2;
const ROLES: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];

const spec = (tier: number, stamina: number, role: Role): KnightSpec => ({
  look: DEFAULT_LOOK,
  role,
  human: false,
  tier,
  speedFactor: skillFor(tier).speed * staminaFactor(stamina),
});

const team = (tier: number, stamina: number): KnightSpec[] => ROLES.map((role) => spec(tier, stamina, role));

interface Side {
  readonly specs: readonly KnightSpec[];
  readonly tactics?: Tactics;
  /** A fresh manager per match. */
  readonly manager?: () => Manager;
}

/** Goals for and against side `a` in one match, `a` at home or away. */
function playOnce(a: Side, b: Side, seed: number, aHome: boolean): readonly [number, number] {
  const [home, away] = aHome ? [a, b] : [b, a];
  const tactics: TeamTactics = [home.tactics ?? DEFAULT_TACTICS, away.tactics ?? DEFAULT_TACTICS];
  const runner = new MatchRunner({
    home: home.specs,
    away: away.specs,
    seed,
    draws: true,
    tactics,
    managers: [home.manager?.() ?? null, away.manager?.() ?? null],
  });
  runner.advance(Infinity);
  const [h, w] = runner.state.score;
  return aHome ? [h, w] : [w, h];
}

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Goal difference a match for `a`, ±2 standard errors over the seed pairs, then goals for and against. */
function compare(label: string, a: Side, b: Side): void {
  const pairs = Array.from({ length: PAIRS }, (_, i) => {
    const seed = 10_000 + i * 7919;
    const [home, away] = [playOnce(a, b, seed, true), playOnce(a, b, seed, false)];
    return { gf: (home[0] + away[0]) / 2, ga: (home[1] + away[1]) / 2 };
  });
  const diffs = pairs.map((p) => p.gf - p.ga);
  const gd = mean(diffs);
  const sd = Math.sqrt(diffs.reduce((s, x) => s + (x - gd) ** 2, 0) / (PAIRS - 1));
  const se2 = (2 * sd) / Math.sqrt(PAIRS);
  const goals = `(${mean(pairs.map((p) => p.gf)).toFixed(2)} for, ${mean(pairs.map((p) => p.ga)).toFixed(2)} against)`;
  console.log(
    `${label.padEnd(40)} ${gd >= 0 ? '+' : ''}${gd.toFixed(2)} ± ${se2.toFixed(2)} goals a match ${goals}`,
  );
}

const fresh: Side = { specs: team(TIER, STAMINA_MAX) };

// Two tired starters and a fresh bench knight: does the rival's touchline beat standing still?
const style: HouseStyle = { draft: 'balanced', tactics: DEFAULT_TACTICS };
const starters = [STAMINA_MAX, 30, 30, STAMINA_MAX];
const tired: Side = { specs: ROLES.map((role, i) => spec(TIER, starters[i] ?? STAMINA_MAX, role)) };
const bench = [{ spec: spec(TIER, STAMINA_MAX, 'mid'), stamina: STAMINA_MAX }];
const lateOnly: Side = {
  specs: fresh.specs,
  manager: () =>
    createRivalManager({ style, starters: [100, 100, 100, 100], bench: [], matchdaysLeft: 5 }).manage,
};
const managed: Side = {
  specs: tired.specs,
  manager: () => createRivalManager({ style, starters, bench, matchdaysLeft: 5 }).manage,
};

/** One line of the report as its own test, so each gets the full timeout. */
function line(label: string, a: Side, b: Side): void {
  it(label, () => {
    compare(label, a, b);
  });
}

describe(`stamina report: ${PAIRS * 2} matches a line, Knight tier, goal difference for the first side`, () => {
  line('stamina 0 v fresh', { specs: team(TIER, 0) }, fresh);
  line('stamina 35 v fresh', { specs: team(TIER, 35) }, fresh);
  line('Champion v Knight (a tier up)', { specs: team(TIER + 1, STAMINA_MAX) }, fresh);
  line('Squire v Knight (a tier down)', { specs: team(TIER - 1, STAMINA_MAX) }, fresh);
  line('Charge v default', { specs: fresh.specs, tactics: CHARGE }, fresh);
  line('Hold v default', { specs: fresh.specs, tactics: HOLD }, fresh);
  line('late Charge/Hold v none, equal teams', lateOnly, fresh);
  line('managed v unmanaged, same tired line-up', managed, tired);
});
