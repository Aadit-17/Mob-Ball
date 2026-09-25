/**
 * Every release, newest first. Adding a version means adding one entry here; the changelog page and
 * the home screen's version badge both read from this list.
 */
export type ChangeKind = 'new' | 'improved' | 'fixed';

export interface Change {
  readonly kind: ChangeKind;
  readonly text: string;
}

export interface Release {
  /** Shown as "v" + version. */
  readonly version: string;
  /** ISO date, YYYY-MM-DD. */
  readonly date: string;
  readonly title: string;
  readonly summary: string;
  readonly changes: readonly Change[];
}

export const RELEASES: readonly Release[] = [
  {
    version: '0',
    date: '2026-09-26',
    title: 'The gates open',
    summary:
      'The first public version of MOB BALL: medieval football in the style of HaxBall, with a knight forge and bots that actually think.',
    changes: [
      {
        kind: 'new',
        text: 'The knight forge: 19 slots of helmets, faces, armour, arms, legs, boots, capes and things to hold, over 500 trillion possible knights. Share yours with a knight code.',
      },
      {
        kind: 'new',
        text: 'Exhibition matches, 4v4 or 3v3, on a full pitch with a following camera and a minimap.',
      },
      {
        kind: 'new',
        text: 'Choose every knight’s level: set all your teammates at once, pick a rival level, or tune any single knight on their card.',
      },
      {
        kind: 'new',
        text: 'HaxBall-style physics: hold to kick on contact, play the ball off the walls, and the shoulder barge. BONK.',
      },
      {
        kind: 'new',
        text: 'Five bot levels from Peasant to Legend. Better bots pass into space, make forward runs, open shooting lanes, bank passes off the wall, and Legends pull off the wall lift.',
      },
      {
        kind: 'new',
        text: 'Attacking tools: harder shots close to goal, a bonus for first-time kicks, and gentle aim assist toward the side the keeper isn’t covering.',
      },
      {
        kind: 'new',
        text: 'Four great houses, a crowd that leaps for every goal, slow motion as the ball hits the net, and confetti.',
      },
    ],
  },
];

export const LATEST = RELEASES[0];
