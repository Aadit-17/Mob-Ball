import { PITCH } from '../game/constants';
import type { Knight, MatchState } from '../game/types';
import { drawKnight } from '../knight/draw';
import type { Camera } from './camera';
import { VIEW } from './camera';
import type { Effects } from './effects';
import { circle, ellipse, fillInk, INK, roundRect, star, type Ctx } from './paint';
import { Crowd, drawBall, drawPost, renderPitch } from './pitch';

/** Sprites are drawn at this fraction of a knight's physics size, which reads better on screen. */
const SPRITE_SCALE = 0.8 / 18;
const MINIMAP_WIDTH = 170;

export interface Scene {
  readonly state: MatchState;
  readonly camera: Camera;
  readonly effects: Effects;
  readonly teamColours: readonly [string, string];
  readonly humanId: number | null;
  readonly time: number;
}

export class MatchRenderer {
  private readonly pitch = renderPitch();
  private readonly crowd = new Crowd();
  private readonly dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor(private readonly c: Ctx) {}

  draw(scene: Scene): void {
    const { c } = this;
    const { state, camera, effects } = scene;
    const shake = effects.shake * 20;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.drawImage(
      this.pitch,
      camera.left * this.dpr,
      camera.top * this.dpr,
      VIEW.width * this.dpr,
      VIEW.height * this.dpr,
      0,
      0,
      VIEW.width,
      VIEW.height,
    );
    c.translate(-camera.left + (Math.random() - 0.5) * shake, -camera.top + (Math.random() - 0.5) * shake);

    this.crowd.draw(c, scene.time, effects.cheer);
    for (const post of state.posts) drawPost(c, post.x, post.y, post.radius);
    for (const k of state.knights) this.drawGroundRing(k, scene);
    effects.drawGround(c, state.ball.radius);

    const byDepth = [...state.knights].sort((a, b) => a.y - b.y);
    let ballDrawn = false;
    for (const k of byDepth) {
      if (!ballDrawn && state.ball.y < k.y) {
        drawBall(c, state.ball.x, state.ball.y, state.ball.radius, state.ball.spin);
        ballDrawn = true;
      }
      this.drawSprite(k, scene);
    }
    if (!ballDrawn) drawBall(c, state.ball.x, state.ball.y, state.ball.radius, state.ball.spin);

    this.drawLabels(scene);
    effects.drawAir(c);
    this.drawMinimap(scene);
  }

  private teamColour(k: Knight, scene: Scene): string {
    return scene.teamColours[k.team];
  }

  private drawGroundRing(k: Knight, scene: Scene): void {
    const { c } = this;
    const colour = this.teamColour(k, scene);
    c.fillStyle = 'rgba(42,30,59,.22)';
    ellipse(c, k.x, k.y + 3, k.radius + 2, k.radius * 0.8);
    c.fill();
    circle(c, k.x, k.y, k.radius);
    c.fillStyle = `${colour}55`;
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = colour;
    c.stroke();
    if (k.kickHeld) {
      circle(c, k.x, k.y, k.radius + 2.5);
      c.lineWidth = 2.5;
      c.strokeStyle = '#fff';
      c.stroke();
    }
  }

  private drawSprite(k: Knight, scene: Scene): void {
    const { c } = this;
    const { ball } = scene.state;
    const lx = ball.x - k.x;
    const ly = ball.y - (k.y - 45);
    const len = Math.hypot(lx, ly) || 1;
    c.save();
    c.translate(k.x, k.y + k.radius * 0.35);
    const s = k.radius * SPRITE_SCALE;
    c.scale(s, s);
    drawKnight(c, k.look, this.teamColour(k, scene), {
      facing: k.facing,
      lookX: lx / len,
      lookY: ly / len,
      run: k.runPhase,
      stunned: k.stun > 0,
      barging: k.bargeTime > 0,
      time: scene.time + k.id * 0.37,
    });
    c.restore();
    if (k.stun > 0) {
      for (let i = 0; i < 3; i++) {
        const a = scene.time * 6 + i * 2.1;
        star(c, k.x + Math.cos(a) * 16, k.y - k.radius * 3.4 + Math.sin(a) * 5, 5, '#ffd84a');
      }
    }
  }

  private drawLabels(scene: Scene): void {
    const { c } = this;
    c.font = '800 10px Nunito, sans-serif';
    c.textAlign = 'center';
    for (const k of scene.state.knights) {
      const isHuman = k.id === scene.humanId;
      const text = isHuman ? 'YOU' : k.look.name;
      c.lineWidth = 3;
      c.strokeStyle = INK;
      c.strokeText(text, k.x, k.y + k.radius + 12);
      c.fillStyle = isHuman ? '#ffd84a' : '#fff';
      c.fillText(text, k.x, k.y + k.radius + 12);
      if (isHuman && scene.state.phase !== 'ended') {
        const y = k.y - k.radius * 4.1 + Math.sin(scene.time * 5) * 3;
        c.beginPath();
        c.moveTo(k.x - 8, y);
        c.lineTo(k.x + 8, y);
        c.lineTo(k.x, y + 11);
        c.closePath();
        fillInk(c, '#ffd84a', 2.5);
      }
    }
  }

  private drawMinimap(scene: Scene): void {
    const { c } = this;
    const { state, camera } = scene;
    const { left, right, top, bottom, goalTop, goalBottom, goalDepth } = PITCH;
    const scale = MINIMAP_WIDTH / (right - left + 2 * goalDepth);
    const height = (bottom - top) * scale;
    const ox = VIEW.width - MINIMAP_WIDTH - 12;
    const oy = VIEW.height - height - 12;
    const X = (x: number): number => ox + (x - left + goalDepth) * scale;
    const Y = (y: number): number => oy + (y - top) * scale;

    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalAlpha = 0.88;
    roundRect(c, X(left) - 2, oy - 2, (right - left) * scale + 4, height + 4, 5);
    fillInk(c, '#5fbf4a', 2.5);
    c.fillStyle = '#4a3f5e';
    c.fillRect(X(left - goalDepth), Y(goalTop), goalDepth * scale, (goalBottom - goalTop) * scale);
    c.fillRect(X(right), Y(goalTop), goalDepth * scale, (goalBottom - goalTop) * scale);
    c.strokeStyle = 'rgba(255,255,255,.8)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(X(PITCH.centerX), oy);
    c.lineTo(X(PITCH.centerX), oy + height);
    c.stroke();
    const vx0 = Math.max(camera.left, left);
    const vy0 = Math.max(camera.top, top);
    const vx1 = Math.min(camera.left + VIEW.width, right);
    const vy1 = Math.min(camera.top + VIEW.height, bottom);
    c.strokeStyle = 'rgba(255,255,255,.9)';
    c.lineWidth = 1.5;
    c.strokeRect(X(vx0), Y(vy0), (vx1 - vx0) * scale, (vy1 - vy0) * scale);
    for (const k of state.knights) {
      const isHuman = k.id === scene.humanId;
      circle(c, X(k.x), Y(k.y), isHuman ? 4.5 : 3.5);
      fillInk(c, this.teamColour(k, scene), isHuman ? 2 : 1.2);
      if (isHuman) {
        circle(c, X(k.x), Y(k.y), 7);
        c.strokeStyle = '#ffd84a';
        c.lineWidth = 1.5;
        c.stroke();
      }
    }
    circle(c, X(state.ball.x), Y(state.ball.y), 2.6);
    fillInk(c, '#fff', 1.2);
    c.globalAlpha = 1;
  }
}
