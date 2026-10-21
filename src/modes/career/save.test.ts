import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK } from '../../knight/look';
import { byRanking, fakeMatchday, fakeSeason } from '../../test/career';
import {
  endSeason,
  nextSeason,
  PLAYER_ID,
  startCareer,
  type CareerState,
  type FixtureRecord,
  type RoyalResult,
} from './career';
import { normalizeCareer } from './save';

const fresh = startCareer({ seed: 31, look: DEFAULT_LOOK, position: 'def' });
const ranking = fresh.world.divisions.flat();
const midSeason = fakeMatchday(
  fakeMatchday(fresh, byRanking(ranking, { player: 7 })),
  byRanking(ranking, { player: 7 }),
);
const review = endSeason(fakeSeason(fresh, byRanking(ranking, { player: 7.2 })));
const second = nextSeason(review, review.review?.offers[0]?.club ?? null);

type Writable<T> = { -readonly [K in keyof T]: Writable<T[K]> };
type Save = Writable<CareerState>;

/** A deep copy through JSON, as storage gives it back, with `change` applied. */
function saved(c: CareerState, change: (save: Save) => void = () => undefined): unknown {
  const save = JSON.parse(JSON.stringify(c)) as Save;
  change(save);
  return save;
}

/** Sets a field to a value its type doesn't allow, as a hand-edited or corrupt save might. */
const poke = (target: object, key: string, value: unknown): void => {
  (target as Record<string, unknown>)[key] = value;
};
const at = <T>(xs: readonly T[] | undefined, i: number): T => {
  const x = xs?.[i];
  if (x === undefined) throw new Error(`nothing at ${i}`);
  return x;
};
/** The first fixture's record in a division, matchday 0. */
const firstRecord = (s: Save, division: number): Writable<FixtureRecord> => {
  const record = at(at(s.season.records[division], 0), 0);
  if (!record) throw new Error('no record');
  return record;
};
const squadOf = (s: Save, club: string) => s.world.squads[club] ?? [];
const staminaOf = (s: Save, club: string): Record<string, number> => {
  const stamina = s.season.stamina[club];
  if (!stamina) throw new Error(`no stamina for ${club}`);
  return stamina;
};
/** The review of a save made at a season's end. */
const reviewOf = (s: Save): NonNullable<Save['review']> => {
  if (!s.review) throw new Error('no review');
  return s.review;
};

