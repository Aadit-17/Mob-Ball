import type { AppContext } from '../../app';
import { DIFFICULTIES, skillFor, TIERS, TOP_TIER } from '../../ai/skills';
import { BUILDS } from '../../game/constants';
import type { KnightSpec } from '../../game/match';
import type { Role } from '../../game/types';
import { option } from '../../knight/catalog';
import { exhibitionSession } from '../../modes/exhibition';
import { HOUSES, type House } from '../../setup/houses';
import { button, h } from '../dom';
import { drawPortrait } from '../portrait';

export const ROLE_NAMES: Readonly<Record<Role, string>> = {
  gk: 'Keeper',
  def: 'Defender',
  mid: 'Midfield',
  fwd: 'Forward',
};

const stars = (tier: number): string => '★'.repeat(tier + 1) + '☆'.repeat(TIERS.length - tier - 1);

function choice<T extends string | number>(
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
      h('button', {
        class: 'btn',
        text: o.label,
        attrs: { type: 'button', 'aria-pressed': String(o.value === current) },
        style: o.colour ? { boxShadow: `inset 0 -5px 0 ${o.colour}, 2px 2px 0 var(--ink)` } : {},
        on: {
          click: () => {
            onPick(o.value);
          },
        },
      }),
    ),
  );
}

/** ◀ ★★★☆☆ Knight ▶ — steps one bot's skill tier. */
function tierPicker(spec: KnightSpec, onChange: (tier: number) => void): HTMLElement {
  const step = (by: number, label: string): HTMLButtonElement =>
    h('button', {
      text: by < 0 ? '◀' : '▶',
      attrs: {
        type: 'button',
        'aria-label': `${label} ${spec.look.name}'s level`,
        ...(spec.tier + by < 0 || spec.tier + by > TOP_TIER ? { disabled: '' } : {}),
      },
      on: {
        click: () => {
          onChange(spec.tier + by);
        },
      },
    });
  return h(
    'div',
    { class: 'tier-pick' },
    step(-1, 'Lower'),
    h(
      'small',
      { class: 'tier', attrs: { title: 'Bot skill level' } },
      stars(spec.tier),
      h('br'),
      skillFor(spec.tier).name,
    ),
    step(1, 'Raise'),
  );
}

function knightCard(spec: KnightSpec, house: House, onTier: (tier: number) => void): HTMLElement {
  const canvas = h('canvas');
  const card = h(
    'div',
    { class: `card-knight${spec.human ? ' is-you' : ''}` },
    canvas,
    h('b', { text: spec.look.name }),
    h('small', {
      text: `${spec.human ? 'You · ' : ''}${ROLE_NAMES[spec.role]} · ${option(BUILDS, spec.look.build).name}`,
    }),
    spec.human ? h('small', { class: 'tier', text: 'Controlled by you' }) : tierPicker(spec, onTier),
  );
  drawPortrait(canvas, spec.look, house.colour, { width: 110, height: 128 });
  return card;
}

export function mountSetup(root: HTMLElement, app: AppContext): () => void {
  const body = h('div', { class: 'setup-body' });

  const render = (): void => {
    const lineup = (label: string, house: House, team: 0 | 1, specs: readonly KnightSpec[]): HTMLElement =>
      h(
        'div',
        { class: 'lineup' },
        h(
          'h3',
          {},
          h('i', { class: 'dot', style: { background: house.colour } }),
          `${house.name} · ${label}`,
        ),
        h(
          'div',
          { class: 'cards', style: { gridTemplateColumns: `repeat(${specs.length}, 1fr)` } },
          ...specs.map((s, i) =>
            knightCard(s, house, (tier) => {
              app.setKnightTier(team, i, tier);
              render();
            }),
          ),
        ),
      );
    body.replaceChildren(
      h(
        'div',
        { class: 'choices' },
        choice(
          'Your house',
          HOUSES.map((house) => ({ value: house.id, label: house.name, colour: house.colour })),
          app.prefs.houseId,
          (houseId) => {
            app.setPrefs({ houseId });
            render();
          },
        ),
        choice(
          'Teammates',
          TIERS.map((t, tier) => ({ value: tier, label: t.name })),
          app.prefs.teammateTier,
          (teammateTier) => {
            app.setPrefs({ teammateTier });
            render();
          },
        ),
        choice(
          'Rivals',
          DIFFICULTIES.map((d) => ({ value: d.id, label: `${d.label} (mixed)` })),
          app.prefs.difficultyId,
          (difficultyId) => {
            app.setPrefs({ difficultyId });
            render();
          },
        ),
        choice(
          'Teams',
          [
            { value: 4, label: '4v4' },
            { value: 3, label: '3v3' },
          ],
          app.prefs.teamSize,
          (teamSize) => {
            app.setPrefs({ teamSize: teamSize === 3 ? 3 : 4 });
            render();
          },
        ),
      ),
      h(
        'p',
        { class: 'hint' },
        `Rivals are mixed around the ${app.difficulty.label} level, so some are better than others. Fine-tune any knight's level with the arrows on their card.`,
      ),
      h(
        'div',
        { class: 'lineups' },
        lineup('your house', app.house, 0, app.squads.home),
        lineup('rivals', app.rival, 1, app.squads.away),
      ),
    );
  };

  root.append(
    h(
      'section',
      { class: 'setup' },
      h(
        'header',
        { class: 'screen-head' },
        button('← Home', () => {
          app.go('home');
        }),
        h('h2', { text: 'Exhibition match' }),
      ),
      body,
      h(
        'div',
        { class: 'setup-actions' },
        button('🎲 New random squads', () => {
          app.rerollSquads();
          render();
        }),
        button('🛡️ Edit my knight', () => {
          app.go('forge');
        }),
        button(
          '⚔️ Kick off',
          () => {
            app.playMatch(exhibitionSession(app));
          },
          'btn btn-go',
        ),
      ),
    ),
  );
  render();
  return () => undefined;
}
