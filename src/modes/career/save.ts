import { TOP_TIER } from '../../ai/skills';
import { ATTRIBUTE_CAPS, ATTRIBUTES, type Attribute, type Attributes } from '../../game/attributes';
import type { Role } from '../../game/types';
import { normalizeLook, type Look } from '../../knight/look';
import { MAX_RATING, MIN_RATING } from '../../stats/ratings';
import {
  currentMatchday,
  fixtures,
  FIXTURES_PER_MATCHDAY,
  LEAGUE_SIZE,
  MATCHDAYS,
  normalizeLeague,
  table,
  type LeagueFixture,
  type LeagueState,
} from '../manager/league';
import { SQUAD_SIZE, STARTERS } from '../manager/types';
import { STAMINA_MAX, type Stamina } from '../manager/stamina';
import { SUBS_ALLOWED } from '../runner';
import {
  CAREER_VERSION,
  leagueHost,
  leagueSeed,
  OFFERS_MAX,
  PLAYER_ID,
  POSITIONS,
  ROYAL_PLACES,
  ROYAL_RIVAL_TIERS,
  START_AGE,
  type CareerGoal,
  type CareerPlayer,
  type CareerSub,
  type CareerSeason,
  type CareerState,
  type FixtureRecord,
  type Offer,
  type RoyalMatch,
  type RoyalResult,
  type SeasonReview,
  type SeasonSummary,
} from './career';
import { CLUB_IDS, DIVISIONS, sameName, type CareerKnight, type Division, type World } from './clubs';
import { FAME_MAX, HONOURS, type Honour } from './economy';
import { FORM_KEEP, type FormEntry } from './form';
import { promote } from './world';

/** Where a career is saved, apart from every other mode. */
export const CAREER_STORAGE_KEY = 'mobball.career.v2';

type Raw = Record<string, unknown>;

const record = (raw: unknown): Raw | null =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Raw) : null;
const isInt = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const isNum = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const isDivision = (x: unknown): x is Division => isInt(x, 0, DIVISIONS.length - 1);
const isRole = (x: unknown): x is Role =>
  typeof x === 'string' && (POSITIONS as readonly string[]).includes(x);
const isClub = (x: unknown): x is string => typeof x === 'string' && CLUB_IDS.includes(x);
const strings = (raw: unknown): string[] | null =>
  Array.isArray(raw) && raw.every((x): x is string => typeof x === 'string') ? raw : null;
const unique = (xs: readonly unknown[]): boolean => new Set(xs).size === xs.length;

function look(raw: unknown): Look | null {
  return record(raw) ? normalizeLook(raw) : null;
}

function attributes(raw: unknown, within: (stat: Attribute, x: unknown) => boolean): Attributes | null {
  const r = record(raw);
  if (!r || !ATTRIBUTES.every((a) => within(a, r[a]))) return null;
  return { pace: r.pace, shot: r.shot, strength: r.strength, stamina: r.stamina } as Attributes;
}
const levels = (raw: unknown) => attributes(raw, (a, x) => isInt(x, 0, ATTRIBUTE_CAPS[a]));
const wearOf = (raw: unknown) => attributes(raw, (_, x) => isNum(x, 0, 1) && x < 1);

const KNIGHT_ID = /^k(\d+)$/;

function knight(raw: unknown): CareerKnight | null {
  const r = record(raw);
  const face = look(r?.look);
  if (!r || !face || typeof r.id !== 'string' || !KNIGHT_ID.test(r.id)) return null;
  if (!isInt(r.tier, 0, TOP_TIER) || !isInt(r.age, 16, 60) || r.forged !== false) return null;
  return { id: r.id, look: face, tier: r.tier, forged: false, age: r.age };
}

function world(raw: unknown): World | null {
  const r = record(raw);
  const squadsRaw = record(r?.squads);
  if (!r || !squadsRaw || !Array.isArray(r.divisions) || r.divisions.length !== DIVISIONS.length) return null;
  const divisions = r.divisions.map(strings);
  if (!divisions.every((d): d is string[] => d !== null && d.length === LEAGUE_SIZE && d.every(isClub)))
    return null;
  if (!unique(divisions.flat()) || divisions.flat().length !== CLUB_IDS.length) return null;
  const squads: Record<string, CareerKnight[]> = {};
  for (const club of CLUB_IDS) {
    const squad = squadsRaw[club];
    if (!Array.isArray(squad) || squad.length !== SQUAD_SIZE) return null;
    const knights = squad.map(knight);
    if (!knights.every((k): k is CareerKnight => k !== null)) return null;
    squads[club] = knights;
  }
  const ids = Object.values(squads).flatMap((s) => s.map((k) => k.id));
  const top = Math.max(...ids.map((id) => Number(KNIGHT_ID.exec(id)?.[1])));
  if (Object.keys(squadsRaw).length !== CLUB_IDS.length || !unique(ids)) return null;
  if (!isInt(r.nextKnight, top + 1, Number.MAX_SAFE_INTEGER)) return null;
  return { divisions, squads, nextKnight: r.nextKnight };
}

