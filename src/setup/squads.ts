import { rollRivalTiers, skillFor, TOP_TIER } from '../ai/skills';
import { ROLES_BY_SIZE, type TeamSize } from '../game/formation';
import type { KnightSpec } from '../game/match';
import type { Rng } from '../game/rng';
import { HELMETS, KNIGHT_NAMES } from '../knight/catalog';
import { randomLook, type Look } from '../knight/look';

export interface Squads {
  readonly home: readonly KnightSpec[];
  readonly away: readonly KnightSpec[];
}

export interface SquadLevels {
  /** Every bot teammate plays at exactly this tier. */
  readonly teammateTier: number;
  /** Rival tiers are rolled around this one, so squads are uneven like real teams. */
  readonly rivalMeanTier: number;
}

/** A copy of `spec` playing at `tier`. Humans keep their own speed; bots move at their tier's speed. */
export const withTier = (spec: KnightSpec, tier: number): KnightSpec =>
  spec.human ? spec : { ...spec, tier, speedFactor: skillFor(tier).speed };

export const setTeamTier = (specs: readonly KnightSpec[], tier: number): KnightSpec[] =>
  specs.map((s) => withTier(s, tier));

export function rollRivals(specs: readonly KnightSpec[], meanTier: number, rng: Rng): KnightSpec[] {
  const tiers = rollRivalTiers(meanTier, specs.length, rng);
  return specs.map((s, i) => withTier(s, tiers[i] ?? meanTier));
}

/**
 * Builds both line-ups around the player's knight. Every knight on the pitch wears a
 * different helmet and has a different name.
 */
export function createSquads(player: Look, teamSize: TeamSize, levels: SquadLevels, rng: Rng): Squads {
  const roles = ROLES_BY_SIZE[teamSize];
  const botsNeeded = roles.length * 2 - 1;
  const helmets = rng.shuffle(HELMETS.map((_, i) => i).filter((i) => i !== player.helmet));
  const names = rng.shuffle(KNIGHT_NAMES.filter((n) => n !== player.name));
  if (helmets.length < botsNeeded || names.length < botsNeeded)
    throw new Error('Not enough unique helmets or names');
  let next = 0;
  const botLook = (): Look => {
    const look = randomLook(rng, names[next] ?? 'Ser Nobody', helmets[next]);
    next++;
    return look;
  };
  const bot = (role: KnightSpec['role'], tier: number): KnightSpec =>
    withTier({ look: botLook(), role, human: false, tier, speedFactor: 1 }, tier);

  const home: KnightSpec[] = roles.map((role) =>
    role === 'fwd'
      ? { look: player, role, human: true, tier: TOP_TIER, speedFactor: 1 }
      : bot(role, levels.teammateTier),
  );
  const away = rollRivals(
    roles.map((role) => bot(role, levels.rivalMeanTier)),
    levels.rivalMeanTier,
    rng,
  );
  return { home, away };
}
