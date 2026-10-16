import type { Tactics } from '../../ai/tactics';
import type { Look } from '../../knight/look';

/** A knight in the draft pool or a house's squad. Build comes from `look.build`. */
export interface SquadKnight {
  /** Stable for the whole season, e.g. "roster:ember:gk", "gen:17" or "forged". */
  readonly id: string;
  readonly look: Look;
  /** Skill tier, 0 (Peasant) to 4 (Legend). */
  readonly tier: number;
  /** The player's own forged knight, whichever house drafts them. */
  readonly forged: boolean;
}

/** How a house's AI manager drafts, picks line-ups and sets tactics. */
export interface HouseStyle {
  /** stars: spends big on one or two top knights. balanced: even spread. depth: many mid-level knights. */
  readonly draft: 'stars' | 'balanced' | 'depth';
  /** The tactics the house starts every match with. */
  readonly tactics: Tactics;
}

export const HOUSE_STYLES: Readonly<Record<string, HouseStyle>> = {
  ember: { draft: 'stars', tactics: { press: 'high', line: 'high', shooting: 'early' } },
  corvane: { draft: 'balanced', tactics: { press: 'mid', line: 'deep', shooting: 'patient' } },
  thorn: { draft: 'depth', tactics: { press: 'mid', line: 'normal', shooting: 'normal' } },
  grey: { draft: 'balanced', tactics: { press: 'low', line: 'deep', shooting: 'normal' } },
  mud: { draft: 'depth', tactics: { press: 'high', line: 'normal', shooting: 'early' } },
  hollow: { draft: 'stars', tactics: { press: 'mid', line: 'normal', shooting: 'patient' } },
  ox: { draft: 'balanced', tactics: { press: 'high', line: 'high', shooting: 'normal' } },
  salt: { draft: 'depth', tactics: { press: 'low', line: 'normal', shooting: 'patient' } },
};

export const SQUAD_SIZE = 6;
export const STARTERS = 4;