function form(raw: unknown, from: number, to: number): FormEntry[] | null {
  if (!Array.isArray(raw) || raw.length > FORM_KEEP) return null;
  const entries = raw.map((e): FormEntry | null => {
    const r = record(e);
    if (!r || !isInt(r.day, from, to) || !isNum(r.residual, -10, 10)) return null;
    // A part match keeps its share; a whole one leaves it out.
    if (!('share' in r)) return { day: r.day, residual: r.residual };
    return isNum(r.share, 0, 1) && r.share > 0 && r.share < 1
      ? { day: r.day, residual: r.residual, share: r.share }
      : null;
  });
  if (!entries.every((e): e is FormEntry => e !== null)) return null;
  return entries.every((e, i) => i === 0 || e.day > (entries[i - 1]?.day ?? 0)) ? entries : null;
}

function player(raw: unknown, number: number, today: number): CareerPlayer | null {
  const r = record(raw);
  if (!r) return null;
  const face = look(r.look);
  const trained = levels(r.attributes);
  const wear = wearOf(r.wear);
  const guarded = strings(r.guarded);
  // Form carries over from season to season.
  const readings = form(r.form, 0, today);
  if (!face || !trained || !wear || !guarded || !readings) return null;
  if (!guarded.every((a) => (ATTRIBUTES as readonly string[]).includes(a)) || !unique(guarded)) return null;
  if (!isRole(r.position) || !isClub(r.club) || r.age !== START_AGE + number) return null;
  if (
    !isInt(r.points, 0, Number.MAX_SAFE_INTEGER) ||
    !isNum(r.fame, 0, FAME_MAX) ||
    !isNum(r.stamina, 0, STAMINA_MAX)
  )
    return null;
  return {
    look: face,
    position: r.position,
    club: r.club,
    age: r.age,
    points: r.points,
    attributes: trained,
    wear,
    guarded: guarded as Attribute[],
    fame: r.fame,
    stamina: r.stamina,
    form: readings,
  };
}

function goal(raw: unknown): CareerGoal | null {
  const r = record(raw);
  if (!r || (r.side !== 0 && r.side !== 1) || typeof r.ownGoal !== 'boolean') return null;
  const id = (x: unknown): x is string | null => x === null || typeof x === 'string';
  if (!id(r.scorer) || !id(r.assist) || (r.ownGoal && r.assist !== null)) return null;
  return { side: r.side, scorer: r.scorer, assist: r.assist, ownGoal: r.ownGoal };
}

/** A played fixture's record: goals by knights of the right side (the other side's for an own goal), no more of
 * them than the score, and ratings for the knights who could have played, man of the match among them. */
function fixtureRecord(
  raw: unknown,
  fixture: LeagueFixture,
  squadIds: (club: string) => string[],
): FixtureRecord | null {
  const r = record(raw);
  const score = fixture.score;
  const ratingsRaw = record(r?.ratings);
  if (!r || !score || !Array.isArray(r.goals) || !ratingsRaw) return null;
  const goals = r.goals.map(goal);
  if (!goals.every((g): g is CareerGoal => g !== null)) return null;
  const sides = [squadIds(fixture.home), squadIds(fixture.away)];
  const on = (side: number, id: string | null): boolean => id === null || (sides[side] ?? []).includes(id);
  if (!goals.every((g) => on(g.ownGoal ? 1 - g.side : g.side, g.scorer) && on(g.side, g.assist))) return null;
  if (!([0, 1] as const).every((side) => goals.filter((g) => g.side === side).length <= score[side]))
    return null;
  const entries = Object.entries(ratingsRaw);
  const rated = entries.length >= 2 * STARTERS && entries.length <= 2 * (STARTERS + SUBS_ALLOWED);
  if (!rated || !entries.every(([id, x]) => (on(0, id) || on(1, id)) && isNum(x, MIN_RATING, MAX_RATING)))
    return null;
  const ratings = Object.fromEntries(entries) as Record<string, number>;
  if (r.motm !== null && !(typeof r.motm === 'string' && r.motm in ratings)) return null;
  if (!Array.isArray(r.subs)) return null;
  const subs = r.subs.map((x) => sub(x, on));
  if (!subs.every((x): x is CareerSub => x !== null)) return null;
  // At most the allowed changes a side, in the order made, and nobody comes on or goes off twice.
  const perSide = ([0, 1] as const).every(
    (side) => subs.filter((x) => x.side === side).length <= SUBS_ALLOWED,
  );
  const ordered = subs.every((x, i) => i === 0 || x.share >= (subs[i - 1]?.share ?? 0));
  if (!perSide || !ordered || !unique(subs.flatMap((x) => [x.off, x.on]))) return null;
  return { goals, ratings, motm: r.motm, subs };
}

