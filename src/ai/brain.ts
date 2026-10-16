import { BALL, PITCH, STEP } from '../game/constants';
import type { Input, Knight, MatchState } from '../game/types';
import { clamp, dist, type Vec } from '../game/vec';
import { bankShot, laneBlocked, predictBall, toward } from './geometry';
import { skillFor, type Skill } from './skills';
import { BOTH_DEFAULT, type Tactics, type TeamTactics } from './tactics';

/** Keepers react a little slower than outfielders of the same tier, or nobody could ever score. */
const KEEPER_REACTION_FACTOR = 1.5;
const LEAD_SECONDS = 0.22;
/** cos of the widest angle between knight→ball and the intended direction at which a bot will kick (~20°). */
const LINED_UP = 0.94;

interface Plan {
  /** Target point, in world coordinates. */
  x: number;
  y: number;
  kick: boolean;
  barge: boolean;
}

interface WallLift {
  /** Wall being used: -1 top touchline, +1 bottom touchline. */
  wall: -1 | 1;
  startedAt: number;
}

interface Memory {
  hold: number;
  plan: Plan | null;
  shotY: number | null;
  lift: WallLift | null;
  /** The space this bot is running into while a teammate has the ball. */
  run: Vec | null;
  /** When this bot started dribbling to open a shooting lane (match phase time), if it is. */
  openingSince: number | null;
  /** When the current run was picked (match phase time). */
  runSince: number;
  /** What this bot did off the ball last decision: went for it as the nearest, or covered as the second. */
  duty: 'press' | 'cover' | null;
  /** Id of the opponent this bot is marking or screening off the ball, if any. */
  mark: number | null;
  /** Whether this bot is playing as the team in possession, and the last raw reading and since when. */
  ours: boolean;
  seenOurs: boolean;
  seenSince: number | null;
}

/** A knight or the ball as seen by one bot: mirrored so its own team always attacks to the right. */
interface Seen extends Vec {
  vx: number;
  vy: number;
  radius: number;
  knight?: Knight;
}

interface Context {
  readonly state: MatchState;
  readonly self: Knight;
  readonly skill: Skill;
  readonly tactics: Tactics;
  readonly memory: Memory;
  readonly me: Seen;
  readonly ball: Seen;
  readonly lead: Vec;
  readonly mates: readonly Seen[];
  readonly opponents: readonly Seen[];
  readonly ballDistance: number;
  /** The knight with the ball at its feet, if anyone has it. */
  readonly carrier: Knight | null;
  /** Whether this bot's team has the ball, or touched it last while it is loose, once that has settled. */
  readonly ours: boolean;
  /** Per-decision aim wobble, in radians. */
  readonly aimJitter: number;
}

/** Scripted bots. One instance drives every non-human knight in a match. */
export class BotBrain {
  private readonly memory = new Map<number, Memory>();

  constructor(private tactics: TeamTactics = BOTH_DEFAULT) {}

  /** Takes effect from each bot's next decision, as an instruction from the touchline would. */
  setTactics(tactics: TeamTactics): void {
    this.tactics = tactics;
  }

  input(state: MatchState, self: Knight, dt: number = STEP): Input {
    const skill = skillFor(self.tier);
    let memory = this.memory.get(self.id);
    if (!memory) {
      memory = {
        hold: 0,
        plan: null,
        shotY: null,
        lift: null,
        run: null,
        openingSince: null,
        runSince: 0,
        duty: null,
        mark: null,
        ours: false,
        seenOurs: false,
        seenSince: null,
      };
      this.memory.set(self.id, memory);
    }
    memory.hold -= dt;
    if (memory.hold <= 0 || !memory.plan) {
      const slow = self.role === 'gk' ? KEEPER_REACTION_FACTOR : 1;
      memory.hold = skill.reaction * slow * (0.7 + state.rng.next() * 0.6);
      memory.plan = decide(buildContext(state, self, skill, this.tactics[self.team], memory));
    }
    const plan = memory.plan;
    const safe = avoidOwnGoal(state, self, plan);
    const input: Input = { moveX: 0, moveY: 0, kick: safe.kick, barge: plan.barge };
    plan.barge = false;
    const dx = safe.x - self.x;
    const dy = safe.y - self.y;
    const d = Math.hypot(dx, dy);
    if (d > 4) {
      const ease = Math.min(1, d / 28);
      input.moveX = (dx / d) * ease;
      input.moveY = (dy / d) * ease;
    }
    return input;
  }
}

