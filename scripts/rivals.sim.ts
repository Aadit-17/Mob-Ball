/**
 * Rival touchline harness: how often rival managers substitute in real seasons, and whether it pays.
 * Run with `npx vitest run --config scripts/vitest.config.ts scripts/rivals.sim.ts` (SEASONS=n to change).
 */
import { describe, it } from 'vitest';
import { BOTH_DEFAULT } from '../src/ai/tactics';
import { DEFAULT_LOOK } from '../src/knight/look';
import { MATCH } from '../src/game/constants';
import type { Role } from '../src/game/types';
import { DRAFT_HOUSES, OUTFIELD_BUILD_VALUE, OUTFIELD_TIER_VALUE } from '../src/modes/manager/draft';
import { fixtures, MATCHDAYS } from '../src/modes/manager/league';
import {
  autoDraft,
  knightStamina,
  planMatch,
  startSeason,
  type MatchPlan,
  type SeasonState,
} from '../src/modes/manager/season';
import { FRESH, squadKnightSpec, STAMINA_MAX } from '../src/modes/manager/stamina';
import type { SquadKnight } from '../src/modes/manager/types';
import { MatchRunner, type FixtureConfig, type Manager } from '../src/modes/runner';
import { rateMatch } from '../src/stats/ratings';

const SEASONS = Number(process.env.SEASONS ?? 12);
const ROLES: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];
const KNIGHT: SquadKnight = { id: 'k', look: DEFAULT_LOOK, tier: 2, forged: false };
/** The hour mark, where the game state each side faces is read. */
const HOUR = 2 / 3;

const outfieldWorth = (k: SquadKnight): number =>
  (OUTFIELD_TIER_VALUE[k.tier] ?? 0) + (OUTFIELD_BUILD_VALUE[k.look.build] ?? 0);

type Reason = 'keeper' | 'stronger' | 'legs' | 'rest';

interface SideLog {
  readonly leadAtHour: number;
  /** Why the sub was worth it, read from who went off and who came on; null if none was made. */
  readonly reason: Reason | null;
  /** Whether any bench knight's fitted outfield value beat an outfield starter's at kick-off. */
  readonly betterBench: boolean;
}

/** A played fixture, kept so the same line-ups can be replayed with a manager switched off. */
interface Played {
  readonly plan: MatchPlan;
  /** Sides (0 left, 1 right) with a rival manager, and how each one's match went. */
  readonly rivals: readonly { readonly team: 0 | 1; readonly log: SideLog }[];
}

const logs: SideLog[] = [];
/** Goals each side scored, for the league scoring rate the rival's points-per-goal model assumes. */
const sideGoals: number[] = [];
const played: Played[] = [];

function playSeason(seed: number): void {
  const player = DRAFT_HOUSES[seed % DRAFT_HOUSES.length] ?? 'ember';
  let season: SeasonState = startSeason(seed, player, DEFAULT_LOOK);
  while (!season.league) season = autoDraft(season);
  for (let day = 0; day < MATCHDAYS; day++) {
    const { league } = season;
    if (!league) throw new Error('The league has not started');
    for (const fixture of fixtures(league, day)) {
      const plan = planMatch(season, fixture);
      const runner = new MatchRunner(plan.config());
      while (!runner.ended && 1 - runner.state.clock / MATCH.duration < HOUR) runner.advance(1);
      const [l, r] = runner.state.score;
      runner.advance(Infinity);
      const [home, away] = runner.state.score;
      sideGoals.push(home, away);
      const outcome = { score: [home, away] as const, steps: runner.step, timeline: runner.timeline };
      const finished = plan.finish(season, {
        ...outcome,
        goals: runner.goals,
        ratings: rateMatch(runner.stats),
      });
      const rivals = ([0, 1] as const)
        .filter((t) => plan.sides[t].manager)
        .map((team) => ({ team, log: sideLog(season, plan, runner, team, team === 0 ? l - r : r - l) }));
      logs.push(...rivals.map((r) => r.log));
      played.push({ plan, rivals });
      season = finished;
    }
  }
}

