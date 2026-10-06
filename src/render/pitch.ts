import { PITCH } from '../game/constants';
import { SKIN, HAIR } from '../knight/catalog';
import { circle, ellipse, fillInk, INK, roundRect, type Ctx } from './paint';

const STRIPES = 12;
const STAND_DEPTH = 46;

/** Pre-renders everything that never moves: courtyard, stands, pitch markings and nets. */
export function renderPitch(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = PITCH.width * dpr;
  canvas.height = PITCH.height * dpr;
  const b = canvas.getContext('2d');
  if (!b) throw new Error('Canvas 2D is not available');
  b.setTransform(dpr, 0, 0, dpr, 0, 0);
  b.lineJoin = 'round';
  drawCobbles(b);
  drawStands(b);
  drawGrass(b);
  drawMarkings(b);
  for (const side of [-1, 1] as const) drawNet(b, side);
  return canvas;
}

function drawCobbles(b: Ctx): void {
  b.fillStyle = '#c9a36b';
  b.fillRect(0, 0, PITCH.width, PITCH.height);
  for (let y = 0; y < PITCH.height; y += 14) {
    for (let x = (y / 14) % 2 ? 10 : 0; x < PITCH.width; x += 20) {
      roundRect(b, x + 1, y + 1, 18, 12, 4);
      b.fillStyle = (x * 7 + y * 3) % 5 < 2 ? '#bf9860' : '#cfaa73';
      b.fill();
    }
  }
}

function drawStands(b: Ctx): void {
  for (const y of [0, PITCH.height - STAND_DEPTH]) {
    b.fillStyle = '#8a5a30';
    b.fillRect(0, y, PITCH.width, STAND_DEPTH);
    b.fillStyle = '#a06a3a';
    for (let row = y + 4; row < y + STAND_DEPTH; row += 14) b.fillRect(0, row, PITCH.width, 6);
  }
}

function drawGrass(b: Ctx): void {
  const w = PITCH.right - PITCH.left;
  roundRect(b, PITCH.left - 4, PITCH.top - 4, w + 8, PITCH.bottom - PITCH.top + 8, 10);
  b.fillStyle = INK;
  b.fill();
  const stripe = w / STRIPES;
  for (let i = 0; i < STRIPES; i++) {
    b.fillStyle = i % 2 ? '#58b845' : '#63c74e';
    b.fillRect(PITCH.left + i * stripe, PITCH.top, stripe + 0.5, PITCH.bottom - PITCH.top);
  }
}

function drawMarkings(b: Ctx): void {
  const { left, right, top, bottom, centerX, centerY } = PITCH;
  b.strokeStyle = 'rgba(255,255,255,.9)';
  b.lineWidth = 3;
  b.strokeRect(left + 2, top + 2, right - left - 4, bottom - top - 4);
  b.beginPath();
  b.moveTo(centerX, top);
  b.lineTo(centerX, bottom);
  b.stroke();
  circle(b, centerX, centerY, 62);
  b.stroke();
  b.fillStyle = '#fff';
  circle(b, centerX, centerY, 4);
  b.fill();
  const boxW = 110;
  // The box stays 35px clear of each post whatever the goal size.
  const boxH = PITCH.goalBottom - PITCH.goalTop + 70;
  b.strokeRect(left + 2, centerY - boxH / 2, boxW, boxH);
  b.strokeRect(right - boxW - 2, centerY - boxH / 2, boxW, boxH);
  const arc = Math.PI / 2.6;
  b.beginPath();
  b.arc(left + boxW + 2, centerY, 44, -arc, arc);
  b.stroke();
  b.beginPath();
  b.arc(right - boxW - 2, centerY, 44, Math.PI - arc, Math.PI + arc);
  b.stroke();
}

