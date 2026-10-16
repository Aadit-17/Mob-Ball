import { describe, expect, it } from 'vitest';
import { skillFor } from '../../ai/skills';
import { createRng } from '../../game/rng';
import { DEFAULT_LOOK, type Look } from '../../knight/look';
import { REALM_HOUSES } from '../../setup/houses';
import { roster } from '../../setup/rosters';
import {
  applyPick,
  autoPick,
  availableKnights,
  BUDGET,
  budgetLeft,
  checkPick,
  chooseDraftPick,
  defaultLineup,
  DRAFT_HOUSES,
  draftPool,
  FORGED_ID,
  houseForPick,
  houseOnTheClock,
  isDraftComplete,
  legalPicks,
  normalizeDraft,
  POOL_TIERS,
  runRivalPicks,
  squadOf,
  squadValue,
  startDraft,
  TIER_COST,
  TOTAL_PICKS,
  type DraftState,
  type DraftStyle,
} from './draft';
import { SQUAD_SIZE, type SquadKnight } from './types';

const FORGED: Look = { ...DEFAULT_LOOK, name: 'Sir Forged', build: 0 };
const start = (seed = 7, player = 'thorn'): DraftState => startDraft(seed, player, FORGED);

type Drafter = (draft: DraftState) => string;

function play(draft: DraftState, drafter: Drafter, picks = TOTAL_PICKS): DraftState {
  let state = draft;
  for (let i = 0; i < picks && !isDraftComplete(state); i++) {
    const house = houseOnTheClock(state);
    if (house === null) break;
    state = applyPick(state, house, drafter(state));
  }
  return state;
}

function randomDrafter(seed: number): Drafter {
  const rng = createRng(seed);
  return (draft) => rng.pick(legalPicks(draft)).id;
}

const managed: Drafter = (draft) => chooseDraftPick(draft);
const cost = (squad: readonly SquadKnight[]): number =>
  squad.reduce((s, k) => s + (TIER_COST[k.tier] ?? 0), 0);
/** The cheapest legal pick, so scripted houses never get in the way. */
const cheapest: Drafter = (draft) => [...legalPicks(draft)].sort((a, b) => a.tier - b.tier)[0]?.id ?? 'none';
const knightOf = (draft: DraftState, tier: number): SquadKnight => {
  const knight = availableKnights(draft).find((k) => k.tier === tier && !k.forged);
  if (!knight) throw new Error(`No tier ${tier} knight left`);
  return knight;
};

describe('draftPool', () => {
  const pool = draftPool(7, FORGED);

  it('holds every roster knight with their own face, the generated knights and the forged knight', () => {
    expect(POOL_TIERS.reduce((s, n) => s + n, 0)).toBe(80);
    expect(pool).toHaveLength(81);
    expect(new Set(pool.map((k) => k.id)).size).toBe(pool.length);
    for (const house of REALM_HOUSES)
      for (const [role, look] of Object.entries(roster(house)))
        expect(pool.find((k) => k.id === `roster:${house.id}:${role}`)?.look).toEqual(look);
    expect(pool.filter((k) => k.id.startsWith('gen:'))).toHaveLength(48);
    expect(pool[0]).toEqual({ id: FORGED_ID, look: FORGED, tier: 2, forged: true });
    expect(pool.filter((k) => k.forged)).toHaveLength(1);
  });

  it('gives every knight a different name, the forged knight’s included', () => {
    expect(new Set(pool.map((k) => k.look.name)).size).toBe(pool.length);
    const namesake = draftPool(7, { ...FORGED, name: 'Ser Aldous' });
    expect(new Set(namesake.map((k) => k.look.name)).size).toBe(namesake.length);
  });

  it('has more Legends and Champions than houses, so a house saving for the top still finds one', () => {
    const [legends, champions] = [POOL_TIERS[4] ?? 0, POOL_TIERS[3] ?? 0];
    expect(legends).toBeGreaterThanOrEqual(12);
    expect(champions).toBeGreaterThanOrEqual(16);
    expect(pool.filter((k) => k.tier === 4)).toHaveLength(legends);
  });

  it('deals the tiers in the stated distribution, differently each season', () => {
    const others = pool.filter((k) => !k.forged);
    expect(POOL_TIERS.map((_, tier) => others.filter((k) => k.tier === tier).length)).toEqual(POOL_TIERS);
    expect(draftPool(7, FORGED)).toEqual(pool);
    const seasons = new Set(
      [1, 2, 3, 4].map((seed) =>
        draftPool(seed, FORGED)
          .map((k) => k.tier)
          .join(),
      ),
    );
    expect(seasons.size).toBe(4);
  });
});

