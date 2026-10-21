import { CONTROL_GAP, carrierOf } from '../ai/brain';
import { knightById } from '../game/match';
import type { Knight, MatchEvent, MatchState, Role, TeamId } from '../game/types';
import { dist } from '../game/vec';
import {
  ASSIST_WINDOW,
  BARGE_TACKLE_WINDOW,
  CONTROL_SPEED,
  CONTROL_STEPS,
  DRIBBLE_ENGAGE,
  DRIBBLE_LANE,
  POSSESSION_HOLD,
  attackDir,
  ballFate,
  inDangerZone,
  isProgressive,
  readKick,
  rivalOf,
} from './definitions';
import { tally } from './tally';
import type { Action, MatchStats, ShotOutcome } from './types';

/** A knight's contact with the ball on one step: a kick, or his body. */
interface Contact {
  readonly knight: Knight;
  readonly kick: boolean;
}

interface Touch {
  readonly knightId: number;
  readonly team: TeamId;
  readonly step: number;
  readonly kick: boolean;
}

/** The last kick, until the next knight touches the ball decides what it was. */
interface OpenKick {
  readonly step: number;
  readonly knight: Knight;
  readonly x: number;
  readonly y: number;
  readonly shot: boolean;
  onTarget: boolean;
  readonly clearance: boolean;
  /** Steps after which the ball has stopped travelling (a pass) or its flight at goal is over (a shot). */
  readonly deadAt: number;
  readonly shotEndAt: number;
}

type Credit = Extract<Action, { kind: 'tackle' | 'interception' | 'recovery' }>;

/** A change of possession waiting to stand (see POSSESSION_HOLD). */
interface Pending {
  readonly team: TeamId;
  readonly knightId: number;
  readonly step: number;
  readonly credit: Credit | null;
  /** The knight who lost it without a pass or shot, if anyone. */
  readonly loserId: number | null;
}

interface Carry {
  readonly knightId: number;
  /** Rivals seen goal-side during this carry, and those since carried past. */
  readonly goalSide: Set<number>;
  readonly beaten: Set<number>;
}

interface Counters {
  readonly team: TeamId;
  readonly roleSteps: Record<Role, number>;
  touches: number;
  kicks: number;
  carrySteps: number;
  bargeAttempts: number;
}

// Watches a match step by step and says what every knight did, from the state alone: positions, the
// ball's touch record, and the engine's kick, barge and goal events. Feed it every step, in order.
export class StatsRecorder {
  private readonly counters = new Map<number, Counters>();
  private readonly log: Action[] = [];
  private readonly possessionSteps: [number, number] = [0, 0];
  private readonly goals: [number, number] = [0, 0];
  private readonly bargeCooldown = new Map<number, number>();
  private readonly onPitch: number;
  private liveSteps = 0;
  private lot: TeamId | null = null;
  private finished = false;

  /** Touches since the last kick-off, for assists. */
  private chain: Touch[] = [];
  private open: OpenKick | null = null;
  private possession: TeamId | null = null;
  private pending: Pending | null = null;
  private carry: Carry | null = null;
  /** Steps the last toucher has had the ball under control since he took it. */
  private controlSteps = 0;
  /** Knights touching the ball on the last live step, and so far on this one. */
  private touching = new Set<number>();
  private touchingNow = new Set<number>();
  private prevCarrier: Knight | null = null;
  private bargeOnCarrier: { attacker: Knight; victimId: number; step: number } | null = null;

  constructor(state: MatchState) {
    this.onPitch = state.knights.length;
    for (const k of state.knights) this.counter(k);
  }

  /** Call after every `stepMatch`, with that step's number and the events it raised. */
  observe(state: MatchState, step: number, events: readonly MatchEvent[]): void {
    if (this.finished) return;
    this.countBargeAttempts(state);
    const goal = events.find((e) => e.type === 'goal');
    // Inputs, kicks and goals happen only on live steps; contact during kick-off or a celebration is no play.
    if (state.phase === 'play' || goal) {
      this.liveSteps++;
      for (const k of state.knights) this.counter(k).roleSteps[k.role]++;
      for (const e of events) if (e.type === 'barge') this.barge(state, e, step);
      for (const c of contacts(state, events)) this.contact(state, c, step);
      [this.touching, this.touchingNow] = [this.touchingNow, this.touching];
      this.touchingNow.clear();
      this.followCarrier(state, step);
      if (this.pending && step - this.pending.step >= POSSESSION_HOLD) this.confirm();
      if (goal) this.goal(state, goal, step);
    }
    if (state.phase === 'ended') this.finish(state);
  }

  /** The runner settled a golden goal that never came by lot: the score moved without a goal event. */
  decidedByLot(team: TeamId): void {
    this.lot = team;
  }

