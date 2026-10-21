import type { Input } from '../game/types';

export interface Vec {
  x: number;
  y: number;
}

export interface StickConfig {
  /** Radius of the drawn ring, in CSS pixels. */
  radius: number;
  /** Offsets below this fraction of the radius are ignored, so a resting thumb doesn't creep. */
  deadZone: number;
  /** Full speed from this fraction of the radius: keyboard players always run flat out. */
  fullAt: number;
}

export const STICK: Readonly<StickConfig> = { radius: 56, deadZone: 0.14, fullAt: 0.6 };

/** Turns the thumb's offset from the stick's centre into a move of length 0 to 1. */
export function stickMove(dx: number, dy: number, config: Readonly<StickConfig> = STICK): Vec {
  const distance = Math.hypot(dx, dy);
  const reach = distance / config.radius;
  if (reach <= config.deadZone) return { x: 0, y: 0 };
  const strength = Math.min(1, (reach - config.deadZone) / (config.fullAt - config.deadZone));
  return { x: (dx / distance) * strength, y: (dy / distance) * strength };
}

/** Where the knob sits: on the thumb, but never outside the ring. */
export function knobOffset(dx: number, dy: number, radius: number): Vec {
  const distance = Math.hypot(dx, dy);
  if (distance <= radius) return { x: dx, y: dy };
  return { x: (dx / distance) * radius, y: (dy / distance) * radius };
}

/** Drags the stick's centre after a thumb that leaves the ring, so turning back is instant. */
export function followThumb(centre: Vec, thumb: Vec, radius: number): Vec {
  const dx = thumb.x - centre.x;
  const dy = thumb.y - centre.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius) return centre;
  const pull = (distance - radius) / distance;
  return { x: centre.x + dx * pull, y: centre.y + dy * pull };
}

/** What the buttons are doing; a barge tap counts until a step has read it, however short. */
export interface ButtonState {
  kickHeld: boolean;
  bargeHeld: boolean;
  bargeTapped: boolean;
}

export function touchInput(move: Vec, buttons: Readonly<ButtonState>): Input {
  return {
    moveX: move.x,
    moveY: move.y,
    kick: buttons.kickHeld,
    barge: buttons.bargeHeld || buttons.bargeTapped,
  };
}