const mirrorX = (team: number, x: number): number => (team === 0 ? x : PITCH.width - x);

/** The last toucher still has the ball while it is this close to him. */
const CARRY_REACH = 60;
/** Gap between a knight's edge and the ball inside which it has the ball, touched or not. */
const CONTROL_GAP = 12;

/** Seconds a change of possession must last before off-ball bots switch between attacking and defending. */
const TRANSITION_SETTLE = 0.3;

/** Debounced possession, so a scramble of alternating touches doesn't send the team back and forth. */
function settledPossession(memory: Memory, ours: boolean, now: number): boolean {
  if (memory.seenSince === null) memory.ours = ours;
  if (memory.seenSince === null || ours !== memory.seenOurs || now < memory.seenSince) {
    memory.seenOurs = ours;
    memory.seenSince = now;
  }
  if (now - memory.seenSince >= TRANSITION_SETTLE) memory.ours = ours;
  return memory.ours;
}

/** Who has the ball: its last toucher while still close to it, otherwise any knight touching it. */
function carrierOf(state: MatchState): Knight | null {
  const { ball, knights } = state;
  const toucher = knights.find((k) => k.id === ball.lastTouch);
  if (toucher && dist(toucher, ball) < CARRY_REACH) return toucher;
  return knights.find((k) => dist(k, ball) < k.radius + ball.radius + CONTROL_GAP) ?? null;
}

/** Within this distance of its own goal line, a bot takes care not to push the ball goalward. */
const OWN_GOAL_DANGER = 360;
/** Clearance kept from the ball when stepping round it. */
const DETOUR_GAP = 16;

/**
 * Checked every step against live positions, because a plan made a reaction ago can walk straight
 * through a ball that has since rolled behind the bot. Near its own goal a bot never kicks the ball
 * goalward, and never walks through it goalward: it steps round it instead.
 */
function avoidOwnGoal(state: MatchState, self: Knight, plan: Plan): { x: number; y: number; kick: boolean } {
  const { ball } = state;
  const ownGoalX = self.team === 0 ? PITCH.left : PITCH.right;
  const towardOwnGoal = self.team === 0 ? -1 : 1;
  if (Math.abs(ball.x - ownGoalX) > OWN_GOAL_DANGER) return plan;

  const bx = ball.x - self.x;
  const by = ball.y - self.y;
  const ballDist = Math.hypot(bx, by) || 1;
  const kick = plan.kick && (bx / ballDist) * towardOwnGoal < 0.3;

  const px = plan.x - self.x;
  const py = plan.y - self.y;
  const len = Math.hypot(px, py);
  if (len < 1 || (px / len) * towardOwnGoal < 0.2) return { x: plan.x, y: plan.y, kick };
  const along = (bx * px + by * py) / len;
  if (along <= 0 || along > len + ball.radius) return { x: plan.x, y: plan.y, kick };
  const miss = Math.hypot(ball.x - (self.x + (px / len) * along), ball.y - (self.y + (py / len) * along));
  if (miss > self.radius + ball.radius + 4) return { x: plan.x, y: plan.y, kick };

  // Step to the side of the ball we're already on, level with it; from there the way goal-side is clear.
  const side = Math.sign(self.y - ball.y) || (ball.y > PITCH.centerY ? -1 : 1);
  return { x: ball.x - towardOwnGoal * 4, y: ball.y + side * (self.radius + ball.radius + DETOUR_GAP), kick };
}

