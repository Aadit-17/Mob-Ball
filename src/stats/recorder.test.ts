import { describe, expect, it } from 'vitest';
import { PITCH } from '../game/constants';
import { kickOnce, stage, walk } from '../test/stage';
import { ASSIST_WINDOW, POSSESSION_HOLD } from './definitions';

const GOAL = { x: PITCH.right + 20, y: PITCH.centerY };

describe('passes', () => {
  it('a kick whose next touch is a teammate is a completed pass, progressive if it gains enough ground', () => {
    const s = stage(['mid', 'fwd'], ['def']);
    const [mid, fwd] = [s.home('mid'), s.home('fwd')];
    Object.assign(mid, { x: 400, y: 330 });
    Object.assign(fwd, { x: 650, y: 330 });
    s.lineUp(mid, fwd);
    s.run(1.5, kickOnce(mid));
    expect(s.actions('pass')).toMatchObject([
      { knightId: mid.id, completed: true, receiverId: fwd.id, progressive: true },
    ]);
    expect(s.line(mid)).toMatchObject({ passes: 1, passesCompleted: 1, passesLost: 0, progressivePasses: 1 });
    expect(s.line(mid).passDistance).toBeGreaterThan(150);
  });

  it('a square pass is completed but not progressive', () => {
    const s = stage(['mid', 'fwd'], ['def']);
    const [mid, fwd] = [s.home('mid'), s.home('fwd')];
    Object.assign(mid, { x: 600, y: 200 });
    Object.assign(fwd, { x: 600, y: 420 });
    s.lineUp(mid, fwd);
    s.run(1.5, kickOnce(mid));
    expect(s.actions('pass')).toMatchObject([{ completed: true, progressive: false }]);
  });

  it("a kick whose next touch is a rival is a lost pass, and the rival's interception once he keeps it", () => {
    const s = stage(['mid'], ['def']);
    const [mid, def] = [s.home('mid'), s.away('def')];
    Object.assign(mid, { x: 400, y: 330 });
    Object.assign(def, { x: 650, y: 330 });
    s.lineUp(mid, def);
    s.run(1, kickOnce(mid));
    expect(s.actions('pass')).toMatchObject([{ knightId: mid.id, completed: false, receiverId: def.id }]);
    expect(s.actions('interception')).toMatchObject([{ knightId: def.id, fromId: mid.id }]);
    expect(s.line(mid)).toMatchObject({ passes: 1, passesLost: 1, turnovers: 0 });
  });

  it('taking a pass that has stopped rolling is a recovery, not an interception', () => {
    const s = stage(['mid'], ['def']);
    const [mid, def] = [s.home('mid'), s.away('def')];
    Object.assign(mid, { x: 420, y: 330 });
    Object.assign(def, { x: 1100, y: 500 });
    s.lineUp(mid, { x: 700, y: 330 });
    s.run(5, kickOnce(mid));
    expect(s.actions('pass')).toEqual([]);
    s.run(4, walk(def, s.state.ball));
    expect(s.actions('pass')).toMatchObject([{ completed: false, receiverId: def.id }]);
    expect(s.actions('recovery')).toMatchObject([{ knightId: def.id }]);
    expect(s.actions('interception')).toEqual([]);
  });

  it('playing your own kick again is a push, not a pass', () => {
    const s = stage(['mid'], ['def']);
    const mid = s.home('mid');
    Object.assign(mid, { x: 400, y: 330 });
    s.lineUp(mid, { x: 500, y: 330 });
    s.run(0.2, kickOnce(mid));
    s.run(4, walk(mid, { x: 1000, y: 330 }));
    expect(s.line(mid).kicks).toBe(1);
    expect(s.actions('pass')).toEqual([]);
  });
});

