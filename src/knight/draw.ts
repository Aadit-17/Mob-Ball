import { circle, ellipse, fillInk, INK, roundRect, shade, type Ctx } from '../render/paint';
import {
  ACCENTS,
  ARMS,
  BACKS,
  BEARDS,
  BOOTS,
  EMBLEMS,
  EYES,
  HAIR,
  HAIRSTYLES,
  HELD,
  HELMETS,
  LEGS,
  MARKS,
  METALS,
  option,
  PATTERNS,
  SKIN,
  TOPPERS,
  TORSOS,
  type HelmetDef,
  type MetalDef,
} from './catalog';
import type { Look } from './look';

/**
 * Everything is drawn front-on around the feet at (0, 0), about 65 units tall, and is
 * mirrored as a whole when the knight faces left. Callers scale and translate.
 */
export interface Pose {
  facing: 1 | -1;
  /** Unit vector from the head toward what the knight is looking at. */
  lookX: number;
  lookY: number;
  /** Running animation phase; 0 when standing. */
  run: number;
  stunned: boolean;
  barging: boolean;
  /** Seconds, for idle animation. */
  time: number;
}

/** How far each topper rises above the helmet's crown. */
const TOPPER_HEIGHT: Readonly<Record<string, number>> = {
  None: 0,
  Plume: 18,
  Crest: 9,
  Feathers: 19,
  Pennant: 25,
  Antlers: 21,
};

/** Height from the feet to the highest point of this knight, in sprite units. */
export function spriteHeight(look: Look): number {
  const helmet = option(HELMETS, look.helmet);
  const held = option(HELD, look.held) === 'Banner' ? 52 : 0;
  return Math.max(48 - helmet.top + (TOPPER_HEIGHT[option(TOPPERS, look.topper)] ?? 0), held) + 4;
}

export const STANDING: Pose = {
  facing: 1,
  lookX: 0,
  lookY: 0.3,
  run: 0,
  stunned: false,
  barging: false,
  time: 0,
};

const MAIL = '#a3a9b6';
const LEATHER = '#6b4226';
const LEATHER_LIGHT = '#8a5a30';
const FUR = '#efe3cf';
const GOLD = '#ffd84a';

interface Palette {
  team: string;
  accent: string;
  skin: string;
  hair: string;
  metal: MetalDef;
}

export function drawKnight(c: Ctx, look: Look, teamColour: string, pose: Pose): void {
  const p: Palette = {
    team: teamColour,
    accent: option(ACCENTS, look.accent),
    skin: option(SKIN, look.skin),
    hair: option(HAIR, look.hair),
    metal: option(METALS, look.metal),
  };
  const helmet = option(HELMETS, look.helmet);
  const swing = pose.run ? Math.sin(pose.run) * 2.5 : 0;
  const bob = pose.run ? -Math.abs(Math.sin(pose.run)) * 2 : Math.sin(pose.time * 3) * 0.6;
  const lean = (): void => {
    c.translate(0, bob);
    if (pose.barging) c.rotate(0.28);
    if (pose.stunned) c.rotate(Math.sin(pose.time * 18) * 0.12);
  };

  c.save();
  c.lineJoin = 'round';
  c.lineCap = 'round';
  if (pose.facing < 0) c.scale(-1, 1);

  c.save();
  lean();
  drawCape(c, look, p);
  c.restore();

  drawLegs(c, look, p, swing);
  lean();
  if (helmet.showsHair && option(HAIRSTYLES, look.hairstyle) === 'Long') {
    roundRect(c, -17, -60, 34, 34, 13);
    fillInk(c, p.hair, 2);
  }
  drawTorso(c, look, p);
  drawNeckwear(c, look, p);
  drawArms(c, look, p);
  drawHeld(c, look, p, pose.time);

  c.translate(0, -48);
  // Mirror the gaze back so eyes keep looking the right way when the sprite is flipped.
  const gazeX = pose.lookX * pose.facing * 1.8;
  const gazeY = pose.lookY * 1.5;
  drawHead(c, look, helmet, p, gazeX, gazeY, pose.stunned);
  drawTopper(c, look, helmet, p);
  c.restore();
}

// ---------------------------------------------------------------- body

function drawLegs(c: Ctx, look: Look, p: Palette, swing: number): void {
  const legs = option(LEGS, look.legs);
  const boots = option(BOOTS, look.boots);
  for (const side of [-1, 1] as const) {
    const x = side < 0 ? -9 : 2;
    const dy = side < 0 ? swing : -swing;
    roundRect(c, x, -13 + dy, 7, 10, 3);
    switch (legs) {
      case 'Plate greaves':
        fillInk(c, p.metal.light);
        circle(c, x + 3.5, -10 + dy, 2.4);
        fillInk(c, p.metal.dark, 1.4);
        break;
      case 'Mail chausses':
        fillInk(c, MAIL);
        c.save();
        roundRect(c, x, -13 + dy, 7, 10, 3);
        c.clip();
        mailTexture(c, x, -13 + dy, 7, 10);
        c.restore();
        break;
      case 'Hose':
        fillInk(c, p.accent);
        break;
      case 'Striped hose':
        c.fillStyle = p.accent;
        c.fill();
        c.save();
        c.clip();
        c.fillStyle = p.accent === ACCENTS[0] ? p.team : '#fff';
        for (let y = -12; y < -3; y += 3.4) c.fillRect(x, y + dy, 7, 1.7);
        c.restore();
        roundRect(c, x, -13 + dy, 7, 10, 3);
        c.lineWidth = 2.2;
        c.strokeStyle = INK;
        c.stroke();
        break;
      default:
        fillInk(c, p.skin);
    }
    drawBoot(c, boots, x, -4 + dy, side, p);
  }
  if (legs === 'Kilt') {
    c.beginPath();
    c.moveTo(-13, -15);
    c.lineTo(13, -15);
    c.lineTo(15, -6);
    c.lineTo(-15, -6);
    c.closePath();
    fillInk(c, p.team);
    c.strokeStyle = p.accent;
    c.lineWidth = 1.3;
    for (let x = -10; x <= 10; x += 5) {
      c.beginPath();
      c.moveTo(x, -14);
      c.lineTo(x * 1.12, -7);
      c.stroke();
    }
  }
}

