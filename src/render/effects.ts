import { PITCH } from '../game/constants';
import type { MatchEvent, MatchState } from '../game/types';
import { PALETTE } from '../ui/palette';
import { circle, INK, star, type Ctx } from './paint';

interface Particle {
  kind: 'puff' | 'confetti' | 'spark';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  colour: string;
  rotation: number;
  spin: number;
}

interface Pop {
  x: number;
  y: number;
  text: string;
  life: number;
}

const CONFETTI = ['#ffc93c', '#e8453c', '#3f8fd8', '#3f9a4a', '#fff'];
const BONKS = ['BONK!', 'WHAM!', 'OOF!', 'CLONK!'];
const TRAIL_SPEED = 380;
const TRAIL_LIFE = 0.16;

const random = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
const anyOf = <T>(list: readonly T[]): T => {
  const item = list[Math.floor(Math.random() * list.length)];
  if (item === undefined) throw new Error('Empty list');
  return item;
};

/** Purely cosmetic reactions to match events. Never feeds back into the simulation. */
export class Effects {
  shake = 0;
  cheer = 0;
  private readonly particles: Particle[] = [];
  private readonly pops: Pop[] = [];
  private readonly trail: { x: number; y: number; life: number }[] = [];

  handle(event: MatchEvent): void {
    switch (event.type) {
      case 'kick':
        this.spawn(
          'spark',
          event.x,
          event.y,
          0,
          0,
          0.22,
          20 * event.boost,
          event.boost > 1 ? '#ffb347' : '#fff3b0',
        );
        if (event.boost > 1.3) this.shake = Math.max(this.shake, 0.1);
        break;
      case 'barge':
        this.pops.push({ x: event.x, y: event.y - 70, text: anyOf(BONKS), life: 0.8 });
        for (let i = 0; i < 8; i++) this.puff(event.x, event.y);
        this.shake = Math.max(this.shake, 0.2);
        this.cheer = Math.max(this.cheer, 0.8);
        break;
      case 'goal': {
        const x = event.team === 0 ? PITCH.right : PITCH.left;
        const push = event.team === 0 ? -250 : 250;
        for (let i = 0; i < 70; i++) {
          this.particles.push({
            kind: 'confetti',
            x,
            y: PITCH.centerY,
            vx: random(-300, 300) + push,
            vy: random(-300, 300),
            life: random(1.6, 2.6),
            size: 1,
            colour: anyOf(CONFETTI),
            rotation: random(0, 6),
            spin: random(-6, 6),
          });
        }
        this.shake = 0.4;
        this.cheer = 2.5;
        break;
      }
      default:
    }
  }

  update(dt: number, state: MatchState): void {
    for (const p of this.particles) {
      p.life -= dt;
      if (p.kind === 'confetti') {
        const drag = Math.pow(0.25, dt);
        p.vx *= drag;
        p.vy *= drag;
        p.rotation += p.spin * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    removeDead(this.particles);
    for (const p of this.pops) {
      p.life -= dt;
      p.y -= 30 * dt;
    }
    removeDead(this.pops);
    for (const t of this.trail) t.life -= dt;
    removeDead(this.trail);
    const { ball } = state;
    if (Math.hypot(ball.vx, ball.vy) > TRAIL_SPEED)
      this.trail.push({ x: ball.x, y: ball.y, life: TRAIL_LIFE });
    for (const k of state.knights)
      if (k.bargeTime > 0 && Math.random() < 0.5) this.puff(k.x, k.y + k.radius * 0.4);
    this.shake = Math.max(0, this.shake - dt);
    this.cheer = Math.max(0, this.cheer - dt);
  }

  /** Things on the grass, under the knights. */
  drawGround(c: Ctx, ballRadius: number): void {
    for (const p of this.particles) {
      if (p.kind !== 'puff') continue;
      c.globalAlpha = Math.min(1, p.life * 2) * 0.85;
      circle(c, p.x, p.y, p.size * (1.3 - p.life));
      c.fillStyle = '#f3e6cf';
      c.fill();
    }
    for (const t of this.trail) {
      c.globalAlpha = (t.life / TRAIL_LIFE) * 0.45;
      circle(c, t.x, t.y, ballRadius * 0.9);
      c.fillStyle = '#fff3b0';
      c.fill();
    }
    c.globalAlpha = 1;
  }

  /** Things in the air, over everything. */
  drawAir(c: Ctx): void {
    for (const p of this.particles) {
      if (p.kind === 'confetti') {
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rotation);
        c.fillStyle = p.colour;
        c.fillRect(-4, -2.5, 8, 5);
        c.restore();
      } else if (p.kind === 'spark') {
        c.globalAlpha = p.life / 0.22;
        star(c, p.x, p.y, p.size * (1.1 - p.life * 2), p.colour);
        c.globalAlpha = 1;
      }
    }
    for (const p of this.pops) {
      c.save();
      c.translate(p.x, p.y);
      const s = 1 + Math.max(0, p.life - 0.6) * 3;
      c.scale(s, s);
      c.rotate(-0.08);
      c.font = '800 30px "Barlow Condensed", sans-serif';
      c.textAlign = 'center';
      c.lineJoin = 'round';
      c.lineWidth = 6;
      c.strokeStyle = INK;
      c.strokeText(p.text, 0, 0);
      c.fillStyle = PALETTE.goldText;
      c.fillText(p.text, 0, 0);
      c.restore();
    }
  }

  private puff(x: number, y: number): void {
    this.spawn(
      'puff',
      x + random(-8, 8),
      y + random(-4, 4),
      random(-30, 30),
      random(-20, 20),
      random(0.4, 0.7),
      random(5, 11),
      '',
    );
  }

  private spawn(
    kind: Particle['kind'],
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    colour: string,
  ): void {
    this.particles.push({ kind, x, y, vx, vy, life, size, colour, rotation: 0, spin: 0 });
  }
}

function removeDead(list: { life: number }[]): void {
  for (let i = list.length - 1; i >= 0; i--) if ((list[i]?.life ?? 0) <= 0) list.splice(i, 1);
}
