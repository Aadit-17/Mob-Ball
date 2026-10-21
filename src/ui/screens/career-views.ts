// My Career's secondary views, built for the career hub to mount: each takes the career and callbacks and returns one
// element, so the hub owns saving and navigation. The contract is on each export below.
import './career-views.css';
import { skillFor, TOP_TIER } from '../../ai/skills';
import {
  ATTRIBUTE_CAPS,
  ATTRIBUTES,
  COOLDOWN_PER_LEVEL,
  levelOf,
  PACE_PER_LEVEL,
  SHOT_PER_LEVEL,
  STAMINA_PER_LEVEL,
  STRENGTH_PER_LEVEL,
  type Attribute,
  type Attributes,
} from '../../game/attributes';
import { clamp } from '../../game/vec';
import type { Look } from '../../knight/look';
import {
  guardPlayer,
  nextSeason,
  placeLevel,
  PLAYER_ID,
  playerDivision,
  ROYAL_RIVAL_TIERS,
  trainPlayer,
  type CareerPlayer,
  type CareerState,
  type RoyalResult,
  type SeasonSummary,
} from '../../modes/career/career';
import { clubById, clubLevel, DIVISION_NAMES, TOP_DIVISION, type Division } from '../../modes/career/clubs';
import {
  age as ageOnce,
  canGuard,
  canTrain,
  DECLINE_AGE,
  FAME_MAX,
  HONOUR_POINTS,
  HONOURS,
  type Honour,
  type Training,
} from '../../modes/career/economy';
import { matchStrength } from '../../modes/career/form';
import { careerRecords, type Best } from '../../modes/career/records';
import { overallStars, starText } from '../../modes/career/stars';
import { UPGRADE_COST, upgradeCost } from '../../modes/career/upgrades';
import { promote } from '../../modes/career/world';
import { ordinal } from '../../modes/manager';
import { fixtures, table } from '../../modes/manager/league';
import { button, h, svg } from '../dom';
import { crest, houseShield, icon } from '../heraldry';
import { lozengeBurst, reducedMotion } from '../motion';
import { drawPortrait } from '../portrait';
import { ratingBand, shownRating } from '../ratings';
import { ROLE_NAMES } from './setup';

// Pure helpers (tested) -----------------------------------------------------------------------------

/** Stars as the game says them, out of five: a Peasant 1.0, a Legend 5.0. A level is worth about a tenth of a star,
 * so previews show two decimals. */
export const starScore = (stars: number, digits = 1): string =>
  (clamp(stars, 0, TOP_TIER) + 1).toFixed(digits);

const pct = (share: number): string => `${Math.round(share * 100)}%`;

/** What one level of a stat does, in plain words, from the engine's own constants. */
export function effectPerLevel(stat: Attribute): string {
  switch (stat) {
    case 'pace':
      return `+${pct(PACE_PER_LEVEL)} run speed a level`;
    case 'shot':
      return `Shots ${pct(SHOT_PER_LEVEL)} harder a level, and boosted from further out`;
    case 'strength':
      return `+${pct(STRENGTH_PER_LEVEL)} weight in every clash and ${pct(COOLDOWN_PER_LEVEL)} quicker barges a level`;
    case 'stamina':
      return `Matches tire you ${pct(STAMINA_PER_LEVEL)} less a level`;
  }
}

/** What the stat does at this level, all levels together. */
export function effectNow(stat: Attribute, level: number): string {
  if (level <= 0) return 'Untrained';
  switch (stat) {
    case 'pace':
      return `+${pct(PACE_PER_LEVEL * level)} run speed`;
    case 'shot':
      return `Shots +${pct(SHOT_PER_LEVEL * level)} harder, from further out`;
    case 'strength':
      return `+${pct(STRENGTH_PER_LEVEL * level)} weight, barges ${pct(COOLDOWN_PER_LEVEL * level)} quicker`;
    case 'stamina':
      return `Tires ${pct(STAMINA_PER_LEVEL * level)} slower`;
  }
}

export const STAT_NAMES: Readonly<Record<Attribute, string>> = {
  pace: 'Pace',
  shot: 'Shot',
  strength: 'Strength',
  stamina: 'Stamina',
};

/** Whether the next level of a stat can be bought, and if not, why: the same rule as the core's trainCost. */
export type TrainState =
  | { readonly kind: 'ready'; readonly cost: number }
  | { readonly kind: 'short'; readonly cost: number }
  | { readonly kind: 'cap' }
  | { readonly kind: 'aged' };

export function trainState(training: Training, stat: Attribute): TrainState {
  if (!canTrain(training.age)) return { kind: 'aged' };
  const cost = upgradeCost(stat, levelOf(training.attributes, stat));
  if (cost === null) return { kind: 'cap' };
  return cost <= training.points ? { kind: 'ready', cost } : { kind: 'short', cost };
}

/** Whether a stat can be guarded for next season, and if not, why: the same rule as the core's guardCost. */
export type GuardState =
  | { readonly kind: 'ready'; readonly cost: number }
  | { readonly kind: 'short'; readonly cost: number }
  | { readonly kind: 'guarded' }
  | { readonly kind: 'bare' }
  | { readonly kind: 'early' };

export function guardState(training: Training, stat: Attribute): GuardState {
  if (!canGuard(training.age)) return { kind: 'early' };
  if (training.guarded.includes(stat)) return { kind: 'guarded' };
  if (levelOf(training.attributes, stat) === 0) return { kind: 'bare' };
  const cost = UPGRADE_COST[stat];
  return cost <= training.points ? { kind: 'ready', cost } : { kind: 'short', cost };
}

/** Overall stars now and with one more level of `stat` (the same at its cap). */
export function starsPreview(
  build: number,
  attributes: Attributes,
  stat: Attribute,
): { readonly now: number; readonly next: number } {
  const level = levelOf(attributes, stat);
  const raised = Math.min(ATTRIBUTE_CAPS[stat], level + 1);
  return {
    now: overallStars(build, attributes),
    next: overallStars(build, { ...attributes, [stat]: raised }),
  };
}

const levels = (n: number): string => `${n} ${n === 1 ? 'level' : 'levels'}`;

/** Next season's wear on one stat in words, as it stands and as a guard would leave it. */
export function wearText(
  wear: { readonly unguarded: number; readonly guarded: number },
  guarded: boolean,
): string {
  if (guarded)
    return wear.guarded ? `Next season: −${levels(wear.guarded)}, guarded` : 'Guarded: holds next season';
  if (!wear.unguarded) return 'Holds next season';
  const saved = wear.guarded ? `−${levels(wear.guarded)}` : 'none';
  return `Next season: −${levels(wear.unguarded)}, ${saved} if guarded`;
}

