import type { AppContext } from '../app';
import type { GameMode, MatchSession } from './mode';

/** One-off matches against a randomly rolled rival squad, set up on the match setup screen. */
export const exhibition: GameMode = {
  id: 'exhibition',
  name: 'Exhibition',
  blurb: 'A one-off match. Pick your house and set the level of every knight on the pitch.',
  available: true,
  start(app) {
    app.go('setup');
  },
};

export function exhibitionSession(app: AppContext): MatchSession {
  return {
    home: app.squads.home,
    away: app.squads.away,
    homeHouse: app.house,
    awayHouse: app.rival,
    quitTo: 'setup',
    resultActions: () => [
      {
        label: 'Rematch (new rivals)',
        primary: true,
        run: () => {
          app.rerollSquads();
          app.playMatch(exhibitionSession(app));
        },
      },
      {
        label: 'Change teams',
        run: () => {
          app.go('setup');
        },
      },
      {
        label: 'Forge',
        run: () => {
          app.go('forge');
        },
      },
    ],
  };
}
