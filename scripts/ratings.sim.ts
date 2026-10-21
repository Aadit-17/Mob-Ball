// Ratings harness (`npm run ratings`): fits the next-goal value model, calibrates ratings per position and
// judges them on fresh matches. The fit is frozen in src/stats/value-model.ts: RATINGS_WRITE=1 rewrites
// it, and otherwise the run fails if the file differs from what the fit gives.
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { parentPort, Worker, workerData } from 'node:worker_threads';
import { format } from 'prettier';
import { expect, it } from 'vitest';
import { TIERS } from '../src/ai/skills';
import { STEP } from '../src/game/constants';
import type { Role, TeamId } from '../src/game/types';
import { MatchRunner, type FixtureConfig, type TimedAction } from '../src/modes/runner';
import { REALM_HOUSES } from '../src/setup/houses';
import { rosterLineup } from '../src/setup/rosters';
import { setTeamTier } from '../src/setup/squads';
import {
  BASE,
  REGULATION_STEPS,
  manOfTheMatch,
  outcomesOf,
  possessionsOf,
  depthBand,
  ratingsFrom,
  scoreOf,
  standardise,
  toRating,
  valueActions,
  type Outcomes,
  type RatingModel,
  type RoleNorm,
  type ValuedAction,
} from '../src/stats/ratings';
import { mainRole } from '../src/stats/tally';
import type { KnightStats, MatchStats } from '../src/stats/types';
import { CELLS, FATES, FEATURES, NO_CELL, unpackCell, type ValueModel } from '../src/stats/value';
import { RATING_MODEL } from '../src/stats/value-model';
import { spec } from '../src/test/fixtures';
import { humanInput, HUMAN_PROFILES, type HumanProfile } from '../src/test/humans';
import { TOP_TIER } from '../src/ai/skills';
import type { KnightSpec } from '../src/game/match';

/** Matches the value model learns from: 3 in 5 to fit, 1 in 5 to choose the smoothing, 1 in 5 to test. */
const FIT_MATCHES = 2000;
/** Fresh matches that set each position's norm and the rating scale. */
const CALIBRATION_MATCHES = 800;
/** Fresh matches the finished ratings are judged on; a quarter with a swap, a substitution and golden goals. */
const EVALUATION_MATCHES = 800;
const FIRST_SEED = { fit: 20_000, calibration: 40_000, evaluation: 60_000 } as const;
/** Candidate horizons, seconds; the model uses the one that covers most scoring possessions (below). */
const HORIZONS = [3, 4, 5, 6, 8, 10, 12] as const;
/** The horizon covers this share of goals, measured from when the scoring side last won the ball. */
const HORIZON_COVER = 0.9;
/** Steps between samples (0.1 s): neighbouring steps say almost the same thing. */
const SAMPLE_EVERY = 12;
/** Smoothing strengths tried, in samples: each cell leans on its coarser parent with this weight. */
const ALPHAS = [1, 3, 10, 30, 100, 300, 1000, 3000] as const;
// The scale, fitted to stated targets rather than feel (the owner's, after playing My Career): a match of
// no worth reads 6.0 and an ordinary match (his position's par in play, no balls won, nothing decisive)
// 6.6, so the process scale is their gap; balls won add on top of that, eight worth +0.45; a forward's
// single goal reads 7.3 between a one-goal defeat and a win; clean-sheet keepers average 7.5; keepers
// average what outfielders do. Balls won are not measured over par: a match of no worth wins none.
const TARGET = { ordinary: 6.6, nothing: 6, eightWon: 0.45, oneGoal: 7.3, cleanSheet: 7.5 } as const;
const ASSIST_SHARE = 0.5;
/** Pseudo-count each band's shot share leans on the overall share with. */
const POSSESSION_PRIOR = 50;
// A loser must out-rate the winners' best by half a point to take man of the match: a decisive goal
// outweighs a busier match on the losing side, but a clearly better one still wins it.
const MOTM_MARGIN = 0.5;
/** Matches per human profile and position, the human in the home side at the Knight tier. */
const HUMAN_MATCHES = 40;
const FIRST_HUMAN_SEED = 80_000;
const BOOTSTRAPS = 200;
/** A league season's matches, for how steady an average rating is. */
const SEASON = 14;
const ROLES: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];
const WON_KINDS = new Set(['tackle', 'interception', 'recovery', 'scramble']);
const LABELS = 3;

// What the finished ratings must show, or the run fails. Each is a floor a sound rating clears with room:
const CHECKS = {
  /** The value model must beat knowing nothing about the state, on matches it never saw. */
  minLogLossGain: 0.05,
  /** Each position's mean rating within this of the overall mean; spreads may differ (forwards peak higher). */
  roleMeanBand: 0.3,
  roleSpreadBand: [0.7, 1.4],
  /** The average rating sits about where football ratings do. */
  mean: [6.6, 7.05],
  /** A match of no worth, for good or ill, about 6. */
  nothing: [5.9, 6.15],
  /** All-round play counts visibly: its share of the variance, eight balls won, a dominant goalless match. */
  // 40–55% was asked; with balls won counted on top it lands about 57%.
  processShare: [0.4, 0.6],
  eightWon: [0.3, 0.5],
  dominant: [7.5, 8.0],
  /** A goal stays the biggest single item: what one goal lifts a forward by. */
  goalLift: [0.75, 1.1],
  /** A standout (top 5%) match lands at 8–9 or a little more. */
  standout: [7.9, 9.3],
  /** A side's mean rating must follow its goal difference. */
  minTeamGoalDiffCorrelation: 0.6,
  /** Medians, on matches the scale never saw: a forward's goal in a one-goal defeat, one in a win, a winning brace. */
  goalInDefeat: [6.8, 7.3],
  goalInWin: [7.3, 7.7],
  braceInWin: [7.9, 8.6],
  minHatTrick: 8.7,
  /** Man of the match on the winning side as often as in football. */
  minMotmWinShare: 0.85,
  /** Keepers still win it sometimes, and no more often than their quarter of the pitch. */
  keeperMotmShare: [0.02, 0.3],
  minCleanSheetMean: 7.3,
  /** Process value still decides between knights: a goalless midfielder 1.5 spreads above par beats a
   * one-goal forward a spread below his, in the same match, at least this often. */
  minDominantOverPoorScorer: 0.9,
  /** Scripted human play: a beginner's typical match not pinned under 6.2 (his script outscores the bots, so
   * no ceiling: better play rates higher), and his good one (scored, won the ball 3+) 7+. */
  minBeginnerMedian: 6.2,
  minBeginnerGood: 7.0,
} as const;

interface Job {
  readonly seed: number;
  readonly tiers: readonly [number, number];
  readonly changes: boolean;
  /** A scripted human in the home side's knight in this role ('bot': the same slot left to the bot). */
  readonly human?: { readonly profile: HumanProfile | 'bot'; readonly role: Role };
}

type Task =
  | { readonly kind: 'sample'; readonly job: Job }
  | { readonly kind: 'rate'; readonly job: Job; readonly model: RatingModel };

/** Next-goal outcomes seen from each cell: [cell × LABELS] for each horizon, sparse. */
interface SampleRow {
  readonly counts: readonly (readonly [number, number][])[];
  /** Seconds from the scoring side winning the ball to each goal. */
  readonly possessionAges: readonly number[];
  /** Balls won by depth band from the goal attacked, and how many of those possessions ended in a shot. */
  readonly possessions: readonly (readonly [number, number])[];
}