function buildContext(
  state: MatchState,
  self: Knight,
  skill: Skill,
  tactics: Tactics,
  memory: Memory,
): Context {
  const sign = self.team === 0 ? 1 : -1;
  const see = (
    o: { x: number; y: number; vx: number; vy: number; radius: number },
    knight?: Knight,
  ): Seen => ({
    x: mirrorX(self.team, o.x),
    y: o.y,
    vx: sign * o.vx,
    vy: o.vy,
    radius: o.radius,
    ...(knight ? { knight } : {}),
  });
  const ball = see(state.ball);
  let lead: Vec;
  if (skill.anticipation === 'none') lead = { x: ball.x, y: ball.y };
  else if (skill.anticipation === 'linear')
    lead = { x: ball.x + ball.vx * LEAD_SECONDS, y: ball.y + ball.vy * LEAD_SECONDS };
  else {
    const p = predictBall(state.ball, LEAD_SECONDS);
    lead = { x: mirrorX(self.team, p.x), y: p.y };
  }
  const me = see(self, self);
  const carrier = carrierOf(state);
  const toucher = carrier ?? state.knights.find((k) => k.id === state.ball.lastTouch);
  return {
    state,
    self,
    skill,
    tactics,
    memory,
    me,
    ball,
    lead,
    mates: state.knights.filter((k) => k.team === self.team && k !== self).map((k) => see(k, k)),
    opponents: state.knights.filter((k) => k.team !== self.team).map((k) => see(k, k)),
    ballDistance: dist(me, ball),
    carrier,
    ours: settledPossession(memory, toucher?.team === self.team, state.phaseTime),
    aimJitter: (state.rng.next() * 2 - 1) * skill.aimError,
  };
}

function decide(ctx: Context): Plan {
  const plan = ctx.self.role === 'gk' ? keep(ctx) : (wallLift(ctx) ?? outfield(ctx));
  const barge = ctx.self.role !== 'gk' ? bargeTarget(ctx) : null;
  const target = barge ?? plan;
  return { x: mirrorX(ctx.self.team, target.x), y: target.y, kick: plan.kick, barge: barge !== null };
}

// ------------------------------------------------------------------ positioning

function isClosest(ctx: Context, among: readonly Seen[]): boolean {
  return among.every((o) => dist(o, ctx.ball) > ctx.ballDistance);
}

const outfieldMates = (ctx: Context): Seen[] => ctx.mates.filter((m) => m.knight?.role !== 'gk');

const OWN_GOAL: Vec = { x: PITCH.left, y: PITCH.centerY };
/** A presser or cover keeps the job until a teammate is this much nearer the ball, so two don't keep swapping. */
const DUTY_HYSTERESIS = 20;
/** How far goal-side of a loose ball the second man waits for the rebound. */
const SECOND_BALL_GAP = 70;
/** How far goal-side of an attacker a marker stands. */
const MARK_GAP = 34;
/** How far along the lane from the ball to the attacker a lane cover stands. */
const LANE_CUT = 0.55;
/** How much a clear pass to an attacker adds to his danger, in px of closeness to goal. */
const OPEN_LANE_DANGER = 160;
/** How far goal-side of the ball the midfielder screens, and how far ahead of it the forward waits. */
const SCREEN_GAP = 110;

/**
 * What the line tactic moves, in the positioning code's own units; `normal` holds the original values.
 * depth: how far behind the ball the defender holds the line. floor: the nearest it comes to goal.
 * screen: the midfielder's gap goal-side of the ball. support: the furthest the defender pushes up in
 * possession. roleDepth: added to the Squire's share of the pitch held behind the ball.
 */
const LINES = {
  deep: { depth: 270, floor: 110, screen: 80, support: PITCH.right - 420, roleDepth: -0.1 },
  normal: { depth: 200, floor: 140, screen: SCREEN_GAP, support: PITCH.right - 320, roleDepth: 0 },
  high: { depth: 130, floor: 200, screen: 150, support: PITCH.right - 230, roleDepth: 0.1 },
} as const satisfies Record<Tactics['line'], object>;

/** With a low press the nearest knight only steps out while the ball is this far into the rivals' half, at most. */
const LOW_PRESS_REACH = 40;
/** Until then he stands this far goal-side of the ball, in the carrier's way, without diving in. */
const CONTAIN_GAP = 40;
/** A high press sends the second nearest too once the ball is this far into the rivals' half. */
const HIGH_PRESS_LINE = 100;
/** An attacker this far nearer our goal than the ball has run in behind and gets marked. */
const IN_BEHIND = 40;
/** How far along the lane to the carrier's outlet the forward stands to cut the pass back. */
const OUTLET_CUT = 0.45;

