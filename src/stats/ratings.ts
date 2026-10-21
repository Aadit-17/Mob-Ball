// Match ratings, measured rather than guessed: every action is worth the change it made in how likely
// each side was to score next (the fitted value model), and a knight's rating is his summed value
// against what his position usually earns in that much time. Pure: the same stats, the same ratings.
import { MATCH, STEP } from '../game/constants';
import type { Role, TeamId } from '../game/types';
import { POSSESSION_HOLD, rivalOf } from './definitions';
import { mainRole } from './tally';
import type { Action, KnightStats, MatchStats } from './types';
import { NO_CELL, type ValueModel } from './value';
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

/** What a position earns over a full match: the centre and spread ratings are measured against. */
export interface RoleNorm {
  readonly mean: number;
  readonly sd: number;
}

export interface RatingModel {
  readonly value: ValueModel;
  readonly roles: Readonly<Record<Role, RoleNorm>>;
  /** Rating = BASE + lift + spread × standardised value. */
  readonly lift: number;
  readonly spread: number;
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
    // A rival took it. The loser's action is valued up to the touch and charged what losing it cost;
    // the winner earns the danger he removed, credited where the log credits the win (a barge's author).
    const lost = piece.team;
    close(piece, value(t - 1, lost), t - 1);
    emit(piece.knightId, 'loss', t, Math.min(0, value(t, lost) - value(t - 1, lost)));
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
    else if (credit) emit(credit.knightId, credit.kind, t, Math.max(0, removed));
    else emit(owner, 'scramble', t, removed);
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
  const spread = ROLES.reduce((s, r) => s + share(r) * roles[r].sd ** 2, 0);
  return (value - par) / Math.sqrt(spread * Math.max(1, MIN_SHARE / played));
}

export const toRating = (score: number): number => Math.min(MAX_RATING, Math.max(MIN_RATING, score));

/** Ratings from already valued actions; `rateMatch` is the usual way in. */
export function ratingsFrom(
  stats: MatchStats,
  actions: readonly ValuedAction[],
  model: RatingModel = RATING_MODEL,
): MatchRatings {
  const totals = new Map<number, number>();
  for (const a of actions) totals.set(a.knightId, (totals.get(a.knightId) ?? 0) + a.value);
  const knights = stats.knights
    .filter((k) => k.playedSteps > 0)
    .map((k): KnightRating => {
      const value = totals.get(k.id) ?? 0;
      const score = BASE + model.lift + model.spread * standardise(value, k.roleSteps, model.roles);
      return { id: k.id, team: k.team, role: mainRole(k), rating: toRating(score), score, value };
    });
  return { knights, motm: manOfTheMatch(stats, knights) };
}

export const rateMatch = (stats: MatchStats, model: RatingModel = RATING_MODEL): MatchRatings =>
  ratingsFrom(stats, valueActions(stats, model.value), model);

// The best score; level, the winning side's knight, then the one with more goals, then the lower id
// (all deterministic, so a replay always names the same knight).
function manOfTheMatch(stats: MatchStats, knights: readonly KnightRating[]): number | null {
  const [home, away] = [stats.teams[0].goals, stats.teams[1].goals];
  const winner: TeamId | null = home > away ? 0 : away > home ? 1 : null;
  const goals = (id: number): number => stats.knights.find((k) => k.id === id)?.goals ?? 0;
  const ranked = [...knights].sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.team === winner) - Number(a.team === winner) ||
      goals(b.id) - goals(a.id) ||
      a.id - b.id,
  );
  return ranked[0]?.id ?? null;
}