function drawBoot(c: Ctx, boot: string, x: number, y: number, side: -1 | 1, p: Palette): void {
  switch (boot) {
    case 'Sabatons':
      roundRect(c, x - 1, y, 9, 5, 2.5);
      fillInk(c, p.metal.light);
      c.strokeStyle = p.metal.dark;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x + 0.5, y + 2.5);
      c.lineTo(x + 7, y + 2.5);
      c.stroke();
      break;
    case 'Leather boots':
      roundRect(c, x - 1, y - 2, 9, 7, 2.5);
      fillInk(c, LEATHER);
      c.fillStyle = LEATHER_LIGHT;
      c.fillRect(x - 0.5, y - 1.5, 8, 1.6);
      break;
    case 'Pointy shoes':
      c.beginPath();
      c.moveTo(x - 1, y + 5);
      c.lineTo(x - 1, y + 1);
      c.quadraticCurveTo(x + 3.5, y - 1, x + 8, y + 1);
      c.quadraticCurveTo(x + 3.5 + side * 9, y + 4, x + 3.5 + side * 11, y - 2);
      c.quadraticCurveTo(x + 3.5 + side * 10, y + 6, x + 3.5, y + 5);
      c.closePath();
      fillInk(c, p.accent === ACCENTS[2] ? LEATHER : p.accent, 1.8);
      break;
    case 'Fur boots':
      roundRect(c, x - 2, y - 3, 11, 8, 4);
      fillInk(c, FUR);
      c.fillStyle = '#d8c7a8';
      for (let i = 0; i < 3; i++) {
        circle(c, x - 0.5 + i * 4, y - 3, 1.8);
        c.fill();
      }
      break;
    default: {
      roundRect(c, x - 1, y + 1, 9, 4, 2);
      fillInk(c, p.skin, 1.8);
      c.strokeStyle = LEATHER;
      c.lineWidth = 1.3;
      c.beginPath();
      c.moveTo(x, y + 2);
      c.lineTo(x + 7, y + 4);
      c.moveTo(x + 7, y + 2);
      c.lineTo(x, y + 4);
      c.stroke();
    }
  }
}

function drawCape(c: Ctx, look: Look, p: Palette): void {
  const back = option(BACKS, look.back);
  if (back !== 'Cape' && back !== 'Cape + mantle') return;
  c.beginPath();
  c.moveTo(-13, -33);
  c.quadraticCurveTo(-22, -18, -22, -3);
  c.quadraticCurveTo(0, 1, 22, -3);
  c.quadraticCurveTo(22, -18, 13, -33);
  c.closePath();
  fillInk(c, shade(p.team, -0.25));
  c.strokeStyle = p.accent;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-21, -5);
  c.quadraticCurveTo(0, -1, 21, -5);
  c.stroke();
}

function drawNeckwear(c: Ctx, look: Look, p: Palette): void {
  const back = option(BACKS, look.back);
  if (back === 'Fur mantle' || back === 'Cape + mantle') {
    for (let x = -14; x <= 14; x += 5.6) {
      circle(c, x, -33 + Math.abs(x) * 0.08, 4.2);
      fillInk(c, FUR, 1.6);
    }
  } else if (back === 'Scarf') {
    roundRect(c, -11, -37, 22, 6, 3);
    fillInk(c, p.accent, 1.8);
    roundRect(c, 5, -34, 5, 13, 2.5);
    fillInk(c, p.accent, 1.8);
    c.fillStyle = shade(p.accent, -0.2);
    c.fillRect(5.5, -24, 4, 1.5);
  }
}

