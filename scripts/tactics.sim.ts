/**
 * Tactics harness (`npm run tactics`): does each option change the match, does anything dominate, and
 * what is the best plan worth next to a tier? Seeded matches, spread over worker threads running this file.
 */
import { availableParallelism } from 'node:os';
import { parentPort, Worker, workerData } from 'node:worker_threads';
import { it } from 'vitest';
import { DEFAULT_TACTICS, type Tactics } from '../src/ai/tactics';
import { PITCH } from '../src/game/constants';
import type { Knight, MatchState, TeamId } from '../src/game/types';
import { MatchRunner } from '../src/modes/runner';
import { REALM_HOUSES } from '../src/setup/houses';
import { rosterLineup } from '../src/setup/rosters';
import { setTeamTier } from '../src/setup/squads';

/** Seeds per cell; each is played twice with the sides swapped, so 200 matches and no side bias. */
const CELL_SEEDS = 100;
/** The round robin of all 27 combinations has 351 pairings, so each gets fewer seeds. */
const ROUND_ROBIN_SEEDS = 20;
const ROUND_ROBIN_TIER = 3;
const TIERS_UNDER_TEST = [2, 3, 4] as const;
const FIRST_SEED = 5000;
/** Kicks from further out than this are passes or clearances, not shots (as in the balance harness). */
const SHOT_RANGE = 500;
/** Criterion 2: no tactic should take more than this share of the points across all opponents. */
const DOMINANCE_LIMIT = 0.55;
/** Criterion 3: the best matchup should be worth about this fraction of one tier's swing. */
const TIER_SHARE_TARGET = 0.5;

interface Side {
  readonly tier: number;
  readonly tactics: Tactics;
}

interface Job {
  readonly a: Side;
  readonly b: Side;
  readonly seeds: number;
}

/** One match from side a's point of view. */
interface Line {
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly shotsFor: number;
  readonly shotsAgainst: number;
  /** Share of live play with the ball in the rivals' half. */
  readonly territory: number;
}

const STATS = ['goalsFor', 'goalsAgainst', 'shotsFor', 'shotsAgainst', 'territory'] as const;
type Stat = (typeof STATS)[number];
const STAT_LABELS: Readonly<Record<Stat, string>> = {
  goalsFor: 'GF',
  goalsAgainst: 'GA',
  shotsFor: 'SF',
  shotsAgainst: 'SA',
  territory: 'their half',
};

const flip = (m: Line): Line => ({
  goalsFor: m.goalsAgainst,
  goalsAgainst: m.goalsFor,
  shotsFor: m.shotsAgainst,
  shotsAgainst: m.shotsFor,
  territory: 1 - m.territory,
});

/** 1 for a win, 0.5 for a draw, 0 for a loss: the share of league points taken. */
const matchPoints = (m: Line): number =>
  m.goalsFor > m.goalsAgainst ? 1 : m.goalsFor === m.goalsAgainst ? 0.5 : 0;

/** Whether a kick is heading into the opponent's goal mouth from shooting range. */
function isShot(state: MatchState, kicker: Knight): boolean {
  const { ball } = state;
  const attacksRight = kicker.team === 0;
  if (attacksRight ? ball.vx <= 0 : ball.vx >= 0) return false;
  const lineX = attacksRight ? PITCH.right : PITCH.left;
  if (Math.abs(lineX - ball.x) > SHOT_RANGE) return false;
  const y = ball.y + ball.vy * ((lineX - ball.x) / ball.vx);
  return y > PITCH.goalTop && y < PITCH.goalBottom;
}

/** One league match (draws stand) between two houses picked by the seed, with `a` at home or away. */
function playLeagueMatch(seed: number, a: Side, b: Side, aHome: boolean): Line {
  const homeHouse = REALM_HOUSES[seed % REALM_HOUSES.length];
  const awayHouse = REALM_HOUSES[(seed + 3) % REALM_HOUSES.length];
  if (!homeHouse || !awayHouse) throw new Error('No houses');
  const [home, away] = aHome ? [a, b] : [b, a];
  const runner = new MatchRunner({
    home: setTeamTier(rosterLineup(homeHouse, 4), home.tier),
    away: setTeamTier(rosterLineup(awayHouse, 4), away.tier),
    seed,
    tactics: [home.tactics, away.tactics],
    draws: true,
  });
  const us: TeamId = aHome ? 0 : 1;
  const { state } = runner;
  let shotsFor = 0;
  let shotsAgainst = 0;
  let attacking = 0;
  let live = 0;
  while (!runner.ended) {
    runner.advanceOne();
    for (const e of state.events) {
      const kicker = e.type === 'kick' ? state.knights.find((k) => k.id === e.knightId) : undefined;
      if (!kicker || !isShot(state, kicker)) continue;
      if (kicker.team === us) shotsFor++;
      else shotsAgainst++;
    }
    state.events = [];
    // A ball on the centre spot is in neither half.
    if (state.phase !== 'play' || state.ball.x === PITCH.centerX) continue;
    live++;
    if (us === 0 ? state.ball.x > PITCH.centerX : state.ball.x < PITCH.centerX) attacking++;
  }
  return {
    goalsFor: state.score[us],
    goalsAgainst: state.score[us === 0 ? 1 : 0],
    shotsFor,
    shotsAgainst,
    territory: live ? attacking / live : 0.5,
  };
}

