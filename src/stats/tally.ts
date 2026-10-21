import type { Role, TeamId } from '../game/types';
import { rivalOf } from './definitions';
import type { Trace } from './value';
import { COUNTS, type Action, type Count, type KnightStats, type MatchStats, type TeamStats } from './types';

/** What the recorder counts directly, step by step, rather than from the action log. */
export interface StepCounters {
  readonly team: TeamId;
  readonly roleSteps: Readonly<Record<Role, number>>;
  readonly touches: number;
  readonly kicks: number;
  readonly carrySteps: number;
  readonly bargeAttempts: number;
}

type Line = Record<Count, number>;

const ROLES: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];

/** Adds each action to the counts of every knight it involves. */
function add(lines: ReadonlyMap<number, Line>, a: Action): void {
  const bump = (id: number | null, count: Count, by = 1): void => {
    const line = id === null ? undefined : lines.get(id);
    if (line) line[count] += by;
  };
  switch (a.kind) {
    case 'pass':
      bump(a.knightId, 'passes');
      bump(a.knightId, a.completed ? 'passesCompleted' : 'passesLost');
      if (a.progressive) bump(a.knightId, 'progressivePasses');
      if (a.completed) bump(a.knightId, 'passDistance', Math.hypot(a.toX - a.x, a.toY - a.y));
      break;
    case 'shot':
      bump(a.knightId, 'shots');
      if (a.onTarget) bump(a.knightId, 'shotsOnTarget');
      if (a.onTarget) bump(a.keeperId, 'shotsOnTargetFaced');
      if (a.outcome === 'goal') bump(a.knightId, 'goalsFromShots');
      if (a.outcome === 'saved') bump(a.stopperId, 'saves');
      if (a.outcome === 'claimed') bump(a.stopperId, 'claims');
      if (a.outcome === 'blocked') {
        bump(a.knightId, 'shotsBlocked');
        bump(a.stopperId, 'blocks');
        if (a.onTarget) bump(a.stopperId, 'lastDitchBlocks');
      }
      break;
    case 'clearance':
      bump(a.knightId, 'clearances');
      break;
    case 'tackle':
      bump(a.knightId, 'tackles');
      break;
    case 'interception':
      bump(a.knightId, 'interceptions');
      break;
    case 'recovery':
      bump(a.knightId, 'recoveries');
      break;
    case 'turnover':
      bump(a.knightId, 'turnovers');
      break;
    case 'dribble':
      bump(a.knightId, 'dribbles');
      break;
    case 'barge':
      bump(a.knightId, 'bargesWon');
      bump(a.victimId, 'bargesLost');
      break;
    case 'goal':
      bump(a.knightId, a.ownGoal ? 'ownGoals' : 'goals');
      bump(a.assistId, 'assists');
      bump(a.keeperId, 'goalsConceded');
      break;
  }
}

/** Builds the match's stats from the action log and the step counters. */
export function tally(
  log: readonly Action[],
  counters: ReadonlyMap<number, StepCounters>,
  possessionSteps: readonly [number, number],
  goals: readonly [number, number],
  liveSteps: number,
  onPitch: number,
  decidedByLot: TeamId | null,
  trace: Trace,
): MatchStats {
  const actions = log.map((a, i) => ({ a, i })).sort((p, q) => p.a.step - q.a.step || p.i - q.i);
  const lines = new Map<number, Line>();
  for (const [id, c] of counters) {
    const zero = Object.fromEntries(COUNTS.map((k) => [k, 0])) as Line;
    const { touches, kicks, carrySteps, bargeAttempts } = c;
    lines.set(id, { ...zero, touches, kicks, carrySteps, bargeAttempts });
  }
  for (const { a } of actions) add(lines, a);
  const knights: KnightStats[] = [...lines]
    .sort(([a], [b]) => a - b)
    .flatMap(([id, line]) => {
      const c = counters.get(id);
      if (!c) return [];
      const roleSteps = { ...c.roleSteps };
      return [
        { ...line, id, team: c.team, roleSteps, playedSteps: ROLES.reduce((t, r) => t + roleSteps[r], 0) },
      ];
    });
  const held = possessionSteps[0] + possessionSteps[1];
  const team = (t: TeamId): TeamStats => ({
    goals: goals[t],
    possessionSteps: possessionSteps[t],
    possession: held ? possessionSteps[t] / held : 0.5,
  });
  return {
    liveSteps,
    onPitch,
    teams: [team(0), team(1)],
    knights,
    actions: actions.map((p) => p.a),
    decidedByLot,
    trace,
  };
}

