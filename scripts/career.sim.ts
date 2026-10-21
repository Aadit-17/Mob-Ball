// Career harness (`npm run career`): whole careers headless, the forged knight simmed throughout with a plain policy
// (buy the best measured value a point, take the best offer), many seeds. Reports each season's division, ratings,
// points, stats, offers and honours, and his playing time; refits the form model; and fails if the world, the economy
// or his playing time breaks its bounds.
import { availableParallelism } from 'node:os';
import { parentPort, Worker, workerData } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { ATTRIBUTE_CAPS, ATTRIBUTES, levelOf, type Attribute } from '../src/game/attributes';
import { DEFAULT_LOOK } from '../src/knight/look';
import { table } from '../src/modes/manager/league';
import {
  careerDay,
  endSeason,
  guardPlayer,
  HOOK_RATING,
  isSeasonOver,
  nextSeason,
  planFixture,
  playerFixture,
  playerStars,
  PLAYER_ID,
  POSITIONS,
  ROYAL_RIVAL_TIERS,
  simMatchday,
  simulate,
  startCareer,
  trainPlayer,
  type CareerState,
} from '../src/modes/career/career';
import { clubLevel, DIVISION_TIER, DIVISIONS, type Division } from '../src/modes/career/clubs';
import { canTrain, guardCost, trainCost, type Honour } from '../src/modes/career/economy';
import { formTiers, matchStrength, RATING_FIT } from '../src/modes/career/form';
import { normalizeCareer } from '../src/modes/career/save';
import { goalsPerLevel, maxedCost, UPGRADE_COST } from '../src/modes/career/upgrades';
import { promote, PROMOTED, RELEGATED } from '../src/modes/career/world';

const RUNS = Number(process.env.CAREER_RUNS ?? Math.max(1, availableParallelism() - 1));
/** Age 17 to 38: the whole climb, the peak and the decline. */
const SEASONS = Number(process.env.CAREER_SEASONS ?? 22);
const FIRST_SEED = 9000;
/** Its own limit, not the scripts' ten minutes: a career run takes about eight on a quiet machine, more on a busy one. */
const CAREER_TIMEOUT = 45 * 60_000;

interface SeasonRow {
  readonly season: number;
  readonly age: number;
  readonly division: Division;
  readonly club: string;
  readonly finish: number;
  readonly apps: number;
  readonly starts: number;
  readonly subOns: number;
  readonly subOffs: number;
  readonly average: number | null;
  readonly matchPoints: number;
  readonly honourPoints: number;
  readonly honours: readonly Honour[];
  /** Royal knockout rounds played and won, 0 without a call-up. */
  readonly royalPlayed: number;
  readonly royalWon: number;
  readonly offers: number;
  readonly offerUp: number;
  readonly moved: boolean;
  readonly fame: number;
  readonly stars: number;
  readonly levels: number;
  /** Points spent so far on levels, as a share of what maxing out costs. */
  readonly trained: number;
  readonly clubUp: boolean;
  readonly clubDown: boolean;
}

/** Every match of his club: what his manager made of him, and how it went. */
interface PlayRow {
  readonly division: Division;
  /** His form reading in tiers when the side was picked. */
  readonly form: number;
  readonly started: boolean;
  readonly cameOn: boolean;
  readonly subbedOff: boolean;
  /** His live rating when judged at the hour, if he started. */
  readonly judged: number | null;
  readonly rating: number | null;
}

interface MatchRow {
  readonly keeper: boolean;
  readonly gap: number;
  readonly mates: number;
  readonly rating: number;
}

interface WorldRow {
  readonly season: number;
  /** Mean club level (best four's mean tier) per division. */
  readonly levels: readonly number[];
}

interface CareerRun {
  readonly seasons: readonly SeasonRow[];
  readonly matches: readonly MatchRow[];
  readonly plays: readonly PlayRow[];
  readonly world: readonly WorldRow[];
  readonly problems: readonly string[];
}

// ------------------------------------------------------------------ one career

/** Best measured value a point first: stamina, pace, shot, strength (stars.ts and upgrades.ts). */
const BY_VALUE: readonly Attribute[] = [...ATTRIBUTES].sort(
  (a, b) => goalsPerLevel(b) / UPGRADE_COST[b] - goalsPerLevel(a) / UPGRADE_COST[a],
);