  get stats(): MatchStats {
    return tally(
      this.log,
      this.counters,
      this.possessionSteps,
      [this.goals[0] + (this.lot === 0 ? 1 : 0), this.goals[1] + (this.lot === 1 ? 1 : 0)],
      this.liveSteps,
      this.onPitch,
      this.lot,
    );
  }

  private counter(k: Knight): Counters {
    let c = this.counters.get(k.id);
    if (!c) {
      c = {
        team: k.team,
        roleSteps: { gk: 0, def: 0, mid: 0, fwd: 0 },
        touches: 0,
        kicks: 0,
        carrySteps: 0,
        bargeAttempts: 0,
      };
      this.counters.set(k.id, c);
    }
    return c;
  }

  /** A barge starts by resetting its cooldown, so a cooldown that went up is an attempt, hit or miss. */
  private countBargeAttempts(state: MatchState): void {
    for (const k of state.knights) {
      if (k.bargeCooldown > (this.bargeCooldown.get(k.id) ?? 0)) this.counter(k).bargeAttempts++;
      this.bargeCooldown.set(k.id, k.bargeCooldown);
    }
  }

  private barge(state: MatchState, e: Extract<MatchEvent, { type: 'barge' }>, step: number): void {
    const attacker = knightById(state, e.attackerId);
    if (!attacker) return;
    this.push({
      kind: 'barge',
      step,
      knightId: attacker.id,
      team: attacker.team,
      x: e.x,
      y: e.y,
      victimId: e.victimId,
    });
    if (this.prevCarrier?.id === e.victimId) this.bargeOnCarrier = { attacker, victimId: e.victimId, step };
  }

  private contact(state: MatchState, c: Contact, step: number): void {
    const { knight } = c;
    const prev = this.chain.at(-1) ?? null;
    const counter = this.counter(knight);
    // A dribble is a run of pushes; it is one touch until someone else plays the ball or he kicks it.
    if (c.kick || (prev?.knightId !== knight.id && !this.touching.has(knight.id))) counter.touches++;
    this.touchingNow.add(knight.id);
    if (c.kick) counter.kicks++;

    let credit: Credit | null = null;
    let resolvedKick = false;
    const open = this.open;
    if (open && open.knight.id !== knight.id) {
      const decided = this.decideKick(state, open, knight, step);
      if (decided.done) this.open = null;
      credit = decided.credit;
      resolvedKick = true;
    } else if (open) {
      // He played his own kick again: a pass becomes a push, a shot a rebound.
      if (open.shot) this.shot(state, open, 'rebound', null);
      this.open = null;
    }
    this.changePossession(state, knight, c.kick, step, prev, resolvedKick ? credit : undefined);
    if (prev?.knightId !== knight.id) this.controlSteps = 0;

    if (c.kick) {
      const reading = readKick(state.ball, state.posts, knight.team);
      this.open = {
        step,
        knight,
        x: state.ball.x,
        y: state.ball.y,
        shot: reading.shot,
        onTarget: reading.onTarget,
        clearance: reading.clearance,
        deadAt: step + reading.fate.deadIn,
        shotEndAt: step + Math.min(reading.fate.deadIn, reading.fate.lineIn),
      };
    }
    this.chain.push({ knightId: knight.id, team: knight.team, step, kick: c.kick });
  }

  // What the open kick was, now that `by` has touched the ball. A pass is completed or lost on its first
  // touch. A shot touched by a rival while still going in stays open: that was a deflection, not a stop.
  private decideKick(
    state: MatchState,
    open: OpenKick,
    by: Knight,
    step: number,
  ): { done: boolean; credit: Credit | null } {
    const { ball } = state;
    const at = { step: open.step, knightId: open.knight.id, team: open.knight.team, x: open.x, y: open.y };
    const gained = (kind: Credit['kind']): Credit => ({
      kind,
      step,
      knightId: by.id,
      team: by.team,
      x: ball.x,
      y: ball.y,
      fromId: open.knight.id,
    });
    const sameSide = by.team === open.knight.team;
    if (open.shot) {
      if (sameSide) {
        this.shot(state, open, 'rebound', null);
        return { done: true, credit: null };
      }
      if (step > open.shotEndAt) {
        this.shot(state, open, 'missed', null);
        return { done: true, credit: gained('recovery') };
      }
      if (ballFate(ball, state.posts).goal === open.knight.team) return { done: false, credit: null };
      const outcome: ShotOutcome = by.role !== 'gk' ? 'blocked' : open.onTarget ? 'saved' : 'claimed';
      this.shot(state, open, outcome, by.id);
      return { done: true, credit: null };
    }
    if (sameSide) {
      this.pass(open, by, ball, true);
      return { done: true, credit: null };
    }
    // A clearance is judged by where it ended: still in the danger zone, it gave the ball away there.
    if (open.clearance && !inDangerZone(ball, open.knight.team)) {
      this.push({ kind: 'clearance', ...at, toX: ball.x, toY: ball.y });
      return { done: true, credit: gained('recovery') };
    }
    this.pass(open, by, ball, false);
    return { done: true, credit: gained(step <= open.deadAt ? 'interception' : 'recovery') };
  }

