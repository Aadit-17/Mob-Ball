// Match stats harness (`npm run stats`): what a knight does in a match, per tier and position, and a
// check that the stats never contradict themselves or the score. Seeded matches over worker threads.
import { availableParallelism } from 'node:os';
import { parentPort, Worker, workerData } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { TIERS } from '../src/ai/skills';
import { STEP } from '../src/game/constants';
import type { Role } from '../src/game/types';
import { MatchRunner, type FixtureConfig, type TimedAction } from '../src/modes/runner';
import { REALM_HOUSES } from '../src/setup/houses';
import { rosterLineup } from '../src/setup/rosters';
import { setTeamTier } from '../src/setup/squads';
import { ASSIST_WINDOW } from '../src/stats/definitions';
import { invariantBreaks, mainRole } from '../src/stats/tally';
import { COUNTS, type Count, type MatchStats, type ShotOutcome } from '../src/stats/types';
import { spec } from '../src/test/fixtures';

/** Seeds per tier for the distributions: league matches, both sides at the tier, no changes. */
const MATCHES_PER_TIER = 200;
/** Extra seeds per tier for the invariants only, with a swap, a substitution and golden goals. */
const CHECK_MATCHES_PER_TIER = 40;
const FIRST_SEED = 9000;
const ROLES: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];
const OUTCOMES: readonly ShotOutcome[] = [
  'goal',
  'saved',
  'blocked',
  'claimed',
  'missed',
  'rebound',
  'own-goal',
  'unresolved',
];

interface Job {
  readonly tier: number;
  readonly seed: number;
  readonly changes: boolean;
}

/** One knight's match, reduced to what the report needs. */
interface KnightRow {
  readonly role: Role;
  readonly counts: Readonly<Record<Count, number>>;
  /** On-ball actions credited to him: everything in the log he did, plus the shots he stopped. */
  readonly actions: number;
}

interface MatchRow {
  readonly job: Job;
  readonly breaks: readonly string[];
  readonly knights: readonly KnightRow[];
  readonly homePossession: number;
  readonly goals: number;
  readonly goalsFromShots: number;
  readonly assisted: number;
  /** Goals with a teammate's setup, and how many of those came after ASSIST_WINDOW. */
  readonly setups: number;
  readonly lateSetups: number;
  readonly outcomes: Readonly<Record<ShotOutcome, number>>;
}

function fixture({ tier, seed, changes }: Job): { config: FixtureConfig; scheduled: TimedAction[] } {
  const home = REALM_HOUSES[seed % REALM_HOUSES.length];
  const away = REALM_HOUSES[(seed + 3) % REALM_HOUSES.length];
  if (!home || !away) throw new Error('No houses');
  const config: FixtureConfig = {
    home: setTeamTier(rosterLineup(home, 4), tier),
    away: setTeamTier(rosterLineup(away, 4), tier),
    seed,
    draws: !changes || seed % 2 === 0,
  };
  const scheduled: TimedAction[] = changes
    ? [
        { step: (20 + (seed % 40)) / STEP, team: 0, action: { kind: 'positions', a: 1, b: 2 + (seed % 2) } },
        {
          step: (50 + (seed % 30)) / STEP,
          team: 1,
          action: { kind: 'substitution', offId: 5 + (seed % 3), on: spec('mid', { tier }) },
        },
      ]
    : [];
  return { config, scheduled };
}

/** Actions credited to a knight, as actor or as the stopper of a shot; a goal from a shot is the shot. */
function actionsOf(stats: MatchStats, id: number): number {
  return stats.actions.filter(
    (a) =>
      (a.knightId === id && !(a.kind === 'goal' && a.fromShot)) || (a.kind === 'shot' && a.stopperId === id),
  ).length;
}