/** Whole levels a stat loses on his next birthday, left alone and guarded (worn part levels carry over). */
export function wearPreview(
  training: Training,
  stat: Attribute,
): { readonly unguarded: number; readonly guarded: number } {
  const lost = (guarded: readonly Attribute[]): number =>
    levelOf(training.attributes, stat) - levelOf(ageOnce({ ...training, guarded }).attributes, stat);
  const others = training.guarded.filter((s) => s !== stat);
  return { unguarded: lost(others), guarded: lost([...others, stat]) };
}

/** Where he would stand at a club: his match stars against the knight who holds his place there. */
export type Place = 'first' | 'contest' | 'bench';
/** Tiers clear of the incumbent to be first choice, and short of him before the bench beckons. */
export const FIRST_CHOICE_MARGIN = 0.25;
export const BENCH_MARGIN = 0.5;

export function placeAt(strength: number, incumbent: number): Place {
  const gap = strength - incumbent;
  return gap >= FIRST_CHOICE_MARGIN ? 'first' : gap > -BENCH_MARGIN ? 'contest' : 'bench';
}

/** A club's division next season, after promotion and relegation. */
export function nextDivision(career: CareerState, club: string): Division {
  const next = promote(career.season.leagues.map((l) => table(l)));
  const d = next.findIndex((clubs) => clubs.includes(club));
  return clamp(d < 0 ? 0 : d, 0, TOP_DIVISION) as Division;
}

export interface BestMatch {
  readonly rating: number;
  /** 0-based. */
  readonly matchday: number;
  readonly opponent: string;
  /** His club's goals, then the opponent's. */
  readonly score: readonly [number, number];
}

/** His highest rated match of the season in his division, the earliest on a tie; null without one. */
export function bestMatch(career: CareerState, division: Division, club: string): BestMatch | null {
  const league = career.season.leagues[division];
  const days = career.season.records[division] ?? [];
  if (!league) return null;
  let best: BestMatch | null = null;
  days.forEach((day, matchday) => {
    day.forEach((record, index) => {
      const rating = record?.ratings[PLAYER_ID];
      if (rating === undefined || (best && rating <= best.rating)) return;
      const fixture = fixtures(league, matchday)[index];
      if (!fixture?.score) return;
      const home = fixture.home === club;
      best = {
        rating,
        matchday,
        opponent: home ? fixture.away : fixture.home,
        score: home ? fixture.score : [fixture.score[1], fixture.score[0]],
      };
    });
  });
  return best;
}

/** The season's headline, the proudest thing first. */
export type Verdict = 'crown' | 'title' | 'promotion' | 'boot' | 'royal' | 'relegated' | 'finish';

export function seasonVerdict(summary: SeasonSummary): Verdict {
  const won = (honour: Honour): boolean => summary.honours.includes(honour);
  if (won('royalCrown')) return 'crown';
  if (won('title')) return 'title';
  if (won('promotion')) return 'promotion';
  if (won('topScorer')) return 'boot';
  if (won('royalCall')) return 'royal';
  return summary.relegated ? 'relegated' : 'finish';
}

/** The royal knockout's rounds by name: the last is the final. */
export function knockoutRound(round: number, rounds: number): string {
  if (round === rounds - 1) return 'Final';
  if (round === rounds - 2) return 'Semi-final';
  return round === 0 ? 'First round' : `Round ${round + 1}`;
}

/** "Crowned", or the round he went out in. */
export function royalOutcome(royal: RoyalResult, rounds: number): string {
  if (royal.crowned) return 'Crowned';
  const out = royal.matches.length - 1;
  return out < 0 ? 'No matches played' : `Out in the ${knockoutRound(out, rounds).toLowerCase()}`;
}

/** Stat levels lost between two seasons' ends, only the falls: age's toll. */
export function levelsLost(
  before: Attributes | undefined,
  after: Attributes,
): { stat: Attribute; levels: number }[] {
  if (!before) return [];
  return ATTRIBUTES.map((stat) => ({ stat, levels: levelOf(before, stat) - levelOf(after, stat) })).filter(
    (l) => l.levels > 0,
  );
}

/** Each run of seasons at one club, in order: a club left and rejoined counts twice. */
export interface Spell {
  readonly club: string;
  readonly from: number;
  readonly to: number;
}

export function clubSpells(history: readonly SeasonSummary[]): Spell[] {
  const spells: Spell[] = [];
  for (const s of history) {
    const last = spells.at(-1);
    if (last?.club === s.club && last.to === s.season - 1)
      spells[spells.length - 1] = { ...last, to: s.season };
    else spells.push({ club: s.club, from: s.season, to: s.season });
  }
  return spells;
}

/** Seasons are counted from 1 on screen. */
export const seasonLabel = (season: number): string => `Season ${season + 1}`;

/** The royal tournament's rounds, as the core plays them. */
const ROYAL_ROUNDS = ROYAL_RIVAL_TIERS.length;

// Pieces ---------------------------------------------------------------------------------------------

const CROWN = '<path d="M3 18 2 6.5l5.5 4.5L12 3.5l4.5 7.5L22 6.5 21 18z"/><path d="M3 19.5h18V22H3z"/>';
const STAT_ICONS: Readonly<Record<Attribute, string>> = {
  pace: '<path d="M3 5h7l-3 7h5l-7 9 2-7H3z"/><path d="M14 6h7M15 11h6M14 16h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  shot: '<circle cx="15" cy="12" r="6"/><path d="M2 9h6M1 12h6M2 15h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  strength: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/>',
  stamina: '<path d="M12 21 3.5 12.5a5 5 0 0 1 7.1-7.1L12 6.8l1.4-1.4a5 5 0 0 1 7.1 7.1z"/>',
};

const glyph = (path: string, cls = 'cv-glyph'): SVGElement =>
  svg(`<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${path}</svg>`);

/** A small shield in the club's colour with its charge, as the league tables draw a house. */
export const clubShield = (clubId: string): HTMLElement => houseShield(clubById(clubId));

/** The club's arms as a large gold-rimmed shield. */
export const clubCrest = (clubId: string, size: 'md' | 'lg' = 'lg'): HTMLElement => {
  const club = clubById(clubId);
  return h(
    'span',
    { class: `cv-crest is-${size}`, attrs: { style: `--c: ${club.colour}`, 'aria-hidden': 'true' } },
    crest(club),
  );
};

const clubName = (clubId: string): string => clubById(clubId).name;

/** A rating in its full-time colour band. */
const ratingChip = (rating: number, small = false): HTMLElement =>
  h('span', { class: `rt-score ${ratingBand(rating)}${small ? ' is-chip' : ''}`, text: shownRating(rating) });

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const pointsText = (n: number): string => plural(n, 'point');

