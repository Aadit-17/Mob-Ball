/** Small canvas helpers shared by every drawing module. All art is outlined in this ink. */
export const INK = '#2a1e3b';

export type Ctx = CanvasRenderingContext2D;

export function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function circle(c: Ctx, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
}

export function ellipse(c: Ctx, x: number, y: number, rx: number, ry: number, rotation = 0): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
}

/** Fills the current path and outlines it in ink. */
export function fillInk(c: Ctx, fill: string, lineWidth = 2.2): void {
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = lineWidth;
  c.strokeStyle = INK;
  c.stroke();
}

/** Darkens (negative amount) or lightens (positive) a #rrggbb colour. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number): string => {
    const out = amount < 0 ? v * (1 + amount) : v + (255 - v) * amount;
    return Math.round(Math.max(0, Math.min(255, out)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(n >> 16)}${channel((n >> 8) & 255)}${channel(n & 255)}`;
}

export function star(c: Ctx, x: number, y: number, r: number, colour: string): void {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? r * 0.45 : r;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    c.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
  }
  c.closePath();
  fillInk(c, colour, 2);
}

/** Sizes a canvas for the device pixel ratio and returns a context drawing in CSS pixels. */
export function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number): Ctx {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Canvas 2D is not available');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  return c;
}
