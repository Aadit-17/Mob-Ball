import type { House } from '../setup/houses';
import { h, svg } from './dom';
import { PALETTE } from './palette';

interface Arms {
  /** Text-safe version of the kit colour for blocks with white text (≥ 4.5:1). */
  readonly block: string;
  /** The house's charge, drawn on a 24×24 grid. */
  readonly charge: string;
}

const ARMS: Readonly<Record<string, Arms>> = {
  ember: {
    block: '#c0392b',
    charge: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 2 1 3 2 3 0-3-1-5 1-8z"/>',
  },
  corvane: { block: '#3d3d6b', charge: '<path d="M15 3a9 9 0 1 0 6 15A8 8 0 0 1 15 3z"/>' },
  thorn: {
    block: '#2e7d38',
    charge:
      '<circle cx="12" cy="7" r="4"/><circle cx="7" cy="13" r="4"/><circle cx="17" cy="13" r="4"/><path d="M11 13h2v9h-2z"/>',
  },
  grey: {
    block: '#2f6fb5',
    charge: '<path d="M5 3h3v3h2V3h4v3h2V3h3v6l-2 2v10h-4v-4a1 1 0 0 0-2 0v4H7V11L5 9z"/>',
  },
};

function armsOf(house: House): Arms {
  const found = ARMS[house.id] ?? ARMS.ember;
  if (!found) throw new Error(`No arms for house ${house.id}`);
  return found;
}

export const blockColour = (house: House): string => armsOf(house).block;

/** The house charge as an inline icon in the current text colour. */
export function crest(house: House): SVGElement {
  return svg(
    `<svg class="crest" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${armsOf(house).charge}</svg>`,
  );
}

/** A house banner hanging from a gold rod; `sway` offsets its idle sway in seconds. */
export function banner(house: House, sway: number): HTMLElement {
  const el = h(
    'div',
    { class: 'banner', attrs: { title: `House ${house.name}`, style: `animation-delay: ${sway}s` } },
    h('div', { class: 'rod' }),
  );
  el.append(
    svg(`<svg viewBox="0 0 56 132" aria-hidden="true">
      <path d="M2 0H54V132L28 110L2 132Z" fill="${house.colour}"/>
      <path d="M2 0H54V22H2Z" fill="#000" fill-opacity=".18"/>
      <path d="M7 4H49V120L28 102L7 120Z" fill="none" stroke="${PALETTE.trim}" stroke-width="2.5"/>
      <path d="M7 76L28 62L49 76" fill="none" stroke="${PALETTE.trim}" stroke-width="2.5"/>
      <g transform="translate(14 26) scale(1.17)" fill="#fbe9b8">${armsOf(house).charge}</g>
    </svg>`),
  );
  return el;
}

/** Wall torches at both edges of the viewport, behind the content of a positioned parent. */
export function torches(): HTMLElement {
  return h(
    'div',
    { class: 'torches', attrs: { 'aria-hidden': 'true' } },
    ...['l', 'r'].map((side) =>
      h(
        'div',
        { class: `torch ${side}` },
        h('div', { class: 'light' }),
        h('div', { class: 'flame' }),
        h('div', { class: 'cup' }),
        h('div', { class: 'arm' }),
      ),
    ),
  );
}

/** A shield quartered in all four house colours with each charge on its quarter. */
export function quarteredShield(houses: readonly House[]): HTMLElement {
  const [a, b, c, d] = houses;
  const shield = h('div', { class: 'quartered', attrs: { 'aria-hidden': 'true' } });
  if (!a || !b || !c || !d) return shield;
  shield.style.setProperty('--q1', a.colour);
  shield.style.setProperty('--q2', b.colour);
  shield.style.setProperty('--q3', c.colour);
  shield.style.setProperty('--q4', d.colour);
  shield.append(h('i'), ...[a, b, c, d].map((house) => crest(house)));
  return shield;
}

const ICONS = {
  ball: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5l4 2.9-1.5 4.6h-5L8 10.4z" fill="currentColor"/><path d="M12 3v4.5M16 10.4l4.3-1.4M14.5 15l2.7 3.6M9.5 15l-2.7 3.6M8 10.4L3.7 9" stroke="currentColor" stroke-width="1.6"/>',
  cup: '<path d="M7 3h10v4a5 5 0 0 1-10 0zM7 5H3.5v1.5A4 4 0 0 0 7.5 10.5M17 5h3.5v1.5a4 4 0 0 1-4 4M12 12v4M8 21h8M9.5 21l.8-5h3.4l.8 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
  helm: '<path d="M5 20v-7a7 7 0 0 1 14 0v7zM5 13.5h14M12 6v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 16h2.5M13.5 16H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  scroll:
    '<path d="M7 3h11a2 2 0 0 1 2 2v2h-4M7 3a2 2 0 0 0-2 2v13a3 3 0 0 0 3 3h9a2 2 0 0 0 2-2V7M9 9h6M9 13h6M9 17h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
  sound:
    '<path d="M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
  muted:
    '<path d="M4 9h4l5-4v14l-5-4H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  pause:
    '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.6"/>',
} as const;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName): SVGElement =>
  svg(`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`);
