import type { Look } from '../knight/look';
import {
  extraShotRange,
  knockbackOf,
  NO_ATTRIBUTES,
  shotFactor,
  strengthFactor,
  stunOf,
  type Attributes,
} from './attributes';
import { BALL, BUILDS, KNIGHT, MATCH, PITCH, POST, STEP } from './constants';
import { kickoffSpot } from './formation';
import { capSpeed, collide, stepBall, stepKnight } from './physics';
import { createRng } from './rng';
import {
  NO_INPUT,
  type Ball,
  type Body,
  type Input,
  type Knight,
  type MatchState,
  type Role,
  type TeamId,
} from './types';

export interface KnightSpec {
  readonly look: Look;
  readonly role: Role;
  readonly human: boolean;
  readonly tier: number;
  readonly speedFactor: number;
  /** Trained stats on top of the build; absent means none, exactly as before attributes existed. */
  readonly attributes?: Attributes;
}

export interface MatchConfig {
  readonly home: readonly KnightSpec[];
  readonly away: readonly KnightSpec[];
  readonly seed: number;
  readonly duration?: number;
  /** League matches can end level; otherwise a level score goes to golden goal. */
  readonly draws?: boolean;
}

/** Kicks from the human toward the rival goal get pulled toward the side its keeper isn't covering. */
export const AIM_ASSIST = { range: 520, cone: 0.64, blend: 0.55, cornerInset: 30, keeperDepth: 240 } as const;

function makeKnight(spec: KnightSpec, team: TeamId, id: number, spot: { x: number; y: number }): Knight {
  const build = BUILDS[spec.look.build] ?? BUILDS[1];
  if (!build) throw new Error('No builds defined');
  const attributes = spec.attributes ?? NO_ATTRIBUTES;
  return {
    id,
    team,
    role: spec.role,
    look: spec.look,
    build,
    human: spec.human,
    tier: spec.tier,
    speedFactor: spec.speedFactor,
    attributes,
    x: spot.x,
    y: spot.y,
    vx: 0,
    vy: 0,
    radius: build.radius,
    mass: build.mass * strengthFactor(attributes),
    facing: team === 0 ? 1 : -1,
    kickHeld: false,
    kickCooldown: 0,
    bargeTime: 0,
    bargeCooldown: 0,
    bargeDirX: 0,
    bargeDirY: 0,
    stun: 0,
    runPhase: 0,
  };
}

export function createMatch(config: MatchConfig): MatchState {
  let nextId = 0;
  const knight = (spec: KnightSpec, team: TeamId): Knight =>
    makeKnight(spec, team, nextId++, kickoffSpot(spec.role, team));
  const post = (x: number, y: number): Body => ({ x, y, vx: 0, vy: 0, radius: POST.radius, mass: Infinity });
  return {
    knights: [...config.home.map((s) => knight(s, 0)), ...config.away.map((s) => knight(s, 1))],
    substituted: [],
    draws: config.draws ?? false,
    ball: centreBall(),
    posts: [
      post(PITCH.left, PITCH.goalTop),
      post(PITCH.left, PITCH.goalBottom),
      post(PITCH.right, PITCH.goalTop),
      post(PITCH.right, PITCH.goalBottom),
    ],
    score: [0, 0],
    rng: createRng(config.seed),
    clock: config.duration ?? MATCH.duration,
    phase: 'kickoff',
    phaseTime: 0,
    goldenGoal: false,
    events: [],
  };
}

function centreBall(): Ball {
  return {
    x: PITCH.centerX,
    y: PITCH.centerY,
    vx: 0,
    vy: 0,
    radius: BALL.radius,
    mass: BALL.mass,
    lastTouch: null,
    teamTouch: [null, null],
    spin: 0,
  };
}

function resetForKickoff(state: MatchState): void {
  for (const k of state.knights) {
    const spot = kickoffSpot(k.role, k.team);
    Object.assign(k, { x: spot.x, y: spot.y, vx: 0, vy: 0, stun: 0, bargeTime: 0, kickHeld: false });
  }
  Object.assign(state.ball, centreBall());
  state.phase = 'kickoff';
  state.phaseTime = 0;
}

