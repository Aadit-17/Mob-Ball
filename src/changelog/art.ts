/** Inline SVG art for the chronicle. Static, trusted markup only. */
import type { ChangeKind } from './releases';

const INK = '#2a1e3b';
const HOUSE_COLOURS = ['#e8453c', '#3d3d6b', '#3f9a4a', '#3f8fd8'];

/** A castle skyline with a pennant flying from each tower in a house colour. */
export function castleSkyline(): string {
  const towers = [
    { x: 40, w: 70, h: 120 },
    { x: 150, w: 90, h: 170 },
    { x: 290, w: 110, h: 210 },
    { x: 450, w: 90, h: 170 },
    { x: 580, w: 70, h: 120 },
  ];
  const base = 230;
  const parts = towers.map((t, i) => {
    const top = base - t.h;
    const merlons = Array.from(
      { length: Math.floor(t.w / 18) },
      (_, m) => `<rect x="${t.x + 4 + m * 18}" y="${top - 12}" width="11" height="14" rx="2"/>`,
    ).join('');
    const flag = HOUSE_COLOURS[i % HOUSE_COLOURS.length] ?? INK;
    const pole = t.x + t.w / 2;
    return `
      <g fill="#e9dcc3" stroke="${INK}" stroke-width="4" stroke-linejoin="round">
        <rect x="${t.x}" y="${top}" width="${t.w}" height="${t.h}" rx="4"/>${merlons}
        <path d="M${pole - 9} ${top + 40} a9 9 0 0 1 18 0 v22 h-18z" fill="#4a3f5e"/>
      </g>
      <line x1="${pole}" y1="${top - 12}" x2="${pole}" y2="${top - 60}" stroke="${INK}" stroke-width="4"/>
      <path class="pennant" d="M${pole} ${top - 60} q22 4 38 12 l-38 12z" fill="${flag}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;
  });
  return `<svg class="skyline" viewBox="0 0 690 240" role="img" aria-label="A castle with four house banners">
    <path d="M0 230 H690" stroke="${INK}" stroke-width="4"/>
    <rect x="95" y="150" width="500" height="80" fill="#ddd0b4" stroke="${INK}" stroke-width="4" rx="3"/>
    <path d="M320 230 v-52 a25 25 0 0 1 50 0 v52z" fill="#4a3f5e" stroke="${INK}" stroke-width="4"/>
    ${parts.join('')}
  </svg>`;
}

/** Two crossed swords, used between releases. */
export function crossedSwords(): string {
  const sword = (rotate: number): string => `
    <g transform="rotate(${rotate} 60 60)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round">
      <path d="M57 8 h6 l3 70 h-12z" fill="#d6dde8"/>
      <rect x="42" y="78" width="36" height="8" rx="4" fill="#ffc93c"/>
      <rect x="56" y="86" width="8" height="20" rx="3" fill="#8a5a30"/>
      <circle cx="60" cy="110" r="6" fill="#ffc93c"/>
    </g>`;
  return `<svg class="swords" viewBox="0 0 120 120" aria-hidden="true">${sword(-40)}${sword(40)}</svg>`;
}

/** A wax seal stamped with the version number. */
export function waxSeal(version: string): string {
  const scallops = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return `<circle cx="${50 + Math.cos(a) * 38}" cy="${50 + Math.sin(a) * 38}" r="9"/>`;
  }).join('');
  return `<svg class="seal" viewBox="0 0 100 100" role="img" aria-label="Version ${version}">
    <g fill="#b3202a" stroke="${INK}" stroke-width="3">${scallops}<circle cx="50" cy="50" r="38"/></g>
    <circle cx="50" cy="50" r="27" fill="none" stroke="#7d1219" stroke-width="3"/>
    <text x="50" y="61" text-anchor="middle">v${version}</text>
  </svg>`;
}

const SHIELD_SYMBOLS: Record<ChangeKind, string> = {
  new: '<path d="M20 11 l2.6 5.6 6.1.6 -4.6 4.1 1.3 6 -5.4-3.1 -5.4 3.1 1.3-6 -4.6-4.1 6.1-.6z" fill="#fff8e8"/>',
  improved:
    '<path d="M11 24 l9-9 9 9" fill="none" stroke="#fff8e8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  fixed:
    '<g fill="#fff8e8"><rect x="18" y="16" width="4" height="15" rx="1.5"/><rect x="12" y="11" width="16" height="7" rx="2"/></g>',
};

const SHIELD_COLOURS: Record<ChangeKind, string> = { new: '#e8453c', improved: '#3f8fd8', fixed: '#3f9a4a' };

/** A heraldic shield marking what kind of change a line is. */
export function kindShield(kind: ChangeKind): string {
  return `<svg class="shield" viewBox="0 0 40 44" aria-hidden="true">
    <path d="M4 4 h32 v16 c0 12 -8 18 -16 21 c-8 -3 -16 -9 -16 -21z" fill="${SHIELD_COLOURS[kind]}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    ${SHIELD_SYMBOLS[kind]}
  </svg>`;
}
