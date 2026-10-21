// Match ratings in two parts. Process: every action is worth the change it made in how likely each side
// was to score next (the fitted value model), against what his position usually earns in that time.
// Outcome: goals, assists, own goals, saves and clean sheets, counted in full, on top. Pure, replayable.
import { MATCH, PITCH, STEP } from '../game/constants';
import type { Role, TeamId } from '../game/types';
import { POSSESSION_HOLD, rivalOf } from './definitions';
import { mainRole } from './tally';
import type { Action, KnightStats, MatchStats } from './types';
import { DEPTH_BAND, DEPTHS, NO_CELL, type ValueModel } from './value';
import { RATING_MODEL } from './value-model';

export type ValueKind =
  | 'carry'
  | 'pass'
  /** The pass a goal came from: never worth less than nothing. */
  | 'assist'
  | 'shot'
  | 'clearance'
  /** A kick the log names nothing else (played again by the kicker, or still going at full time). */
  | 'kick'
  /** The action that put the ball in, kicked or pushed, or the last nudge if someone else had it. */
  | 'goal'
  | 'ownGoal'
  /** What losing the ball to a rival cost, on top of the action that lost it. */
  | 'loss'
  | 'tackle'
  | 'interception'
  | 'recovery'
  | 'save'
  | 'block'
  | 'claim'
  /** A rival's touch that took the ball without the log crediting a win: worth what it did, either way. */
  | 'scramble'
  /** A keeper beaten: the share of the goal he might have stopped. */
  | 'conceded';

export interface ValuedAction {
  readonly knightId: number;
  readonly kind: ValueKind;
  readonly step: number;
  /** In next-goal probability: our chance minus theirs, after the action less before it. */
  readonly value: number;
}

/** What a position's process value comes to over a full match: the par it is measured from, and its spread. */
export interface RoleNorm {
  readonly mean: number;
  readonly sd: number;
}

/** Rating points for each decisive outcome (a clean sheet scaled by his share of the match in goal). */
export interface OutcomeWeights {
  readonly goal: number;
  readonly assist: number;
  readonly ownGoal: number;
  /** A keeper's save of a shot that was going in: his goal. */
  readonly save: number;
  readonly cleanSheet: number;
}

export interface RatingModel {
  readonly value: ValueModel;
  readonly roles: Readonly<Record<Role, RoleNorm>>;
  /** Rating = BASE + lift + spread × standardised value + outcome credit. */
  readonly lift: number;
  readonly spread: number;
  readonly outcome: OutcomeWeights;
  /** A losing side's knight is man of the match only if he out-rates the winners' best by this much. */
  readonly motmMargin: number;
  readonly possession: PossessionModel;
}

// Winning the ball is worth more than the next few seconds' goal chance shows: it gives your side the ball.
// A ball won earns the winner how often a possession won in that band ends in a shot (fitted), at `weight`
// rating points a unit. The loser isn't charged again: his share of the swing is already in his value.
export interface PossessionModel {
  /** P(the side that won the ball shoots before losing it), by depth band from the goal it attacks. */
  readonly shot: readonly number[];
  readonly weight: number;
}

/** The decisive things a knight did, as the stats count them. */
export interface Outcomes {
  readonly goals: number;
  readonly assists: number;
  readonly ownGoals: number;
  readonly saves: number;
  /** Kept goal and let nothing in while there. */
  readonly cleanSheet: boolean;
  /** The possession value of the balls he won (see PossessionModel). */
  readonly possession: number;
}

export interface KnightRating {
  readonly id: number;
  readonly team: TeamId;
  /** The role he played longest. */
  readonly role: Role;
  /** 3.0–10.0; show it to one decimal. */
  readonly rating: number;
  /** Before clamping, for ranking. */
  readonly score: number;
  /** Summed action value. */
  readonly value: number;
  /** Rating points from outcomes. */
  readonly outcome: number;
}

export interface MatchRatings {
  /** Everyone who played, by id. */
  readonly knights: readonly KnightRating[];
  /** Man of the match, by id; null only if nobody played. */
  readonly motm: number | null;
}

