/**
 * Attributes harness (`npm run attributes`): what each trained level is worth in goals a match, the tier
 * scale in the same experiment, and the guard rails on a fully trained knight. Fits feed src/modes/career/stars.ts.
 */
import { availableParallelism } from 'node:os';
import { parentPort, Worker, workerData } from 'node:worker_threads';
import { it } from 'vitest';
import { skillFor } from '../src/ai/skills';
import {
  ATTRIBUTE_CAPS,
  ATTRIBUTES,
  levelOf,
  NO_ATTRIBUTES,
  type Attribute,
  type Attributes,
} from '../src/game/attributes';
import type { KnightSpec } from '../src/game/match';
import { createRng } from '../src/game/rng';
import type { Role } from '../src/game/types';
import {
  matchGoals,
  overallStars,
  PLACE_TIER_VALUE,
  SIM_BRAIN_TIER,
  staminaTiers,
  tierForGoals,
} from '../src/modes/career/stars';
import { OUTFIELD_TIER_VALUE } from '../src/modes/manager/draft';
import { MatchRunner } from '../src/modes/runner';
import { REALM_HOUSES } from '../src/setup/houses';
import { rosterLineup } from '../src/setup/rosters';
import { setTeamTier } from '../src/setup/squads';

/** One match to play: both line-ups in full, so workers need no knowledge of the experiment. */
interface Fixture {
  readonly seed: number;
  readonly home: readonly KnightSpec[];
  readonly away: readonly KnightSpec[];
}

/** Goals for home and away. */
type Score = readonly [number, number];

function play(f: Fixture): Score {
  const runner = new MatchRunner({ home: f.home, away: f.away, seed: f.seed, draws: true });
  runner.advance(Infinity);
  return [runner.state.score[0], runner.state.score[1]];
}

/** Worker threads don't inherit Vitest's TypeScript loading, so each registers tsx, then loads this file. */
const WORKER_BOOT = `import('tsx/esm/api').then((tsx) => { tsx.register(); return import(${JSON.stringify(import.meta.url)}); })`;
const WORKER_MARK = 'attributes-worker';
const isMatchWorker = workerData === WORKER_MARK;
const CHUNK = 50;

/** Plays every fixture on a pool of worker threads, keeping the results in order. */
async function playAll(fixtures: readonly Fixture[]): Promise<Score[]> {
  const chunks = Array.from({ length: Math.ceil(fixtures.length / CHUNK) }, (_, i) =>
    fixtures.slice(i * CHUNK, (i + 1) * CHUNK),
  );
  const results: Score[][] = chunks.map(() => []);
  let next = 0;
  const work = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_BOOT, { eval: true, workerData: WORKER_MARK });
      let current = -1;
      const feed = (): void => {
        current = next++;
        const chunk = chunks[current];
        if (chunk) worker.postMessage(chunk);
        else
          void worker.terminate().then(() => {
            resolve();
          });
      };
      worker.on('message', (scores: Score[]) => {
        results[current] = scores;
        feed();
      });
      worker.on('error', reject);
      feed();
    });
  const threads = Math.max(1, Math.min(availableParallelism() - 1, chunks.length));
  await Promise.all(Array.from({ length: threads }, work));
  return results.flat();
}

// ------------------------------------------------------------------ the knights under test

/** The forged knight's brain in every measurement: the Manager draft's forged tier. */
const BRAIN = 2;
const OUTFIELD: readonly Role[] = ['def', 'mid', 'fwd'];

/** The forged knight as the sim plays him: a Knight's decisions on the human's legs, plus his training. */
const subject = (
  build: number,
  attributes: Attributes,
  brain = BRAIN,
): Omit<KnightSpec, 'look' | 'role'> & {
  build: number;
} => ({ build, human: false, tier: brain, speedFactor: 1, attributes });

type Slot = ReturnType<typeof subject> | { readonly botTier: number };

/** A house's Knight-tier line-up with `slot` in place of its knight in `role`. */
function lineup(house: number, role: Role, slot: Slot): KnightSpec[] {
  const h = REALM_HOUSES[house % REALM_HOUSES.length];
  if (!h) throw new Error('No houses');
  return setTeamTier(rosterLineup(h, 4), BRAIN).map((k) => {
    if (k.role !== role) return k;
    if ('botTier' in slot) return { ...k, tier: slot.botTier, speedFactor: skillFor(slot.botTier).speed };
    const { build, ...rest } = slot;
    return { ...k, ...rest, look: { ...k.look, build } };
  });
}

