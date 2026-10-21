import { DEFAULT_TACTICS, type Tactics } from '../../ai/tactics';
import { ROLES_BY_SIZE } from '../../game/formation';
import type { KnightSpec } from '../../game/match';
import type { Role } from '../../game/types';
import type { Look } from '../../knight/look';
import { MAX_RATING, MIN_RATING, type MatchRatings } from '../../stats/ratings';
import { SUBS_ALLOWED, type FixtureConfig, type GoalLog, type Manager, type TimedAction } from '../runner';
import {
  applyPick,
  autoPick,
  DRAFT_HOUSES,
  houseOnTheClock,
  isDraftComplete,
  normalizeDraft,
  runRivalPicks,
  squadOf,
  startDraft,
  type DraftState,
} from './draft';
import {
  createLeague,
  currentMatchday,
  fixtures,
  FIXTURES_PER_MATCHDAY,
  fixtureSeed,
  MATCHDAYS,
  normalizeLeague,
  recordResult,
  type LeagueFixture,
  type LeagueState,
  type Score,
} from './league';
import {
  afterMatchday,
  chooseLineup,
  createRivalManager,
  freshStamina,
  squadKnightSpec,
  STAMINA_MAX,
  type Lineup,
  type RivalManager,
  type Stamina,
  type Substitution,
} from './stamina';
import { HOUSE_STYLES, STARTERS, type HouseStyle, type SquadKnight } from './types';

const ROLES = ROLES_BY_SIZE[4];

/** The player's team sheet: who starts in each role, and how the team plays from kick-off. */
export interface PlayerPlan {
  /** Squad ids of the keeper, defender, midfielder and forward. */
  readonly starters: readonly string[];
  readonly tactics: Tactics;
}

/** A goal in a league fixture: the side it counted for (0 home, 1 away) and the squad id of the knight
 * who put it in, null if nobody touched it. An own goal's scorer plays for the other side. */
export interface FixtureGoal {
  readonly side: 0 | 1;
  readonly scorer: string | null;
  readonly ownGoal: boolean;
}

/** A knight's match rating to one decimal (enough for a 3–10 scale), and the position he played longest.
 * A pair rather than an object: a season saves about 500 of them. */
export type FixtureRating = readonly [rating: number, role: Role];

/** What happened in one played fixture beyond its score; later stats hang off the same record. */
export interface FixtureRecord {
  readonly goals: readonly FixtureGoal[];
  /** Everyone who played, substitutes included, by squad id. */
  readonly ratings: Readonly<Record<string, FixtureRating>>;
  /** The man of the match, by squad id. */
  readonly motm: string;
}

/** A Manager mode season: the draft, then the league once the draft is done. */
export interface SeasonState {
  readonly draft: DraftState;
  readonly league: LeagueState | null;
  /** A record per fixture, laid out like the league's results; null until played, empty before the league. */
  readonly records: readonly (readonly (FixtureRecord | null)[])[];
  /** Stamina of every drafted knight, by house then squad id; empty until the league starts. */
  readonly stamina: Readonly<Record<string, Stamina>>;
  readonly plan: PlayerPlan | null;
  /** Set once a finished season's title, if won, has been added to the player's honours. */
  readonly titleCounted: boolean;
}

/** How the player's team sheet is first filled in, before they change anything. */
const PLAYER_STYLE: HouseStyle = { draft: 'balanced', tactics: DEFAULT_TACTICS };

export function startSeason(seed: number, playerHouse: string, forged: Look): SeasonState {
  return {
    draft: runRivalPicks(startDraft(seed, playerHouse, forged)),
    league: null,
    records: [],
    stamina: {},
    plan: null,
    titleCounted: false,
  };
}

const emptyRecords = (): (FixtureRecord | null)[][] =>
  Array.from({ length: MATCHDAYS }, () => Array.from({ length: FIXTURES_PER_MATCHDAY }, () => null));

/** The rival houses pick until it is the player's turn again; the league starts once the draft is done. */
function afterPlayerPick(season: SeasonState, draft: DraftState): SeasonState {
  const next = runRivalPicks(draft);
  return isDraftComplete(next) ? beginLeague({ ...season, draft: next }) : { ...season, draft: next };
}

export const draftKnight = (season: SeasonState, knightId: string): SeasonState =>
  afterPlayerPick(season, applyPick(season.draft, season.draft.playerHouse, knightId));

export const autoDraft = (season: SeasonState): SeasonState =>
  afterPlayerPick(season, autoPick(season.draft));

