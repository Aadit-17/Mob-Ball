import { drawKnight, spriteHeight, STANDING, type Pose } from '../knight/draw';
import type { Look } from '../knight/look';
import { setupCanvas } from '../render/paint';

/** Draws a standing knight as large as fits, helmet toppers included, in a canvas of the given CSS size. */
export function drawPortrait(
  canvas: HTMLCanvasElement,
  look: Look,
  teamColour: string,
  size: { width: number; height: number },
  pose: Partial<Pose> = {},
): void {
  const c = setupCanvas(canvas, size.width, size.height);
  c.clearRect(0, 0, size.width, size.height);
  const scale = Math.min((size.height * 0.92) / spriteHeight(look), size.width / 62);
  c.translate(size.width / 2, size.height * 0.95);
  c.scale(scale, scale);
  drawKnight(c, look, teamColour, { ...STANDING, ...pose });
}
