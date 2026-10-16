import { BotBrain } from '../ai/brain';
import { BOTH_DEFAULT, withTactics, type Tactics, type TeamTactics } from '../ai/tactics';
import { STEP } from '../game/constants';
import { createMatch, stepMatch, substitute, swapRoles, type KnightSpec } from '../game/match';
import type { Input, Knight, MatchState, TeamId } from '../game/types';

/** A change from the touchline. */
export type ManagerAction =
  | { readonly kind: 'tactics'; readonly tactics: Tactics }
  | { readonly kind: 'substitution'; readonly offId: number; readonly on: KnightSpec }
  /** Two knights on the pitch, by runner id, swap roles. Free: it isn't a substitution. */
  | { readonly kind: 'positions'; readonly a: number; readonly b: number };

/** An action and the simulation step it took effect on. */
export interface TimedAction {
  readonly step: number;
  readonly team: TeamId;
  readonly action: ManagerAction;
}

/** A goal as it happened: the runner knight credited (null if nobody touched it), and the step. */
export interface GoalLog {
  readonly team: TeamId;
  readonly scorerId: number | null;
  readonly ownGoal: boolean;
  readonly step: number;
}

/** An AI manager: looks at the match once a second and may make a change. Must be deterministic. */
export type Manager = (state: MatchState, team: TeamId) => ManagerAction | null;

export interface FixtureConfig {
  readonly home: readonly KnightSpec[];
  readonly away: readonly KnightSpec[];
  readonly seed: number;
  readonly tactics?: TeamTactics;
  readonly draws?: boolean;
  readonly managers?: readonly [Manager | null, Manager | null];
}

const MANAGER_EVERY = Math.round(1 / STEP);
/** Substitutions each side may make in a match. */
export const SUBS_ALLOWED = 1;
/** Ten minutes of golden goal: bots settle it well within one, so this only guards the loop. */
const GOLDEN_GOAL_LIMIT = 600 / STEP;

/** One match, step by step, for the screen and headless play alike: any speed, a skip or a replay plays the same. */
export class MatchRunner {
  readonly state: MatchState;
  private readonly brain: BotBrain;
  private tactics: TeamTactics;
  private steps = 0;
  private goldenSteps = 0;
  private readonly subs: [number, number] = [0, 0];
  private readonly pending: { team: TeamId; action: ManagerAction }[] = [];
  private readonly recorded: TimedAction[] = [];
  private readonly scored: GoalLog[] = [];
  private readonly scheduled: readonly TimedAction[];

  constructor(
    private readonly config: FixtureConfig,
    scheduled: readonly TimedAction[] = [],
  ) {
    this.state = createMatch({
      home: config.home,
      away: config.away,
      seed: config.seed,
      draws: config.draws ?? false,
    });
    this.tactics = config.tactics ?? BOTH_DEFAULT;
    this.brain = new BotBrain(this.tactics);
    this.scheduled = [...scheduled].sort((a, b) => a.step - b.step);
  }

  get step(): number {
    return this.steps;
  }

  get ended(): boolean {
    return this.state.phase === 'ended';
  }

  tacticsOf(team: TeamId): Tactics {
    return this.tactics[team];
  }

  subsLeft(team: TeamId): number {
    return SUBS_ALLOWED - this.subs[team];
  }

  /** Changes made through `act` (not by AI managers, who decide again on replay), for saving or replaying. */
  get timeline(): readonly TimedAction[] {
    return this.recorded;
  }

  /** Every goal so far, kept even when the events themselves are discarded (as `advance` does). */
  get goals(): readonly GoalLog[] {
    return this.scored;
  }

  act(team: TeamId, action: ManagerAction): void {
    this.pending.push({ team, action });
  }

  /** One fixed step. `human` overrides the bot for any knight it returns an input for. */
  advanceOne(human?: (k: Knight) => Input | null): void {
    if (this.ended) return;
    for (const timed of this.scheduled) if (timed.step === this.steps) this.pending.push(timed);
    for (const { team, action } of this.pending.splice(0)) {
      if (this.apply(team, action)) this.recorded.push({ step: this.steps, team, action });
    }
    if (this.steps % MANAGER_EVERY === 0) {
      this.config.managers?.forEach((manager, team) => {
        const action = manager?.(this.state, team as TeamId);
        if (action) this.apply(team as TeamId, action);
      });
    }

    stepMatch(this.state, (k) => human?.(k) ?? this.brain.input(this.state, k));
    for (const e of this.state.events)
      if (e.type === 'goal')
        this.scored.push({ team: e.team, scorerId: e.scorerId, ownGoal: e.ownGoal, step: this.steps });
    this.steps++;
    if (this.state.goldenGoal && ++this.goldenSteps > GOLDEN_GOAL_LIMIT) {
      // Never seen in testing; settle it by lot so a season or bracket can always go on.
      this.state.score[this.state.rng.next() < 0.5 ? 0 : 1] += 1;
      this.state.phase = 'ended';
    }
  }

  /** Plays up to `steps` steps without drawing; events are discarded. */
  advance(steps: number): void {
    for (let i = 0; i < steps && !this.ended; i++) {
      this.advanceOne();
      this.state.events = [];
    }
  }

  /** Whether the action was allowed and made. */
  private apply(team: TeamId, action: ManagerAction): boolean {
    if (action.kind === 'tactics') {
      this.tactics = withTactics(this.tactics, team, action.tactics);
      this.brain.setTactics(this.tactics);
      return true;
    }
    if (action.kind === 'positions') return this.swap(team, action.a, action.b);
    const off = this.state.knights.find((k) => k.id === action.offId);
    if (off?.team !== team || this.subs[team] >= SUBS_ALLOWED) return false;
    substitute(this.state, action.offId, action.on);
    this.subs[team]++;
    return true;
  }

  private swap(team: TeamId, a: number, b: number): boolean {
    const onPitch = (id: number): boolean => this.state.knights.some((k) => k.id === id && k.team === team);
    if (a === b || !onPitch(a) || !onPitch(b)) return false;
    swapRoles(this.state, a, b);
    this.brain.reassign(a);
    this.brain.reassign(b);
    return true;
  }
}