/** The role a knight spent longest in (the first in gk, def, mid, fwd order on a tie). */
export const mainRole = (k: KnightStats): Role =>
  ROLES.reduce((best, r) => (k.roleSteps[r] > k.roleSteps[best] ? r : best), 'gk');

const sum = (knights: readonly KnightStats[], count: Count): number =>
  knights.reduce((total, k) => total + k[count], 0);

/** Every way the stats can contradict themselves or the score. Empty means consistent. */
export function invariantBreaks(stats: MatchStats, score: readonly [number, number]): string[] {
  const breaks: string[] = [];
  const check = (ok: boolean, what: string): void => {
    if (!ok) breaks.push(what);
  };
  for (const t of [0, 1] as const) {
    const side = stats.knights.filter((k) => k.team === t);
    const rivals = stats.knights.filter((k) => k.team !== t);
    const uncredited = stats.actions.filter(
      (a) => a.kind === 'goal' && a.team === t && a.knightId === null,
    ).length;
    const lot = stats.decidedByLot === t ? 1 : 0;
    check(stats.teams[t].goals === score[t], `team ${t}: goals ${stats.teams[t].goals} ≠ score ${score[t]}`);
    check(
      sum(side, 'goals') + sum(rivals, 'ownGoals') + uncredited + lot === score[t],
      `team ${t}: credited goals don't add up to the score`,
    );
    check(sum(side, 'assists') <= sum(side, 'goals'), `team ${t}: more assists than goals`);
    check(
      sum(side, 'interceptions') <= sum(rivals, 'passesLost'),
      `team ${t}: more interceptions than rival lost passes`,
    );
    check(
      sum(side, 'saves') + sum(side, 'lastDitchBlocks') <= sum(rivals, 'shotsOnTarget'),
      `team ${t}: more stops than rival shots on target`,
    );
    check(
      sum(side, 'goalsConceded') ===
        score[rivalOf(t)] - (stats.decidedByLot === rivalOf(t) ? 1 : 0) - keeperless(stats, t),
      `team ${t}: keepers' goals conceded ≠ goals against`,
    );
  }
  for (const k of stats.knights) {
    const who = `knight ${k.id}`;
    check(k.passesCompleted + k.passesLost === k.passes, `${who}: completed + lost ≠ passes`);
    check(k.progressivePasses <= k.passesCompleted, `${who}: more progressive passes than completed`);
    check(k.shotsOnTarget <= k.shots && k.shotsBlocked <= k.shots, `${who}: shot breakdown exceeds shots`);
    check(k.goalsFromShots <= k.shotsOnTarget, `${who}: more goals from shots than shots on target`);
    check(k.goalsFromShots <= k.goals, `${who}: more goals from shots than goals`);
    check(k.saves <= k.shotsOnTargetFaced, `${who}: more saves than shots on target faced`);
    check(k.lastDitchBlocks <= k.blocks, `${who}: more last-ditch blocks than blocks`);
    check(k.kicks <= k.touches, `${who}: more kicks than touches`);
    check(k.carrySteps <= k.playedSteps, `${who}: carried the ball longer than he played`);
    check(k.playedSteps <= stats.liveSteps, `${who}: played longer than the match`);
  }
  const shares = stats.teams[0].possession + stats.teams[1].possession;
  check(Math.abs(shares - 1) < 1e-12, `possession shares sum to ${shares}`);
  check(
    stats.teams[0].possessionSteps + stats.teams[1].possessionSteps <= stats.liveSteps,
    'possession longer than the live match',
  );
  check(
    stats.knights.reduce((t, k) => t + k.playedSteps, 0) === stats.liveSteps * stats.onPitch,
    'minutes played do not add up',
  );
  return breaks;
}

/** Goals against a side that had no keeper on the pitch, which no keeper concedes. */
const keeperless = (stats: MatchStats, t: TeamId): number =>
  stats.actions.filter((a) => a.kind === 'goal' && a.team !== t && a.keeperId === null).length;
