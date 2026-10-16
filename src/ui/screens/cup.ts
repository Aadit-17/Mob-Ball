import type { AppContext } from '../../app';
import { DIFFICULTIES, skillFor, TIERS } from '../../ai/skills';
import { BUILDS } from '../../game/constants';
import type { KnightSpec } from '../../game/match';
import { option } from '../../knight/catalog';
import { cupLevel, cupSession, enterCup, opponentOf, roundName } from '../../modes/cup';
import {
  cupStatus,
  fixtures,
  fixtureSeed,
  knockedOutIn,
  pendingSimulations,
  playerFixture,
  recordResult,
  ROUNDS,
  roundTier,
  winnerOf,
  type CupState,
  type Fixture,
} from '../../modes/cup/bracket';
import { simulateMatch } from '../../modes/cup/simulate';
import { houseById, HOUSES, REALM_HOUSES, type House } from '../../setup/houses';
import { choice } from '../choice';
import { button, h } from '../dom';
import { banner, blockColour, houseShield, icon } from '../heraldry';
import { lozengeBurst, reducedMotion, throughTheGates } from '../motion';
import { drawPortrait } from '../portrait';
import { ROLE_NAMES, stars } from './setup';

/** Steps of a simulated match per frame: about 8 ms, so the bracket stays smooth while the others play. */
const STEPS_PER_FRAME = 1200;
/** Each simulated result lands at least this far apart, so they read as results coming in. */
const RESULT_PACE_MS = 450;

const ROUND_TITLES = ['Quarter-finals', 'Semi-finals', 'Final'] as const;

function tieSide(cup: CupState, fixture: Fixture, side: 0 | 1): HTMLElement {
  const id = fixture.houses[side];
  const house = id === null ? null : houseById(id);
  const winner = winnerOf(fixture);
  const result = winner === null ? '' : winner === id ? ' is-won' : ' is-lost';
  const you = id === cup.playerHouse;
  return h(
    'div',
    { class: `tie-side${result}${you ? ' is-you' : ''}${house ? '' : ' is-tbd'}` },
    houseShield(house),
    h('span', { class: 'side-name', text: house?.name ?? 'To be decided' }),
    you && h('small', { class: 'you-tag', text: 'You' }),
    h('span', { class: 'tie-goals', text: fixture.score ? String(fixture.score[side]) : '' }),
  );
}

function tie(cup: CupState, fixture: Fixture, next: Fixture | null, fresh: Fixture | null): HTMLElement {
  const mine = fixture.houses.includes(cup.playerHouse);
  const isNext = next?.round === fixture.round && next.index === fixture.index;
  const isFresh = fresh?.round === fixture.round && fresh.index === fixture.index;
  const label = fixture.houses.map((id) => (id ? houseById(id).name : 'To be decided')).join(' v ');
  return h(
    'article',
    {
      class: `tie${mine ? ' is-mine' : ''}${isNext ? ' is-next' : ''}${isFresh ? ' is-fresh' : ''}`,
      attrs: {
        'aria-label': fixture.score ? `${label}, ${fixture.score.join('–')}` : `${label}, to be played`,
      },
    },
    tieSide(cup, fixture, 0),
    tieSide(cup, fixture, 1),
  );
}

