import { HOUSES } from '../setup/houses';
import { h } from './dom';
import { quarteredShield } from './heraldry';

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const GATES_MS = 1400;
/** When the gates meet; the next screen is swapped in behind them here. */
const GATES_SHUT = 0.34;

/** Swings the castle gates shut, runs `change` behind them, then opens them. Any key or click skips. */
export function throughTheGates(change: () => void): void {
  if (reducedMotion()) {
    change();
    return;
  }
  const left = h('div', { class: 'door l' });
  const right = h('div', { class: 'door r' });
  const shield = quarteredShield(HOUSES);
  const gates = h('div', { class: 'gates', attrs: { 'aria-hidden': 'true' } }, left, right, shield);
  document.body.append(gates);

  const timing = { duration: GATES_MS, fill: 'both' } as const;
  const doorSwing = (from: string): Keyframe[] => [
    { transform: from, easing: 'cubic-bezier(.7,0,.3,1)' },
    { transform: 'translateX(0)', offset: GATES_SHUT },
    { transform: 'translateX(0)', offset: 0.62, easing: 'cubic-bezier(.7,0,.3,1)' },
    { transform: from },
  ];
  const animations = [
    left.animate(doorSwing('translateX(-102%)'), timing),
    right.animate(doorSwing('translateX(102%)'), timing),
    shield.animate(
      [
        { opacity: 0, transform: 'scale(.6)' },
        { opacity: 0, transform: 'scale(.6)', offset: 0.26, easing: 'cubic-bezier(.2,.9,.2,1)' },
        { opacity: 1, transform: 'scale(1)', offset: 0.4 },
        { opacity: 1, transform: 'scale(1)', offset: 0.58 },
        { opacity: 0, transform: 'scale(1.15)', offset: 0.7 },
        { opacity: 0, transform: 'scale(1.15)' },
      ],
      timing,
    ),
  ];

  let changed = false;
  const swap = (): void => {
    if (changed) return;
    changed = true;
    change();
  };
  const timer = window.setTimeout(swap, GATES_MS * GATES_SHUT);
  const skip = (): void => {
    window.clearTimeout(timer);
    swap();
    for (const a of animations) a.finish();
  };
  window.addEventListener('keydown', skip, { once: true, capture: true });
  window.addEventListener('pointerdown', skip, { once: true, capture: true });
  void Promise.all(animations.map((a) => a.finished)).then(() => {
    window.removeEventListener('keydown', skip, { capture: true });
    window.removeEventListener('pointerdown', skip, { capture: true });
    gates.remove();
  });
}

/** Bursts heraldic lozenges in the given colours from a point inside `layer`. */
export function lozengeBurst(layer: HTMLElement, x: number, y: number, colours: readonly string[]): void {
  if (reducedMotion()) return;
  const count = 44;
  for (let i = 0; i < count; i++) {
    const size = 11 + Math.random() * 9;
    const piece = h('i', {
      style: {
        width: `${size}px`,
        height: `${size * 1.5}px`,
        background: colours[i % colours.length] ?? '#f2c14e',
      },
    });
    layer.append(piece);
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 170;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const fall = 120 + Math.random() * 80;
    const spin = (Math.random() - 0.5) * 900;
    piece.animate(
      [
        { transform: `translate(${x}px, ${y}px) rotate(0deg) scale(1)`, opacity: 1 },
        {
          transform: `translate(${x + dx * 0.8}px, ${y + dy * 0.8}px) rotate(${spin / 2}deg) scale(1)`,
          opacity: 1,
          offset: 0.45,
        },
        { transform: `translate(${x + dx}px, ${y + dy + fall}px) rotate(${spin}deg) scale(.4)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 900, easing: 'cubic-bezier(.15,.8,.3,1)', fill: 'forwards' },
    ).onfinish = () => {
      piece.remove();
    };
  }
}
