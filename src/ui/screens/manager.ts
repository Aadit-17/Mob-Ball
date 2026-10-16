import './manager.css';
import type { AppContext } from '../../app';
import { skillFor } from '../../ai/skills';
import { DEFAULT_TACTICS, type Tactics } from '../../ai/tactics';
import { BUILDS } from '../../game/constants';
import { ROLES_BY_SIZE } from '../../game/formation';
import { option } from '../../knight/catalog';
import { managerSession, settleSeason, skipPlayerMatch, standing } from '../../modes/manager';
import { squadOf } from '../../modes/manager/draft';
import {
  champion,
  currentMatchday,
  fixtures,
  isFinished,
  MATCHDAYS,
  playerFixture,
  table,
  type FormResult,
  type LeagueFixture,
  type LeagueState,
} from '../../modes/manager/league';
import {
  knightStamina,
  otherFixtures,
  planMatch,
  playerLineup,
  setPlan,
  type SeasonState,
} from '../../modes/manager/season';
import { CHARGE, FRESH, HOLD, STAMINA_MAX } from '../../modes/manager/stamina';
import { SQUAD_SIZE, STARTERS, type SquadKnight } from '../../modes/manager/types';
import { MatchRunner } from '../../modes/runner';
import { houseById, type House } from '../../setup/houses';
import { choice } from '../choice';
import { button, h } from '../dom';
import { banner, blockColour, crest, icon } from '../heraldry';
import { lozengeBurst, reducedMotion, throughTheGates } from '../motion';
import { drawPortrait } from '../portrait';
import { ROLE_NAMES, stars } from './setup';

/** Steps of a headless match per frame: about 8 ms, so the page stays smooth while the others play. */
const STEPS_PER_FRAME = 1200;
/** Each result lands at least this far apart, slow enough to read one before the next arrives. */
const RESULT_PACE_MS = 700;

const ROLES = ROLES_BY_SIZE[4];

const PRESETS = [
  { value: 'charge', label: 'Charge!', tactics: CHARGE },
  { value: 'hold', label: 'Hold!', tactics: HOLD },
  { value: 'balanced', label: 'Balanced', tactics: DEFAULT_TACTICS },
] as const;

const FORM_WORDS: Readonly<Record<FormResult, string>> = { W: 'won', D: 'drew', L: 'lost' };

const TABLE_COLUMNS = [
  ['P', 'Played'],
  ['W', 'Won'],
  ['D', 'Drawn'],
  ['L', 'Lost'],
  ['GF', 'Goals for'],
  ['GA', 'Goals against'],
  ['GD', 'Goal difference'],
  ['Pts', 'Points'],
] as const;

const ordinal = (n: number): string => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
};

const sameTactics = (a: Tactics, b: Tactics): boolean => a.press === b.press && a.shooting === b.shooting;

const pts = (n: number): string => `${n} ${n === 1 ? 'point' : 'points'}`;

/** A house shield: a gold rim around the house colour with its charge. */
const shield = (house: House): HTMLElement =>
  h('span', { class: 'tie-shield', attrs: { style: `--c: ${house.colour}` } }, crest(house));

const houseBlock = (house: House): HTMLElement =>
  h('span', { class: 'house-block', style: { background: blockColour(house) } }, crest(house), house.name);

function formGuide(form: readonly FormResult[]): HTMLElement {
  const label = form.length
    ? `Last ${form.length}, oldest first: ${form.map((r) => FORM_WORDS[r]).join(', ')}`
    : 'No matches yet';
  return h(
    'span',
    { class: 'form-guide', attrs: { role: 'img', 'aria-label': label } },
    ...(form.length
      ? form.map((r) => h('i', { class: `form-${r.toLowerCase()}`, text: r }))
      : [h('i', { class: 'form-none', text: '–' })]),
  );
}