function beginLeague(season: SeasonState): SeasonState {
  const { seed, playerHouse } = season.draft;
  const league = createLeague({ seed, playerHouse }, DRAFT_HOUSES);
  const stamina = Object.fromEntries(DRAFT_HOUSES.map((h) => [h, freshStamina(squadOf(season.draft, h))]));
  const started: SeasonState = { ...season, league, records: emptyRecords(), stamina };
  const lineup = chooseLineup(
    squadOf(season.draft, playerHouse),
    stamina[playerHouse] ?? {},
    PLAYER_STYLE,
    MATCHDAYS,
  );
  return {
    ...started,
    plan: { starters: lineup.starters.map((s) => s.knight.id), tactics: DEFAULT_TACTICS },
  };
}

export const isPlayersPick = (season: SeasonState): boolean =>
  houseOnTheClock(season.draft) === season.draft.playerHouse;

export const knightStamina = (season: SeasonState, house: string, id: string): number =>
  season.stamina[house]?.[id] ?? STAMINA_MAX;

const matchdaysLeft = (league: LeagueState): number => MATCHDAYS - currentMatchday(league);

/** The player's line-up from their plan; the bench lists the strongest first. */
export function playerLineup(season: SeasonState): Lineup {
  const squad = squadOf(season.draft, season.draft.playerHouse);
  const ids = season.plan?.starters ?? [];
  const starters = ids.map((id, i) => {
    const knight = squad.find((k) => k.id === id);
    const role = ROLES[i];
    if (!knight || !role) throw new Error('The team sheet names a knight who is not in the squad');
    return { knight, role };
  });
  const bench = squad.filter((k) => !ids.includes(k.id)).sort((a, b) => b.tier - a.tier);
  return { starters, bench };
}

/** Changes the player's team sheet; refuses anything but four different knights from their squad. */
export function setPlan(season: SeasonState, plan: PlayerPlan): SeasonState {
  const squad = squadOf(season.draft, season.draft.playerHouse);
  const valid =
    plan.starters.length === STARTERS &&
    new Set(plan.starters).size === STARTERS &&
    plan.starters.every((id) => squad.some((k) => k.id === id));
  if (!valid) throw new Error(`A team sheet needs ${STARTERS} different knights from the squad`);
  return { ...season, plan };
}

/** One side of a match as the runner sees it, and what's needed to charge its stamina afterwards. */
interface Side {
  readonly house: string;
  readonly lineup: Lineup;
  readonly specs: readonly KnightSpec[];
  readonly bench: readonly KnightSpec[];
  readonly tactics: Tactics;
  /** Rival houses only: a fresh touchline manager for each kick-off. */
  readonly manager: (() => RivalManager) | null;
}

function sideOf(season: SeasonState, league: LeagueState, house: string): Side {
  const player = house === season.draft.playerHouse;
  const style = HOUSE_STYLES[house] ?? PLAYER_STYLE;
  const lineup = player
    ? playerLineup(season)
    : chooseLineup(squadOf(season.draft, house), season.stamina[house] ?? {}, style, matchdaysLeft(league));
  const spec = (knight: SquadKnight, role: KnightSpec['role']): KnightSpec =>
    squadKnightSpec(knight, knightStamina(season, house, knight.id), role);
  const specs = lineup.starters.map((s) => spec(s.knight, s.role));
  const bench = lineup.bench.map((k) => spec(k, 'mid'));
  const manager = player
    ? null
    : () =>
        createRivalManager({
          style,
          starters: lineup.starters.map((s) => knightStamina(season, house, s.knight.id)),
          bench: lineup.bench.map((k, i) => ({
            spec: bench[i] ?? spec(k, 'mid'),
            stamina: knightStamina(season, house, k.id),
          })),
          matchdaysLeft: matchdaysLeft(league),
        });
  return {
    house,
    lineup,
    specs,
    bench,
    tactics: player ? (season.plan?.tactics ?? DEFAULT_TACTICS) : style.tactics,
    manager,
  };
}

/** How a match went, as the runner reports it at full time. */
export interface MatchOutcome {
  /** Goals for the left side (team 0), then the right. */
  readonly score: Score;
  readonly steps: number;
  /** Changes made from the player's dugout; rival managers report their own. */
  readonly timeline: readonly TimedAction[];
  /** Every goal with the runner knight credited, as `MatchRunner.goals` logs them. */
  readonly goals: readonly GoalLog[];
  /** Every knight's rating by runner id, as `rateMatch(runner.stats)` gives them. */
  readonly ratings: MatchRatings;
}