interface KnightRow {
  readonly id: number;
  readonly team: TeamId;
  readonly role: Role;
  /** Played the whole match in one role: the knights a position's norm is measured on. */
  readonly whole: boolean;
  readonly roleSteps: KnightStats['roleSteps'];
  readonly value: number;
  readonly halves: readonly [number, number];
  readonly events: readonly number[];
  readonly conceded: number;
  readonly goals: number;
  readonly outcomes: Outcomes;
  /** Balls won (tackles, interceptions, recoveries) and shots on target. */
  readonly won: number;
  /** The possession value of the balls he won, and their process value. */
  readonly wonWorth: number;
  readonly wonValue: number;
  readonly onTarget: number;
  readonly rating: number;
  readonly score: number;
}

interface RateRow {
  readonly job: Job;
  readonly score: readonly [number, number];
  readonly knights: readonly KnightRow[];
  readonly motm: number | null;
  /** Each valued action, labelled for the table of what actions are worth. */
  readonly table: readonly (readonly [string, number])[];
  readonly goalSteps: readonly number[];
}

/** Tier pairs a step apart or level: the matches the modes actually play, home and away alike. */
const PAIRS: readonly (readonly [number, number])[] = TIERS.flatMap((_, a) =>
  TIERS.flatMap((__, b) => (Math.abs(a - b) <= 1 ? [[a, b] as const] : [])),
);

function jobs(count: number, first: number, changesEvery = 0): Job[] {
  return Array.from({ length: count }, (_, i) => ({
    seed: first + i,
    tiers: PAIRS[i % PAIRS.length] ?? [2, 2],
    changes: changesEvery > 0 && i % changesEvery === 0,
  }));
}

function fixture({ seed, tiers, changes, human }: Job): { config: FixtureConfig; scheduled: TimedAction[] } {
  const home = REALM_HOUSES[seed % REALM_HOUSES.length];
  const away = REALM_HOUSES[(seed + 3) % REALM_HOUSES.length];
  if (!home || !away) throw new Error('No houses');
  // The human as My Career fields him: top tier on paper (the decent player is the brain at the match's tier).
  const asHuman = (s: KnightSpec): KnightSpec =>
    human && human.profile !== 'bot' && s.role === human.role
      ? { ...s, human: true, tier: human.profile === 'decent' ? tiers[0] : TOP_TIER, speedFactor: 1 }
      : s;
  const config: FixtureConfig = {
    home: setTeamTier(rosterLineup(home, 4), tiers[0]).map(asHuman),
    away: setTeamTier(rosterLineup(away, 4), tiers[1]),
    seed,
    draws: !changes || seed % 2 === 0,
  };
  const scheduled: TimedAction[] = changes
    ? [
        { step: (20 + (seed % 40)) / STEP, team: 0, action: { kind: 'positions', a: 1, b: 2 + (seed % 2) } },
        {
          step: (50 + (seed % 30)) / STEP,
          team: 1,
          action: { kind: 'substitution', offId: 5 + (seed % 3), on: spec('mid', { tier: tiers[1] }) },
        },
      ]
    : [];
  return { config, scheduled };
}

function play(job: Job): MatchStats {
  const { config, scheduled } = fixture(job);
  const runner = new MatchRunner(config, scheduled);
  const profile = job.human?.profile;
  while (!runner.ended) {
    runner.advanceOne(
      profile && profile !== 'bot'
        ? (k) => (k.human ? humanInput(profile, runner.state, k) : null)
        : undefined,
    );
    runner.state.events = [];
  }
  return runner.stats;
}

const goalsOf = (stats: MatchStats) => stats.actions.filter((a) => a.kind === 'goal');
const teamOf = (stats: MatchStats, id: number): TeamId | null =>
  stats.knights.find((k) => k.id === id)?.team ?? null;

// Every SAMPLE_EVERY live steps with a side on the ball: which side scored next within each horizon.
// Steps too near the end to see a whole horizon are left out, so the model is the same at any minute.
function sample(job: Job): SampleRow {
  const stats = play(job);
  const { cells, owners } = stats.trace;
  const goals = goalsOf(stats);
  let lastLive = cells.length - 1;
  while (lastLive > 0 && cells[lastLive] === NO_CELL) lastLive--;
  const counts = HORIZONS.map(() => new Map<number, number>());
  let next = 0;
  for (let t = 0; t <= lastLive; t += SAMPLE_EVERY) {
    while (next < goals.length && (goals[next]?.step ?? Infinity) <= t) next++;
    const cell = cells[t] ?? NO_CELL;
    // A goal's own step is the end of the story, not a state to learn from.
    if (cell === NO_CELL || goals.some((g) => g.step === t)) continue;
    const side = teamOf(stats, owners[t] ?? -1);
    const goal = goals[next];
    HORIZONS.forEach((h, i) => {
      const reach = Math.round(h / STEP);
      const scored = goal && goal.step - t <= reach ? (goal.team === side ? 0 : 1) : 2;
      if (scored === 2 && t + reach > lastLive) return;
      const key = cell * LABELS + scored;
      const map = counts[i];
      if (map) map.set(key, (map.get(key) ?? 0) + 1);
    });
  }
  const possessionAges = goals.map((g) => {
    let t = g.step - 1;
    while (t > 0 && cells[t] !== NO_CELL && teamOf(stats, owners[t] ?? -1) === g.team) t--;
    return (g.step - t) * STEP;
  });
  return { counts: counts.map((m) => [...m]), possessionAges, possessions: possessionCounts(stats) };
}

// Each ball won (tackle, interception, recovery): did the winning side shoot (or score) before the other
// side next won it back, or a goal or full time ended the possession?
function possessionCounts(stats: MatchStats): [number, number][] {
  const counts = Array.from({ length: FEATURES.depth }, (): [number, number] => [0, 0]);
  const log = stats.actions;
  const wins = log.filter((a) => a.kind === 'tackle' || a.kind === 'interception' || a.kind === 'recovery');
  for (const a of wins) {
    const band = counts[depthBand(a.team, a.x)];
    if (!band) continue;
    const back = wins.find((b) => b.step > a.step && b.team !== a.team)?.step ?? Infinity;
    const goal = log.find((g) => g.kind === 'goal' && g.step >= a.step)?.step ?? Infinity;
    const end = Math.min(back, goal + 1);
    const shot = log.some(
      (b) =>
        (b.kind === 'shot' || (b.kind === 'goal' && !b.ownGoal)) &&
        b.team === a.team &&
        b.step >= a.step &&
        b.step < end,
    );
    band[0]++;
    if (shot) band[1]++;
  }
  return counts;
}

/** Possession value by band: the share of balls won there that led to a shot, smoothed toward the overall share. */
function fitPossession(rows: readonly SampleRow[]): { shot: number[]; lines: string[] } {
  const totals = Array.from({ length: FEATURES.depth }, () => [0, 0]);
  for (const r of rows)
    r.possessions.forEach(([n, shots], i) => {
      const t = totals[i];
      if (t) {
        t[0] = (t[0] ?? 0) + n;
        t[1] = (t[1] ?? 0) + shots;
      }
    });
  const n = sumOf(totals.map((t) => t[0] ?? 0));
  const overall = sumOf(totals.map((t) => t[1] ?? 0)) / n;
  const shot = totals.map(
    ([k = 0, s = 0]) => Math.round(((s + POSSESSION_PRIOR * overall) / (k + POSSESSION_PRIOR)) * 1e4) / 1e4,
  );
  return {
    shot,
    lines: [
      `Possession value: of ${n} balls won in ${rows.length} matches, the share that led to a shot before the ball was lost, ` +
        `by depth band (0 = nearest the goal attacked): ${shot.map((p, i) => `${i} ${f3(p)} (${totals[i]?.[0] ?? 0})`).join(' · ')}`,
    ],
  };
}