/** A stamina bar with the FRESH mark on it; below the mark the knight is slower. */
function staminaMeter(stamina: number, resting: boolean): HTMLElement {
  const value = Math.round(stamina);
  const tired = value < FRESH;
  const share = (n: number): string => `${(n / STAMINA_MAX) * 100}%`;
  const label = tired ? `${resting ? 'Resting' : 'Tired'} · ${value}` : `Stamina ${value}`;
  return h(
    'div',
    { class: `stamina${tired ? ' is-tired' : ''}` },
    h(
      'div',
      {
        class: 'stamina-bar',
        attrs: {
          role: 'meter',
          'aria-label': 'Stamina',
          'aria-valuemin': '0',
          'aria-valuemax': String(STAMINA_MAX),
          'aria-valuenow': String(value),
          'aria-valuetext': `${value}${tired ? ', tired' : ''}`,
          style: `--v: ${share(value)}; --fresh: ${share(FRESH)}`,
        },
      },
      h('i'),
    ),
    h('small', { class: 'stamina-label', text: label, attrs: { 'aria-hidden': 'true' } }),
  );
}

function moveMark(move: number | undefined): HTMLElement {
  if (!move) return h('span', { class: 'move', text: '–', attrs: { 'aria-label': 'No change' } });
  const up = move > 0;
  return h('span', {
    class: `move ${up ? 'is-up' : 'is-down'}`,
    text: `${up ? '▲' : '▼'}${Math.abs(move)}`,
    attrs: { 'aria-label': `${up ? 'Up' : 'Down'} ${Math.abs(move)}` },
  });
}

interface TableOptions {
  readonly title: string;
  /** Places gained (positive) or lost since the matchday began, by house. */
  readonly moves?: ReadonlyMap<string, number>;
  /** Houses whose result just landed. */
  readonly fresh?: ReadonlySet<string>;
}

/** P W D L GF GA GD Pts and form, the player's row in gold. Scrolls sideways inside its box on a phone. */
function leagueTable(league: LeagueState, options: TableOptions): HTMLElement {
  const rows = table(league);
  const started = (rows[0]?.played ?? 0) > 0;
  const col = (text: string, title: string): HTMLElement =>
    h('th', { attrs: { scope: 'col' } }, h('abbr', { text, attrs: { title } }));
  const body = rows.map((row, i) => {
    const house = houseById(row.house);
    const you = row.house === league.playerHouse;
    const top = started && i === 0;
    const position = top
      ? h(
          'span',
          { class: 'pos-top', attrs: { title: 'Top of the table' } },
          icon('cup'),
          h('span', { class: 'visually-hidden', text: '1st, top of the table' }),
        )
      : String(i + 1);
    const goals = [row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst];
    const gd = row.goalDifference;
    return h(
      'tr',
      {
        class: [you && 'is-you', top && 'is-top', options.fresh?.has(row.house) && 'is-fresh']
          .filter(Boolean)
          .join(' '),
      },
      h('td', { class: 'col-pos' }, position),
      options.moves && h('td', { class: 'col-move' }, moveMark(options.moves.get(row.house))),
      h(
        'th',
        { class: 'col-house', attrs: { scope: 'row' } },
        h(
          'span',
          { class: 'table-house' },
          shield(house),
          h('span', { class: 'side-name', text: house.name }),
          you && h('small', { class: 'you-tag', text: 'You' }),
        ),
      ),
      ...goals.map((n) => h('td', { text: String(n) })),
      h('td', { text: gd > 0 ? `+${gd}` : String(gd) }),
      h('td', { class: 'col-pts', text: String(row.points) }),
      h('td', { class: 'col-form' }, formGuide(row.form)),
    );
  });
  return h(
    'section',
    { class: 'league-table panel' },
    h('h3', { class: 'panel-title', text: options.title }),
    h(
      'div',
      { class: 'table-scroll', attrs: { role: 'region', 'aria-label': options.title, tabindex: '0' } },
      h(
        'table',
        {},
        h('caption', { class: 'visually-hidden', text: options.title }),
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h(
              'th',
              { class: 'col-pos', attrs: { scope: 'col' } },
              h('abbr', { text: '#', attrs: { title: 'Position' } }),
            ),
            options.moves &&
              h(
                'th',
                { class: 'col-move', attrs: { scope: 'col' } },
                h('span', { class: 'visually-hidden', text: 'Change' }),
              ),
            h('th', { class: 'col-house', attrs: { scope: 'col' }, text: 'House' }),
            ...TABLE_COLUMNS.map(([text, title]) => col(text, title)),
            h('th', { class: 'col-form', attrs: { scope: 'col' }, text: 'Form' }),
          ),
        ),
        h('tbody', {}, ...body),
      ),
    ),
  );
}