describe('snake order', () => {
  it('draws all eight houses in a seeded order', () => {
    const draft = start();
    expect([...draft.order].sort()).toEqual([...DRAFT_HOUSES].sort());
    expect(start().order).toEqual(draft.order);
    expect(new Set([1, 2, 3, 4, 5].map((s) => start(s).order.join())).size).toBeGreaterThan(1);
  });

  it('runs forwards then backwards, six picks for each house', () => {
    const { order } = start();
    expect(houseForPick(order, 0)).toBe(order[0]);
    expect(houseForPick(order, 7)).toBe(order[7]);
    expect(houseForPick(order, 8)).toBe(order[7]);
    expect(houseForPick(order, 15)).toBe(order[0]);
    expect(houseForPick(order, TOTAL_PICKS)).toBeNull();
    const picks = Array.from({ length: TOTAL_PICKS }, (_, p) => houseForPick(order, p));
    for (const house of order) expect(picks.filter((h) => h === house)).toHaveLength(SQUAD_SIZE);
  });
});

describe('checkPick and applyPick', () => {
  it('refuses a pick out of turn, a knight already taken, an unknown knight and any pick after the end', () => {
    const draft = start();
    const [first, second] = draft.order;
    if (!first || !second) throw new Error('No order');
    expect(checkPick(draft, second, FORGED_ID)).toEqual({ ok: false, problem: 'out-of-turn' });
    expect(() => applyPick(draft, second, FORGED_ID)).toThrow();
    expect(checkPick(draft, first, 'gen:999')).toEqual({ ok: false, problem: 'unknown' });
    const after = applyPick(draft, first, 'gen:0');
    expect(checkPick(after, second, 'gen:0')).toEqual({ ok: false, problem: 'taken' });
    expect(draft.picks).toEqual([]);
    const done = play(draft, managed);
    expect(checkPick(done, first, 'gen:1')).toEqual({ ok: false, problem: 'complete' });
  });

  it('costs rise with every level, and the budget is exactly two Legends and four Peasants', () => {
    TIER_COST.slice(1).forEach((c, i) => {
      expect(c).toBeGreaterThan(TIER_COST[i] ?? Infinity);
    });
    expect(BUDGET).toBe(2 * (TIER_COST[4] ?? 0) + (SQUAD_SIZE - 2) * (TIER_COST[0] ?? 0));
  });

  it('lets a house draft two Legends, then keeps enough back for four Peasants (the reserve rule)', () => {
    // The house picking last in round one takes two Legends running: 22 of 26 points for 2 knights.
    let draft = start();
    const last = draft.order[7] ?? '';
    draft = play(draft, cheapest, 7);
    draft = applyPick(draft, last, knightOf(draft, 4).id);
    draft = applyPick(draft, last, knightOf(draft, 4).id);
    draft = play(draft, cheapest, 14);
    expect(houseOnTheClock(draft)).toBe(last);
    expect(budgetLeft(draft, last)).toBe(4);
    // 4 points for 4 knights: a Squire (2) would leave 2 for 3, so it is refused; a Peasant is fine.
    expect(checkPick(draft, last, knightOf(draft, 1).id)).toEqual({ ok: false, problem: 'own-reserve' });
    expect(checkPick(draft, last, knightOf(draft, 3).id)).toEqual({ ok: false, problem: 'over-budget' });
    expect(checkPick(draft, last, knightOf(draft, 0).id)).toEqual({ ok: true });
    draft = play(draft, cheapest);
    expect(squadOf(draft, last).map((k) => k.tier)).toEqual([4, 4, 0, 0, 0, 0]);
    expect(budgetLeft(draft, last)).toBe(0);
  });

  it('refuses a pick that would strand another house, even when the picker could afford it', () => {
    // Four houses take two Legends each, so they need all 16 Peasants; the other four take Squires.
    let draft = start();
    const needy = draft.order.slice(0, 4);
    const pickFor = (d: DraftState): string =>
      knightOf(d, needy.includes(houseOnTheClock(d) ?? '') ? 4 : 1).id;
    draft = play(draft, pickFor, 16);
    expect(availableKnights(draft).filter((k) => k.tier === 0)).toHaveLength(16);
    for (const house of needy) expect(budgetLeft(draft, house)).toBe(4);
    draft = play(draft, (d) => knightOf(d, 0).id, 4);
    // Round three reaches a house with points to spare: one more Peasant would leave 11 for 12 places.
    const rich = houseOnTheClock(draft) ?? '';
    expect(needy).not.toContain(rich);
    expect(budgetLeft(draft, rich)).toBeGreaterThan(20);
    expect(checkPick(draft, rich, knightOf(draft, 0).id)).toEqual({ ok: false, problem: 'rival-reserve' });
    expect(legalPicks(draft).some((k) => k.tier === 0)).toBe(false);
    expect(checkPick(draft, rich, knightOf(draft, 1).id)).toEqual({ ok: true });
  });

  it('never leaves a house stuck: random legal drafts always finish with full squads within budget', () => {
    for (let seed = 0; seed < 60; seed++) {
      const draft = play(start(seed), randomDrafter(seed));
      expect(isDraftComplete(draft)).toBe(true);
      for (const house of draft.order) {
        expect(squadOf(draft, house)).toHaveLength(SQUAD_SIZE);
        expect(cost(squadOf(draft, house))).toBeLessThanOrEqual(BUDGET);
      }
      expect(new Set(draft.picks).size).toBe(TOTAL_PICKS);
    }
  });
});

