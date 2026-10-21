import { DEFAULT_TACTICS } from '../../ai/tactics';
import { NO_ATTRIBUTES, type Attribute, type Attributes } from '../../game/attributes';
import type { KnightSpec } from '../../game/match';
import { createRng } from '../../game/rng';
import type { Role } from '../../game/types';
import { clamp } from '../../game/vec';
import { randomLook, type Look } from '../../knight/look';
import { rateMatch } from '../../stats/ratings';
import type { MatchStats } from '../../stats/types';
import {
  createLeague,
  currentMatchday,
  fixtures,
  FIXTURES_PER_MATCHDAY,
  fixtureSeed,
  MATCHDAYS,
  recordResult,
  table,
  type LeagueFixture,
  type LeagueState,
  type Score,
} from '../manager/league';
import {
  afterMatchday,
  CHASING_SUB_AT,
  chooseLineup,
  clockGone,
  createRivalManager,
  freshStamina,
  leadOf,
  playingShares,
  REST_GAIN,
  PLAY_COST,
  squadKnightSpec,
  STAMINA_MAX,
  staminaFactor,
  SUB_AT,
  type Lineup,
  type RivalManager,
  type Stamina,
  type SubCall,
  type Substitution,
} from '../manager/stamina';
import { MatchRunner, type FixtureConfig, type Manager } from '../runner';
import {
  clubById,
  clubLevel,
  divisionOf,
  DIVISIONS,
  freshName,
  squadOfClub,
  startingWorld,
  takenWith,
  TOP_DIVISION,
  withoutName,
  type CareerKnight,
  type Division,
  type World,
} from './clubs';
import {
  age,
  guard,
  honourPoints,
  matchPoints,
  nextFame,
  train,
  TROPHY_MIN_APPS,
  type Honour,
  type Training,
} from './economy';
import {
  addForm,
  comesOn,
  expectedRating,
  formTiers,
  matchStrength,
  FORM_TIERS,
  selectPlayer,
  FORM_PRIOR,
  type FormEntry,
  type Selection,
} from './form';
import { fatigueFactor } from '../../game/attributes';
import { humanKnightSpec, overallStars, simKnightSpec } from './stars';
import { churn, promote } from './world';

export const CAREER_VERSION = 2;
export const START_AGE = 17;
export const POSITIONS: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];
/** The forged knight's squad id in every record. */
export const PLAYER_ID = 'forged';

/** A goal in a career fixture: the side it counted for (0 home, 1 away), who scored and who set it up, by squad
 * id (null if nobody touched it, or nobody set it up). An own goal's scorer plays for the other side. */
export interface CareerGoal {
  readonly side: 0 | 1;
  readonly scorer: string | null;
  readonly assist: string | null;
  readonly ownGoal: boolean;
}

/** A substitution in a career fixture: the side that made it (0 home, 1 away), who went off and who came on by squad
 * id, the minute on a 90-minute clock ("came on 62'"), and the share of the match gone, which their minutes follow. */
export interface CareerSub {
  readonly side: 0 | 1;
  readonly off: string;
  readonly on: string;
  readonly minute: number;
  readonly share: number;
}

/** A played fixture: its goals, every knight's rating (to 0.01) by squad id, the man of the match, and the changes
 * (at most one a side), in the order they were made. */
export interface FixtureRecord {
  readonly goals: readonly CareerGoal[];
  readonly ratings: Readonly<Record<string, number>>;
  readonly motm: string | null;
  readonly subs: readonly CareerSub[];
}

export interface CareerPlayer extends Training {
  readonly look: Look;
  readonly position: Role;
  readonly club: string;
  readonly fame: number;
  /** On the Manager mode scale, 0–100; his stamina stat slows how fast matches drain it. */
  readonly stamina: number;
  /** This season's ratings against his stars, newest last. */
  readonly form: readonly FormEntry[];
}

export interface CareerSeason {
  /** 0 for the first season. */
  readonly number: number;
  /** One league per division, Village League first, all on the same matchday. */
  readonly leagues: readonly LeagueState[];
  /** Per division, a record per fixture laid out like the league's results; null until played. */
  readonly records: readonly (readonly (readonly (FixtureRecord | null)[])[])[];
  /** Every club's knights' stamina, by club then squad id. */
  readonly stamina: Readonly<Record<string, Stamina>>;
  /** Points his matches have earned this season. */
  readonly points: number;
}

export interface Offer {
  readonly club: string;
  /** The division the club plays in next season. */
  readonly division: Division;
}

export interface RoyalMatch {
  readonly opponent: string;
  /** The royal side's goals, then the opponent's. */
  readonly score: Score;
  readonly rating: number;
  readonly goals: number;
  readonly motm: boolean;
}

export interface RoyalResult {
  /** The royal four by squad id, the forged knight first. */
  readonly squad: readonly string[];
  /** Knockout rounds played, until a defeat or the final. */
  readonly matches: readonly RoyalMatch[];
  readonly crowned: boolean;
}