function spend(career: CareerState): CareerState {
  let c = career;
  for (let bought = true; bought;) {
    bought = false;
    for (const stat of BY_VALUE) {
      const train = canTrain(c.player.age);
      if (train ? trainCost(c.player, stat) === null : guardCost(c.player, stat) === null) continue;
      c = train ? trainPlayer(c, stat) : guardPlayer(c, stat);
      bought = true;
      break;
    }
  }
  return c;
}

/** Sorted keys, so a save read back compares equal whatever order its fields were built in. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

function checkWorld(c: CareerState, problems: string[]): void {
  const where = `seed ${c.seed} season ${c.season.number}`;
  const clubs = c.world.divisions.flat();
  if (c.world.divisions.some((d) => d.length !== 8) || new Set(clubs).size !== 24)
    problems.push(`${where}: divisions`);
  for (const squad of Object.values(c.world.squads))
    if (squad.length !== 6 || squad.some((k) => k.tier < 0 || k.tier > 4 || !Number.isInteger(k.tier)))
      problems.push(`${where}: a squad`);
  for (const a of ATTRIBUTES)
    if (
      levelOf(c.player.attributes, a) !== c.player.attributes[a] ||
      c.player.attributes[a] > ATTRIBUTE_CAPS[a]
    )
      problems.push(`${where}: ${a} ${c.player.attributes[a]}`);
  if (c.player.points < 0 || c.player.age !== 17 + c.season.number) problems.push(`${where}: points or age`);
  const read = normalizeCareer(JSON.parse(JSON.stringify(c)));
  if (!read || stable(read) !== stable(c)) problems.push(`${where}: the save does not read back as saved`);
}

function runCareer(seed: number, position: (typeof POSITIONS)[number]): CareerRun {
  let c = startCareer({ seed, look: DEFAULT_LOOK, position });
  const seasons: SeasonRow[] = [];
  const matches: MatchRow[] = [];
  const plays: PlayRow[] = [];
  const world: WorldRow[] = [];
  const problems: string[] = [];
  let spent = 0;
  for (let s = 0; s < SEASONS; s++) {
    world.push({
      season: s,
      levels: DIVISIONS.map((d) => {
        const clubs = c.world.divisions[d] ?? [];
        return clubs.reduce((t, club) => t + clubLevel(c.world, club), 0) / clubs.length;
      }),
    });
    while (!isSeasonOver(c)) {
      const ref = playerFixture(c);
      if (ref) {
        const form = formTiers(c.player.form, careerDay(c));
        const plan = planFixture(c, ref, 'sim');
        c = plan.finish(c, simulate(plan));
        const [mine, theirs] = plan.sheets;
        const record = c.season.records[ref.division]?.[plan.fixture.matchday]?.[ref.index];
        const rating = record?.ratings[PLAYER_ID];
        plays.push({
          division: ref.division,
          form,
          started: mine.playerSlot !== null,
          cameOn: record?.subs.some((x) => x.on === PLAYER_ID) ?? false,
          subbedOff: record?.subs.some((x) => x.off === PLAYER_ID) ?? false,
          judged: plan.judged(),
          rating: rating ?? null,
        });
        if (rating !== undefined && mine.playerSlot !== null) {
          const tierMean = (xs: readonly { tier: number }[]) =>
            xs.reduce((t, x) => t + x.tier, 0) / xs.length;
          const rivals = tierMean(theirs.starters);
          matches.push({
            keeper: c.player.position === 'gk',
            gap: matchStrength(c.player.look.build, c.player.attributes) - rivals,
            mates: tierMean(mine.starters.filter((_, i) => i !== mine.playerSlot)) - rivals,
            rating,
          });
        }
      }
      c = simMatchday(c);
      const before = c.player.points;
      c = spend(c);
      spent += before - c.player.points;
      if (c.season.number === 0 && c.season.leagues[0]?.results[6]?.every((r) => r) === true)
        checkWorld(c, problems);
    }
    c = endSeason(c);
    const before = c.player.points;
    c = spend(c);
    spent += before - c.player.points;
    checkWorld(c, problems);

    const summary = c.history.at(-1);
    const review = c.review;
    if (!summary || !review) throw new Error('No season summary');
    const next = promote(c.season.leagues.map((l) => table(l)));
    const stayDivision = next.findIndex((clubs) => clubs.includes(c.player.club));
    const level = (club: string) => clubLevel(c.world, club);
    const better = review.offers
      .filter(
        (o) =>
          o.division > stayDivision ||
          (o.division === stayDivision && level(o.club) > level(c.player.club) + 0.25),
      )
      .sort((a, b) => b.division - a.division || level(b.club) - level(a.club))[0];
    const levels = ATTRIBUTES.reduce((t, a) => t + c.player.attributes[a], 0);
    seasons.push({
      season: s,
      age: summary.age,
      division: summary.division,
      club: summary.club,
      finish: summary.finish,
      apps: summary.apps,
      starts: summary.starts,
      subOns: summary.subOns,
      subOffs: summary.subOffs,
      average: summary.average,
      matchPoints: summary.matchPoints,
      honourPoints: summary.honourPoints,
      honours: summary.honours,
      royalPlayed: review.royal?.matches.length ?? 0,
      royalWon: review.royal?.matches.filter((m) => m.score[0] > m.score[1]).length ?? 0,
      offers: review.offers.length,
      offerUp: review.offers.filter((o) => o.division > summary.division).length,
      moved: better !== undefined,
      fame: summary.fame,
      stars: playerStars(c.player),
      levels,
      trained: Math.min(1, spent / maxedCost),
      clubUp: summary.honours.includes('promotion'),
      clubDown: summary.relegated,
    });

    const old = c.world.divisions;
    c = nextSeason(c, better?.club ?? null);
    for (let d = 0; d + 1 < DIVISIONS.length; d++) {
      const up = (c.world.divisions[d + 1] ?? []).filter((club) => old[d]?.includes(club)).length;
      const down = (c.world.divisions[d] ?? []).filter((club) => old[d + 1]?.includes(club)).length;
      if (up !== PROMOTED || down !== RELEGATED)
        problems.push(`seed ${seed} season ${s}: ${up} up, ${down} down`);
    }
  }
  return { seasons, matches, plays, world, problems };
}

// ------------------------------------------------------------------ workers

interface Task {
  readonly seed: number;
  readonly position: (typeof POSITIONS)[number];
}

/** Worker threads don't inherit Vitest's TypeScript loading, so each registers tsx, then loads this file. */
const WORKER_BOOT = `import('tsx/esm/api').then((tsx) => { tsx.register(); return import(${JSON.stringify(import.meta.url)}); })`;
const WORKER_MARK = 'career-worker';

