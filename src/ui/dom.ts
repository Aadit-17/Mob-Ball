type Child = Node | string | null | undefined | false;

type Handlers = { [E in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[E]) => void };

export interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  on?: Handlers;
}

/** Tiny element builder: `h('button', { class: 'btn', on: { click } }, 'Play')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) el.setAttribute(name, value);
  if (props.style) Object.assign(el.style, props.style);
  for (const [type, handler] of Object.entries(props.on ?? {})) {
    el.addEventListener(type, handler as EventListener);
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

export function button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  return h('button', { class: className, text: label, attrs: { type: 'button' }, on: { click: onClick } });
}
