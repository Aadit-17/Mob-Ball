import { DIFFICULTIES, TOP_TIER } from './ai/skills';
import { normalizeLook, type Look } from './knight/look';
import type { CareerState } from './modes/career/career';
import { CAREER_STORAGE_KEY, normalizeCareer } from './modes/career/save';
import { normalizeCup, type CupState } from './modes/cup/bracket';
import { normalizeSeason, type SeasonState } from './modes/manager/season';
import { REALM_HOUSES } from './setup/houses';

const LOOK_KEY = 'mobball.look.v2';
const SETTINGS_KEY = 'mobball.settings.v1';
const MUTED_KEY = 'mobball.muted.v1';
const CUP_KEY = 'mobball.cup.v1';
const HONOURS_KEY = 'mobball.honours.v1';
/** v2: the draft pool and budget changed, so a v1 season can't be replayed. v3: every fixture keeps its
 * ratings, which a v2 season never recorded and can't rebuild (watched matches aren't replayable). */
const SEASON_KEY = 'mobball.season.v3';

export interface Preferences {
  houseId: string;
  difficultyId: string;
  teamSize: 3 | 4;
  /** Skill tier for all of the player's bot teammates. */
  teammateTier: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  houseId: 'ember',
  difficultyId: 'knight',
  teamSize: 4,
  teammateTier: TOP_TIER,
};

/** Browser storage can be missing or throw (private windows, blocked cookies); the game works without it. */
function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not persisting is acceptable; the in-memory copy still works for this session.
  }
}

export const loadLook = (): Look => normalizeLook(read(LOOK_KEY));
export const saveLook = (look: Look): void => {
  write(LOOK_KEY, look);
};

const isTier = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= TOP_TIER;

export function loadPreferences(): Preferences {
  const raw = read(SETTINGS_KEY);
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    houseId: typeof source.houseId === 'string' ? source.houseId : DEFAULT_PREFERENCES.houseId,
    difficultyId:
      typeof source.difficultyId === 'string' ? source.difficultyId : DEFAULT_PREFERENCES.difficultyId,
    teamSize: source.teamSize === 3 ? 3 : 4,
    teammateTier: isTier(source.teammateTier) ? source.teammateTier : DEFAULT_PREFERENCES.teammateTier,
  };
}

export const savePreferences = (prefs: Preferences): void => {
  write(SETTINGS_KEY, prefs);
};

export const loadMuted = (): boolean => read(MUTED_KEY) === true;
export const saveMuted = (muted: boolean): void => {
  write(MUTED_KEY, muted);
};

/** The Realm Cup run in progress or just finished, if any. */
export const loadCup = (): CupState | null =>
  normalizeCup(
    read(CUP_KEY),
    REALM_HOUSES.map((h) => h.id),
    DIFFICULTIES.map((d) => d.id),
  );
export const saveCup = (cup: CupState | null): void => {
  write(CUP_KEY, cup);
};

export interface Honours {
  cupWins: number;
  leagueWins: number;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export function loadHonours(): Honours {
  const raw = read(HONOURS_KEY);
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    cupWins: isCount(source.cupWins) ? source.cupWins : 0,
    leagueWins: isCount(source.leagueWins) ? source.leagueWins : 0,
  };
}

export const saveHonours = (honours: Honours): void => {
  write(HONOURS_KEY, honours);
};

/** The Manager mode season in progress or just finished, if any. */
export const loadSeason = (): SeasonState | null => normalizeSeason(read(SEASON_KEY));
export const saveSeason = (season: SeasonState | null): void => {
  write(SEASON_KEY, season);
};

/** The career in progress, if any; one at a time, for as long as the player keeps it. */
export const loadCareer = (): CareerState | null => normalizeCareer(read(CAREER_STORAGE_KEY));
export const saveCareer = (career: CareerState | null): void => {
  write(CAREER_STORAGE_KEY, career);
};