  private pass(open: OpenKick, receiver: Knight, to: { x: number; y: number }, completed: boolean): void {
    const team = open.knight.team;
    this.push({
      kind: 'pass',
      step: open.step,
      knightId: open.knight.id,
      team,
      x: open.x,
      y: open.y,
      completed,
      receiverId: receiver.id,
      toX: to.x,
      toY: to.y,
      progressive: completed && isProgressive(open, to, team),
    });
  }

  private shot(state: MatchState, open: OpenKick, outcome: ShotOutcome, stopperId: number | null): void {
    const team = open.knight.team;
    const keeper = open.onTarget ? state.knights.find((k) => k.team !== team && k.role === 'gk') : undefined;
    this.push({
      kind: 'shot',
      step: open.step,
      knightId: open.knight.id,
      team,
      x: open.x,
      y: open.y,
      onTarget: open.onTarget,
      outcome,
      stopperId,
      keeperId: keeper?.id ?? null,
    });
  }

  // Possession is a side's until the other side's touch stands (POSSESSION_HOLD). `kickCredit` is what
  // deciding the last kick earned the toucher; undefined when the last touch wasn't an open kick.
  private changePossession(
    state: MatchState,
    by: Knight,
    kick: boolean,
    step: number,
    prev: Touch | null,
    kickCredit: Credit | null | undefined,
  ): void {
    const pending = this.pending;
    if (pending && pending.team !== by.team) this.pending = null;
    else if (pending && (kick || by.id !== pending.knightId)) this.confirm();
    if (this.possession === null) {
      this.possession = by.team;
      return;
    }
    if (this.possession === by.team || this.pending) return;
    const loose = kickCredit === undefined && prev ? this.looseBall(state, prev, by, step) : null;
    this.pending = {
      team: by.team,
      knightId: by.id,
      step,
      credit: kickCredit ?? loose?.credit ?? null,
      loserId: loose?.loserId ?? null,
    };
    if (kick) this.confirm();
  }

  /** Who won the ball when the last touch was a rival's body, not a kick: a barge, a tackle or a pick-up. */
  private looseBall(
    state: MatchState,
    prev: Touch,
    by: Knight,
    step: number,
  ): { credit: Credit; loserId: number | null } {
    const credit = (kind: Credit['kind'], winner: Knight): Credit => ({
      kind,
      step,
      knightId: winner.id,
      team: winner.team,
      x: state.ball.x,
      y: state.ball.y,
      fromId: prev.knightId,
    });
    const barge = this.bargeOnCarrier;
    if (
      barge?.victimId === prev.knightId &&
      barge.attacker.team === by.team &&
      step - barge.step <= BARGE_TACKLE_WINDOW
    )
      return { credit: credit('tackle', barge.attacker), loserId: prev.knightId };
    const hadIt = this.controlSteps >= CONTROL_STEPS;
    if (hadIt && this.prevCarrier?.id === prev.knightId)
      return { credit: credit('tackle', by), loserId: prev.knightId };
    return { credit: credit('recovery', by), loserId: hadIt ? prev.knightId : null };
  }

  private confirm(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.possession = p.team;
    if (p.credit) this.push(p.credit);
    if (p.loserId !== null && p.credit) {
      const { step, x, y } = p.credit;
      this.push({
        kind: 'turnover',
        step,
        knightId: p.loserId,
        team: rivalOf(p.team),
        x,
        y,
        byId: p.credit.knightId,
      });
    }
  }