/** How many teammates are nearer the ball and able to play it. */
function ballRank(ctx: Context): number {
  const slack = ctx.memory.duty ? DUTY_HYSTERESIS : 0;
  return outfieldMates(ctx).filter(
    (m) => (m.knight?.stun ?? 0) <= 0 && dist(m, ctx.ball) < ctx.ballDistance - slack,
  ).length;
}

const at = (p: Vec): Plan => hold(p.x, p.y);

function outfield(ctx: Context): Plan {
  const { skill, self, memory, carrier, ours } = ctx;
  if (skill.positioning === 'swarm' || carrier === self) return carry(ctx);

  const rank = ballRank(ctx);
  const pressing = presses(ctx, rank);
  memory.duty = pressing ? 'press' : null;
  if (!ours || pressing) memory.run = null;
  if (pressing) return carry(ctx);
  if (carrier && carrier.team !== self.team && rank === 0 && ctx.tactics.press === 'low')
    return at(toward(ctx.ball, OWN_GOAL, CONTAIN_GAP));
  if (!carrier && !ours && rank === 1 && skill.contest > 1) {
    memory.duty = 'cover';
    return at(toward(ctx.lead, OWN_GOAL, SECOND_BALL_GAP));
  }
  if (carrier && !ours && rank === 1) {
    const second = cover(ctx);
    if (second) {
      memory.duty = 'cover';
      return second;
    }
  }
  if (skill.positioning === 'roles') return roleSpot(ctx);
  if (ours) return self.role === 'def' ? supportAngle(ctx) : runIntoSpace(ctx);
  return shape(ctx);
}

/**
 * Whether this bot goes for the ball. The nearest always contests a loose ball. Against a rival carrier,
 * a low press sits off him until he reaches our half and then sends two; a high press sends two deep in his.
 */
function presses({ tactics, carrier, self, ball }: Context, rank: number): boolean {
  if (carrier?.team === self.team) return false;
  const ourHalf = ball.x < PITCH.centerX + LOW_PRESS_REACH;
  if (rank === 0) return tactics.press !== 'low' || !carrier || ourHalf;
  if (rank !== 1 || !carrier) return false;
  if (tactics.press === 'high') return ball.x > PITCH.centerX + HIGH_PRESS_LINE;
  return tactics.press === 'low' && ourHalf;
}

/** Opponents who could receive a pass from the carrier. */
const attackers = (ctx: Context): Seen[] =>
  ctx.opponents.filter((o) => o.knight !== ctx.carrier && o.knight?.role !== 'gk');

/** Score bonus, in px, for the opponent already being tracked, so a bot doesn't flick between two. */
const TRACK_STICKINESS = 40;

/** The best-scoring opponent to track, favouring the current one. */
function track(ctx: Context, among: readonly Seen[], score: (o: Seen) => number): Seen | undefined {
  const keep = (o: Seen): number => score(o) + (o.knight?.id === ctx.memory.mark ? TRACK_STICKINESS : 0);
  const best = among.reduce<Seen | undefined>((b, o) => (!b || keep(o) > keep(b) ? o : b), undefined);
  ctx.memory.mark = best?.knight?.id ?? null;
  return best;
}

/** The second defender: mark the most advanced attacker goal-side, or stand in the most dangerous lane. */
function cover(ctx: Context): Plan | null {
  const { skill, ball } = ctx;
  if (skill.cover === 'none') return null;
  if (skill.cover === 'mark') {
    const runner = track(ctx, attackers(ctx), (o) => -dist(o, OWN_GOAL));
    return runner ? at(toward(runner, OWN_GOAL, MARK_GAP)) : null;
  }
  const danger = (o: Seen): number =>
    -dist(o, OWN_GOAL) + (laneBlocked(ball, o, ctx.mates, BALL.radius + 6) ? 0 : OPEN_LANE_DANGER);
  const threat = track(ctx, attackers(ctx), danger);
  return threat ? at(toward(ball, threat, dist(ball, threat) * LANE_CUT)) : null;
}

/** Squire positions: each role holds its own spot, shifted with the ball. */
function roleSpot(ctx: Context): Plan {
  const { ball, self, ours, tactics } = ctx;
  const y = PITCH.centerY + (ball.y - PITCH.centerY) * 0.55;
  if (self.role === 'fwd')
    return hold(clamp(ball.x + (ours ? 170 : 110), PITCH.left + 200, PITCH.right - 90), y);
  const depth = (self.role === 'def' ? 0.45 : 0.7) + LINES[tactics.line].roleDepth;
  return hold(Math.min(PITCH.left + (ball.x - PITCH.left) * depth, PITCH.centerX - 50), y);
}