function drawTorso(c: Ctx, look: Look, p: Palette): void {
  const torso = option(TORSOS, look.torso);
  const outline = (): void => {
    if (torso === 'Robe') {
      c.beginPath();
      c.moveTo(-12, -33);
      c.lineTo(12, -33);
      c.quadraticCurveTo(16, -20, 17, -3);
      c.lineTo(-17, -3);
      c.quadraticCurveTo(-16, -20, -12, -33);
      c.closePath();
    } else roundRect(c, -14, -33, 28, 25, 10);
  };

  outline();
  c.save();
  if (torso === 'Tabard' || torso === 'Brigandine' || torso === 'Robe') {
    c.fillStyle = p.team;
    c.fill();
    c.clip();
    clothPattern(c, look.pattern, p.accent, -17, -34, 34, 31);
    if (torso === 'Brigandine') {
      c.fillStyle = p.metal.light;
      for (let y = -29; y < -10; y += 5) {
        for (let x = -11; x <= 11; x += 5.5) {
          circle(c, x, y, 1.3);
          c.fill();
        }
      }
    }
  } else if (torso === 'Breastplate') {
    c.fillStyle = p.metal.light;
    c.fill();
    c.clip();
    c.fillStyle = 'rgba(255,255,255,.45)';
    ellipse(c, -6, -26, 4, 7, 0.3);
    c.fill();
    c.beginPath();
    c.moveTo(-16, -33);
    c.lineTo(-9, -33);
    c.lineTo(16, -12);
    c.lineTo(16, -5);
    c.closePath();
    c.fillStyle = p.team;
    c.fill();
    c.strokeStyle = p.accent;
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(-16, -33);
    c.lineTo(16, -5);
    c.moveTo(-9, -33);
    c.lineTo(16, -12);
    c.stroke();
    c.fillStyle = p.metal.dark;
    c.fillRect(-15, -13, 30, 2);
    c.fillRect(-15, -10, 30, 2);
  } else if (torso === 'Chainmail') {
    c.fillStyle = MAIL;
    c.fill();
    c.clip();
    mailTexture(c, -14, -33, 28, 25);
    roundRect(c, -6, -34, 12, 27, 2);
    c.fillStyle = p.team;
    c.fill();
    c.clip();
    clothPattern(c, look.pattern, p.accent, -6, -34, 12, 27);
  } else {
    c.fillStyle = LEATHER_LIGHT;
    c.fill();
    c.clip();
    c.strokeStyle = LEATHER;
    c.lineWidth = 1;
    for (let y = -30; y < -10; y += 4) {
      c.beginPath();
      c.moveTo(-14, y);
      c.lineTo(-10, y + 1);
      c.moveTo(14, y);
      c.lineTo(10, y + 1);
      c.stroke();
    }
    c.strokeStyle = p.accent;
    c.lineWidth = 1.3;
    for (let y = -31; y < -16; y += 4) {
      c.beginPath();
      c.moveTo(-2.5, y);
      c.lineTo(2.5, y + 3);
      c.moveTo(2.5, y);
      c.lineTo(-2.5, y + 3);
      c.stroke();
    }
    c.fillStyle = p.team;
    c.fillRect(-15, -15, 30, 5);
  }
  c.restore();
  outline();
  c.lineWidth = 2.2;
  c.strokeStyle = INK;
  c.stroke();

  if (torso === 'Robe') {
    c.strokeStyle = p.accent;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-14, -17);
    c.lineTo(14, -17);
    c.moveTo(4, -17);
    c.lineTo(6, -8);
    c.stroke();
  } else if (torso !== 'Leather jerkin') {
    c.fillStyle = LEATHER;
    c.fillRect(-13, -14, 26, 2.5);
    c.fillStyle = GOLD;
    c.fillRect(-1.5, -14.5, 3, 3.5);
  }
  drawEmblem(c, option(EMBLEMS, look.emblem), 0, -24, p.team);
}

function drawArms(c: Ctx, look: Look, p: Palette): void {
  const arms = option(ARMS, look.arms);
  for (const side of [-1, 1] as const) {
    const x = side * 16;
    roundRect(c, x - 4, -30, 8, 16, 4);
    if (arms === 'Pauldrons' || arms === 'Spiked pauldrons') {
      fillInk(c, p.metal.dark);
      if (arms === 'Spiked pauldrons') {
        for (const dx of [-4, 0, 4]) {
          c.beginPath();
          c.moveTo(x + dx - 2, -32);
          c.lineTo(x + dx + side * 1.5, -40);
          c.lineTo(x + dx + 2, -32);
          c.closePath();
          fillInk(c, p.metal.light, 1.4);
        }
      }
      ellipse(c, x - side * 0.5, -29, 7.5, 5.5);
      fillInk(c, p.metal.light);
      circle(c, x, -13, 4);
      fillInk(c, p.metal.light);
    } else if (arms === 'Mail sleeves') {
      fillInk(c, MAIL);
      c.save();
      roundRect(c, x - 4, -30, 8, 16, 4);
      c.clip();
      mailTexture(c, x - 4, -30, 8, 16);
      c.restore();
      circle(c, x, -13, 4);
      fillInk(c, LEATHER);
    } else if (arms === 'Bare arms') {
      fillInk(c, p.skin);
      ellipse(c, x + side * 0.5, -25, 3, 2.4);
      c.fillStyle = 'rgba(255,255,255,.3)';
      c.fill();
      roundRect(c, x - 4.5, -20, 9, 4, 2);
      fillInk(c, LEATHER, 1.4);
      circle(c, x, -13, 4);
      fillInk(c, p.skin);
    } else {
      fillInk(c, p.skin);
      circle(c, x, -27, 7);
      fillInk(c, p.accent);
      c.strokeStyle = shade(p.accent, -0.3);
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(x - 3, -32);
      c.lineTo(x - 3, -22);
      c.moveTo(x + 3, -32);
      c.lineTo(x + 3, -22);
      c.stroke();
      circle(c, x, -13, 4);
      fillInk(c, p.skin);
    }
  }
}