export const BASE = 6;
export const MIN_RATING = 3;
export const MAX_RATING = 10;
/** A full match of live play, the unit a position's norm is measured in. */
export const REGULATION_STEPS = Math.round(MATCH.duration / STEP);
// A cameo is judged as if he had played at least this share of the match, so one lucky touch in the
// last minute can't send a substitute to 10 (or 3).
export const MIN_SHARE = 0.25;

const DEFENCE_KINDS = new Set<Action['kind']>(['tackle', 'interception', 'recovery']);
type Kick = Extract<Action, { kind: 'pass' | 'shot' | 'clearance' }>;
type Goal = Extract<Action, { kind: 'goal' }>;
type Defence = Extract<Action, { kind: 'tackle' | 'interception' | 'recovery' }>;

/** The ball's current owner and what he is doing with it. */
interface Piece {
  readonly knightId: number;
  readonly team: TeamId;
  /** The kick that started this piece, if it is a kick rather than a carry. */
  readonly kickStep: number | null;
  /** Our side's value when the piece started. */
  readonly start: number;
}

/** Every action valued, by the rules in the comments below. */
export function valueActions(stats: MatchStats, model: ValueModel = RATING_MODEL.value): ValuedAction[] {
  const { cells, owners, touchers } = stats.trace;
  const teamOf = new Map(stats.knights.map((k) => [k.id, k.team]));
  const team = (id: number): TeamId => teamOf.get(id) ?? 0;
  const goals = new Map<number, Goal>();
  const kicks = new Map<string, Kick>();
  const defence = new Map<number, Defence[]>();
  for (const a of stats.actions) {
    if (a.kind === 'goal') goals.set(a.step, a);
    else if (a.kind === 'pass' || a.kind === 'shot' || a.kind === 'clearance')
      kicks.set(`${a.step}:${a.knightId}`, a);
    else if (DEFENCE_KINDS.has(a.kind)) defence.set(a.step, [...(defence.get(a.step) ?? []), a as Defence]);
  }
  const kickAt = (step: number | null, id: number): Kick | undefined =>
    step === null ? undefined : kicks.get(`${step}:${id}`);
  const kickedAt = (t: number, id: number): boolean => touchers[t] === id && kicks.has(`${t}:${id}`);
  const holders = holdersOf(owners, team, (t) => goals.has(t) || kickedAt(t, owners[t] ?? -1));

  /** P(`side` scores next) after step t. */
  const chance = (t: number, side: TeamId): number => {
    const cell = cells[t] ?? NO_CELL;
    if (cell === NO_CELL) return 0;
    const owner = team(owners[t] ?? -1);
    return (side === owner ? model.own[cell] : model.other[cell]) ?? 0;
  };
  const value = (t: number, side: TeamId): number => chance(t, side) - chance(t, rivalOf(side));
  const live = (t: number): boolean => (owners[t] ?? -1) !== -1;

  const out: ValuedAction[] = [];
  const emit = (knightId: number, kind: ValueKind, step: number, v: number): void => {
    out.push({ knightId, kind, step, value: v });
  };
  const close = (p: Piece, end: number, step: number, as?: ValueKind): void => {
    const kick = kickAt(p.kickStep, p.knightId);
    emit(
      p.knightId,
      as ?? (p.kickStep === null ? 'carry' : (kick?.kind ?? 'kick')),
      p.kickStep ?? step,
      end - p.start,
    );
  };
  const begin = (id: number, t: number, kicked: boolean): Piece => ({
    knightId: id,
    team: team(id),
    kickStep: kicked ? t : null,
    start: value(t, team(id)),
  });

  let piece: Piece | null = null;
  for (let t = 0; t < cells.length; t++) {
    const goal = goals.get(t);
    if (goal) {
      settleGoal(goal, t, piece);
      piece = null;
      continue;
    }
    const owner = holders[t] ?? -1;
    if (owner === -1) {
      if (piece && t > 0 && live(t - 1)) close(piece, value(t - 1, piece.team), t - 1);
      piece = null;
      continue;
    }
    if (!piece || !live(t - 1)) {
      piece = begin(owner, t, kickedAt(t, owner));
      continue;
    }
    if (owner === piece.knightId) {
      // His own kick ends his carry (or his last kick) and starts a kick from where the ball was.
      if (kickedAt(t, owner)) {
        const before = value(t - 1, piece.team);
        close(piece, before, t - 1);
        piece = { knightId: owner, team: piece.team, kickStep: t, start: before };
      }
      continue;
    }
    if (team(owner) === piece.team) {
      // A teammate took it on: the step it arrived completes the passer's (or carrier's) action.
      close(piece, value(t, piece.team), t);
      piece = begin(owner, t, kickedAt(t, owner));
      continue;
    }
    // A rival took it. The swing is shared by the two in the duel: half charged to the loser, half earned by
    // the winner (as the log credits him: a barge's author), counted once. A stopped shot is the stopper's
    // whole: the chance he stopped, as the charge for a goal he lets in is the chance he didn't.
    const lost = piece.team;
    close(piece, value(t - 1, lost), t - 1);
    const swing = value(t, lost) - value(t - 1, lost);
    emit(piece.knightId, 'loss', t, Math.min(0, swing / 2));
    const removed = chance(t - 1, lost) - chance(t, lost);
    const shot = kickAt(piece.kickStep, piece.knightId);
    const credit = (defence.get(t) ?? []).find((a) => a.team !== lost);
    if (shot?.kind === 'shot' && shot.stopperId === owner && shot.outcome !== 'rebound')
      emit(
        owner,
        shot.outcome === 'saved' ? 'save' : shot.outcome === 'claimed' ? 'claim' : 'block',
        t,
        Math.max(0, removed),
      );
    else if (credit) emit(credit.knightId, credit.kind, t, Math.max(0, -swing / 2));
    else emit(owner, 'scramble', t, -swing / 2);
    piece = begin(owner, t, kickedAt(t, owner));
  }
  if (piece) close(piece, value(cells.length - 1, piece.team), cells.length - 1);
  markAssists(stats, out);
  return out;

  // The goal is worth everything that was left to win: the credited knight's action ends at certainty.
  // His keeper is charged the share of it he might have stopped, judged from just after the last touch.
  function settleGoal(goal: Goal, t: number, current: Piece | null): void {
    const scorer = goal.knightId;
    const before = (side: TeamId): number => (live(t - 1) ? value(t - 1, side) : 0);
    const end = (side: TeamId): number => (side === goal.team ? 1 : -1);
    const kind: ValueKind = goal.ownGoal ? 'ownGoal' : 'goal';
    const finisher = current?.knightId === scorer ? current : null;
    if (finisher) close(finisher, end(finisher.team), finisher.kickStep ?? t, kind);
    else {
      if (current) close(current, before(current.team), t - 1);
      if (scorer !== null) emit(scorer, kind, t, end(team(scorer)) - before(team(scorer)));
    }
    if (goal.keeperId === null) return;
    let c = t;
    while (c > 0 && touchers[c] !== scorer) c--;
    const stoppable = 1 - (touchers[c] === scorer ? chance(c, goal.team) : chance(t - 1, goal.team));
    emit(goal.keeperId, 'conceded', t, -Math.max(0, stoppable));
  }
}