/** Out of possession, beyond the press and the cover: a compact block that moves with the ball and the runners. */
function shape(ctx: Context): Plan {
  const { ball, me, self } = ctx;
  const line = LINES[ctx.tactics.line];
  switch (self.role) {
    case 'def': {
      if (ball.x < me.x - 10) return carry(ctx);
      const deepest = track(ctx, attackers(ctx), (o) => -o.x);
      if (deepest && deepest.x < ball.x - IN_BEHIND) return at(toward(deepest, OWN_GOAL, MARK_GAP));
      return at(toward(OWN_GOAL, ball, Math.max(line.floor, dist(OWN_GOAL, ball) - line.depth)));
    }
    case 'mid':
      return at(toward(ball, OWN_GOAL, line.screen));
    default: {
      const outlet = track(ctx, attackers(ctx), (o) => o.x);
      if (outlet && outlet.x > ball.x) return at(toward(ball, outlet, dist(ball, outlet) * OUTLET_CUT));
      return at(toward(ball, OWN_GOAL, -SCREEN_GAP));
    }
  }
}

/** How far behind the ball the defender offers the pass back, angled toward the middle. */
const SUPPORT_DEPTH = 170;
const SUPPORT_ANGLE = 0.35;

/** The defender in possession: behind the ball for the pass back, between it and the middle, never so far up a counter gets in behind. */
const supportAngle = ({ ball, tactics }: Context): Plan =>
  hold(
    clamp(ball.x - SUPPORT_DEPTH, PITCH.left + 120, LINES[tactics.line].support),
    PITCH.centerY + (ball.y - PITCH.centerY) * SUPPORT_ANGLE,
  );

/** How far ahead of the ball runs are considered, and across which lanes. */
const RUN_DEPTHS = [110, 190, 270] as const;
const RUN_LANES = [-190, -100, 0, 100, 190] as const;
/** Keep the current run unless another spot is clearly better, so runners don't dither. */
const RUN_STICKINESS = 25;
/** A runner this close to his spot has arrived and, without the ball, makes a fresh movement. */
const RUN_ARRIVED = 22;
/** A fresh movement goes at least this far, so it reads as a new run rather than a shuffle. */
const RUN_FRESH = 70;
/** Seconds a new run is followed before it is reconsidered, unless its passing lane closes. */
const RUN_COMMIT = 0.6;

/**
 * A forward run while a teammate has the ball: head for open grass ahead of it that the carrier can
 * reach with a clear pass, so there is always an option beyond the defence. A runner who arrives and
 * isn't found goes again, as a real one would, rather than standing on his spot.
 */