/** Everything needed to play one league fixture, watched or headless, and to record it afterwards. */
export interface MatchPlan {
  readonly fixture: LeagueFixture;
  /** House ids on the left (team 0) and right; the player is always on the left of their own match. */
  readonly sides: readonly [Side, Side];
  /** A fresh runner config, with fresh rival managers, for every kick-off. */
  config(): FixtureConfig;
  finish(season: SeasonState, outcome: MatchOutcome): SeasonState;
}

export function planMatch(season: SeasonState, fixture: LeagueFixture): MatchPlan {
  const { league } = season;
  if (!league) throw new Error('The league has not started');
  const playerAway = fixture.away === season.draft.playerHouse;
  const left = sideOf(season, league, playerAway ? fixture.away : fixture.home);
  const right = sideOf(season, league, playerAway ? fixture.home : fixture.away);
  let managers: readonly [RivalManager | null, RivalManager | null] = [null, null];

  return {
    fixture,
    sides: [left, right],
    config() {
      managers = [left.manager?.() ?? null, right.manager?.() ?? null];
      return {
        home: left.specs,
        away: right.specs,
        seed: fixtureSeed(league.seed, fixture.matchday, fixture.index),
        tactics: [left.tactics, right.tactics],
        draws: true,
        managers: [managers[0]?.manage ?? null, managers[1]?.manage ?? null] as const satisfies readonly [
          Manager | null,
          Manager | null,
        ],
      };
    },
    finish(current, outcome) {
      if (!current.league) throw new Error('The league has not started');
      const [l, r] = outcome.score;
      const score: Score = playerAway ? [r, l] : [l, r];
      const subs = [
        substitutionOf(left, managers[0], outcome, 0),
        substitutionOf(right, managers[1], outcome, 1),
      ] as const;
      const charge = (side: Side, team: 0 | 1): Stamina => {
        const play = {
          starters: side.lineup.starters.map((s) => s.knight.id),
          substitution: subs[team],
          matchSteps: outcome.steps,
        };
        return afterMatchday(current.stamina[side.house] ?? {}, play);
      };
      const ids = runnerSquadIds([left.lineup, right.lineup], subs);
      const record: FixtureRecord = {
        goals: fixtureGoals(ids, outcome.goals, playerAway),
        ...fixtureRatings(ids, outcome.ratings),
      };
      return {
        ...current,
        league: recordResult(current.league, fixture.matchday, fixture.index, score),
        records: current.records.map((day, d) =>
          d === fixture.matchday ? day.map((r, i) => (i === fixture.index ? record : r)) : day,
        ),
        stamina: { ...current.stamina, [left.house]: charge(left, 0), [right.house]: charge(right, 1) },
      };
    },
  };
}

/** The side's one substitution in squad ids: from its rival manager, or from the player's dugout. */
function substitutionOf(
  side: Side,
  manager: RivalManager | null,
  outcome: MatchOutcome,
  team: 0 | 1,
): Substitution | null {
  const ids = side.lineup.starters.map((s) => s.knight.id);
  if (manager) {
    const sub = manager.substitution();
    const offId = sub && ids[sub.offSlot];
    const onId = sub && side.lineup.bench[sub.benchSlot]?.id;
    return sub && offId && onId ? { offId, onId, step: sub.step } : null;
  }
  for (const { team: t, action, step } of outcome.timeline) {
    if (t !== team || action.kind !== 'substitution') continue;
    // The left side's starters are runner knights 0–3, in line-up order.
    const offId = ids[action.offId];
    const onId = side.lineup.bench.find((k) => k.look.name === action.on.look.name)?.id;
    if (offId && onId) return { offId, onId, step };
  }
  return null;
}

/**
 * Squad ids by runner knight id. The left side's starters are runner knights 0–3 and the right's 4–7, in
 * line-up order; each substitute takes the next free id, so subs are numbered in the order they came on
 * (by step, the left side first within a step, as the runner applies them).
 */
export function runnerSquadIds(
  lineups: readonly [Lineup, Lineup],
  subs: readonly [Substitution | null, Substitution | null],
): Map<number, string> {
  const starters = lineups.flatMap((l) => l.starters.map((s) => s.knight.id));
  const ids = new Map(starters.map((id, runnerId) => [runnerId, id]));
  const cameOn = subs
    .flatMap((sub, team) => (sub ? [{ ...sub, team }] : []))
    .sort((a, b) => a.step - b.step || a.team - b.team);
  for (const [i, sub] of cameOn.entries()) ids.set(starters.length + i, sub.onId);
  return ids;
}

