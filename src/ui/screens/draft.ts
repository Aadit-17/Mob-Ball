import type { AppContext } from '../../app';
import { button, h } from '../dom';

/** Placeholder until the screen is built. */
export function mountDraft(root: HTMLElement, app: AppContext): () => void {
  root.append(
    h(
      'section',
      { class: 'cup' },
      h('h2', { text: 'draft' }),
      button('Home', () => {
        app.go('home');
      }),
    ),
  );
  return () => undefined;
}
