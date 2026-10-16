import './draft.css';
import type { AppContext } from '../../app';
import { skillFor, TIERS } from '../../ai/skills';
import { BUILDS } from '../../game/constants';
import { option } from '../../knight/catalog';
import { enterSeason } from '../../modes/manager';
import {
  BUDGET,
  checkPick,
  draftPool,
  FORGED_ID,
  houseForPick,
  houseOnTheClock,
  PICK_PROBLEMS,
  squadOf,
  tierCost,
  TOTAL_PICKS,
  type DraftState,
} from '../../modes/manager/draft';
import { isFinished } from '../../modes/manager/league';
import { autoDraft, draftKnight, isPlayersPick, type SeasonState } from '../../modes/manager/season';
import { SQUAD_SIZE, type SquadKnight } from '../../modes/manager/types';
import { houseById, REALM_HOUSES, type House } from '../../setup/houses';
import { choice } from '../choice';
import { button, h } from '../dom';
import { blockColour, crest } from '../heraldry';
import { reducedMotion } from '../motion';
import { drawPortrait } from '../portrait';
import { stars } from './setup';

/** Each rival pick lands this far apart, so they read as picks being made, like the cup's results. */
const RESULT_PACE_MS = 450;
/** Undrafted knights wear plain undyed cloth; they take a house's colours once picked. */
const FREE_AGENT_COLOUR = '#8d8579';
const CARD_PORTRAIT = { width: 110, height: 128 };
const SLOT_PORTRAIT = { width: 40, height: 46 };

type Sort = 'best' | 'cheapest';
type Show = 'all' | 'pickable';

interface Filters {
  /** -1 for every tier or build. */
  tier: number;
  build: number;
  sort: Sort;
  show: Show;
}

const tierName = (tier: number): string => skillFor(tier).name;
const buildName = (knight: SquadKnight): string => option(BUILDS, knight.look.build).name;
const points = (n: number): string => `${n} ${n === 1 ? 'point' : 'points'}`;
const youTag = (): HTMLElement => h('small', { class: 'you-tag', text: 'Your knight' });
const starsOf = (tier: number): HTMLElement =>
  h('span', { class: 'stars', text: stars(tier), attrs: { 'aria-hidden': 'true' } });

function houseShield(house: House): HTMLElement {
  return h('span', { class: 'tie-shield', attrs: { style: `--c: ${house.colour}` } }, crest(house));
}

/** "2.5 a pick": what's left spread over the picks still to make. */
function perPick(left: number, picks: number): string {
  const each = Math.round((left / picks) * 10) / 10;
  return `${each} a pick`;
}

/** The draft as it stands after the first `shown` picks: what the board shows mid-animation. */
const viewOf = (draft: DraftState, shown: number): DraftState => ({
  ...draft,
  picks: draft.picks.slice(0, shown),
});

