import './manager.css';
import './career.css';
import type { AppContext } from '../../app';
import { ATTRIBUTE_CAPS, ATTRIBUTES, type Attribute } from '../../game/attributes';
import { BUILDS } from '../../game/constants';
import { randomSeed } from '../../game/rng';
import type { Role } from '../../game/types';
import { option } from '../../knight/catalog';
import {
  careerLine,
  careerSession,
  clubPlace,
  matchdayLabel,
  newCareer,
  simPlayerMatch,
  teamNews,
} from '../../modes/career';
import {
  averageOf,
  divisionSeason,
  endSeason,
  fixtureAt,
  isSeasonOver,
  matchday,
  pendingFixtures,
  planFixture,
  PLAYER_ID,
  playerDivision,
  playerFixture,
  playerStars,
  POSITIONS,
  setPosition,
  START_AGE,
  type CareerState,
  type FixtureRecord,
} from '../../modes/career/career';
import { clubById, DIVISION_NAMES, DIVISIONS, TOP_DIVISION, type Division } from '../../modes/career/clubs';
import { FAME_MAX } from '../../modes/career/economy';
import { starText } from '../../modes/career/stars';
import { PROMOTED, RELEGATED } from '../../modes/career/world';
import { ordinal } from '../../modes/manager';
import {
  fixtures,
  LEAGUE_SIZE,
  MATCHDAYS,
  table,
  type LeagueFixture,
  type LeagueState,
} from '../../modes/manager/league';
import { FRESH } from '../../modes/manager/stamina';
import { MatchRunner } from '../../modes/runner';
import { choice } from '../choice';
import { button, h } from '../dom';
import { banner, blockColour, crest, icon } from '../heraldry';
import { reducedMotion, throughTheGates } from '../motion';
import { drawPortrait } from '../portrait';
import { shownRating } from '../ratings';
import { moveMark, movesSince, ratingChip, staminaMeter, withoutMatchday } from './manager';
import {
  offersView,
  recordsView,
  royalView,
  seasonReviewView,
  STAT_NAMES,
  upgradesView,
} from './career-views';
import { ROLE_NAMES } from './setup';

/** Headless play per frame, in chunks of steps until the budget is spent, so the page stays smooth on any device. */
const FRAME_BUDGET_MS = 8;
const STEPS_PER_CHUNK = 150;
/** Each result lands at least this far apart: eleven of them read as a ticker, not a wait. */
const RESULT_PACE_MS = 260;
/** Ratings shown as form chips on the hub. */
const FORM_CHIPS = 5;

/** How each position earns its rating, in a sentence, for the start screen and a change of position. */
const POSITION_NOTES: Readonly<Record<Role, string>> = {
  gk: 'Rated on saves, claims and clean sheets; every goal you might have stopped counts against you.',
  def: 'Rated on tackles, interceptions, blocks and clearances that keep danger from your goal.',
  mid: 'Rated on passes and carries that move the ball forward, and on winning it back.',
  fwd: 'Rated on shots, goals and assists; losing the ball cheaply costs you.',
};

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

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const clubShield = (id: string): HTMLElement => {
  const club = clubById(id);
  return h('span', { class: 'tie-shield', attrs: { style: `--c: ${club.colour}` } }, crest(club));
};

const clubBlock = (id: string): HTMLElement => {
  const club = clubById(id);
  return h(
    'span',
    { class: 'house-block', style: { background: blockColour(club) } },
    crest(club),
    club.name,
  );
};

/** His club's division this season, each fixture's record beside it. */
function leagueOf(run: CareerState, division: Division): LeagueState {
  const league = run.season.leagues[division];
  if (!league) throw new Error(`No league for division ${division}`);
  return league;
}

const recordOf = (run: CareerState, division: Division, day: number, index: number): FixtureRecord | null =>
  run.season.records[division]?.[day]?.[index] ?? null;

/** His ratings this season, oldest first. */
function seasonRatings(run: CareerState): number[] {
  const division = playerDivision(run);
  const out: number[] = [];
  for (const day of run.season.records[division] ?? [])
    for (const record of day) {
      const rating = record?.ratings[PLAYER_ID];
      if (rating !== undefined) out.push(rating);
    }
  return out;
}