/** The same two houses with `a` and `b` in the same role, played both ways round on one seed. */
function mirrored(seed: number, a: Slot, b: Slot): [Fixture, Fixture] {
  const role = OUTFIELD[seed % OUTFIELD.length] ?? 'mid';
  const [ha, hb] = [seed, seed + 3];
  return [
    { seed, home: lineup(ha, role, a), away: lineup(hb, role, b) },
    { seed, home: lineup(hb, role, b), away: lineup(ha, role, a) },
  ];
}

// ------------------------------------------------------------------ statistics

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const twoSe = (xs: readonly number[]): number => {
  const m = mean(xs);
  return 2 * Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1) / xs.length);
};
const signed = (x: number): string => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;

/** Goal difference a match for `a` over mirrored seed pairs, ± 2 SE (pairs are the independent unit). */
async function compare(a: Slot, b: Slot, pairs: number, firstSeed: number): Promise<number[]> {
  const fixtures = Array.from({ length: pairs }, (_, i) => mirrored(firstSeed + i, a, b)).flat();
  const scores = await playAll(fixtures);
  return Array.from({ length: pairs }, (_, i) => {
    const [x, y] = [scores[2 * i] ?? [0, 0], scores[2 * i + 1] ?? [0, 0]];
    return (x[0] - x[1] - (y[0] - y[1])) / 2;
  });
}