/** The runner's goal log in squad ids, sides turned to home and away. */
function fixtureGoals(
  ids: ReadonlyMap<number, string>,
  log: readonly GoalLog[],
  playerAway: boolean,
): FixtureGoal[] {
  return log.map((goal) => ({
    side: (playerAway ? 1 - goal.team : goal.team) as 0 | 1,
    scorer: goal.scorerId === null ? null : (ids.get(goal.scorerId) ?? null),
    ownGoal: goal.ownGoal,
  }));
}

export const roundRating = (rating: number): number => Math.round(rating * 10) / 10;

/** The runner's ratings in squad ids, rounded for the save. Every knight who played has a squad id. */
function fixtureRatings(
  ids: ReadonlyMap<number, string>,
  ratings: MatchRatings,
): Pick<FixtureRecord, 'ratings' | 'motm'> {
  const squadId = (runnerId: number): string => {
    const id = ids.get(runnerId);
    if (id === undefined) throw new Error(`Runner knight ${String(runnerId)} has no squad id`);
    return id;
  };
  const rated = ratings.knights.map((k) => [squadId(k.id), [roundRating(k.rating), k.role]]);
  if (ratings.motm === null) throw new Error('A played fixture always has a man of the match');
  return { ratings: Object.fromEntries(rated) as Record<string, FixtureRating>, motm: squadId(ratings.motm) };
}

/** One row of the league's scoring chart. */
export interface ScorerRow {
  readonly knight: SquadKnight;
  readonly house: string;
  readonly goals: number;
}

/** Every knight with a league goal, most first; ties go alphabetically by name, then squad id. Own goals
 * and goals nobody touched count for nobody. */
export function topScorers(season: SeasonState): ScorerRow[] {
  const goals = new Map<string, number>();
  for (const goal of season.records.flat().flatMap((r) => r?.goals ?? []))
    if (goal.scorer !== null && !goal.ownGoal) goals.set(goal.scorer, (goals.get(goal.scorer) ?? 0) + 1);
  const rows = DRAFT_HOUSES.flatMap((house) =>
    squadOf(season.draft, house).map((knight) => ({ knight, house, goals: goals.get(knight.id) ?? 0 })),
  );
  return rows
    .filter((r) => r.goals > 0)
    .sort(
      (a, b) =>
        b.goals - a.goals ||
        a.knight.look.name.localeCompare(b.knight.look.name) ||
        a.knight.id.localeCompare(b.knight.id),
    );
}

/** The fixtures of the current matchday not involving the player, once the player's match is in. */
export function otherFixtures(season: SeasonState): LeagueFixture[] {
  const { league } = season;
  if (!league || matchdaysLeft(league) === 0) return [];
  const all = fixtures(league, currentMatchday(league));
  const mine = all.find((f) => f.home === season.draft.playerHouse || f.away === season.draft.playerHouse);
  return mine?.score ? all.filter((f) => !f.score) : [];
}

const TACTIC_VALUES = {
  press: ['low', 'mid', 'high'],
  shooting: ['patient', 'normal', 'early'],
} as const;

function normalizeTactics(raw: unknown): Tactics | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { press, shooting } = raw as Record<string, unknown>;
  const isOne = <T extends string>(options: readonly T[], value: unknown): value is T =>
    typeof value === 'string' && (options as readonly string[]).includes(value);
  return isOne(TACTIC_VALUES.press, press) && isOne(TACTIC_VALUES.shooting, shooting)
    ? { press, shooting }
    : null;
}

function normalizeGoal(raw: unknown): FixtureGoal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { side, scorer, ownGoal } = raw as Record<string, unknown>;
  if ((side !== 0 && side !== 1) || typeof ownGoal !== 'boolean') return null;
  return scorer === null || typeof scorer === 'string' ? { side, scorer, ownGoal } : null;
}

const RATED_ROLES: readonly string[] = ROLES;

function normalizeRating(raw: unknown): FixtureRating | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [rating, role] = raw as unknown[];
  const fits = typeof rating === 'number' && rating >= MIN_RATING && rating <= MAX_RATING;
  return fits && typeof role === 'string' && RATED_ROLES.includes(role)
    ? [roundRating(rating), role as Role]
    : null;
}