function drawHeld(c: Ctx, look: Look, p: Palette, time: number): void {
  switch (option(HELD, look.held)) {
    case 'Buckler':
      circle(c, 21, -16, 7.5);
      fillInk(c, p.metal.light);
      circle(c, 21, -16, 2.6);
      fillInk(c, p.metal.dark, 1.4);
      break;
    case 'Kite shield':
      c.beginPath();
      c.moveTo(14, -28);
      c.lineTo(29, -28);
      c.lineTo(29, -16);
      c.quadraticCurveTo(27, -6, 21.5, -1);
      c.quadraticCurveTo(16, -6, 14, -16);
      c.closePath();
      fillInk(c, p.team);
      c.fillStyle = p.accent;
      c.fillRect(20, -27, 3, 23);
      break;
    case 'Banner': {
      const wave = Math.sin(time * 5) * 1.5;
      stick(c, 18, -8, 18, -50);
      c.beginPath();
      c.moveTo(18, -50);
      c.lineTo(34, -50 + wave);
      c.lineTo(31, -44);
      c.lineTo(34, -38 + wave);
      c.lineTo(18, -38);
      c.closePath();
      fillInk(c, p.team, 1.8);
      circle(c, 24, -44, 2);
      c.fillStyle = p.accent;
      c.fill();
      break;
    }
    case 'Lute':
      stick(c, 20, -14, 10, -34);
      ellipse(c, 22, -10, 6.5, 7.5, -0.4);
      fillInk(c, '#c48648');
      circle(c, 21.5, -11, 2);
      c.fillStyle = INK;
      c.fill();
      break;
    case 'Torch': {
      const flicker = Math.sin(time * 14) * 1.5;
      stick(c, 17, -10, 19, -34);
      c.beginPath();
      c.moveTo(14.5, -35);
      c.quadraticCurveTo(19 + flicker, -50, 19.5, -46);
      c.quadraticCurveTo(25, -40, 23.5, -35);
      c.closePath();
      fillInk(c, '#ff9a3c', 1.6);
      ellipse(c, 19.3, -38, 2.2, 3.2);
      c.fillStyle = '#ffe066';
      c.fill();
      break;
    }
    case 'Goblet':
      c.beginPath();
      c.moveTo(15, -24);
      c.lineTo(25, -24);
      c.quadraticCurveTo(24.5, -16, 20, -15);
      c.quadraticCurveTo(15.5, -16, 15, -24);
      c.closePath();
      fillInk(c, GOLD, 1.8);
      c.fillStyle = GOLD;
      c.fillRect(19, -15, 2, 5);
      roundRect(c, 16.5, -11, 7, 2.2, 1);
      fillInk(c, GOLD, 1.4);
      c.fillStyle = '#b3202a';
      c.fillRect(16, -23.5, 8, 2);
      break;
    case 'Chicken':
      drawChicken(c);
      break;
    default:
  }
}

function drawChicken(c: Ctx): void {
  ellipse(c, 22, -14, 8, 6.5);
  fillInk(c, '#fff');
  circle(c, 28, -21, 4);
  fillInk(c, '#fff');
  c.beginPath();
  c.moveTo(26, -25);
  c.lineTo(27.5, -28);
  c.lineTo(29, -25.5);
  c.lineTo(30.5, -27.5);
  c.lineTo(30.5, -24);
  c.closePath();
  fillInk(c, '#e8453c', 1.2);
  c.beginPath();
  c.moveTo(31.5, -21.5);
  c.lineTo(35, -20.5);
  c.lineTo(31.5, -19.2);
  c.closePath();
  fillInk(c, '#ffb13c', 1.2);
  circle(c, 28.8, -21.8, 0.9);
  c.fillStyle = INK;
  c.fill();
  c.strokeStyle = '#ffb13c';
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(20, -8);
  c.lineTo(19, -4);
  c.moveTo(24, -8);
  c.lineTo(25, -4);
  c.stroke();
  c.beginPath();
  c.moveTo(14.5, -16);
  c.lineTo(11, -19);
  c.lineTo(15, -12);
  c.closePath();
  fillInk(c, '#fff', 1.4);
}

