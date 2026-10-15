/**
 * Link-preview key art (public/og-image.png), drawn with the game's own knight renderer, banners
 * and theme so the preview always matches the game. Served by Vite only for `npm run og-image`;
 * it is not part of the production build.
 */
import '../../src/ui/theme.css';
import './og-image.css';
import { createRng } from '../../src/game/rng';
import { drawKnight, STANDING, type Pose } from '../../src/knight/draw';
import { DEFAULT_LOOK, randomLook, type Look } from '../../src/knight/look';
import { drawBall } from '../../src/render/pitch';
import { setupCanvas, type Ctx } from '../../src/render/paint';
import { HOUSES, houseById } from '../../src/setup/houses';
import { h } from '../../src/ui/dom';
import { banner, torches } from '../../src/ui/heraldry';

declare global {
  interface Window {
    ogReady?: boolean;
  }
}

const WIDTH = 1200;
const HEIGHT = 630;

interface Figure {
  look: Look;
  house: string;
  x: number;
  /** Feet height on the image. */
  y: number;
  scale: number;
  pose: Partial<Pose>;
}

const seeded = (seed: number, name: string, helmet?: number): Look =>
  randomLook(createRng(seed), name, helmet);

/** Back row first so the front row overlaps it. */
const FIGURES: readonly Figure[] = [
  { look: seeded(11, 'Sir Hale', 4), house: 'ember', x: 150, y: 548, scale: 2.6, pose: { run: 1.1 } },
  {
    look: seeded(29, 'Dame Ves', 6),
    house: 'grey',
    x: 1050,
    y: 548,
    scale: 2.6,
    pose: { facing: -1, run: 2.3 },
  },
  { look: seeded(7, 'Brother Ott', 8), house: 'ember', x: 300, y: 576, scale: 3.1, pose: { run: 2.6 } },
  {
    look: seeded(41, 'Sir Grim', 0),
    house: 'grey',
    x: 900,
    y: 576,
    scale: 3.1,
    pose: { facing: -1, run: 0.9 },
  },
  { look: DEFAULT_LOOK, house: 'ember', x: 470, y: 604, scale: 3.6, pose: { lookX: 1, lookY: 0.2 } },
  {
    look: seeded(3, 'Lady Wren', 2),
    house: 'grey',
    x: 730,
    y: 604,
    scale: 3.6,
    pose: { facing: -1, lookX: -1 },
  },
];

function drawScene(canvas: HTMLCanvasElement): void {
  const c: Ctx = setupCanvas(canvas, WIDTH, HEIGHT);
  for (const f of FIGURES) {
    c.save();
    c.translate(f.x, f.y);
    c.scale(f.scale, f.scale);
    c.fillStyle = 'rgba(0, 0, 0, 0.38)';
    c.beginPath();
    c.ellipse(0, 0, 20, 6, 0, 0, Math.PI * 2);
    c.fill();
    drawKnight(c, f.look, houseById(f.house).colour, { ...STANDING, ...f.pose });
    c.restore();
  }
  c.save();
  c.translate(600, 586);
  c.scale(2.7, 2.7);
  drawBall(c, 0, 0, 11, 1.2);
  c.restore();
}

function build(): HTMLElement {
  const canvas = h('canvas', { class: 'knights', attrs: { width: `${WIDTH}`, height: `${HEIGHT}` } });
  drawScene(canvas);
  const sways = [-3, 2.2, -2.2, 3];
  const banners = HOUSES.map((house, i) => {
    const el = banner(house, 0);
    el.classList.add(`b${i}`);
    el.style.setProperty('--tilt', `${sways[i] ?? 0}deg`);
    return el;
  });
  return h(
    'div',
    { class: 'stage' },
    h('div', { class: 'floor' }),
    torches(),
    ...banners,
    h(
      'div',
      { class: 'title' },
      h('h1', { class: 'logo metal', text: 'MOB BALL', attrs: { 'data-text': 'MOB BALL' } }),
      h('p', { class: 'ribbon', text: 'Top-down medieval football' }),
      h('p', { class: 'sub', text: 'Forge your knight · Outplay smart bots · Play free in your browser' }),
    ),
    canvas,
  );
}

async function main(): Promise<void> {
  await Promise.all([
    document.fonts.load('900 120px "Cinzel Decorative"'),
    document.fonts.load('800 24px "Cinzel"'),
    document.fonts.load('500 24px "Alegreya Sans"'),
  ]);
  await document.fonts.ready;
  document.getElementById('og')?.append(build());
  await new Promise((resolve) => requestAnimationFrame(resolve));
  window.ogReady = true;
}

void main();