describe('shots', () => {
  it('a kick that would score unopposed is a shot on target; in, it is a goal from a shot', () => {
    const s = stage(['fwd'], ['gk']);
    const [fwd, gk] = [s.home('fwd'), s.away('gk')];
    Object.assign(fwd, { x: 900, y: 330 });
    s.lineUp(fwd, GOAL);
    s.run(1.5, kickOnce(fwd));
    expect(s.state.score).toEqual([1, 0]);
    expect(s.actions('shot')).toMatchObject([
      { knightId: fwd.id, onTarget: true, outcome: 'goal', keeperId: gk.id },
    ]);
    expect(s.actions('goal')).toMatchObject([
      { knightId: fwd.id, fromShot: true, ownGoal: false, keeperId: gk.id },
    ]);
    expect(s.line(fwd)).toMatchObject({ shots: 1, shotsOnTarget: 1, goalsFromShots: 1, goals: 1 });
    expect(s.line(gk)).toMatchObject({ shotsOnTargetFaced: 1, goalsConceded: 1, saves: 0 });
  });

  it('the keeper stopping a shot on target is a save', () => {
    const s = stage(['fwd'], ['gk']);
    const [fwd, gk] = [s.home('fwd'), s.away('gk')];
    Object.assign(fwd, { x: 900, y: 330 });
    Object.assign(gk, { x: PITCH.right - 25, y: 330 });
    s.lineUp(fwd, GOAL);
    s.run(1.5, kickOnce(fwd));
    expect(s.state.score).toEqual([0, 0]);
    expect(s.actions('shot')).toMatchObject([{ onTarget: true, outcome: 'saved', stopperId: gk.id }]);
    expect(s.line(gk)).toMatchObject({ saves: 1, shotsOnTargetFaced: 1, goalsConceded: 0 });
  });

  it('an outfielder stopping a shot on target is a last-ditch block, not a save', () => {
    const s = stage(['fwd'], ['gk', 'def']);
    const [fwd, def, gk] = [s.home('fwd'), s.away('def'), s.away('gk')];
    Object.assign(fwd, { x: 850, y: 330 });
    Object.assign(def, { x: 1050, y: 330 });
    s.lineUp(fwd, GOAL);
    s.run(1.5, kickOnce(fwd));
    expect(s.actions('shot')).toMatchObject([{ onTarget: true, outcome: 'blocked', stopperId: def.id }]);
    expect(s.line(def)).toMatchObject({ blocks: 1, lastDitchBlocks: 1, saves: 0 });
    expect(s.line(fwd)).toMatchObject({ shots: 1, shotsBlocked: 1 });
    expect(s.line(gk)).toMatchObject({ shotsOnTargetFaced: 1, saves: 0 });
  });

  it('a shot just wide is off target; a rival taking it once it has gone by makes it a miss', () => {
    const s = stage(['fwd'], ['def']);
    const [fwd, def] = [s.home('fwd'), s.away('def')];
    Object.assign(fwd, { x: 900, y: 330 });
    s.lineUp(fwd, { x: PITCH.right, y: PITCH.goalBottom + 40 });
    s.run(2.5, kickOnce(fwd));
    s.run(4, walk(def, s.state.ball));
    expect(s.actions('shot')).toMatchObject([{ onTarget: false, outcome: 'missed', stopperId: null }]);
    expect(s.actions('recovery')).toMatchObject([{ knightId: def.id }]);
  });

  it('the keeper taking an off-target shot in flight claims it; no save', () => {
    const s = stage(['fwd'], ['gk']);
    const [fwd, gk] = [s.home('fwd'), s.away('gk')];
    Object.assign(fwd, { x: 900, y: 330 });
    const wide = { x: PITCH.right, y: PITCH.goalBottom + 40 };
    s.lineUp(fwd, wide);
    Object.assign(gk, { x: 1080, y: 330 + ((wide.y - 330) * 180) / 270 + 12 });
    s.run(1.5, kickOnce(fwd));
    expect(s.actions('shot')).toMatchObject([{ onTarget: false, outcome: 'claimed', stopperId: gk.id }]);
    expect(s.line(gk)).toMatchObject({ claims: 1, saves: 0, shotsOnTargetFaced: 0 });
  });

  it('a shot that rebounds to the shooter or a teammate is a rebound', () => {
    const s = stage(['fwd', 'mid'], ['gk']);
    const [fwd, mid] = [s.home('fwd'), s.home('mid')];
    Object.assign(fwd, { x: 900, y: 330 });
    Object.assign(mid, { x: 1060, y: 330 });
    s.lineUp(fwd, GOAL);
    s.run(1, kickOnce(fwd));
    expect(s.actions('shot')).toMatchObject([{ onTarget: true, outcome: 'rebound' }]);
  });
});