/** The tournament tree: quarter-finals to the crown, with the player's road picked out in gold. */
function bracket(cup: CupState, fresh: Fixture | null): HTMLElement {
  const next = playerFixture(cup);
  const wonByPlayer = (f: Fixture): boolean => winnerOf(f) === cup.playerHouse;
  const rounds = ROUNDS.map((_, round) => {
    const ties = fixtures(cup, round);
    const slot = (f: Fixture): HTMLElement =>
      h('div', { class: `tie-slot${wonByPlayer(f) ? ' is-path' : ''}` }, tie(cup, f, next, fresh));
    const pairs =
      ties.length === 1
        ? ties.map((f) => h('div', { class: 'tie-pair' }, slot(f)))
        : Array.from({ length: ties.length / 2 }, (_, i) => {
            const pair = ties.slice(i * 2, i * 2 + 2);
            return h(
              'div',
              { class: `tie-pair${pair.some(wonByPlayer) ? ' is-path' : ''}` },
              ...pair.map(slot),
            );
          });
    return h(
      'section',
      { class: `cup-round${ties.length === 1 ? ' is-final' : ''}` },
      h('h3', { text: ROUND_TITLES[round] ?? '' }),
      h('div', { class: 'round-ties' }, ...pairs),
    );
  });
  const final = fixtures(cup, ROUNDS.length - 1)[0];
  const championId = final ? winnerOf(final) : null;
  const champion = championId === null ? null : houseById(championId);
  return h(
    'div',
    { class: 'bracket panel' },
    ...rounds,
    h(
      'section',
      { class: 'cup-round is-crown' },
      h('h3', { text: 'Champion' }),
      h(
        'div',
        { class: 'round-ties' },
        h(
          'div',
          {
            class: `cup-crown sh${champion ? ' is-won' : ''}${championId === cup.playerHouse ? ' is-you' : ''}`,
          },
          h('span', { class: 'crown-cup' }, icon('cup')),
          champion ? houseShield(champion) : null,
          h('b', { text: champion?.name ?? 'Who will lift it?' }),
        ),
      ),
    ),
  );
}

function rivalCard(spec: KnightSpec, house: House): HTMLElement {
  const canvas = h('canvas');
  const card = h(
    'div',
    { class: 'card-knight' },
    canvas,
    h('b', { text: spec.look.name }),
    h('small', { text: `${ROLE_NAMES[spec.role]} · ${option(BUILDS, spec.look.build).name}` }),
    h(
      'small',
      { class: 'tier' },
      h('span', { class: 'stars', text: stars(spec.tier), attrs: { 'aria-hidden': 'true' } }),
      skillFor(spec.tier).name,
    ),
  );
  drawPortrait(canvas, spec.look, house.colour, { width: 110, height: 128 });
  return card;
}

const faceOffSide = (house: House, sway: number): HTMLElement =>
  h('div', { class: 'face-side' }, banner(house, sway), h('b', { text: house.name }));