function stick(c: Ctx, x1: number, y1: number, x2: number, y2: number): void {
  c.strokeStyle = LEATHER;
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

function drawEmblem(c: Ctx, emblem: string, x: number, y: number, team: string): void {
  if (emblem === 'None') return;
  circle(c, x, y, 6.5);
  fillInk(c, '#fff8e8', 1.8);
  c.fillStyle = team;
  c.strokeStyle = team;
  c.lineWidth = 1.6;
  switch (emblem) {
    case 'Sun':
      circle(c, x, y, 2.6);
      c.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        c.beginPath();
        c.moveTo(x + Math.cos(a) * 3.6, y + Math.sin(a) * 3.6);
        c.lineTo(x + Math.cos(a) * 5.2, y + Math.sin(a) * 5.2);
        c.stroke();
      }
      break;
    case 'Star':
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 2 : 5;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
      break;
    case 'Tower':
      c.fillRect(x - 3, y - 2, 6, 6);
      for (const dx of [-4, -1, 2]) c.fillRect(x + dx, y - 4, 2, 2);
      break;
    case 'Rose':
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        circle(c, x + Math.cos(a) * 2.4, y + Math.sin(a) * 2.4, 2);
        c.fill();
      }
      c.fillStyle = '#ffc93c';
      circle(c, x, y, 1.4);
      c.fill();
      break;
    case 'Skull':
      circle(c, x, y - 1, 3.6);
      c.fill();
      c.fillRect(x - 2.2, y + 1.5, 4.4, 2.5);
      c.fillStyle = '#fff8e8';
      circle(c, x - 1.4, y - 1, 1);
      c.fill();
      circle(c, x + 1.4, y - 1, 1);
      c.fill();
      break;
    case 'Fish':
      ellipse(c, x - 0.5, y, 3.6, 2.2);
      c.fill();
      c.beginPath();
      c.moveTo(x + 2.5, y);
      c.lineTo(x + 5, y - 2.5);
      c.lineTo(x + 5, y + 2.5);
      c.closePath();
      c.fill();
      break;
    case 'Crown':
      c.beginPath();
      c.moveTo(x - 4, y + 3);
      c.lineTo(x - 4, y - 2);
      c.lineTo(x - 2, y);
      c.lineTo(x, y - 3.5);
      c.lineTo(x + 2, y);
      c.lineTo(x + 4, y - 2);
      c.lineTo(x + 4, y + 3);
      c.closePath();
      c.fill();
      break;
    default:
  }
}

function clothPattern(
  c: Ctx,
  pattern: number,
  accent: string,
  x0: number,
  y0: number,
  w: number,
  h: number,
): void {
  c.fillStyle = accent;
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  switch (option(PATTERNS, pattern)) {
    case 'Halves':
      c.fillRect(cx, y0, w / 2, h);
      break;
    case 'Stripes':
      for (let x = x0 + 2; x < x0 + w; x += 8) c.fillRect(x, y0, 4, h);
      break;
    case 'Quarters':
      c.fillRect(cx, y0, w / 2, h / 2);
      c.fillRect(x0, cy, w / 2, h / 2);
      break;
    case 'Chevron':
      c.beginPath();
      c.moveTo(x0, y0 + 4);
      c.lineTo(cx, cy);
      c.lineTo(x0 + w, y0 + 4);
      c.lineTo(x0 + w, y0 + 10);
      c.lineTo(cx, cy + 6);
      c.lineTo(x0, y0 + 10);
      c.closePath();
      c.fill();
      break;
    case 'Cross':
      c.fillRect(cx - 3, y0, 6, h);
      c.fillRect(x0, cy - 4, w, 5);
      break;
    case 'Checks':
      for (let x = x0; x < x0 + w; x += 6) {
        for (let y = y0; y < y0 + h; y += 6) {
          if ((Math.floor((x - x0) / 6) + Math.floor((y - y0) / 6)) % 2 === 0) c.fillRect(x, y, 6, 6);
        }
      }
      break;
    default:
  }
}

function mailTexture(c: Ctx, x0: number, y0: number, w: number, h: number): void {
  c.strokeStyle = '#6f7585';
  c.lineWidth = 0.8;
  for (let y = y0 + 2; y < y0 + h; y += 3) {
    const offset = Math.floor(y / 3) % 2 ? 1.5 : 0;
    for (let x = x0 + offset; x < x0 + w; x += 3) {
      c.beginPath();
      c.arc(x, y, 1.1, 0, Math.PI);
      c.stroke();
    }
  }
}

// ---------------------------------------------------------------- head

interface EyeOptions {
  spread?: number;
  scale?: number;
  skipLeft?: boolean;
}

function drawEyes(
  c: Ctx,
  style: string,
  skin: string,
  y: number,
  gazeX: number,
  gazeY: number,
  stunned: boolean,
  { spread = 5.5, scale = 1, skipLeft = false }: EyeOptions = {},
): void {
  for (const side of [-1, 1] as const) {
    if (side < 0 && skipLeft) continue;
    const x = side * spread;
    if (stunned) {
      c.strokeStyle = INK;
      c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(x - 2.5, y - 2.5);
      c.lineTo(x + 2.5, y + 2.5);
      c.moveTo(x + 2.5, y - 2.5);
      c.lineTo(x - 2.5, y + 2.5);
      c.stroke();
      continue;
    }
    if (style === 'Happy') {
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y + 1, 2.8 * scale, Math.PI * 1.1, Math.PI * 1.9);
      c.stroke();
      continue;
    }
    const wide = style === 'Wide';
    const rx = (wide ? 4.2 : 3.2) * scale;
    const ry = (wide ? 4.4 : 3.6) * scale;
    c.fillStyle = '#fff';
    ellipse(c, x, y, rx, ry);
    c.fill();
    c.lineWidth = 1.2;
    c.strokeStyle = INK;
    c.stroke();
    c.fillStyle = INK;
    circle(c, x + gazeX, y + gazeY, (wide ? 1.4 : 1.8) * scale);
    c.fill();
    if (style === 'Sleepy') {
      c.fillStyle = skin;
      c.fillRect(x - rx - 1, y - ry - 1, rx * 2 + 2, ry + 0.6);
      c.strokeStyle = INK;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x - rx, y - 0.4);
      c.lineTo(x + rx, y - 0.4);
      c.stroke();
    }
    if (style === 'Fierce') {
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x - side * 4.5, y - 5.5);
      c.lineTo(x + side * 2.5, y - 3.2);
      c.stroke();
    }
  }
}