const tile = (label: string, value: Node | string, note?: string): HTMLElement =>
  h(
    'div',
    { class: 'cv-tile' },
    h('dt', { text: label }),
    h(
      'dd',
      {},
      typeof value === 'string' ? h('b', { text: value }) : value,
      note && h('small', { text: note }),
    ),
  );

function portraitCanvas(
  look: Look,
  colour: string,
  width: number,
  height: number,
  cls = 'cv-portrait',
): HTMLCanvasElement {
  const canvas = h('canvas', { class: cls, attrs: { 'aria-hidden': 'true' } });
  drawPortrait(canvas, look, colour, { width, height });
  return canvas;
}

/** ★★★½☆ and the number beside it, read out as "3.5 stars of 5". */
const starLine = (stars: number): HTMLElement =>
  h(
    'span',
    { class: 'cv-stars', attrs: { role: 'img', 'aria-label': `${starScore(stars)} stars of 5` } },
    h('span', { class: 'stars', text: starText(stars), attrs: { 'aria-hidden': 'true' } }),
    h('b', { text: starScore(stars), attrs: { 'aria-hidden': 'true' } }),
  );

const panelTitle = (text: string, note?: string): HTMLElement =>
  h('h3', { class: 'panel-title' }, text, note && h('small', { class: 'panel-note', text: note }));

const HONOUR_NAMES: Readonly<Record<Honour, string>> = {
  title: 'League title',
  promotion: 'Promotion',
  topScorer: 'Golden Boot',
  royalCall: 'Royal call-up',
  royalCrown: 'Royal crown',
};

function honourIcon(honour: Honour): SVGElement {
  switch (honour) {
    case 'title':
      return icon('cup');
    case 'promotion':
      return glyph('<path d="M12 3 21 12h-5.5v9h-7v-9H3z"/>');
    case 'topScorer':
      return icon('ball');
    case 'royalCall':
      return icon('helm');
    case 'royalCrown':
      return glyph(CROWN);
  }
}

const honourBadge = (honour: Honour, label = HONOUR_NAMES[honour]): HTMLElement =>
  h('span', { class: `cv-honour is-${honour}` }, honourIcon(honour), h('span', { text: label }));

/** Lozenges in the club's colours over the view, once it is on the page; never under reduced motion. */
function burstOver(view: HTMLElement, colours: readonly string[]): void {
  if (reducedMotion()) return;
  const fx = h('div', { class: 'fx cv-fx', attrs: { 'aria-hidden': 'true' } });
  view.append(fx);
  [0, 650, 1300].forEach((ms, i) => {
    window.setTimeout(() => {
      if (!fx.isConnected) return;
      lozengeBurst(fx, fx.clientWidth * ([0.5, 0.25, 0.75][i] ?? 0.5), fx.clientHeight * 0.25, colours);
    }, ms + 120);
  });
}

// Upgrades -------------------------------------------------------------------------------------------

export interface UpgradeActions {
  /** Every purchase: the new state, to save. */
  onChange(next: CareerState): void;
  onDone(): void;
}

function levelPips(stat: Attribute, level: number, mark: { next: boolean; wear: number }): HTMLElement {
  const cap = ATTRIBUTE_CAPS[stat];
  return h(
    'span',
    {
      class: 'cv-pips',
      attrs: { role: 'img', 'aria-label': `Level ${level} of ${cap}`, style: `--cap: ${cap}` },
    },
    ...Array.from({ length: cap }, (_, i) => {
      const cls = [
        'cv-pip',
        i < level && 'is-on',
        mark.next && i === level && 'is-next',
        i < level && i >= level - mark.wear && 'is-wearing',
      ];
      return h('i', { class: cls.filter(Boolean).join(' ') });
    }),
  );
}

function trainNote(state: TrainState): string {
  switch (state.kind) {
    case 'ready':
      return `Next level: ${pointsText(state.cost)}`;
    case 'short':
      return `Next level: ${pointsText(state.cost)}`;
    case 'cap':
      return 'At its cap';
    case 'aged':
      return 'Past training';
  }
}

function statCard(
  player: CareerPlayer,
  stat: Attribute,
  buy: (stat: Attribute, kind: 'train' | 'guard') => void,
): HTMLElement {
  const level = levelOf(player.attributes, stat);
  const cap = ATTRIBUTE_CAPS[stat];
  const training = trainState(player, stat);
  const guarding = guardState(player, stat);
  const trains = training.kind !== 'aged';
  const guards = guarding.kind !== 'early';
  const wear = guards ? wearPreview(player, stat) : null;
  const guarded = guarding.kind === 'guarded';
  const stars = starsPreview(player.look.build, player.attributes, stat);
  const name = STAT_NAMES[stat];

  const trainButton =
    trains &&
    h(
      'button',
      {
        class: 'btn cv-buy',
        attrs: {
          type: 'button',
          'data-stat': stat,
          'data-kind': 'train',
          ...(training.kind === 'ready' ? {} : { disabled: '' }),
        },
        on: {
          click: () => {
            buy(stat, 'train');
          },
        },
      },
      training.kind === 'cap' ? `${name} maxed` : `Train ${name.toLowerCase()}`,
      training.kind !== 'cap' && h('small', { text: pointsText(training.cost) }),
    );
  const guardButton =
    guards &&
    h(
      'button',
      {
        class: `btn cv-buy is-guard${guarded ? ' is-done' : ''}`,
        attrs: {
          type: 'button',
          'data-stat': stat,
          'data-kind': 'guard',
          ...(guarding.kind === 'ready' ? {} : { disabled: '' }),
        },
        on: {
          click: () => {
            buy(stat, 'guard');
          },
        },
      },
      guarded ? `${name} guarded` : `Guard ${name.toLowerCase()}`,
      (guarding.kind === 'ready' || guarding.kind === 'short') &&
        h('small', { text: pointsText(guarding.cost) }),
    );

  const reason =
    training.kind === 'short' && !guards
      ? `${pointsText(training.cost - player.points)} short`
      : guarding.kind === 'short' && !trains
        ? `${pointsText(guarding.cost - player.points)} short`
        : guarding.kind === 'bare' && !trains
          ? 'Nothing to wear away'
          : null;

  const wearLine =
    wear && h('p', { class: `cv-wear${wear.unguarded > 0 ? ' is-falling' : ''}` }, wearText(wear, guarded));

  const rising = trains && training.kind !== 'cap';
  return h(
    'article',
    {
      class: `cv-stat${guarded ? ' is-guarded' : ''}`,
      attrs: { 'aria-label': `${name}, level ${level} of ${cap}` },
    },
    h(
      'header',
      { class: 'cv-stat-head' },
      h('span', { class: `cv-stat-icon is-${stat}` }, glyph(STAT_ICONS[stat])),
      h('h4', { text: name }),
      h('span', { class: 'cv-level', text: `${level}/${cap}` }),
    ),
    levelPips(stat, level, {
      next: rising,
      wear: wear && !guarded ? wear.unguarded : (wear?.guarded ?? 0),
    }),
    h('p', { class: 'cv-effect', text: effectPerLevel(stat) }),
    h('p', { class: 'cv-now', text: `Now: ${effectNow(stat, level)}` }),
    rising &&
      h(
        'p',
        { class: 'cv-preview' },
        h('span', { text: trainNote(training) }),
        h(
          'span',
          {
            class: 'cv-to',
            attrs: { 'aria-label': `Stars ${starScore(stars.now, 2)} to ${starScore(stars.next, 2)}` },
          },
          `★ ${starScore(stars.now, 2)}`,
          h('i', { text: '→', attrs: { 'aria-hidden': 'true' } }),
          h('b', { text: starScore(stars.next, 2) }),
        ),
      ),
    wearLine,
    h('div', { class: 'cv-buys' }, trainButton, guardButton),
    reason && h('p', { class: 'cv-reason', text: reason }),
  );
}