// Possession as the stats layer counts it: a rival's touch takes the ball only if his side keeps it for
// POSSESSION_HOLD or plays it on. A bump that the ball comes straight back from changes nothing, so the
// value it swung stays with the side that had the ball (the state itself is still read as it was).
function holdersOf(
  owners: readonly number[],
  team: (id: number) => TeamId,
  settles: (t: number) => boolean,
): number[] {
  const out = [...owners];
  for (let t = 1; t < out.length; t++) {
    const held = out[t - 1] ?? -1;
    const now = owners[t] ?? -1;
    if (held === -1 || now === -1 || team(now) === team(held)) continue;
    let u = t;
    let stands = false;
    while (u < owners.length && (owners[u] ?? -1) !== -1 && team(owners[u] ?? -1) !== team(held)) {
      if (u - t >= POSSESSION_HOLD || settles(u)) {
        stands = true;
        break;
      }
      u++;
    }
    if (stands || (owners[u] ?? -1) === -1) continue;
    for (let v = t; v < u; v++) out[v] = held;
    t = u - 1;
  }
  return out;
}

/** The scorer's teammate's last pass before an assisted goal becomes the assist, worth at least nothing. */
function markAssists(stats: MatchStats, out: ValuedAction[]): void {
  for (const g of stats.actions) {
    if (g.kind !== 'goal' || g.assistId === null) continue;
    let best = -1;
    out.forEach((a, i) => {
      if (a.knightId === g.assistId && a.kind === 'pass' && a.step < g.step) best = i;
    });
    const pass = out[best];
    if (pass) out[best] = { ...pass, kind: 'assist', value: Math.max(0, pass.value) };
  }
}