describe('assists', () => {
  function passAndShoot(wait: number) {
    const s = stage(['mid', 'fwd'], ['gk']);
    const [mid, fwd] = [s.home('mid'), s.home('fwd')];
    Object.assign(mid, { x: 700, y: 200 });
    Object.assign(fwd, { x: 900, y: 330 });
    s.lineUp(mid, fwd);
    s.run(1, kickOnce(mid));
    s.run(wait);
    const ball = s.state.ball;
    // The forward steps behind the ball and shoots.
    const back = Math.hypot(GOAL.x - ball.x, GOAL.y - ball.y);
    Object.assign(fwd, {
      x: ball.x - ((GOAL.x - ball.x) / back) * 30,
      y: ball.y - ((GOAL.y - ball.y) / back) * 30,
      vx: 0,
      vy: 0,
    });
    Object.assign(ball, { vx: 0, vy: 0 });
    s.run(1.5, kickOnce(fwd));
    return { s, mid, fwd };
  }

  it('go to the teammate who set the scorer up', () => {
    const { s, mid, fwd } = passAndShoot(0);
    expect(s.state.score).toEqual([1, 0]);
    expect(s.actions('goal')).toMatchObject([{ knightId: fwd.id, assistId: mid.id }]);
    expect(s.line(mid).assists).toBe(1);
  });

  it(`lapse after ${ASSIST_WINDOW} steps, though the gap is still recorded`, () => {
    const { s, fwd } = passAndShoot(5);
    expect(s.actions('goal')).toMatchObject([{ knightId: fwd.id, assistId: null }]);
    const goal = s.actions('goal')[0];
    expect(goal?.kind === 'goal' && goal.assistGap).toBeGreaterThan(ASSIST_WINDOW);
  });

  it('go to nobody when a rival touched the ball in between', () => {
    const s = stage(['mid', 'fwd'], ['gk', 'def']);
    const [mid, fwd, def] = [s.home('mid'), s.home('fwd'), s.away('def')];
    Object.assign(mid, { x: 600, y: 330 });
    Object.assign(def, { x: 760, y: 330 });
    Object.assign(fwd, { x: 900, y: 330 });
    s.lineUp(mid, def);
    s.run(0.6, kickOnce(mid));
    Object.assign(def, { x: 760, y: 560 });
    const ball = s.state.ball;
    Object.assign(fwd, { x: ball.x - 30, y: ball.y, vx: 0, vy: 0 });
    Object.assign(ball, { vx: 0, vy: 0 });
    s.lineUp(fwd, GOAL);
    s.run(3, kickOnce(fwd));
    expect(s.state.score).toEqual([1, 0]);
    expect(s.actions('goal')).toMatchObject([{ knightId: fwd.id, assistId: null, assistGap: null }]);
  });
});

describe('own goals', () => {
  it('are credited to the defender, not as his goals, and conceded by his keeper', () => {
    const s = stage(['def', 'gk'], ['fwd']);
    const [def, gk] = [s.home('def'), s.home('gk')];
    Object.assign(def, { x: 300, y: 330 });
    s.lineUp(def, { x: PITCH.left - 20, y: 330 });
    s.run(1.5, kickOnce(def));
    expect(s.state.score).toEqual([0, 1]);
    expect(s.actions('goal')).toMatchObject([{ team: 1, knightId: def.id, ownGoal: true, assistId: null }]);
    expect(s.line(def)).toMatchObject({ ownGoals: 1, goals: 0, shots: 0 });
    expect(s.line(gk).goalsConceded).toBe(1);
  });
});

/** The away forward dribbling the ball left toward a home defender standing at x=560. */
function dribbleAtDefender() {
  const s = stage(['def', 'mid'], ['fwd']);
  const [def, carrier] = [s.home('def'), s.away('fwd')];
  Object.assign(carrier, { x: 760, y: 330 });
  Object.assign(def, { x: 560, y: 330 });
  s.lineUp(carrier, { x: 0, y: 330 });
  // He pushes the ball on until it is about to reach the defender, and lets it roll the last bit.
  s.run(3, walk(carrier, { x: 0, y: 330 }), () => s.state.ball.x - def.x < 45);
  s.run(
    1,
    () => null,
    () => s.state.ball.teamTouch[0]?.age === 0,
  );
  return { s, def, carrier };
}