function yardIntro(player: CareerPlayer): HTMLElement | null {
  const nextAge = player.age + 1;
  if (canTrain(player.age) && !canGuard(player.age)) return null;
  const text = canTrain(player.age)
    ? `At ${nextAge} his stats begin to wear each season. This is the last summer points raise them; a guard bought now halves next season's wear on that stat.`
    : `From ${DECLINE_AGE} a knight's stats wear each season, and points no longer raise them. They guard one instead: a guarded stat wears half as fast next season. A guard lasts one season.`;
  return h(
    'p',
    { class: 'cv-guard-note' },
    h('b', { text: canTrain(player.age) ? 'The last summer of growth' : 'Guarding, not training' }),
    h('span', { text }),
  );
}

/** The training yard: levels bought with trainPlayer and, from 30, guards with guardPlayer. Re-renders itself after
 * each purchase and hands the new state to onChange to save; onDone leaves. */
export function upgradesView(career: CareerState, actions: UpgradeActions): HTMLElement {
  let current = career;
  const view = h('section', { class: 'cv cv-upgrades', attrs: { 'aria-label': 'Training yard' } });
  const live = h('p', { class: 'visually-hidden', attrs: { 'aria-live': 'polite' } });

  const buy = (stat: Attribute, kind: 'train' | 'guard'): void => {
    current = kind === 'train' ? trainPlayer(current, stat) : guardPlayer(current, stat);
    actions.onChange(current);
    const p = current.player;
    live.textContent =
      kind === 'train'
        ? `${STAT_NAMES[stat]} raised to level ${levelOf(p.attributes, stat)}. ${pointsText(p.points)} left.`
        : `${STAT_NAMES[stat]} guarded for next season. ${pointsText(p.points)} left.`;
    render();
    // Focus stays where the hand was, or falls to Done when that button is spent.
    const again = view.querySelector<HTMLButtonElement>(`[data-stat="${stat}"][data-kind="${kind}"]:enabled`);
    (again ?? view.querySelector<HTMLButtonElement>('.cv-done'))?.focus();
  };

  function render(): void {
    const { player } = current;
    const club = clubById(player.club);
    const stars = overallStars(player.look.build, player.attributes);
    const guarding = !canTrain(player.age);
    const head = h(
      'div',
      { class: 'cv-yard-head panel' },
      portraitCanvas(player.look, club.colour, 92, 108),
      h(
        'div',
        { class: 'cv-who' },
        h('p', { class: 'ribbon', text: guarding ? 'Guard your strength' : 'Training yard' }),
        h('h3', { text: player.look.name }),
        h(
          'p',
          { class: 'cv-sub' },
          clubShield(player.club),
          h('span', { text: `${ROLE_NAMES[player.position]} · ${club.name} · age ${player.age}` }),
        ),
        starLine(stars),
      ),
      h(
        'p',
        { class: 'cv-purse', attrs: { 'aria-label': `${pointsText(player.points)} to spend` } },
        h('b', { text: String(player.points) }),
        h('span', { text: player.points === 1 ? 'point to spend' : 'points to spend' }),
        h('small', { text: 'Earned by match ratings and honours' }),
      ),
    );
    view.replaceChildren(
      head,
      yardIntro(player) ?? '',
      h('div', { class: 'cv-stats' }, ...ATTRIBUTES.map((stat) => statCard(player, stat, buy))),
      h(
        'div',
        { class: 'cup-actions' },
        button(
          'Done',
          () => {
            actions.onDone();
          },
          'btn-primary cv-done',
        ),
      ),
      live,
    );
  }

  render();
  return view;
}

// Offers ---------------------------------------------------------------------------------------------

const PLACE_TEXT: Readonly<Record<Place, string>> = {
  first: 'First choice',
  contest: 'A fight for the place',
  bench: 'The bench, to begin',
};

function moveText(from: Division, to: Division): string {
  if (to > from) return `Up to the ${DIVISION_NAMES[to]}`;
  if (to < from) return `Down to the ${DIVISION_NAMES[to]}`;
  return `Stays in the ${DIVISION_NAMES[to]}`;
}

/** The offer card: a big button that picks the club; nothing is signed until the confirm button. */
function offerCard(
  career: CareerState,
  clubId: string,
  division: Division,
  stay: boolean,
  pick: () => void,
): HTMLElement {
  const { player, world } = career;
  const club = clubById(clubId);
  const level = clubLevel(world, clubId);
  const strength = matchStrength(player.look.build, player.attributes);
  const incumbent = placeLevel(world, clubId, player.position);
  const place = placeAt(strength, incumbent);
  const from = playerDivision(career);
  const role = ROLE_NAMES[player.position].toLowerCase();
  const placeNote =
    player.position === 'gk'
      ? `Measured against their starting four, a ${skillFor(incumbent).name} side`
      : `Their ${role} is a ${skillFor(incumbent).name}`;
  return h(
    'button',
    {
      class: `cv-offer${stay ? ' is-stay' : ''}`,
      attrs: {
        type: 'button',
        'aria-pressed': 'false',
        'data-club': clubId,
        style: `--c: ${club.colour}`,
      },
      on: { click: pick },
    },
    h('span', { class: 'cv-offer-band', attrs: { 'aria-hidden': 'true' } }),
    h(
      'span',
      { class: 'cv-offer-head' },
      clubCrest(clubId, 'md'),
      h(
        'span',
        { class: 'cv-offer-title' },
        h('b', { class: 'cv-offer-name', text: club.name }),
        stay && h('small', { class: 'you-tag', text: 'Your club' }),
        h(
          'span',
          { class: `cv-move${division > from ? ' is-up' : division < from ? ' is-down' : ''}` },
          stay ? `Stay · ${DIVISION_NAMES[division]}` : moveText(from, division),
        ),
      ),
    ),
    h(
      'dl',
      { class: 'cv-offer-facts' },
      h('dt', { text: 'Side' }),
      h(
        'dd',
        {},
        h('span', { class: 'stars', text: starText(level), attrs: { 'aria-hidden': 'true' } }),
        h('span', { text: `${skillFor(level).name} level` }),
      ),
      h('dt', { text: 'Your role' }),
      h('dd', {}, h('span', { class: `cv-place is-${place}`, text: PLACE_TEXT[place] })),
    ),
    h('small', { class: 'cv-offer-note', text: placeNote }),
  );
}