export function mountDraft(root: HTMLElement, app: AppContext): () => void {
  const body = h('div', { class: 'draft-body' });
  const title = h('h2', { text: 'The Draft' });
  const live = h('p', { class: 'visually-hidden', attrs: { 'aria-live': 'polite' } });
  const filters: Filters = { tier: -1, build: -1, sort: 'best', show: 'all' };
  const openRivals = new Set<string>();
  const portraits = new Map<string, HTMLCanvasElement>();
  let pool: { seed: number; byId: ReadonlyMap<string, SquadKnight> } | null = null;
  let chosenHouse = app.season?.draft.playerHouse ?? app.prefs.houseId;
  /** Picks revealed so far; the saved state may be ahead while rival picks land one by one. */
  let shown = app.season?.draft.picks.length ?? 0;
  let timer = 0;

  /** Portraits are drawn once per knight and colour, then moved between renders. */
  const portrait = (knight: SquadKnight, colour: string, size: typeof CARD_PORTRAIT): HTMLCanvasElement => {
    const key = `${knight.id}|${colour}|${size.width}`;
    let canvas = portraits.get(key);
    if (!canvas) {
      canvas = h('canvas', { attrs: { 'aria-hidden': 'true' } });
      drawPortrait(canvas, knight.look, colour, size);
      portraits.set(key, canvas);
    }
    return canvas;
  };

  /** The season's whole pool by id, rebuilt (and old portraits dropped) when a new season starts. */
  const poolOf = (draft: DraftState): ReadonlyMap<string, SquadKnight> => {
    if (pool?.seed !== draft.seed) {
      pool = { seed: draft.seed, byId: new Map(draftPool(draft.seed, draft.forged).map((k) => [k.id, k])) };
      portraits.clear();
    }
    return pool.byId;
  };
  const knightById = (draft: DraftState, id: string): SquadKnight | undefined => poolOf(draft).get(id);

  const revealing = (): boolean => app.season !== null && shown < app.season.draft.picks.length;

  /** Lands the next hidden pick after a pause, until the board has caught up with the saved draft. */
  const reveal = (): void => {
    window.clearTimeout(timer);
    const total = app.season?.draft.picks.length ?? 0;
    if (shown >= total) return;
    if (reducedMotion()) {
      shown = total;
      render(true);
      return;
    }
    timer = window.setTimeout(() => {
      shown++;
      render(true);
      reveal();
    }, RESULT_PACE_MS);
  };

  const skip = (): void => {
    window.clearTimeout(timer);
    shown = app.season?.draft.picks.length ?? 0;
    render(true);
  };

  /** Makes the player's pick; the rival picks that follow are already saved and land one by one. */
  const pick = (next: (season: SeasonState) => SeasonState): void => {
    const season = app.season;
    if (!season || revealing() || !isPlayersPick(season)) return;
    const before = season.draft.picks.length;
    app.setSeason(next(season));
    shown = before + 1;
    render(true);
    reveal();
  };

  const autoRest = (): void => {
    let season = app.season;
    if (!season || revealing()) return;
    while (!season.league && isPlayersPick(season)) season = autoDraft(season);
    app.setSeason(season);
    shown = season.draft.picks.length;
    render(true);
  };

  const start = (): void => {
    enterSeason(app, chosenHouse);
    shown = 0;
    render();
    reveal();
  };

  // Setup ---------------------------------------------------------------------------------------

  const setup = (replacing: boolean): HTMLElement[] => {
    title.textContent = 'New season';
    const housePick = (house: House): HTMLElement =>
      h(
        'button',
        {
          class: 'house-pick',
          attrs: { type: 'button', 'aria-pressed': String(house.id === chosenHouse), 'data-focus': house.id },
          on: {
            click: () => {
              chosenHouse = house.id;
              render();
            },
          },
        },
        houseShield(house),
        h('span', { class: 'house-pick-name', text: house.name }),
      );
    return [
      h(
        'div',
        { class: 'draft-panel draft-setup panel' },
        h('h3', { text: 'Choose the house you will manage' }),
        h(
          'div',
          { class: 'house-picks', attrs: { role: 'group', 'aria-label': 'Your house' } },
          ...REALM_HOUSES.map(housePick),
        ),
        h(
          'ol',
          { class: 'draft-costs', attrs: { 'aria-label': 'What each level costs' } },
          ...TIERS.map((t, tier) =>
            h(
              'li',
              {},
              starsOf(tier),
              h('b', { text: t.name }),
              h('small', { text: points(tierCost(tier)) }),
            ),
          ),
        ),
      ),
      h(
        'p',
        { class: 'hint' },
        `All eight houses draft six knights each, taking turns in a snake order that reverses every round. You have ${BUDGET} points to spend, priced as above. Your forged knight, ${app.look.name}, is in the pool, and any house can draft them. Then fourteen league matchdays decide the realm's champions.`,
      ),
      ...(replacing
        ? [h('p', { class: 'hint', text: 'Starting a new season replaces the one you have finished.' })]
        : []),
      h(
        'div',
        { class: 'setup-actions' },
        button(`Start the draft as ${houseById(chosenHouse).name}`, start, 'btn-primary'),
      ),
    ];
  };

  // The clock -----------------------------------------------------------------------------------

  /** This round's houses in first-round seats, numbered by pick, so the snake shows as numbers reversing. */
  const orderRibbon = (draft: DraftState, fresh: boolean): HTMLElement => {
    const houses = draft.order.length;
    const made = draft.picks.length;
    const round = Math.min(Math.floor(made / houses), SQUAD_SIZE - 1);
    const forwards = round % 2 === 0;
    const slots = draft.order.map((id, seat) => {
      const pickNo = round * houses + (forwards ? seat : houses - 1 - seat);
      const house = houseById(id);
      const knightId = draft.picks[pickNo];
      const knight = knightId === undefined ? undefined : knightById(draft, knightId);
      const state = [
        knight ? ' is-done' : '',
        pickNo === made ? ' is-now' : '',
        id === draft.playerHouse ? ' is-you' : '',
        fresh && pickNo === made - 1 ? ' is-fresh' : '',
      ].join('');
      return h(
        'li',
        { class: `order-slot${state}` },
        h('span', { class: 'order-num', text: `Pick ${pickNo + 1}` }),
        houseShield(house),
        h('b', { text: id === draft.playerHouse ? 'You' : house.name }),
        h('small', { text: knight?.look.name ?? (pickNo === made ? 'On the clock' : '') }),
      );
    });
    return h(
      'ol',
      {
        class: 'draft-order',
        attrs: { style: `--n: ${houses}`, 'aria-label': `Round ${round + 1} pick order` },
      },
      ...slots,
    );
  };

  const latestPick = (draft: DraftState, fresh: boolean): HTMLElement => {
    const last = draft.picks.length - 1;
    const id = draft.picks[last];
    const house = houseForPick(draft.order, last);
    const knight = id === undefined ? undefined : knightById(draft, id);
    if (!knight || house === null) {
      return h('p', { class: 'latest-pick', text: 'No knights drafted yet.' });
    }
    const by = houseById(house);
    const who = house === draft.playerHouse ? 'You take' : `${by.name} take`;
    live.textContent = `Pick ${last + 1}: ${who} ${knight.look.name}, ${tierName(knight.tier)}.`;
    return h(
      'p',
      { class: `latest-pick${fresh ? ' is-fresh' : ''}` },
      houseShield(by),
      `Pick ${last + 1}: ${who}`,
      h('b', { text: knight.look.name }),
      h('span', { text: `${tierName(knight.tier)} · ${buildName(knight)}` }),
      knight.forged && youTag(),
    );
  };

  const clock = (season: SeasonState, view: DraftState, fresh: boolean): HTMLElement => {
    const made = view.picks.length;
    const round = Math.min(Math.floor(made / view.order.length), SQUAD_SIZE - 1);
    const onTheClock = houseOnTheClock(view);
    const yours = !revealing() && isPlayersPick(season);
    const status = yours
      ? `Your pick: number ${made + 1} of ${TOTAL_PICKS}`
      : `${houseById(onTheClock ?? '').name} are picking…`;
    const actions = revealing()
      ? [button('Skip to my pick', skip)]
      : [
          button('Auto-pick', () => {
            pick(autoDraft);
          }),
          button('Auto-pick the rest', autoRest),
        ];
    // The first action keeps focus as it changes from Auto-pick to Skip and back, so Enter can repeat.
    actions.forEach((b, i) => {
      b.dataset.focus = `action-${String(i)}`;
    });
    return h(
      'div',
      { class: 'draft-clock panel' },
      h('p', { class: 'ribbon', text: `Round ${round + 1} of ${SQUAD_SIZE}` }),
      h('h3', {
        class: `draft-status${yours ? ' is-yours' : ''}`,
        text: status,
        attrs: { tabindex: '-1' },
      }),
      latestPick(view, fresh),
      orderRibbon(view, fresh),
      h('p', {
        class: 'order-dir',
        text: round % 2 === 0 ? 'This round runs left to right →' : '← This round snakes back, right to left',
      }),
      h('div', { class: 'draft-actions' }, ...actions),
    );
  };

  // The pool ------------------------------------------------------------------------------------

  const cardBody = (knight: SquadKnight, colour: string): (HTMLElement | false)[] => [
    h('span', { class: 'cost' }, String(tierCost(knight.tier)), h('small', { text: 'pts' })),
    portrait(knight, colour, CARD_PORTRAIT),
    knight.forged && youTag(),
    h('b', { text: knight.look.name }),
    h('small', { class: 'tier' }, starsOf(knight.tier), tierName(knight.tier)),
    h('small', { text: buildName(knight) }),
  ];

  const poolCard = (
    season: SeasonState,
    view: DraftState,
    knight: SquadKnight,
    yours: boolean,
  ): HTMLElement => {
    const check = checkPick(view, view.playerHouse, knight.id);
    const why = yours && !check.ok ? PICK_PROBLEMS[check.problem] : null;
    const card = h(
      'button',
      {
        class: `draft-card${knight.forged ? ' is-forged' : ''}${why ? ' is-blocked' : ''}`,
        attrs: { type: 'button', 'aria-disabled': String(!check.ok), 'data-focus': `card-${knight.id}` },
        on: {
          click: () => {
            if (yours && checkPick(season.draft, season.draft.playerHouse, knight.id).ok)
              pick((s) => draftKnight(s, knight.id));
          },
        },
      },
      ...cardBody(knight, FREE_AGENT_COLOUR),
      why && h('small', { class: 'why', text: why }),
    );
    if (!check.ok) card.title = PICK_PROBLEMS[check.problem];
    return card;
  };

  const filterRows = (): HTMLElement =>
    h(
      'div',
      { class: 'draft-filters' },
      choice(
        'Level',
        [{ value: -1, label: 'All' }, ...TIERS.map((t, tier) => ({ value: tier, label: t.name }))],
        filters.tier,
        (tier) => {
          filters.tier = tier;
          render();
        },
      ),
      choice(
        'Build',
        [{ value: -1, label: 'All' }, ...BUILDS.map((b, build) => ({ value: build, label: b.name }))],
        filters.build,
        (build) => {
          filters.build = build;
          render();
        },
      ),
      choice<Sort>(
        'Sort',
        [
          { value: 'best', label: 'Best first' },
          { value: 'cheapest', label: 'Cheapest first' },
        ],
        filters.sort,
        (sort) => {
          filters.sort = sort;
          render();
        },
      ),
      choice<Show>(
        'Show',
        [
          { value: 'all', label: 'Everyone' },
          { value: 'pickable', label: 'Pickable now' },
        ],
        filters.show,
        (show) => {
          filters.show = show;
          render();
        },
      ),
    );

  const poolPanel = (season: SeasonState, view: DraftState): HTMLElement => {
    const yours = !revealing() && isPlayersPick(season);
    const taken = new Set(view.picks);
    const left = [...poolOf(view).values()].filter((k) => !taken.has(k.id));
    const shownKnights = left
      .filter((k) => filters.tier === -1 || k.tier === filters.tier)
      .filter((k) => filters.build === -1 || k.look.build === filters.build)
      .filter((k) => filters.show === 'all' || checkPick(view, view.playerHouse, k.id).ok)
      // Your knight leads, as the plan promises; then by level, pool order breaking ties.
      .sort(
        (a, b) =>
          Number(b.forged) - Number(a.forged) ||
          (filters.sort === 'best' ? b.tier - a.tier : a.tier - b.tier),
      );
    const count =
      shownKnights.length === left.length
        ? `${left.length} knights left`
        : `${shownKnights.length} of ${left.length} knights left`;
    return h(
      'section',
      { class: 'draft-panel draft-pool panel', attrs: { 'aria-label': 'The pool' } },
      h('h3', {}, 'The pool', h('span', { class: 'draft-count', text: count })),
      filterRows(),
      shownKnights.length
        ? h(
            'div',
            { class: `pool-cards${yours ? '' : ' is-waiting'}` },
            ...shownKnights.map((k) => poolCard(season, view, k, yours)),
          )
        : h('p', { class: 'hint', text: 'No knights left match these filters.' }),
    );
  };

  // Squads --------------------------------------------------------------------------------------

  const squadSlots = (view: DraftState): HTMLElement => {
    const house = houseById(view.playerHouse);
    const squad = squadOf(view, view.playerHouse);
    return h(
      'ol',
      { class: 'draft-slots' },
      ...Array.from({ length: SQUAD_SIZE }, (_, i) => {
        const knight = squad[i];
        if (!knight) return h('li', { class: 'draft-slot is-empty', text: `Pick ${i + 1} to come` });
        return h(
          'li',
          { class: 'draft-slot' },
          portrait(knight, house.colour, SLOT_PORTRAIT),
          h(
            'div',
            {},
            h('b', { text: knight.look.name }),
            h('small', { text: `${tierName(knight.tier)} · ${buildName(knight)}` }),
          ),
          h('span', { class: 'slot-cost', text: String(tierCost(knight.tier)), attrs: { title: 'Cost' } }),
        );
      }),
    );
  };

  const budgetMeter = (view: DraftState): HTMLElement => {
    const squad = squadOf(view, view.playerHouse);
    const spent = squad.reduce((sum, k) => sum + tierCost(k.tier), 0);
    const left = BUDGET - spent;
    const picksLeft = SQUAD_SIZE - squad.length;
    return h(
      'div',
      { class: 'budget' },
      h('p', {}, 'Spent ', h('b', { text: `${spent} of ${BUDGET}` }), ' points'),
      h(
        'div',
        {
          class: 'statbar',
          attrs: {
            role: 'meter',
            'aria-label': 'Budget spent',
            'aria-valuemin': '0',
            'aria-valuemax': String(BUDGET),
            'aria-valuenow': String(spent),
          },
        },
        h('i', { style: { width: `${(spent / BUDGET) * 100}%` } }),
      ),
      h('p', {
        text:
          picksLeft > 0
            ? `${points(left)} left for ${picksLeft} ${picksLeft === 1 ? 'pick' : 'picks'}: ${perPick(left, picksLeft)}`
            : `${points(left)} to spare`,
      }),
    );
  };

  const squadPanel = (view: DraftState): HTMLElement => {
    const house = houseById(view.playerHouse);
    return h(
      'section',
      { class: 'draft-panel draft-squad panel', attrs: { 'aria-label': 'Your squad' } },
      h(
        'h3',
        {},
        h(
          'span',
          { class: 'house-block', style: { background: blockColour(house) } },
          crest(house),
          house.name,
        ),
        'Your squad',
      ),
      budgetMeter(view),
      squadSlots(view),
    );
  };

  const rivalHouse = (view: DraftState, id: string): HTMLElement => {
    const house = houseById(id);
    const squad = squadOf(view, id);
    const spent = squad.reduce((sum, k) => sum + tierCost(k.tier), 0);
    const details = h(
      'details',
      {
        class: 'rival',
        on: {
          toggle: () => {
            if (details.open) openRivals.add(id);
            else openRivals.delete(id);
          },
        },
      },
      h(
        'summary',
        { attrs: { 'data-focus': `rival-${id}` } },
        houseShield(house),
        h('span', { class: 'rival-name', text: house.name }),
        squad.some((k) => k.forged) && youTag(),
        h('span', {
          class: 'rival-count',
          text: `${squad.length}/${SQUAD_SIZE} · ${BUDGET - spent} pts left`,
        }),
      ),
      h(
        'ul',
        {},
        ...(squad.length
          ? squad.map((k) =>
              h(
                'li',
                {},
                h('b', { text: k.look.name }),
                starsOf(k.tier),
                `${tierName(k.tier)} · ${buildName(k)}`,
                k.forged && youTag(),
              ),
            )
          : [h('li', { class: 'is-empty', text: 'No picks yet' })]),
      ),
    );
    details.open = openRivals.has(id);
    return details;
  };

  const rivalsPanel = (view: DraftState, wide: boolean): HTMLElement =>
    h(
      'section',
      {
        class: `draft-panel draft-rivals panel${wide ? ' is-wide' : ''}`,
        attrs: { 'aria-label': 'Rival houses' },
      },
      h('h3', { text: 'Rival houses' }),
      h(
        'div',
        { class: 'rival-list' },
        ...view.order.filter((id) => id !== view.playerHouse).map((id) => rivalHouse(view, id)),
      ),
    );

  // Draft complete ------------------------------------------------------------------------------

  const forgedNote = (draft: DraftState): string => {
    const at = draft.picks.indexOf(FORGED_ID);
    const name = draft.forged.name;
    if (at < 0) return `No house drafted your knight, ${name}, this season.`;
    const house = houseForPick(draft.order, at);
    if (house === draft.playerHouse) return `Your own knight, ${name}, is in your squad.`;
    return `Your knight, ${name}, was drafted by ${houseById(house ?? '').name}.`;
  };

  const complete = (draft: DraftState): HTMLElement[] => {
    title.textContent = 'Draft complete';
    const house = houseById(draft.playerHouse);
    const squad = squadOf(draft, draft.playerHouse);
    const spent = squad.reduce((sum, k) => sum + tierCost(k.tier), 0);
    for (const id of draft.order) openRivals.add(id);
    return [
      h(
        'div',
        { class: 'draft-done panel' },
        h('p', { class: 'ribbon', text: 'Draft complete' }),
        h(
          'h3',
          { class: 'draft-status' },
          h(
            'span',
            { class: 'house-block', style: { background: blockColour(house) } },
            crest(house),
            house.name,
          ),
        ),
        h('p', {
          class: 'draft-done-note',
          text: `Your six knights cost ${spent} of your ${BUDGET} points. ${forgedNote(draft)}`,
        }),
        h(
          'div',
          { class: 'cards' },
          ...squad.map((k) =>
            h('div', { class: `draft-card${k.forged ? ' is-forged' : ''}` }, ...cardBody(k, house.colour)),
          ),
        ),
        h(
          'div',
          { class: 'draft-actions' },
          button(
            'To the season',
            () => {
              app.go('manager');
            },
            'btn-primary',
          ),
        ),
      ),
      rivalsPanel(draft, true),
    ];
  };

  // Render --------------------------------------------------------------------------------------

  const board = (season: SeasonState, fresh: boolean): HTMLElement[] => {
    title.textContent = 'The Draft';
    const view = viewOf(season.draft, shown);
    return [
      clock(season, view, fresh),
      h('div', { class: 'draft-board' }, poolPanel(season, view), squadPanel(view), rivalsPanel(view, false)),
    ];
  };

  /** Rebuilds the screen, keeping keyboard focus on the same control when it survives the rebuild. */
  function render(fresh = false): void {
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement ? active.dataset.focus : undefined;
    const hadFocus = active instanceof HTMLElement && body.contains(active);
    const season = app.season;
    const finished = season?.league ? isFinished(season.league) : false;
    if (!season || finished) body.replaceChildren(...setup(finished));
    else if (season.league && !revealing()) body.replaceChildren(...complete(season.draft));
    else body.replaceChildren(...board(season, fresh));
    if (!hadFocus) return;
    const again = focusKey ? body.querySelector<HTMLElement>(`[data-focus="${focusKey}"]`) : null;
    (again ?? body.querySelector<HTMLElement>('.draft-status'))?.focus({ preventScroll: true });
  }

  root.append(
    h(
      'section',
      { class: 'draft-screen' },
      h(
        'header',
        { class: 'screen-head' },
        button('← Home', () => {
          app.go('home');
        }),
        title,
      ),
      body,
      live,
    ),
  );
  render();
  return () => {
    window.clearTimeout(timer);
  };
}
