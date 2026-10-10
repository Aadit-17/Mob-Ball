import { h } from '../ui/dom';
import { icon } from '../ui/heraldry';
import { sound } from './sound';

/** A speaker toggle whose `aria-pressed` is true while muted. */
export function muteButton(label: string, className: string): HTMLButtonElement {
  const render = (el: HTMLButtonElement): void => {
    el.replaceChildren(icon(sound.muted ? 'muted' : 'sound'));
    el.setAttribute('aria-pressed', String(sound.muted));
  };
  const el = h('button', {
    class: className,
    attrs: { type: 'button', 'aria-label': label, title: label },
    on: {
      click: (e) => {
        sound.setMuted(!sound.muted);
        render(e.currentTarget as HTMLButtonElement);
      },
    },
  });
  render(el);
  return el;
}