const ROLES: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];

// Value piles up over time, so a knight's par is his roles' norms weighted by time in each, and the
// spread grows with the square root of time (as a sum of independent stretches would).
export function standardise(
  value: number,
  roleSteps: KnightStats['roleSteps'],
  roles: Readonly<Record<Role, RoleNorm>>,
): number {
  const share = (r: Role): number => roleSteps[r] / REGULATION_STEPS;
  const played = ROLES.reduce((s, r) => s + share(r), 0);
  if (played <= 0) return 0;
  const par = ROLES.reduce((s, r) => s + share(r) * roles[r].mean, 0);
  return (value - par) / yardstick(roleSteps, roles);
}

/** What one unit of z is in value for his time in each role (see standardise). */
function yardstick(roleSteps: KnightStats['roleSteps'], roles: Readonly<Record<Role, RoleNorm>>): number {
  const share = (r: Role): number => roleSteps[r] / REGULATION_STEPS;
  const played = ROLES.reduce((s, r) => s + share(r), 0);
  const spread = ROLES.reduce((s, r) => s + share(r) * roles[r].sd ** 2, 0);
  return Math.sqrt(spread * Math.max(1, MIN_SHARE / Math.max(played, 1e-9)));
}

export const toRating = (score: number): number => Math.min(MAX_RATING, Math.max(MIN_RATING, score));

export const outcomesOf = (k: KnightStats, possession = 0): Outcomes => ({
  goals: k.goals,
  assists: k.assists,
  ownGoals: k.ownGoals,
  saves: k.saves,
  cleanSheet: k.roleSteps.gk > 0 && k.goalsConceded === 0,
  possession,
});

/** The depth band, from the goal a side attacks, of a point on the pitch (as the value model bands it). */
export const depthBand = (team: TeamId, x: number): number => {
  const ahead = team === 0 ? PITCH.right - x : x - PITCH.left;
  return Math.min(DEPTHS - 1, Math.max(0, Math.floor(ahead / DEPTH_BAND)));
};

/** Each knight's possessions won and lost, valued by the possession model: [won, lost, balls won, balls lost]. */
export function possessionsOf(
  stats: MatchStats,
  model: RatingModel = RATING_MODEL,
): Map<number, PossessionLine> {
  const lines = new Map<number, PossessionLine>();
  const line = (id: number): PossessionLine => {
    const l = lines.get(id) ?? { won: 0, lost: 0, wins: 0, losses: 0 };
    lines.set(id, l);
    return l;
  };
  for (const a of stats.actions) {
    if (a.kind !== 'tackle' && a.kind !== 'interception' && a.kind !== 'recovery') continue;
    const worth = model.possession.shot[depthBand(a.team, a.x)] ?? 0;
    const winner = line(a.knightId);
    winner.won += worth;
    winner.wins++;
    const loser = line(a.fromId);
    loser.lost += worth;
    loser.losses++;
  }
  return lines;
}

export interface PossessionLine {
  won: number;
  lost: number;
  wins: number;
  losses: number;
}