/** Advances the match by one fixed step. `inputFor` is only consulted while the ball is live. */
export function stepMatch(state: MatchState, inputFor: (k: Knight) => Input, dt: number = STEP): void {
  if (state.phase === 'ended') return;
  state.phaseTime += dt;
  advancePhase(state, dt);
  const live = state.phase === 'play';

  for (const k of state.knights) stepKnight(k, live ? inputFor(k) : NO_INPUT, state.ball, dt);
  stepBall(state.ball, dt);
  for (const touch of state.ball.teamTouch) if (touch) touch.age += dt;

  const { knights, ball, posts } = state;
  // Captured before contact, which would otherwise make every kicker the ball's last toucher.
  const incoming: Incoming = { toucher: ball.lastTouch, speed: Math.hypot(ball.vx, ball.vy) };
  for (let i = 0; i < knights.length; i++) {
    for (let j = i + 1; j < knights.length; j++) {
      const a = knights[i];
      const b = knights[j];
      if (a && b) resolveKnightContact(state, a, b);
    }
  }
  for (const k of knights) {
    if (collide(k, ball, KNIGHT.ballRestitution)) touchBall(ball, k);
    for (const p of posts) collide(k, p, POST.knightRestitution);
  }
  for (const p of posts) collide(ball, p, POST.ballRestitution);
  if (live) {
    for (const k of knights) tryKick(state, k, incoming);
    checkGoal(state);
  }
}

function advancePhase(state: MatchState, dt: number): void {
  switch (state.phase) {
    case 'kickoff':
      if (state.phaseTime >= MATCH.kickoffPause) {
        state.phase = 'play';
        state.phaseTime = 0;
      }
      break;
    case 'goal':
      if (state.phaseTime >= MATCH.celebration) {
        if (state.goldenGoal || state.clock <= 0) endMatch(state);
        else resetForKickoff(state);
      }
      break;
    case 'play':
      state.clock = Math.max(0, state.clock - dt);
      if (state.clock === 0 && !state.goldenGoal) {
        if (state.draws || state.score[0] !== state.score[1]) endMatch(state);
        else {
          state.goldenGoal = true;
          state.events.push({ type: 'golden-goal' });
        }
      }
      break;
    case 'ended':
      break;
  }
}

function endMatch(state: MatchState): void {
  state.phase = 'ended';
  state.phaseTime = 0;
  state.events.push({ type: 'full-time' });
}

function resolveKnightContact(state: MatchState, a: Knight, b: Knight): void {
  if (!collide(a, b, KNIGHT.restitution) || a.team === b.team) return;
  if (a.bargeTime > 0 && b.bargeTime > 0) return;
  const [attacker, victim] = a.bargeTime > 0 ? [a, b] : b.bargeTime > 0 ? [b, a] : [null, null];
  if (!attacker || victim.stun > 0) return;
  const d = Math.hypot(victim.x - attacker.x, victim.y - attacker.y) || 1;
  victim.stun = stunOf(attacker.attributes, victim.attributes);
  const knockback = knockbackOf(attacker.attributes, victim.attributes);
  victim.vx = ((victim.x - attacker.x) / d) * knockback;
  victim.vy = ((victim.y - attacker.y) / d) * knockback;
  attacker.bargeTime = 0;
  attacker.vx *= 0.2;
  attacker.vy *= 0.2;
  state.events.push({
    type: 'barge',
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    attackerId: attacker.id,
    victimId: victim.id,
  });
}

/** Direction a kick from `k` would send the ball, including the human's aim assist. */
export function kickDirection(state: MatchState, k: Knight): { x: number; y: number; distance: number } {
  const { ball } = state;
  const dx = ball.x - k.x;
  const dy = ball.y - k.y;
  const distance = Math.hypot(dx, dy) || 1;
  let ux = dx / distance;
  let uy = dy / distance;
  if (k.human) {
    const attacksRight = k.team === 0;
    const goalX = attacksRight ? PITCH.right + 12 : PITCH.left - 12;
    const keeper = state.knights.find((o) => o.team !== k.team && o.role === 'gk');
    const keeperHome = keeper && Math.abs(keeper.x - goalX) < AIM_ASSIST.keeperDepth;
    const targetY = keeperHome
      ? keeper.y > PITCH.centerY
        ? PITCH.goalTop + AIM_ASSIST.cornerInset
        : PITCH.goalBottom - AIM_ASSIST.cornerInset
      : PITCH.centerY;
    const gx = goalX - ball.x;
    const gy = targetY - ball.y;
    const gl = Math.hypot(gx, gy) || 1;
    if (gl < AIM_ASSIST.range && (ux * gx + uy * gy) / gl > AIM_ASSIST.cone) {
      const b = AIM_ASSIST.blend;
      ux = ux * (1 - b) + (gx / gl) * b;
      uy = uy * (1 - b) + (gy / gl) * b;
      const l = Math.hypot(ux, uy);
      ux /= l;
      uy /= l;
    }
  }
  return { x: ux, y: uy, distance };
}

/** Whether a kick by `k` in direction `dir` from the ball's spot is a shot on the rival goal within his range. */
function isShotAtGoal(state: MatchState, k: Knight, dir: { x: number; y: number }): boolean {
  const { ball } = state;
  const lineX = k.team === 0 ? PITCH.right : PITCH.left;
  const toLine = lineX - ball.x;
  const range = KNIGHT.shotRange + extraShotRange(k.attributes);
  if (Math.abs(toLine) > range || Math.sign(dir.x) !== Math.sign(toLine) || dir.x === 0) return false;
  const y = ball.y + (dir.y * toLine) / dir.x;
  return y > PITCH.goalTop && y < PITCH.goalBottom;
}