/** The summer's offers and a stay option (career.review must be set). Picking a card selects it; the confirm button
 * calls nextSeason and hands back the new season and the club chosen, null for staying. */
export function offersView(
  career: CareerState,
  onDecide: (next: CareerState, club: string | null) => void,
): HTMLElement {
  const { player, review } = career;
  const offers = review?.offers ?? [];
  const home = player.club;
  let picked: string | null = offers[0]?.club ?? home;

  const confirm = button(
    '',
    () => {
      if (!review) return;
      const club = picked === home ? null : picked;
      onDecide(nextSeason(career, club), club);
    },
    'btn-primary',
  );
  const cards = [
    ...offers.map((o) => ({ club: o.club, division: o.division, stay: false })),
    { club: home, division: nextDivision(career, home), stay: true },
  ].map((o) =>
    offerCard(career, o.club, o.division, o.stay, () => {
      picked = o.club;
      sync();
    }),
  );

  function sync(): void {
    for (const card of cards) card.setAttribute('aria-pressed', String(card.dataset.club === picked));
    const name = picked ? clubName(picked) : '';
    confirm.textContent = picked === home ? `Stay at ${name}` : `Sign for ${name}`;
    confirm.disabled = !review;
  }
  sync();

  const lead = !review
    ? 'Offers come when the season is over.'
    : offers.length
      ? `${plural(offers.length, 'club')} ${offers.length === 1 ? 'wants' : 'want'} ${player.look.name} next season. Pick one, or stay where you are.`
      : `No club came calling this summer. ${clubName(home)} keep their ${ROLE_NAMES[player.position].toLowerCase()}.`;

  return h(
    'section',
    { class: 'cv cv-offers', attrs: { 'aria-label': 'Offers' } },
    h(
      'div',
      { class: 'cv-intro panel' },
      h('p', { class: 'ribbon', text: "The summer's offers" }),
      h('p', { class: 'cup-level', text: lead }),
    ),
    h(
      'div',
      { class: 'cv-offer-list', attrs: { role: 'group', 'aria-label': 'Clubs to choose from' } },
      ...cards,
    ),
    h('div', { class: 'cup-actions' }, confirm),
  );
}

// Season review --------------------------------------------------------------------------------------

interface Headline {
  readonly ribbon: string;
  readonly title: string;
  readonly line: string;
  /** Worth the champion stage: an honour won. */
  readonly honour: Honour | null;
}

function headline(summary: SeasonSummary): Headline {
  const club = clubName(summary.club);
  const division = DIVISION_NAMES[summary.division];
  const up = DIVISION_NAMES[clamp(summary.division + 1, 0, TOP_DIVISION) as Division];
  const finished = `${club} finish ${ordinal(summary.finish)} in the ${division}`;
  switch (seasonVerdict(summary)) {
    case 'crown':
      return {
        ribbon: 'Crowned',
        title: 'Crowned for the realm',
        line: `The royal side won the royal tournament. ${finished}.`,
        honour: 'royalCrown',
      };
    case 'royal':
      return {
        ribbon: 'Royal call-up',
        title: 'Called to the royal squad',
        line: `${finished}, and the realm came calling.`,
        honour: 'royalCall',
      };
    case 'title':
      return {
        ribbon: 'Champions',
        title: `${division} champions`,
        line:
          summary.division < TOP_DIVISION
            ? `${club} top the ${division} and go up to the ${up}.`
            : `${club} are the finest house in the realm.`,
        honour: 'title',
      };
    case 'promotion':
      return {
        ribbon: 'Promoted',
        title: `Up to the ${up}`,
        line: `${club} finish ${ordinal(summary.finish)} and go up.`,
        honour: 'promotion',
      };
    case 'boot':
      return {
        ribbon: 'Golden Boot',
        title: 'Top scorer',
        line: `${finished}, and nobody scored more.`,
        honour: 'topScorer',
      };
    case 'relegated':
      return {
        ribbon: 'Relegated',
        title: `Finished ${ordinal(summary.finish)}`,
        line: `${club} go down to the ${DIVISION_NAMES[(summary.division - 1) as Division]}.`,
        honour: null,
      };
    case 'finish':
      return {
        ribbon: 'Season over',
        title: `Finished ${ordinal(summary.finish)}`,
        line: `${club} finish ${ordinal(summary.finish)} of 8 in the ${division}.`,
        honour: null,
      };
  }
}

/** "9 started · 3 off the bench · subbed off twice", or nothing when he started every one and played them out. */
export function appsNote(summary: SeasonSummary): string | undefined {
  const parts = [
    summary.subOns > 0 && `${summary.starts} started`,
    summary.subOns > 0 && `${summary.subOns} off the bench`,
    summary.subOffs > 0 && `taken off ${summary.subOffs === 1 ? 'once' : `${summary.subOffs} times`}`,
  ].filter((p): p is string => typeof p === 'string');
  return parts.length ? parts.join(' · ') : undefined;
}

function seasonNumbers(career: CareerState, summary: SeasonSummary): HTMLElement {
  const best = bestMatch(career, summary.division, summary.club);
  const bestNote = best
    ? `${best.score[0] > best.score[1] ? 'Won' : best.score[0] < best.score[1] ? 'Lost' : 'Drew'} ${best.score[0]}–${best.score[1]} v ${clubName(best.opponent)}, matchday ${best.matchday + 1}`
    : undefined;
  return h(
    'section',
    { class: 'cv-panel panel' },
    panelTitle('Your season', `${ROLE_NAMES[summary.position]} · ${clubName(summary.club)}`),
    h(
      'dl',
      { class: 'cv-tiles' },
      tile('Apps', String(summary.apps), appsNote(summary)),
      tile('Goals', String(summary.goals)),
      tile('Assists', String(summary.assists)),
      tile('Man of the match', String(summary.motm)),
      tile('Average', summary.average === null ? '–' : ratingChip(summary.average)),
      tile('Best match', best ? ratingChip(best.rating) : '–', bestNote),
    ),
  );
}

