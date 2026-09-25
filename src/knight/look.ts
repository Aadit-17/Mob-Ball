import type { Rng } from '../game/rng';
import { SLOTS, type SlotKey } from './catalog';

export type Look = Record<SlotKey, number> & { name: string };

export const NAME_MAX_LENGTH = 14;

export const DEFAULT_LOOK: Look = {
  name: 'Sir Rookie',
  helmet: 3,
  topper: 1,
  metal: 0,
  skin: 1,
  eyes: 0,
  marks: 0,
  beard: 3,
  hairstyle: 0,
  hair: 2,
  torso: 0,
  pattern: 1,
  accent: 1,
  emblem: 1,
  arms: 0,
  legs: 0,
  boots: 1,
  back: 1,
  held: 1,
  build: 1,
};

/** The green skin tone is a fun outlier, so random knights only get it sometimes. */
const RARE_SKIN = 6;

export function randomLook(rng: Rng, name: string, helmet?: number): Look {
  const look: Look = { ...DEFAULT_LOOK, name };
  for (const slot of SLOTS) look[slot.key] = rng.int(slot.options.length);
  if (helmet !== undefined) look.helmet = helmet;
  if (look.skin === RARE_SKIN && rng.next() < 0.6) look.skin = rng.int(RARE_SKIN);
  return look;
}

export function sanitizeName(name: string): string {
  return name.trim().slice(0, NAME_MAX_LENGTH) || DEFAULT_LOOK.name;
}

/** Repairs anything read from storage or a share code: unknown slots fall back to the default. */
export function normalizeLook(raw: unknown): Look {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const look: Look = { ...DEFAULT_LOOK };
  for (const slot of SLOTS) {
    const value = source[slot.key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < slot.options.length) {
      look[slot.key] = value;
    }
  }
  look.name = typeof source.name === 'string' ? sanitizeName(source.name) : DEFAULT_LOOK.name;
  return look;
}

const CODE_PREFIX = 'MB1';

/** Packs a knight into a short, pasteable string: `MB1-<one base-36 digit per slot>-<name>`. */
export function encodeLook(look: Look): string {
  const digits = SLOTS.map((slot) => look[slot.key].toString(36)).join('');
  return `${CODE_PREFIX}-${digits}-${encodeURIComponent(look.name)}`;
}

export function decodeLook(code: string): Look | null {
  const match = /^MB1-([0-9a-z]+)-(.*)$/i.exec(code.trim());
  const digits = match?.[1]?.toLowerCase() ?? '';
  if (!match || digits.length !== SLOTS.length) return null;
  const raw: Record<string, unknown> = {};
  SLOTS.forEach((slot, i) => (raw[slot.key] = parseInt(digits.charAt(i), 36)));
  try {
    raw.name = decodeURIComponent(match[2] ?? '');
  } catch {
    return null;
  }
  const look = normalizeLook(raw);
  return SLOTS.every((slot) => look[slot.key] === raw[slot.key]) ? look : null;
}

export const totalCombinations = (): number => SLOTS.reduce((n, slot) => n * slot.options.length, 1);