function playCell({ a, b, seeds }: Job): Line[] {
  const lines: Line[] = [];
  for (let seed = FIRST_SEED; seed < FIRST_SEED + seeds; seed++) {
    lines.push(playLeagueMatch(seed, a, b, true), playLeagueMatch(seed, a, b, false));
  }
  return lines;
}

/** Worker threads don't inherit Vitest's TypeScript loading, so each registers tsx, then loads this file. */
const WORKER_BOOT = `import('tsx/esm/api').then((tsx) => { tsx.register(); return import(${JSON.stringify(import.meta.url)}); })`;
/** Tells a match worker from the test itself, which Vitest may also run on a worker thread. */
const WORKER_MARK = 'tactics-worker';
const isMatchWorker = workerData === WORKER_MARK;

/** Plays every job on a pool of worker threads, keeping the results in job order. */
async function playAll(jobs: readonly Job[]): Promise<Line[][]> {
  const results: Line[][] = jobs.map(() => []);
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
      worker.on('message', (lines: Line[]) => {
        results[current] = lines;
        feed();
      });
      worker.on('error', reject);
      feed();
    });
  const threads = Math.max(1, Math.min(availableParallelism() - 1, jobs.length));
  await Promise.all(Array.from({ length: threads }, work));
  return results;
}

// ------------------------------------------------------------------ the tactics under test

/** Default, then each option of each lever with the other two at default, then the touchline presets. */
const ENTRIES: readonly (readonly [string, Tactics])[] = [
  ['default', DEFAULT_TACTICS],
  ['press low', { ...DEFAULT_TACTICS, press: 'low' }],
  ['press high', { ...DEFAULT_TACTICS, press: 'high' }],
  ['line deep', { ...DEFAULT_TACTICS, line: 'deep' }],
  ['line high', { ...DEFAULT_TACTICS, line: 'high' }],
  ['shoot patient', { ...DEFAULT_TACTICS, shooting: 'patient' }],
  ['shoot early', { ...DEFAULT_TACTICS, shooting: 'early' }],
  ['Charge', { press: 'high', line: 'high', shooting: 'early' }],
  ['Hold', { press: 'low', line: 'deep', shooting: 'patient' }],
];

const COMBINATIONS: readonly Tactics[] = (['low', 'mid', 'high'] as const).flatMap((press) =>
  (['deep', 'normal', 'high'] as const).flatMap((line) =>
    (['patient', 'normal', 'early'] as const).map((shooting) => ({ press, line, shooting })),
  ),
);

const tacticsName = (t: Tactics): string => `${t.press} press · ${t.line} line · ${t.shooting} shooting`;

interface Pairing {
  readonly i: number;
  readonly j: number;
}

/** Every unordered pairing of `count` entries, plus each entry against itself when `mirror` is set. */
function pairings(count: number, mirror = false): Pairing[] {
  const pairs: Pairing[] = [];
  for (let i = 0; i < count; i++) for (let j = mirror ? i : i + 1; j < count; j++) pairs.push({ i, j });
  return pairs;
}

// ------------------------------------------------------------------ statistics

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
/** Two standard errors of the mean: about a 95% band, so a difference inside it may be noise. */
const twoSe = (xs: readonly number[]): number => {
  const m = mean(xs);
  return 2 * Math.sqrt(mean(xs.map((x) => (x - m) ** 2)) / (xs.length || 1));
};
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
const band = (xs: readonly number[]): string => `${pct(mean(xs))} ±${(100 * twoSe(xs)).toFixed(1)}`;