/** One finished season, as the career history keeps it. */
export interface SeasonSummary {
  readonly season: number;
  readonly age: number;
  readonly club: string;
  readonly division: Division;
  readonly position: Role;
  /** His club's final place, 1 to 8. */
  readonly finish: number;
  /** Appearances, starting or from the bench; then those he started, came on in, and was taken off in. */
  readonly apps: number;
  readonly starts: number;
  readonly subOns: number;
  readonly subOffs: number;
  readonly goals: number;
  readonly assists: number;
  readonly motm: number;
  /** Mean match rating, null without an appearance. */
  readonly average: number | null;
  readonly matchPoints: number;
  readonly honourPoints: number;
  readonly honours: readonly Honour[];
  readonly relegated: boolean;
  /** Fame and stars at the season's end. */
  readonly fame: number;
  readonly stars: number;
  readonly attributes: Attributes;
  readonly offers: readonly string[];
}

/** What waits at a season's end: offers to answer, and the royal call-up if one came. */
export interface SeasonReview {
  readonly offers: readonly Offer[];
  readonly royal: RoyalResult | null;
}

export interface CareerState {
  readonly version: typeof CAREER_VERSION;
  readonly seed: number;
  readonly player: CareerPlayer;
  readonly world: World;
  readonly season: CareerSeason;
  /** Set once the season is over and its honours are in; cleared when the next one starts. */
  readonly review: SeasonReview | null;
  readonly history: readonly SeasonSummary[];
}

// Seeds ---------------------------------------------------------------------------------------------

/** An independent stream per season and use of the career seed. */
export const streamSeed = (seed: number, season: number, stream: number): number =>
  (Math.imul(seed ^ 0x27d4eb2d, 31) +
    Math.imul(season + 1, 0x9e3779b1) +
    Math.imul(stream + 1, 0x85ebca6b)) >>>
  0;

const STREAM = { start: 0, churn: 4, offers: 5, royal: 6 } as const;
/** Streams 1–3 draw each division's schedule. */
export const leagueSeed = (seed: number, season: number, division: Division): number =>
  streamSeed(seed, season, 1 + division);

// Starting and seasons ------------------------------------------------------------------------------

const emptyRecords = (): (FixtureRecord | null)[][][] =>
  DIVISIONS.map(() =>
    Array.from({ length: MATCHDAYS }, () => Array.from({ length: FIXTURES_PER_MATCHDAY }, () => null)),
  );

/** The league for one division: the player's club is its `playerHouse` where he plays, its first club elsewhere. */
export function leagueHost(clubs: readonly string[], playerClub: string): string {
  const host = clubs.includes(playerClub) ? playerClub : clubs[0];
  if (host === undefined) throw new Error('A division needs clubs');
  return host;
}

function createSeason(seed: number, number: number, world: World, playerClub: string): CareerSeason {
  const leagues = DIVISIONS.map((d) => {
    const clubs = world.divisions[d] ?? [];
    return createLeague(
      { seed: leagueSeed(seed, number, d), playerHouse: leagueHost(clubs, playerClub) },
      clubs,
    );
  });
  const stamina = Object.fromEntries(
    Object.entries(world.squads).map(([club, squad]) => [club, freshStamina(squad)]),
  );
  return { number, leagues, records: emptyRecords(), stamina, points: 0 };
}

export interface CareerStart {
  readonly seed: number;
  readonly look: Look;
  readonly position: Role;
  /** A Village League club; drawn from the seed if left out. */
  readonly club?: string;
}

export function startCareer(start: CareerStart): CareerState {
  const world = withoutName(startingWorld(), start.look.name);
  const village = world.divisions[0] ?? [];
  const club = start.club ?? createRng(streamSeed(start.seed, 0, STREAM.start)).pick(village);
  if (!village.includes(club)) throw new Error('A career starts at a Village League club');
  if (!POSITIONS.includes(start.position)) throw new Error(`No position ${start.position}`);
  const player: CareerPlayer = {
    look: start.look,
    position: start.position,
    club,
    age: START_AGE,
    points: 0,
    attributes: NO_ATTRIBUTES,
    wear: NO_ATTRIBUTES,
    guarded: [],
    fame: 0,
    stamina: STAMINA_MAX,
    form: [],
  };
  const seed = start.seed >>> 0;
  return {
    version: CAREER_VERSION,
    seed,
    player,
    world,
    season: createSeason(seed, 0, world, club),
    review: null,
    history: [],
  };
}

export const matchday = (career: CareerState): number =>
  Math.min(...career.season.leagues.map(currentMatchday));
export const isSeasonOver = (career: CareerState): boolean => matchday(career) === MATCHDAYS;
/** Matchdays counted across the career, for form. */
export const careerDay = (career: CareerState): number => career.season.number * MATCHDAYS + matchday(career);
export const playerDivision = (career: CareerState): Division => divisionOf(career.world, career.player.club);

export interface FixtureRef {
  readonly division: Division;
  readonly index: number;
}

function leagueOf(career: CareerState, division: Division): LeagueState {
  const league = career.season.leagues[division];
  if (!league) throw new Error(`No league for division ${division}`);
  return league;
}

export const fixtureAt = (
  career: CareerState,
  ref: FixtureRef,
  day: number = matchday(career),
): LeagueFixture => {
  const fixture = fixtures(leagueOf(career, ref.division), day)[ref.index];
  if (!fixture) throw new Error('No such fixture');
  return fixture;
};

const involves = (fixture: LeagueFixture, club: string): boolean =>
  fixture.home === club || fixture.away === club;

