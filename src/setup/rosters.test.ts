import { describe, expect, it, vi } from 'vitest';
import { TOP_TIER } from '../ai/skills';
import { createRng } from '../game/rng';
import { DEFAULT_LOOK } from '../knight/look';
import { houseById, REALM_HOUSES, type House } from './houses';
import { roster, rosterLineup, rosterSquads } from './rosters';

const pairs: [House, House][] = REALM_HOUSES.flatMap((a) =>
  REALM_HOUSES.filter((b) => b !== a).map((b): [House, House] => [a, b]),
);
const levels = { teammateTier: 1, rivalMeanTier: 2 };

describe('roster', () => {
  it('casts the same knights for a house every time, even in a fresh copy of the game', async () => {
    const before = REALM_HOUSES.map((house) => roster(house));
    vi.resetModules();
    const fresh = await import('./rosters');
    expect(REALM_HOUSES.map((house) => fresh.roster(house))).toEqual(before);
  });

  it('gives every knight in the realm a different name, and every knight in a house a different helmet', () => {
    const knights = REALM_HOUSES.map((house) => Object.values(roster(house)));
    expect(new Set(knights.flat().map((look) => look.name)).size).toBe(REALM_HOUSES.length * 4);
    for (const house of knights) expect(new Set(house.map((look) => look.helmet)).size).toBe(4);
  });

  it('fields a 3v3 side from the same knights, in their own roles', () => {
    const house = houseById('mud');
    const lineup = rosterLineup(house, 3);
    expect(lineup.map((s) => s.role)).toEqual(['gk', 'def', 'fwd']);
    expect(lineup.map((s) => s.look)).toEqual([roster(house).gk, roster(house).def, roster(house).fwd]);
  });
});

describe('rosterSquads', () => {
  it.each(pairs)('keeps every helmet and name unique in %s v %s, the player untouched', (house, rival) => {
    // A player wearing the rival keeper's helmet and name forces a clash in every pairing.
    const keeper = roster(rival).gk;
    const player = { ...DEFAULT_LOOK, name: keeper.name, helmet: keeper.helmet };
    const { home, away } = rosterSquads(player, house, rival, 4, levels, createRng(1));
    const all = [...home, ...away];
    expect(new Set(all.map((s) => s.look.helmet)).size).toBe(8);
    expect(new Set(all.map((s) => s.look.name)).size).toBe(8);
    expect(all.filter((s) => s.human)).toEqual([expect.objectContaining({ look: player, role: 'fwd' })]);
  });

  it('fields the houses’ own knights, with their own faces', () => {
    const [house, rival] = [houseById('ember'), houseById('hollow')];
    const { home, away } = rosterSquads(DEFAULT_LOOK, house, rival, 4, levels, createRng(2));
    // Helmets and names may change to avoid a clash; the face underneath never does.
    const face = (look: typeof DEFAULT_LOOK) => ({ ...look, helmet: 0, name: '' });
    expect(home.filter((s) => !s.human).map((s) => face(s.look))).toEqual(
      [roster(house).gk, roster(house).def, roster(house).mid].map(face),
    );
    expect(away.map((s) => face(s.look))).toEqual(Object.values(roster(rival)).map(face));
  });

  it('plays teammates at the teammate level and rolls the rivals around theirs', () => {
    const [house, rival] = [houseById('corvane'), houseById('ox')];
    for (let seed = 0; seed < 50; seed++) {
      const { home, away } = rosterSquads(DEFAULT_LOOK, house, rival, 4, levels, createRng(seed));
      expect(home.map((s) => s.tier)).toEqual([1, 1, 1, TOP_TIER]);
      for (const s of away) expect(Math.abs(s.tier - 2)).toBeLessThanOrEqual(1);
    }
  });
});