interface TableOptions {
  readonly title: string;
  readonly moves?: ReadonlyMap<string, number>;
  readonly fresh?: ReadonlySet<string>;
}

/** A division's table, his club in gold, the places that go up and down marked at the edge. */
function divisionTable(run: CareerState, division: Division, options: TableOptions): HTMLElement {
  const league = leagueOf(run, division);
  const rows = table(league);
  const started = (rows[0]?.played ?? 0) > 0;
  const up = division < TOP_DIVISION ? PROMOTED : 0;
  const down = division > 0 ? RELEGATED : 0;
  // Goals for and against give way first on a phone; the difference stays.
  const col = (text: string, title: string): HTMLElement =>
    h(
      'th',
      { class: text === 'GF' || text === 'GA' ? 'col-goals' : '', attrs: { scope: 'col' } },
      h('abbr', { text, attrs: { title } }),
    );
  const body = rows.map((row, i) => {
    const you = row.house === run.player.club;
    // Marked once a ball is kicked: before that the order is only alphabetical.
    const zone = !started ? '' : i < up ? 'is-up' : i >= LEAGUE_SIZE - down ? 'is-down' : '';
    const zoneWord = zone === 'is-up' ? ', promotion place' : zone === 'is-down' ? ', relegation place' : '';
    const gd = row.goalDifference;
    return h(
      'tr',
      {
        class: [you && 'is-you', zone, options.fresh?.has(row.house) && 'is-fresh'].filter(Boolean).join(' '),
      },
      h(
        'td',
        { class: 'col-pos' },
        started && i === 0 && division === TOP_DIVISION
          ? h('span', { class: 'pos-top', attrs: { title: 'Top of the Great Houses' } }, icon('cup'))
          : String(i + 1),
        h('span', { class: 'visually-hidden', text: zoneWord }),
      ),
      options.moves && h('td', { class: 'col-move' }, moveMark(options.moves.get(row.house))),
      h(
        'th',
        { class: 'col-house', attrs: { scope: 'row' } },
        h(
          'span',
          { class: 'table-house' },
          clubShield(row.house),
          h('span', { class: 'side-name', text: clubById(row.house).name }),
          you && h('small', { class: 'you-tag', text: 'You' }),
        ),
      ),
      ...[row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst].map((n, i) =>
        h('td', { class: i >= 4 ? 'col-goals' : '', text: String(n) }),
      ),
      h('td', { text: gd > 0 ? `+${gd}` : String(gd) }),
      h('td', { class: 'col-pts', text: String(row.points) }),
    );
  });
  const key = [
    up > 0 && h('span', { class: 'cr-key is-up', text: `Top ${up} go up` }),
    down > 0 && h('span', { class: 'cr-key is-down', text: `Bottom ${down} go down` }),
    division === TOP_DIVISION && h('span', { class: 'cr-key is-top', text: 'Top of the realm' }),
  ];
  return h(
    'section',
    { class: 'league-table cr-table panel' },
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
            h('th', { class: 'col-house', attrs: { scope: 'col' }, text: 'Club' }),
            ...TABLE_COLUMNS.map(([text, title]) => col(text, title)),
          ),
        ),
        h('tbody', {}, ...body),
      ),
    ),
    h('p', { class: 'cr-keys' }, ...key),
  );
}

/** One fixture as a tie card, home side on top; empty goal boxes until it is played. */
function fixtureTie(fixture: LeagueFixture, playerClub: string, fresh: boolean): HTMLElement {
  const { score } = fixture;
  const side = (id: string, goals: number | null, against: number | null): HTMLElement => {
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
      { class: `tie-side${result}${id === playerClub ? ' is-you' : ''}` },
      clubShield(id),
      h('span', { class: 'side-name', text: clubById(id).name }),
      h('span', { class: 'tie-goals', text: goals === null ? '' : String(goals) }),
    );
  };
  const names = `${clubById(fixture.home).name} v ${clubById(fixture.away).name}`;
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

/** A labelled row on the knight's card: name on the left, the figure on the right. */
const cardRow = (label: string, ...figure: (HTMLElement | string)[]): HTMLElement =>
  h('div', { class: 'cr-row' }, h('span', { class: 'cr-label', text: label }), ...figure);