function drawFace(c: Ctx, look: Look, p: Palette, gazeX: number, gazeY: number, stunned: boolean): void {
  const mark = option(MARKS, look.marks);
  const eyes = option(EYES, look.eyes);
  if (mark === 'Woad paint') {
    c.fillStyle = 'rgba(63,111,216,.75)';
    roundRect(c, -13.5, -3.5, 27, 6, 3);
    c.fill();
  } else if (mark === 'Rosy cheeks') {
    c.fillStyle = 'rgba(232,90,110,.4)';
    for (const x of [-9, 9]) {
      circle(c, x, 4, 3);
      c.fill();
    }
  } else if (mark === 'Freckles') {
    c.fillStyle = 'rgba(150,80,40,.6)';
    for (const [x, y] of [
      [-10, 3],
      [-8, 5],
      [-11, 6],
      [-7, 2.5],
      [10, 3],
      [8, 5],
      [11, 6],
      [7, 2.5],
    ] as const) {
      circle(c, x, y, 0.8);
      c.fill();
    }
  }
  drawEyes(c, eyes, p.skin, 0, gazeX, gazeY, stunned, { skipLeft: mark === 'Eyepatch' });
  if (mark === 'Eyepatch') {
    c.strokeStyle = INK;
    c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(-13, -5);
    c.lineTo(14, -7);
    c.stroke();
    ellipse(c, -5.5, 0, 4.2, 3.8);
    c.fillStyle = INK;
    c.fill();
  } else if (mark === 'Scar') {
    c.strokeStyle = '#a0413a';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(4, -6);
    c.lineTo(8, 5);
    c.stroke();
    c.lineWidth = 1;
    for (const t of [0.3, 0.6]) {
      c.beginPath();
      c.moveTo(4 + 4 * t - 1.8, -6 + 11 * t);
      c.lineTo(4 + 4 * t + 1.8, -6 + 11 * t - 0.8);
      c.stroke();
    }
  }

  const beard = option(BEARDS, look.beard);
  if (beard === 'Stubble') {
    c.fillStyle = p.hair;
    c.globalAlpha = 0.35;
    for (let i = 0; i < 14; i++) {
      const a = Math.PI * (0.15 + (0.7 * i) / 13);
      c.fillRect(Math.cos(a) * 11 - 0.6, 5 + Math.sin(a) * 6, 1.3, 1.3);
    }
    c.globalAlpha = 1;
  } else if (beard === 'Full' || beard === 'Braided') {
    c.beginPath();
    c.moveTo(-13, 2);
    c.quadraticCurveTo(-12, 17, 0, 18);
    c.quadraticCurveTo(12, 17, 13, 2);
    c.quadraticCurveTo(8, 10, 0, 10);
    c.quadraticCurveTo(-8, 10, -13, 2);
    c.closePath();
    fillInk(c, p.hair, 1.6);
    if (beard === 'Braided') {
      for (const y of [21, 25]) {
        ellipse(c, 0, y, 2.6, 2.4);
        fillInk(c, p.hair, 1.4);
      }
    }
  } else if (beard === 'Goatee') {
    c.beginPath();
    c.moveTo(-3, 10.5);
    c.lineTo(3, 10.5);
    c.lineTo(0, 16);
    c.closePath();
    fillInk(c, p.hair, 1.4);
  }

  c.strokeStyle = INK;
  c.lineWidth = 1.6;
  c.beginPath();
  if (stunned) circle(c, 0, 8.5, 1.8);
  else if (eyes === 'Fierce') {
    c.moveTo(-3, 8.5);
    c.lineTo(3, 8.5);
  } else c.arc(0, 6.5, 3, 0.2 * Math.PI, 0.8 * Math.PI);
  c.stroke();

  if (beard === 'Moustache') {
    for (const side of [-1, 1] as const) {
      ellipse(c, side * 3.4, 5.6, 3.8, 1.9, side * 0.25);
      fillInk(c, p.hair, 1.3);
    }
  }
}

function drawHairTop(c: Ctx, style: string, hair: string): void {
  if (style === 'Bald') {
    c.fillStyle = 'rgba(255,255,255,.5)';
    ellipse(c, -5, -9, 4, 2.4, -0.4);
    c.fill();
    return;
  }
  if (style === 'Mohawk') {
    roundRect(c, -3.2, -24, 6.4, 15, 3);
    fillInk(c, hair, 1.8);
    return;
  }
  c.beginPath();
  c.moveTo(-15.5, 0);
  c.quadraticCurveTo(-16, -16, 0, -15.5);
  c.quadraticCurveTo(14, -16, 15.8, -2);
  c.quadraticCurveTo(8, -9, 2, -7);
  c.quadraticCurveTo(-5, -11, -9, -5);
  c.quadraticCurveTo(-12, -6, -15.5, 0);
  c.closePath();
  fillInk(c, hair, 2);
  if (style === 'Bun') {
    circle(c, 0, -18, 5.5);
    fillInk(c, hair, 2);
  }
}

function withFace(c: Ctx, scale: number, dy: number, draw: () => void): void {
  c.save();
  c.translate(0, dy);
  c.scale(scale, scale);
  draw();
  c.restore();
}

