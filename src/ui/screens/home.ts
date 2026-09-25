import type { AppContext } from '../../app';
import { LATEST } from '../../changelog/releases';
import { MODES } from '../../modes';
import type { GameMode } from '../../modes/mode';
import { button, h } from '../dom';
import { drawPortrait } from '../portrait';

function modeCard(mode: GameMode, app: AppContext): HTMLElement {
  return h(
    'article',
    { class: `mode${mode.available ? '' : ' is-soon'}` },
    h('h3', { text: mode.name }),
    h('p', { text: mode.blurb }),
    mode.available
      ? button(
          'Play',
          () => {
            mode.start(app);
          },
          'btn btn-go',
        )
      : h('span', { class: 'soon', text: 'Coming soon' }),
  );
}

export function mountHome(root: HTMLElement, app: AppContext): () => void {
  const portrait = h('canvas', {
    class: 'home-portrait',
    attrs: { 'aria-label': `${app.look.name}, your knight` },
  });
  root.append(
    h(
      'section',
      { class: 'home' },
      h('h1', { class: 'logo', text: 'MOB BALL' }),
      h('p', {
        class: 'tagline',
        text: 'Medieval football. Forge a knight, pick a house, and mob the ball.',
      }),
      LATEST &&
        h(
          'a',
          { class: 'news', attrs: { href: './changelog.html' } },
          h('span', { class: 'news-version', text: `v${LATEST.version}` }),
          h('span', { text: LATEST.title }),
          h('span', { class: 'news-cta', text: 'Read the chronicle →' }),
        ),
      h(
        'div',
        { class: 'home-grid' },
        h(
          'div',
          { class: 'home-hero' },
          portrait,
          h('p', { class: 'home-name', text: app.look.name }),
          button('🛡️ Forge your knight', () => {
            app.go('forge');
          }),
        ),
        h('div', { class: 'modes' }, ...MODES.map((mode) => modeCard(mode, app))),
      ),
      h('p', {
        class: 'hint',
        text: 'WASD or arrows to run · Space to kick · Shift to barge. Best with a keyboard.',
      }),
    ),
  );
  drawPortrait(portrait, app.look, app.house.colour, { width: 220, height: 240 });
  return () => undefined;
}
