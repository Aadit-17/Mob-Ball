import { BUILDS } from '../game/constants';

export interface HelmetDef {
  readonly name: string;
  /** Whether the face shows: fully, not at all, or through a T-shaped slot. */
  readonly face: boolean | 'T';
  readonly showsHair: boolean;
  /** Y offset of the helmet's crown, where toppers attach. */
  readonly top: number;
}

export interface MetalDef {
  readonly name: string;
  readonly light: string;
  readonly dark: string;
}

export const HELMETS: readonly HelmetDef[] = [
  { name: 'Great helm', face: false, showsHair: false, top: -17 },
  { name: 'Bascinet', face: false, showsHair: false, top: -24 },
  { name: 'Barbute', face: 'T', showsHair: false, top: -17 },
  { name: 'Kettle hat', face: true, showsHair: false, top: -21 },
  { name: 'Horned helm', face: true, showsHair: false, top: -18 },
  { name: 'Mail coif', face: true, showsHair: false, top: -18 },
  { name: 'Crown', face: true, showsHair: true, top: -25 },
  { name: 'Hood', face: true, showsHair: false, top: -18 },
  { name: 'Wizard hat', face: true, showsHair: false, top: -44 },
  { name: 'Bare head', face: true, showsHair: true, top: -17 },
];

export const METALS: readonly MetalDef[] = [
  { name: 'Steel', light: '#d6dde8', dark: '#aeb8c8' },
  { name: 'Blackened', light: '#6a6780', dark: '#4a4760' },
  { name: 'Gilded', light: '#f2cf5b', dark: '#c9a23a' },
  { name: 'Bronze', light: '#d69a62', dark: '#aa733f' },
  { name: 'Rusty', light: '#bf8a6a', dark: '#8e5f47' },
];

export const TOPPERS = ['None', 'Plume', 'Crest', 'Feathers', 'Pennant', 'Antlers'] as const;
export const SKIN = ['#f8d5b8', '#f1c29a', '#d9a071', '#b87a4b', '#8d5a3b', '#5e3b26', '#9fd08a'] as const;
export const EYES = ['Round', 'Happy', 'Fierce', 'Sleepy', 'Wide'] as const;
export const MARKS = ['None', 'Scar', 'Freckles', 'Woad paint', 'Eyepatch', 'Rosy cheeks'] as const;
export const BEARDS = ['None', 'Stubble', 'Full', 'Moustache', 'Braided', 'Goatee'] as const;
export const HAIRSTYLES = ['Short', 'Long', 'Bun', 'Mohawk', 'Bald'] as const;
export const HAIR = ['#2b2118', '#6b4226', '#c46a2b', '#e8c46a', '#d9d4cc', '#7a4fb0', '#e05a8a'] as const;
export const TORSOS = ['Tabard', 'Breastplate', 'Chainmail', 'Leather jerkin', 'Brigandine', 'Robe'] as const;
export const PATTERNS = ['Plain', 'Halves', 'Stripes', 'Quarters', 'Chevron', 'Cross', 'Checks'] as const;
export const ACCENTS = [
  '#ffffff',
  '#ffc93c',
  '#2a1e3b',
  '#e05a8a',
  '#5fd0c8',
  '#9b6bd6',
  '#f28c38',
  '#8fd14f',
] as const;
export const EMBLEMS = ['None', 'Sun', 'Star', 'Tower', 'Rose', 'Skull', 'Fish', 'Crown'] as const;
export const ARMS = ['Pauldrons', 'Spiked pauldrons', 'Mail sleeves', 'Bare arms', 'Puffy sleeves'] as const;
export const LEGS = ['Plate greaves', 'Mail chausses', 'Hose', 'Striped hose', 'Kilt'] as const;
export const BOOTS = ['Sabatons', 'Leather boots', 'Pointy shoes', 'Fur boots', 'Sandals'] as const;
export const BACKS = ['None', 'Cape', 'Fur mantle', 'Scarf', 'Cape + mantle'] as const;
export const HELD = [
  'None',
  'Buckler',
  'Kite shield',
  'Banner',
  'Lute',
  'Torch',
  'Goblet',
  'Chicken',
] as const;