function highlight(c: Ctx, x: number, y: number, rx: number, ry: number, rotation: number): void {
  c.fillStyle = 'rgba(255,255,255,.5)';
  ellipse(c, x, y, rx, ry, rotation);
  c.fill();
}

function drawHead(
  c: Ctx,
  look: Look,
  helmet: HelmetDef,
  p: Palette,
  gazeX: number,
  gazeY: number,
  stunned: boolean,
): void {
  const face = (): void => {
    drawFace(c, look, p, gazeX, gazeY, stunned);
  };
  const { light, dark } = p.metal;
  switch (helmet.name) {
    case 'Great helm':
      roundRect(c, -16, -17, 32, 33, 9);
      fillInk(c, light);
      c.fillStyle = 'rgba(255,255,255,.5)';
      roundRect(c, -12, -14, 8, 5, 2.5);
      c.fill();
      roundRect(c, -12, -6, 24, 7, 3);
      c.fillStyle = INK;
      c.fill();
      slitEyes(c, [-4.5, 5.5], -2.5, gazeX, stunned);
      c.fillStyle = INK;
      for (const [x, y] of [
        [6, 6],
        [9, 6],
        [6, 9.5],
        [9, 9.5],
      ] as const) {
        circle(c, x, y, 0.9);
        c.fill();
      }
      c.strokeStyle = dark;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(0, -16);
      c.lineTo(0, -7);
      c.stroke();
      break;
    case 'Bascinet':
      c.beginPath();
      c.moveTo(-16, 5);
      c.quadraticCurveTo(-18, -12, 0, -24);
      c.quadraticCurveTo(18, -12, 16, 5);
      c.quadraticCurveTo(0, 17, -16, 5);
      c.closePath();
      fillInk(c, light);
      ellipse(c, 5, 3, 11, 8);
      fillInk(c, dark);
      c.strokeStyle = INK;
      c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(-3, 0);
      c.lineTo(13, 0);
      c.stroke();
      if (!stunned) {
        c.fillStyle = '#fff';
        for (const x of [2, 9]) {
          circle(c, x, -0.2, 1.4);
          c.fill();
        }
      }
      c.fillStyle = INK;
      for (const [x, y] of [
        [6, 5],
        [9, 5],
        [12, 5],
        [7.5, 7.5],
        [10.5, 7.5],
      ] as const) {
        circle(c, x, y, 0.8);
        c.fill();
      }
      highlight(c, -6, -10, 3, 6, 0.5);
      break;
    case 'Barbute': {
      circle(c, 0, 0, 17);
      fillInk(c, light);
      c.beginPath();
      c.moveTo(-10, -7);
      c.lineTo(10, -7);
      c.lineTo(10, -1);
      c.lineTo(3.5, -1);
      c.lineTo(3.5, 13);
      c.lineTo(-3.5, 13);
      c.lineTo(-3.5, -1);
      c.lineTo(-10, -1);
      c.closePath();
      c.fillStyle = p.skin;
      c.fill();
      c.save();
      c.clip();
      const beard = option(BEARDS, look.beard);
      if (beard !== 'None' && beard !== 'Stubble') {
        c.fillStyle = p.hair;
        c.fillRect(-4, 5, 8, 9);
      }
      drawEyes(c, option(EYES, look.eyes), p.skin, -4, gazeX * 0.6, gazeY * 0.4, stunned, {
        spread: 5,
        scale: 0.75,
      });
      c.restore();
      c.lineWidth = 2;
      c.strokeStyle = INK;
      c.stroke();
      highlight(c, -8, -11, 5, 3, -0.5);
      break;
    }
    case 'Hood':
    case 'Mail coif': {
      const hood = helmet.name === 'Hood';
      circle(c, 0, 0, 18.5);
      fillInk(c, hood ? shade(p.accent === ACCENTS[0] ? p.team : p.accent, -0.25) : MAIL);
      if (!hood) {
        c.save();
        circle(c, 0, 0, 18);
        c.clip();
        mailTexture(c, -18, -18, 36, 36);
        c.restore();
      }
      circle(c, 0, 3, 12.8);
      fillInk(c, p.skin, 1.8);
      withFace(c, 0.82, 3, face);
      if (hood) {
        c.beginPath();
        c.moveTo(-6, -17);
        c.quadraticCurveTo(0, -26, 6, -17);
        c.strokeStyle = INK;
        c.lineWidth = 2;
        c.stroke();
      }
      break;
    }
    default:
      drawOpenFaced(c, look, helmet, p, face);
  }
}

function slitEyes(c: Ctx, xs: readonly number[], y: number, gazeX: number, stunned: boolean): void {
  for (const x of xs) {
    if (stunned) {
      c.strokeStyle = '#fff';
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(x - 2, y - 2);
      c.lineTo(x + 2, y + 2);
      c.moveTo(x + 2, y - 2);
      c.lineTo(x - 2, y + 2);
      c.stroke();
      continue;
    }
    c.fillStyle = '#fff';
    circle(c, x, y, 2.1);
    c.fill();
    c.fillStyle = INK;
    circle(c, x + gazeX * 0.5, y, 1);
    c.fill();
  }
}