/** His club's fixture this matchday, null once the season is over. */
export function playerFixture(career: CareerState): FixtureRef | null {
  if (isSeasonOver(career)) return null;
  const division = playerDivision(career);
  const index = fixtures(leagueOf(career, division), matchday(career)).findIndex((f) =>
    involves(f, career.player.club),
  );
  return index < 0 ? null : { division, index };
}

/** This matchday's fixtures still to play, his club's first. */
export function pendingFixtures(career: CareerState): FixtureRef[] {
  if (isSeasonOver(career)) return [];
  const day = matchday(career);
  const refs = DIVISIONS.flatMap((division) =>
    fixtures(leagueOf(career, division), day)
      .filter((f) => !f.score)
      .map((f) => ({ division, index: f.index, mine: involves(f, career.player.club) })),
  );
  return [...refs.filter((r) => r.mine), ...refs.filter((r) => !r.mine)].map(({ division, index }) => ({
    division,
    index,
  }));
}

// Selection -----------------------------------------------------------------------------------------

const staminaOf = (career: CareerState, club: string, id: string): number =>
  career.season.stamina[club]?.[id] ?? STAMINA_MAX;

function clubLineup(career: CareerState, club: string): Lineup {
  return chooseLineup(
    squadOfClub(career.world, club),
    career.season.stamina[club] ?? {},
    clubById(club).style,
    MATCHDAYS - matchday(career),
  );
}

/** His manager's choice for this matchday: start him or not, and over whom. */
export function selection(career: CareerState): Selection {
  const { player } = career;
  const club = player.club;
  const lineup = clubLineup(career, club);
  const index = POSITIONS.indexOf(player.position);
  const incumbent = lineup.starters[index];
  if (!incumbent) throw new Error('A line-up needs four starters');
  return selectPlayer({
    role: player.position,
    strength: matchStrength(player.look.build, player.attributes),
    form: formTiers(player.form, careerDay(career)),
    stamina: player.stamina,
    attributes: player.attributes,
    lineup,
    style: clubById(club).style.draft,
    matchdaysLeft: MATCHDAYS - matchday(career),
    incumbentStamina: staminaOf(career, club, incumbent.knight.id),
  });
}

// Matches -------------------------------------------------------------------------------------------

/** Played: he controls his knight. Simmed: the sim's bot plays him at his stars. */
export type PlayMode = 'play' | 'sim';

interface SheetEntry {
  readonly id: string;
  readonly spec: KnightSpec;
  readonly tier: number;
  readonly stamina: number;
}

/** One side of a career fixture as the runner sees it. */
export interface Sheet {
  readonly club: string;
  /** Keeper, defender, midfielder, forward. */
  readonly starters: readonly SheetEntry[];
  readonly bench: readonly SheetEntry[];
  /** The forged knight's place in the starters, if he starts. */
  readonly playerSlot: number | null;
  /** His place on the bench, if he starts there: last, after the club's own substitutes. */
  readonly playerBench: number | null;
}

/** The forged knight as the runner gets him, slowed by tiredness like every other knight. */
export function playerSpec(player: CareerPlayer, mode: PlayMode): KnightSpec {
  const knight = { look: player.look, attributes: player.attributes };
  const spec =
    mode === 'play' ? humanKnightSpec(knight, player.position) : simKnightSpec(knight, player.position);
  return { ...spec, speedFactor: spec.speedFactor * staminaFactor(player.stamina) };
}

/** A club's side; at his club, `starts` puts him in his position, or else on the bench. */
function sheetOf(career: CareerState, club: string, mode: PlayMode, starts: boolean | null): Sheet {
  const lineup = clubLineup(career, club);
  const entry = (knight: CareerKnight, role: Role): SheetEntry => {
    const stamina = staminaOf(career, club, knight.id);
    return { id: knight.id, spec: squadKnightSpec(knight, stamina, role), tier: knight.tier, stamina };
  };
  const starters = lineup.starters.map((s) => entry(s.knight as CareerKnight, s.role));
  const bench = lineup.bench.map((k) => entry(k as CareerKnight, 'mid'));
  if (starts === null) return { club, starters, bench, playerSlot: null, playerBench: null };
  const { player } = career;
  const me: SheetEntry = {
    id: PLAYER_ID,
    spec: playerSpec(player, mode),
    tier: matchStrength(player.look.build, player.attributes),
    stamina: player.stamina,
  };
  if (!starts)
    return {
      club,
      starters,
      bench: [...bench, { ...me, spec: { ...me.spec, role: 'mid' } }],
      playerSlot: null,
      playerBench: bench.length,
    };
  const slot = POSITIONS.indexOf(player.position);
  const dropped = starters[slot];
  return {
    club,
    starters: starters.map((s, i) => (i === slot ? me : s)),
    bench: dropped ? [{ ...dropped, spec: { ...dropped.spec, role: 'mid' } }, ...bench] : bench,
    playerSlot: slot,
    playerBench: null,
  };
}

/** A starting forged knight rated under this at the hour comes off: 1.9 standard deviations below the live reading's
 * mean (6.86, sd 0.72 at the hour), half a point under the line where a match earns nothing. scripts/career.sim.ts
 * measures it firing in about 1 start in 100. */
export const HOOK_RATING = 5.5;

