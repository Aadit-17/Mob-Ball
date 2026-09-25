import { describe, expect, it } from 'vitest';
import { skillFor, TOP_TIER } from '../ai/skills';
import { createRng } from '../game/rng';
import { DEFAULT_LOOK } from '../knight/look';
import { createSquads, rollRivals, setTeamTier, withTier } from './squads';

describe('createSquads', () => {
  it.each([3, 4] as const)('gives every knight in a %iv%i match a unique helmet and name', (size) => {
    const rng = createRng(size);
    for (let i = 0; i < 100; i++) {
      const { home, away } = createSquads(
        DEFAULT_LOOK,
        size,
        { teammateTier: TOP_TIER, rivalMeanTier: 2 },
        rng,
      );
      const all = [...home, ...away];
      expect(all).toHaveLength(size * 2);
      expect(new Set(all.map((s) => s.look.helmet)).size).toBe(size * 2);
      expect(new Set(all.map((s) => s.look.name)).size).toBe(size * 2);
    }
  });

  it('puts the player up front, surrounded by top-tier teammates', () => {
    const { home } = createSquads(
      DEFAULT_LOOK,
      4,
      { teammateTier: TOP_TIER, rivalMeanTier: 1 },
      createRng(1),
    );
    expect(home.filter((s) => s.human)).toEqual([
      expect.objectContaining({ role: 'fwd', look: DEFAULT_LOOK }),
    ]);
    expect(home.filter((s) => !s.human).every((s) => s.tier === TOP_TIER)).toBe(true);
  });

  it('rolls rival tiers within one of the chosen difficulty', () => {
    const rng = createRng(9);
    for (let i = 0; i < 100; i++) {
      for (const s of createSquads(DEFAULT_LOOK, 4, { teammateTier: TOP_TIER, rivalMeanTier: 2 }, rng).away)
        expect(Math.abs(s.tier - 2)).toBeLessThanOrEqual(1);
    }
  });
});

describe('levels', () => {
  const squads = () => createSquads(DEFAULT_LOOK, 4, { teammateTier: 1, rivalMeanTier: 2 }, createRng(3));

  it('plays every bot teammate at the chosen teammate level, at that level’s speed', () => {
    const bots = squads().home.filter((s) => !s.human);
    expect(bots.map((s) => s.tier)).toEqual([1, 1, 1]);
    expect(bots.every((s) => s.speedFactor === skillFor(1).speed)).toBe(true);
  });

  it('changes a team’s level without changing who is in it', () => {
    const { home } = squads();
    const raised = setTeamTier(home, 3);
    expect(raised.map((s) => s.look)).toEqual(home.map((s) => s.look));
    expect(raised.filter((s) => !s.human).map((s) => s.tier)).toEqual([3, 3, 3]);
  });

  it('never changes the player', () => {
    const player = squads().home.find((s) => s.human);
    if (!player) throw new Error('no player');
    expect(withTier(player, 0)).toBe(player);
  });

  it('rerolls rival levels around a new level, keeping the same knights', () => {
    const { away } = squads();
    const rolled = rollRivals(away, 0, createRng(5));
    expect(rolled.map((s) => s.look)).toEqual(away.map((s) => s.look));
    expect(rolled.every((s) => s.tier <= 1)).toBe(true);
  });
});
