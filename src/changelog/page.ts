import { h } from '../ui/dom';
import { castleSkyline, crossedSwords, kindShield, waxSeal } from './art';
import { RELEASES, type ChangeKind, type Release } from './releases';
import './changelog.css';

const KIND_LABELS: Record<ChangeKind, string> = { new: 'New', improved: 'Improved', fixed: 'Fixed' };
const HORIZON = [
  { name: 'Realm Cup', text: 'A knockout tournament against the great houses.' },
  { name: 'My Career', text: 'Take your knight from village team to royal squad.' },
  { name: 'Manager', text: 'Run a house: draft knights, set line-ups, win the league.' },
];

/** Parses markup the page itself authors (the SVG art), never user or release text. */
function art(markup: string): Element {
  const holder = document.createElement('div');
  holder.innerHTML = markup.trim();
  const node = holder.firstElementChild;
  if (!node) throw new Error('Empty artwork');
  return node;
}

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
    { class: 'scroll', attrs: { id: `v${release.version}`, 'aria-labelledby': `v${release.version}-title` } },
    art(waxSeal(release.version)),
    h(
      'div',
      { class: 'scroll-head' },
      h(
        'p',
        { class: 'ribbon' },
        h('time', { text: formatDate(release.date), attrs: { datetime: release.date } }),
        latest && h('span', { class: 'latest', text: 'Latest' }),
      ),
      h('h2', { class: 'gradient', text: release.title, attrs: { id: `v${release.version}-title` } }),
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
          art(kindShield(change.kind)),
          h('span', { class: 'visually-hidden', text: `${KIND_LABELS[change.kind]}: ` }),
          h('span', { text: change.text }),
        ),
      ),
    ),
  );
}

function render(root: HTMLElement): void {
  const scrolls = RELEASES.flatMap((release, i) => [
    ...(i > 0 ? [h('li', { class: 'divider', attrs: { 'aria-hidden': 'true' } }, art(crossedSwords()))] : []),
    h('li', {}, releaseScroll(release, i === 0)),
  ]);
  root.append(
    h(
      'header',
      { class: 'herald' },
      h('a', { class: 'back', text: '← Back to the game', attrs: { href: './' } }),
      h('p', { class: 'kicker', text: 'Hear ye, hear ye!' }),
      h('h1', { class: 'gradient title', text: 'The Chronicle' }),
      h('p', { class: 'lede', text: 'Every update to MOB BALL, proclaimed from the castle walls.' }),
      art(castleSkyline()),
    ),
    h(
      'ul',
      { class: 'legend', attrs: { 'aria-label': 'Kinds of change' } },
      ...(Object.keys(KIND_LABELS) as ChangeKind[]).map((kind) =>
        h('li', {}, art(kindShield(kind)), KIND_LABELS[kind]),
      ),
    ),
    h('ol', { class: 'releases', attrs: { reversed: '' } }, ...scrolls),
    h(
      'section',
      { class: 'horizon', attrs: { 'aria-labelledby': 'horizon-title' } },
      h('h2', { class: 'gradient', text: 'On the horizon', attrs: { id: 'horizon-title' } }),
      h(
        'ul',
        {},
        ...HORIZON.map((mode) =>
          h(
            'li',
            {},
            h('b', { text: mode.name }),
            h('span', { text: mode.text }),
            h('em', { text: 'Coming soon' }),
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