function sideLog(
  season: SeasonState,
  plan: MatchPlan,
  runner: MatchRunner,
  team: 0 | 1,
  lead: number,
): SideLog {
  const side = plan.sides[team];
  const outfield = side.lineup.starters.filter((s) => s.role !== 'gk').map((s) => s.knight);
  const worst = Math.min(...outfield.map(outfieldWorth));
  const betterBench = side.lineup.bench.some((k) => outfieldWorth(k) > worst);
  const sub = runner.state.substituted.find((k) => k.team === team);
  if (!sub) return { leadAtHour: lead, reason: null, betterBench };
  const off = side.lineup.starters[sub.id - team * 4]?.knight;
  const cameOn = runner.state.knights.find((k) => k.team === team && k.role === sub.role);
  const on = side.lineup.bench.find((k) => k.look.name === cameOn?.look.name);
  if (!off || !on) throw new Error('A substitution the line-up does not explain');
  const reason: Reason =
    sub.role === 'gk'
      ? 'keeper'
      : outfieldWorth(on) > outfieldWorth(off)
        ? 'stronger'
        : knightStamina(season, side.house, off.id) < FRESH
          ? 'legs'
          : 'rest';
  return { leadAtHour: lead, reason, betterBench };
}

const pct = (n: number, of: number): string => `${((100 * n) / Math.max(1, of)).toFixed(1)}% (${n}/${of})`;

const REASONS: Readonly<Record<Reason, string>> = {
  keeper: 'keeper off (no keeper tier or build is fitted)',
  stronger: 'outfield knight fitted higher came on',
  legs: 'starter below FRESH came off',
  rest: 'starter rested to save stamina',
};

function reportRates(): void {
  console.log(`goals a side a match ${mean(sideGoals).toFixed(2)} ± ${twoSe(sideGoals).toFixed(2)}`);
  const within = (lo: number, hi: number) => (s: SideLog) => s.leadAtHour >= lo && s.leadAtHour <= hi;
  const groups: readonly [string, (s: SideLog) => boolean][] = [
    ['every rival side', () => true],
    ['  behind by one at the hour (chasing)', within(-1, -1)],
    ['  level at the hour', within(0, 0)],
    ['  ahead by one at the hour (protecting)', within(1, 1)],
    ['  settled at the hour (two or more apart)', (s) => Math.abs(s.leadAtHour) >= 2],
    ['bench holds a knight fitted above a starter', (s) => s.betterBench],
    ['bench holds nobody fitted above a starter', (s) => !s.betterBench],
  ];
  for (const [label, keep] of groups) {
    const rows = logs.filter(keep);
    console.log(`${label.padEnd(44)} ${pct(rows.filter((s) => s.reason).length, rows.length)}`);
  }
  const subs = logs.filter((s) => s.reason);
  for (const [reason, label] of Object.entries(REASONS))
    console.log(`  ${label.padEnd(46)} ${pct(subs.filter((s) => s.reason === reason).length, subs.length)}`);
}

/** The same fixture with the sides swapped, so any side bias cancels within a pair. */
function mirrored(c: FixtureConfig): FixtureConfig {
  const [tactics, managers] = [c.tactics ?? BOTH_DEFAULT, c.managers ?? [null, null]];
  return {
    ...c,
    home: c.away,
    away: c.home,
    tactics: [tactics[1], tactics[0]],
    managers: [managers[1], managers[0]],
  };
}

/** Side `team`'s manager replaced: switched off, or with its substitutions refused. */
type Variant = 'managed' | 'off' | 'no subs';

function withVariant(c: FixtureConfig, team: 0 | 1, variant: Variant): FixtureConfig {
  const own = c.managers?.[team] ?? null;
  const swap: Manager | null =
    variant === 'managed'
      ? own
      : variant === 'off' || !own
        ? null
        : (state, t) => {
            const action = own(state, t);
            return action?.kind === 'substitution' ? null : action;
          };
  const managers = c.managers ?? [null, null];
  return { ...c, managers: team === 0 ? [swap, managers[1]] : [managers[0], swap] };
}

const points = (gd: number): number => (gd > 0 ? 3 : gd === 0 ? 1 : 0);

