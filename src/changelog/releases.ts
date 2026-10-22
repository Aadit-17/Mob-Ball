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
    version: '0.4',
    date: '2026-10-22',
    title: 'The Manager',
    summary:
      'Run a house for a whole season: draft your knights, pick the side, set tactics and win the league.',
    changes: [
      {
        kind: 'new',
        text: 'Manager mode: take any of the eight houses through a fourteen-matchday league, home and away. Draws count, and the table is settled on goal difference, goals scored, then head-to-head.',
      },
      {
        kind: 'new',
        text: 'The draft: pick six knights from a pool of eighty on a 26-point budget against seven rival houses, each with its own style. Your forged knight is in the pool, and any house can sign him.',
      },
      {
        kind: 'new',
        text: 'Watch your matches at 1×, 2× or 4×, or skip straight to the result: it is the same match either way. Pause to open the dugout and change tactics, swap positions or make your one substitution.',
      },
      {
        kind: 'new',
        text: 'Tactics that really change how your knights play: how hard they press and when they shoot, plus Charge! and Hold! for the closing minutes.',
      },
      {
        kind: 'new',
        text: 'Stamina: a knight can start about ten matches of fourteen at full strength. Rest the tired ones, and drag knights between the side and the bench to set your team.',
      },
      {
        kind: 'new',
        text: 'Top scorers, a Golden Boot, and a league title on your shield for the champions of the realm.',
      },
      {
        kind: 'improved',
        text: 'Rival houses rotate their squads, keep their best knights out of goal, and use their bench and tactics when a match turns.',
      },
    ],
  },
  {
    version: '0.3',
    date: '2026-10-16',
    title: 'The Realm Cup',
    summary: 'Eight houses, one knockout and a trophy for whoever survives it.',
    changes: [
      {
        kind: 'new',
        text: 'The Realm Cup: an eight-house knockout. Win a quarter-final, a semi-final and the final to lift the cup. Rivals start a level below the one you pick and finish a level above it.',
      },
      {
        kind: 'new',
        text: 'Four new houses join the realm: Mudford, Hollowmere, Oxbridge and Saltcliff. Every house fields the same knights in every cup, so you get to know your rivals.',
      },
      {
        kind: 'new',
        text: 'The other ties play out across the realm while you watch the bracket, and your cup is saved so you can leave and pick it up later.',
      },
      {
        kind: 'new',
        text: 'Win the cup to earn a trophy on your shield and the title of Realm Cup champion.',
      },
      {
        kind: 'improved',
        text: 'Links to MOB BALL now show a proper preview with art and a description when shared, plus a new shield icon for your browser tab.',
      },
    ],
  },
  {
    version: '0.2',
    date: '2026-10-10',
    title: 'Torches lit',
    summary: 'A new look for the whole realm, and bots that finally earn their keep off the ball.',
    changes: [
      {
        kind: 'new',
        text: 'The great hall: every screen restyled with dark stone, flickering torches, swaying house banners and gold heraldry.',
      },
      {
        kind: 'new',
        text: 'The castle gates swing shut on your house crest when a match kicks off. Press any key to skip.',
      },
      {
        kind: 'improved',
        text: 'Bots press the ball, cover passing lanes and keep moving off the ball instead of standing still. Better knights press smarter.',
      },
      {
        kind: 'improved',
        text: 'A clearer scoreboard and match screen, easier to read at a glance.',
      },
    ],
  },
  {
    version: '0.1',
    date: '2026-10-06',
    title: 'Hear the mob',
    summary: 'The game finds its voice, and the goals get wider.',
    changes: [
      {
        kind: 'new',
        text: 'Sound: kicks that thump (harder for power shots), barge BONKs, whistles for kick-off and full time, and a crowd that roars for every goal.',
      },
      {
        kind: 'new',
        text: 'A mute button in matches and on the home screen, remembered between visits. Press M to toggle mid-match.',
      },
      { kind: 'new', text: 'A pause button in matches, with continue, restart and quit to home.' },
      {
        kind: 'improved',
        text: 'Wider goals and keepers who stand a little deeper, so attacks end in more goals.',
      },
    ],
  },
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

/** What's coming next, at the foot of the Chronicle. Update it with every release (a test checks it). */
export const HORIZON: readonly { readonly name: string; readonly text: string }[] = [
  { name: 'My Career', text: 'Take your knight from village team to royal squad.' },
  { name: 'Match ratings', text: 'Every knight rated after every match, with a man of the match.' },
  { name: 'Play on your phone', text: 'Touch controls: a stick to run, buttons to kick and barge.' },
];