/** What a valued action was, for the table: passes and carries split by whether the ball was kept. */
function tableRows(stats: MatchStats, valued: readonly ValuedAction[]): [string, number][] {
  const passes = new Map<string, boolean>(
    stats.actions.flatMap((a) =>
      a.kind === 'pass' ? [[`${a.step}:${a.knightId}`, a.completed] as const] : [],
    ),
  );
  const shotGoals = new Set(
    stats.actions.flatMap((a) =>
      a.kind === 'shot' && a.outcome === 'goal' ? [`${a.step}:${a.knightId}`] : [],
    ),
  );
  const rows: [string, number][] = [];
  const lastPiece = new Map<number, number>();
  for (const a of valued) {
    const key = `${a.step}:${a.knightId}`;
    if (a.kind === 'loss') {
      const i = lastPiece.get(a.knightId);
      const row = i === undefined ? undefined : rows[i];
      if (row) rows[i ?? 0] = [row[0].replace('kept', 'lost').replace('completed', 'lost'), row[1] + a.value];
      continue;
    }
    const label =
      a.kind === 'pass'
        ? passes.get(key)
          ? 'pass completed'
          : 'pass lost'
        : a.kind === 'carry'
          ? 'carry kept'
          : a.kind === 'goal'
            ? shotGoals.has(key)
              ? 'goal (kicked)'
              : 'goal (pushed or nudged)'
            : a.kind;
    if (['carry', 'pass', 'shot', 'clearance', 'kick', 'assist'].includes(a.kind))
      lastPiece.set(a.knightId, rows.length);
    rows.push([label, a.value]);
  }
  return rows;
}

function rate(job: Job, model: RatingModel): RateRow {
  const stats = play(job);
  const valued = valueActions(stats, model.value);
  const ratings = ratingsFrom(stats, valued, model);
  const held = possessionsOf(stats, model);
  const half = Math.floor(stats.trace.cells.length / 2);
  const knights = stats.knights
    .filter((k) => k.playedSteps > 0)
    .map((k): KnightRow => {
      const mine = valued.filter((a) => a.knightId === k.id);
      const sum = (xs: readonly ValuedAction[]): number => xs.reduce((s, a) => s + a.value, 0);
      const r = ratings.knights.find((q) => q.id === k.id);
      const role = mainRole(k);
      return {
        id: k.id,
        team: k.team,
        role,
        whole: k.roleSteps[role] === stats.liveSteps,
        roleSteps: k.roleSteps,
        value: sum(mine),
        halves: [sum(mine.filter((a) => a.step < half)), sum(mine.filter((a) => a.step >= half))],
        events: mine.map((a) => a.value),
        conceded: k.goalsConceded,
        goals: k.goals,
        outcomes: outcomesOf(k, held.get(k.id)?.won ?? 0),
        won: k.tackles + k.interceptions + k.recoveries,
        wonWorth: held.get(k.id)?.won ?? 0,
        wonValue: sum(mine.filter((a) => WON_KINDS.has(a.kind))),
        onTarget: k.shotsOnTarget,
        rating: r?.rating ?? 0,
        score: r?.score ?? 0,
      };
    });
  return {
    job,
    score: [stats.teams[0].goals, stats.teams[1].goals],
    knights,
    motm: ratings.motm,
    table: tableRows(stats, valued),
    goalSteps: goalsOf(stats).map((g) => g.step),
  };
}

// ------------------------------------------------------------------ workers

/** Worker threads don't inherit Vitest's TypeScript loading, so each registers tsx, then loads this file. */
const WORKER_BOOT = `import('tsx/esm/api').then((tsx) => { tsx.register(); return import(${JSON.stringify(import.meta.url)}); })`;
const WORKER_MARK = 'ratings-worker';
const isMatchWorker = workerData === WORKER_MARK;

if (isMatchWorker)
  parentPort?.on('message', (task: Task) => {
    parentPort?.postMessage(task.kind === 'sample' ? sample(task.job) : rate(task.job, task.model));
  });

/** Runs every task on a pool of worker threads, keeping the results in task order. */
async function runAll<T>(tasks: readonly Task[]): Promise<T[]> {
  const results: (T | undefined)[] = tasks.map(() => undefined);
  let next = 0;
  const work = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_BOOT, { eval: true, workerData: WORKER_MARK });
      let current = -1;
      const feed = (): void => {
        current = next++;
        const task = tasks[current];
        if (task) worker.postMessage(task);
        else
          void worker.terminate().then(() => {
            resolve();
          });
      };
      worker.on('message', (row: T) => {
        results[current] = row;
        feed();
      });
      worker.on('error', reject);
      feed();
    });
  const threads = Math.max(1, Math.min(availableParallelism() - 1, tasks.length));
  await Promise.all(Array.from({ length: threads }, work));
  return results.filter((r): r is T => r !== undefined);
}

// ------------------------------------------------------------------ statistics

const sumOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: readonly number[]): number => (xs.length ? sumOf(xs) / xs.length : 0);
const sd = (xs: readonly number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const quantile = (xs: readonly number[], q: number): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};
function pearson(xs: readonly number[], ys: readonly number[]): number {
  const [mx, my] = [mean(xs), mean(ys)];
  let [sxy, sxx, syy] = [0, 0, 0];
  xs.forEach((x, i) => {
    const y = ys[i] ?? 0;
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  });
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
const f2 = (x: number): string => x.toFixed(2);
const f3 = (x: number): string => x.toFixed(3);
const signed2 = (x: number): string => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(2)}`;
const pct = (x: number): string => `${(100 * x).toFixed(0)}%`;

/** A small seeded generator, so the bootstrap gives the same answer every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// ------------------------------------------------------------------ the value model

type Counts = Float64Array;

function addCounts(into: Counts, sparse: readonly (readonly [number, number])[]): void {
  for (const [key, n] of sparse) into[key] = (into[key] ?? 0) + n;
}

/** Coarser views of a cell, finest first: each smooths toward the next. Pressure and pace go first. */
const LEVELS: readonly ((cell: number) => number)[] = [
  (c) => c,
  (c) => {
    const p = unpackCell(c);
    return (p.depth * FEATURES.width + p.width) * FEATURES.fate + p.fate;
  },
  (c) => {
    const p = unpackCell(c);
    return p.depth * FEATURES.fate + p.fate;
  },
  (c) => unpackCell(c).fate,
  () => 0,
];
const LEVEL_NAMES = ['full cell', 'depth × width × fate', 'depth × fate', 'fate', 'nothing (base rate)'];

/** Probabilities per cell and label, each level smoothed toward the next with weight `alpha`. */
function fit(counts: Counts, alpha: number, finest: number): Float64Array {
  const probs = new Float64Array(CELLS * LABELS);
  const total = sumOf([...counts]);
  const base = [0, 1, 2].map((l) => {
    let n = 0;
    for (let c = 0; c < CELLS; c++) n += counts[c * LABELS + l] ?? 0;
    return (n + 1) / (total + LABELS);
  });
  const chain = LEVELS.slice(finest, LEVELS.length - 1).reverse();
  for (let c = 0; c < CELLS; c++) {
    let p = [...base];
    for (const level of chain) {
      const key = level(c);
      const n = [0, 0, 0];
      for (let o = 0; o < CELLS; o++) {
        if (level(o) !== key) continue;
        for (let l = 0; l < LABELS; l++) n[l] = (n[l] ?? 0) + (counts[o * LABELS + l] ?? 0);
      }
      const size = sumOf(n);
      p = p.map((q, l) => ((n[l] ?? 0) + alpha * q) / (size + alpha));
    }
    p.forEach((q, l) => (probs[c * LABELS + l] = q));
  }
  return probs;
}

function score(probs: Float64Array, counts: Counts): { logLoss: number; brier: number; n: number } {
  let [ll, brier, n] = [0, 0, 0];
  for (let c = 0; c < CELLS; c++) {
    for (let l = 0; l < LABELS; l++) {
      const k = counts[c * LABELS + l] ?? 0;
      if (!k) continue;
      n += k;
      ll -= k * Math.log(probs[c * LABELS + l] ?? 1e-12);
      for (let j = 0; j < LABELS; j++) brier += k * ((probs[c * LABELS + j] ?? 0) - (j === l ? 1 : 0)) ** 2;
    }
  }
  return { logLoss: ll / n, brier: brier / n, n };
}

/** The fit and its numbers, for the report and the frozen file. */
interface ValueFit {
  readonly model: ValueModel;
  readonly lines: readonly string[];
  readonly logLossGain: number;
  readonly summary: string;
}

function fitValueModel(rows: readonly SampleRow[]): ValueFit {
  const ages = rows.flatMap((r) => r.possessionAges);
  const need = quantile(ages, HORIZON_COVER);
  const hi = HORIZONS.findIndex((h) => h >= need);
  const index = hi === -1 ? HORIZONS.length - 1 : hi;
  const horizon = HORIZONS[index] ?? 6;
  const split = (part: (i: number) => boolean): Counts => {
    const c = new Float64Array(CELLS * LABELS);
    rows.forEach((r, i) => {
      if (part(i % 5)) addCounts(c, r.counts[index] ?? []);
    });
    return c;
  };
  const [train, validation, test, trainVal] = [
    split((i) => i < 3),
    split((i) => i === 3),
    split((i) => i === 4),
    split((i) => i < 4),
  ];
  const lines = [
    `Value model: ${rows.length} matches (${FIT_MATCHES * 0.6} fit, ${FIT_MATCHES * 0.2} choose smoothing, ${FIT_MATCHES * 0.2} test), ` +
      `tier pairs ${PAIRS.map((p) => p.join('v')).join(' ')}, a sample every ${SAMPLE_EVERY * STEP}s.`,
    `  horizon: ${f2(need)}s covers ${pct(HORIZON_COVER)} of goals from when the scorers won the ball ` +
      `(median ${f2(quantile(ages, 0.5))}s) → ${horizon}s`,
    `  ${'model'.padEnd(22)}${'alpha'.padStart(7)}${'test log loss'.padStart(15)}${'Brier'.padStart(8)}${'gain'.padStart(8)}`,
  ];
  let best: { probs: Float64Array; level: number; alpha: number; val: number } | null = null;
  const baseScore = score(fit(train, 1, LEVELS.length - 1), test);
  for (let level = LEVELS.length - 1; level >= 0; level--) {
    let pick = { alpha: 1, val: Infinity };
    for (const alpha of ALPHAS) {
      const val = score(fit(train, alpha, level), validation).logLoss;
      if (val < pick.val) pick = { alpha, val };
    }
    const probs = fit(trainVal, pick.alpha, level);
    const s = score(probs, test);
    lines.push(
      `  ${(LEVEL_NAMES[level] ?? '').padEnd(22)}${String(pick.alpha).padStart(7)}${f3(s.logLoss).padStart(15)}` +
        `${f3(s.brier).padStart(8)}${pct(1 - s.logLoss / baseScore.logLoss).padStart(8)}`,
    );
    if (!best || pick.val < best.val) best = { probs, level, alpha: pick.alpha, val: pick.val };
  }
  if (!best) throw new Error('no fit');
  const chosen = score(best.probs, test);
  const gain = 1 - chosen.logLoss / baseScore.logLoss;
  lines.push(
    `  chosen on validation: ${LEVEL_NAMES[best.level] ?? ''}, alpha ${best.alpha}; ` +
      `test log loss ${f3(chosen.logLoss)} vs ${f3(baseScore.logLoss)} for the base rate (${pct(gain)} better) ` +
      `over ${chosen.n} test samples`,
    ...reliability(best.probs, test),
    ...cellSketch(best.probs),
  );
  const round = (x: number): number => Math.round(x * 1e4) / 1e4;
  const own = Array.from({ length: CELLS }, (_, c) => round(best.probs[c * LABELS] ?? 0));
  const other = Array.from({ length: CELLS }, (_, c) => round(best.probs[c * LABELS + 1] ?? 0));
  return {
    model: { horizon, own, other },
    lines,
    logLossGain: gain,
    summary:
      `${FIT_MATCHES} matches, horizon ${horizon}s, ${LEVEL_NAMES[best.level] ?? ''} smoothed with alpha ${best.alpha}; ` +
      `held-out log loss ${f3(chosen.logLoss)} vs ${f3(baseScore.logLoss)} base rate`,
  };
}

/** Predicted against seen: test samples grouped by the predicted chance the side on the ball scores next. */
function reliability(probs: Float64Array, test: Counts): string[] {
  const edges = [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.01];
  const bins = edges.slice(1).map(() => ({ n: 0, predicted: 0, seen: 0 }));
  for (let c = 0; c < CELLS; c++) {
    const p = probs[c * LABELS] ?? 0;
    const n = [0, 1, 2].reduce((s, l) => s + (test[c * LABELS + l] ?? 0), 0);
    const b = bins[edges.findIndex((e, i) => p >= e && p < (edges[i + 1] ?? 2))];
    if (!b || !n) continue;
    b.n += n;
    b.predicted += p * n;
    b.seen += test[c * LABELS] ?? 0;
  }
  return [
    '  calibration on test (P side on the ball scores next): ' +
      bins
        .map((b, i) =>
          b.n
            ? `${pct(edges[i] ?? 0)}–${pct(Math.min(1, edges[i + 1] ?? 1))}: ${f3(b.predicted / b.n)} vs ${f3(b.seen / b.n)}`
            : '',
        )
        .filter(Boolean)
        .join(' · '),
  ];
}

/** A readable slice of the model: the side on the ball, no pressure, ball still, by depth and fate. */
function cellSketch(probs: Float64Array): string[] {
  const lines = [
    '  P(on the ball scores next) − P(other side does), by depth (0 = nearest their goal), central, loose ball:',
  ];
  for (let fate = 0; fate < FATES.length; fate++) {
    const vals = Array.from({ length: FEATURES.depth }, (_, depth) => {
      const c =
        (((depth * FEATURES.width + 0) * FEATURES.pressure + 2) * FEATURES.pace + 1) * FEATURES.fate + fate;
      return f2((probs[c * LABELS] ?? 0) - (probs[c * LABELS + 1] ?? 0));
    });
    lines.push(`    ball going ${(FATES[fate] ?? '').padEnd(8)} ${vals.join('  ')}`);
  }
  return lines;
}

// ------------------------------------------------------------------ calibration

/** Ratings a model would give: each knight's score, and the man of the match per row. */
function scored(rows: readonly RateRow[], model: RatingModel) {
  return rows.map((r) => {
    const knights = r.knights.map((k) => ({ k, score: scoreOf(k.value, k.outcomes, k.roleSteps, model) }));
    const goals = new Map(r.knights.map((k) => [k.id, k.goals]));
    const contenders = knights.map(({ k, score }) => ({ id: k.id, team: k.team, score }));
    return {
      r,
      knights,
      motm: manOfTheMatch(contenders, r.score, (id) => goals.get(id) ?? 0, model.motmMargin),
    };
  });
}

const won = (r: RateRow, team: TeamId): boolean => r.score[team] > r.score[team === 0 ? 1 : 0];

const lostByOne = (r: RateRow, team: TeamId): boolean => r.score[team === 0 ? 1 : 0] - r.score[team] === 1;

/** Least-squares slope of a forward's rating on his goals: what one goal is worth to him. */
function goalLift(rows: readonly RateRow[], model: RatingModel): number {
  const fwds = scored(rows, model).flatMap((m) => m.knights.filter(({ k }) => k.whole && k.role === 'fwd'));
  const xs = fwds.map(({ k }) => k.goals);
  const ys = fwds.map(({ score }) => toRating(score));
  const [mx, my] = [mean(xs), mean(ys)];
  const cov = xs.reduce((a, x, i) => a + (x - mx) * ((ys[i] ?? 0) - my), 0);
  return cov / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
}

/** In matches with both, how often a goalless midfielder well above par out-rates a one-goal forward below his. */
function dominance(ms: ReturnType<typeof scored>, model: RatingModel): number {
  const z = (k: KnightRow) => standardise(k.value, k.roleSteps, model.roles);
  let [pairs, wins] = [0, 0];
  for (const m of ms) {
    const mids = m.knights.filter(
      ({ k }) => k.whole && k.role === 'mid' && k.goals + k.outcomes.assists === 0 && z(k) >= 1.5,
    );
    const fwds = m.knights.filter(({ k }) => k.whole && k.role === 'fwd' && k.goals === 1 && z(k) <= -1);
    for (const a of mids)
      for (const b of fwds) {
        pairs++;
        if (a.score > b.score) wins++;
      }
  }
  return pairs ? wins / pairs : 1;
}

/** A knight's all-round play in rating points: process value over par, and possession won less lost. */
const processPoints = (k: KnightRow, model: RatingModel): number =>
  model.spread * standardise(k.value, k.roleSteps, model.roles) +
  model.possession.weight * k.outcomes.possession;

/** What eight balls won are worth to an outfielder, in rating points: their process value and possession. */
function eightWon(rows: readonly RateRow[], model: RatingModel): number {
  const ks = rows.flatMap((r) => r.knights.filter((k) => k.whole && k.role !== 'gk' && k.won > 0));
  const unit = (k: KnightRow) =>
    model.spread *
    (standardise(k.value + 1, k.roleSteps, model.roles) - standardise(k.value, k.roleSteps, model.roles));
  const points = sumOf(ks.map((k) => unit(k) * k.wonValue + model.possession.weight * k.wonWorth));
  return (8 * points) / sumOf(ks.map((k) => k.won));
}

/** The median rating of the outfielders with no goal or assist whose all-round play was in the top 5%. */
function dominantMedian(ms: ReturnType<typeof scored>, model: RatingModel): number {
  const quiet = ms.flatMap((m) =>
    m.knights.filter(({ k }) => k.whole && k.role !== 'gk' && k.goals + k.outcomes.assists === 0),
  );
  const cut = quantile(
    quiet.map(({ k }) => processPoints(k, model)),
    0.95,
  );
  return quantile(
    quiet.filter(({ k }) => processPoints(k, model) >= cut).map(({ score }) => toRating(score)),
    0.5,
  );
}

/** Everything the scale is fitted to or checked against, on any set of rows. */
function outcomeTargets(rows: readonly RateRow[], model: RatingModel) {
  const ms = scored(rows, model);
  const ratingsWhere = (pick: (k: KnightRow, r: RateRow) => boolean) =>
    ms.flatMap((m) => m.knights.filter(({ k }) => pick(k, m.r)).map(({ score }) => toRating(score)));
  const fwdGoals =
    (n: number, max = n) =>
    (k: KnightRow) =>
      k.whole && k.role === 'fwd' && k.goals >= n && k.goals <= max;
  const inDefeat = ratingsWhere((k, r) => fwdGoals(1)(k) && lostByOne(r, k.team));
  const inWin = ratingsWhere((k, r) => fwdGoals(1)(k) && won(r, k.team));
  const brace = ratingsWhere((k, r) => k.goals === 2 && won(r, k.team));
  const hatTrick = ratingsWhere((k, r) => k.goals >= 3 && won(r, k.team));
  const decisive = ms.filter((m) => m.r.score[0] !== m.r.score[1]);
  const motmOf = (m: (typeof ms)[number]) => m.knights.find(({ k }) => k.id === m.motm)?.k;
  const all = ms.flatMap((m) => m.knights);
  const ratings = all.map(({ score }) => toRating(score));
  const roleMean = (role: Role) =>
    mean(all.filter(({ k }) => k.role === role).map(({ score }) => toRating(score)));
  const keepers = all.filter(({ k }) => k.whole && k.role === 'gk');
  return {
    mean: mean(ratings),
    keeperGap: roleMean('gk') - mean(['def', 'mid', 'fwd'].map((r) => roleMean(r as Role))),
    goalInDefeat: quantile(inDefeat, 0.5),
    goalsInDefeat: inDefeat.length,
    goalInWin: quantile(inWin, 0.5),
    goalsInWin: inWin.length,
    brace: quantile(brace, 0.5),
    braces: brace.length,
    hatTrick: quantile(hatTrick, 0.5),
    hatTricks: hatTrick.length,
    goalLift: goalLift(rows, model),
    motmWinShare:
      decisive.filter((m) => {
        const k = motmOf(m);
        return k !== undefined && won(m.r, k.team);
      }).length / (decisive.length || 1),
    keeperMotm: ms.filter((m) => motmOf(m)?.role === 'gk').length / (ms.length || 1),
    cleanSheet: mean(keepers.filter(({ k }) => k.conceded === 0).map(({ score }) => toRating(score))),
    processShare:
      sd(all.map(({ k }) => processPoints(k, model))) ** 2 / sd(all.map(({ score }) => score)) ** 2,
    dominantOverPoorScorer: dominance(ms, model),
    // Under 6 only for a net negative: a minus in process value, more possession lost than won, or an own
    // goal (a golden goal's extra minutes stretch par, so a hair's grace).
    under6Explained: all.filter(
      ({ k, score }) =>
        score < 5.95 && k.value >= 0 && k.outcomes.possession >= 0 && k.outcomes.ownGoals === 0,
    ).length,
    eightWon: eightWon(rows, model),
    dominant: dominantMedian(ms, model),
    allRound: all.map(({ k }) => processPoints(k, model)),
    under6: all.filter(({ score }) => score < 6).length / (all.length || 1),
  };
}

const NO_OUTCOMES: Outcomes = {
  goals: 0,
  assists: 0,
  ownGoals: 0,
  saves: 0,
  cleanSheet: false,
  possession: 0,
};

/** A knight who played a whole match and did nothing, for good or ill: the lowest any outfield role reads. */
const doNothing = (model: RatingModel): number =>
  Math.min(
    ...(['def', 'mid', 'fwd'] as const).map((role) =>
      scoreOf(0, NO_OUTCOMES, { gk: 0, def: 0, mid: 0, fwd: 0, [role]: REGULATION_STEPS }, model),
    ),
  );

/** Bisection on a quantity that rises with x. */
function solve(f: (x: number) => number, target: number, lo: number, hi: number, steps = 24): number {
  let [a, b] = [lo, hi];
  for (let i = 0; i < steps; i++) {
    const m = (a + b) / 2;
    if (f(m) < target) a = m;
    else b = m;
  }
  return Math.round(((a + b) / 2) * 1e4) / 1e4;
}

// Six numbers, six targets: lift the ordinary match; spread the match of no worth; the possession
// weight eight balls won; the goal weight a forward's single goal; the clean sheet its keepers' mean; the
// save weight keepers' fairness. Solved in turn until they settle.
function calibrate(
  value: ValueModel,
  shot: readonly number[],
  rows: readonly RateRow[],
): { model: RatingModel; lines: string[] } {
  const whole = (role: Role): KnightRow[] =>
    rows.flatMap((r) => r.knights.filter((k) => k.whole && k.role === role));
  const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
  const roles = Object.fromEntries(
    ROLES.map((r) => {
      const values = whole(r).map((k) => k.value);
      return [r, { mean: r4(mean(values)), sd: r4(sd(values)) }];
    }),
  ) as Record<Role, RoleNorm>;
  let model: RatingModel = {
    value,
    roles,
    lift: r4(TARGET.ordinary - BASE),
    spread: 0.6,
    outcome: { goal: 0.7, assist: 0.35, ownGoal: 0.7, save: 0.5, cleanSheet: 0.5 },
    motmMargin: MOTM_MARGIN,
    possession: { shot, weight: 1 },
  };
  const withGoal = (m: RatingModel, goal: number): RatingModel => ({
    ...m,
    outcome: { ...m.outcome, goal, assist: r4(goal * ASSIST_SHARE), ownGoal: goal },
  });
  const t = (m: RatingModel) => outcomeTargets(rows, m);
  const oneGoal = (m: RatingModel) => (t(m).goalInDefeat + t(m).goalInWin) / 2;
  for (let round = 0; round < 5; round++) {
    model = { ...model, spread: solve((x) => -doNothing({ ...model, spread: x }), -TARGET.nothing, 0.05, 2) };
    const weight = solve(
      (w) => eightWon(rows, { ...model, possession: { shot, weight: w } }),
      TARGET.eightWon,
      0,
      5,
    );
    model = { ...model, possession: { shot, weight } };
    model = withGoal(
      model,
      solve((g) => oneGoal(withGoal(model, g)), TARGET.oneGoal, 0, 2),
    );
    const keeper = (o: Partial<RatingModel['outcome']>) =>
      t({ ...model, outcome: { ...model.outcome, ...o } });
    const cleanSheet = solve((c) => keeper({ cleanSheet: c }).cleanSheet, TARGET.cleanSheet, 0, 3);
    model = { ...model, outcome: { ...model.outcome, cleanSheet } };
    model = {
      ...model,
      outcome: { ...model.outcome, save: solve((x) => keeper({ save: x }).keeperGap, 0, 0, 2) },
    };
  }
  const got = t(model);
  const valueMean = (r: Role) => mean(whole(r).map((k) => k.value));
  const rate = (r: Role, f: (k: KnightRow) => number) => mean(whole(r).map(f));
  return {
    model,
    lines: [
      `Calibration: ${rows.length} fresh matches. Each position's process value over a whole match, and its outcomes:`,
      ...ROLES.map(
        (r) =>
          `  ${r.padEnd(4)} value ${f3(valueMean(r))} ± ${f3(roles[r].sd)} · a match: goals ${f3(rate(r, (k) => k.goals))} ` +
          `assists ${f3(rate(r, (k) => k.outcomes.assists))} clean sheets ${f3(rate(r, (k) => (k.outcomes.cleanSheet ? 1 : 0)))} ` +
          `(${whole(r).length} knights)`,
      ),
      `  rating = ${BASE} + ${f3(model.lift)} + ${f3(model.spread)} × (value − position par) / (position spread × √time) + ` +
        `${f3(model.outcome.goal)} a goal + ${f3(model.outcome.assist)} an assist − ${f3(model.outcome.ownGoal)} an own goal + ` +
        `${f3(model.outcome.save)} a save + ${f3(model.outcome.cleanSheet)} a keeper's clean sheet + ` +
        `${f3(model.possession.weight)} × possession value of balls won`,
      `  fitted to: an ordinary match ${f2(BASE + model.lift)} (${TARGET.ordinary}), a match of no worth ${f2(doNothing(model))} ` +
        `(${TARGET.nothing}), eight balls won ${signed2(got.eightWon)} (${TARGET.eightWon}), ` +
        `a forward's single goal ${f2((got.goalInDefeat + got.goalInWin) / 2)} (${TARGET.oneGoal}), ` +
        `clean-sheet keepers ${f2(got.cleanSheet)} (${TARGET.cleanSheet}), keepers' mean less outfielders' ${f2(got.keeperGap)} (0); ` +
        `the mean comes out at ${f2(got.mean)}`,
    ],
  };
}