function sub(raw: unknown, plays: (side: number, id: string) => boolean): CareerSub | null {
  const r = record(raw);
  if (!r || (r.side !== 0 && r.side !== 1) || typeof r.off !== 'string' || typeof r.on !== 'string')
    return null;
  if (r.off === r.on || !plays(r.side, r.off) || !plays(r.side, r.on)) return null;
  if (!isInt(r.minute, 1, 90) || !isNum(r.share, 0, 1)) return null;
  return { side: r.side, off: r.off, on: r.on, minute: r.minute, share: r.share };
}

function season(raw: unknown, seed: number, w: World, playerClub: string): CareerSeason | null {
  const r = record(raw);
  if (!r || !isInt(r.number, 0, 1000) || !Array.isArray(r.leagues) || r.leagues.length !== DIVISIONS.length)
    return null;
  const number = r.number;
  const leagues: LeagueState[] = [];
  for (const d of DIVISIONS) {
    const clubs = w.divisions[d] ?? [];
    const league = normalizeLeague(r.leagues[d], clubs);
    if (league?.seed !== leagueSeed(seed, number, d) || league.playerHouse !== leagueHost(clubs, playerClub))
      return null;
    leagues.push(league);
  }
  // All three leagues on one matchday: nothing played beyond the earliest unfinished one.
  const day = Math.min(...leagues.map(currentMatchday));
  const ahead = leagues.some((l) => l.results.some((md, i) => i > day && md.some((s) => s !== null)));
  if (ahead || !Array.isArray(r.records) || r.records.length !== DIVISIONS.length) return null;

  const squadIds = (club: string): string[] => [
    ...(w.squads[club] ?? []).map((k) => k.id),
    ...(club === playerClub ? [PLAYER_ID] : []),
  ];
  const records: (FixtureRecord | null)[][][] = [];
  for (const d of DIVISIONS) {
    const division: unknown = r.records[d];
    const league = leagues[d];
    if (!league || !Array.isArray(division) || division.length !== MATCHDAYS) return null;
    const days: (FixtureRecord | null)[][] = [];
    for (let md = 0; md < MATCHDAYS; md++) {
      const saved: unknown = division[md];
      if (!Array.isArray(saved) || saved.length !== FIXTURES_PER_MATCHDAY) return null;
      const out: (FixtureRecord | null)[] = [];
      for (const fixture of fixtures(league, md)) {
        // A record exactly where the league has a score.
        const rec = fixture.score ? fixtureRecord(saved[fixture.index], fixture, squadIds) : null;
        if (fixture.score ? !rec : saved[fixture.index] !== null) return null;
        out.push(rec);
      }
      days.push(out);
    }
    records.push(days);
  }

  const staminaRaw = record(r.stamina);
  if (!staminaRaw || Object.keys(staminaRaw).length !== CLUB_IDS.length) return null;
  const stamina: Record<string, Stamina> = {};
  for (const club of CLUB_IDS) {
    const saved = record(staminaRaw[club]);
    const ids = (w.squads[club] ?? []).map((k) => k.id);
    if (!saved || Object.keys(saved).length !== ids.length) return null;
    if (!ids.every((id) => isNum(saved[id], 0, STAMINA_MAX))) return null;
    stamina[club] = Object.fromEntries(ids.map((id) => [id, saved[id] as number]));
  }
  if (!isInt(r.points, 0, Number.MAX_SAFE_INTEGER)) return null;
  return { number, leagues, records, stamina, points: r.points };
}

function royalMatch(raw: unknown): RoyalMatch | null {
  const r = record(raw);
  const score = Array.isArray(r?.score) ? (r.score as unknown[]) : [];
  const [mine, theirs] = score;
  if (!r || score.length !== 2 || !isInt(mine, 0, 99) || !isInt(theirs, 0, 99)) return null;
  if (typeof r.opponent !== 'string' || !isNum(r.rating, MIN_RATING, MAX_RATING) || !isInt(r.goals, 0, 99))
    return null;
  if (typeof r.motm !== 'boolean' || mine === theirs) return null;
  return { opponent: r.opponent, score: [mine, theirs], rating: r.rating, goals: r.goals, motm: r.motm };
}