export type ForgeTab = 'helmet' | 'face' | 'armour' | 'limbs' | 'extras';

export interface SlotDef {
  readonly key: SlotKey;
  readonly label: string;
  readonly tab: ForgeTab;
  /** Option names, or colours when `swatch` is set. */
  readonly options: readonly string[];
  readonly swatch?: true;
}

export type SlotKey =
  | 'helmet'
  | 'topper'
  | 'metal'
  | 'skin'
  | 'eyes'
  | 'marks'
  | 'beard'
  | 'hairstyle'
  | 'hair'
  | 'torso'
  | 'pattern'
  | 'accent'
  | 'emblem'
  | 'arms'
  | 'legs'
  | 'boots'
  | 'back'
  | 'held'
  | 'build';

export const SLOTS: readonly SlotDef[] = [
  { key: 'helmet', label: 'Helmet', tab: 'helmet', options: HELMETS.map((h) => h.name) },
  { key: 'topper', label: 'Topper', tab: 'helmet', options: TOPPERS },
  { key: 'metal', label: 'Metal finish', tab: 'helmet', options: METALS.map((m) => m.name) },
  { key: 'skin', label: 'Skin', tab: 'face', options: SKIN, swatch: true },
  { key: 'eyes', label: 'Eyes', tab: 'face', options: EYES },
  { key: 'marks', label: 'Marks', tab: 'face', options: MARKS },
  { key: 'beard', label: 'Beard', tab: 'face', options: BEARDS },
  { key: 'hairstyle', label: 'Hairstyle', tab: 'face', options: HAIRSTYLES },
  { key: 'hair', label: 'Hair colour', tab: 'face', options: HAIR, swatch: true },
  { key: 'torso', label: 'Body armour', tab: 'armour', options: TORSOS },
  { key: 'pattern', label: 'Cloth pattern', tab: 'armour', options: PATTERNS },
  { key: 'accent', label: 'Accent colour', tab: 'armour', options: ACCENTS, swatch: true },
  { key: 'emblem', label: 'Emblem', tab: 'armour', options: EMBLEMS },
  { key: 'arms', label: 'Arms', tab: 'limbs', options: ARMS },
  { key: 'legs', label: 'Legs', tab: 'limbs', options: LEGS },
  { key: 'boots', label: 'Boots', tab: 'limbs', options: BOOTS },
  { key: 'back', label: 'Back', tab: 'extras', options: BACKS },
  { key: 'held', label: 'In hand', tab: 'extras', options: HELD },
  { key: 'build', label: 'Build', tab: 'extras', options: BUILDS.map((b) => b.name) },
];

export const FORGE_TABS: readonly { readonly id: ForgeTab; readonly label: string }[] = [
  { id: 'helmet', label: '🪖 Helmet' },
  { id: 'face', label: '🙂 Face' },
  { id: 'armour', label: '🛡️ Armour' },
  { id: 'limbs', label: '🦵 Arms & legs' },
  { id: 'extras', label: '🎒 Extras' },
];

export const KNIGHT_NAMES = [
  'Ser Pellam',
  'Bors the Big',
  'Lady Maud',
  'Ser Wat',
  'Old Hobb',
  'Gunnhild',
  'Aelfric',
  'Brother Tuck',
  'Ser Osric',
  'Ysolde',
  'Ser Gawen',
  'Mab the Quick',
  'Ser Tobin',
  'Hild',
  'Ser Crumb',
  'Wulfric',
  'Ser Jory',
  'Agnes Ironfoot',
  'Ser Pip',
  'Big Edda',
  'Merek',
  'Lady Rowena',
] as const;

/** Looks up a catalogue entry, falling back to the first one for an out-of-range index. */
export function option<T>(list: readonly T[], index: number): T {
  const value = list[index] ?? list[0];
  if (value === undefined) throw new Error('Empty catalogue list');
  return value;
}