function playOne(job: Job): MatchRow {
  const { config, scheduled } = fixture(job);
  const runner = new MatchRunner(config, scheduled);
  runner.advance(Infinity);
  const { stats } = runner;
  const goals = stats.actions.filter((a) => a.kind === 'goal');
  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<ShotOutcome, number>;
  for (const a of stats.actions) if (a.kind === 'shot') outcomes[a.outcome]++;
  return {
    job,
    breaks: invariantBreaks(stats, runner.state.score),
    knights: stats.knights.map((k) => ({
      role: mainRole(k),
      counts: Object.fromEntries(COUNTS.map((c) => [c, k[c]])) as Record<Count, number>,
      actions: actionsOf(stats, k.id),
    })),
    homePossession: stats.teams[0].possession,
    goals: goals.length,
    goalsFromShots: goals.filter((g) => g.fromShot).length,
    assisted: goals.filter((g) => g.assistId !== null).length,
    setups: goals.filter((g) => g.assistGap !== null).length,
    lateSetups: goals.filter((g) => g.assistGap !== null && g.assistGap > ASSIST_WINDOW).length,
    outcomes,
  };
}

/** Worker threads don't inherit Vitest's TypeScript loading, so each registers tsx, then loads this file. */
const WORKER_BOOT = `import('tsx/esm/api').then((tsx) => { tsx.register(); return import(${JSON.stringify(import.meta.url)}); })`;
const WORKER_MARK = 'stats-worker';
const isMatchWorker = workerData === WORKER_MARK;

if (isMatchWorker)
  parentPort?.on('message', (job: Job) => {
    parentPort?.postMessage(playOne(job));
  });

/** Plays every job on a pool of worker threads, keeping the results in job order. */
async function playAll(jobs: readonly Job[]): Promise<MatchRow[]> {
  const results: (MatchRow | undefined)[] = jobs.map(() => undefined);
  let next = 0;
  const work = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_BOOT, { eval: true, workerData: WORKER_MARK });
      let current = -1;
      const feed = (): void => {
        current = next++;
        const job = jobs[current];
        if (job) worker.postMessage(job);
        else
          void worker.terminate().then(() => {
            resolve();
          });
      };
      worker.on('message', (row: MatchRow) => {
        results[current] = row;
        feed();
      });
      worker.on('error', reject);
      feed();
    });
  const threads = Math.max(1, Math.min(availableParallelism() - 1, jobs.length));
  await Promise.all(Array.from({ length: threads }, work));
  return results.filter((r): r is MatchRow => r !== undefined);
}

// ------------------------------------------------------------------ statistics

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: readonly number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const quantile = (xs: readonly number[], q: number): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};
const pct = (n: number, of: number): string => (of ? `${((100 * n) / of).toFixed(0)}%` : '-');
const pad = (s: string, n: number): string => s.padStart(n);

/** carrySteps reads better in seconds, passDistance in hundreds of pixels. */
const SHOWN: Readonly<Partial<Record<Count, { label: string; scale: number }>>> = {
  carrySteps: { label: 'carry (s)', scale: STEP },
  passDistance: { label: 'pass dist (100px)', scale: 0.01 },
};

function tierTable(rows: readonly MatchRow[]): string[] {
  const byRole = (role: Role): KnightRow[] => rows.flatMap((r) => r.knights.filter((k) => k.role === role));
  const groups = ROLES.map(byRole);
  const cell = (xs: readonly number[]): string => pad(`${mean(xs).toFixed(2)} ±${sd(xs).toFixed(2)}`, 15);
  const lines = [`    ${'stat'.padEnd(18)}${ROLES.map((r) => pad(r, 15)).join('')}`];
  for (const count of COUNTS) {
    const shown = SHOWN[count];
    const scale = shown?.scale ?? 1;
    lines.push(
      `    ${(shown?.label ?? count).padEnd(18)}${groups.map((g) => cell(g.map((k) => k.counts[count] * scale))).join('')}`,
    );
  }
  lines.push(`    ${'actions'.padEnd(18)}${groups.map((g) => cell(g.map((k) => k.actions))).join('')}`);
  return lines;
}