const isCareerWorker = workerData === WORKER_MARK;

if (isCareerWorker)
  parentPort?.on('message', (task: Task) => {
    parentPort?.postMessage(runCareer(task.seed, task.position));
  });

async function runAll(tasks: readonly Task[]): Promise<CareerRun[]> {
  const results: (CareerRun | undefined)[] = tasks.map(() => undefined);
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
      worker.on('message', (run: CareerRun) => {
        results[current] = run;
        feed();
      });
      worker.on('error', reject);
      feed();
    });
  const threads = Math.max(1, Math.min(availableParallelism() - 1, tasks.length));
  await Promise.all(Array.from({ length: threads }, work));
  return results.filter((r): r is CareerRun => r !== undefined);
}

// ------------------------------------------------------------------ statistics

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? ((s[Math.floor((s.length - 1) / 2)] ?? 0) + (s[Math.ceil((s.length - 1) / 2)] ?? 0)) / 2
    : NaN;
};
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '–');
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '–');
const rate2 = (n: number, d: number): number => (d ? n / d : NaN);
const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** Least squares with standard errors, by the normal equations (a handful of columns). */
function ols(
  xs: readonly (readonly number[])[],
  ys: readonly number[],
): { b: number[]; se: number[]; sd: number } {
  const k = xs[0]?.length ?? 0;
  const a = Array.from({ length: k }, () => Array.from({ length: 2 * k }, () => 0));
  for (const x of xs)
    for (let i = 0; i < k; i++) {
      const row = a[i] ?? [];
      for (let j = 0; j < k; j++) row[j] = (row[j] ?? 0) + (x[i] ?? 0) * (x[j] ?? 0);
    }
  for (let i = 0; i < k; i++) (a[i] ?? [])[k + i] = 1;
  for (let i = 0; i < k; i++) {
    const row = a[i] ?? [];
    const p = row[i] ?? 1;
    for (let j = 0; j < 2 * k; j++) row[j] = (row[j] ?? 0) / p;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const other = a[r] ?? [];
      const f = other[i] ?? 0;
      for (let j = 0; j < 2 * k; j++) other[j] = (other[j] ?? 0) - f * (row[j] ?? 0);
    }
  }
  const inv = a.map((row) => row.slice(k));
  const xty = Array.from({ length: k }, (_, i) => xs.reduce((t, x, n) => t + (x[i] ?? 0) * (ys[n] ?? 0), 0));
  const b = inv.map((row) => row.reduce((t, v, j) => t + v * (xty[j] ?? 0), 0));
  const residuals = ys.map((y, n) => y - (xs[n] ?? []).reduce((t, x, i) => t + x * (b[i] ?? 0), 0));
  const s2 = residuals.reduce((t, r) => t + r * r, 0) / Math.max(1, ys.length - k);
  return { b, se: inv.map((row, i) => Math.sqrt(s2 * (row[i] ?? 0))), sd: Math.sqrt(s2) };
}