function royal(raw: unknown): RoyalResult | null {
  const r = record(raw);
  if (!r) return null;
  const squad = strings(r.squad);
  if (squad?.length !== ROYAL_PLACES || squad[0] !== PLAYER_ID || !unique(squad)) return null;
  if (!Array.isArray(r.matches) || r.matches.length < 1 || r.matches.length > ROYAL_RIVAL_TIERS.length)
    return null;
  const matches = r.matches.map(royalMatch);
  if (!matches.every((m): m is RoyalMatch => m !== null)) return null;
  // Knockout: every round but the last was won, and the crown is all of them won.
  const won = (m: RoyalMatch): boolean => m.score[0] > m.score[1];
  if (!matches.slice(0, -1).every(won)) return null;
  const crowned = matches.length === ROYAL_RIVAL_TIERS.length && matches.every(won);
  return r.crowned === crowned ? { squad, matches, crowned } : null;
}

function review(raw: unknown, s: CareerSeason, playerClub: string): SeasonReview | null {
  const r = record(raw);
  if (!r || !Array.isArray(r.offers) || r.offers.length > OFFERS_MAX) return null;
  const next = promote(s.leagues.map((l) => table(l)));
  const offers = r.offers.map((o): Offer | null => {
    const offer = record(o);
    const { club, division } = offer ?? {};
    if (!isClub(club) || club === playerClub || !isDivision(division)) return null;
    return next[division]?.includes(club) ? { club, division } : null;
  });
  if (!offers.every((o): o is Offer => o !== null) || !unique(offers.map((o) => o.club))) return null;
  const royalResult = r.royal === null ? null : royal(r.royal);
  if (r.royal !== null && !royalResult) return null;
  return { offers, royal: royalResult };
}

function summary(raw: unknown, index: number): SeasonSummary | null {
  const r = record(raw);
  if (r?.season !== index || r.age !== START_AGE + index || !isClub(r.club) || !isDivision(r.division))
    return null;
  if (!isRole(r.position) || !isInt(r.finish, 1, LEAGUE_SIZE) || !isInt(r.apps, 0, MATCHDAYS)) return null;
  if (!isInt(r.starts, 0, r.apps) || r.subOns !== r.apps - r.starts || !isInt(r.subOffs, 0, r.starts))
    return null;
  if (![r.goals, r.assists, r.matchPoints, r.honourPoints].every((x) => isInt(x, 0, 10_000))) return null;
  if (!isInt(r.motm, 0, r.apps)) return null;
  if (r.apps === 0 ? r.average !== null : !isNum(r.average, MIN_RATING, MAX_RATING)) return null;
  const honours = strings(r.honours);
  const offers = strings(r.offers);
  const trained = levels(r.attributes);
  if (!honours || !honours.every((h) => (HONOURS as readonly string[]).includes(h)) || !unique(honours))
    return null;
  if (!offers || !offers.every(isClub) || !trained || typeof r.relegated !== 'boolean') return null;
  if (!isNum(r.fame, 0, FAME_MAX) || !isNum(r.stars, 0, TOP_TIER)) return null;
  return {
    season: index,
    age: r.age,
    club: r.club,
    division: r.division,
    position: r.position,
    finish: r.finish,
    apps: r.apps,
    starts: r.starts,
    subOns: r.subOns,
    subOffs: r.subOffs,
    goals: r.goals as number,
    assists: r.assists as number,
    motm: r.motm,
    average: r.average as number | null,
    matchPoints: r.matchPoints as number,
    honourPoints: r.honourPoints as number,
    honours: honours as Honour[],
    relegated: r.relegated,
    fame: r.fame,
    stars: r.stars,
    attributes: trained,
    offers,
  };
}

/** Reads a saved career, or null for anything malformed or impossible: a schedule the seed didn't draw, results out of
 * order, a record that doesn't fit its fixture, an age that doesn't match the seasons played, and so on. */
export function normalizeCareer(raw: unknown): CareerState | null {
  const r = record(raw);
  if (r?.version !== CAREER_VERSION || !isInt(r.seed, 0, 2 ** 32 - 1)) return null;
  const w = world(r.world);
  const p = record(r.player);
  const s = w && p && isClub(p.club) ? season(r.season, r.seed, w, p.club) : null;
  if (!w || !s) return null;
  const today = s.number * MATCHDAYS + Math.min(...s.leagues.map(currentMatchday));
  const me = player(r.player, s.number, today);
  if (!me) return null;
  // No bot shares his name (see withoutName).
  if (Object.values(w.squads).some((sq) => sq.some((k) => sameName(k.look.name, me.look.name)))) return null;
  const finished = today === (s.number + 1) * MATCHDAYS;
  const rev = r.review === null ? null : review(r.review, s, me.club);
  if ((r.review !== null && (!rev || !finished)) || !Array.isArray(r.history)) return null;
  if (r.history.length !== s.number + (rev ? 1 : 0)) return null;
  const history = r.history.map(summary);
  if (!history.every((h): h is SeasonSummary => h !== null)) return null;
  if (rev && history.at(-1)?.club !== me.club) return null;
  return { version: CAREER_VERSION, seed: r.seed, player: me, world: w, season: s, review: rev, history };
}
