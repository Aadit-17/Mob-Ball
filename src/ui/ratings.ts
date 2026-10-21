// The full-time ratings: both sides in two compact columns, coloured by band as football games do,
// with the man of the match marked and the player shown as "You".
import type { Role, TeamId } from '../game/types';
import type { House } from '../setup/houses';
import type { KnightRating, MatchRatings } from '../stats/ratings';
import { h } from './dom';

const ROLE_ORDER: readonly Role[] = ['gk', 'def', 'mid', 'fwd'];
const ROLE_SHORT: Readonly<Record<Role, string>> = { gk: 'GK', def: 'DEF', mid: 'MID', fwd: 'FWD' };

/** A rating as shown: one decimal. */
export const shownRating = (rating: number): string => (Math.round(rating * 10) / 10).toFixed(1);

/** The colour band of a rating as shown, so 6.96 reads 7.0 and is coloured as a 7. */
export function ratingBand(rating: number): 'low' | 'fair' | 'good' | 'great' {
  const shown = Math.round(rating * 10) / 10;
  return shown < 6 ? 'low' : shown < 7 ? 'fair' : shown < 8 ? 'good' : 'great';
}

export interface RatedKnight {
  readonly name: string;
  readonly human: boolean;
}

export function ratingsBoard(
  ratings: MatchRatings,
  houses: readonly [House, House],
  who: (id: number) => RatedKnight,
): HTMLElement {
  const motm = ratings.knights.find((k) => k.id === ratings.motm);
  const row = (k: KnightRating): HTMLElement => {
    const { name, human } = who(k.id);
    const star = k.id === ratings.motm;
    return h(
      'tr',
      { class: [star ? 'is-motm' : '', human ? 'is-you' : ''].filter(Boolean).join(' ') },
      h('td', { class: 'rt-role', text: ROLE_SHORT[k.role] }),
      h(
        'th',
        { class: 'rt-name', attrs: { scope: 'row' } },
        human ? 'You' : name,
        star && h('span', { class: 'rt-star', text: '★', attrs: { title: 'Man of the match' } }),
      ),
      h('td', {}, h('span', { class: `rt-score ${ratingBand(k.rating)}`, text: shownRating(k.rating) })),
    );
  };
  const side = (team: TeamId): HTMLElement => {
    const house = houses[team];
    const knights = ratings.knights
      .filter((k) => k.team === team)
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.id - b.id);
    return h(
      'table',
      { class: `rt ${team === 0 ? 'home' : 'away'}` },
      h('caption', { text: house.name }),
      h('tbody', {}, ...knights.map(row)),
    );
  };
  const motmName = motm ? (who(motm.id).human ? 'You' : who(motm.id).name) : '';
  return h(
    'section',
    { class: 'ratings', attrs: { 'aria-label': 'Match ratings' } },
    h('div', { class: 'rt-sides' }, side(0), side(1)),
    motm &&
      h(
        'p',
        { class: 'rt-motm' },
        h('span', { class: 'rt-star', text: '★' }),
        ` Man of the match: ${motmName}, ${shownRating(motm.rating)}`,
      ),
  );
}