describe('the forged knight', () => {
  it('can be drafted by any house, rival houses included', () => {
    const draft = start(7, 'thorn');
    const rival = draft.order.find((h) => h !== 'thorn') ?? '';
    const atRival = play(draft, cheapest, draft.order.indexOf(rival));
    expect(checkPick(atRival, rival, FORGED_ID)).toEqual({ ok: true });
    expect(squadOf(applyPick(atRival, rival, FORGED_ID), rival).some((k) => k.forged)).toBe(true);
  });

  it('is drafted by rival managers in some seasons', () => {
    const takers = Array.from({ length: 12 }, (_, seed) => {
      const draft = play(start(seed, 'thorn'), managed);
      return draft.order.find((h) => squadOf(draft, h).some((k) => k.forged));
    });
    expect(takers.some((h) => h !== undefined && h !== 'thorn')).toBe(true);
  });
});

describe('the pool after a managed draft', () => {
  it('still has knights of every level left, so even the last picks are a choice', () => {
    for (const seed of [1, 2, 3, 4]) {
      const left = availableKnights(play(start(seed), managed));
      for (let tier = 0; tier < TIER_COST.length; tier++)
        expect(left.filter((k) => k.tier === tier).length).toBeGreaterThan(0);
    }
  });
});

describe('rival managers', () => {
  it('run until the player is on the clock, and the player can auto-pick', () => {
    const draft = runRivalPicks(start(7, 'thorn'));
    expect(houseOnTheClock(draft)).toBe('thorn');
    expect(runRivalPicks(draft)).toBe(draft);
    const after = autoPick(draft);
    expect(squadOf(after, 'thorn')).toHaveLength(1);
  });

  it('complete a legal season draft, the same way every time for a seed', () => {
    const season = (seed: number): DraftState => {
      let draft = runRivalPicks(start(seed, 'thorn'));
      while (!isDraftComplete(draft)) draft = runRivalPicks(autoPick(draft));
      return draft;
    };
    const draft = season(11);
    expect(season(11).picks).toEqual(draft.picks);
    for (const house of draft.order) {
      expect(squadOf(draft, house)).toHaveLength(SQUAD_SIZE);
      expect(budgetLeft(draft, house)).toBeGreaterThanOrEqual(0);
    }
  });

  it('draft squads the value model rates well above random legal drafts', () => {
    const mean = (drafter: (seed: number) => Drafter): number => {
      const values = [1, 2, 3, 4, 5, 6].flatMap((seed) => {
        const draft = play(start(seed), drafter(seed));
        return draft.order.map((h) => squadValue(squadOf(draft, h)));
      });
      return values.reduce((s, v) => s + v, 0) / values.length;
    };
    expect(mean(() => managed)).toBeGreaterThan(mean(randomDrafter) + 0.5);
  });

  it('follow their style: stars buy more Champions and Legends, depth spreads points over mid-tier knights', () => {
    const tally = (style: DraftStyle) => {
      const squads = [1, 2, 3, 4, 5, 6].flatMap((seed) => {
        const draft = play(start(seed), (d) => chooseDraftPick(d, style));
        return draft.order.map((h) => squadOf(draft, h));
      });
      return {
        top: squads.flat().filter((k) => k.tier >= 3).length,
        middle: squads.flat().filter((k) => k.tier === 1 || k.tier === 2).length,
      };
    };
    const [stars, depth] = [tally('stars'), tally('depth')];
    expect(stars.top).toBeGreaterThan(depth.top);
    expect(depth.middle).toBeGreaterThan(stars.middle);
  });
});