/** Kettle hat, horned helm, crown, wizard hat and bare head all show the whole face. */
function drawOpenFaced(c: Ctx, look: Look, helmet: HelmetDef, p: Palette, face: () => void): void {
  const style = option(HAIRSTYLES, look.hairstyle);
  const { light, dark } = p.metal;
  if (helmet.name === 'Crown' && style !== 'Bald' && style !== 'Mohawk') {
    circle(c, 0, -1, 17);
    fillInk(c, p.hair);
  }
  circle(c, 0, 2, 15.5);
  fillInk(c, p.skin);
  if (helmet.name === 'Bare head') drawHairTop(c, style, p.hair);
  withFace(c, 1, 2, face);

  switch (helmet.name) {
    case 'Kettle hat':
      c.beginPath();
      c.arc(0, -7, 13.5, Math.PI, 0);
      c.closePath();
      fillInk(c, light);
      ellipse(c, 0, -7, 23, 5);
      fillInk(c, dark);
      break;
    case 'Horned helm':
      for (const side of [-1, 1] as const) {
        c.beginPath();
        c.moveTo(side * 13, -8);
        c.quadraticCurveTo(side * 29, -10, side * 25, -29);
        c.quadraticCurveTo(side * 22, -15, side * 9, -13);
        c.closePath();
        fillInk(c, '#f1e4c8');
      }
      c.beginPath();
      c.arc(0, -1, 16.5, Math.PI, 0);
      c.closePath();
      fillInk(c, light);
      roundRect(c, -2.2, -3, 4.4, 12, 1.8);
      fillInk(c, light, 1.6);
      c.fillStyle = dark;
      for (let x = -13; x <= 13; x += 6.5) {
        circle(c, x, -2, 1.3);
        c.fill();
      }
      break;
    case 'Crown':
      if (style === 'Mohawk') drawHairTop(c, style, p.hair);
      c.beginPath();
      c.moveTo(-12, -10);
      c.lineTo(-13, -22);
      c.lineTo(-6.5, -15);
      c.lineTo(0, -25);
      c.lineTo(6.5, -15);
      c.lineTo(13, -22);
      c.lineTo(12, -10);
      c.closePath();
      fillInk(c, GOLD);
      for (const [x, y, r, colour] of [
        [0, -14, 1.8, '#e8453c'],
        [-7, -13, 1.4, '#3f8fd8'],
        [7, -13, 1.4, '#3f8fd8'],
      ] as const) {
        c.fillStyle = colour;
        circle(c, x, y, r);
        c.fill();
      }
      break;
    case 'Wizard hat': {
      const hat = p.accent === ACCENTS[0] ? '#5b4bb0' : p.accent;
      c.beginPath();
      c.moveTo(-12, -9);
      c.quadraticCurveTo(-4, -30, 6, -44);
      c.quadraticCurveTo(2, -26, 13, -9);
      c.closePath();
      fillInk(c, hat);
      ellipse(c, 0, -9, 21, 4.5);
      fillInk(c, shade(hat, -0.2));
      c.fillStyle = GOLD;
      for (const [x, y] of [
        [-3, -18],
        [3, -26],
        [1, -14],
      ] as const) {
        circle(c, x, y, 1.3);
        c.fill();
      }
      break;
    }
    default:
  }
}

function drawTopper(c: Ctx, look: Look, helmet: HelmetDef, p: Palette): void {
  const top = helmet.top;
  switch (option(TOPPERS, look.topper)) {
    case 'Plume':
      c.beginPath();
      c.moveTo(2, top + 3);
      c.bezierCurveTo(-4, top - 18, -22, top - 17, -27, top - 2);
      c.bezierCurveTo(-18, top - 9, -8, top - 6, -3, top + 5);
      c.closePath();
      fillInk(c, p.accent === ACCENTS[2] ? p.team : p.accent);
      break;
    case 'Crest':
      for (let i = -10; i <= 8; i += 3.6) {
        roundRect(c, i - 1.6, top - 9 + Math.abs(i) * 0.3, 3.2, 10, 1.5);
        fillInk(c, p.team, 1.4);
      }
      break;
    case 'Feathers':
      for (const [x, tilt, colour] of [
        [-7, -0.5, p.accent],
        [0, 0, '#fff'],
        [7, 0.5, p.team],
      ] as const) {
        c.save();
        c.translate(x, top + 2);
        c.rotate(tilt);
        ellipse(c, 0, -9, 3.2, 9);
        fillInk(c, colour, 1.6);
        c.restore();
      }
      break;
    case 'Pennant':
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-3, top + 3);
      c.lineTo(-6, top - 24);
      c.stroke();
      c.beginPath();
      c.moveTo(-6, top - 24);
      c.lineTo(-24, top - 19);
      c.lineTo(-6, top - 13);
      c.closePath();
      fillInk(c, p.team, 1.8);
      break;
    case 'Antlers':
      c.strokeStyle = LEATHER_LIGHT;
      c.lineWidth = 3.2;
      for (const side of [-1, 1] as const) {
        c.beginPath();
        c.moveTo(side * 6, top + 4);
        c.lineTo(side * 13, top - 14);
        c.moveTo(side * 10, top - 6);
        c.lineTo(side * 19, top - 8);
        c.moveTo(side * 12, top - 11);
        c.lineTo(side * 9, top - 20);
        c.moveTo(side * 13, top - 14);
        c.lineTo(side * 20, top - 19);
        c.stroke();
      }
      break;
    default:
  }
}
