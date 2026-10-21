import type { AppContext } from '../../app';
import { muteButton } from '../../audio/mute-button';
import { sound } from '../../audio/sound';
import { LATEST } from '../../changelog/releases';
import { prefersTouch } from '../../input/touch';
import { MODES } from '../../modes';
import type { GameMode } from '../../modes/mode';
import { HOUSES } from '../../setup/houses';
import { buildStatRows } from '../build-stats';
import { button, h } from '../dom';
import { banner, blockColour, icon, torches, type IconName } from '../heraldry';
import { throughTheGates } from '../motion';
import { drawPortrait } from '../portrait';

const MODE_ICONS: Readonly<Record<string, IconName>> = {
  exhibition: 'ball',
  cup: 'cup',
  career: 'helm',
  manager: 'scroll',
};

const BANNER_SWAY = [0, -1.3, -2.1, -0.6];

function modeCard(mode: GameMode, app: AppContext): HTMLElement {
  const progress = mode.progress?.(app) ?? null;
  return h(
    'article',
    { class: `mode sh${mode.available ? ' is-live' : ' is-soon'}` },
    h('div', { class: 'mode-icon' }, icon(MODE_ICONS[mode.id] ?? 'ball')),
    h('h3', { text: mode.name }),
    h('p', { text: mode.blurb }),
    progress && h('p', { class: 'mode-progress', text: progress.note }),
    h(
      'div',
      { class: 'mode-foot' },
      mode.available
        ? button(
            progress?.action ?? 'Play',
            () => {
              throughTheGates(() => {
                mode.start(app);
              });
            },
            'btn-primary',
          )
        : h('span', { class: 'soon' }, icon('lock'), 'Coming soon'),
    ),
  );
}

const kbd = (key: string): HTMLElement => h('kbd', { text: key });

/** "Realm Cup champion ×2" under the knight's name; nothing until the first one is won. */
const honourTitle = (title: string, count: number): HTMLElement | null =>
  count > 0
    ? h(
        'p',
        { class: 'home-title' },
        title,
        count > 1 && h('span', { class: 'title-count', text: `×${count}` }),
      )
    : null;

export function mountHome(root: HTMLElement, app: AppContext): () => void {
  // Home is always the first screen, so this covers every screen after it.
  sound.attach();
  const portrait = h('canvas', {
    class: 'home-portrait',
    attrs: { 'aria-label': `${app.look.name}, your knight` },
  });
  const banners = HOUSES.map((house, i) => banner(house, BANNER_SWAY[i] ?? 0));
  const { cupWins, leagueWins } = app.honours;
  root.append(
    h(
      'section',
      { class: 'home' },
      torches(),
      h(
        'div',
        { class: 'logo-row' },
        h('div', { class: 'banners' }, ...banners.slice(0, 2)),
        h(
          'div',
          { class: 'logo-block' },
          h('h1', { class: 'logo metal', text: 'MOB BALL', attrs: { 'data-text': 'MOB BALL' } }),
          h('p', {
            class: 'tagline',
            text: 'Medieval football. Forge a knight, raise your banner, and mob the ball.',
          }),
        ),
        h('div', { class: 'banners' }, ...banners.slice(2)),
      ),
      LATEST &&
        h(
          'a',
          { class: 'news', attrs: { href: './changelog.html' } },
          h('span', { class: 'news-version', text: `v${LATEST.version}` }),
          h('span', { class: 'news-title', text: LATEST.title }),
          h('span', { class: 'news-cta', text: 'Read the chronicle →' }),
        ),
      h(
        'div',
        { class: 'home-grid' },
        h(
          'div',
          {
            class: 'home-hero sh',
            attrs: { style: `--house: ${blockColour(app.house)}` },
          },
          h(
            'div',
            { class: 'plinth' },
            h('div', { class: 'plinth-shield' }),
            portrait,
            cupWins > 0 &&
              h('span', { class: 'trophy', attrs: { title: 'Realm Cup champion' } }, icon('cup')),
            leagueWins > 0 &&
              h(
                'span',
                { class: 'trophy league', attrs: { title: 'Realm League champion' } },
                icon('scroll'),
              ),
          ),
          h('p', { class: 'home-name', text: app.look.name }),
          h('p', { class: 'home-house', text: `House ${app.house.name}` }),
          honourTitle('Realm Cup champion', cupWins),
          honourTitle('Realm League champion', leagueWins),
          h('div', { class: 'stats' }, ...buildStatRows(app.look)),
          button('Forge your knight', () => {
            app.go('forge');
          }),
        ),
        h('div', { class: 'modes' }, ...MODES.map((mode) => modeCard(mode, app))),
      ),
      h(
        'div',
        { class: 'home-foot' },
        prefersTouch()
          ? h(
              'p',
              { class: 'hint' },
              'Drag on the left to run · hold ',
              kbd('Kick'),
              ' · tap ',
              kbd('Barge'),
              '. Turn your phone sideways for the biggest pitch.',
            )
          : h(
              'p',
              { class: 'hint' },
              kbd('WASD'),
              ' or arrows to run · ',
              kbd('Space'),
              ' to kick · ',
              kbd('Shift'),
              ' to barge. Best with a keyboard.',
            ),
        muteButton('Mute sound', 'icon-btn'),
      ),
    ),
  );
  drawPortrait(portrait, app.look, app.house.colour, { width: 172, height: 196 });
  return () => undefined;
}
