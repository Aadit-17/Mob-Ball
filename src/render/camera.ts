import { PITCH } from '../game/constants';
import type { Vec } from '../game/vec';
import { clamp } from '../game/vec';

export const VIEW = { width: 960, height: 540 } as const;

/** Follows the ball, leaning toward the player, without showing past the courtyard edges. */
export class Camera {
  x: number = PITCH.centerX;
  y: number = PITCH.centerY;

  static readonly BALL_WEIGHT = 0.7;
  static readonly SMOOTHING = 5;

  snap(): void {
    this.x = PITCH.centerX;
    this.y = PITCH.centerY;
    this.clamp();
  }

  follow(ball: Vec, player: Vec | undefined, dt: number): void {
    const w = player ? Camera.BALL_WEIGHT : 1;
    const tx = ball.x * w + (player?.x ?? 0) * (1 - w);
    const ty = ball.y * w + (player?.y ?? 0) * (1 - w);
    const k = Math.min(1, dt * Camera.SMOOTHING);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.clamp();
  }

  /** World coordinate at the top-left of the view. */
  get left(): number {
    return this.x - VIEW.width / 2;
  }

  get top(): number {
    return this.y - VIEW.height / 2;
  }

  private clamp(): void {
    this.x = clamp(this.x, VIEW.width / 2, PITCH.width - VIEW.width / 2);
    this.y = clamp(this.y, VIEW.height / 2, PITCH.height - VIEW.height / 2);
  }
}
