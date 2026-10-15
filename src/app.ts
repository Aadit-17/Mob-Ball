import { DIFFICULTIES, type Difficulty } from './ai/skills';
import { createRng, randomSeed } from './game/rng';
import type { Look } from './knight/look';
import type { CupState } from './modes/cup/bracket';
import type { MatchSession } from './modes/mode';
import { houseById, HOUSES, type House } from './setup/houses';
import { createSquads, rollRivals, setTeamTier, withTier, type Squads } from './setup/squads';
import {
  loadCup,
  loadHonours,
  loadLook,
  loadPreferences,
  saveCup,
  saveHonours,
  saveLook,
  savePreferences,
  type Honours,
  type Preferences,
} from './storage';
import { mountCup } from './ui/screens/cup';
import { mountForge } from './ui/screens/forge';
import { mountHome } from './ui/screens/home';
import { mountMatch } from './ui/screens/match';
import { mountSetup } from './ui/screens/setup';

export type ScreenId = 'home' | 'forge' | 'setup' | 'match' | 'cup';

/** What every screen can see and change. */
export interface AppContext {
  readonly look: Look;
  readonly prefs: Preferences;
  readonly squads: Squads;
  readonly house: House;
  readonly rival: House;
  readonly difficulty: Difficulty;
  setLook(look: Look): void;
  setPrefs(changes: Partial<Preferences>): void;
  /** Rolls new random teammates and rivals. */
  rerollSquads(): void;
  /** Sets one bot's skill tier; `team` 0 is the player's side. */
  setKnightTier(team: 0 | 1, index: number, tier: number): void;
  go(screen: ScreenId): void;
  /** The match being played, set by whichever mode started it. */
  readonly session: MatchSession | null;
  playMatch(session: MatchSession): void;
  /** The Realm Cup run in progress or just finished; saved on every change. */
  readonly cup: CupState | null;
  setCup(cup: CupState | null): void;
  readonly honours: Honours;
  addCupWin(): void;
}

type Mount = (root: HTMLElement, app: AppContext) => () => void;

const SCREENS: Record<ScreenId, Mount> = {
  home: mountHome,
  forge: mountForge,
  setup: mountSetup,
  match: mountMatch,
  cup: mountCup,
};

export class App implements AppContext {
  look = loadLook();
  prefs = loadPreferences();
  squads: Squads;
  rival: House;
  session: MatchSession | null = null;
  cup = loadCup();
  honours = loadHonours();
  private unmount: (() => void) | null = null;

  constructor(private readonly root: HTMLElement) {
    this.rival = this.pickRival();
    this.squads = this.buildSquads();
  }

  get house(): House {
    return houseById(this.prefs.houseId);
  }

  get difficulty(): Difficulty {
    const found =
      DIFFICULTIES.find((d) => d.id === this.prefs.difficultyId) ?? DIFFICULTIES[1] ?? DIFFICULTIES[0];
    if (!found) throw new Error('No difficulties defined');
    return found;
  }

  setLook(look: Look): void {
    this.look = look;
    saveLook(look);
    this.squads = this.buildSquads();
  }

  setPrefs(changes: Partial<Preferences>): void {
    this.prefs = { ...this.prefs, ...changes };
    savePreferences(this.prefs);
    if (changes.houseId !== undefined) this.rival = this.pickRival();
    if (changes.houseId !== undefined || changes.teamSize !== undefined) {
      this.squads = this.buildSquads();
      return;
    }
    // Level changes keep the same knights; only their skill changes.
    const { home, away } = this.squads;
    this.squads = {
      home: changes.teammateTier === undefined ? home : setTeamTier(home, changes.teammateTier),
      away:
        changes.difficultyId === undefined
          ? away
          : rollRivals(away, this.difficulty.meanTier, createRng(randomSeed())),
    };
  }

  setKnightTier(team: 0 | 1, index: number, tier: number): void {
    const side = team === 0 ? 'home' : 'away';
    this.squads = {
      ...this.squads,
      [side]: this.squads[side].map((spec, i) => (i === index ? withTier(spec, tier) : spec)),
    };
  }

  rerollSquads(): void {
    this.rival = this.pickRival();
    this.squads = this.buildSquads();
  }

  setCup(cup: CupState | null): void {
    this.cup = cup;
    saveCup(cup);
  }

  addCupWin(): void {
    this.honours = { ...this.honours, cupWins: this.honours.cupWins + 1 };
    saveHonours(this.honours);
  }

  playMatch(session: MatchSession): void {
    this.session = session;
    this.go('match');
  }

  go(screen: ScreenId): void {
    this.unmount?.();
    this.root.replaceChildren();
    this.root.dataset.screen = screen;
    this.unmount = SCREENS[screen](this.root, this);
    window.scrollTo({ top: 0 });
  }

  private pickRival(): House {
    const others = HOUSES.filter((h) => h.id !== this.prefs.houseId);
    return createRng(randomSeed()).pick(others);
  }

  private buildSquads(): Squads {
    return createSquads(
      this.look,
      this.prefs.teamSize,
      { teammateTier: this.prefs.teammateTier, rivalMeanTier: this.difficulty.meanTier },
      createRng(randomSeed()),
    );
  }
}