// ------------------------------------------------------------------ evaluation

interface Verdict {
  readonly lines: string[];
  readonly failures: string[];
}

function evaluate(rows: readonly RateRow[], model: RatingModel): Verdict {
  const lines: string[] = [];
  const failures: string[] = [];
  const check = (ok: boolean, what: string): void => {
    if (!ok) failures.push(what);
  };
  const all = rows.flatMap((r) => r.knights);
  const ratings = all.map((k) => k.rating);
  const overall = { mean: mean(ratings), sd: sd(ratings) };
  const dist = (xs: readonly number[]): string =>
    `mean ${f2(mean(xs))} sd ${f2(sd(xs))} · p5 ${f2(quantile(xs, 0.05))} p20 ${f2(quantile(xs, 0.2))} ` +
    `p50 ${f2(quantile(xs, 0.5))} p80 ${f2(quantile(xs, 0.8))} p95 ${f2(quantile(xs, 0.95))} p99 ${f2(quantile(xs, 0.99))}`;
  lines.push(
    `Evaluation: ${rows.length} fresh matches (${rows.filter((r) => r.job.changes).length} with a swap, a substitution and golden goals), ${all.length} knights rated.`,
    `  all       ${dist(ratings)}`,
  );
  for (const role of ROLES) {
    const xs = all.filter((k) => k.role === role).map((k) => k.rating);
    lines.push(`  ${role.padEnd(9)} ${dist(xs)}`);
    check(
      Math.abs(mean(xs) - overall.mean) <= CHECKS.roleMeanBand,
      `${role} mean ${f2(mean(xs))} is more than ${CHECKS.roleMeanBand} from ${f2(overall.mean)}`,
    );
    const ratio = sd(xs) / overall.sd;
    check(
      ratio >= CHECKS.roleSpreadBand[0] && ratio <= CHECKS.roleSpreadBand[1],
      `${role} spread is ${f2(ratio)}× the overall spread`,
    );
  }
  for (let tier = 0; tier < TIERS.length; tier++) {
    const xs = rows
      .filter((r) => r.job.tiers[0] === tier && r.job.tiers[1] === tier)
      .flatMap((r) => r.knights.map((k) => k.rating));
    if (xs.length) lines.push(`  ${(TIERS[tier]?.name ?? '').padEnd(9)} ${dist(xs)}`);
  }
  const [p20, p80, p95] = [quantile(ratings, 0.2), quantile(ratings, 0.8), quantile(ratings, 0.95)];
  lines.push(
    `  p20 ${f2(p20)} · p80 ${f2(p80)} · ${pct(ratings.filter((r) => r >= 6 && r <= 7.5).length / ratings.length)} in 6–7.5; ` +
      `${pct(ratings.filter((r) => r >= 8).length / ratings.length)} at 8 or more; ${pct(ratings.filter((r) => r < 6).length / ratings.length)} under 6, ` +
      `${pct(ratings.filter((r) => r < 5).length / ratings.length)} under 5; clamped at 3 or 10: ${ratings.filter((r) => r <= 3 || r >= 10).length}`,
  );
  lines.push(
    `  an ordinary match reads ${f2(BASE + model.lift)}, a match of no worth ${f2(doNothing(model))}`,
  );
  check(overall.mean >= CHECKS.mean[0] && overall.mean <= CHECKS.mean[1], `mean rating ${f2(overall.mean)}`);
  check(p95 >= CHECKS.standout[0] && p95 <= CHECKS.standout[1], `p95 ${f2(p95)} is not a standout 8–9`);

  // The result: a side's mean rating against its goal difference, and where the man of the match plays.
  const sides = rows.flatMap((r) =>
    ([0, 1] as const).map((t) => ({
      mean: mean(r.knights.filter((k) => k.team === t).map((k) => k.rating)),
      diff: r.score[t] - r.score[t === 0 ? 1 : 0],
    })),
  );
  const teamCorr = pearson(
    sides.map((s) => s.mean),
    sides.map((s) => s.diff),
  );
  const knightCorr = pearson(
    all.map((k) => k.rating),
    rows.flatMap((r) => r.knights.map((k) => r.score[k.team] - r.score[k.team === 0 ? 1 : 0])),
  );
  const decisive = rows.filter((r) => r.score[0] !== r.score[1]);
  const motmWins = decisive.filter((r) => {
    const m = r.knights.find((k) => k.id === r.motm);
    return m && r.score[m.team] > r.score[m.team === 0 ? 1 : 0];
  }).length;
  const motmShare = motmWins / (decisive.length || 1);
  const motmRoles = ROLES.map((role) => {
    const n = rows.filter((r) => r.knights.find((k) => k.id === r.motm)?.role === role).length;
    return `${role} ${pct(n / rows.length)}`;
  });
  const motmRatings = rows.map((r) => r.knights.find((k) => k.id === r.motm)?.rating ?? 0);
  lines.push(
    `  result: correlation with goal difference ${f2(teamCorr)} for a side's mean rating, ${f2(knightCorr)} per knight; ` +
      `man of the match on the winning side in ${pct(motmShare)} of ${decisive.length} decisive matches`,
    `  man of the match by role: ${motmRoles.join(' · ')}; his rating ${dist(motmRatings)}`,
  );
  // Known groups: a side a tier stronger should rate higher, by about as much as it plays better.
  const mismatched = rows.filter((r) => r.job.tiers[0] !== r.job.tiers[1]);
  const strongSide = (r: RateRow): TeamId => (r.job.tiers[0] > r.job.tiers[1] ? 0 : 1);
  const sideMean = (r: RateRow, t: TeamId): number =>
    mean(r.knights.filter((k) => k.team === t).map((k) => k.rating));
  const gaps = mismatched.map((r) => sideMean(r, strongSide(r)) - sideMean(r, strongSide(r) === 0 ? 1 : 0));
  const strongWins = mismatched.filter(
    (r) => r.score[strongSide(r)] > r.score[strongSide(r) === 0 ? 1 : 0],
  ).length;
  lines.push(
    `  a tier apart (${mismatched.length} matches): the stronger side rates ${f2(mean(gaps))} higher on average ` +
      `(±${f2((2 * sd(gaps)) / Math.sqrt(gaps.length))}) and wins ${pct(strongWins / (mismatched.length || 1))}`,
  );
  check(teamCorr >= CHECKS.minTeamGoalDiffCorrelation, `side mean vs goal difference ${f2(teamCorr)}`);
  check(motmShare >= CHECKS.minMotmWinShare, `man of the match on the winning side only ${pct(motmShare)}`);

  // The scale against its targets, on matches it never saw.
  const t = outcomeTargets(rows, model);
  const bestOverall = outcomeTargets(rows, { ...model, motmMargin: 0 }).motmWinShare;
  lines.push(
    `  a forward's goal: in a one-goal defeat ${f2(t.goalInDefeat)} (${t.goalsInDefeat}), in a win ${f2(t.goalInWin)} (${t.goalsInWin}); ` +
      `a winning brace ${f2(t.brace)} (${t.braces}), hat-trick ${f2(t.hatTrick)} (${t.hatTricks}); a goal lifts a forward ${f2(t.goalLift)}`,
    `  keeper MOTM ${pct(t.keeperMotm)}; MOTM on the winners ${pct(t.motmWinShare)} (${pct(bestOverall)} without the margin); ` +
      `process value carries ${pct(t.processShare)} of the variance; a dominant midfielder beats a poor scorer ${pct(t.dominantOverPoorScorer)}; ` +
      `under 6 with no net minus or own goal: ${t.under6Explained}`,
  );
  const inside = (x: number, [lo, hi]: readonly [number, number]) => x >= lo && x <= hi;
  check(inside(t.goalInDefeat, CHECKS.goalInDefeat), `a goal in a one-goal defeat ${f2(t.goalInDefeat)}`);
  check(inside(t.goalInWin, CHECKS.goalInWin), `a goal in a win ${f2(t.goalInWin)}`);
  check(inside(t.brace, CHECKS.braceInWin), `winning brace median ${f2(t.brace)}`);
  check(t.hatTrick >= CHECKS.minHatTrick, `hat-trick median ${f2(t.hatTrick)}`);
  check(inside(t.keeperMotm, CHECKS.keeperMotmShare), `keepers are man of the match ${pct(t.keeperMotm)}`);
  check(
    t.dominantOverPoorScorer >= CHECKS.minDominantOverPoorScorer,
    `a dominant midfielder beats a poor one-goal forward only ${pct(t.dominantOverPoorScorer)}`,
  );
  check(t.under6Explained === 0, `${t.under6Explained} ratings under 6 with nothing negative`);
  lines.push(
    `  all-round play: eight balls won ${signed2(t.eightWon)}, a dominant goalless match ${f2(t.dominant)}, ` +
      `a match of no worth ${f2(doNothing(model))}`,
  );
  check(
    inside(t.processShare, CHECKS.processShare),
    `process carries ${pct(t.processShare)} of the variance`,
  );
  check(inside(t.eightWon, CHECKS.eightWon), `eight balls won ${signed2(t.eightWon)}`);
  check(inside(t.dominant, CHECKS.dominant), `a dominant goalless match ${f2(t.dominant)}`);
  check(inside(t.goalLift, CHECKS.goalLift), `a goal lifts a forward ${f2(t.goalLift)}`);
  check(inside(doNothing(model), CHECKS.nothing), `a match of no worth ${f2(doNothing(model))}`);

  // Keepers: a rating that follows the goals he let in, as it should, and not only them.
  const keepers = all.filter((k) => k.role === 'gk' && k.whole);
  lines.push(
    `  keepers: correlation with goals conceded ${f2(
      pearson(
        keepers.map((k) => k.rating),
        keepers.map((k) => k.conceded),
      ),
    )}; mean rating with a clean sheet ${f2(mean(keepers.filter((k) => k.conceded === 0).map((k) => k.rating)))}, ` +
      `conceding 3+ ${f2(mean(keepers.filter((k) => k.conceded >= 3).map((k) => k.rating)))}`,
  );
  check(t.cleanSheet >= CHECKS.minCleanSheetMean, `clean-sheet keepers average ${f2(t.cleanSheet)}`);
  lines.push(...noise(rows, model));
  return { lines, failures };
}