/** A club's touchline manager, and what it made of the forged knight. */
interface Touchline extends RivalManager {
  /** The share of the clock gone when the change was made, null without one. */
  gone(): number | null;
  /** His live rating when he was judged at the hour, null if he wasn't. */
  judged(): number | null;
}

/** His call on his club's one change, held for him until settled. Starting: judged live at the hour, when rivals
 * change, he makes way for the knight he displaced under HOOK_RATING. Benched: he comes on for the starter in his
 * position at the hour (from half-time when chasing) if `comesOn`. */
function forgedCall(
  sheet: Sheet,
  position: number,
  pick: Selection | null,
  judge: (r: number) => void,
): SubCall {
  let settled = sheet.playerSlot === null && sheet.playerBench === null;
  return (state, team, stats) => {
    if (settled) return null;
    const gone = clockGone(state);
    const slot = sheet.playerSlot;
    if (slot !== null) {
      if (gone < SUB_AT) return 'hold';
      settled = true;
      const id = state.knights.filter((k) => k.team === team)[slot]?.id;
      const rating = stats && rateMatch(stats()).knights.find((k) => k.id === id)?.rating;
      if (rating === undefined) return null;
      judge(rating);
      return rating < HOOK_RATING ? { offSlot: slot, benchSlot: 0 } : null;
    }
    const bench = sheet.playerBench;
    if (bench === null || gone < (leadOf(state, team) < 0 ? CHASING_SUB_AT : SUB_AT)) return 'hold';
    if (pick && comesOn(pick, 1 - gone)) {
      settled = true;
      return { offSlot: position, benchSlot: bench };
    }
    settled = gone >= SUB_AT;
    return settled ? null : 'hold';
  };
}

/** A club's touchline manager; at his club the change is his first (see forgedCall), and its own choice never takes him
 * off or brings him on. */
function managerFor(career: CareerState, sheet: Sheet, pick: Selection | null): Touchline {
  let judged: number | null = null;
  let gone: number | null = null;
  const inner = createRivalManager({
    style: clubById(sheet.club).style,
    starters: sheet.starters.map((s) => s.stamina),
    bench: sheet.bench.map((b) => ({ spec: b.spec, stamina: b.stamina })),
    matchdaysLeft: MATCHDAYS - matchday(career),
    first: forgedCall(sheet, POSITIONS.indexOf(career.player.position), pick, (r) => (judged = r)),
    exempt: {
      starters: sheet.playerSlot === null ? [] : [sheet.playerSlot],
      bench: sheet.playerBench === null ? [] : [sheet.playerBench],
    },
  });
  return {
    manage(state, team, stats) {
      const action = inner.manage(state, team, stats);
      if (action?.kind === 'substitution') gone = clockGone(state);
      return action;
    },
    substitution: () => inner.substitution(),
    gone: () => gone,
    judged: () => judged,
  };
}

/** How a career fixture went, as the runner reports it at full time; everything recorded follows from it. */
export interface CareerOutcome {
  readonly stats: MatchStats;
  /** The runner's step at full time. */
  readonly steps: number;
}

