import { DEFAULT_TACTICS, type Tactics } from '../../ai/tactics';
import { ROLES_BY_SIZE } from '../../game/formation';
import type { KnightSpec } from '../../game/match';
import type { Look } from '../../knight/look';
import type { FixtureConfig, Manager, TimedAction } from '../runner';
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

/** A Manager mode season: the draft, then the league once the draft is done. */
export interface SeasonState {
  readonly draft: DraftState;
  readonly league: LeagueState | null;
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
    stamina: {},
    plan: null,
    titleCounted: false,
  };
}

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
  const started: SeasonState = { ...season, league, stamina };
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
      const charge = (side: Side, team: 0 | 1): Stamina => {
        const play = {
          starters: side.lineup.starters.map((s) => s.knight.id),
          substitution: substitutionOf(side, managers[team], outcome, team),
          matchSteps: outcome.steps,
        };
        return afterMatchday(current.stamina[side.house] ?? {}, play);
      };
      return {
        ...current,
        league: recordResult(current.league, fixture.matchday, fixture.index, score),
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
  line: ['deep', 'normal', 'high'],
  shooting: ['patient', 'normal', 'early'],
} as const;

function normalizeTactics(raw: unknown): Tactics | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { press, line, shooting } = raw as Record<string, unknown>;
  const isOne = <T extends string>(options: readonly T[], value: unknown): value is T =>
    typeof value === 'string' && (options as readonly string[]).includes(value);
  return isOne(TACTIC_VALUES.press, press) &&
    isOne(TACTIC_VALUES.line, line) &&
    isOne(TACTIC_VALUES.shooting, shooting)
    ? { press, line, shooting }
    : null;
}

/** Reads a saved season, or null for anything that isn't a real draft, league and squads that fit together. */
export function normalizeSeason(raw: unknown): SeasonState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const draft = normalizeDraft(source.draft);
  if (!draft) return null;
  if (!isDraftComplete(draft)) return { draft, league: null, stamina: {}, plan: null, titleCounted: false };

  const league = normalizeLeague(source.league, DRAFT_HOUSES);
  if (league?.seed !== draft.seed || league.playerHouse !== draft.playerHouse) return null;
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
    return setPlan({ draft, league, stamina, plan: null, titleCounted }, { starters, tactics });
  } catch {
    return null;
  }
}