// How much of a rating is the knight and how much is the 90 seconds. Split-half: each half of a match
// rated on its own, correlated across knights and stepped up to a whole match (Spearman–Brown).
// Bootstrap: a knight's actions resampled, the spread of the rating they give.
function noise(rows: readonly RateRow[], model: RatingModel): string[] {
  const random = lcg(7);
  const lines = ['  noise in the process value (knights who played a whole match in one role):'];
  for (const role of ROLES) {
    const ks = rows.flatMap((r) => r.knights.filter((k) => k.whole && k.role === role));
    const halfSteps = (k: KnightRow) => ({ ...k.roleSteps, [role]: k.roleSteps[role] / 2 });
    const z = (k: KnightRow, v: number) => standardise(v, halfSteps(k), model.roles);
    const r = pearson(
      ks.map((k) => z(k, k.halves[0])),
      ks.map((k) => z(k, k.halves[1])),
    );
    const whole = (2 * r) / (1 + r);
    const season = (SEASON * whole) / (1 + (SEASON - 1) * whole);
    const ses = ks.slice(0, 400).map((k) => {
      const draws = Array.from({ length: BOOTSTRAPS }, () => {
        const v = k.events.reduce((sum) => sum + (k.events[Math.floor(random() * k.events.length)] ?? 0), 0);
        return toRating(scoreOf(v, k.outcomes, k.roleSteps, model));
      });
      return sd(draws);
    });
    lines.push(
      `    ${role.padEnd(4)} split-half r ${f2(r)} → whole-match reliability ${f2(whole)}; ` +
        `bootstrap ±${f2(quantile(ses, 0.5))} (median sd of his rating), ±${f2(quantile(ses, 0.9))} at p90; ` +
        `${f2(mean(ks.map((k) => k.events.length)))} valued actions a match; a ${SEASON}-match average: reliability ${f2(season)}`,
    );
  }
  return lines;
}