function drawNet(b: Ctx, side: -1 | 1): void {
  const { goalTop, goalBottom, goalDepth } = PITCH;
  const x0 = side < 0 ? PITCH.left - goalDepth : PITCH.right;
  roundRect(b, x0 - (side < 0 ? 6 : 0), goalTop - 6, goalDepth + 6, goalBottom - goalTop + 12, 6);
  b.fillStyle = '#8f8a9e';
  b.fill();
  b.lineWidth = 3;
  b.strokeStyle = INK;
  b.stroke();
  b.fillStyle = '#4a3f5e';
  b.fillRect(x0, goalTop, goalDepth, goalBottom - goalTop);
  b.strokeStyle = 'rgba(255,255,255,.45)';
  b.lineWidth = 1.3;
  for (let y = goalTop + 8; y < goalBottom; y += 10) {
    b.beginPath();
    b.moveTo(x0, y);
    b.lineTo(x0 + goalDepth, y);
    b.stroke();
  }
  for (let x = x0 + 6; x < x0 + goalDepth; x += 9) {
    b.beginPath();
    b.moveTo(x, goalTop);
    b.lineTo(x, goalBottom);
    b.stroke();
  }
}

interface Fan {
  x: number;
  y: number;
  shirt: string;
  skin: string;
  hair: string;
  phase: number;
}

const SHIRTS = ['#e8453c', '#3d3d6b', '#3f9a4a', '#3f8fd8', '#f2a541', '#9b59b6', '#e05a8a'];
const pick = <T>(list: readonly T[]): T => {
  const item = list[Math.floor(Math.random() * list.length)];
  if (item === undefined) throw new Error('Empty list');
  return item;
};

/** Two rows of fans along each touchline. */
export class Crowd {
  private readonly fans: Fan[] = [];

  constructor() {
    for (const rowStart of [8, PITCH.height - 38]) {
      for (let row = 0; row < 2; row++) {
        for (let x = 10 + (row % 2) * 11; x < PITCH.width; x += 22) {
          this.fans.push({
            x: x + Math.random() * 4,
            y: rowStart + row * 16,
            shirt: pick(SHIRTS),
            skin: pick(SKIN.slice(0, 6)),
            hair: pick(HAIR),
            phase: Math.random() * 6,
          });
        }
      }
    }
  }

  draw(c: Ctx, time: number, cheer: number): void {
    for (const f of this.fans) {
      const jump =
        cheer > 0
          ? Math.max(0, Math.sin(time * 14 + f.phase)) * 6 * Math.min(1, cheer)
          : Math.max(0, Math.sin(time * 2.5 + f.phase) - 0.9) * 10;
      c.beginPath();
      c.ellipse(f.x, f.y + 12 - jump * 0.3, 9, 6, 0, Math.PI, 0);
      fillInk(c, f.shirt, 2);
      circle(c, f.x, f.y + 2 - jump, 6.5);
      fillInk(c, f.skin, 2);
      c.beginPath();
      c.arc(f.x, f.y + 1 - jump, 6.5, Math.PI * 1.05, Math.PI * 1.95);
      c.lineTo(f.x, f.y - 1 - jump);
      c.closePath();
      c.fillStyle = f.hair;
      c.fill();
    }
  }
}

export function drawPost(c: Ctx, x: number, y: number, radius: number): void {
  circle(c, x, y, radius + 2);
  fillInk(c, '#d9cdb8', 2.5);
  circle(c, x, y, radius - 3);
  c.fillStyle = '#bfb29a';
  c.fill();
}

export function drawBall(c: Ctx, x: number, y: number, radius: number, spin: number): void {
  c.fillStyle = 'rgba(42,30,59,.25)';
  ellipse(c, x + 2, y + 4, radius, radius * 0.6);
  c.fill();
  c.save();
  c.translate(x, y);
  circle(c, 0, 0, radius);
  fillInk(c, '#d49356', 2.5);
  c.rotate(spin * 0.3);
  c.strokeStyle = '#7a4a24';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(0, -radius * 1.05, radius * 0.9, 0.6, 2.55);
  c.stroke();
  c.beginPath();
  c.arc(0, radius * 1.05, radius * 0.9, -2.55, -0.6);
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,.5)';
  ellipse(c, -3, -4, 3.5, 2, -0.6);
  c.fill();
  c.restore();
}
