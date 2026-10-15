import { h } from './dom';

/** A labelled row of ◆ chips, one pressed; `colour` adds a house shield to a chip. */
export function choice<T extends string | number>(
  label: string,
  options: readonly { value: T; label: string; colour?: string }[],
  current: T,
  onPick: (value: T) => void,
): HTMLElement {
  return h(
    'div',
    { class: 'choice', attrs: { role: 'group', 'aria-label': label } },
    h('b', { text: label }),
    ...options.map((o) =>
      h(
        'button',
        {
          class: 'chip',
          attrs: { type: 'button', 'aria-pressed': String(o.value === current) },
          on: {
            click: () => {
              onPick(o.value);
            },
          },
        },
        o.colour && h('i', { class: 'chip-shield', attrs: { style: `--c: ${o.colour}` } }),
        o.label,
      ),
    ),
  );
}