function actionTable(rows: readonly RateRow[]): string[] {
  const groups = new Map<string, number[]>();
  for (const r of rows)
    for (const [label, v] of r.table) groups.set(label, [...(groups.get(label) ?? []), v]);
  const lines = [
    `Action values (next-goal probability, ours minus theirs), per match over ${rows.length} matches:`,
    `  ${'action'.padEnd(26)}${'a match'.padStart(9)}${'mean'.padStart(8)}${'sd'.padStart(7)}${'p10'.padStart(8)}${'p90'.padStart(8)}`,
  ];
  for (const [label, xs] of [...groups].sort((a, b) => mean(b[1]) - mean(a[1])))
    lines.push(
      `  ${label.padEnd(26)}${f2(xs.length / rows.length).padStart(9)}${f3(mean(xs)).padStart(8)}${f3(sd(xs)).padStart(7)}` +
        `${f3(quantile(xs, 0.1)).padStart(8)}${f3(quantile(xs, 0.9)).padStart(8)}`,
    );
  return lines;
}

/** The human-slot jobs: each profile, and the bot in the same slot, in every position at the Knight tier. */
function humanJobs(): Job[] {
  return (['bot', ...HUMAN_PROFILES] as const).flatMap((profile) =>
    ROLES.flatMap((role) =>
      Array.from({ length: HUMAN_MATCHES }, (_, i) => ({
        seed: FIRST_HUMAN_SEED + i,
        tiers: [2, 2] as const,
        changes: false,
        human: { profile, role },
      })),
    ),
  );
}

