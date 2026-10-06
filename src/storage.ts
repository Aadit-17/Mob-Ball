import { TOP_TIER } from './ai/skills';
import { normalizeLook, type Look } from './knight/look';

const LOOK_KEY = 'mobball.look.v2';
const SETTINGS_KEY = 'mobball.settings.v1';
const MUTED_KEY = 'mobball.muted.v1';

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