/** The league as it stood before `matchday`: its results taken back out. */
const withoutMatchday = (league: LeagueState, matchday: number): LeagueState => ({
  ...league,
  results: league.results.map((day, d) => (d === matchday ? day.map(() => null) : day)),
});

const places = (league: LeagueState): Map<string, number> =>
  new Map(table(league).map((row, i) => [row.house, i]));

function movesSince(before: ReadonlyMap<string, number>, league: LeagueState): Map<string, number> {
  const now = places(league);
  return new Map([...now].map(([house, place]) => [house, (before.get(house) ?? place) - place]));
}

/** One fixture as a cup-style tie card, home side on top; empty goal boxes until it is played. */
function fixtureTie(fixture: LeagueFixture, playerHouse: string, fresh: boolean): HTMLElement {
  const { score } = fixture;
  const side = (id: string, goals: number | null, against: number | null): HTMLElement => {
    const house = houseById(id);
    const result =
      goals === null || against === null
        ? ''
        : goals > against
          ? ' is-won'
          : goals < against
            ? ' is-lost'
            : '';
    return h(
      'div',
      { class: `tie-side${result}${id === playerHouse ? ' is-you' : ''}` },
      shield(house),
      h('span', { class: 'side-name', text: house.name }),
      id === playerHouse && h('small', { class: 'you-tag', text: 'You' }),
      h('span', { class: 'tie-goals', text: goals === null ? '' : String(goals) }),
    );
  };
  const names = `${houseById(fixture.home).name} v ${houseById(fixture.away).name}`;
  return h(
    'article',
    {
      class: `tie${score ? '' : ' is-pending'}${fresh ? ' is-fresh' : ''}`,
      attrs: { 'aria-label': score ? `${names}, ${score.join('–')}` : `${names}, being played` },
    },
    side(fixture.home, score?.[0] ?? null, score?.[1] ?? null),
    side(fixture.away, score?.[1] ?? null, score?.[0] ?? null),
  );
}

function playerResult(fixture: LeagueFixture, playerHouse: string): HTMLElement {
  const [home, away] = fixture.score ?? [0, 0];
  const playerHome = fixture.home === playerHouse;
  const [us, them] = playerHome ? [home, away] : [away, home];
  const verdict = us > them ? 'Victory!' : us < them ? 'Defeat' : 'Draw';
  return h(
    'div',
    { class: 'md-mine' },
    h('h2', { class: 'verdict', text: verdict }),
    h(
      'p',
      { class: 'final md-final' },
      houseBlock(houseById(fixture.home)),
      h('span', { class: 'final-score', text: `${home} – ${away}` }),
      houseBlock(houseById(fixture.away)),
    ),
  );
}

/** A knight's card on the team sheet: a button, so tapping two cards swaps their places. */
function squadCard(
  knight: SquadKnight,
  stamina: number,
  house: House,
  slot: number,
  pressed: boolean,
  onTap: () => void,
): HTMLButtonElement {
  const bench = slot >= STARTERS;
  const slotName = bench ? 'Bench' : ROLE_NAMES[ROLES[slot] ?? 'mid'];
  const build = option(BUILDS, knight.look.build).name;
  const level = skillFor(knight.tier).name;
  const value = Math.round(stamina);
  const canvas = h('canvas', { attrs: { 'aria-hidden': 'true' } });
  const card = h(
    'button',
    {
      class: `squad-card${bench ? ' is-bench' : ''}${knight.forged ? ' is-forged' : ''}`,
      attrs: {
        type: 'button',
        'data-slot': String(slot),
        'aria-pressed': String(pressed),
        'aria-label': `${knight.look.name}, ${slotName}. ${level}, ${build}${knight.forged ? ', your knight' : ''}. Stamina ${value}${value < FRESH ? ', tired' : ''}.`,
      },
      on: { click: onTap },
    },
    h('span', { class: 'squad-slot', text: slotName }),
    canvas,
    h('b', { text: knight.look.name }),
    h(
      'small',
      { class: 'tier' },
      h('span', { class: 'stars', text: stars(knight.tier), attrs: { 'aria-hidden': 'true' } }),
      level,
    ),
    h('small', { text: knight.forged ? `${build} · Your knight` : build }),
    staminaMeter(stamina, bench),
  );
  drawPortrait(canvas, knight.look, house.colour, { width: 110, height: 128 });
  return card;
}