describe('tackles', () => {
  it("taking the ball off a carrier is a tackle, and the carrier's turnover, once the tackler keeps it", () => {
    const { s, def, carrier } = dribbleAtDefender();
    expect(s.state.ball.teamTouch[0]?.knightId).toBe(def.id);
    expect(s.actions('tackle')).toEqual([]);
    // The carrier is knocked away; the defender keeps the ball for the hold.
    Object.assign(carrier, { x: 900, y: 560, vx: 0, vy: 0 });
    Object.assign(s.state.ball, { vx: 0, vy: 0 });
    s.run(0.5);
    expect(s.actions('tackle')).toMatchObject([{ knightId: def.id, fromId: carrier.id }]);
    expect(s.actions('turnover')).toMatchObject([{ knightId: carrier.id, byId: def.id }]);
    expect(s.line(def)).toMatchObject({ tackles: 1, interceptions: 0, recoveries: 0 });
  });

  it('touching a loose ball the rival never controlled is a recovery, with no turnover', () => {
    const s = stage(['def'], ['fwd']);
    const [def, fwd] = [s.home('def'), s.away('fwd')];
    Object.assign(fwd, { x: 760, y: 330 });
    Object.assign(def, { x: 560, y: 450 });
    // A ball rolling past brushes the forward and stays at his feet for longer than CONTROL_STEPS,
    // but going by him, not with him; then the defender collects it.
    Object.assign(s.state.ball, { x: 775, y: 330 - fwd.radius - 9, vx: -200, vy: 0 });
    s.run(0.2);
    expect(s.state.ball.lastTouch).toBe(fwd.id);
    s.run(3, walk(def, s.state.ball), () => s.state.ball.lastTouch === def.id);
    s.run(0.5);
    expect(s.actions('recovery')).toMatchObject([{ knightId: def.id, fromId: fwd.id }]);
    expect(s.actions('turnover')).toEqual([]);
  });

  it('a shot that clips a rival on its way in is still a goal from the shot, and no block', () => {
    const s = stage(['fwd'], ['gk', 'def']);
    const [fwd, def] = [s.home('fwd'), s.away('def')];
    Object.assign(fwd, { x: 850, y: 330 });
    Object.assign(def, { x: 1050, y: 354 });
    s.lineUp(fwd, GOAL);
    s.run(2, kickOnce(fwd));
    expect(s.state.score).toEqual([1, 0]);
    expect(s.state.ball.teamTouch[1]?.knightId).toBe(def.id);
    expect(s.actions('shot')).toMatchObject([{ onTarget: true, outcome: 'goal', stopperId: null }]);
    expect(s.actions('goal')).toMatchObject([{ knightId: fwd.id, fromShot: true }]);
    expect(s.line(def)).toMatchObject({ blocks: 0, lastDitchBlocks: 0 });
  });
});

describe('barges', () => {
  it('a barge that knocks the carrier off the ball wins it for the barger, whoever picks it up', () => {
    const s = stage(['def', 'mid'], ['fwd']);
    const [def, mid, carrier] = [s.home('def'), s.home('mid'), s.away('fwd')];
    Object.assign(carrier, { x: 760, y: 330 });
    s.lineUp(carrier, { x: 0, y: 330 });
    s.run(0.4, walk(carrier, { x: 0, y: 330 }));
    Object.assign(def, { x: carrier.x, y: carrier.y + 50 });
    s.run(0.15, (k) => (k === def ? { moveX: 0, moveY: -1, kick: false, barge: true } : null));
    expect(s.actions('barge')).toMatchObject([{ knightId: def.id, victimId: carrier.id }]);
    Object.assign(mid, { x: s.state.ball.x - 45, y: s.state.ball.y });
    s.run(1, walk(mid, s.state.ball));
    expect(s.actions('tackle')).toMatchObject([{ knightId: def.id, fromId: carrier.id }]);
    expect(s.actions('turnover')).toMatchObject([{ knightId: carrier.id, byId: def.id }]);
    expect(s.line(def)).toMatchObject({ bargeAttempts: 1, bargesWon: 1, tackles: 1 });
    expect(s.line(carrier)).toMatchObject({ bargesLost: 1, turnovers: 1 });
    expect(s.line(mid)).toMatchObject({ tackles: 0, recoveries: 0 });
  });

  it('a barge into thin air is an attempt, not a barge won', () => {
    const s = stage(['def'], ['fwd']);
    const def = s.home('def');
    Object.assign(def, { x: 400, y: 330 });
    s.run(0.5, (k) => (k === def ? { moveX: 1, moveY: 0, kick: false, barge: true } : null));
    expect(s.line(def)).toMatchObject({ bargeAttempts: 1, bargesWon: 0 });
  });
});