export function mountCup(root: HTMLElement, app: AppContext): () => void {
  const hero = h('div', { class: 'cup-hero' });
  const tree = h('div', { class: 'cup-tree' });
  const fx = h('div', { class: 'fx cup-fx', attrs: { 'aria-hidden': 'true' } });
  const timers: number[] = [];
  let frame = 0;

  const later = (ms: number, run: () => void): void => {
    timers.push(window.setTimeout(run, ms));
  };

  const play = (run: CupState, fixture: Fixture): void => {
    throughTheGates(() => {
      app.playMatch(cupSession(app, run, fixture));
    });
  };

  const entry = (): void => {
    tree.replaceChildren();
    const level = app.difficulty;
    hero.replaceChildren(
      h(
        'div',
        { class: 'choices panel' },
        choice(
          'Your house',
          HOUSES.map((house) => ({ value: house.id, label: house.name, colour: house.colour })),
          app.prefs.houseId,
          (houseId) => {
            app.setPrefs({ houseId });
            entry();
          },
        ),
        choice(
          'Teammates',
          TIERS.map((t, tier) => ({ value: tier, label: t.name })),
          app.prefs.teammateTier,
          (teammateTier) => {
            app.setPrefs({ teammateTier });
            entry();
          },
        ),
        choice(
          'Cup level',
          DIFFICULTIES.map((d) => ({ value: d.id, label: d.label })),
          app.prefs.difficultyId,
          (difficultyId) => {
            app.setPrefs({ difficultyId });
            entry();
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
            entry();
          },
        ),
      ),
      h(
        'ol',
        { class: 'cup-ladder', attrs: { 'aria-label': 'Rival levels by round' } },
        ...ROUNDS.map((name, round) => {
          const tier = roundTier(level.meanTier, round);
          return h(
            'li',
            { class: 'ladder-step sh' },
            h('b', { text: name }),
            h('span', { class: 'stars', text: stars(tier), attrs: { 'aria-hidden': 'true' } }),
            h('small', { text: `${skillFor(tier).name} rivals` }),
          );
        }),
      ),
      h(
        'p',
        { class: 'hint' },
        `Eight houses, three knockout ties. Every house fields the same knights in every cup. Rivals start a level below ${level.label} and finish a level above it. Lose once and you are out.`,
      ),
      h(
        'div',
        { class: 'cup-field', attrs: { 'aria-label': 'The houses in the cup' } },
        ...REALM_HOUSES.map((house) =>
          h(
            'span',
            { class: `field-house${house.id === app.house.id ? ' is-you' : ''}` },
            houseShield(house),
            house.name,
          ),
        ),
      ),
      h(
        'div',
        { class: 'setup-actions' },
        button(
          'Draw the bracket',
          () => {
            enterCup(app);
            render();
          },
          'btn-primary',
        ),
      ),
    );
  };

  const nextMatch = (run: CupState, fixture: Fixture): HTMLElement => {
    const session = cupSession(app, run, fixture);
    const rivalLevel = skillFor(roundTier(cupLevel(run).meanTier, fixture.round)).name;
    return h(
      'div',
      { class: 'cup-next panel' },
      h('p', { class: 'ribbon', text: ROUNDS[fixture.round] ?? '' }),
      h(
        'div',
        { class: 'face-off' },
        faceOffSide(session.homeHouse, 0),
        h('span', { class: 'vs', text: 'v' }),
        faceOffSide(session.awayHouse, -1.3),
      ),
      h(
        'p',
        { class: 'cup-level' },
        `${session.awayHouse.name} field ${rivalLevel}-level knights, mixed. Your teammates play as ${skillFor(app.prefs.teammateTier).name}s.`,
      ),
      h(
        'div',
        { class: 'cards', attrs: { style: `--n: ${session.away.length}` } },
        ...session.away.map((spec) => rivalCard(spec, session.awayHouse)),
      ),
      h(
        'div',
        { class: 'cup-actions' },
        button(
          `Play ${roundName(fixture.round)}`,
          () => {
            play(run, fixture);
          },
          'btn-primary',
        ),
      ),
    );
  };

  /** Plays the other ties of the round headless, a slice per frame, saving each result as it lands. */
  const simulateRound = (run: CupState, pending: readonly Fixture[]): void => {
    hero.replaceChildren(
      h(
        'div',
        { class: 'cup-next panel is-waiting' },
        h('p', { class: 'ribbon', text: `${ROUNDS[pending[0]?.round ?? 0] ?? ''} results` }),
        h('p', { class: 'cup-level', text: 'The other ties are being played across the realm…' }),
      ),
    );
    const [fixture] = pending;
    const [a, b] = fixture?.houses ?? [];
    if (!fixture || !a || !b) return;
    const match = simulateMatch(
      [houseById(a), houseById(b)],
      run.teamSize,
      roundTier(cupLevel(run).meanTier, fixture.round),
      fixtureSeed(run.seed, fixture.round, fixture.index),
    );
    const started = performance.now();
    const step = (): void => {
      const score = match.advance(STEPS_PER_FRAME);
      if (!score) {
        frame = requestAnimationFrame(step);
        return;
      }
      const wait = reducedMotion() ? 0 : Math.max(0, RESULT_PACE_MS - (performance.now() - started));
      later(wait, () => {
        app.setCup(recordResult(run, fixture.round, fixture.index, score));
        render(fixture);
      });
    };
    frame = requestAnimationFrame(step);
  };

  const knockedOut = (run: CupState, round: number): HTMLElement => {
    const lost = fixtures(run, round).find((f) => f.houses.includes(run.playerHouse));
    const rival = lost ? houseById(opponentOf(run, lost) ?? '') : null;
    const score = lost?.score ? [...lost.score].sort((x, y) => y - x).join('–') : '';
    return h(
      'div',
      { class: 'cup-verdict panel' },
      h('p', { class: 'ribbon', text: 'Knocked out' }),
      h('h2', { class: 'verdict', text: `Knocked out in the ${roundName(round)}` }),
      rival &&
        h('p', {
          class: 'cup-level',
          text: `${rival.name} beat House ${houseById(run.playerHouse).name} ${score}.`,
        }),
      h(
        'div',
        { class: 'cup-actions' },
        button(
          'Try again',
          () => {
            enterCup(app);
            render();
          },
          'btn-primary',
        ),
        button('Home', () => {
          app.setCup(null);
          app.go('home');
        }),
      ),
    );
  };

  const champion = (run: CupState): HTMLElement => {
    const house = houseById(run.playerHouse);
    const portrait = h('canvas', {
      class: 'home-portrait',
      attrs: { 'aria-label': `${app.look.name}, champion` },
    });
    const final = fixtures(run, ROUNDS.length - 1)[0];
    const beaten = final ? houseById(opponentOf(run, final) ?? '') : null;
    const score = final?.score ? [...final.score].sort((x, y) => y - x).join('–') : '';
    const wins = app.honours.cupWins;
    const card = h(
      'div',
      { class: 'cup-champion panel' },
      h('p', { class: 'ribbon', text: 'Champions' }),
      h(
        'div',
        { class: 'champion-stage' },
        h('span', { class: 'champion-cup' }, icon('cup')),
        h(
          'div',
          { class: 'plinth', attrs: { style: `--house: ${blockColour(house)}` } },
          h('div', { class: 'plinth-shield' }),
          portrait,
        ),
        h('span', { class: 'champion-cup' }, icon('cup')),
      ),
      h('h2', {
        class: 'metal cup-title',
        text: 'Realm Cup champion',
        attrs: { 'data-text': 'Realm Cup champion' },
      }),
      h('p', {
        class: 'cup-level',
        text: beaten
          ? `${app.look.name} and House ${house.name} beat ${beaten.name} ${score} in the final.`
          : '',
      }),
      h(
        'p',
        { class: 'cup-tally' },
        icon('cup'),
        wins === 1 ? 'Your first Realm Cup' : `Realm Cup wins: ${wins}`,
      ),
      h(
        'div',
        { class: 'cup-actions' },
        button(
          'Back to the hall',
          () => {
            app.setCup(null);
            app.go('home');
          },
          'btn-primary',
        ),
        button('Play another cup', () => {
          app.setCup(null);
          render();
        }),
      ),
    );
    drawPortrait(portrait, app.look, house.colour, { width: 172, height: 196 });
    if (!reducedMotion()) {
      const colours = ['#ffe39a', '#f2c14e', '#fff6d0', house.colour, blockColour(house)];
      const bursts = [
        { ms: 0, x: 0.5 },
        { ms: 650, x: 0.25 },
        { ms: 1300, x: 0.75 },
      ];
      for (const { ms, x } of bursts) {
        later(ms, () => {
          lozengeBurst(fx, fx.clientWidth * x, fx.clientHeight * 0.3, colours);
        });
      }
    }
    return card;
  };

  function render(fresh: Fixture | null = null): void {
    const run = app.cup;
    if (!run) {
      entry();
      return;
    }
    tree.replaceChildren(bracket(run, fresh));
    const status = cupStatus(run);
    if (status === 'won') {
      hero.replaceChildren(champion(run));
      return;
    }
    const outIn = knockedOutIn(run);
    if (outIn !== null) {
      hero.replaceChildren(knockedOut(run, outIn));
      return;
    }
    const fixture = playerFixture(run);
    if (fixture) {
      hero.replaceChildren(nextMatch(run, fixture));
      return;
    }
    const pending = pendingSimulations(run);
    if (pending.length) simulateRound(run, pending);
  }

  root.append(
    h(
      'section',
      { class: 'cup-screen' },
      h(
        'header',
        { class: 'screen-head' },
        button('← Home', () => {
          app.go('home');
        }),
        h('h2', { text: 'Realm Cup' }),
      ),
      hero,
      tree,
      fx,
    ),
  );
  render();
  return () => {
    cancelAnimationFrame(frame);
    for (const timer of timers) window.clearTimeout(timer);
  };
}