/** Least squares by the normal equations, keeping the coefficient covariance for sums of coefficients. */
function leastSquares(
  xs: readonly (readonly number[])[],
  ys: readonly number[],
): { beta: number[]; cov: number[][] } {
  const p = xs[0]?.length ?? 0;
  const at = (row: readonly number[] | undefined, i: number): number => row?.[i] ?? 0;
  const m = Array.from({ length: p }, (_, i) => [
    ...Array.from({ length: p }, (_, j) => xs.reduce((s, x) => s + at(x, i) * at(x, j), 0)),
    ...Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let c = 0; c < p; c++) {
    const d = at(m[c], c);
    m[c] = (m[c] ?? []).map((v) => v / d);
    for (let r = 0; r < p; r++) {
      const f = at(m[r], c);
      if (r !== c) m[r] = (m[r] ?? []).map((v, j) => v - f * at(m[c], j));
    }
  }
  const inverse = m.map((row) => row.slice(p));
  const xty = Array.from({ length: p }, (_, i) => xs.reduce((s, x, k) => s + at(x, i) * (ys[k] ?? 0), 0));
  const beta = inverse.map((row) => row.reduce((s, v, j) => s + v * at(xty, j), 0));
  const rss = ys.reduce(
    (s, y, k) => s + (y - (xs[k] ?? []).reduce((t, v, j) => t + v * at(beta, j), 0)) ** 2,
    0,
  );
  const variance = rss / (ys.length - p);
  return { beta, cov: inverse.map((row) => row.map((v) => v * variance)) };
}

/** A weighted sum of coefficients and two standard errors of it. */
function combination(fit: { beta: number[]; cov: number[][] }, weights: readonly number[]): [number, number] {
  const value = weights.reduce((s, w, i) => s + w * (fit.beta[i] ?? 0), 0);
  const variance = weights.reduce(
    (s, wi, i) => s + weights.reduce((t, wj, j) => t + wi * wj * (fit.cov[i]?.[j] ?? 0), 0),
    0,
  );
  return [value, 2 * Math.sqrt(variance)];
}

const FIT_MATCHES = Number(process.env.FIT_MATCHES ?? 40_000);
/** The fit alone outlasts the harness's ten-minute default on a busy machine. */
const FIT_TIMEOUT = 3_600_000;
/** The four stats a match reads; stamina only acts between matches. */
const MATCH_STATS = ['pace', 'shot', 'strength'] as const satisfies readonly Attribute[];

if (!isMatchWorker)
  it(
    'attributes fit',
    async () => {
      // Every match puts a forged knight with a random build and random levels on each side, in the same role;
      // goal difference is then fitted on the differences, so all three match stats come from the same matches.
      const rng = createRng(1415);
      const random = (): ReturnType<typeof subject> =>
        subject(
          rng.int(3),
          Object.fromEntries(
            ATTRIBUTES.map((a) => [a, rng.int(ATTRIBUTE_CAPS[a] + 1)]),
          ) as unknown as Attributes,
        );
      const draws = Array.from({ length: FIT_MATCHES }, (_, i) => ({
        seed: 60_000 + i,
        home: random(),
        away: random(),
      }));
      const fixtures = draws.map(({ seed, home, away }) => {
        const role = OUTFIELD[seed % OUTFIELD.length] ?? 'mid';
        return { seed, home: lineup(seed, role, home), away: lineup(seed + 3, role, away) };
      });
      const scores = await playAll(fixtures);
      const row = (k: ReturnType<typeof subject>): number[] => {
        const levels = MATCH_STATS.map((a) => levelOf(k.attributes ?? NO_ATTRIBUTES, a));
        return [k.build === 0 ? 1 : 0, k.build === 2 ? 1 : 0, ...levels, ...levels.map((l) => l * l)];
      };
      const xs = draws.map(({ home, away }) => {
        const [h, a] = [row(home), row(away)];
        return [1, ...h.map((v, j) => v - (a[j] ?? 0))];
      });
      const ys = scores.map(([h, a]) => h - a);
      const quadratic = leastSquares(xs, ys);
      const linear = leastSquares(
        xs.map((x) => x.slice(0, 3 + MATCH_STATS.length)),
        ys,
      );
      const names = ['home side', 'Nimble v Standard', 'Hefty v Standard'];
      const out = [
        `Attributes fit: ${FIT_MATCHES} matches, goal difference a match, ± 2 SE`,
        '',
        'Linear in level:',
      ];
      names.forEach((name, i) => {
        const [v, e] = combination(
          linear,
          names.map((_, j) => (j === i ? 1 : 0)).concat(MATCH_STATS.map(() => 0)),
        );
        out.push(`  ${name.padEnd(20)} ${signed(v)} ± ${e.toFixed(3)}`);
      });
      MATCH_STATS.forEach((a, i) => {
        const w = (scale: number): number[] => [0, 0, 0, ...MATCH_STATS.map((_, j) => (j === i ? scale : 0))];
        const [v, e] = combination(linear, w(1));
        const [c, ce] = combination(linear, w(ATTRIBUTE_CAPS[a]));
        out.push(
          `  ${a.padEnd(20)} ${signed(v)} ± ${e.toFixed(3)} a level, at cap ${signed(c)} ± ${ce.toFixed(3)}`,
        );
      });
      out.push('', 'With a squared term (curvature):');
      MATCH_STATS.forEach((a, i) => {
        const w = (lin: number, sq: number): number[] => [
          0,
          0,
          0,
          ...MATCH_STATS.map((_, j) => (j === i ? lin : 0)),
          ...MATCH_STATS.map((_, j) => (j === i ? sq : 0)),
        ];
        const cap = ATTRIBUTE_CAPS[a];
        const [l, le] = combination(quadratic, w(1, 0));
        const [q, qe] = combination(quadratic, w(0, 1));
        const [half, he] = combination(quadratic, w(cap / 2, (cap / 2) ** 2));
        const [c, ce] = combination(quadratic, w(cap, cap * cap));
        out.push(
          `  ${a.padEnd(10)} level ${signed(l)} ± ${le.toFixed(3)}, squared ${signed(q)} ± ${qe.toFixed(4)};` +
            ` half cap ${signed(half)} ± ${he.toFixed(3)}, cap ${signed(c)} ± ${ce.toFixed(3)}`,
        );
      });
      console.log(`\n${out.join('\n')}\n`);
    },
    FIT_TIMEOUT,
  );

const BASE_PAIRS = Number(process.env.BASE_PAIRS ?? 3000);

if (!isMatchWorker)
  it('attributes base', async () => {
    const d = await compare(subject(1, NO_ATTRIBUTES), { botTier: BRAIN }, BASE_PAIRS, 20_000);
    console.log(
      `\nUntrained Standard forged knight v a Knight-tier bot in his place: ${signed(mean(d))} ± ${twoSe(d).toFixed(3)} goals a match (${d.length} seed pairs)\n`,
    );
  });

const TIER_PAIRS = Number(process.env.TIER_PAIRS ?? 2000);

if (!isMatchWorker)
  it('attributes tiers', async () => {
    // The tier scale in this same experiment: a bot of each tier in the forged knight's place.
    const out = [
      `Tier values in the forged knight's place: ${TIER_PAIRS} mirrored seed pairs, v a Knight-tier bot, ± 2 SE`,
    ];
    for (const tier of [0, 1, 3, 4]) {
      const d = await compare({ botTier: tier }, { botTier: BRAIN }, TIER_PAIRS, 70_000 + tier * 10_000);
      out.push(
        `  ${skillFor(tier).name.padEnd(10)} ${signed(mean(d))} ± ${twoSe(d).toFixed(3)}   (draft fit, mixed line-ups: ${signed(OUTFIELD_TIER_VALUE[tier] ?? 0)})`,
      );
    }
    console.log(`\n${out.join('\n')}\n`);
  });

const SINGLE_PAIRS = Number(process.env.SINGLE_PAIRS ?? 3000);
/** Comma-separated stats for the single block (all match stats by default), so one can be checked alone. */
const SINGLE_STATS = (process.env.SINGLE_STATS?.split(',') ?? MATCH_STATS).filter((a): a is Attribute =>
  (ATTRIBUTES as readonly string[]).includes(a),
);

if (!isMatchWorker)
  it('attributes single', async () => {
    // Each stat alone at its cap against the same knight untrained: a direct check on the fit, no model.
    const out = [
      `Each stat alone at its cap v untrained (Standard): ${SINGLE_PAIRS} mirrored seed pairs, ± 2 SE`,
    ];
    for (const [i, a] of SINGLE_STATS.entries()) {
      const capped = { ...NO_ATTRIBUTES, [a]: ATTRIBUTE_CAPS[a] };
      const d = await compare(
        subject(1, capped),
        subject(1, NO_ATTRIBUTES),
        SINGLE_PAIRS,
        90_000 + i * 10_000,
      );
      out.push(`  ${a.padEnd(10)} ${signed(mean(d))} ± ${twoSe(d).toFixed(3)}`);
    }
    console.log(`\n${out.join('\n')}\n`);
  });

const GUARD_PAIRS = Number(process.env.GUARD_PAIRS ?? 1500);
const trained = (level: (cap: number) => number): Attributes =>
  Object.fromEntries(ATTRIBUTES.map((a) => [a, level(ATTRIBUTE_CAPS[a])])) as unknown as Attributes;
const MAXED = trained((cap) => cap);
const HALF = trained((cap) => Math.floor(cap / 2));
const asSim = (build: number, attributes: Attributes, brain = SIM_BRAIN_TIER): ReturnType<typeof subject> =>
  subject(build, attributes, brain);

if (!isMatchWorker)
  it('attributes guard rails', async () => {
    const base = asSim(1, NO_ATTRIBUTES);
    const maxed = asSim(1, MAXED);
    const baseGoals = matchGoals(1, NO_ATTRIBUTES);
    const tiersOver = (goals: number): number => tierForGoals(baseGoals + goals) - tierForGoals(baseGoals);
    const out = [
      `Attributes guard rails: ${GUARD_PAIRS} mirrored seed pairs a line, goal difference a match, ± 2 SE`,
      `Stars: untrained Standard ${overallStars(1, NO_ATTRIBUTES).toFixed(2)}, half-trained ${overallStars(1, HALF).toFixed(2)},` +
        ` maxed ${overallStars(1, MAXED).toFixed(2)} (Nimble ${overallStars(0, MAXED).toFixed(2)}, Hefty ${overallStars(2, MAXED).toFixed(2)})`,
    ];
    const line = async (
      label: string,
      a: Slot,
      b: Slot,
      predicted: number,
      seed: number,
    ): Promise<number[]> => {
      const d = await compare(a, b, GUARD_PAIRS, seed);
      out.push(
        `  ${label.padEnd(44)} ${signed(mean(d))} ± ${twoSe(d).toFixed(3)}   predicted ${signed(predicted)}`,
      );
      return d;
    };
    const fitted = matchGoals(1, MAXED) - baseGoals;
    const gap = await line('maxed v untrained (Standard)', maxed, base, fitted, 40_000);
    const [g, e] = [mean(gap), twoSe(gap)];
    out.push(
      `    = ${tiersOver(g).toFixed(2)} tiers over his base (${tiersOver(g - e).toFixed(2)} to ${tiersOver(g + e).toFixed(2)}); stars say ${(overallStars(1, MAXED) - overallStars(1, NO_ATTRIBUTES) - staminaTiers(MAXED)).toFixed(2)} from match stats, +${staminaTiers(MAXED).toFixed(2)} from stamina`,
    );
    await line(
      'maxed v Legend bot',
      maxed,
      { botTier: 4 },
      matchGoals(1, MAXED) - (PLACE_TIER_VALUE[4] ?? 0),
      45_000,
    );
    await line(
      'half-trained v Champion bot',
      asSim(1, HALF),
      { botTier: 3 },
      matchGoals(1, HALF) - (PLACE_TIER_VALUE[3] ?? 0),
      50_000,
    );
    await line('untrained v Knight bot', base, { botTier: 2 }, baseGoals, 55_000);
    const starBrain = Math.round(overallStars(1, MAXED));
    await line(
      `maxed, brain ${starBrain} from his stars v brain ${SIM_BRAIN_TIER}`,
      asSim(1, MAXED, starBrain),
      maxed,
      0,
      60_000,
    );
    console.log(`\n${out.join('\n')}\n`);
  });

if (isMatchWorker) parentPort?.on('message', (chunk: Fixture[]) => parentPort?.postMessage(chunk.map(play)));
