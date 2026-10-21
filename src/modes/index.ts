import { career } from './career';
import { cup } from './cup';
import { exhibition } from './exhibition';
import { manager } from './manager';
import type { GameMode } from './mode';

/** Every mode shown on the home screen, in order. New modes plug in here. */
export const MODES: readonly GameMode[] = [exhibition, cup, career, manager];