export interface FixturePlan {
  readonly ref: FixtureRef;
  readonly fixture: LeagueFixture;
  /** Left (team 0) and right; his club is always on the left of its own fixture. */
  readonly sheets: readonly [Sheet, Sheet];
  /** A fresh runner config, with fresh touchline managers, for every kick-off. */
  config(): FixtureConfig;
  /** The forged knight's live rating when his manager judged him at the hour of the last kick-off's match, null if he
   * wasn't on the pitch to judge (or it hasn't come). */
  judged(): number | null;
  finish(career: CareerState, outcome: CareerOutcome): CareerState;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Squad ids by runner id: left starters 0–3, right 4–7, then substitutes in the order they came on. */
function runnerIds(
  sheets: readonly [Sheet, Sheet],
  subs: readonly (Substitution | null)[],
): Map<number, string> {
  const starters = sheets.flatMap((s) => s.starters.map((e) => e.id));
  const ids = new Map(starters.map((id, runnerId) => [runnerId, id]));
  const cameOn = subs
    .flatMap((sub, team) => (sub ? [{ ...sub, team }] : []))
    .sort((a, b) => a.step - b.step || a.team - b.team);
  for (const [i, sub] of cameOn.entries()) ids.set(starters.length + i, sub.onId);
  return ids;
}

function substitutionOf(sheet: Sheet, manager: RivalManager | null): Substitution | null {
  const sub = manager?.substitution();
  const offId = sub && sheet.starters[sub.offSlot]?.id;
  const onId = sub && sheet.bench[sub.benchSlot]?.id;
  return sub && offId && onId ? { offId, onId, step: sub.step } : null;
}

/** A clock share as the match screen shows it: a full match reads as 90 minutes. */
const minuteOf = (gone: number): number => clamp(Math.ceil(gone * 90), 1, 90);

export function planFixture(career: CareerState, ref: FixtureRef, mode: PlayMode = 'sim'): FixturePlan {
  if (career.review) throw new Error('The season is over');
  const fixture = fixtureAt(career, ref);
  if (fixture.score) throw new Error('That fixture has been played');
  const mine = involves(fixture, career.player.club);
  const leftClub = mine ? career.player.club : fixture.home;
  const leftIsHome = fixture.home === leftClub;
  const pick = mine ? selection(career) : null;
  const sheets = [
    sheetOf(career, leftClub, mode, pick?.starts ?? null),
    sheetOf(career, leftIsHome ? fixture.away : fixture.home, mode, null),
  ] as const;
  const league = leagueOf(career, ref.division);
  let managers: readonly [Touchline | null, Touchline | null] = [null, null];

  return {
    ref,
    fixture,
    sheets,
    config() {
      managers = [managerFor(career, sheets[0], pick), managerFor(career, sheets[1], null)];
      return {
        home: sheets[0].starters.map((s) => s.spec),
        away: sheets[1].starters.map((s) => s.spec),
        seed: fixtureSeed(league.seed, fixture.matchday, fixture.index),
        tactics: [clubById(sheets[0].club).style.tactics, clubById(sheets[1].club).style.tactics],
        draws: true,
        managers: [managers[0]?.manage ?? null, managers[1]?.manage ?? null] as const satisfies readonly [
          Manager | null,
          Manager | null,
        ],
      };
    },
    judged: () => managers[0]?.judged() ?? null,
    finish(current, outcome) {
      const subs = [substitutionOf(sheets[0], managers[0]), substitutionOf(sheets[1], managers[1])] as const;
      const gone = [managers[0]?.gone() ?? null, managers[1]?.gone() ?? null] as const;
      return recordFixture(current, ref, fixtureRecord(sheets, subs, gone, outcome, leftIsHome), {
        sheets,
        steps: outcome.steps,
        subs,
        score: [outcome.stats.teams[0].goals, outcome.stats.teams[1].goals],
        leftIsHome,
      });
    },
  };
}

function fixtureRecord(
  sheets: readonly [Sheet, Sheet],
  subs: readonly [Substitution | null, Substitution | null],
  gone: readonly [number | null, number | null],
  outcome: CareerOutcome,
  leftIsHome: boolean,
): FixtureRecord {
  const ids = runnerIds(sheets, subs);
  const idOf = (runnerId: number | null): string | null =>
    runnerId === null ? null : (ids.get(runnerId) ?? null);
  const ratings = rateMatch(outcome.stats);
  const goals: CareerGoal[] = [];
  for (const a of outcome.stats.actions)
    if (a.kind === 'goal')
      goals.push({
        side: (leftIsHome ? a.team : 1 - a.team) as 0 | 1,
        scorer: idOf(a.knightId),
        assist: a.ownGoal ? null : idOf(a.assistId),
        ownGoal: a.ownGoal,
      });
  const rated: Record<string, number> = {};
  for (const k of ratings.knights) {
    const id = idOf(k.id);
    if (id) rated[id] = round2(k.rating);
  }
  const changes = subs
    .flatMap((sub, team) => (sub ? [{ sub, team }] : []))
    .sort((a, b) => a.sub.step - b.sub.step || a.team - b.team)
    .map(({ sub, team }): CareerSub => {
      const share = sub.step / outcome.steps;
      const side = (leftIsHome ? team : 1 - team) as 0 | 1;
      return { side, off: sub.offId, on: sub.onId, minute: minuteOf(gone[team] ?? share), share };
    });
  return { goals, ratings: rated, motm: idOf(ratings.motm), subs: changes };
}

/** What the match did to stamina and form, beyond the record itself. */
interface MatchEffects {
  readonly sheets: readonly [Sheet, Sheet];
  readonly steps: number;
  readonly subs: readonly [Substitution | null, Substitution | null];
  /** Left side's goals, then the right's. */
  readonly score: Score;
  readonly leftIsHome: boolean;
}

function recordFixture(
  career: CareerState,
  ref: FixtureRef,
  record: FixtureRecord,
  fx: MatchEffects,
): CareerState {
  const { season, player } = career;
  const fixture = fixtureAt(career, ref);
  const score: Score = fx.leftIsHome ? fx.score : [fx.score[1], fx.score[0]];
  const league = recordResult(leagueOf(career, ref.division), fixture.matchday, fixture.index, score);

  const stamina: Record<string, Stamina> = { ...season.stamina };
  let playerStamina = player.stamina;
  let share = 0;
  fx.sheets.forEach((sheet, team) => {
    const clubStamina = { ...(season.stamina[sheet.club] ?? {}) };
    const mine = sheet.club === player.club;
    const play = {
      starters: sheet.starters.map((s) => s.id),
      substitution: fx.subs[team] ?? null,
      matchSteps: fx.steps,
    };
    const charged = afterMatchday(mine ? { ...clubStamina, [PLAYER_ID]: player.stamina } : clubStamina, play);
    stamina[sheet.club] = Object.fromEntries(Object.entries(charged).filter(([id]) => id !== PLAYER_ID));
    if (mine) {
      // His own stamina stat slows the drain, so his is charged here rather than by afterMatchday.
      share = playingShares(play).get(PLAYER_ID) ?? 0;
      playerStamina = clamp(
        share > 0
          ? player.stamina - PLAY_COST * fatigueFactor(player.attributes) * share
          : player.stamina + REST_GAIN,
        0,
        STAMINA_MAX,
      );
    }
  });

  let nextPlayer: CareerPlayer = { ...player, stamina: playerStamina };
  let points = season.points;
  const rating = record.ratings[PLAYER_ID];
  if (rating !== undefined && share > 0) {
    const rivals = fx.sheets[1].starters;
    const gap =
      matchStrength(player.look.build, player.attributes) -
      rivals.reduce((t, r) => t + r.tier, 0) / rivals.length;
    const expected = expectedRating(player.position, gap);
    const earned = matchPoints(rating, share);
    const entry = { day: careerDay(career), residual: round2(rating - expected) };
    points += earned;
    nextPlayer = {
      ...nextPlayer,
      points: player.points + earned,
      form: addForm(player.form, share < 1 ? { ...entry, share } : entry),
    };
  }

  return {
    ...career,
    player: nextPlayer,
    season: {
      ...season,
      leagues: season.leagues.map((l, d) => (d === ref.division ? league : l)),
      records: season.records.map((div, d) =>
        d === ref.division
          ? div.map((day, md) =>
              md === fixture.matchday ? day.map((r, i) => (i === fixture.index ? record : r)) : day,
            )
          : div,
      ),
      stamina,
      points,
    },
  };
}

/** Plays a planned fixture headless through the runner, as the match screen would without anyone at the keys. */
export function simulate(plan: FixturePlan): CareerOutcome {
  const runner = new MatchRunner(plan.config());
  runner.advance(Infinity);
  return { stats: runner.stats, steps: runner.step };
}

/** Sims his club's fixture if it's still to play, then every other fixture of the matchday. */
export function simMatchday(career: CareerState): CareerState {
  let next = career;
  for (const ref of pendingFixtures(career)) {
    const plan = planFixture(next, ref, 'sim');
    next = plan.finish(next, simulate(plan));
  }
  return next;
}

// Between matchdays ---------------------------------------------------------------------------------

const trainingOf = (player: CareerPlayer): Training => ({
  age: player.age,
  points: player.points,
  attributes: player.attributes,
  wear: player.wear,
  guarded: player.guarded,
});

export const trainPlayer = (career: CareerState, stat: Attribute): CareerState => ({
  ...career,
  player: { ...career.player, ...train(trainingOf(career.player), stat) },
});

export const guardPlayer = (career: CareerState, stat: Attribute): CareerState => ({
  ...career,
  player: { ...career.player, ...guard(trainingOf(career.player), stat) },
});

/** A new position, between matchdays or seasons; his form goes with him (ratings are judged per position). */
export function setPosition(career: CareerState, position: Role): CareerState {
  if (!POSITIONS.includes(position)) throw new Error(`No position ${position}`);
  return { ...career, player: { ...career.player, position } };
}

export const playerStars = (player: CareerPlayer): number =>
  overallStars(player.look.build, player.attributes);

// Season's end --------------------------------------------------------------------------------------

export interface KnightSeason {
  readonly id: string;
  /** Matches he played in; those he came on in, and those he was taken off in. */
  readonly apps: number;
  readonly subOns: number;
  readonly subOffs: number;
  readonly goals: number;
  readonly assists: number;
  readonly motm: number;
  readonly ratingSum: number;
}

/** Every knight's season in one division, from its fixture records. */
export function divisionSeason(career: CareerState, division: Division): Map<string, KnightSeason> {
  const out = new Map<string, KnightSeason>();
  const get = (id: string): KnightSeason =>
    out.get(id) ?? { id, apps: 0, subOns: 0, subOffs: 0, goals: 0, assists: 0, motm: 0, ratingSum: 0 };
  for (const record of (career.season.records[division] ?? []).flat()) {
    if (!record) continue;
    for (const [id, rating] of Object.entries(record.ratings)) {
      const k = get(id);
      out.set(id, {
        ...k,
        apps: k.apps + 1,
        subOns: k.subOns + (record.subs.some((s) => s.on === id) ? 1 : 0),
        subOffs: k.subOffs + (record.subs.some((s) => s.off === id) ? 1 : 0),
        ratingSum: k.ratingSum + rating,
        motm: k.motm + (record.motm === id ? 1 : 0),
      });
    }
    for (const g of record.goals) {
      if (g.scorer && !g.ownGoal) out.set(g.scorer, { ...get(g.scorer), goals: get(g.scorer).goals + 1 });
      if (g.assist) out.set(g.assist, { ...get(g.assist), assists: get(g.assist).assists + 1 });
    }
  }
  return out;
}

export const averageOf = (k: KnightSeason | undefined): number | null =>
  k && k.apps > 0 ? k.ratingSum / k.apps : null;

/** Royal call-ups: the best four season averages in the Great Houses, among knights with this many matches. */
export const ROYAL_PLACES = 4;
export const ROYAL_MIN_APPS = 7;
/** A Shire knight is called up only if his average tops his league and would rank this high in the Great Houses. */
export const ROYAL_SHIRE_RANK = 2;
/** The royal knockout: mean tier of each round's opponents. */
export const ROYAL_RIVAL_TIERS: readonly number[] = [3, 3, 4];

const ranked = (season: Map<string, KnightSeason>): KnightSeason[] =>
  [...season.values()]
    .filter((k) => k.apps >= ROYAL_MIN_APPS)
    .sort((a, b) => (averageOf(b) ?? 0) - (averageOf(a) ?? 0) || a.id.localeCompare(b.id));

/** Whether this season earns the royal call, and with whom: the Great Houses' best besides him. */
export function royalCall(career: CareerState): string[] | null {
  const division = playerDivision(career);
  const top = ranked(divisionSeason(career, TOP_DIVISION));
  const others = top
    .filter((k) => k.id !== PLAYER_ID)
    .slice(0, ROYAL_PLACES - 1)
    .map((k) => k.id);
  if (others.length < ROYAL_PLACES - 1) return null;
  if (division === TOP_DIVISION) {
    const place = top.findIndex((k) => k.id === PLAYER_ID);
    return place >= 0 && place < ROYAL_PLACES ? [PLAYER_ID, ...others] : null;
  }
  if (division !== 1) return null;
  const shire = ranked(divisionSeason(career, 1));
  const mine = averageOf(shire[0]);
  const bar = averageOf(top[ROYAL_SHIRE_RANK - 1]);
  return shire[0]?.id === PLAYER_ID && mine !== null && bar !== null && mine >= bar
    ? [PLAYER_ID, ...others]
    : null;
}

function knightById(world: World, id: string): CareerKnight {
  for (const squad of Object.values(world.squads)) {
    const knight = squad.find((k) => k.id === id);
    if (knight) return knight;
  }
  throw new Error(`No knight ${id}`);
}

/** The royal knockout, simmed headless: the royal four against three foreign sides, golden goal, out on a defeat. */
export function playRoyal(career: CareerState, squad: readonly string[]): RoyalResult {
  const { player, world } = career;
  const rng = createRng(streamSeed(career.seed, career.season.number, STREAM.royal));
  const others = squad.filter((id) => id !== PLAYER_ID).map((id) => knightById(world, id));
  // No keeper tier measured worth anything, so the weakest of the three keeps goal when he doesn't.
  const byTier = [...others].sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
  const roles = POSITIONS.filter((r) => r !== player.position);
  const ordered = player.position === 'gk' ? byTier.reverse() : byTier;
  const home: KnightSpec[] = POSITIONS.map((role) => {
    if (role === player.position) return { ...simKnightSpec(player, role), speedFactor: 1 };
    const knight = ordered[roles.indexOf(role)];
    if (!knight) throw new Error('The royal side needs four knights');
    return squadKnightSpec(knight, STAMINA_MAX, role);
  });
  const slot = POSITIONS.indexOf(player.position);
  const matches: RoyalMatch[] = [];
  const taken = takenWith(
    Object.values(world.squads).flatMap((s) => s.map((k) => k.look.name)),
    player.look.name,
  );
  for (const [round, mean] of ROYAL_RIVAL_TIERS.entries()) {
    const away = POSITIONS.map((role, i) => {
      const tier = clamp(mean + rng.pick([-1, 0, 0, 1]), 0, 4);
      const name = freshName(rng, taken);
      taken.add(name);
      const look = randomLook(rng, name);
      return squadKnightSpec({ id: `royal:${round}:${i}`, look, tier, forged: false }, STAMINA_MAX, role);
    });
    const runner = new MatchRunner({
      home,
      away,
      seed: streamSeed(career.seed, career.season.number, 10 + round),
      tactics: [DEFAULT_TACTICS, DEFAULT_TACTICS],
      draws: false,
    });
    runner.advance(Infinity);
    const ratings = rateMatch(runner.stats);
    const score: Score = [runner.stats.teams[0].goals, runner.stats.teams[1].goals];
    const goals = runner.stats.actions.filter(
      (a) => a.kind === 'goal' && !a.ownGoal && a.knightId === slot,
    ).length;
    matches.push({
      opponent: `Round ${round + 1}`,
      score,
      rating: round2(ratings.knights.find((k) => k.id === slot)?.rating ?? 0),
      goals,
      motm: ratings.motm === slot,
    });
    if (score[0] < score[1]) break;
  }
  const crowned =
    matches.length === ROYAL_RIVAL_TIERS.length && matches.every((m) => m.score[0] > m.score[1]);
  return { squad, matches, crowned };
}

// Offers

/** Offers come at most this many a summer, the highest division and strongest club first. */
export const OFFERS_MAX = 3;
/** A season this good, over this many matches, can bring an offer from two divisions up. */
export const OUTSTANDING_AVERAGE = 8;
export const OUTSTANDING_APPS = 10;
/** Tiers of reach full fame lends: a famous knight gets offers a little above his measured level. */
export const FAME_REACH = 0.5;
/** A club bids with chance OFFER_RATE × logistic((his worth − the place's level) / OFFER_SCALE). */
export const OFFER_RATE = 0.5;
export const OFFER_SCALE = 0.15;

/** His worth to a club in tiers: his stars in a match, moved by how his season's ratings ran against what his stars
 * predict against his division's clubs. */
export function appeal(career: CareerState, apps: number, average: number | null): number {
  const { player, world } = career;
  const strength = matchStrength(player.look.build, player.attributes);
  const rivals = (world.divisions[playerDivision(career)] ?? []).filter((c) => c !== player.club);
  const level = rivals.reduce((t, c) => t + clubLevel(world, c), 0) / Math.max(1, rivals.length);
  const surprise = average === null ? 0 : average - expectedRating(player.position, strength - level);
  const form = (apps / (apps + FORM_PRIOR)) * surprise * FORM_TIERS;
  return strength + form;
}

/** The tier of the knight a club would start in his position, fresh, the bar a signing must clear to play. In goal no
 * tier counts, so a keeper is measured against the club's starting four instead. */
export function placeLevel(world: World, club: string, position: Role): number {
  if (position === 'gk') return clubLevel(world, club);
  const squad = squadOfClub(world, club);
  const lineup = chooseLineup(squad, freshStamina(squad), clubById(club).style, MATCHDAYS);
  return lineup.starters[POSITIONS.indexOf(position)]?.knight.tier ?? clubLevel(world, club);
}

export const offerChance = (worth: number, fame: number, level: number): number =>
  OFFER_RATE / (1 + Math.exp(-(worth + (FAME_REACH * fame) / 100 - level) / OFFER_SCALE));

function makeOffers(
  career: CareerState,
  next: readonly (readonly string[])[],
  line: { apps: number; average: number | null },
  fame: number,
): Offer[] {
  const rng = createRng(streamSeed(career.seed, career.season.number, STREAM.offers));
  const division = playerDivision(career);
  const outstanding = line.apps >= OUTSTANDING_APPS && (line.average ?? 0) >= OUTSTANDING_AVERAGE;
  const reach = Math.min(TOP_DIVISION, division + (outstanding ? 2 : 1));
  const worth = appeal(career, line.apps, line.average);
  const candidates = DIVISIONS.filter((d) => d >= division && d <= reach)
    .flatMap((d) =>
      (next[d] ?? []).map((club) => ({
        club,
        division: d,
        level: placeLevel(career.world, club, career.player.position),
      })),
    )
    .filter((c) => c.club !== career.player.club)
    .sort((a, b) => b.division - a.division || b.level - a.level || a.club.localeCompare(b.club));
  const offers: Offer[] = [];
  for (const c of candidates) {
    // Every candidate draws, taken or not, so one club's chance never shifts another's draw.
    const bids = rng.next() < offerChance(worth, fame, c.level);
    if (bids && offers.length < OFFERS_MAX) offers.push({ club: c.club, division: c.division });
  }
  return offers;
}

/** The season's honours, points, fame, offers and royal call, once every fixture is in. */
export function endSeason(career: CareerState): CareerState {
  if (career.review || !isSeasonOver(career)) throw new Error('The season is not over');
  const { player, season } = career;
  const division = playerDivision(career);
  const tables = season.leagues.map((l) => table(l));
  const finish = (tables[division] ?? []).findIndex((r) => r.house === player.club) + 1;
  const mine = divisionSeason(career, division);
  const me = mine.get(PLAYER_ID);
  const goals = me?.goals ?? 0;
  const topGoals = Math.max(0, ...[...mine.values()].map((k) => k.goals));

  const squad = royalCall(career);
  const royal = squad ? playRoyal(career, squad) : null;
  const honours: Honour[] = [];
  const counts = (me?.apps ?? 0) >= TROPHY_MIN_APPS;
  if (counts && finish === 1) honours.push('title');
  if (counts && division < TOP_DIVISION && finish <= 2) honours.push('promotion');
  if (counts && goals > 0 && goals === topGoals) honours.push('topScorer');
  if (royal) honours.push('royalCall');
  if (royal?.crowned) honours.push('royalCrown');

  const average = averageOf(me);
  const bonus = honourPoints(honours, division);
  const fame = nextFame(player.fame, { division, average, goals, honours });
  const next = promote(tables);
  const offers = makeOffers(career, next, { apps: me?.apps ?? 0, average }, fame);
  const nextPlayer = { ...player, points: player.points + bonus, fame };
  const summary: SeasonSummary = {
    season: season.number,
    age: player.age,
    club: player.club,
    division,
    position: player.position,
    finish,
    apps: me?.apps ?? 0,
    starts: (me?.apps ?? 0) - (me?.subOns ?? 0),
    subOns: me?.subOns ?? 0,
    subOffs: me?.subOffs ?? 0,
    goals,
    assists: me?.assists ?? 0,
    motm: me?.motm ?? 0,
    average: average === null ? null : round2(average),
    matchPoints: season.points,
    honourPoints: bonus,
    honours,
    relegated: division > 0 && finish > (tables[division]?.length ?? 0) - 2,
    fame: round2(fame),
    stars: round2(overallStars(player.look.build, player.attributes)),
    attributes: player.attributes,
    offers: offers.map((o) => o.club),
  };
  return {
    ...career,
    player: { ...nextPlayer, fame: summary.fame },
    review: { offers, royal },
    history: [...career.history, summary],
  };
}

/** The next season: promotion and relegation, the summer's churn, his move (`club`, one of the offers, or null to
 * stay) and a year on his age. His form carries over, fading by the matchday as it always does. */
export function nextSeason(career: CareerState, club: string | null): CareerState {
  const { review, player, season } = career;
  if (!review) throw new Error('The season is not over');
  if (club !== null && !review.offers.some((o) => o.club === club)) throw new Error(`No offer from ${club}`);
  const divisions = promote(season.leagues.map((l) => table(l)));
  const world = withoutName(
    churn(
      { ...career.world, divisions },
      streamSeed(career.seed, season.number, STREAM.churn),
      player.look.name,
    ),
    player.look.name,
  );
  const moved = club ?? player.club;
  const aged = age(trainingOf(player));
  return {
    ...career,
    player: { ...player, ...aged, club: moved, stamina: STAMINA_MAX },
    world,
    season: createSeason(career.seed, season.number + 1, world, moved),
    review: null,
  };
}