function honoursPanel(summary: SeasonSummary): HTMLElement {
  return h(
    'section',
    { class: 'cv-panel panel' },
    panelTitle('Honours'),
    summary.honours.length
      ? h(
          'ul',
          { class: 'cv-honours' },
          ...summary.honours.map((honour) =>
            h(
              'li',
              {},
              honourBadge(
                honour,
                honour === 'title' ? `${DIVISION_NAMES[summary.division]} title` : HONOUR_NAMES[honour],
              ),
              h('small', { text: `+${pointsText(HONOUR_POINTS[honour][summary.division])}` }),
            ),
          ),
        )
      : h('p', {
          class: 'md-empty',
          text: 'None this season. Ratings and goals still earn points and fame.',
        }),
  );
}

function pointsPanel(career: CareerState, summary: SeasonSummary): HTMLElement {
  const total = summary.matchPoints + summary.honourPoints;
  const before = career.history.at(-2)?.fame ?? 0;
  const gain = Math.round(summary.fame) - Math.round(before);
  return h(
    'section',
    { class: 'cv-panel panel' },
    panelTitle('Points and fame'),
    h(
      'dl',
      { class: 'cv-sum' },
      h('dt', { text: 'From match ratings' }),
      h('dd', { text: String(summary.matchPoints) }),
      h('dt', { text: 'From honours' }),
      h('dd', { text: String(summary.honourPoints) }),
      h('dt', { class: 'is-total', text: 'Earned this season' }),
      h('dd', { class: 'is-total', text: String(total) }),
      h('dt', { text: 'Points to spend' }),
      h('dd', { text: String(career.player.points) }),
    ),
    h(
      'div',
      { class: 'cv-fame' },
      h(
        'p',
        {},
        h('span', { text: 'Fame' }),
        h('b', { text: String(Math.round(summary.fame)) }),
        h('small', {
          class: gain >= 0 ? 'is-up' : 'is-down',
          text: `${gain >= 0 ? '+' : '−'}${Math.abs(gain)}`,
        }),
      ),
      h(
        'span',
        {
          class: 'cv-meter',
          attrs: {
            role: 'meter',
            'aria-label': 'Fame',
            'aria-valuemin': '0',
            'aria-valuemax': String(FAME_MAX),
            'aria-valuenow': String(Math.round(summary.fame)),
            style: `--v: ${(summary.fame / FAME_MAX) * 100}%; --was: ${(Math.min(before, summary.fame) / FAME_MAX) * 100}%`,
          },
        },
        h('i'),
      ),
      h('small', { class: 'cv-hint', text: 'Fame fades a little each summer and draws better offers.' }),
    ),
  );
}

function agePanel(career: CareerState, summary: SeasonSummary): HTMLElement {
  const { player } = career;
  const nextAge = summary.age + 1;
  const lost = levelsLost(career.history.at(-2)?.attributes, summary.attributes);
  const coming = ATTRIBUTES.map((stat) => ({ stat, levels: wearPreview(player, stat).unguarded })).filter(
    (w) => w.levels > 0,
  );
  const listed = (items: { stat: Attribute; levels: number }[]): string =>
    items.map((l) => `${STAT_NAMES[l.stat]} −${l.levels}`).join(', ');
  const line =
    nextAge < DECLINE_AGE - 1
      ? `${nextAge} next season, ${DECLINE_AGE - nextAge} years before age starts to tell.`
      : nextAge === DECLINE_AGE - 1
        ? `${nextAge} next season. The year after, his stats begin to wear; guards go on sale this summer.`
        : coming.length
          ? `${nextAge} next season. Unguarded, age will cost ${listed(coming)}.`
          : `${nextAge} next season. Age wears at him, though no stat drops a whole level yet.`;
  return h(
    'section',
    { class: 'cv-panel panel' },
    panelTitle('Age'),
    h('p', { class: 'cv-age' }, h('b', { text: String(summary.age) }), h('span', { text: line })),
    lost.length > 0 && h('p', { class: 'cv-wear is-falling', text: `This season age took ${listed(lost)}.` }),
  );
}

function royalLine(royal: RoyalResult): HTMLElement {
  const wins = royal.matches.filter((m) => m.score[0] > m.score[1]).length;
  return h(
    'section',
    { class: `cv-panel cv-royal-call panel${royal.crowned ? ' is-crowned' : ''}` },
    h(
      'span',
      { class: 'cv-royal-mark' },
      glyph(royal.crowned ? CROWN : '<path d="M5 20v-7a7 7 0 0 1 14 0v7z"/>'),
    ),
    h(
      'p',
      {},
      h('b', { text: royal.crowned ? 'Crowned with the royal squad' : 'Called to the royal squad' }),
      h('span', {
        text: royal.crowned
          ? `${plural(wins, 'win')} from ${plural(royal.matches.length, 'match', 'matches')}: the crown comes home.`
          : `${plural(wins, 'win')} in ${plural(royal.matches.length, 'match', 'matches')} at the royal tournament · ${royalOutcome(royal, Math.max(ROYAL_ROUNDS, royal.matches.length))}.`,
      }),
    ),
  );
}

/** The season just ended (the last history entry, with career.review): finish, his numbers, honours, points, fame,
 * age and wear, and the royal call. A proud season gets the champion stage. */
export function seasonReviewView(career: CareerState, onContinue: () => void): HTMLElement {
  const summary = career.history.at(-1);
  const view = h('section', { class: 'cv cv-review', attrs: { 'aria-label': 'Season review' } });
  if (!summary) {
    view.append(
      h(
        'div',
        { class: 'cup-verdict panel' },
        h('p', { class: 'ribbon', text: 'No season yet' }),
        h('p', { class: 'cup-level', text: 'The review comes when a season is over.' }),
        h('div', { class: 'cup-actions' }, button('Continue', onContinue, 'btn-primary')),
      ),
    );
    return view;
  }
  const club = clubById(summary.club);
  const say = headline(summary);
  const meta = h(
    'p',
    { class: 'cv-meta' },
    clubShield(summary.club),
    h('span', { text: `${club.name} · ${DIVISION_NAMES[summary.division]} · age ${summary.age}` }),
  );
  const actions = h('div', { class: 'cup-actions' }, button('Continue', onContinue, 'btn-primary'));
  const ribbon = h('p', { class: 'ribbon', text: `${seasonLabel(summary.season)} · ${say.ribbon}` });
  const line = h('p', { class: 'cup-level', text: say.line });
  const top = say.honour
    ? h(
        'div',
        { class: 'cup-champion cv-hero panel' },
        ribbon,
        h(
          'div',
          { class: 'champion-stage' },
          h('span', { class: 'champion-cup' }, honourIcon(say.honour)),
          h(
            'div',
            { class: 'plinth', attrs: { style: `--house: ${club.colour}` } },
            h('div', { class: 'plinth-shield' }),
            portraitCanvas(career.player.look, club.colour, 172, 196, 'home-portrait'),
          ),
          h('span', { class: 'champion-cup' }, honourIcon(say.honour)),
        ),
        h('h2', { class: 'metal cup-title', text: say.title, attrs: { 'data-text': say.title } }),
        line,
        meta,
        actions,
      )
    : h(
        'div',
        { class: 'cup-verdict cv-hero panel' },
        ribbon,
        h(
          'div',
          { class: 'cv-hero-row' },
          clubCrest(summary.club, 'md'),
          h('h2', { class: 'verdict', text: say.title }),
        ),
        line,
        meta,
        actions,
      );
  const royal = career.review?.royal ?? null;
  view.append(
    top,
    seasonNumbers(career, summary),
    h('div', { class: 'cv-pair' }, honoursPanel(summary), pointsPanel(career, summary)),
    royal ? royalLine(royal) : '',
    agePanel(career, summary),
  );
  if (say.honour) burstOver(view, ['#ffe39a', '#f2c14e', '#fff6d0', club.colour]);
  return view;
}