function runIntoSpace(ctx: Context): Plan {
  const { ball, me, memory, opponents } = ctx;
  const now = ctx.state.phaseTime;
  const committed = memory.run !== null && now - memory.runSince < RUN_COMMIT && now >= memory.runSince;
  if (committed && memory.run && !blocked(ctx, ball, memory.run)) return at(memory.run);
  const score = (p: Vec): number => {
    const space = Math.min(200, ...opponents.map((o) => dist(o, p)));
    const lane = blocked(ctx, ball, p) ? -150 : 0;
    return space + (p.x - ball.x) * 0.4 - dist(me, p) * 0.3 + lane;
  };
  const arrived = memory.run !== null && dist(me, memory.run) < RUN_ARRIVED;
  let best: Vec | null = null;
  let bestScore = -Infinity;
  for (const depth of RUN_DEPTHS) {
    for (const lane of RUN_LANES) {
      const p = {
        x: clamp(ball.x + depth, PITCH.left + 120, PITCH.right - 70),
        y: clamp(PITCH.centerY + lane, PITCH.top + 40, PITCH.bottom - 40),
      };
      if (arrived && dist(me, p) < RUN_FRESH) continue;
      const s = score(p);
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
  }
  if (!memory.run || arrived || !best || bestScore > score(memory.run) + RUN_STICKINESS) {
    memory.run = best;
    memory.runSince = now;
  }
  return at(memory.run ?? { x: ball.x + RUN_DEPTHS[1], y: PITCH.centerY });
}

const hold = (x: number, y: number): Plan => ({ x, y, kick: false, barge: false });

function keep(ctx: Context): Plan {
  const { ball, lead, self, skill } = ctx;
  if (skill.keeping === 'line') {
    if (dist(ball, OWN_GOAL) < 150 && ctx.ballDistance < 180) {
      const p = carry(ctx);
      return { ...p, x: Math.min(p.x, PITCH.left + 220) };
    }
    return {
      x: PITCH.left + 22 + clamp((ball.x - PITCH.left) * 0.03, 0, 18),
      y: clamp(PITCH.centerY + (lead.y - PITCH.centerY) * 0.55, PITCH.goalTop + 4, PITCH.goalBottom - 4),
      kick: ctx.ballDistance < self.radius + BALL.radius + 8,
      barge: false,
    };
  }
  // Cut the angle: stand on the line from the goal centre to the ball.
  const gx = lead.x - PITCH.left;
  const gy = lead.y - PITCH.centerY;
  const gd = Math.hypot(gx, gy) || 1;
  if (gd < 210 && isClosest(ctx, ctx.mates)) {
    const p = carry(ctx);
    return { ...p, x: Math.min(p.x, PITCH.left + 280) };
  }
  const out = 40;
  return {
    x: Math.max(PITCH.left + 26, PITCH.left + (gx / gd) * out),
    y: clamp(PITCH.centerY + (gy / gd) * out, PITCH.goalTop - 20, PITCH.goalBottom + 20),
    kick: ctx.ballDistance < self.radius + BALL.radius + 8,
    barge: false,
  };
}

// ------------------------------------------------------------------ on the ball

/** Moves to play the ball toward `aim`. Kicks once lined up, unless dribbling. */
function attack(ctx: Context, aim: Vec, dribble: boolean): Plan {
  const { lead, me, ball, self, ballDistance } = ctx;
  let ux = aim.x - lead.x;
  let uy = aim.y - lead.y;
  const ul = Math.hypot(ux, uy) || 1;
  const cos = Math.cos(ctx.aimJitter);
  const sin = Math.sin(ctx.aimJitter);
  [ux, uy] = [(ux / ul) * cos - (uy / ul) * sin, (ux / ul) * sin + (uy / ul) * cos];

  const ahead = (me.x - lead.x) * ux + (me.y - lead.y) * uy;
  if (ahead > -6) {
    // On the wrong side of the ball: loop around it instead of knocking it backwards.
    const px = -uy;
    const py = ux;
    const side = Math.sign((me.x - lead.x) * px + (me.y - lead.y) * py) || 1;
    return hold(lead.x - ux * 36 + px * side * 30, lead.y - uy * 36 + py * side * 30);
  }
  const bx = (ball.x - me.x) / (ballDistance || 1);
  const by = (ball.y - me.y) / (ballDistance || 1);
  const lined = ballDistance < self.radius + BALL.radius + 18 && bx * ux + by * uy > LINED_UP;
  const clearance =
    ball.x < PITCH.left + 200 && ballDistance < self.radius + BALL.radius + 16 && ball.x > me.x;
  if (lined) return { x: ball.x + ux * 18, y: ball.y + uy * 18, kick: !dribble || clearance, barge: false };
  return {
    x: lead.x - ux * (self.radius + 6),
    y: lead.y - uy * (self.radius + 6),
    kick: clearance,
    barge: false,
  };
}

function shotTarget(ctx: Context): Vec {
  const goalX = PITCH.right + 12;
  if (!ctx.skill.aimsOpenSide) return { x: goalX, y: PITCH.centerY };
  const keeper = ctx.opponents.find((o) => o.knight?.role === 'gk');
  if (keeper && keeper.x > PITCH.right - 220) {
    return { x: goalX, y: keeper.y > PITCH.centerY ? PITCH.goalTop + 24 : PITCH.goalBottom - 24 };
  }
  if (ctx.memory.shotY === null || ctx.ballDistance > 160) {
    ctx.memory.shotY = PITCH.centerY + (ctx.state.rng.next() - 0.5) * (PITCH.goalBottom - PITCH.goalTop - 60);
  }
  return { x: goalX, y: ctx.memory.shotY };
}

const blocked = (ctx: Context, from: Vec, to: Vec): boolean =>
  laneBlocked(from, to, ctx.opponents, BALL.radius + 6);

function passTarget(ctx: Context): Vec | null {
  const { skill, ball } = ctx;
  const candidates = outfieldMates(ctx).filter((m) => (m.knight?.stun ?? 0) <= 0);
  if (skill.passing === 'never' || candidates.length === 0) return null;

  if (skill.passing === 'when-blocked') {
    const ahead = candidates.filter((m) => m.x > ball.x - 40).sort((a, b) => dist(a, ball) - dist(b, ball));
    return ahead[0] ?? null;
  }

  const leadTime = skill.passing === 'through-balls' ? 0.6 : 0.35;
  let best: Vec | null = null;
  let bestScore = -Infinity;
  for (const m of candidates) {
    const spot = { x: m.x + m.vx * leadTime, y: m.y + m.vy * leadTime };
    const gain = spot.x - ball.x;
    const d = dist(ball, spot);
    if (gain < -40 || d < 70 || d > 430) continue;
    const space = Math.min(...ctx.opponents.map((o) => dist(o, spot)));
    if (space < 70) continue;
    let aim: Vec | null = blocked(ctx, ball, spot) ? null : spot;
    if (!aim && skill.bankPasses) aim = bankAim(ctx, spot);
    if (!aim) continue;
    const score = gain + space * 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = aim;
    }
  }
  return best;
}

