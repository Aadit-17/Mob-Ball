// The full-time ratings: both sides in two compact columns, coloured by band as football games do, with
// the man of the match marked and the player shown as "You". A rating opens to show what made it up.
import type { Role, TeamId } from '../game/types';
import type { House } from '../setup/houses';
import type { KnightRating, MatchRatings, RatingBreakdown } from '../stats/ratings';
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

const signed = (x: number): string => {
  const shown = Math.abs(x).toFixed(1);
  return shown === '0.0' ? shown : `${x < 0 ? '−' : '+'}${shown}`;
};
const round1 = (x: number): number => Math.round(x * 10) / 10;

/** A breakdown as shown: each part to one decimal, the rounding left over said out loud, then any cap. */
export function breakdownParts(b: RatingBreakdown): { label: string; value: string }[] {
  const parts = [
    { label: 'Base', value: b.base.toFixed(1), shown: round1(b.base) },
    ...b.lines.map((l) => ({
      label: l.count ? `${l.label} ${l.count}` : l.label,
      value: signed(l.points),
      shown: round1(l.points),
    })),
  ];
  const rest = round1(round1(b.score) - parts.reduce((sum, p) => sum + p.shown, 0));
  if (rest !== 0) parts.push({ label: 'Rounding', value: signed(rest), shown: rest });
  const cap = round1(round1(b.rating) - round1(b.score));
  if (cap !== 0)
    parts.push({ label: b.rating >= 10 ? 'Capped at 10' : 'Floored at 3', value: signed(cap), shown: cap });
  return parts.map(({ label, value }) => ({ label, value }));
}

export interface RatedKnight {
  readonly name: string;
  readonly human: boolean;
}

/** The breakdown under a knight's row: what made his rating, part by part, adding up to it. */
function whyRow(id: string, b: RatingBreakdown, open: boolean): HTMLElement {
  const parts = breakdownParts(b);
  const list = h(
    'ul',
    { class: 'why' },
    ...parts.map((p) => h('li', {}, h('span', { text: p.label }), h('b', { text: p.value }))),
    h('li', { class: 'why-total' }, h('span', { text: 'Rating' }), h('b', { text: shownRating(b.rating) })),
  );
  const row = h('tr', { class: 'rt-why', attrs: { id } }, h('td', { attrs: { colspan: '3' } }, list));
  row.hidden = !open;
  return row;
}

export function ratingsBoard(
  ratings: MatchRatings,
  houses: readonly [House, House],
  who: (id: number) => RatedKnight,
  explain: (id: number) => RatingBreakdown | null = () => null,
): HTMLElement {
  const motm = ratings.knights.find((k) => k.id === ratings.motm);
  const rows = (k: KnightRating): HTMLElement[] => {
    const { name, human } = who(k.id);
    const star = k.id === ratings.motm;
    const why = explain(k.id);
    const detail = why && whyRow(`why-${String(k.id)}`, why, human);
    const badge = h('span', { class: `rt-score ${ratingBand(k.rating)}`, text: shownRating(k.rating) });
    const score = detail
      ? h(
          'button',
          {
            class: 'rt-open',
            attrs: {
              type: 'button',
              'aria-expanded': String(!detail.hidden),
              'aria-controls': detail.id,
              'aria-label': `${human ? 'Your' : `${name}'s`} rating, ${shownRating(k.rating)}: what made it`,
            },
            on: {
              click: (e) => {
                detail.hidden = !detail.hidden;
                (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!detail.hidden));
              },
            },
          },
          badge,
        )
      : badge;
    const row = h(
      'tr',
      { class: [star ? 'is-motm' : '', human ? 'is-you' : ''].filter(Boolean).join(' ') },
      h('td', { class: 'rt-role', text: ROLE_SHORT[k.role] }),
      h(
        'th',
        { class: 'rt-name', attrs: { scope: 'row' } },
        human ? 'You' : name,
        star && h('span', { class: 'rt-star', text: '★', attrs: { title: 'Man of the match' } }),
      ),
      h('td', {}, score),
    );
    return detail ? [row, detail] : [row];
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
      h('tbody', {}, ...knights.flatMap(rows)),
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
    h('p', { class: 'rt-hint', text: 'Tap a rating to see what made it.' }),
  );
}