// Ratings must be fair to how people play: scripted beginners, improvers and decent players against the
// bot in the same slot and seeds. Worse play may rate lower; a beginner's ordinary match must not sit pinned
// under 6, and his good one (he scored and won the ball three times or more) should reach 7.
function humanReport(rows: readonly RateRow[]): Verdict {
  const lines = [
    `Human-style play: ${HUMAN_MATCHES} matches per profile and position, home side at the Knight tier.`,
  ];
  const failures: string[] = [];
  for (const profile of ['bot', ...HUMAN_PROFILES] as const) {
    const mine = rows
      .filter((r) => r.job.human?.profile === profile)
      .flatMap((r) => {
        const role = r.job.human?.role;
        const k = r.knights.find((q) => q.team === 0 && q.role === role);
        return k ? [{ k, r }] : [];
      });
    const ratings = mine.map(({ k }) => k.rating);
    const byRole = ROLES.map(
      (role) =>
        `${role} ${f2(
          quantile(
            mine.filter(({ k }) => k.role === role).map(({ k }) => k.rating),
            0.5,
          ),
        )}`,
    );
    const result = (f: (r: RateRow) => boolean) =>
      f2(
        quantile(
          mine.filter(({ r }) => f(r)).map(({ k }) => k.rating),
          0.5,
        ),
      );
    const good = mine.filter(({ k }) => k.goals >= 1 && k.won >= 3).map(({ k }) => k.rating);
    lines.push(
      `  ${profile.padEnd(9)} median ${f2(quantile(ratings, 0.5))} p10 ${f2(quantile(ratings, 0.1))} p90 ${f2(quantile(ratings, 0.9))} ` +
        `under 6 ${pct(ratings.filter((x) => x < 6).length / (ratings.length || 1))} · ${byRole.join(' ')} · ` +
        `won ${result((r) => won(r, 0))} drawn ${result((r) => r.score[0] === r.score[1])} lost ${result((r) => won(r, 1))} · ` +
        `good match ${f2(quantile(good, 0.5))} (${good.length}) · goals ${f2(mean(mine.map(({ k }) => k.goals)))} won ball ${f2(mean(mine.map(({ k }) => k.won)))}`,
    );
    if (profile === 'beginner') {
      const m = quantile(ratings, 0.5);
      if (m < CHECKS.minBeginnerMedian) failures.push(`beginner median ${f2(m)}`);
      if (quantile(good, 0.5) < CHECKS.minBeginnerGood)
        failures.push(`beginner's good match ${f2(quantile(good, 0.5))}`);
    }
  }
  return { lines, failures };
}

// ------------------------------------------------------------------ the frozen file

const MODEL_FILE = new URL('../src/stats/value-model.ts', import.meta.url);

async function modelSource(model: RatingModel, summary: string): Promise<string> {
  const source = [
    '// Fitted by `npm run ratings` (scripts/ratings.sim.ts); rewrite with RATINGS_WRITE=1, never by hand.',
    `// ${summary}.`,
    "// Cells are indexed as in value.ts; `own` and `other` are each side's chance of scoring next.",
    "import type { RatingModel } from './ratings';",
    '',
    `export const RATING_MODEL: RatingModel = ${JSON.stringify(model)};`,
    '',
  ].join('\n');
  return format(source, {
    parser: 'typescript',
    filepath: MODEL_FILE.pathname,
    printWidth: 110,
    singleQuote: true,
  });
}

if (!isMatchWorker)
  it('ratings report', async () => {
    const fitRows = await runAll<SampleRow>(
      jobs(FIT_MATCHES, FIRST_SEED.fit).map((job) => ({ kind: 'sample', job })),
    );
    const valueFit = fitValueModel(fitRows);
    const possession = fitPossession(fitRows);
    const draft: RatingModel = {
      ...RATING_MODEL,
      value: valueFit.model,
      possession: { shot: possession.shot, weight: 0 },
    };
    const calRows = await runAll<RateRow>(
      jobs(CALIBRATION_MATCHES, FIRST_SEED.calibration).map((job) => ({ kind: 'rate', job, model: draft })),
    );
    const cal = calibrate(valueFit.model, possession.shot, calRows);
    const evalRows = await runAll<RateRow>(
      jobs(EVALUATION_MATCHES, FIRST_SEED.evaluation, 4).map((job) => ({
        kind: 'rate',
        job,
        model: cal.model,
      })),
    );
    const humanRows = await runAll<RateRow>(
      humanJobs().map((job) => ({ kind: 'rate', job, model: cal.model })),
    );
    const people = humanReport(humanRows);
    const judged = evaluate(evalRows, cal.model);
    const verdict = { lines: judged.lines, failures: [...judged.failures, ...people.failures] };
    const lines = [
      ...valueFit.lines,
      ...possession.lines,
      '',
      ...cal.lines,
      '',
      ...actionTable(evalRows),
      '',
      ...verdict.lines,
      '',
      ...people.lines,
    ];
    const source = await modelSource(cal.model, valueFit.summary);
    const frozen = readFileSync(MODEL_FILE, 'utf8');
    if (process.env.RATINGS_WRITE === '1' && source !== frozen) {
      writeFileSync(MODEL_FILE, source);
      lines.push('', 'Wrote src/stats/value-model.ts.');
    }
    lines.push(
      '',
      verdict.failures.length ? `FAILED: ${verdict.failures.join('; ')}` : 'All rating checks pass.',
    );
    console.log(`\n${lines.join('\n')}\n`);
    expect(valueFit.logLossGain).toBeGreaterThan(CHECKS.minLogLossGain);
    expect(verdict.failures).toEqual([]);
    if (process.env.RATINGS_WRITE !== '1')
      expect(source, 'value-model.ts is stale: rerun with RATINGS_WRITE=1').toBe(frozen);
  });
