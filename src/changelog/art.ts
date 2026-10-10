/** Inline SVG art for the chronicle. Static, trusted markup only. */
import { HOUSES } from '../setup/houses';
import { PALETTE } from '../ui/palette';
import type { ChangeKind } from './releases';

const { mortar: MORTAR, goldRim: GOLD_RIM, gold: GOLD, iron: IRON, trim: TRIM } = PALETTE;

/** A night castle with lit windows and a pennant in each house colour. */
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
      (_, m) => `<rect x="${t.x + 4 + m * 18}" y="${top - 12}" width="11" height="14" rx="1"/>`,
    ).join('');
    const flag = HOUSES[i % HOUSES.length]?.colour ?? GOLD_RIM;
    const pole = t.x + t.w / 2;
    return `
      <g fill="url(#stone)" stroke="${MORTAR}" stroke-width="4" stroke-linejoin="round">
        <rect x="${t.x}" y="${top}" width="${t.w}" height="${t.h}" rx="2"/>${merlons}
      </g>
      <path d="M${pole - 9} ${top + 40} a9 9 0 0 1 18 0 v22 h-18z" fill="url(#window)" stroke="${MORTAR}" stroke-width="3"/>
      <line x1="${pole}" y1="${top - 12}" x2="${pole}" y2="${top - 60}" stroke="${GOLD_RIM}" stroke-width="3"/>
      <path class="pennant" d="M${pole} ${top - 60} q22 4 38 12 l-38 12z" fill="${flag}" stroke="${TRIM}" stroke-width="2" stroke-linejoin="round"/>`;
  });
  return `<svg class="skyline" viewBox="0 0 690 240" role="img" aria-label="A castle at night flying the four house banners">
    <defs>
      <linearGradient id="stone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4350"/><stop offset="1" stop-color="#2c2832"/></linearGradient>
      <radialGradient id="window" cx=".5" cy=".7" r=".7"><stop offset="0" stop-color="#fff2b8"/><stop offset=".5" stop-color="#ffb347"/><stop offset="1" stop-color="#c9602a"/></radialGradient>
    </defs>
    <rect x="95" y="150" width="500" height="80" fill="url(#stone)" stroke="${MORTAR}" stroke-width="4" rx="2"/>
    <path d="M320 230 v-52 a25 25 0 0 1 50 0 v52z" fill="#1b181f" stroke="${MORTAR}" stroke-width="4"/>
    <path d="M330 230 v-58 M345 230 v-62 M360 230 v-58 M322 190 h46 M321 210 h48" stroke="${GOLD_RIM}" stroke-width="2.5" opacity=".8"/>
    ${parts.join('')}
    <path d="M0 230 H690" stroke="${IRON}" stroke-width="4"/>
  </svg>`;
}

/** Two crossed swords, used between releases. */
export function crossedSwords(): string {
  const sword = (rotate: number): string => `
    <g transform="rotate(${rotate} 60 60)" stroke="${MORTAR}" stroke-width="3.5" stroke-linejoin="round">
      <path d="M57 8 h6 l3 70 h-12z" fill="#d6dde8"/>
      <rect x="42" y="78" width="36" height="8" rx="4" fill="${GOLD}"/>
      <rect x="56" y="86" width="8" height="20" rx="3" fill="#6b4a2a"/>
      <circle cx="60" cy="110" r="6" fill="${GOLD}"/>
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
    <g fill="#b3202a" stroke="#4a0c12" stroke-width="3">${scallops}<circle cx="50" cy="50" r="38"/></g>
    <circle cx="50" cy="50" r="27" fill="none" stroke="#7d1219" stroke-width="3"/>
    <text x="50" y="59" text-anchor="middle">v${version}</text>
  </svg>`;
}

const SHIELD_SYMBOLS: Record<ChangeKind, string> = {
  new: '<path d="M20 11 l2.6 5.6 6.1.6 -4.6 4.1 1.3 6 -5.4-3.1 -5.4 3.1 1.3-6 -4.6-4.1 6.1-.6z" fill="#fff8e8"/>',
  improved:
    '<path d="M11 24 l9-9 9 9" fill="none" stroke="#fff8e8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  fixed:
    '<g fill="#fff8e8"><rect x="18" y="16" width="4" height="15" rx="1.5"/><rect x="12" y="11" width="16" height="7" rx="2"/></g>',
};

const SHIELD_COLOURS: Record<ChangeKind, string> = { new: '#c0392b', improved: '#2f6fb5', fixed: '#2e7d38' };

/** A heraldic shield marking what kind of change a line is. */
export function kindShield(kind: ChangeKind): string {
  return `<svg class="shield" viewBox="0 0 40 44" aria-hidden="true">
    <path d="M4 4 h32 v16 c0 12 -8 18 -16 21 c-8 -3 -16 -9 -16 -21z" fill="${SHIELD_COLOURS[kind]}" stroke="${GOLD_RIM}" stroke-width="2.5" stroke-linejoin="round"/>
    ${SHIELD_SYMBOLS[kind]}
  </svg>`;
}