// Records --------------------------------------------------------------------------------------------

const SEASON_COLUMNS = [
  ['Season', 'Season'],
  ['Age', 'Age'],
  ['Club', 'Club'],
  ['Division', 'Division'],
  ['Pos', 'League position'],
  ['Apps', 'Appearances'],
  ['G', 'Goals'],
  ['A', 'Assists'],
  ['Avg', 'Average rating'],
  ['Honours', 'Honours'],
] as const;

const COLUMN_CLASS: Partial<Record<string, string>> = {
  Club: 'col-club',
  Division: 'col-div',
  Honours: 'col-honours',
};

function seasonRow(s: SeasonSummary): HTMLElement {
  const moved = s.honours.includes('promotion') || (s.honours.includes('title') && s.division < TOP_DIVISION);
  return h(
    'tr',
    {},
    h('th', { attrs: { scope: 'row' }, text: String(s.season + 1) }),
    h('td', { text: String(s.age) }),
    h(
      'td',
      { class: 'col-club' },
      h('span', { class: 'cv-club' }, clubShield(s.club), h('span', { text: clubName(s.club) })),
    ),
    h('td', { class: 'col-div', text: DIVISION_NAMES[s.division] }),
    h(
      'td',
      {},
      ordinal(s.finish),
      moved && h('span', { class: 'move is-up', text: ' ▲', attrs: { 'aria-label': ', promoted' } }),
      s.relegated && h('span', { class: 'move is-down', text: ' ▼', attrs: { 'aria-label': ', relegated' } }),
    ),
    h('td', { text: String(s.apps) }),
    h('td', { text: String(s.goals) }),
    h('td', { text: String(s.assists) }),
    h('td', {}, s.average === null ? '–' : ratingChip(s.average, true)),
    h(
      'td',
      { class: 'col-honours' },
      s.honours.length
        ? h(
            'span',
            { class: 'cv-honour-icons' },
            ...s.honours.map((honour) =>
              h(
                'span',
                { class: `cv-honour-icon is-${honour}`, attrs: { title: HONOUR_NAMES[honour] } },
                honourIcon(honour),
                h('span', { class: 'visually-hidden', text: HONOUR_NAMES[honour] }),
              ),
            ),
          )
        : '–',
    ),
  );
}

function historyTable(history: readonly SeasonSummary[]): HTMLElement {
  const title = 'Season by season';
  return h(
    'section',
    { class: 'cv-panel panel' },
    panelTitle(title),
    h(
      'div',
      { class: 'cv-scroll', attrs: { role: 'region', 'aria-label': title, tabindex: '0' } },
      h(
        'table',
        { class: 'cv-table' },
        h('caption', { class: 'visually-hidden', text: title }),
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...SEASON_COLUMNS.map(([text, label]) =>
              h(
                'th',
                { attrs: { scope: 'col' }, class: COLUMN_CLASS[text] ?? '' },
                text === label ? text : h('abbr', { text, attrs: { title: label } }),
              ),
            ),
          ),
        ),
        h('tbody', {}, ...[...history].reverse().map(seasonRow)),
      ),
    ),
  );
}

function bestTile(
  label: string,
  best: Best | null,
  history: readonly SeasonSummary[],
  rating = false,
): HTMLElement {
  if (!best) return tile(label, '–');
  const season = history.find((s) => s.season === best.season);
  const note = `${seasonLabel(best.season)}${season ? ` · ${clubName(season.club)}` : ''}`;
  return tile(label, rating ? ratingChip(best.value) : String(best.value), note);
}

/** Career totals, season bests, the trophy cabinet, the season-by-season table and every club he played for. */
export function recordsView(career: CareerState, onBack: () => void): HTMLElement {
  const { history, player } = career;
  const records = careerRecords(history);
  const view = h('section', { class: 'cv cv-records', attrs: { 'aria-label': 'Career records' } });
  const back = h('div', { class: 'cup-actions' }, button('Back', onBack, 'btn-primary'));
  if (!history.length) {
    view.append(
      h(
        'div',
        { class: 'cup-verdict panel' },
        h('p', { class: 'ribbon', text: 'Records' }),
        h('p', {
          class: 'cup-level',
          text: 'The book is still blank. Finish a season and it starts to fill.',
        }),
        back,
      ),
    );
    return view;
  }
  const spells = clubSpells(history);
  const cabinet = HONOURS.filter((honour) => records.honours[honour] > 0);
  view.append(
    h(
      'section',
      { class: 'cv-panel cv-ledger panel' },
      h('p', { class: 'ribbon', text: `The career of ${player.look.name}` }),
      h(
        'dl',
        { class: 'cv-tiles is-totals' },
        tile('Seasons', String(records.seasons)),
        tile('Apps', String(records.apps)),
        tile('Goals', String(records.goals)),
        tile('Assists', String(records.assists)),
        tile('Man of the match', String(records.motm)),
        tile('Average', records.average === null ? '–' : ratingChip(records.average)),
        tile('Trophies', String(records.trophies)),
      ),
    ),
    h(
      'div',
      { class: 'cv-pair' },
      h(
        'section',
        { class: 'cv-panel panel' },
        panelTitle('Season bests'),
        h(
          'dl',
          { class: 'cv-tiles is-bests' },
          bestTile('Goals', records.best.goals, history),
          bestTile('Assists', records.best.assists, history),
          bestTile('Man of the match', records.best.motm, history),
          bestTile('Average', records.best.average, history, true),
        ),
      ),
      h(
        'section',
        { class: 'cv-panel panel' },
        panelTitle('Trophy cabinet'),
        cabinet.length
          ? h(
              'ul',
              { class: 'cv-honours' },
              ...cabinet.map((honour) =>
                h(
                  'li',
                  {},
                  honourBadge(honour),
                  h('b', { class: 'cv-count', text: `× ${records.honours[honour]}` }),
                ),
              ),
            )
          : h('p', { class: 'md-empty', text: 'Empty for now. Titles, Golden Boots and crowns land here.' }),
      ),
    ),
    historyTable(history),
    h(
      'section',
      { class: 'cv-panel panel' },
      panelTitle('Clubs', plural(records.clubs.length, 'club')),
      h(
        'ol',
        { class: 'cv-spells' },
        ...spells.map((spell) => {
          const seasons = spell.to - spell.from + 1;
          return h(
            'li',
            { class: spell.club === player.club ? 'is-now' : '' },
            clubCrest(spell.club, 'md'),
            h('b', { text: clubName(spell.club) }),
            h('small', {
              text: seasons === 1 ? seasonLabel(spell.from) : `Seasons ${spell.from + 1}–${spell.to + 1}`,
            }),
          );
        }),
      ),
    ),
    back,
  );
  return view;
}