/** Rating points for what decided the match: every goal (and every save) counts in full, whoever makes it. */
export function outcomeCredit(o: Outcomes, roleSteps: KnightStats['roleSteps'], model: RatingModel): number {
  const w = model.outcome;
  const sheet = o.cleanSheet ? w.cleanSheet * Math.min(1, roleSteps.gk / REGULATION_STEPS) : 0;
  const held = model.possession.weight * o.possession;
  return w.goal * o.goals + w.assist * o.assists - w.ownGoal * o.ownGoals + w.save * o.saves + sheet + held;
}

/** A rating before clamping, from summed action value, outcomes and time in each role. */
export const scoreOf = (
  value: number,
  o: Outcomes,
  roleSteps: KnightStats['roleSteps'],
  model: RatingModel,
): number =>
  BASE +
  model.lift +
  model.spread * standardise(value, roleSteps, model.roles) +
  outcomeCredit(o, roleSteps, model);

/** Ratings from already valued actions; `rateMatch` is the usual way in. */
export function ratingsFrom(
  stats: MatchStats,
  actions: readonly ValuedAction[],
  model: RatingModel = RATING_MODEL,
): MatchRatings {
  const totals = new Map<number, number>();
  for (const a of actions) totals.set(a.knightId, (totals.get(a.knightId) ?? 0) + a.value);
  const held = possessionsOf(stats, model);
  const knights = stats.knights
    .filter((k) => k.playedSteps > 0)
    .map((k): KnightRating => {
      const value = totals.get(k.id) ?? 0;
      const p = held.get(k.id);
      const outcomes = outcomesOf(k, p?.won ?? 0);
      const score = scoreOf(value, outcomes, k.roleSteps, model);
      const outcome = outcomeCredit(outcomes, k.roleSteps, model);
      return { id: k.id, team: k.team, role: mainRole(k), rating: toRating(score), score, value, outcome };
    });
  const goals = new Map(stats.knights.map((k) => [k.id, k.goals]));
  const score: [number, number] = [stats.teams[0].goals, stats.teams[1].goals];
  return { knights, motm: manOfTheMatch(knights, score, (id) => goals.get(id) ?? 0, model.motmMargin) };
}

export const rateMatch = (stats: MatchStats, model: RatingModel = RATING_MODEL): MatchRatings =>
  ratingsFrom(stats, valueActions(stats, model.value), model);

/** What the man of the match is chosen from. */
export interface Contender {
  readonly id: number;
  readonly team: TeamId;
  readonly score: number;
}

// The winning side's best, unless a loser out-rates him by `margin`: the award goes to who decided the
// match. In a draw, the best overall. Level scores go to more goals, then the lower id (deterministic).
export function manOfTheMatch(
  knights: readonly Contender[],
  score: readonly [number, number],
  goals: (id: number) => number,
  margin: number,
): number | null {
  const ranked = [...knights].sort((a, b) => b.score - a.score || goals(b.id) - goals(a.id) || a.id - b.id);
  const winner: TeamId | null = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : null;
  if (winner === null) return ranked[0]?.id ?? null;
  const best = ranked.find((k) => k.team === winner);
  const loser = ranked.find((k) => k.team !== winner);
  if (!best) return loser?.id ?? null;
  return loser && loser.score >= best.score + margin ? loser.id : best.id;
}

/** One line of what made a rating: a group of actions, how many, and the rating points they came to. */
export interface BreakdownLine {
  readonly label: string;
  /** How many, as shown: "×3", or "7/9" for passes completed of passes. */
  readonly count: string;
  readonly points: number;
}

export interface RatingBreakdown {
  /** What a match of no worth, for good or ill, rates for his roles and minutes. */
  readonly base: number;
  readonly lines: readonly BreakdownLine[];
  /** base + every line: the rating before the 3–10 clamp. */
  readonly score: number;
  readonly rating: number;
}

type Group =
  | 'goals'
  | 'assists'
  | 'shots'
  | 'passes'
  | 'carries'
  | 'won'
  | 'saves'
  | 'blocks'
  | 'clearances'
  | 'lost'
  | 'ownGoals'
  | 'conceded'
  | 'cleanSheet';