function teamLines(rows: readonly MatchRow[]): string[] {
  const sum = (f: (r: MatchRow) => number): number => rows.reduce((a, r) => a + f(r), 0);
  const all = rows.flatMap((r) => r.knights);
  const total = (c: Count): number => all.reduce((a, k) => a + k.counts[c], 0);
  const shots = total('shots');
  const outcomes = OUTCOMES.map(
    (o) =>
      `${o} ${pct(
        sum((r) => r.outcomes[o]),
        shots,
      )}`,
  ).join(' · ');
  const goals = sum((r) => r.goals);
  return [
    `    goals/match ${(goals / rows.length).toFixed(2)} · from shots ${pct(
      sum((r) => r.goalsFromShots),
      goals,
    )} · ` +
      `assisted ${pct(
        sum((r) => r.assisted),
        goals,
      )} · setups past the ${ASSIST_WINDOW * STEP}s window ${pct(
        sum((r) => r.lateSetups),
        sum((r) => r.setups),
      )}`,
    `    passes completed ${pct(total('passesCompleted'), total('passes'))} · progressive ${pct(total('progressivePasses'), total('passesCompleted'))} · ` +
      `shots on target ${pct(total('shotsOnTarget'), shots)} · home possession ${(100 * mean(rows.map((r) => r.homePossession))).toFixed(0)}% ±${(100 * sd(rows.map((r) => r.homePossession))).toFixed(0)}`,
    `    shot outcomes: ${outcomes}`,
  ];
}

/** How much a knight does per match, and what that means for the noise in a rating built on it. */
function volumeLines(rows: readonly MatchRow[]): string[] {
  return ROLES.map((role) => {
    const ks = rows.flatMap((r) => r.knights.filter((k) => k.role === role));
    const acts = ks.map((k) => k.actions);
    const touches = ks.map((k) => k.counts.touches);
    const median = quantile(acts, 0.5);
    const few = ks.filter((k) => k.actions < 10).length;
    return (
      `    ${role.padEnd(4)} actions p10/p50/p90 ${quantile(acts, 0.1)}/${median}/${quantile(acts, 0.9)} ` +
      `(mean ${mean(acts).toFixed(1)} ±${sd(acts).toFixed(1)}) · touches p50 ${quantile(touches, 0.5)} · ` +
      `under 10 actions ${pct(few, ks.length)} · 1/√n at the median ${median ? (1 / Math.sqrt(median)).toFixed(2) : '-'}`
    );
  });
}

if (!isMatchWorker)
  it('stats report', async () => {
    const jobs: Job[] = [];
    for (let tier = 0; tier < TIERS.length; tier++) {
      for (let i = 0; i < MATCHES_PER_TIER; i++)
        jobs.push({ tier, seed: FIRST_SEED + 1000 * tier + i, changes: false });
      for (let i = 0; i < CHECK_MATCHES_PER_TIER; i++)
        jobs.push({ tier, seed: FIRST_SEED + 1000 * tier + 500 + i, changes: true });
    }
    const rows = await playAll(jobs);
    const lines = [
      `${MATCHES_PER_TIER} league matches per tier (both sides at the tier, no changes) for the distributions; ` +
        `${CHECK_MATCHES_PER_TIER} more per tier with a swap, a substitution and golden goals for the invariants.`,
      'Per knight per match, by the role he played longest: mean ±sd.',
    ];
    for (let tier = 0; tier < TIERS.length; tier++) {
      const plain = rows.filter((r) => r.job.tier === tier && !r.job.changes);
      lines.push('', `${TIERS[tier]?.name ?? tier} (tier ${tier})`, ...teamLines(plain), ...tierTable(plain));
      lines.push('    actions per knight per match:', ...volumeLines(plain));
    }
    const broken = rows.filter((r) => r.breaks.length > 0);
    lines.push(
      '',
      `invariants: ${rows.length} matches checked, ${broken.length} broken` +
        (broken.length
          ? `: ${broken.map((r) => `seed ${r.job.seed}: ${r.breaks.join('; ')}`).join(' | ')}`
          : ''),
    );
    console.log(`\n${lines.join('\n')}\n`);
    expect(rows).toHaveLength(jobs.length);
    expect(broken.map((r) => r.job.seed)).toEqual([]);
  });