describe('career saves', () => {
  it('read back exactly as saved: new, mid-season, at the review and into the next season', () => {
    for (const c of [fresh, midSeason, review, second]) expect(normalizeCareer(saved(c))).toEqual(c);
  });

  const broken: Record<string, (s: Save) => void> = {
    'a later version': (s) => {
      poke(s, 'version', 2);
    },
    'a negative seed': (s) => (s.seed = -1),
    'an age that does not match the seasons played': (s) => (s.player.age = 18),
    'a stat over its cap': (s) => (s.player.attributes.pace = 9),
    'a part level': (s) => (s.player.attributes.shot = 1.5),
    'wear of a whole level': (s) => (s.player.wear.pace = 1),
    'a guard twice': (s) => (s.player.guarded = ['pace', 'pace']),
    'negative points': (s) => (s.player.points = -1),
    'fame over the top': (s) => (s.player.fame = 101),
    'an unknown position': (s) => {
      poke(s.player, 'position', 'striker');
    },
    'an unknown club': (s) => (s.player.club = 'atlantis'),
    'form from the future': (s) => (s.player.form = [{ day: 99, residual: 0 }]),
    'a division of seven': (s) => s.world.divisions[0]?.pop(),
    'a club in two divisions': (s) => {
      at(s.world.divisions, 0)[0] = at(at(s.world.divisions, 1), 0);
    },
    'a squad of five': (s) => squadOf(s, 'mill').pop(),
    'two knights with one id': (s) => (at(squadOf(s, 'mill'), 1).id = at(squadOf(s, 'mill'), 0).id),
    'a tier past Legend': (s) => (at(squadOf(s, 'mill'), 0).tier = 5),
    'a knight id not yet issued': (s) => (s.world.nextKnight = 3),
    'a schedule the seed did not draw': (s) => (at(s.season.leagues, 1).seed += 1),
    'the wrong host for his league': (s) =>
      (at(s.season.leagues, 0).playerHouse = at(at(s.world.divisions, 0), 7)),
    'a result on a matchday not yet reached': (s) => (at(at(s.season.leagues, 2).results, 5)[0] = [1, 0]),
    'a score without a record': (s) => (at(at(s.season.records, 1), 0)[0] = null),
    'a record without a score': (s) => (at(at(s.season.records, 1), 5)[0] = firstRecord(s, 1)),
    'a goal by a knight of neither side': (s) =>
      (firstRecord(s, 0).goals = [{ side: 0, scorer: 'k9999', assist: null, ownGoal: false }]),
    'more goals than the score': (s) => {
      const record = firstRecord(s, 0);
      const extra = { scorer: null, assist: null, ownGoal: false } as const;
      record.goals = [...record.goals, ...record.goals, { side: 0, ...extra }, { side: 1, ...extra }];
    },
    'a rating out of range': (s) => {
      const ratings = firstRecord(s, 0).ratings;
      ratings[at(Object.keys(ratings), 0)] = 11;
    },
    'a man of the match who did not play': (s) => (firstRecord(s, 0).motm = 'k9999'),
    'stamina for a stranger': (s) => (staminaOf(s, 'mill').k9999 = 50),
    'stamina past full': (s) => (staminaOf(s, 'mill')[at(squadOf(s, 'mill'), 0).id] = 101),
    'the forged knight scoring for another club': (s) =>
      (firstRecord(s, 1).goals = [{ side: 0, scorer: PLAYER_ID, assist: null, ownGoal: false }]),
  };

  for (const [what, change] of Object.entries(broken))
    it(`refuse ${what}`, () => {
      expect(normalizeCareer(saved(midSeason))).not.toBeNull();
      expect(normalizeCareer(saved(midSeason, change))).toBeNull();
    });

  const royal = (
    scores: readonly (readonly [number, number])[],
    crowned: boolean,
  ): Writable<RoyalResult> => ({
    squad: [PLAYER_ID, 'k1', 'k2', 'k3'],
    matches: scores.map(([a, b], i) => ({
      opponent: `r${i}`,
      score: [a, b],
      rating: 7,
      goals: 0,
      motm: false,
    })),
    crowned,
  });

  const atReview: Record<string, (s: Save) => void> = {
    'a review before the season is over': (s) => (s.season = (saved(midSeason) as Save).season),
    'an offer from his own club': (s) => (reviewOf(s).offers = [{ club: s.player.club, division: 0 }]),
    'an offer in the wrong division': (s) => (reviewOf(s).offers = [{ club: 'ember', division: 0 }]),
    'four offers': (s) =>
      (reviewOf(s).offers = at(s.world.divisions, 0)
        .filter((c) => c !== s.player.club)
        .slice(0, 4)
        .map((club) => ({ club, division: 0 }))),
    'a history a season short': (s) => s.history.pop(),
    'a summary with an average but no matches': (s) => (at(s.history, 0).apps = 0),
    'an unknown honour': (s) => {
      poke(at(s.history, 0), 'honours', ['cup']);
    },
    'a crown without the final': (s) => (reviewOf(s).royal = royal([[2, 0]], true)),
    'a royal round after a defeat': (s) =>
      (reviewOf(s).royal = royal(
        [
          [0, 1],
          [2, 0],
        ],
        false,
      )),
  };

  for (const [what, change] of Object.entries(atReview))
    it(`refuse ${what}`, () => {
      expect(normalizeCareer(saved(review))).not.toBeNull();
      expect(normalizeCareer(saved(review, change))).toBeNull();
    });

  it('accept a royal run lost in the semi-final', () => {
    const raw = saved(review, (s) => {
      reviewOf(s).royal = royal(
        [
          [2, 0],
          [0, 1],
        ],
        false,
      );
    });
    expect(normalizeCareer(raw)?.review?.royal?.matches).toHaveLength(2);
  });

  it('refuse anything that is not a save at all', () => {
    for (const raw of [null, undefined, 1, 'career', [], {}]) expect(normalizeCareer(raw)).toBeNull();
  });
});