/** One stat's level as pips against its cap. */
function statRow(stat: Attribute, level: number): HTMLElement {
  const cap = ATTRIBUTE_CAPS[stat];
  const whole = Math.floor(level);
  return h(
    'div',
    { class: 'cr-stat' },
    h('span', { class: 'cr-label', text: STAT_NAMES[stat] }),
    h(
      'span',
      { class: 'cr-pips', attrs: { role: 'img', 'aria-label': `${STAT_NAMES[stat]} ${whole} of ${cap}` } },
      ...Array.from({ length: cap }, (_, i) => h('i', { class: i < whole ? 'is-on' : '' })),
    ),
    h('small', { class: 'cr-level', text: `${whole}/${cap}`, attrs: { 'aria-hidden': 'true' } }),
  );
}

const starLine = (stars: number): HTMLElement =>
  h('span', {
    class: 'cr-stars',
    text: starText(stars),
    attrs: { role: 'img', 'aria-label': `${shownRating(stars + 1)} stars of 5` },
  });

/** The verdict from his club's side of a played fixture. */
function verdictOf(fixture: LeagueFixture, club: string): string {
  const [home, away] = fixture.score ?? [0, 0];
  const [us, them] = fixture.home === club ? [home, away] : [away, home];
  return us > them ? 'Victory!' : us < them ? 'Defeat' : 'Draw';
}

/** What he did in a fixture, in a line: his rating, goals, assists and the star; or that he sat it out. */
function yourLine(record: FixtureRecord | null): HTMLElement {
  const rating = record?.ratings[PLAYER_ID];
  if (!record || rating === undefined)
    return h('p', { class: 'cr-yours is-out', text: 'You watched it all from the bench.' });
  const goals = record.goals.filter((g) => g.scorer === PLAYER_ID && !g.ownGoal).length;
  const assists = record.goals.filter((g) => g.assist === PLAYER_ID).length;
  const on = record.subs.find((c) => c.on === PLAYER_ID);
  const off = record.subs.find((c) => c.off === PLAYER_ID);
  const deeds = [
    on && `On ${on.minute}′`,
    off && `Off ${off.minute}′`,
    goals && plural(goals, 'goal'),
    assists && plural(assists, 'assist'),
  ].filter(Boolean);
  return h(
    'p',
    { class: 'cr-yours' },
    h('span', { text: 'Your rating' }),
    ratingChip(rating),
    deeds.length > 0 && h('span', { text: deeds.join(' · ') }),
    record.motm === PLAYER_ID && h('span', { class: 'cr-motm' }, '★ Man of the match'),
  );
}

type Extra = 'upgrades' | 'records' | null;
type EndStage = 'review' | 'royal' | 'offers';

