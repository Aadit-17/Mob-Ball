/**
 * Balance harness: plays many bot-vs-bot matches and reports how scoring happens.
 * Run with `npm run balance`. The player's slot is driven by a bot, with aim assist, as in real play.
 */
import { it } from 'vitest';
import { BotBrain } from '../src/ai/brain';
import { TOP_TIER } from '../src/ai/skills';
import { PITCH } from '../src/game/constants';
import { createMatch, stepMatch, type KnightSpec } from '../src/game/match';
import { createRng } from '../src/game/rng';
import type { Knight, MatchState, TeamId } from '../src/game/types';
import { DEFAULT_LOOK } from '../src/knight/look';
import { createSquads } from '../src/setup/squads';

const MATCHES = 40;
/** Skill of the bot standing in for the player. */
const PLAYER_TIER = 2;
const RIVAL_MEAN_TIERS = [1, 2, 3] as const;
/** Kicks from further out than this are passes or clearances, not shots. */
const SHOT_DISTANCE = 500;

type Outcome = 'goal' | 'keeper' | 'blocked' | 'died';

interface Shot {
  team: TeamId;
  outcome: Outcome;
}

interface Tally {
  goals: [number, number];
  ownGoals: number;
  playerGoals: number;
  shots: Shot[];
}

/** Whether a kick is heading into the opponent's goal mouth from shooting distance. */
function isShot(state: MatchState, kicker: Knight): boolean {
  const { ball } = state;
  const attacksRight = kicker.team === 0;
  if (attacksRight ? ball.vx <= 0 : ball.vx >= 0) return false;
  const lineX = attacksRight ? PITCH.right : PITCH.left;
  if (Math.abs(lineX - ball.x) > SHOT_DISTANCE) return false;
  const y = ball.y + ball.vy * ((lineX - ball.x) / ball.vx);
  return y > PITCH.goalTop && y < PITCH.goalBottom;
}

function playMatch(seed: number, meanTier: number, tally: Tally): void {
  const squads = createSquads(
    { ...DEFAULT_LOOK },
    4,
    { teammateTier: TOP_TIER, rivalMeanTier: meanTier },
    createRng(seed),
  );
  const home: KnightSpec[] = squads.home.map((s) => (s.human ? { ...s, tier: PLAYER_TIER } : s));
  const state = createMatch({ home, away: squads.away, seed });
  const brain = new BotBrain();
  let open: Shot | null = null;
  const close = (outcome: Outcome): void => {
    if (open) open.outcome = outcome;
    open = null;
  };

  while (state.phase !== 'ended') {
    stepMatch(state, (k) => brain.input(state, k));
    for (const e of state.events) {
      if (e.type === 'kick') {
        const kicker = state.knights.find((k) => k.id === e.knightId);
        if (!kicker) continue;
        if (open && kicker.team !== open.team) close(kicker.role === 'gk' ? 'keeper' : 'blocked');
        if (isShot(state, kicker)) {
          open = { team: kicker.team, outcome: 'died' };
          tally.shots.push(open);
        }
      } else if (e.type === 'goal') {
        tally.goals[e.team]++;
        if (e.ownGoal) tally.ownGoals++;
        const scorer = state.knights.find((k) => k.id === e.scorerId);
        if (scorer?.human && !e.ownGoal) tally.playerGoals++;
        if (open?.team === e.team) close('goal');
        open = null;
      }
    }
    state.events = [];
    if (open) {
      // A shot also ends when a defender merely touches it, or when it runs out of pace.
      const toucher = state.knights.find((k) => k.id === state.ball.lastTouch);
      if (toucher && toucher.team !== open.team) close(toucher.role === 'gk' ? 'keeper' : 'blocked');
      else if (Math.hypot(state.ball.vx, state.ball.vy) < 40) close('died');
    }
  }
}

const per = (n: number): string => (n / MATCHES).toFixed(2);
const pct = (n: number, of: number): string => (of ? `${Math.round((100 * n) / of)}%` : '-');

it('balance report', () => {
  const lines = [`${MATCHES} matches per row · 4v4 · player slot = tier ${PLAYER_TIER} bot`];
  for (const meanTier of RIVAL_MEAN_TIERS) {
    const tally: Tally = { goals: [0, 0], ownGoals: 0, playerGoals: 0, shots: [] };
    for (let i = 0; i < MATCHES; i++) playMatch(1000 * meanTier + i, meanTier, tally);
    const n = tally.shots.length;
    const count = (o: Outcome): number => tally.shots.filter((s) => s.outcome === o).length;
    lines.push(
      `rivals~${meanTier}  goals ${per(tally.goals[0] + tally.goals[1])} (us ${per(tally.goals[0])}, them ${per(tally.goals[1])}, ` +
        `player ${per(tally.playerGoals)}, own ${per(tally.ownGoals)})  shots ${per(n)} → ` +
        `goal ${pct(count('goal'), n)} · keeper ${pct(count('keeper'), n)} · blocked ${pct(count('blocked'), n)} · died ${pct(count('died'), n)}`,
    );
  }
  console.log(`\n${lines.join('\n')}\n`);
});