const faceSide = (house: House, sway: number, you: boolean): HTMLElement =>
  h(
    'div',
    { class: 'face-side' },
    banner(house, sway),
    h('b', { text: house.name }),
    you && h('small', { class: 'you-tag', text: 'You' }),
  );

export function mountManager(root: HTMLElement, app: AppContext): () => void {
  const body = h('div', { class: 'manager-body' });
  const fx = h('div', { class: 'fx cup-fx', attrs: { 'aria-hidden': 'true' } });
  const timers: number[] = [];
  let frame = 0;

  const later = (ms: number, run: () => void): void => {
    timers.push(window.setTimeout(run, ms));
  };

  const stop = (): void => {
    cancelAnimationFrame(frame);
    for (const timer of timers) window.clearTimeout(timer);
    timers.length = 0;
  };

  const show = (...children: HTMLElement[]): void => {
    body.replaceChildren(...children);
  };

  const watch = (): void => {
    const session = managerSession(app);
    if (!session) return;
    throughTheGates(() => {
      app.playMatch(session);
    });
  };

  const noSeason = (season: SeasonState | null): HTMLElement =>
    h(
      'div',
      { class: 'cup-verdict panel' },
      h('p', { class: 'ribbon', text: season ? 'Draft under way' : 'No season' }),
      h('p', {
        class: 'cup-level',
        text: season
          ? 'Finish the draft to start the league.'
          : 'Pick a house and draft six knights to start a season.',
      }),
      h(
        'div',
        { class: 'cup-actions' },
        button(
          season ? 'Back to the draft' : 'Start a season',
          () => {
            app.go('draft');
          },
          'btn-primary',
        ),
      ),
    );

  /** The player's four starters with their stamina, and a nudge when one of them is tired. */
  const teamSheet = (season: SeasonState): HTMLElement[] => {
    const house = season.draft.playerHouse;
    const starters = playerLineup(season).starters;
    const tired = starters.filter((s) => knightStamina(season, house, s.knight.id) < FRESH);
    const sheet = h(
      'ol',
      { class: 'md-sheet', attrs: { 'aria-label': 'Starting four' } },
      ...starters.map((s) =>
        h(
          'li',
          {},
          h('small', { text: ROLE_NAMES[s.role] }),
          h('b', { text: s.knight.look.name }),
          staminaMeter(knightStamina(season, house, s.knight.id), false),
        ),
      ),
    );
    const names = tired.map((s) => s.knight.look.name);
    const who =
      tired.length === STARTERS
        ? 'All four starters are'
        : `${names.slice(0, -1).join(', ')}${names.length > 1 ? ' and ' : ''}${names.at(-1) ?? ''} ${names.length === 1 ? 'is' : 'are'}`;
    const note =
      tired.length > 0 &&
      h('p', {
        class: 'md-warn',
        text: `${who} tired and slower. A match on the bench brings stamina back.`,
      });
    return [sheet, ...(note ? [note] : [])];
  };

  function hub(season: SeasonState, league: LeagueState): void {
    const fixture = playerFixture(league);
    if (!fixture) return;
    const playerHouse = season.draft.playerHouse;
    const playerHome = fixture.home === playerHouse;
    const rivalId = playerHome ? fixture.away : fixture.home;
    const rival = houseById(rivalId);
    const rows = table(league);
    const rivalPlace = rows.findIndex((r) => r.house === rivalId);
    const rivalRow = rows[rivalPlace];
    const played = (rows.find((r) => r.house === playerHouse)?.played ?? 0) > 0;
    const tactics = season.plan?.tactics ?? DEFAULT_TACTICS;

    const next = h(
      'div',
      { class: 'cup-next panel md-next' },
      h('p', { class: 'ribbon', text: `Matchday ${currentMatchday(league) + 1} of ${MATCHDAYS}` }),
      h(
        'div',
        { class: 'face-off' },
        faceSide(houseById(fixture.home), 0, playerHome),
        h('span', { class: 'vs', text: 'v' }),
        faceSide(houseById(fixture.away), -1.3, !playerHome),
      ),
      h('p', {
        class: 'cup-level',
        text:
          rivalRow && played
            ? `${playerHome ? 'At home to' : 'Away at'} ${rival.name}, ${ordinal(rivalPlace + 1)} on ${pts(rivalRow.points)}.`
            : `${playerHome ? 'At home to' : 'Away at'} ${rival.name} to open the season.`,
      }),
      rivalRow &&
        played &&
        h('p', { class: 'md-form' }, h('span', { text: `${rival.name} form` }), formGuide(rivalRow.form)),
      h(
        'div',
        { class: 'cup-actions' },
        button('Watch the match', watch, 'btn-primary'),
        button('Skip to the result', () => {
          skipPlayerMatch(app);
          render();
        }),
      ),
    );

    const house = houseById(playerHouse);
    const mine = h(
      'section',
      { class: 'md-house panel' },
      h('h3', { class: 'md-house-head' }, houseBlock(house)),
      h('p', { class: 'md-standing', text: played ? standing(season) : 'Matchday 1: all to play for' }),
      ...teamSheet(season),
      h('p', {
        class: 'md-tactics',
        text: `Press ${tactics.press} · Shooting ${tactics.shooting}`,
      }),
      button('Squad & tactics', () => {
        squad(season);
      }),
    );

    show(h('div', { class: 'md-hub' }, next, mine), leagueTable(league, { title: 'League table' }));
  }

  function squad(season: SeasonState): void {
    const playerHouse = season.draft.playerHouse;
    const house = houseById(playerHouse);
    const knights = new Map(squadOf(season.draft, playerHouse).map((k) => [k.id, k]));
    const lineup = playerLineup(season);
    // Slots 0–3 are keeper, defender, midfield and forward; 4–5 the bench. Swaps keep four different starters.
    const order = [...lineup.starters.map((s) => s.knight.id), ...lineup.bench.map((k) => k.id)];
    let tactics = season.plan?.tactics ?? DEFAULT_TACTICS;
    let picked: number | null = null;

    const sheet = h('div', { class: 'squad-sheet' });
    const levers = h('div', { class: 'squad-levers' });
    const live = h('p', { class: 'visually-hidden', attrs: { 'aria-live': 'polite' } });
    const nameAt = (slot: number): string => knights.get(order[slot] ?? '')?.look.name ?? '';
    const slotName = (slot: number): string =>
      slot < STARTERS ? ROLE_NAMES[ROLES[slot] ?? 'mid'] : 'on the bench';

    const tap = (slot: number): void => {
      if (picked === null) {
        picked = slot;
        live.textContent = `${nameAt(slot)} picked. Choose a knight to swap with.`;
      } else if (picked === slot) {
        picked = null;
        live.textContent = 'Swap cancelled.';
      } else {
        const from = picked;
        [order[from], order[slot]] = [order[slot] ?? '', order[from] ?? ''];
        picked = null;
        live.textContent = `${nameAt(slot)} now ${slotName(slot)}, ${nameAt(from)} ${slotName(from)}.`;
      }
      drawSheet(slot);
    };

    const card = (slot: number): HTMLElement | null => {
      const knight = knights.get(order[slot] ?? '');
      if (!knight) return null;
      const stamina = knightStamina(season, playerHouse, knight.id);
      return squadCard(knight, stamina, house, slot, picked === slot, () => {
        tap(slot);
      });
    };

    function drawSheet(focus: number | null): void {
      const slots = Array.from({ length: SQUAD_SIZE }, (_, i) => i);
      sheet.replaceChildren(
        h(
          'section',
          { class: 'squad-group' },
          h('h3', { class: 'panel-title', text: 'Starting four' }),
          h('div', { class: 'squad-row is-starters' }, ...slots.slice(0, STARTERS).map(card)),
        ),
        h(
          'section',
          { class: 'squad-group is-bench' },
          h('h3', { class: 'panel-title', text: 'Bench' }),
          h('div', { class: 'squad-row is-bench' }, ...slots.slice(STARTERS).map(card)),
        ),
      );
      if (focus !== null) sheet.querySelector<HTMLElement>(`[data-slot="${focus}"]`)?.focus();
    }

    const lever = <K extends keyof Tactics>(
      key: K,
      label: string,
      options: readonly { value: Tactics[K]; label: string; note: string }[],
    ): HTMLElement =>
      h(
        'div',
        { class: 'lever' },
        choice(label, options, tactics[key], (value) => {
          tactics = { ...tactics, [key]: value };
          drawLevers();
        }),
        h('p', { class: 'lever-note', text: options.find((o) => o.value === tactics[key])?.note ?? '' }),
      );

    function drawLevers(): void {
      const preset = PRESETS.find((p) => sameTactics(p.tactics, tactics))?.value ?? '';
      levers.replaceChildren(
        h('h3', { class: 'panel-title', text: 'Tactics' }),
        lever('press', 'Press', [
          {
            value: 'low',
            label: 'Low',
            note: 'Sit off in their half, then swarm in ours: concede fewer, score fewer.',
          },
          { value: 'mid', label: 'Mid', note: 'The nearest knight goes to the ball.' },
          { value: 'high', label: 'High', note: 'Two knights hunt the ball once it’s in their half.' },
        ]),
        lever('shooting', 'Shooting', [
          {
            value: 'patient',
            label: 'Patient',
            note: 'Work it closer before shooting: fewer, better shots.',
          },
          { value: 'normal', label: 'Normal', note: 'Shoot when a good chance opens up.' },
          { value: 'early', label: 'Early', note: 'Shoot on sight: more shots from further out.' },
        ]),
        h(
          'div',
          { class: 'lever' },
          choice<string>(
            'Presets',
            PRESETS.map((p) => ({ value: p.value, label: p.label })),
            preset,
            (value) => {
              tactics = PRESETS.find((p) => p.value === value)?.tactics ?? tactics;
              drawLevers();
            },
          ),
          h('p', {
            class: 'lever-note',
            text: 'Charge! presses high and shoots on sight, Hold! sits off and waits. Both are a tap away in the dugout while you watch.',
          }),
        ),
      );
    }

    const save = (): void => {
      const current = app.season;
      if (!current) return;
      app.setSeason(setPlan(current, { starters: order.slice(0, STARTERS), tactics }));
      render();
    };

    show(
      h(
        'div',
        { class: 'squad-panel panel' },
        h('p', { class: 'ribbon', text: 'Squad & tactics' }),
        h(
          'p',
          { class: 'hint squad-hint' },
          'Tap a knight, then another, to swap them: between roles, or in and out of the side. Tired knights are slower; a match on the bench brings them back.',
        ),
        sheet,
        live,
      ),
      h('section', { class: 'squad-tactics panel' }, levers),
      h(
        'div',
        { class: 'cup-actions squad-actions' },
        button('Back without saving', render),
        button('Save team sheet', save, 'btn-primary'),
      ),
    );
    drawSheet(null);
    drawLevers();
  }

  /** The matchday's other fixtures, played headless one after another, each saved the moment it lands. */
  function results(season: SeasonState, league: LeagueState): void {
    const matchday = currentMatchday(league);
    const playerHouse = season.draft.playerHouse;
    const mine = playerFixture(league, matchday);
    const before = places(withoutMatchday(league, matchday));
    const ties = h('div', { class: 'md-ties' });
    const standings = h('div');
    const status = h('p', { class: 'md-status', attrs: { role: 'status' } });
    const actions = h('div', { class: 'cup-actions' });

    const refresh = (fresh: LeagueFixture | null): void => {
      const now = app.season?.league;
      if (!now) return;
      const others = fixtures(now, matchday).filter((f) => f.index !== mine?.index);
      ties.replaceChildren(...others.map((f) => fixtureTie(f, playerHouse, f.index === fresh?.index)));
      const pending = others.filter((f) => !f.score).length;
      status.textContent = pending
        ? `Results coming in from across the realm: ${others.length - pending} of ${others.length}`
        : 'All results are in.';
      status.classList.toggle('is-waiting', pending > 0);
      standings.replaceChildren(
        leagueTable(now, {
          title: 'League table',
          moves: movesSince(before, now),
          fresh: new Set(fresh ? [fresh.home, fresh.away] : []),
        }),
      );
    };

    const finish = (): void => {
      const done = app.season?.league ? isFinished(app.season.league) : false;
      const next = button(
        done ? 'See the final table' : `On to matchday ${matchday + 2}`,
        render,
        'btn-primary',
      );
      actions.replaceChildren(next);
      next.focus({ preventScroll: true });
    };

    const playNext = (): void => {
      const current = app.season;
      const fixture = current && otherFixtures(current)[0];
      if (!current || !fixture) {
        finish();
        return;
      }
      const plan = planMatch(current, fixture);
      const runner = new MatchRunner(plan.config());
      const started = performance.now();
      const step = (): void => {
        runner.advance(STEPS_PER_FRAME);
        if (!runner.ended) {
          frame = requestAnimationFrame(step);
          return;
        }
        const wait = reducedMotion() ? 0 : Math.max(0, RESULT_PACE_MS - (performance.now() - started));
        later(wait, () => {
          // Always finish onto the latest season: each result before this one has changed it.
          const latest = app.season;
          if (!latest) return;
          const [left, right] = runner.state.score;
          app.setSeason(plan.finish(latest, { score: [left, right], steps: runner.step, timeline: [] }));
          refresh(fixture);
          playNext();
        });
      };
      frame = requestAnimationFrame(step);
    };

    show(
      h(
        'div',
        { class: 'cup-next panel md-results' },
        h('p', { class: 'ribbon', text: `Matchday ${matchday + 1} results` }),
        mine && playerResult(mine, playerHouse),
        h('h3', { class: 'panel-title', text: 'Across the realm' }),
        ties,
        status,
        actions,
      ),
      standings,
    );
    refresh(null);
    playNext();
  }

  function seasonEnd(season: SeasonState, league: LeagueState): void {
    settleSeason(app);
    const playerHouse = season.draft.playerHouse;
    const house = houseById(playerHouse);
    const rows = table(league);
    const place = rows.findIndex((r) => r.house === playerHouse);
    const [first, second] = rows;
    const mine = rows[place];
    const won = champion(league) === playerHouse;
    const actions = h(
      'div',
      { class: 'cup-actions' },
      button(
        'Back to the hall',
        () => {
          app.go('home');
        },
        'btn-primary',
      ),
      button('Start a new season', () => {
        app.setSeason(null);
        app.go('draft');
      }),
    );

    if (won && first && second) {
      const wins = app.honours.leagueWins;
      const gap = first.points - second.points;
      show(
        h(
          'div',
          { class: 'cup-champion panel' },
          h('p', { class: 'ribbon', text: 'Champions' }),
          h(
            'div',
            { class: 'champion-stage' },
            h('span', { class: 'champion-cup' }, icon('cup')),
            h('div', { class: 'md-crest', attrs: { style: `--c: ${house.colour}` } }, crest(house)),
            h('span', { class: 'champion-cup' }, icon('cup')),
          ),
          h('h2', {
            class: 'metal cup-title',
            text: 'Realm champions',
            attrs: { 'data-text': 'Realm champions' },
          }),
          h('p', {
            class: 'cup-level',
            text:
              gap > 0
                ? `House ${house.name} top the table on ${pts(first.points)}, ${gap} clear of ${houseById(second.house).name}.`
                : `House ${house.name} top the table on ${pts(first.points)}, ahead of ${houseById(second.house).name} on the tiebreak.`,
          }),
          h(
            'p',
            { class: 'cup-tally' },
            icon('cup'),
            wins <= 1 ? 'Your first league title' : `League titles: ${wins}`,
          ),
          actions,
        ),
        leagueTable(league, { title: 'Final table' }),
      );
      celebrate(house);
      return;
    }

    const winner = first ? houseById(first.house) : null;
    show(
      h(
        'div',
        { class: 'cup-verdict panel' },
        h('p', { class: 'ribbon', text: 'Season over' }),
        h('h2', { class: 'verdict', text: `Finished ${ordinal(place + 1)}` }),
        winner &&
          first &&
          mine &&
          h('p', {
            class: 'cup-level',
            text: `${winner.name} are champions on ${pts(first.points)}. House ${house.name} took ${pts(mine.points)}.`,
          }),
        actions,
      ),
      leagueTable(league, { title: 'Final table' }),
    );
  }

  const celebrate = (house: House): void => {
    if (reducedMotion()) return;
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
  };

  /** Picks the view from the saved season, so leaving or reloading mid-matchday resumes where it was. */
  function render(): void {
    stop();
    const season = app.season;
    const league = season?.league;
    if (!season || !league) show(noSeason(season));
    else if (isFinished(league)) seasonEnd(season, league);
    else if (otherFixtures(season).length) results(season, league);
    else hub(season, league);
    window.scrollTo({ top: 0 });
  }

  root.append(
    h(
      'section',
      { class: 'manager-screen' },
      h(
        'header',
        { class: 'screen-head' },
        button('← Home', () => {
          app.go('home');
        }),
        h('h2', { text: 'Realm League' }),
      ),
      body,
      fx,
    ),
  );
  render();
  return stop;
}