export function mountCareer(root: HTMLElement, app: AppContext): () => void {
  const body = h('div', { class: 'manager-body career-body' });
  const timers: number[] = [];
  let frame = 0;
  /** A view from the season's side screens shown over the hub, until it hands back. */
  let extra: Extra = null;
  let endStage: EndStage = 'review';
  let positionOpen = false;
  let retiring = false;

  const later = (ms: number, run: () => void): void => {
    timers.push(window.setTimeout(run, ms));
  };

  const stop = (): void => {
    cancelAnimationFrame(frame);
    for (const timer of timers) window.clearTimeout(timer);
    timers.length = 0;
  };

  const show = (...children: (HTMLElement | null | false)[]): void => {
    body.replaceChildren(...children.filter((c): c is HTMLElement => Boolean(c)));
  };

  const back = (): void => {
    extra = null;
    render();
  };

  // ---------- start ----------

  function start(): void {
    let seed = randomSeed();
    let position: Role = 'mid';
    const portrait = h('canvas', { class: 'cr-start-portrait', attrs: { 'aria-hidden': 'true' } });

    const draw = (): void => {
      const preview = newCareer(app, position, seed);
      const club = clubById(preview.player.club);
      const positions = h(
        'div',
        { class: 'cr-positions', attrs: { role: 'group', 'aria-label': 'Your position' } },
        ...POSITIONS.map((p) =>
          h(
            'button',
            {
              class: 'cr-position',
              attrs: { type: 'button', 'aria-pressed': String(p === position) },
              on: {
                click: () => {
                  position = p;
                  draw();
                  body.querySelector<HTMLElement>('.cr-position[aria-pressed="true"]')?.focus();
                },
              },
            },
            h(
              'b',
              {},
              p === position && h('span', { class: 'cr-pick', text: '◆ ', attrs: { 'aria-hidden': 'true' } }),
              ROLE_NAMES[p],
            ),
            h('small', { text: POSITION_NOTES[p] }),
          ),
        ),
      );
      show(
        h(
          'div',
          { class: 'cr-start' },
          h(
            'section',
            { class: 'cr-forged panel' },
            h('p', { class: 'ribbon', text: 'Your knight' }),
            portrait,
            h('h3', { class: 'cr-name', text: app.look.name }),
            h('p', {
              class: 'cr-sub',
              text: `${option(BUILDS, app.look.build).name} build · age ${START_AGE}`,
            }),
            starLine(playerStars(preview.player)),
            h('p', {
              class: 'hint cr-note',
              text: 'Looks and build come from the forge. Build sets your pace and weight; training does the rest.',
            }),
            button('Reforge your knight', () => {
              app.go('forge');
            }),
          ),
          h(
            'section',
            { class: 'cr-setup panel' },
            h('h3', { class: 'panel-title', text: 'Pick your position' }),
            positions,
            h('h3', { class: 'panel-title', text: 'Your first club' }),
            h(
              'div',
              { class: 'cr-club' },
              h('div', { class: 'md-crest cr-crest', attrs: { style: `--c: ${club.colour}` } }, crest(club)),
              h(
                'div',
                { class: 'cr-club-text' },
                h('b', { text: club.name }),
                h('small', {
                  text: `${DIVISION_NAMES[0]} · ${MATCHDAYS} matchdays · the top two go up`,
                }),
                button('Try another village', () => {
                  seed = randomSeed();
                  draw();
                }),
              ),
            ),
            h(
              'div',
              { class: 'cup-actions cr-begin' },
              button(
                'Begin your career',
                () => {
                  app.setCareer(newCareer(app, position, seed));
                  render();
                },
                'btn-primary',
              ),
            ),
          ),
        ),
      );
      drawPortrait(portrait, app.look, club.colour, { width: 150, height: 176 });
    };
    draw();
  }

  // ---------- hub ----------

  const play = (): void => {
    const session = careerSession(app);
    if (!session) return;
    throughTheGates(() => {
      app.playMatch(session);
    });
  };

  const sim = (): void => {
    simPlayerMatch(app);
    render();
  };

  function nextPanel(run: CareerState, fixture: LeagueFixture): HTMLElement {
    const club = run.player.club;
    const home = fixture.home === club;
    const rivalId = home ? fixture.away : fixture.home;
    const rival = clubById(rivalId);
    const rows = table(leagueOf(run, playerDivision(run)));
    const rivalPlace = rows.findIndex((r) => r.house === rivalId);
    const rivalRow = rows[rivalPlace];
    const started = (rivalRow?.played ?? 0) > 0;
    const news = teamNews(run);
    const side = (id: string, sway: number): HTMLElement =>
      h(
        'div',
        { class: 'face-side' },
        banner(clubById(id), sway),
        h('b', { text: clubById(id).name }),
        id === club && h('small', { class: 'you-tag', text: 'You' }),
      );
    return h(
      'div',
      { class: 'cup-next panel md-next cr-next' },
      h('p', { class: 'ribbon', text: matchdayLabel(run) }),
      h(
        'div',
        { class: 'face-off' },
        side(fixture.home, 0),
        h('span', { class: 'vs', text: 'v' }),
        side(fixture.away, -1.3),
      ),
      h('p', {
        class: 'cup-level',
        text:
          rivalRow && started
            ? `${home ? 'At home to' : 'Away at'} ${rival.name}, ${ordinal(rivalPlace + 1)} on ${plural(rivalRow.points, 'point')}.`
            : `${home ? 'At home to' : 'Away at'} ${rival.name} to open the season.`,
      }),
      h(
        'p',
        { class: `cr-news${news.starts ? ' is-start' : ' is-bench'}` },
        h('b', { class: 'cr-badge', text: news.starts ? 'Starting' : 'On the bench' }),
        h('span', { text: news.reason }),
      ),
      h(
        'div',
        { class: 'cup-actions' },
        button(news.starts ? 'Play the match' : 'Watch from the bench', play, 'btn-primary'),
        button('Sim the match', sim),
      ),
    );
  }

  function knightPanel(run: CareerState): HTMLElement {
    const { player } = run;
    const club = clubById(player.club);
    const portrait = h('canvas', { class: 'cr-portrait', attrs: { 'aria-hidden': 'true' } });
    const ratings = seasonRatings(run).slice(-FORM_CHIPS);
    const fame = Math.round(player.fame);
    const positionPicker =
      positionOpen &&
      h(
        'div',
        { class: 'cr-repick' },
        choice(
          'Position',
          POSITIONS.map((p) => ({ value: p, label: ROLE_NAMES[p] })),
          player.position,
          (p) => {
            const now = app.career;
            if (!now || p === now.player.position) return;
            app.setCareer(setPosition(now, p));
            render();
          },
        ),
        h('p', { class: 'lever-note', text: POSITION_NOTES[player.position] }),
      );
    const panel = h(
      'section',
      { class: 'cr-knight panel' },
      h(
        'div',
        { class: 'cr-knight-head' },
        portrait,
        h(
          'div',
          {},
          h('h3', { class: 'cr-name', text: player.look.name }),
          h('p', {
            class: 'cr-sub',
            text: `Age ${player.age} · ${ROLE_NAMES[player.position]} · ${club.name}`,
          }),
          starLine(playerStars(player)),
        ),
      ),
      h('div', { class: 'cr-stats' }, ...ATTRIBUTES.map((a) => statRow(a, player.attributes[a]))),
      h(
        'div',
        { class: 'cr-train' },
        h(
          'p',
          {},
          h('b', { text: String(player.points) }),
          player.points === 1 ? ' point to spend' : ' points to spend',
        ),
        button(
          'Train',
          () => {
            extra = 'upgrades';
            render();
          },
          player.points > 0 ? 'btn cr-train-btn is-ready' : 'btn cr-train-btn',
        ),
      ),
      cardRow(
        'Stamina',
        staminaMeter(player.stamina, false),
        h('small', {
          class: player.stamina < FRESH ? 'is-tired' : '',
          text: String(Math.round(player.stamina)),
        }),
      ),
      cardRow(
        'Form',
        ratings.length
          ? h(
              'span',
              {
                class: 'form-chips',
                attrs: {
                  role: 'img',
                  'aria-label': `Last ${ratings.length} ratings, oldest first: ${ratings.map(shownRating).join(', ')}`,
                },
              },
              ...ratings.map((r) => ratingChip(r, true)),
            )
          : h('small', { class: 'cr-none', text: 'No matches yet this season' }),
      ),
      cardRow(
        'Fame',
        h(
          'span',
          {
            class: 'cr-fame',
            attrs: {
              role: 'meter',
              'aria-label': 'Fame',
              'aria-valuenow': String(fame),
              'aria-valuemax': String(FAME_MAX),
            },
          },
          h('i', { style: { width: `${(fame / FAME_MAX) * 100}%` } }),
        ),
        h('small', { text: String(fame) }),
      ),
      h(
        'div',
        { class: 'cr-knight-foot' },
        button(positionOpen ? 'Keep this position' : 'Change position', () => {
          positionOpen = !positionOpen;
          render();
        }),
      ),
      positionPicker,
    );
    drawPortrait(portrait, player.look, club.colour, { width: 96, height: 112 });
    return panel;
  }

  function seasonPanel(run: CareerState): HTMLElement {
    const me = divisionSeason(run, playerDivision(run)).get(PLAYER_ID);
    const average = averageOf(me);
    const { place, started } = clubPlace(run);
    const figure = (label: string, value: HTMLElement | string): HTMLElement =>
      h('div', { class: 'cr-figure' }, h('b', {}, value), h('small', { text: label }));
    return h(
      'section',
      { class: 'cr-season panel' },
      h('h3', { class: 'panel-title', text: 'Your season so far' }),
      h(
        'div',
        { class: 'cr-figures' },
        figure('Apps', String(me?.apps ?? 0)),
        figure('Goals', String(me?.goals ?? 0)),
        figure('Assists', String(me?.assists ?? 0)),
        figure('Average', average === null ? '–' : ratingChip(average)),
        figure('Man of the match', String(me?.motm ?? 0)),
        figure('Points earned', String(run.season.points)),
      ),
      h('p', {
        class: 'cr-standing',
        text: started
          ? `${clubById(run.player.club).name} lie ${ordinal(place)} in the ${DIVISION_NAMES[playerDivision(run)]}.`
          : `${matchdayLabel(run)}: all to play for.`,
      }),
    );
  }

  function hubFoot(): HTMLElement {
    const retire = retiring
      ? h(
          'div',
          { class: 'cr-retire', attrs: { role: 'group', 'aria-label': 'Retire' } },
          h('span', { text: 'Hang up your boots for good?' }),
          button('Retire', () => {
            retiring = false;
            app.setCareer(null);
            render();
          }),
          button(
            'Play on',
            () => {
              retiring = false;
              render();
            },
            'btn-primary',
          ),
        )
      : button('Retire…', () => {
          retiring = true;
          render();
        });
    return h(
      'div',
      { class: 'cup-actions cr-foot' },
      button('Career records', () => {
        extra = 'records';
        render();
      }),
      retire,
    );
  }

  function hub(run: CareerState, fixture: LeagueFixture): void {
    const division = playerDivision(run);
    show(
      h('p', { class: 'cr-line', text: careerLine(run) }),
      h('div', { class: 'md-hub cr-hub' }, nextPanel(run, fixture), knightPanel(run)),
      h(
        'div',
        { class: 'cr-hub-lower' },
        divisionTable(run, division, { title: DIVISION_NAMES[division] }),
        seasonPanel(run),
      ),
      hubFoot(),
    );
  }

  // ---------- the matchday's results ----------

  function results(run: CareerState): void {
    const day = matchday(run);
    const division = playerDivision(run);
    const club = run.player.club;
    const mineRef = playerFixture(run);
    const mine = mineRef && fixtureAt(run, mineRef);
    const before = new Map(table(withoutMatchday(leagueOf(run, division), day)).map((r, i) => [r.house, i]));
    const order: Division[] = [division, ...DIVISIONS.filter((d) => d !== division).reverse()];
    const groups = h('div', { class: 'cr-groups' });
    const standings = h('div');
    const status = h('p', { class: 'md-status', attrs: { role: 'status' } });
    const actions = h('div', { class: 'cup-actions' });

    const refresh = (fresh: { division: Division; index: number } | null): void => {
      const now = app.career;
      if (!now) return;
      let total = 0;
      let pending = 0;
      groups.replaceChildren(
        ...order.map((d) => {
          const others = fixtures(leagueOf(now, d), day).filter(
            (f) => !(d === division && f.index === mineRef?.index),
          );
          total += others.length;
          pending += others.filter((f) => !f.score).length;
          return h(
            'section',
            { class: 'cr-group' },
            h('h3', { class: 'panel-title', text: DIVISION_NAMES[d] }),
            h(
              'div',
              { class: 'md-ties' },
              ...others.map((f) => fixtureTie(f, club, fresh?.division === d && fresh.index === f.index)),
            ),
          );
        }),
      );
      status.textContent = pending
        ? `Results coming in from across the realm: ${total - pending} of ${total}`
        : 'All results are in.';
      status.classList.toggle('is-waiting', pending > 0);
      const freshClubs =
        fresh?.division === division
          ? fixtures(leagueOf(now, division), day)
              .filter((f) => f.index === fresh.index)
              .flatMap((f) => [f.home, f.away])
          : [];
      standings.replaceChildren(
        divisionTable(now, division, {
          title: DIVISION_NAMES[division],
          moves: movesSince(before, leagueOf(now, division)),
          fresh: new Set(freshClubs),
        }),
      );
    };

    const finish = (): void => {
      const now = app.career;
      const over = now ? isSeasonOver(now) : false;
      const next = button(over ? 'To the season’s end' : `On to matchday ${day + 2}`, render, 'btn-primary');
      actions.replaceChildren(next);
      next.focus({ preventScroll: true });
    };

    const playNext = (): void => {
      const current = app.career;
      // Once the day's last result is in, the career has moved on to the next matchday: stop there.
      const ref =
        current && !current.review && matchday(current) === day ? pendingFixtures(current)[0] : undefined;
      if (!current || !ref) {
        finish();
        return;
      }
      const plan = planFixture(current, ref, 'sim');
      const runner = new MatchRunner(plan.config());
      const started = performance.now();
      const step = (): void => {
        const begun = performance.now();
        do runner.advance(STEPS_PER_CHUNK);
        while (!runner.ended && performance.now() - begun < FRAME_BUDGET_MS);
        if (!runner.ended) {
          frame = requestAnimationFrame(step);
          return;
        }
        const wait = reducedMotion() ? 0 : Math.max(0, RESULT_PACE_MS - (performance.now() - started));
        later(wait, () => {
          // Always onto the latest career: each result before this one has changed it.
          const latest = app.career;
          if (!latest) return;
          app.setCareer(plan.finish(latest, { stats: runner.stats, steps: runner.step }));
          refresh(ref);
          playNext();
        });
      };
      frame = requestAnimationFrame(step);
    };

    const record = mineRef ? recordOf(run, division, day, mineRef.index) : null;
    show(
      h(
        'div',
        { class: 'cup-next panel md-results cr-results' },
        h('p', { class: 'ribbon', text: `Matchday ${day + 1} results` }),
        mine &&
          h(
            'div',
            { class: 'md-mine' },
            h('h2', { class: 'verdict', text: verdictOf(mine, club) }),
            h(
              'p',
              { class: 'final md-final' },
              clubBlock(mine.home),
              h('span', { class: 'final-score', text: (mine.score ?? [0, 0]).join(' – ') }),
              clubBlock(mine.away),
            ),
            yourLine(record),
          ),
        groups,
        status,
        actions,
      ),
      standings,
    );
    refresh(null);
    playNext();
  }

  // ---------- season's end ----------

  /** Counts the season's honours a frame after saying so: the royal knockout plays out headless in there. */
  function closeSeason(): void {
    show(
      h(
        'div',
        { class: 'cup-verdict panel' },
        h('p', { class: 'ribbon', text: 'Season over' }),
        h('p', { class: 'md-status is-waiting', text: 'The heralds are counting the season’s honours' }),
      ),
    );
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const run = app.career;
        if (run && !run.review && isSeasonOver(run)) app.setCareer(endSeason(run));
        endStage = 'review';
        render();
      });
    });
  }

  function seasonEnd(run: CareerState): void {
    const review = run.review;
    if (!review) return;
    if (endStage === 'royal' && !review.royal) endStage = 'offers';
    if (endStage === 'review')
      show(
        seasonReviewView(run, () => {
          endStage = review.royal ? 'royal' : 'offers';
          render();
        }),
      );
    else if (endStage === 'royal')
      show(
        royalView(run, () => {
          endStage = 'offers';
          render();
        }),
      );
    else
      show(
        offersView(run, (next) => {
          app.setCareer(next);
          endStage = 'review';
          render();
        }),
      );
  }

  /** Picks the view from the saved career, so leaving or reloading mid-matchday resumes where it was. */
  function render(): void {
    stop();
    const run = app.career;
    const ref = run && !run.review ? playerFixture(run) : null;
    const fixture = run && ref ? fixtureAt(run, ref) : null;
    if (!run) start();
    else if (extra === 'upgrades')
      show(
        upgradesView(run, {
          onChange: (next) => {
            app.setCareer(next);
          },
          onDone: back,
        }),
      );
    else if (extra === 'records') show(recordsView(run, back));
    else if (run.review) seasonEnd(run);
    else if (isSeasonOver(run)) closeSeason();
    else if (fixture?.score) results(run);
    else if (fixture) hub(run, fixture);
    window.scrollTo({ top: 0 });
  }

  root.append(
    h(
      'section',
      { class: 'manager-screen career-screen' },
      h(
        'header',
        { class: 'screen-head' },
        button('← Home', () => {
          app.go('home');
        }),
        h('h2', { text: 'My Career' }),
      ),
      body,
    ),
  );
  render();
  return stop;
}