  /** Possession time, and dribbles: carrying the ball past a rival who was goal-side of it. */
  private followCarrier(state: MatchState, step: number): void {
    const { ball } = state;
    const carrier = carrierOf(state);
    if (carrier) {
      this.possessionSteps[carrier.team]++;
      this.counter(carrier).carrySteps++;
    }
    const last = this.chain.at(-1);
    const own = carrier !== null && carrier.id === ball.lastTouch && last?.knightId === carrier.id;
    const atFeet = own && dist(carrier, ball) < carrier.radius + ball.radius + CONTROL_GAP;
    if (atFeet && Math.hypot(ball.vx - carrier.vx, ball.vy - carrier.vy) <= CONTROL_SPEED)
      this.controlSteps++;
    // A kick ends a carry: the ball has been played.
    if (!own || last.kick) this.carry = null;
    else {
      if (this.carry?.knightId !== carrier.id)
        this.carry = { knightId: carrier.id, goalSide: new Set(), beaten: new Set() };
      const dir = attackDir(carrier.team);
      for (const r of state.knights) {
        if (r.team === carrier.team || this.carry.beaten.has(r.id)) continue;
        const ahead = (r.x - ball.x) * dir;
        if (!this.carry.goalSide.has(r.id)) {
          if (
            ahead >= r.radius &&
            Math.abs(r.y - ball.y) <= DRIBBLE_LANE &&
            dist(r, ball) <= DRIBBLE_ENGAGE &&
            r.stun === 0
          )
            this.carry.goalSide.add(r.id);
        } else if (ahead <= -r.radius && r.stun === 0) {
          this.carry.beaten.add(r.id);
          this.push({
            kind: 'dribble',
            step,
            knightId: carrier.id,
            team: carrier.team,
            x: ball.x,
            y: ball.y,
            pastId: r.id,
          });
        }
      }
    }
    this.prevCarrier = carrier;
  }

  private goal(state: MatchState, e: Extract<MatchEvent, { type: 'goal' }>, step: number): void {
    this.goals[e.team]++;
    const scorer = knightById(state, e.scorerId);
    const open = this.open;
    let fromShot = false;
    if (open?.shot) {
      const ours = open.knight.team === e.team;
      // A shot that went in was on target, even if a deflection put it there.
      if (ours) open.onTarget = true;
      fromShot = ours && !e.ownGoal && scorer?.id === open.knight.id;
      this.shot(state, open, fromShot ? 'goal' : !ours ? 'missed' : e.ownGoal ? 'own-goal' : 'rebound', null);
    }
    if (this.pending) {
      if (this.pending.team === e.team) this.confirm();
      this.pending = null;
    }
    const keeper = state.knights.find((k) => k.team !== e.team && k.role === 'gk');
    const setup = scorer && !e.ownGoal ? this.setup(scorer, step) : null;
    this.push({
      kind: 'goal',
      step,
      knightId: scorer?.id ?? null,
      team: e.team,
      x: state.ball.x,
      y: state.ball.y,
      ownGoal: e.ownGoal,
      assistId: setup && setup.gap <= ASSIST_WINDOW ? setup.knightId : null,
      assistGap: setup?.gap ?? null,
      fromShot,
      keeperId: keeper?.id ?? null,
    });
    this.kickOff();
  }

  // The teammate who touched the ball just before the scorer's last run of touches, unless a rival came in
  // between, and how many steps before the goal. Rival touches after the scorer's are the deflection in.
  private setup(scorer: Knight, step: number): { knightId: number; gap: number } | null {
    let i = this.chain.length - 1;
    while (i >= 0 && this.chain[i]?.knightId !== scorer.id) i--;
    while (i >= 0 && this.chain[i]?.knightId === scorer.id) i--;
    const before = this.chain[i];
    return before?.team === scorer.team ? { knightId: before.knightId, gap: step - before.step } : null;
  }

  private kickOff(): void {
    this.chain = [];
    this.open = null;
    this.possession = null;
    this.pending = null;
    this.carry = null;
    this.controlSteps = 0;
    this.touching.clear();
    this.prevCarrier = null;
    this.bargeOnCarrier = null;
  }

  private finish(state: MatchState): void {
    this.finished = true;
    if (this.open?.shot) this.shot(state, this.open, 'unresolved', null);
    this.confirm();
    this.kickOff();
  }

  private push(action: Action): void {
    this.log.push(action);
  }
}

// Who touched the ball this step, in the engine's order: bodies by knight order, then kicks. A touch zeroes
// its side's touch age, so we see one knight per side per step (of two teammates on one step, the later).
export function contacts(state: MatchState, events: readonly MatchEvent[]): Contact[] {
  const kicks: Contact[] = [];
  for (const e of events) {
    if (e.type !== 'kick') continue;
    const knight = knightById(state, e.knightId);
    if (knight) kicks.push({ knight, kick: true });
  }
  const bodies: Contact[] = [];
  for (const touch of state.ball.teamTouch) {
    if (touch?.age !== 0 || kicks.some((c) => c.knight.team === knightById(state, touch.knightId)?.team))
      continue;
    const knight = knightById(state, touch.knightId);
    if (knight) bodies.push({ knight, kick: false });
  }
  bodies.sort((a, b) => state.knights.indexOf(a.knight) - state.knights.indexOf(b.knight));
  return [...bodies, ...kicks];
}