/** Off-the-wall route to `target` whose two legs are both clear, preferring the shorter bounce. */
function bankAim(ctx: Context, target: Vec): Vec | null {
  const walls = [PITCH.top + BALL.radius, PITCH.bottom - BALL.radius].sort(
    (a, b) => Math.abs(ctx.ball.y - a) - Math.abs(ctx.ball.y - b),
  );
  for (const wallY of walls) {
    const shot = bankShot(ctx.ball, target, wallY, BALL.wallRestitution);
    if (shot && !blocked(ctx, ctx.ball, shot.bounce) && !blocked(ctx, shot.bounce, target)) return shot.aim;
  }
  return null;
}

/**
 * What the shooting tactic changes; `normal` holds the original values. range: multiplies the tier's
 * shot range. passChance: how often an open pass is taken over a long shot. patience: seconds spent
 * looking for a clear lane before shooting anyway.
 */
const SHOOTING = {
  patient: { range: 0.8, passChance: 0.55, patience: 1 },
  normal: { range: 1, passChance: 0.35, patience: 0.6 },
  early: { range: 1.1, passChance: 0.15, patience: 0.25 },
} as const satisfies Record<Tactics['shooting'], object>;
/** An opponent this close to the ball means shoot now, or lose it. */
const PRESSURE_DISTANCE = 55;

/** Sideways and slightly forward dribble offsets tried when looking for a clear shot. */
const LANE_STEPS = [-110, -60, 60, 110] as const;
const GOAL_AIMS = [PITCH.goalTop + 24, PITCH.centerY, PITCH.goalBottom - 24] as const;

/**
 * A nearby spot to carry the ball to from which some part of the goal is in clear view. Prefers short
 * moves away from opponents, so the shot comes before the defence can shift across.
 */
function laneOpening(ctx: Context): Vec | null {
  const { ball, opponents } = ctx;
  let best: Vec | null = null;
  let bestScore = -Infinity;
  for (const dy of LANE_STEPS) {
    for (const dx of [0, 30]) {
      const spot = {
        x: clamp(ball.x + dx, PITCH.left + 40, PITCH.right - 40),
        y: clamp(ball.y + dy, PITCH.top + 24, PITCH.bottom - 24),
      };
      if (!GOAL_AIMS.some((y) => !blocked(ctx, spot, { x: PITCH.right + 12, y }))) continue;
      const space = Math.min(160, ...opponents.map((o) => dist(o, spot)));
      const score = space * 0.5 - Math.abs(dy);
      if (score > bestScore) {
        bestScore = score;
        best = spot;
      }
    }
  }
  return best;
}

