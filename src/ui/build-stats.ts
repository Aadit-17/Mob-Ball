import { BUILDS } from '../game/constants';
import { option } from '../knight/catalog';
import type { Look } from '../knight/look';
import { h } from './dom';

const RATING_MAX = 5;

/** The knight's build and its speed, power and weight bars. */
export function buildStatRows(look: Look): HTMLElement[] {
  const build = option(BUILDS, look.build);
  return [
    h('div', {}, h('span', { text: 'Build' }), h('b', { text: build.name })),
    ...['Speed', 'Power', 'Weight'].map((label, i) => {
      const rating = build.rating[i] ?? 0;
      return h(
        'div',
        {},
        h('span', { text: label }),
        h(
          'div',
          {
            class: 'statbar',
            attrs: { role: 'img', 'aria-label': `${label} ${rating} of ${RATING_MAX}` },
          },
          h('i', { style: { width: `${(rating / RATING_MAX) * 100}%` } }),
        ),
      );
    }),
  ];
}