describe('clearances', () => {
  function clearFromBox(rivalX: number) {
    const s = stage(['def'], ['fwd']);
    const [def, fwd] = [s.home('def'), s.away('fwd')];
    Object.assign(def, { x: PITCH.left + 150, y: 330 });
    Object.assign(fwd, { x: rivalX, y: 330 });
    s.lineUp(def, fwd);
    s.run(2.5, kickOnce(def));
    return { s, def, fwd };
  }

  it('a kick out of your danger zone that a rival takes beyond it is a clearance, not a lost pass', () => {
    const { s, def, fwd } = clearFromBox(PITCH.left + 600);
    expect(s.actions('clearance')).toMatchObject([{ knightId: def.id }]);
    expect(s.line(def)).toMatchObject({ clearances: 1, passes: 0 });
    expect(s.actions('recovery')).toMatchObject([{ knightId: fwd.id }]);
  });

  it('one a rival takes still inside the zone is a lost pass: the danger was not cleared', () => {
    const { s, def, fwd } = clearFromBox(PITCH.left + 280);
    expect(s.actions('clearance')).toEqual([]);
    expect(s.actions('pass')).toMatchObject([{ knightId: def.id, completed: false, receiverId: fwd.id }]);
  });
});

describe('dribbles, touches and possession', () => {
  /** The home forward runs the ball right, past a defender standing `offset` px off its line. */
  function runPast(offset: number) {
    const s = stage(['fwd'], ['def']);
    const [fwd, def] = [s.home('fwd'), s.away('def')];
    Object.assign(fwd, { x: 450, y: 330 });
    Object.assign(def, { x: 650, y: 330 + offset });
    s.lineUp(fwd, { x: 1000, y: 330 });
    s.run(2.5, walk(fwd, { x: 1000, y: 330 }));
    return { s, fwd, def };
  }

  it('carrying the ball past a rival who was goal-side in its path is a dribble', () => {
    const { s, fwd, def } = runPast(50);
    expect(s.state.ball.x).toBeGreaterThan(def.x + 50);
    expect(s.actions('dribble')).toMatchObject([{ knightId: fwd.id, pastId: def.id }]);
  });

  it('running past a rival who was out of the lane is not', () => {
    const { s, def } = runPast(80);
    expect(s.state.ball.x).toBeGreaterThan(def.x + 50);
    expect(s.actions('dribble')).toEqual([]);
  });

  it('a run of pushes is one touch, a kick another; the carrier holds possession throughout', () => {
    const { s, fwd } = runPast(80);
    expect(s.line(fwd)).toMatchObject({ touches: 1, kicks: 0 });
    expect(s.line(fwd).carrySteps).toBeGreaterThan(0.9 * s.recorder.stats.liveSteps);
    s.run(0.3, kickOnce(fwd));
    expect(s.line(fwd)).toMatchObject({ touches: 2, kicks: 1 });
    const { teams } = s.recorder.stats;
    expect(teams[0].possession).toBe(1);
    expect(teams[1].possession).toBe(0);
  });
});

describe('possession changes', () => {
  it('a scramble of alternating touches inside the hold changes nothing', () => {
    const s = stage(['def'], ['fwd']);
    const [def, carrier] = [s.home('def'), s.away('fwd')];
    Object.assign(carrier, { x: 760, y: 330 });
    Object.assign(def, { x: 700, y: 330 });
    s.lineUp(carrier, def);
    s.run(1, walk(carrier, { x: 0, y: 330 }));
    expect(
      s.actions().filter((a) => ['tackle', 'turnover', 'recovery', 'interception'].includes(a.kind)),
    ).toEqual([]);
    expect(POSSESSION_HOLD).toBeGreaterThan(1);
  });
});
