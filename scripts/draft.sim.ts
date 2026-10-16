/**
 * Draft harness: fits what each tier and build is worth in mixed line-ups (the value model's inputs),
 * then checks that drafted squads beat random legal drafts and that no draft style dominates.
 * Run one with `npx vitest run --config scripts/vitest.config.ts scripts/draft.sim.ts --reporter=verbose -t '<name>'`.
 */
import { it } from 'vitest';
import { skillFor } from '../src/ai/skills';
import type { KnightSpec } from '../src/game/match';
import { createRng } from '../src/game/rng';
import type { Role } from '../src/game/types';
import { DEFAULT_LOOK } from '../src/knight/look';
import {
  applyPick,
  availableKnights,
  chooseDraftPick,
  defaultLineup,
  houseOnTheClock,
  isDraftComplete,
  legalPicks,
  squadOf,
  startDraft,
  type DraftState,
  type DraftStyle,
} from '../src/modes/manager/draft';
import type { SquadKnight } from '../src/modes/manager/types';
import { MatchRunner } from '../src/modes/runner';

const LINEUPS = Number(process.env.DRAFT_SIM_LINEUPS ?? 4000);
/** Sync tests can run past vitest's default limit with big samples. */
const LIMIT = 3_600_000;
const DRAFTS = Number(process.env.DRAFT_SIM_DRAFTS ?? 40);
const ROLES: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];
const STYLES: readonly DraftStyle[] = ['stars', 'balanced', 'depth'];

/** Goal difference for `a`, sides swapped every other match so neither team always kicks off left. */
function goalDiff(a: readonly KnightSpec[], b: readonly KnightSpec[], seed: number): number {
  const swap = seed % 2 === 1;
  const runner = new MatchRunner({ home: swap ? b : a, away: swap ? a : b, seed, draws: true });
  runner.advance(Infinity);
  const diff = runner.state.score[0] - runner.state.score[1];
  return swap ? -diff : diff;
}

/** Mean and two standard errors. */
function summary(xs: readonly number[]): string {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, xs.length - 1));
  return `${mean.toFixed(3)} ± ${((2 * sd) / Math.sqrt(xs.length)).toFixed(3)} (n=${xs.length})`;
}

const points = (diff: number): number => (diff > 0 ? 1 : diff === 0 ? 0.5 : 0);