// Royal ----------------------------------------------------------------------------------------------

function royalKnight(career: CareerState, id: string): { name: string; club: string | null; you: boolean } {
  if (id === PLAYER_ID) return { name: career.player.look.name, club: career.player.club, you: true };
  for (const [club, squad] of Object.entries(career.world.squads)) {
    const knight = squad.find((k) => k.id === id);
    if (knight) return { name: knight.look.name, club, you: false };
  }
  return { name: 'A royal knight', club: null, you: false };
}

/** The royal knockout in career.review: each round, his ratings, the royal four, and the crown if won. */
export function royalView(career: CareerState, onDone: () => void): HTMLElement {
  const royal = career.review?.royal ?? null;
  const view = h('section', { class: 'cv cv-royal', attrs: { 'aria-label': 'The royal tournament' } });
  const done = h('div', { class: 'cup-actions' }, button('Continue', onDone, 'btn-primary'));
  if (!royal) {
    view.append(
      h(
        'div',
        { class: 'cup-verdict panel' },
        h('p', { class: 'ribbon', text: 'The royal tournament' }),
        h('p', {
          class: 'cup-level',
          text: 'No call this season. The best four in the Great Houses go to the royal tournament.',
        }),
        done,
      ),
    );
    return view;
  }
  const rounds = Math.max(ROYAL_ROUNDS, royal.matches.length);
  const club = clubById(career.player.club);
  const average = royal.matches.length
    ? royal.matches.reduce((s, m) => s + m.rating, 0) / royal.matches.length
    : null;
  const goals = royal.matches.reduce((s, m) => s + m.goals, 0);

  const hero = royal.crowned
    ? h(
        'div',
        { class: 'cup-champion cv-hero panel' },
        h('p', { class: 'ribbon', text: 'The royal tournament' }),
        h(
          'div',
          { class: 'champion-stage' },
          h('span', { class: 'champion-cup' }, glyph(CROWN)),
          h(
            'div',
            { class: 'plinth', attrs: { style: `--house: ${club.colour}` } },
            h('div', { class: 'plinth-shield' }),
            portraitCanvas(career.player.look, club.colour, 172, 196, 'home-portrait'),
          ),
          h('span', { class: 'champion-cup' }, glyph(CROWN)),
        ),
        h('h2', { class: 'metal cup-title', text: 'Crowned', attrs: { 'data-text': 'Crowned' } }),
        h('p', {
          class: 'cup-level',
          text: `Three foreign sides, three wins. ${career.player.look.name} brings the crown home for the realm.`,
        }),
        done,
      )
    : h(
        'div',
        { class: 'cup-verdict cv-hero panel' },
        h('p', { class: 'ribbon', text: 'The royal tournament' }),
        h('h2', { class: 'verdict', text: royalOutcome(royal, rounds) }),
        h('p', {
          class: 'cup-level',
          text: 'Called up with the realm’s finest to face the foreign sides. The crown waits for another year.',
        }),
        done,
      );

  const roundRow = (i: number): HTMLElement => {
    const m = royal.matches[i];
    const name = knockoutRound(i, rounds);
    if (!m)
      return h(
        'li',
        { class: 'cv-round is-unplayed' },
        h('span', { class: 'cv-round-name', text: name }),
        h('span', { class: 'cv-round-score', text: 'Not reached' }),
      );
    const won = m.score[0] > m.score[1];
    return h(
      'li',
      { class: `cv-round ${won ? 'is-won' : 'is-lost'}` },
      h('span', { class: 'cv-round-name', text: name }),
      h(
        'span',
        { class: 'cv-round-score' },
        h('b', { text: `${m.score[0]}–${m.score[1]}` }),
        h('small', { text: won ? 'Won v a foreign side' : 'Lost to a foreign side' }),
      ),
      h(
        'span',
        { class: 'cv-round-you' },
        m.goals > 0 && h('small', { text: plural(m.goals, 'goal') }),
        m.motm && h('span', { class: 'rt-star', text: '★', attrs: { title: 'Man of the match' } }),
        m.motm && h('span', { class: 'visually-hidden', text: 'Man of the match' }),
        h('span', { class: 'visually-hidden', text: 'Your rating' }),
        ratingChip(m.rating),
      ),
    );
  };

  view.append(
    hero,
    h(
      'div',
      { class: 'cv-pair' },
      h(
        'section',
        { class: 'cv-panel panel' },
        panelTitle(
          'The knockout',
          average === null ? undefined : `Your average ${shownRating(average)} · ${plural(goals, 'goal')}`,
        ),
        h('ol', { class: 'cv-rounds' }, ...Array.from({ length: rounds }, (_, i) => roundRow(i))),
      ),
      h(
        'section',
        { class: 'cv-panel panel' },
        panelTitle('The royal four'),
        h(
          'ul',
          { class: 'cv-four' },
          ...royal.squad.map((id) => {
            const k = royalKnight(career, id);
            return h(
              'li',
              { class: k.you ? 'is-you' : '' },
              k.club ? clubShield(k.club) : '',
              h('b', { text: k.name }),
              k.you && h('small', { class: 'you-tag', text: 'You' }),
              k.club && h('small', { text: clubName(k.club) }),
            );
          }),
        ),
      ),
    ),
  );
  if (royal.crowned) burstOver(view, ['#ffe39a', '#f2c14e', '#fff6d0', club.colour]);
  return view;
}
