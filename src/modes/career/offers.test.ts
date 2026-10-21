import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK } from '../../knight/look';
import { atClub, byRanking, fakeSeason } from '../../test/career';
import {
  endSeason,
  OFFERS_MAX,
  offerChance,
  OUTSTANDING_AVERAGE,
  PLAYER_ID,
  royalCall,
  startCareer,
  type CareerState,
} from './career';
import { divisionOf } from './clubs';

const start = (seed: number): CareerState => startCareer({ seed, look: DEFAULT_LOOK, position: 'fwd' });
/** A mid-table season everywhere, his matches all rated `player`, everyone else 6.5. */
function season(c: CareerState, player: number): CareerState {
  const clubs = c.world.divisions.flat();
  const mid = [...clubs.slice(0, 3), c.player.club, ...clubs.slice(3).filter((x) => x !== c.player.club)];
  return fakeSeason(c, byRanking(mid, { player, rating: 6.5 }));
}

describe('offers', () => {
  it('are likelier the better he is and the more famous, never certain', () => {
    expect(offerChance(3, 0, 2)).toBeGreaterThan(offerChance(2, 0, 2));
    expect(offerChance(2, 100, 2)).toBeGreaterThan(offerChance(2, 0, 2));
    expect(offerChance(10, 100, 0)).toBeLessThan(1);
    expect(offerChance(0, 0, 4)).toBeGreaterThan(0);
  });

  it('come from his division or the one above, at most three, never from his own club', () => {
    for (let seed = 0; seed < 12; seed++) {
      const ended = endSeason(season(start(seed), 7.5));
      const offers = ended.review?.offers ?? [];
      expect(offers.length).toBeLessThanOrEqual(OFFERS_MAX);
      for (const o of offers) {
        expect(o.club).not.toBe(ended.player.club);
        expect([0, 1]).toContain(o.division);
      }
      expect(new Set(offers.map((o) => o.club)).size).toBe(offers.length);
      expect(ended.history[0]?.offers).toEqual(offers.map((o) => o.club));
    }
  });

  it('reach two divisions up only after an outstanding season', () => {
    let twoUp = 0;
    for (let seed = 0; seed < 12; seed++) {
      const ended = endSeason(season(start(seed), OUTSTANDING_AVERAGE + 1));
      twoUp += (ended.review?.offers ?? []).filter((o) => o.division === 2).length;
    }
    expect(twoUp).toBeGreaterThan(0);
  });

  it('dry up after a poor season and multiply after a fine one', () => {
    const count = (rating: number) => {
      let n = 0;
      for (let seed = 0; seed < 12; seed++)
        n += endSeason(season(start(seed), rating)).review?.offers.length ?? 0;
      return n;
    };
    expect(count(5)).toBeLessThan(count(8));
  });

  it('are the same from the same season', () => {
    const c = season(start(4), 7.5);
    expect(endSeason(c).review).toEqual(endSeason(c).review);
  });
});

describe('the royal call-up', () => {
  const base = start(2);

  it('comes for one of the four best averages in the Great Houses, with the three others beside him', () => {
    const great = atClub(base, base.world.divisions[2]?.[0] ?? '');
    const squad = royalCall(season(great, 8));
    expect(squad?.[0]).toBe(PLAYER_ID);
    expect(squad).toHaveLength(4);
    expect(new Set(squad).size).toBe(4);
    expect(royalCall(season(great, 6))).toBeNull();
    // Eighth, behind the other seven houses' best knights at 6.8.
    expect(royalCall(season(great, 6.75))).toBeNull();
  });

  it('comes from the Shire only for the best there who would also rank near the top of the Great Houses', () => {
    const shire = atClub(base, base.world.divisions[1]?.[0] ?? '');
    expect(royalCall(season(shire, 8))?.[0]).toBe(PLAYER_ID);
    expect(royalCall(season(shire, 6.4))).toBeNull();
  });

  it('never comes in the Village League', () => {
    expect(divisionOf(base.world, base.player.club)).toBe(0);
    expect(royalCall(season(base, 10))).toBeNull();
  });

  it('plays a knockout of up to three rounds and pays for the honour', () => {
    const great = atClub(base, base.world.divisions[2]?.[0] ?? '');
    const ended = endSeason(season(great, 8));
    const royal = ended.review?.royal;
    expect(royal).toBeTruthy();
    expect(royal?.matches.length).toBeGreaterThanOrEqual(1);
    expect(royal?.matches.length).toBeLessThanOrEqual(3);
    royal?.matches.slice(0, -1).forEach((m) => {
      expect(m.score[0]).toBeGreaterThan(m.score[1]);
    });
    expect(ended.history[0]?.honours).toContain('royalCall');
    expect(endSeason(season(great, 8)).review?.royal).toEqual(royal);
  }, 30_000);
});