/** On or going for the ball: shoot, pass, bank it, or dribble closer. */
function carry(ctx: Context): Plan {
  const { skill, ball, self } = ctx;
  const shooting = SHOOTING[ctx.tactics.shooting];
  const shot = shotTarget(ctx);
  const far = dist(ball, shot) > skill.shotRange * shooting.range;
  const onBall = ctx.ballDistance < self.radius + BALL.radius + 60;
  const shotBlocked = blocked(ctx, ball, shot);

  if (onBall && (shotBlocked || far)) {
    const pass = passTarget(ctx);
    if (pass && (shotBlocked || ctx.state.rng.next() < shooting.passChance)) return attack(ctx, pass, false);
    if (shotBlocked && skill.bankPasses && !far) {
      const bank = bankAim(ctx, shot);
      if (bank) return attack(ctx, bank, false);
    }
    if (shotBlocked && skill.opensLanes && !far) {
      const now = ctx.state.phaseTime;
      ctx.memory.openingSince ??= now;
      const pressed = ctx.opponents.some((o) => dist(o, ball) < o.radius + PRESSURE_DISTANCE);
      const opening = !pressed && now - ctx.memory.openingSince < shooting.patience ? laneOpening(ctx) : null;
      if (opening) return attack(ctx, opening, true);
    }
  }
  if (!onBall || !shotBlocked || far) ctx.memory.openingSince = null;
  const deep = self.role === 'gk' || ball.x < PITCH.left + 260;
  return attack(ctx, shot, far && !deep);
}

// ------------------------------------------------------------------ techniques

/** Tap angle for the wall lift: mostly into the wall, partly forward, so the rebound comes off ahead of us. */
const LIFT_TAP = { forward: 0.5, intoWall: Math.sqrt(1 - 0.5 ** 2) } as const;

/**
 * The wall lift: with the ball pinned between you and a touchline, step diagonally behind it
 * and tap it into the wall at an angle. The rebound comes off the wall ahead of you and away
 * from it, into open space, where normal play takes over and carries it into the middle.
 */
function wallLift(ctx: Context): Plan | null {
  const { skill, memory, ball, me, self, state } = ctx;
  if (!skill.wallLift) return null;
  const now = state.phaseTime;
  const lift = memory.lift;
  if (lift && (state.phase !== 'play' || now < lift.startedAt || now - lift.startedAt > 1))
    memory.lift = null;

  const reach = self.radius + BALL.radius + 4;
  if (!memory.lift) {
    const wall: -1 | 1 = ball.y < PITCH.centerY ? -1 : 1;
    const wallY = wall < 0 ? PITCH.top : PITCH.bottom;
    const nearWall = Math.abs(ball.y - wallY) < BALL.radius + 26;
    const pinned = wall < 0 ? me.y - ball.y > 4 : ball.y - me.y > 4;
    const pressed = ctx.opponents.some((o) => dist(o, ball) < 140);
    if (!(ctx.ballDistance < reach + 12 && nearWall && pinned && pressed)) return null;
    memory.lift = { wall, startedAt: now };
  }
  const { wall } = memory.lift;

  // Our fresh kick landing on the ball means the tap is done; hand back to normal play.
  if (state.ball.lastTouch === self.id && self.kickCooldown > 0) {
    memory.lift = null;
    return null;
  }
  const ux = LIFT_TAP.forward;
  const uy = wall * LIFT_TAP.intoWall;
  const spot = { x: ball.x - ux * (reach - 2), y: ball.y - uy * (reach - 2) };
  const toBall = {
    x: (ball.x - me.x) / (ctx.ballDistance || 1),
    y: (ball.y - me.y) / (ctx.ballDistance || 1),
  };
  const lined = ctx.ballDistance <= reach && toBall.x * ux + toBall.y * uy > 0.9;
  return { x: spot.x, y: spot.y, kick: lined, barge: false };
}

function bargeTarget(ctx: Context): Vec | null {
  const { self, skill, ball, me, state } = ctx;
  if (self.bargeCooldown > 0) return null;
  for (const o of ctx.opponents) {
    if ((o.knight?.stun ?? 0) > 0) continue;
    if (dist(o, ball) < o.radius + 24 && dist(o, me) < 105 && state.rng.next() < skill.bargeRate)
      return { x: o.x, y: o.y };
  }
  return null;
}
