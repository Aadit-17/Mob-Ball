import { HOUSES } from '../setup/houses';
import { h, svg } from '../ui/dom';
import { banner, icon, torches } from '../ui/heraldry';
import { castleSkyline, crossedSwords, kindShield, waxSeal } from './art';
import { HORIZON, RELEASES, type ChangeKind, type Release } from './releases';
import './changelog.css';

const KIND_LABELS: Record<ChangeKind, string> = { new: 'New', improved: 'Improved', fixed: 'Fixed' };

const BANNER_SWAY = [0, -1.3, -2.1, -0.6];

const formatDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

function tally(release: Release): string {
  return (Object.keys(KIND_LABELS) as ChangeKind[])
    .map((kind) => [kind, release.changes.filter((c) => c.kind === kind).length] as const)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${KIND_LABELS[kind].toLowerCase()}`)
    .join(' · ');
}

function releaseScroll(release: Release, latest: boolean): HTMLElement {
  return h(
    'article',
    {
      class: 'scroll sh',
      attrs: { id: `v${release.version}`, 'aria-labelledby': `v${release.version}-title` },
    },
    h('div', { class: 'rod', attrs: { 'aria-hidden': 'true' } }),
    svg(waxSeal(release.version)),
    h(
      'div',
      { class: 'scroll-head' },
      h(
        'p',
        { class: 'ribbon' },
        h('time', { text: formatDate(release.date), attrs: { datetime: release.date } }),
        latest && h('span', { class: 'latest', text: 'Latest' }),
      ),
      h('h2', { text: release.title, attrs: { id: `v${release.version}-title` } }),
      h('p', { class: 'summary', text: release.summary }),
      h('p', { class: 'tally', text: tally(release) }),
    ),
    h(
      'ul',
      { class: 'changes' },
      ...release.changes.map((change) =>
        h(
          'li',
          { class: `change is-${change.kind}` },
          svg(kindShield(change.kind)),
          h('span', { class: 'visually-hidden', text: `${KIND_LABELS[change.kind]}: ` }),
          h('span', { text: change.text }),
        ),
      ),
    ),
  );
}

function render(root: HTMLElement): void {
  const scrolls = RELEASES.flatMap((release, i) => [
    ...(i > 0 ? [h('li', { class: 'divider', attrs: { 'aria-hidden': 'true' } }, svg(crossedSwords()))] : []),
    h('li', {}, releaseScroll(release, i === 0)),
  ]);
  const banners = HOUSES.map((house, i) => banner(house, BANNER_SWAY[i] ?? 0));
  root.append(
    h(
      'header',
      { class: 'herald' },
      torches(),
      h('a', { class: 'btn back', text: '← Back to the game', attrs: { href: './' } }),
      h('p', { class: 'kicker', text: 'Hear ye, hear ye!' }),
      h(
        'div',
        { class: 'title-row' },
        h('div', { class: 'banners' }, ...banners.slice(0, 2)),
        h('h1', { class: 'title metal', text: 'The Chronicle', attrs: { 'data-text': 'The Chronicle' } }),
        h('div', { class: 'banners' }, ...banners.slice(2)),
      ),
      h('p', { class: 'lede', text: 'Every update to MOB BALL, proclaimed from the castle walls.' }),
      svg(castleSkyline()),
    ),
    h(
      'ul',
      { class: 'legend', attrs: { 'aria-label': 'Kinds of change' } },
      ...(Object.keys(KIND_LABELS) as ChangeKind[]).map((kind) =>
        h('li', {}, svg(kindShield(kind)), KIND_LABELS[kind]),
      ),
    ),
    h('ol', { class: 'releases', attrs: { reversed: '' } }, ...scrolls),
    h(
      'section',
      { class: 'horizon', attrs: { 'aria-labelledby': 'horizon-title' } },
      h('h2', { text: 'On the horizon', attrs: { id: 'horizon-title' } }),
      h(
        'ul',
        {},
        ...HORIZON.map((mode) =>
          h(
            'li',
            { class: 'sh' },
            h('b', { text: mode.name }),
            h('span', { text: mode.text }),
            h('em', { class: 'soon' }, icon('lock'), 'Coming soon'),
          ),
        ),
      ),
    ),
    h('footer', { class: 'colophon', text: 'MOB BALL · medieval football' }),
  );
}

const root = document.getElementById('chronicle');
if (!root) throw new Error('Missing #chronicle element');
render(root);