describe('defaultLineup', () => {
  const knight = (id: string, tier: number, build: number): SquadKnight => ({
    id,
    look: { ...DEFAULT_LOOK, name: id, build },
    tier,
    forged: false,
  });

  it('puts the Hefty in goal, the best three outfield and the rest on the bench', () => {
    const squad = [
      knight('a', 3, 1),
      knight('b', 2, 1),
      knight('c', 2, 2),
      knight('d', 4, 0),
      knight('e', 2, 1),
      knight('f', 3, 0),
    ];
    const { starters, bench } = defaultLineup(squad);
    expect(starters.map((s) => s.role)).toEqual(['gk', 'def', 'mid', 'fwd']);
    expect(starters.map((s) => s.look.name)).toEqual(['c', 'd', 'f', 'a']);
    expect(bench.map((k) => k.id)).toEqual(['b', 'e']);
    for (const spec of starters) {
      expect(spec.human).toBe(false);
      expect(spec.speedFactor).toBe(skillFor(spec.tier).speed);
    }
  });

  it('prefers a Peasant in goal to a better knight, as the keeper’s tier was measured not to matter', () => {
    const squad = [knight('a', 3, 1), knight('b', 0, 1), knight('c', 2, 2), knight('d', 4, 0)];
    expect(defaultLineup(squad).starters[0]?.look.name).toBe('b');
  });
});

describe('normalizeDraft', () => {
  // Built inside each test, so a broken picker fails these tests rather than the whole file.
  const saved = (picks = TOTAL_PICKS): DraftState => play(start(9), managed, picks);
  const roundTrip = (draft: DraftState): Record<string, unknown> =>
    JSON.parse(JSON.stringify(draft)) as Record<string, unknown>;

  it('restores saved drafts, part-played or complete', () => {
    const [partial, complete] = [saved(20), saved()];
    expect(normalizeDraft(roundTrip(partial))).toEqual(partial);
    expect(normalizeDraft(roundTrip(complete))).toEqual(complete);
  });

  it('rejects anything malformed', () => {
    const [partial, complete] = [saved(20), saved()];
    const base = roundTrip(partial);
    for (const bad of [
      null,
      'draft',
      { ...base, seed: -1 },
      { ...base, seed: 1.5 },
      { ...base, playerHouse: 'nowhere' },
      { ...base, forged: null },
      { ...base, order: [...partial.order.slice(0, 7), partial.order[0]] },
      { ...base, order: partial.order.slice(0, 7) },
      { ...base, picks: 'gen:0' },
      { ...base, picks: [...partial.picks, 42] },
      { ...base, picks: [...complete.picks, 'gen:0'] },
    ])
      expect(normalizeDraft(bad)).toBeNull();
  });

  it('rejects picks that could not have been made: repeated, unknown or breaking the reserve rule', () => {
    const partial = saved(20);
    const base = roundTrip(partial);
    expect(normalizeDraft({ ...base, picks: [...partial.picks, partial.picks[0]] })).toBeNull();
    expect(normalizeDraft({ ...base, picks: [...partial.picks, 'gen:999'] })).toBeNull();
    // The last house in round one takes two Legends running, leaving 4 points: only Peasants from then on.
    const draft = start(9);
    const pool = draftPool(9, FORGED);
    const ids = (tier: number, n: number): string[] =>
      pool
        .filter((k) => k.tier === tier && !k.forged)
        .slice(0, n)
        .map((k) => k.id);
    const legends = ids(4, 2);
    // Seven Squires before them, then fourteen Squires and a Knight until the last house is next on the clock.
    const squires = ids(1, 20);
    const picks = [...squires.slice(0, 7), ...legends, ...squires.slice(7), ...ids(2, 1)];
    expect(normalizeDraft({ ...roundTrip(draft), picks: [...picks, ...ids(0, 1)] })).not.toBeNull();
    expect(normalizeDraft({ ...roundTrip(draft), picks: [...picks, ...ids(2, 2).slice(1)] })).toBeNull();
  });
});