/** Ratings for each side's four starters and at most its substitutes, all from the two squads. */
function normalizeRatings(
  raw: unknown,
  squads: readonly (readonly SquadKnight[])[],
): Record<string, FixtureRating> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>).map(
    ([id, r]) => [id, normalizeRating(r)] as const,
  );
  if (!entries.every((e): e is readonly [string, FixtureRating] => e[1] !== null)) return null;
  const sideOf = (id: string): number => squads.findIndex((squad) => squad.some((k) => k.id === id));
  if (entries.some(([id]) => sideOf(id) < 0)) return null;
  const counts = [0, 1].map((side) => entries.filter(([id]) => sideOf(id) === side).length);
  const full = counts.every((n) => n >= STARTERS && n <= STARTERS + SUBS_ALLOWED);
  return full ? Object.fromEntries(entries) : null;
}

/** A played fixture's record, or null unless every goal is by a knight on the right side (the other
 * side's for an own goal) who played, neither side has more goals logged than it scored, and everyone
 * who played is rated, the man of the match among them. */
function normalizeRecord(raw: unknown, draft: DraftState, fixture: LeagueFixture): FixtureRecord | null {
  const score = fixture.score;
  const source = raw as Record<string, unknown> | null;
  const goals = source?.goals;
  if (!score || !Array.isArray(goals)) return null;
  const read = goals.map(normalizeGoal);
  if (!read.every((g): g is FixtureGoal => g !== null)) return null;
  const squads = [squadOf(draft, fixture.home), squadOf(draft, fixture.away)];
  const ratings = normalizeRatings(source?.ratings, squads);
  const motm = source?.motm;
  if (!ratings || typeof motm !== 'string' || !(motm in ratings)) return null;
  const fits = (g: FixtureGoal): boolean =>
    g.scorer === null ||
    ((squads[g.ownGoal ? 1 - g.side : g.side] ?? []).some((k) => k.id === g.scorer) && g.scorer in ratings);
  const within = ([0, 1] as const).every((side) => read.filter((g) => g.side === side).length <= score[side]);
  return read.every(fits) && within ? { goals: read, ratings, motm } : null;
}

function normalizeRecords(
  raw: unknown,
  draft: DraftState,
  league: LeagueState,
): SeasonState['records'] | null {
  if (!Array.isArray(raw) || raw.length !== MATCHDAYS) return null;
  const records = emptyRecords();
  for (let matchday = 0; matchday < MATCHDAYS; matchday++) {
    const day: unknown = raw[matchday];
    if (!Array.isArray(day) || day.length !== FIXTURES_PER_MATCHDAY) return null;
    for (const fixture of fixtures(league, matchday)) {
      const saved: unknown = day[fixture.index];
      // A record exactly where the league has a score: an unplayed fixture has none.
      if (!fixture.score) {
        if (saved !== null) return null;
        continue;
      }
      const record = normalizeRecord(saved, draft, fixture);
      if (!record) return null;
      (records[matchday] ?? [])[fixture.index] = record;
    }
  }
  return records;
}

/** Reads a saved season, or null for anything that isn't a real draft, league and squads that fit together. */
export function normalizeSeason(raw: unknown): SeasonState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const draft = normalizeDraft(source.draft);
  if (!draft) return null;
  if (!isDraftComplete(draft))
    return { draft, league: null, records: [], stamina: {}, plan: null, titleCounted: false };

  const league = normalizeLeague(source.league, DRAFT_HOUSES);
  if (league?.seed !== draft.seed || league.playerHouse !== draft.playerHouse) return null;
  const records = normalizeRecords(source.records, draft, league);
  if (!records) return null;
  const rawStamina = source.stamina;
  if (typeof rawStamina !== 'object' || rawStamina === null) return null;
  const stamina: Record<string, Stamina> = {};
  for (const house of DRAFT_HOUSES) {
    const saved = (rawStamina as Record<string, unknown>)[house];
    if (typeof saved !== 'object' || saved === null) return null;
    const entries = squadOf(draft, house).map(
      (k) => [k.id, (saved as Record<string, unknown>)[k.id]] as const,
    );
    if (!entries.every(([, s]) => typeof s === 'number' && s >= 0 && s <= STAMINA_MAX)) return null;
    stamina[house] = Object.fromEntries(entries) as Stamina;
  }

  const plan = source.plan as Record<string, unknown> | null | undefined;
  const tactics = normalizeTactics(plan?.tactics);
  const starters = plan?.starters;
  if (!tactics || !Array.isArray(starters) || !starters.every((id): id is string => typeof id === 'string'))
    return null;
  try {
    const titleCounted = source.titleCounted === true;
    return setPlan({ draft, league, records, stamina, plan: null, titleCounted }, { starters, tactics });
  } catch {
    return null;
  }
}