/** Each entry's points from both sides of every pairing it played, the mirror match excluded. */
function pointsByEntry(count: number, pairs: readonly Pairing[], cells: readonly Line[][]): number[][] {
  const byEntry: number[][] = Array.from({ length: count }, () => []);
  pairs.forEach(({ i, j }, k) => {
    const cell = cells[k] ?? [];
    if (i === j) return;
    byEntry[i]?.push(...cell.map(matchPoints));
    byEntry[j]?.push(...cell.map((m) => 1 - matchPoints(m)));
  });
  return byEntry;
}

const statValue = (stat: Stat, lines: readonly Line[]): string => {
  const m = mean(lines.map((line) => line[stat]));
  return stat === 'territory' ? pct(m) : m.toFixed(2);
};

/** A stat against the default mirror match, marked when the gap is wider than two standard errors. */
function statShift(
  stat: Stat,
  option: readonly Line[],
  base: readonly Line[],
): { text: string; clear: boolean } {
  const xs = option.map((m) => m[stat]);
  const ys = base.map((m) => m[stat]);
  const gap = mean(xs) - mean(ys);
  const noise = Math.hypot(twoSe(xs), twoSe(ys));
  const clear = Math.abs(gap) > noise;
  const delta = stat === 'territory' ? (100 * gap).toFixed(1) : gap.toFixed(2);
  return {
    text: `${STAT_LABELS[stat]} ${statValue(stat, option)} (${gap >= 0 ? '+' : ''}${delta}${clear ? '*' : ' '})`,
    clear,
  };
}

// ------------------------------------------------------------------ the report