/** Least squares with standard errors, by the normal equations (a dozen features, so no library needed). */
function leastSquares(
  xs: readonly (readonly number[])[],
  ys: readonly number[],
): { beta: number[]; se: number[] } {
  const p = xs[0]?.length ?? 0;
  const at = (row: readonly number[], i: number): number => row[i] ?? 0;
  const m = Array.from({ length: p }, (_, i) => [
    ...Array.from({ length: p }, (_, j) => xs.reduce((s, x) => s + at(x, i) * at(x, j), 0)),
    ...Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let c = 0; c < p; c++) {
    const pivot = m[c] ?? [];
    const d = at(pivot, c);
    m[c] = pivot.map((v) => v / d);
    for (let r = 0; r < p; r++) {
      const row = m[r] ?? [];
      const f = at(row, c);
      if (r !== c) m[r] = row.map((v, j) => v - f * at(m[c] ?? [], j));
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
  return { beta, se: inverse.map((row, i) => Math.sqrt(variance * at(row, i))) };
}

const FEATURES = [
  'home side',
  'outfield Peasant',
  'outfield Squire',
  'outfield Champion',
  'outfield Legend',
  'keeper Peasant',
  'keeper Squire',
  'keeper Champion',
  'keeper Legend',
  'outfield Nimble',
  'outfield Hefty',
  'keeper Nimble',
  'keeper Hefty',
  'outfield spread',
] as const;

/** A line-up's features against an all-Knight, all-Standard one: tier and build counts, and the tier spread. */
function features(lineup: readonly KnightSpec[]): number[] {
  const [keeper, ...outfield] = lineup;
  const tiers = outfield.map((k) => k.tier);
  const count = (test: (k: KnightSpec) => boolean): number => outfield.filter(test).length;
  return [
    ...[0, 1, 3, 4].map((tier) => count((k) => k.tier === tier)),
    ...[0, 1, 3, 4].map((tier) => (keeper?.tier === tier ? 1 : 0)),
    count((k) => k.look.build === 0),
    count((k) => k.look.build === 2),
    keeper?.look.build === 0 ? 1 : 0,
    keeper?.look.build === 2 ? 1 : 0,
    Math.max(...tiers) - Math.min(...tiers),
  ];
}

it(
  'draft values',
  () => {
    // Random line-ups (any tier and build in every place) against each other, then a linear fit of the
    // goal difference on the difference in features: what each is worth in mixed squads like drafted ones.
    const rng = createRng(1066);
    const lineup = (): KnightSpec[] =>
      ROLES.map((role) => {
        const tier = rng.int(5);
        return {
          look: { ...DEFAULT_LOOK, build: rng.int(3) },
          role,
          human: false,
          tier,
          speedFactor: skillFor(tier).speed,
        };
      });
    const xs: number[][] = [];
    const ys: number[] = [];
    for (let i = 0; i < LINEUPS; i++) {
      const [home, away] = [lineup(), lineup()];
      const runner = new MatchRunner({ home, away, seed: 50_000 + i, draws: true });
      runner.advance(Infinity);
      const [h, a] = [features(home), features(away)];
      xs.push([1, ...h.map((v, j) => v - (a[j] ?? 0))]);
      ys.push(runner.state.score[0] - runner.state.score[1]);
    }
    const { beta, se } = leastSquares(xs, ys);
    console.log(
      `Goal difference per match by feature, against Knight / Standard, ± 2 SE (${LINEUPS} matches):`,
    );
    FEATURES.forEach((name, i) => {
      console.log(`${name.padEnd(18)} ${(beta[i] ?? 0).toFixed(3)} ± ${(2 * (se[i] ?? 0)).toFixed(3)}`);
    });
  },
  LIMIT,
);

type Drafter = (draft: DraftState) => string;

const managed =
  (style: DraftStyle): Drafter =>
  (draft) =>
    chooseDraftPick(draft, style);

function randomDrafter(seed: number): Drafter {
  const rng = createRng(seed);
  return (draft) => rng.pick(legalPicks(draft)).id;
}

function runDraft(seed: number, drafters: (house: string) => Drafter): DraftState {
  let draft = startDraft(seed, 'ember', { ...DEFAULT_LOOK, name: 'Sir Forged' });
  while (!isDraftComplete(draft)) {
    const house = houseOnTheClock(draft);
    if (house === null) break;
    draft = applyPick(draft, house, drafters(house)(draft));
  }
  return draft;
}

/**
 * Who rests in each of 14 matches, by squad place (starters then bench): the plan's stamina target,
 * where the first four start 10 matches each and the two on the bench 8, so the bench really plays.
 */
const ROTATION: readonly (readonly [number, number])[] = [
  [4, 5],
  [0, 4],
  [1, 5],
  [0, 1],
  [2, 4],
  [3, 5],
  [2, 3],
  [4, 5],
  [1, 4],
  [0, 5],
  [0, 2],
  [3, 4],
  [2, 5],
  [1, 3],
];
/** DRAFT_SIM_ROTATE=0 plays the default starting four every match instead, as a single cup tie would. */
const ROTATE = process.env.DRAFT_SIM_ROTATE !== '0';

/** A house's line-up for its `match`-th match of the sample. */
function starters(draft: DraftState, house: string, match: number): readonly KnightSpec[] {
  const squad = squadOf(draft, house);
  if (!ROTATE) return defaultLineup(squad).starters;
  const { starters: first, bench } = defaultLineup(squad);
  const places = [...first.map((spec) => squad.find((k) => k.look === spec.look)), ...bench];
  const resting = ROTATION[match % ROTATION.length] ?? [4, 5];
  const playing = places.filter((k, i): k is SquadKnight => k !== undefined && !resting.includes(i));
  return defaultLineup(playing).starters;
}

it(
  'draft vs random',
  () => {
    // Per draft, alternate houses in pick order are managed or random; each seed runs both ways round.
    const perDraft: number[] = [];
    const byStyle = new Map<DraftStyle, number[]>(STYLES.map((s) => [s, []]));
    for (let d = 0; d < DRAFTS; d++) {
      const seed = 1000 + Math.floor(d / 2);
      const style = STYLES[d % STYLES.length] ?? 'balanced';
      const order = startDraft(seed, 'ember', DEFAULT_LOOK).order;
      const isManaged = (house: string): boolean => order.indexOf(house) % 2 === d % 2;
      const random = randomDrafter(seed * 7 + d);
      const draft = runDraft(seed, (house) => (isManaged(house) ? managed(style) : random));
      const scores: number[] = [];
      for (const a of order.filter(isManaged))
        for (const b of order.filter((h) => !isManaged(h)))
          scores.push(
            points(
              goalDiff(
                starters(draft, a, d + scores.length),
                starters(draft, b, d + scores.length + 3),
                seed * 131 + scores.length,
              ),
            ),
          );
      const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
      perDraft.push(mean);
      byStyle.get(style)?.push(mean);
    }
    console.log('Managed draft vs random legal draft, win rate (draw = half), ± 2 SE clustered by draft:');
    console.log(`all styles   ${summary(perDraft)}`);
    for (const [style, xs] of byStyle) console.log(`${style.padEnd(12)} ${summary(xs)}`);
  },
  LIMIT,
);

it(
  'draft styles',
  () => {
    // Every draft deals the three styles to houses afresh, then plays a full round robin.
    const pairs = new Map<string, number[]>();
    const tiers = new Map<DraftStyle, number[][]>(STYLES.map((s) => [s, []]));
    const undrafted = [0, 0, 0, 0, 0];
    for (let d = 0; d < DRAFTS; d++) {
      const seed = 5000 + d;
      const order = startDraft(seed, 'ember', DEFAULT_LOOK).order;
      const dealt = createRng(seed).shuffle(order.map((_, i) => STYLES[i % STYLES.length] ?? 'balanced'));
      const styleOf = (house: string): DraftStyle => dealt[order.indexOf(house)] ?? 'balanced';
      const draft = runDraft(seed, (house) => managed(styleOf(house)));
      for (const k of availableKnights(draft)) undrafted[k.tier] = (undrafted[k.tier] ?? 0) + 1;
      for (const house of order)
        tiers.get(styleOf(house))?.push(
          squadOf(draft, house)
            .map((k) => k.tier)
            .sort((a, b) => b - a),
        );
      const tally = new Map<string, number[]>();
      order.forEach((a, i) => {
        order.slice(i + 1).forEach((b, j) => {
          if (styleOf(a) === styleOf(b)) return;
          const [x, y] = [styleOf(a), styleOf(b)].sort();
          const score = points(
            goalDiff(starters(draft, a, d + j), starters(draft, b, d + i), seed * 97 + i * 8 + j),
          );
          const key = `${x} v ${y}`;
          tally.set(key, [...(tally.get(key) ?? []), x === styleOf(a) ? score : 1 - score]);
        });
      });
      for (const [key, scores] of tally)
        pairs.set(key, [...(pairs.get(key) ?? []), scores.reduce((s, x) => s + x, 0) / scores.length]);
    }
    console.log('Style against style, win rate of the first named (draw = half), ± 2 SE clustered by draft:');
    for (const [key, xs] of [...pairs].sort()) console.log(`${key.padEnd(20)} ${summary(xs)}`);
    for (const [style, squads] of tiers) {
      const mean = (i: number): string =>
        (squads.reduce((s, sq) => s + (sq[i] ?? 0), 0) / squads.length).toFixed(2);
      console.log(`${style.padEnd(9)} mean tiers, best first: ${[0, 1, 2, 3, 4, 5].map(mean).join(' ')}`);
    }
    // A tier nobody leaves behind is underpriced; one mostly left behind is overpriced.
    const perDraft = undrafted.map((n) => (n / DRAFTS).toFixed(1)).join(' ');
    console.log(`undrafted per draft, Peasant to Legend: ${perDraft}`);
  },
  LIMIT,
);