const GROUP_OF: Readonly<Record<ValueKind, Group>> = {
  goal: 'goals',
  assist: 'assists',
  shot: 'shots',
  pass: 'passes',
  carry: 'carries',
  kick: 'carries',
  clearance: 'clearances',
  tackle: 'won',
  interception: 'won',
  recovery: 'won',
  scramble: 'won',
  save: 'saves',
  claim: 'saves',
  block: 'blocks',
  loss: 'lost',
  ownGoal: 'ownGoals',
  conceded: 'conceded',
};

const GROUP_LABEL: Readonly<Record<Group, string>> = {
  goals: 'Goals',
  assists: 'Assists',
  shots: 'Shots',
  passes: 'Passes',
  carries: 'On the ball',
  won: 'Won the ball',
  saves: 'Saves',
  blocks: 'Blocks',
  clearances: 'Clearances',
  lost: 'Lost the ball',
  ownGoals: 'Own goals',
  conceded: 'Goals conceded',
  cleanSheet: 'Clean sheet',
};

// What made a knight's rating, in rating points: each action's value through the same scale as the rating,
// and each outcome's weight, grouped. The base and the lines add up to the score exactly.
export function ratingBreakdown(
  stats: MatchStats,
  knightId: number,
  model: RatingModel = RATING_MODEL,
  actions: readonly ValuedAction[] = valueActions(stats, model.value),
): RatingBreakdown | null {
  const k = stats.knights.find((q) => q.id === knightId);
  if (!k || k.playedSteps === 0) return null;
  const unit = model.spread / yardstick(k.roleSteps, model.roles);
  const held = possessionsOf(stats, model).get(knightId) ?? { won: 0, lost: 0, wins: 0, losses: 0 };
  const o = outcomesOf(k, held.won);
  const w = model.outcome;
  const points = new Map<Group, number>();
  const add = (g: Group, p: number): void => {
    points.set(g, (points.get(g) ?? 0) + p);
  };
  for (const a of actions) if (a.knightId === knightId) add(GROUP_OF[a.kind], unit * a.value);
  if (o.goals) add('goals', w.goal * o.goals);
  if (o.assists) add('assists', w.assist * o.assists);
  if (o.ownGoals) add('ownGoals', -w.ownGoal * o.ownGoals);
  if (o.saves) add('saves', w.save * o.saves);
  if (held.wins) add('won', model.possession.weight * held.won);
  const sheet = outcomeCredit(
    { ...o, goals: 0, assists: 0, ownGoals: 0, saves: 0, possession: 0 },
    k.roleSteps,
    model,
  );
  if (sheet) add('cleanSheet', sheet);
  const lost = actions.filter((a) => a.knightId === knightId && a.kind === 'loss').length;
  const counts: Readonly<Record<Group, string>> = {
    goals: `×${k.goals}`,
    assists: `×${k.assists}`,
    shots: `×${k.shots}`,
    passes: `${k.passesCompleted}/${k.passes}`,
    carries: '',
    won: `×${k.tackles + k.interceptions + k.recoveries}`,
    saves: `×${k.saves + k.claims}`,
    blocks: `×${k.blocks}`,
    clearances: `×${k.clearances}`,
    lost: `×${lost}`,
    ownGoals: `×${k.ownGoals}`,
    conceded: `×${k.goalsConceded}`,
    cleanSheet: '',
  };
  const lines = (Object.keys(GROUP_LABEL) as Group[]).flatMap((g) => {
    const p = points.get(g);
    return p === undefined ? [] : [{ label: GROUP_LABEL[g], count: counts[g], points: p }];
  });
  const score = scoreOf(totalValue(actions, knightId), o, k.roleSteps, model);
  const base = score - lines.reduce((sum, l) => sum + l.points, 0);
  return { base, lines, score, rating: toRating(score) };
}

const totalValue = (actions: readonly ValuedAction[], id: number): number =>
  actions.reduce((sum, a) => (a.knightId === id ? sum + a.value : sum), 0);
