import type { Input } from '../game/types';
import { h } from '../ui/dom';
import { icon } from '../ui/heraldry';
import { followThumb, knobOffset, STICK, stickMove, touchInput, type Vec } from './stick';

/** True on phones and tablets, whose main pointer is a finger. */
export const prefersTouch = (): boolean => window.matchMedia('(pointer: coarse)').matches;

/** Calls `enable` now on a touch device, or on the first touch anywhere (a laptop with a touchscreen). */
export function whenTouch(enable: () => void): () => void {
  if (prefersTouch()) {
    enable();
    return () => undefined;
  }
  const first = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    window.removeEventListener('pointerdown', first, true);
    enable();
  };
  window.addEventListener('pointerdown', first, true);
  return () => {
    window.removeEventListener('pointerdown', first, true);
  };
}

const isFinger = (e: PointerEvent): boolean => e.pointerType !== 'mouse';

/** The `Keyboard` for fingers: a stick that appears under the left thumb, a held Kick and a tapped Barge. */
export class TouchControls {
  readonly element: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly kickButton: HTMLElement;
  private readonly bargeButton: HTMLElement;
  private stickId: number | null = null;
  private centre: Vec = { x: 0, y: 0 };
  private move: Vec = { x: 0, y: 0 };
  private readonly kickIds = new Set<number>();
  private readonly bargeIds = new Set<number>();
  private bargeTapped = false;

  constructor() {
    this.knob = h('div', { class: 'tc-knob' }, h('span', { text: 'RUN' }));
    this.stick = h('div', { class: 'tc-stick', attrs: { 'aria-hidden': 'true' } }, this.knob);
    this.stick.style.setProperty('--r', `${STICK.radius}px`);
    const zone = h('div', { class: 'tc-zone' });
    this.kickButton = h(
      'div',
      { class: 'tc-btn tc-kick', attrs: { 'aria-hidden': 'true' } },
      icon('ball'),
      h('span', { text: 'KICK' }),
    );
    this.bargeButton = h(
      'div',
      { class: 'tc-btn tc-barge', attrs: { 'aria-hidden': 'true' } },
      h('div', { class: 'ring' }),
      h('span', { text: 'BARGE' }),
    );
    this.element = h(
      'div',
      { class: 'touch-controls' },
      zone,
      this.stick,
      h('div', { class: 'tc-buttons' }, this.bargeButton, this.kickButton),
    );
    this.element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    this.listenStick(zone);
    this.listenButton(this.kickButton, this.kickIds);
    this.listenButton(this.bargeButton, this.bargeIds, () => {
      this.bargeTapped = true;
    });
  }

  /** True while a finger is on the stick or a button, so the keyboard can take over otherwise. */
  get active(): boolean {
    return this.stickId !== null || this.kickIds.size > 0 || this.bargeIds.size > 0 || this.bargeTapped;
  }

  input(): Input {
    const input = touchInput(this.move, {
      kickHeld: this.kickIds.size > 0,
      bargeHeld: this.bargeIds.size > 0,
      bargeTapped: this.bargeTapped,
    });
    this.bargeTapped = false;
    return input;
  }

  /** Lets go of everything, e.g. when the pause menu covers the controls. */
  release(): void {
    this.endStick();
    this.kickIds.clear();
    this.bargeIds.clear();
    this.bargeTapped = false;
    this.kickButton.classList.remove('is-down');
    this.bargeButton.classList.remove('is-down');
  }

  dispose(): void {
    this.release();
    this.element.remove();
  }

  private listenStick(zone: HTMLElement): void {
    zone.addEventListener('pointerdown', (e) => {
      if (!isFinger(e) || this.stickId !== null) return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      this.stickId = e.pointerId;
      this.centre = this.local(e);
      this.stick.classList.add('is-down');
      this.drawStick(this.centre);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const thumb = this.local(e);
      this.centre = followThumb(this.centre, thumb, STICK.radius);
      this.move = stickMove(thumb.x - this.centre.x, thumb.y - this.centre.y);
      this.drawStick(thumb);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId === this.stickId) this.endStick();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  private listenButton(button: HTMLElement, ids: Set<number>, onPress?: () => void): void {
    button.addEventListener('pointerdown', (e) => {
      if (!isFinger(e)) return;
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      ids.add(e.pointerId);
      button.classList.add('is-down');
      onPress?.();
    });
    const end = (e: PointerEvent): void => {
      ids.delete(e.pointerId);
      if (!ids.size) button.classList.remove('is-down');
    };
    button.addEventListener('pointerup', end);
    button.addEventListener('pointercancel', end);
    button.addEventListener('lostpointercapture', end);
  }

  private endStick(): void {
    this.stickId = null;
    this.move = { x: 0, y: 0 };
    this.stick.classList.remove('is-down');
    this.stick.style.removeProperty('left');
    this.stick.style.removeProperty('top');
    this.knob.style.removeProperty('transform');
  }

  private drawStick(thumb: Vec): void {
    const knob = knobOffset(thumb.x - this.centre.x, thumb.y - this.centre.y, STICK.radius);
    this.stick.style.left = `${this.centre.x}px`;
    this.stick.style.top = `${this.centre.y}px`;
    this.knob.style.transform = `translate(${knob.x}px, ${knob.y}px)`;
  }

  /** The pointer's position inside the controls, which is where the stick is drawn. */
  private local(e: PointerEvent): Vec {
    const box = this.element.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }
}