interface Incoming {
  toucher: number | null;
  speed: number;
}

function tryKick(state: MatchState, k: Knight, incoming: Incoming): void {
  if (!k.kickHeld || k.kickCooldown > 0) return;
  const dir = kickDirection(state, k);
  if (dir.distance > k.radius + state.ball.radius + KNIGHT.kickReach) return;
  const oneTouch = incoming.toucher !== k.id && incoming.speed >= KNIGHT.oneTouchMinSpeed;
  const atGoal = isShotAtGoal(state, k, dir);
  const boost = (atGoal ? KNIGHT.shotBoost : 1) * (oneTouch ? KNIGHT.oneTouchBoost : 1);
  // Shot power is for shots: on a pass it only overhits the ball.
  const shot = atGoal ? shotFactor(k.attributes) : 1;
  const power = KNIGHT.kickPower * k.build.kick * shot * boost;
  state.ball.vx += dir.x * power;
  state.ball.vy += dir.y * power;
  capSpeed(state.ball, BALL.maxSpeed * boost * shot);
  touchBall(state.ball, k);
  k.kickCooldown = KNIGHT.kickCooldown;
  state.events.push({ type: 'kick', x: state.ball.x, y: state.ball.y, knightId: k.id, boost });
}

function checkGoal(state: MatchState): void {
  const { ball } = state;
  const scoringTeam: TeamId | null =
    ball.x < PITCH.left - ball.radius ? 1 : ball.x > PITCH.right + ball.radius ? 0 : null;
  if (scoringTeam === null) return;
  state.score[scoringTeam]++;
  const scorer = creditedScorer(state, scoringTeam);
  state.events.push({
    type: 'goal',
    team: scoringTeam,
    scorerId: scorer?.id ?? null,
    ownGoal: scorer !== undefined && scorer.team !== scoringTeam,
  });
  state.phase = 'goal';
  state.phaseTime = 0;
}

function touchBall(ball: Ball, k: Knight): void {
  ball.lastTouch = k.id;
  ball.teamTouch[k.team] = { knightId: k.id, age: 0 };
}

/**
 * The last toucher, unless the scoring side played it moments ago (a shot or a dribble) and it only
 * deflected in off a defender: then it's the attacker's goal, as in real football.
 */
function creditedScorer(state: MatchState, scoringTeam: TeamId): Knight | undefined {
  const toucher = knightById(state, state.ball.lastTouch);
  const attack = state.ball.teamTouch[scoringTeam];
  if (!toucher || toucher.team === scoringTeam || !attack || attack.age > MATCH.deflectionWindow)
    return toucher;
  return knightById(state, attack.knightId) ?? toucher;
}

export const knightById = (state: MatchState, id: number | null): Knight | undefined =>
  id === null
    ? undefined
    : (state.knights.find((k) => k.id === id) ?? state.substituted.find((k) => k.id === id));

/** How far from the halfway line, on his own side, a substitute comes on at the top touchline. */
const SUB_ENTRY_GAP = 40;

/**
 * Swaps a knight for a fresh one in the same role, who comes on at the halfway line by the top
 * touchline. The new knight gets a new id, so bots treat him as a new teammate with no memory.
 */
export function substitute(state: MatchState, offId: number, on: KnightSpec): Knight {
  const index = state.knights.findIndex((k) => k.id === offId);
  const off = state.knights[index];
  if (!off) throw new Error(`No knight ${offId} on the pitch`);
  const id = Math.max(...state.knights.map((k) => k.id), ...state.substituted.map((k) => k.id)) + 1;
  const x = PITCH.centerX + (off.team === 0 ? -SUB_ENTRY_GAP : SUB_ENTRY_GAP);
  const knight = makeKnight({ ...on, role: off.role }, off.team, id, { x, y: PITCH.top });
  state.knights[index] = knight;
  state.substituted.push(off);
  state.events.push({ type: 'substitution', team: off.team, offId, onId: id });
  return knight;
}

/**
 * Swaps two teammates' roles. Nobody teleports: each walks to his new job from where he stands, and
 * takes the new role's kick-off spot from the next kick-off.
 */
export function swapRoles(state: MatchState, aId: number, bId: number): void {
  const a = state.knights.find((k) => k.id === aId);
  const b = state.knights.find((k) => k.id === bId);
  if (!a || !b || a === b || a.team !== b.team) throw new Error(`Knights ${aId} and ${bId} can't swap`);
  [a.role, b.role] = [b.role, a.role];
}