if (!isMatchWorker)
  it('tactics report', async () => {
    const pairs = pairings(ENTRIES.length, true);
    const robin = pairings(COMBINATIONS.length);
    const tactic = (list: readonly (readonly [string, Tactics])[], i: number): Tactics =>
      list[i]?.[1] ?? DEFAULT_TACTICS;
    const jobs: Job[] = [
      ...TIERS_UNDER_TEST.flatMap((tier) =>
        pairs.map(({ i, j }) => ({
          a: { tier, tactics: tactic(ENTRIES, i) },
          b: { tier, tactics: tactic(ENTRIES, j) },
          seeds: CELL_SEEDS,
        })),
      ),
      ...TIERS_UNDER_TEST.map((tier) => ({
        a: { tier, tactics: DEFAULT_TACTICS },
        b: { tier: tier - 1, tactics: DEFAULT_TACTICS },
        seeds: CELL_SEEDS,
      })),
      ...robin.map(({ i, j }) => ({
        a: { tier: ROUND_ROBIN_TIER, tactics: COMBINATIONS[i] ?? DEFAULT_TACTICS },
        b: { tier: ROUND_ROBIN_TIER, tactics: COMBINATIONS[j] ?? DEFAULT_TACTICS },
        seeds: ROUND_ROBIN_SEEDS,
      })),
    ];
    const cells = await playAll(jobs);
    const tierCells = (ti: number): Line[][] => cells.slice(ti * pairs.length, (ti + 1) * pairs.length);
    const tierGap = (ti: number): Line[] => cells[TIERS_UNDER_TEST.length * pairs.length + ti] ?? [];
    const robinCells = cells.slice(TIERS_UNDER_TEST.length * (pairs.length + 1));
    /** Side a's view of entry `e` against entry `o`, whichever way round the pairing was played. */
    const versus = (ti: number, e: number, o: number): Line[] => {
      const k = pairs.findIndex(({ i, j }) => (i === e && j === o) || (i === o && j === e));
      const cell = tierCells(ti)[k] ?? [];
      return pairs[k]?.i === e ? cell : cell.map(flip);
    };

    const out = [
      `Tactics report · 4v4 · equal tiers · draws stand · ${2 * CELL_SEEDS} matches per cell, sides swapped`,
      'Points share = (wins + draws/2) / matches, ±2 standard errors. * = shift wider than 2 SE.',
    ];
    const verdicts: string[] = [];

    out.push('', '(a) Each option against default, the other levers at default');
    const silent = new Set(ENTRIES.slice(1).map(([label]) => label));
    TIERS_UNDER_TEST.forEach((tier, ti) => {
      const base = versus(ti, 0, 0);
      out.push(
        ` tier ${tier} · default v default: ${STATS.map((s) => `${STAT_LABELS[s]} ${statValue(s, base)}`).join('  ')}`,
      );
      ENTRIES.slice(1).forEach(([label], k) => {
        const lines = versus(ti, k + 1, 0);
        const n = lines.length;
        const won = lines.filter((m) => matchPoints(m) === 1).length / n;
        const drawn = lines.filter((m) => matchPoints(m) === 0.5).length / n;
        const shifts = STATS.map((s) => statShift(s, lines, base));
        if (shifts.some((s) => s.clear)) silent.delete(label);
        out.push(
          `  ${label.padEnd(13)} ${band(lines.map(matchPoints)).padStart(12)}  W ${pct(won).padStart(5)} D ${pct(drawn).padStart(5)}  ` +
            shifts.map((s) => s.text).join('  '),
        );
      });
    });
    verdicts.push(
      silent.size
        ? `1 FAIL: no clear stat shift at any tier for ${[...silent].join(', ')}`
        : '1 pass: every option shifts at least one stat by more than 2 SE',
    );

    out.push('', `(b) Matrix: each entry against the other ${ENTRIES.length - 1}`);
    const over: string[] = [];
    const best = TIERS_UNDER_TEST.map(() => ({ swing: 0, label: '', se: 0 }));
    TIERS_UNDER_TEST.forEach((tier, ti) => {
      const byEntry = pointsByEntry(ENTRIES.length, pairs, tierCells(ti));
      out.push(` tier ${tier}`);
      ENTRIES.forEach(([label], e) => {
        const rivals = ENTRIES.map((_, o) => o).filter((o) => o !== e);
        const share = (o: number): number => mean(versus(ti, e, o).map(matchPoints));
        const top = rivals.reduce((b, o) => (share(o) > share(b) ? o : b));
        const low = rivals.reduce((w, o) => (share(o) < share(w) ? o : w));
        const own = byEntry[e] ?? [];
        if (mean(own) > DOMINANCE_LIMIT) over.push(`tier ${tier} ${label} ${pct(mean(own))}`);
        const swing = share(top) - 0.5;
        if (swing > (best[ti]?.swing ?? 0)) {
          best[ti] = {
            swing,
            label: `${label} v ${ENTRIES[top]?.[0] ?? ''}`,
            se: twoSe(versus(ti, e, top).map(matchPoints)),
          };
        }
        out.push(
          `  ${label.padEnd(13)} ${band(own).padStart(12)}   best v ${(ENTRIES[top]?.[0] ?? '').padEnd(13)} ${pct(share(top))}` +
            `   worst v ${(ENTRIES[low]?.[0] ?? '').padEnd(13)} ${pct(share(low))}`,
        );
      });
    });

    const robinPoints = pointsByEntry(COMBINATIONS.length, robin, robinCells);
    const ranked = COMBINATIONS.map((t, e) => ({ t, p: robinPoints[e] ?? [] })).sort(
      (x, y) => mean(y.p) - mean(x.p),
    );
    out.push(
      '',
      ` All ${COMBINATIONS.length} combinations, round robin at tier ${ROUND_ROBIN_TIER}, ` +
        `${2 * ROUND_ROBIN_SEEDS} matches per pairing (${2 * ROUND_ROBIN_SEEDS * (COMBINATIONS.length - 1)} each):`,
      ...ranked.map(({ t, p }) => `  ${tacticsName(t).padEnd(44)} ${band(p)}`),
    );
    for (const { t, p } of ranked)
      if (mean(p) > DOMINANCE_LIMIT) over.push(`round robin ${tacticsName(t)} ${pct(mean(p))}`);
    verdicts.push(
      over.length
        ? `2 FAIL: over ${pct(DOMINANCE_LIMIT)} of the field: ${over.join('; ')}`
        : `2 pass: nothing takes more than ${pct(DOMINANCE_LIMIT)} of the field`,
    );

    out.push(
      '',
      '(c) Tactics against tier: the best matchup in (b) next to one tier of difference, default tactics',
    );
    TIERS_UNDER_TEST.forEach((tier, ti) => {
      const gap = tierGap(ti).map(matchPoints);
      const tierSwing = mean(gap) - 0.5;
      const b = best[ti] ?? { swing: 0, label: '', se: 0 };
      const share = b.swing / tierSwing;
      out.push(
        `  tier ${tier} v ${tier - 1}: ${band(gap)} (swing ${pct(tierSwing)})   best matchup ${b.label} ` +
          `swing ${pct(b.swing)} ±${(100 * b.se).toFixed(1)}   = ${share.toFixed(2)} of a tier`,
      );
      verdicts.push(
        `3 tier ${tier}: best matchup is ${share.toFixed(2)} of a tier (target about ${TIER_SHARE_TARGET})`,
      );
    });
    out.push('  The best of 36 noisy pairings is biased upward by about one standard error.');

    console.log(`\n${out.join('\n')}\n\nCriteria\n  ${verdicts.join('\n  ')}\n`);
  });

if (isMatchWorker) parentPort?.on('message', (job: Job) => parentPort?.postMessage(playCell(job)));