// ------------------------------------------------------------------ report

/** Bounds the run fails outside, from the plan: near-maxed in the late twenties, the Great Houses in 4–8 seasons. */
/** A lean of ratings on teammates (rating points a tier) small enough to leave out of the form model. */
const LEAN = 0.15;

const TARGETS = {
  maxedAge: [25, 29],
  greatHousesSeason: [3, 8],
  /** Share of careers in the Great Houses by their third season: achievable, never automatic. */
  earlyGreatHouses: 0.5,
  /** Stars at 34 against the peak: clearly fading, still a useful knight. */
  fadeAt34: [0.3, 1.5],
  starsAt34: 2.5,
  /** Each division's mean club level stays within this of its tier, beyond the first seasons. */
  levelBand: 0.75,
  /** Share of his club's matches he plays (starts or comes on) with his form under -0.15 tiers, and in the worst-form
   * quarter of careers: about four in five at least. Good form (over +0.15) all but always starts, while overall the
   * manager still benches him sometimes, and the hook stays for real stinkers. */
  poorFormPlays: 0.75,
  goodFormStarts: 0.93,
  startsAtMost: 0.9,
  hookedAtMost: 0.05,
} as const;

if (!isCareerWorker)
  it(
    'career report',
    async () => {
      const tasks = Array.from({ length: RUNS }, (_, i) => ({
        seed: FIRST_SEED + i,
        position: POSITIONS[i % POSITIONS.length] ?? 'fwd',
      }));
      const started = performance.now();
      const runs = await runAll(tasks);
      const lines: string[] = [
        `${runs.length} careers × ${SEASONS} seasons (${f1((performance.now() - started) / 1000)} s), simmed throughout; positions cycle gk, def, mid, fwd.`,
        '',
        'season age | Vil Shi Grt | apps start on  off avg  pts  bonus | stars levels trained | offers up moved | up down title royal | fame',
      ];
      const failures: string[] = runs.flatMap((r) => r.problems);

      for (let s = 0; s < SEASONS; s++) {
        const rows = runs.map((r) => r.seasons[s]).filter((x): x is SeasonRow => x !== undefined);
        if (!rows.length) continue;
        const share = (f: (r: SeasonRow) => boolean) => pct(rows.filter(f).length / rows.length).padStart(4);
        const averages = rows.map((r) => r.average).filter((a): a is number => a !== null);
        lines.push(
          [
            `${String(s + 1).padStart(6)} ${String(rows[0]?.age ?? 0).padStart(3)}`,
            DIVISIONS.map((d) => share((r) => r.division === d)).join(''),
            `${f1(mean(rows.map((r) => r.apps))).padStart(4)} ${f1(mean(rows.map((r) => r.starts))).padStart(5)} ${f1(mean(rows.map((r) => r.subOns))).padStart(3)} ${f1(mean(rows.map((r) => r.subOffs))).padStart(4)} ${f2(mean(averages))} ${f1(mean(rows.map((r) => r.matchPoints))).padStart(4)} ${f1(mean(rows.map((r) => r.honourPoints))).padStart(5)}`,
            `${f2(mean(rows.map((r) => r.stars))).padStart(5)} ${f1(mean(rows.map((r) => r.levels))).padStart(6)} ${share((r) => r.trained >= 0.9).padStart(7)}`,
            `${f1(mean(rows.map((r) => r.offers))).padStart(6)} ${f1(mean(rows.map((r) => r.offerUp))).padStart(3)} ${share((r) => r.moved).padStart(5)}`,
            `${share((r) => r.clubUp)} ${share((r) => r.clubDown)} ${share((r) => r.honours.includes('title'))} ${share((r) => r.honours.includes('royalCall'))}`,
            f1(mean(rows.map((r) => r.fame))),
          ].join(' | '),
        );
      }

      // The economy: when each career had spent 90% of what maxing out costs.
      const maxedAges = runs.map((r) => r.seasons.find((x) => x.trained >= 0.9)?.age ?? Infinity);
      const greatSeasons = runs.map((r) => (r.seasons.find((x) => x.division === 2)?.season ?? Infinity) + 1);
      const early =
        runs.filter((r) => r.seasons.slice(0, 3).some((x) => x.division === 2)).length / runs.length;
      const peak = runs.map((r) => Math.max(...r.seasons.map((x) => x.stars)));
      const at34 = runs.map((r) => r.seasons.find((x) => x.age === 34)?.stars ?? NaN);
      const fade = at34.map((s, i) => (peak[i] ?? 0) - s);
      lines.push(
        '',
        `economy: 90% of the ${maxedCost} points to max out spent at age ${f1(median(maxedAges))} (median; ${maxedAges.map((a) => (Number.isFinite(a) ? a : '–')).join(' ')})`,
        `climb: first Great Houses season ${f1(median(greatSeasons))} (median; ${greatSeasons.map((a) => (Number.isFinite(a) ? a : '–')).join(' ')}); there by the third season in ${pct(early)}`,
        `ageing: peak stars ${f2(median(peak))}, at 34 ${f2(median(at34))} (fade ${f2(median(fade))})`,
      );
      const inside = (x: number, [lo, hi]: readonly [number, number]) => x >= lo && x <= hi;
      if (!inside(median(maxedAges), TARGETS.maxedAge))
        failures.push(`near-maxed at ${f1(median(maxedAges))}`);
      if (!inside(median(greatSeasons), TARGETS.greatHousesSeason))
        failures.push(`Great Houses in season ${f1(median(greatSeasons))}`);
      // Past the bar by more than the sample's standard error: eleven careers measure a share to about ±15%.
      const shareSe = Math.sqrt((TARGETS.earlyGreatHouses * (1 - TARGETS.earlyGreatHouses)) / runs.length);
      if (early - shareSe > TARGETS.earlyGreatHouses)
        failures.push(`${pct(early)} in the Great Houses by season 3`);
      if (SEASONS >= 18) {
        if (!inside(median(fade), TARGETS.fadeAt34)) failures.push(`stars fade by ${f2(median(fade))} at 34`);
        if (!(median(at34) >= TARGETS.starsAt34)) failures.push(`stars at 34 ${f2(median(at34))}`);
      }

      // Playing time: how often he plays (starts or comes on), overall, by division and by form, and the hook.
      const plays = runs.flatMap((r) => r.plays);
      const played = (p: PlayRow) => p.started || p.cameOn;
      const rate = (rows: readonly PlayRow[], f: (p: PlayRow) => boolean) =>
        rows.length ? rows.filter(f).length / rows.length : NaN;
      const line = (name: string, rows: readonly PlayRow[]) =>
        `  ${name.padEnd(26)} ${String(rows.length).padStart(5)} matches: plays ${pct(rate(rows, played)).padStart(4)}, starts ${pct(rate(rows, (p) => p.started)).padStart(4)}, on from the bench ${pct(rate(rows, (p) => p.cameOn)).padStart(3)} (of benched ${pct(
          rate(
            rows.filter((p) => !p.started),
            (p) => p.cameOn,
          ),
        )}), off ${pct(rate(rows, (p) => p.subbedOff))}`;
      const formBins = [
        ['form below -0.4 tiers', (f: number) => f < -0.4],
        ['form -0.4 to -0.15', (f: number) => f >= -0.4 && f < -0.15],
        ['form -0.15 to +0.15', (f: number) => f >= -0.15 && f <= 0.15],
        ['form above +0.15', (f: number) => f > 0.15],
      ] as const;
      // Careers by their mean form reading: the worst quarter is "poor form" in the round.
      const careerForm = runs
        .map((r) => ({ r, form: mean(r.plays.map((p) => p.form)) }))
        .sort((a, b) => a.form - b.form);
      const quarter = Math.max(1, Math.round(careerForm.length / 4));
      const worst = careerForm.slice(0, quarter).flatMap((x) => x.r.plays);
      const best = careerForm.slice(-quarter).flatMap((x) => x.r.plays);
      const poor = plays.filter((p) => p.form < -0.15);
      const good = plays.filter((p) => p.form > 0.15);
      lines.push(
        '',
        'playing time (every match of his club):',
        line('all', plays),
        ...DIVISIONS.map((d) =>
          line(
            `division ${d}`,
            plays.filter((p) => p.division === d),
          ),
        ),
        ...formBins.map(([name, f]) =>
          line(
            name,
            plays.filter((p) => f(p.form)),
          ),
        ),
        line(`worst-form quarter of careers`, worst),
        line(`best-form quarter of careers`, best),
      );
      const live = plays.map((p) => p.judged).filter((x): x is number => x !== null);
      const sd = Math.sqrt(mean(live.map((x) => (x - mean(live)) ** 2)));
      const hooked = plays.filter((p) => p.subbedOff);
      lines.push(
        `  live rating at the hour (${live.length} starts): mean ${f2(mean(live))}, sd ${f2(sd)}; hook (under ${HOOK_RATING}) ${pct(
          rate(
            plays.filter((p) => p.judged !== null),
            (p) => (p.judged ?? 10) < HOOK_RATING,
          ),
        )}, ` +
          `under 5 ${pct(live.filter((x) => x < 5).length / live.length)}, under 6 ${pct(live.filter((x) => x < 6).length / live.length)}; hooked knights' final rating ${f2(mean(hooked.map((p) => p.rating ?? NaN)))}`,
      );
      if (!(rate(poor, played) >= TARGETS.poorFormPlays))
        failures.push(`plays ${pct(rate(poor, played))} of matches in poor form`);
      if (!(rate(worst, played) >= TARGETS.poorFormPlays))
        failures.push(`plays ${pct(rate(worst, played))} of matches in the worst-form careers`);
      if (!(rate(good, (p) => p.started) >= TARGETS.goodFormStarts))
        failures.push(`starts ${pct(rate(good, (p) => p.started))} of matches in good form`);
      if (!(rate(plays, (p) => p.started) <= TARGETS.startsAtMost))
        failures.push(
          `starts ${pct(rate(plays, (p) => p.started))} of all matches: selection no longer bites`,
        );
      if (!(rate(plays, (p) => p.subbedOff) <= TARGETS.hookedAtMost))
        failures.push(`taken off in ${pct(rate(plays, (p) => p.subbedOff))} of matches`);

      // The world: each division's strength stays near its tier, in order, season after season.
      lines.push('', 'world: mean club level by division (best four), every fourth season');
      for (let s = 0; s < SEASONS; s++) {
        const levels = DIVISIONS.map((d) => runs.map((r) => r.world[s]?.levels[d] ?? NaN));
        const means = levels.map(mean);
        if (s % 4 === 0 || s === SEASONS - 1)
          lines.push(
            `  season ${String(s + 1).padStart(2)}: ${DIVISIONS.map((d) => `${f2(means[d] ?? NaN)} [${f2(Math.min(...(levels[d] ?? [])))}–${f2(Math.max(...(levels[d] ?? [])))}]`).join('  ')}`,
          );
        for (const d of DIVISIONS)
          for (const level of levels[d] ?? [])
            if (Math.abs(level - DIVISION_TIER[d] - 0.4) > TARGETS.levelBand)
              failures.push(`season ${s + 1}: division ${d} at level ${f2(level)}`);
      }

      // The royal call and knockout: how often a career is called, and how far the royal four go.
      const seasonsAll = runs.flatMap((r) => r.seasons);
      const called = seasonsAll.filter((x) => x.royalPlayed > 0);
      const roundRates = ROYAL_RIVAL_TIERS.map((_, i) => {
        const reached = called.filter((x) => x.royalPlayed > i);
        return `round ${i + 1} ${reached.filter((x) => x.royalWon > i).length}/${reached.length}`;
      });
      const crowned = runs.filter((r) => r.seasons.some((x) => x.honours.includes('royalCrown'))).length;
      lines.push(
        '',
        `royal: called in ${called.length} of ${seasonsAll.length} seasons (${runs.filter((r) => r.seasons.some((x) => x.royalPlayed > 0)).length} of ${runs.length} careers); won ${roundRates.join(', ')}; ` +
          `crowned ${called.filter((x) => x.honours.includes('royalCrown')).length} times, in ${crowned} careers`,
      );

      // By his stars that season: how often the call comes, and how often the crown follows it.
      for (const [name, lo, hi] of [
        ['under 3.5', 0, 3.5],
        ['3.5 to 3.9', 3.5, 3.9],
        ['3.9 and up', 3.9, 9],
      ] as const) {
        const rows = seasonsAll.filter((x) => x.stars >= lo && x.stars < hi && x.division === 2);
        const calls = rows.filter((x) => x.royalPlayed > 0);
        lines.push(
          `  stars ${name.padEnd(10)} (${String(rows.length).padStart(3)} Great Houses seasons): called ${pct(rate2(calls.length, rows.length))}, ` +
            `crowned in ${calls.filter((x) => x.honours.includes('royalCrown')).length} of ${calls.length} calls, rounds won ${calls.reduce((t, x) => t + x.royalWon, 0)} of ${calls.reduce((t, x) => t + x.royalPlayed, 0)}`,
        );
      }

      // The form model, refitted on these careers' starts against the frozen one: par and the lean on his stars over the
      // rivals as frozen (keepers: par alone), then whether anything left out of it (his teammates) clearly matters.
      const rowsOf = (keeper: boolean) => runs.flatMap((r) => r.matches).filter((m) => m.keeper === keeper);
      const fit = (keeper: boolean, mates: boolean) => {
        const rows = rowsOf(keeper);
        const x = (m: MatchRow) => [1, ...(keeper ? [] : [m.gap]), ...(mates ? [m.mates] : [])];
        return {
          n: rows.length,
          ...ols(
            rows.map(x),
            rows.map((m) => m.rating),
          ),
        };
      };
      const out = fit(false, false);
      const gk = fit(true, false);
      const outMates = fit(false, true);
      const gkMates = fit(true, true);
      const frozen = RATING_FIT;
      const ci = (f: typeof out, i: number) => `${f2(f.b[i] ?? NaN)} ± ${f2(2 * (f.se[i] ?? 0))}`;
      lines.push(
        '',
        `form fit, outfield (${out.n} starts): par ${ci(out, 0)} + ${ci(out, 1)} a tier of stars over the rivals, sd ${f2(out.sd)}; ` +
          `a tier of teammates ${ci(outMates, 2)} (frozen par ${frozen.outfield.par} + ${frozen.outfield.perTier}, sd ${frozen.outfield.sd})`,
        `form fit, keeper (${gk.n} starts): par ${ci(gk, 0)}, sd ${f2(gk.sd)}; a tier of teammates ${ci(gkMates, 1)} ` +
          `(frozen par ${frozen.gk.par}, sd ${frozen.gk.sd})`,
      );
      const near = (name: string, value: number, fitted: number | undefined, se: number | undefined) => {
        if (fitted === undefined || se === undefined || Math.abs(value - fitted) > 2 * se + 0.02)
          failures.push(
            `form fit ${name}: frozen ${value}, fitted ${f2(fitted ?? NaN)} ± ${f2(2 * (se ?? 0))}`,
          );
      };
      // A term the model leaves out is safe to leave out while it is clearly small: at most LEAN beyond 2 SE.
      const flat = (name: string, fitted: number | undefined, se: number | undefined) => {
        if (fitted === undefined || se === undefined || Math.abs(fitted) - 2 * se > LEAN)
          failures.push(`ratings lean on ${name}: ${f2(fitted ?? NaN)} ± ${f2(2 * (se ?? 0))}`);
      };
      if (out.n >= 100) {
        near('outfield par', frozen.outfield.par, out.b[0], out.se[0]);
        near('outfield lean on stars', frozen.outfield.perTier, out.b[1], out.se[1]);
        flat('outfield teammates', outMates.b[2], outMates.se[2]);
        if (Math.abs(out.sd - frozen.outfield.sd) > 0.1)
          failures.push(`outfield rating sd ${f2(out.sd)}, frozen ${frozen.outfield.sd}`);
      }
      if (gk.n >= 100) {
        near('keeper par', frozen.gk.par, gk.b[0], gk.se[0]);
        flat('keeper teammates', gkMates.b[1], gkMates.se[1]);
        if (Math.abs(gk.sd - frozen.gk.sd) > 0.1)
          failures.push(`keeper rating sd ${f2(gk.sd)}, frozen ${frozen.gk.sd}`);
      }

      lines.push(
        '',
        failures.length ? `FAILED:\n  ${[...new Set(failures)].join('\n  ')}` : 'All checks passed.',
      );
      console.log(lines.join('\n'));
      expect(failures).toEqual([]);
    },
    CAREER_TIMEOUT,
  );
