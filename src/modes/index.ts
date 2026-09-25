import { exhibition } from './exhibition';
import type { GameMode } from './mode';

const comingSoon = (id: string, name: string, blurb: string): GameMode => ({
  id,
  name,
  blurb,
  available: false,
  start: () => undefined,
});

/** Every mode shown on the home screen, in order. New modes plug in here. */
export const MODES: readonly GameMode[] = [
  exhibition,
  comingSoon('cup', 'Realm Cup', 'A knockout tournament against the great houses.'),
  comingSoon('career', 'My Career', 'Take your knight from village team to royal squad.'),
  comingSoon('manager', 'Manager', 'Run a house: draft knights, set line-ups, win the league.'),
];
