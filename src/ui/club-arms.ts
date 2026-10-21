// Arms for the career's shire and village clubs, drawn like the houses' on a 24×24 grid. The eight great houses
// keep their own in heraldry.ts; these fill in for the sixteen clubs below them.

export interface ClubArms {
  /** Text-safe version of the club colour for blocks with white text (≥ 4.5:1). */
  readonly block: string;
  readonly charge: string;
}

export const CLUB_ARMS: Readonly<Record<string, ClubArms>> = {
  ashby: {
    block: '#5f6a1f',
    charge:
      '<path d="M11 2h2v4h-2z"/><path d="M5.5 10a6.5 4.5 0 0 1 13 0z"/><path d="M7 11h10c0 5.5-2.5 9.5-5 11-2.5-1.5-5-5.5-5-11z"/>',
  },
  briar: {
    block: '#8e2f4f',
    charge:
      '<circle cx="12" cy="6.5" r="3.6"/><circle cx="17.2" cy="10.3" r="3.6"/><circle cx="15.2" cy="16.4" r="3.6"/><circle cx="8.8" cy="16.4" r="3.6"/><circle cx="6.8" cy="10.3" r="3.6"/><circle cx="12" cy="12" r="3"/>',
  },
  dun: {
    block: '#4f5a63',
    charge: '<path d="M1 21 9 7l4 6 3-4 7 12z"/><circle cx="18.5" cy="5" r="2.5"/>',
  },
  fen: {
    block: '#2f6b5b',
    charge:
      '<path d="M13 2.5a2.5 2.5 0 0 1 2.4 1.8L22 6l-6.5 1.2c0 3.2-3 4.3-3 7.3 2 .4 4.5 1.8 4.5 4.5-3.5 0-9.5-1.5-10.5-5.5 3 0 5-1.3 5-4.2 0-1.8-1-2.8-1-4.3A2.5 2.5 0 0 1 13 2.5z"/><path d="M10.5 18h1.6v4.5h-1.6zM13.5 18.5h1.6v4h-1.6z"/>',
  },
  harrow: {
    block: '#a63d28',
    charge:
      '<path fill-rule="evenodd" d="M3 22V10a9 9 0 0 1 18 0v12zM6.5 12h2.2v8H6.5zm4.4-2h2.2v10h-2.2zm4.4 2h2.2v8h-2.2z"/>',
  },
  kestrel: {
    block: '#8a5f17',
    charge: '<path d="M12 5c1.2 0 2 .9 2 2l8-1-7 5.5-.8 6 2.3 4.5h-9l2.3-4.5-.8-6L2 6l8 1c0-1.1.8-2 2-2z"/>',
  },
  raven: {
    block: '#2c2c3a',
    charge:
      '<path d="M2.5 13c2-5 7-7.5 11-6.5L16.5 4l4.5 2-3.3 2c1 3.2-.2 7-4.2 8.7l2 5.3h-2.2l-2-4.6h-1.8l1 4.6H8.3l-1.1-4.8C5 16.7 3.2 15.2 2.5 13z"/>',
  },
  wold: {
    block: '#6f6430',
    charge:
      '<path d="M11 10h2v12h-2zM7.7 11.4 11 15.5 10 22H8l.9-5.8-3-3.8zM16.3 11.4 13 15.5l1 6.5h2l-.9-5.8 3-3.8zM7.5 14h9v2.2h-9z"/><ellipse cx="12" cy="6" rx="2.1" ry="4.2"/><ellipse cx="7.3" cy="7.8" rx="1.8" ry="3.6" transform="rotate(-28 7.3 7.8)"/><ellipse cx="16.7" cy="7.8" rx="1.8" ry="3.6" transform="rotate(28 16.7 7.8)"/>',
  },
  cobble: {
    block: '#6a5b4c',
    charge:
      '<rect x="2" y="3" width="9" height="5" rx="2"/><rect x="13" y="3" width="9" height="5" rx="2"/><rect x="2" y="10" width="5.5" height="5" rx="2"/><rect x="9.5" y="10" width="12.5" height="5" rx="2"/><rect x="2" y="17" width="12" height="5" rx="2"/><rect x="16" y="17" width="6" height="5" rx="2"/>',
  },
  goose: {
    block: '#86641a',
    charge:
      '<path d="M7.5 2.5a3 3 0 0 1 3 3V11c4-1.2 9 0 11 4-1 4-5 6-10 6-5 0-8.5-3-8.5-6 0-2 1.5-3.2 3.5-3.3V7.2L2.5 6.6l2.6-2.4a3 3 0 0 1 2.4-1.7z"/>',
  },
  mill: {
    block: '#3f6a91',
    charge:
      '<path fill-rule="evenodd" d="M12 1.5a10.5 10.5 0 1 1 0 21 10.5 10.5 0 0 1 0-21zm0 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z"/><path d="M11 3h2v18h-2zM3 11h18v2H3z"/><path d="m5.6 7 1.4-1.4L18.4 17 17 18.4zM17 5.6 18.4 7 7 18.4 5.6 17z"/><circle cx="12" cy="12" r="2.6"/>',
  },
  nettle: {
    block: '#47752b',
    charge:
      '<path d="m12 1.5 2 3 2.2-1.2.2 3.2 3.1.6-1.8 2.3 2.8 2-3.1 1.2 1.1 3-3.2-.6-.8 3.1-1.8-2V22h-1.6v-6.9l-1.8 2-.8-3.1-3.2.6 1.1-3-3.1-1.2 2.8-2-1.8-2.3 3.1-.6.2-3.2L10 4.5z"/>',
  },
  puddle: {
    block: '#4f6b74',
    charge:
      '<path d="M8 4a2.6 2.6 0 0 1 3 1.6h2A2.6 2.6 0 1 1 16.8 9c2 1 3.2 3 3.2 5l2 2-1 2-3-1.8C17 18.3 15 19.5 12 19.5S7 18.3 6 16.2L3 18l-1-2 2-2c0-2 1.2-4 3.2-5A2.6 2.6 0 0 1 8 4z"/>',
  },
  sheep: {
    block: '#6b6555',
    charge:
      '<path d="M8 7.5a3 3 0 0 1 4.5-1 3 3 0 0 1 5 1.3 3 3 0 0 1 2 5 3 3 0 0 1-3 4.2H8.5a3 3 0 0 1-2.8-4 3 3 0 0 1 2.3-5.5z"/><path d="M8.5 16h2v5.5h-2zM14 16h2v5.5h-2z"/><ellipse cx="4.3" cy="10.5" rx="2.7" ry="2.2"/>',
  },
  turnip: {
    block: '#8a4290',
    charge:
      '<path d="M12 9c5 0 7.2 3.2 7.2 6.2S16.5 20.3 13.2 20.5L12 23l-1.2-2.5C7.5 20.3 4.8 18.2 4.8 15.2S7 9 12 9z"/><path d="M11 9.5 8 2l3.2 2.2L12 1l.8 3.2L16 2l-3 7.5z"/>',
  },
  wattle: {
    block: '#7c5530',
    charge:
      '<path d="M4 2.5h2.2V22H4zM10.9 2.5h2.2V22h-2.2zM17.8 2.5H20V22h-2.2z"/><path d="M2 7c4-2 8 2 10 0s6-2 10 0v3c-4-2-8 2-10 0s-6-2-10 0zM2 14c4-2 8 2 10 0s6-2 10 0v3c-4-2-8 2-10 0s-6-2-10 0z"/>',
  },
};