/** Points and goal difference for side `team`, the mean of both ends. */
function result(plan: MatchPlan, team: 0 | 1, variant: Variant): { pts: number; gd: number } {
  const ends = [false, true].map((flip) => {
    const config = withVariant(plan.config(), team, variant);
    const runner = new MatchRunner(flip ? mirrored(config) : config);
    runner.advance(Infinity);
    const [h, a] = runner.state.score;
    const gd = (team === 0) !== flip ? h - a : a - h;
    return { pts: points(gd), gd };
  });
  return { pts: mean(ends.map((e) => e.pts)), gd: mean(ends.map((e) => e.gd)) };
}

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const twoSe = (xs: readonly number[]): number => {
  const m = mean(xs);
  return (2 * Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))) / Math.sqrt(xs.length);
};
const signed = (x: number): string => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;

/** The managed result of each side-fixture, worked out once for both comparisons. */
const managed = new Map<string, { pts: number; gd: number }>();

function line(label: string, pts: readonly number[], gd: readonly number[]): void {
  if (pts.length < 2) return;
  console.log(
    `${label.padEnd(40)} ${signed(mean(pts))} ± ${twoSe(pts).toFixed(3)} pts, ` +
      `${signed(mean(gd))} ± ${twoSe(gd).toFixed(3)} goals a match (n ${String(pts.length)})`,
  );
}

/** Managed minus `against` for every rival side, overall and by why it subbed (a side that didn't sub
 * plays the same match both ways bar its late tactics). */
function compare(against: Exclude<Variant, 'managed'>): void {
  const rows: { log: SideLog; pts: number; gd: number }[] = [];
  for (const [i, { plan, rivals }] of played.entries()) {
    for (const { team, log } of rivals) {
      const key = `${String(i)}:${String(team)}`;
      const a = managed.get(key) ?? result(plan, team, 'managed');
      managed.set(key, a);
      const b = result(plan, team, against);
      rows.push({ log, pts: a.pts - b.pts, gd: a.gd - b.gd });
    }
  }
  const report = (label: string, keep: (log: SideLog) => boolean): void => {
    const kept = rows.filter((r) => keep(r.log));
    line(
      label,
      kept.map((r) => r.pts),
      kept.map((r) => r.gd),
    );
  };
  report(`managed v ${against}`, () => true);
  report('  sides that subbed', (log) => log.reason !== null);
  for (const [reason, label] of Object.entries(REASONS))
    report(`    ${label}`, (log) => log.reason === reason);
}

/** Seed pairs for the cost of the substitution itself, an equal knight on for an equal knight at the hour. */
const PAIRS = Number(process.env.PAIRS ?? 300);

function swapCost(role: Role): void {
  const team = ROLES.map((r) => squadKnightSpec(KNIGHT, STAMINA_MAX, r));
  const sub = (): Manager => {
    let done = false;
    return (state, t) => {
      const off = state.knights.find((k) => k.team === t && k.role === role);
      if (done || !off || 1 - state.clock / MATCH.duration < HOUR) return null;
      done = true;
      return { kind: 'substitution', offId: off.id, on: squadKnightSpec(KNIGHT, STAMINA_MAX, role) };
    };
  };
  const pts: number[] = [];
  const gd: number[] = [];
  for (let i = 0; i < PAIRS; i++) {
    const seed = 10_000 + i * 7919;
    const ends = [false, true].map((flip) => {
      const play = (manager: Manager | null): number => {
        const runner = new MatchRunner({
          home: team,
          away: team,
          seed,
          draws: true,
          managers: flip ? [null, manager] : [manager, null],
        });
        runner.advance(Infinity);
        const [h, a] = runner.state.score;
        return flip ? a - h : h - a;
      };
      const [withSub, without] = [play(sub()), play(null)];
      return { pts: points(withSub) - points(without), gd: withSub - without };
    });
    pts.push(mean(ends.map((e) => e.pts)));
    gd.push(mean(ends.map((e) => e.gd)));
  }
  line(`equal ${role} sub at the hour v none`, pts, gd);
}

describe(`rivals report: ${SEASONS} seasons of real drafts`, () => {
  it('substitution rates by the game state at the hour', () => {
    for (let seed = 1; seed <= SEASONS; seed++) playSeason(seed);
    reportRates();
  });
  it('managed v the same side with its manager switched off', () => {
    compare('off');
  }, 3_600_000);
  it('managed v the same side with its substitutions refused', () => {
    compare('no subs');
  }, 3_600_000);
  it('the cost of a substitution itself, on equal Knight sides', () => {
    swapCost('fwd');
    swapCost('gk');
  });
});
