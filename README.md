# MOB BALL

Top-down medieval football in the browser, played the way [HaxBall](https://www.haxball.com/) plays: every
knight is a circle, you kick by touching the ball, and positioning is everything. Forge your own knight from
19 slots of gear (over 500 trillion combinations), join a house, and play 4v4 (or 3v3) against squads of AI
knights whose skill tiers change how they _think_, not just how fast they react.

> **Play:** [mob-ball.pages.dev](https://mob-ball.pages.dev/) · TypeScript and the Canvas 2D API: no game engine, no framework, no
> image assets. About 24 KB of gzipped JavaScript.

## Features

- **Knight forge.** Helmet, topper, metal finish, face, marks, beard, hair, body armour, cloth pattern,
  emblem, arms, legs, boots, back and a held item, all drawn procedurally. Helmets decide what shows through
  (a great helm hides your beard; a barbute shows it through a T-slot) and the forge says so. Knights export
  to short share codes (`MB1-…`).
- **HaxBall-style physics.** Circle collisions with mass and restitution, hold-to-kick on contact, walls you
  can play off, and one medieval addition: the shoulder barge. Shots near goal and first-time kicks hit
  harder, so attack has tools to beat a packed defence.
- **Tiered AI.** Five tiers from Peasant to Legend. Each tier knows more: anticipating bounces, holding
  positions and making supporting runs, passing into open lanes, shooting at the side the keeper isn't
  covering, forward runs into open space, bank passes off the wall and, at the top, the HaxBall
  **wall lift**. Bots never play the ball toward their own goal. Rival squads are rolled
  around the chosen difficulty, so every team is uneven in its own way. Your teammates are always Legends.
- **Built for more modes.** Exhibition ships today. The mode layer (`src/modes`) is designed so a cup, a
  career and a manager mode plug in without touching the match code.

## Architecture

```
src/
  game/     Pure simulation: fixed 120 Hz step, seeded RNG, no DOM. Emits events (kick, barge, goal).
  ai/       Bot brain, skill tiers and geometry (lane checks, bank-shot mirroring, bounce prediction).
  knight/   The forge catalogue, look model with validation and share codes, and the sprite renderer.
  render/   Camera, pre-rendered pitch, crowd, effects and minimap. Reacts to events; never feeds back.
  modes/    Game modes and match sessions. The match screen only ever sees a session.
  setup/    Houses and squad generation.
  ui/       Screens (home, forge, setup, match) built with a tiny DOM helper.
```

Design choices worth calling out:

- **The simulation is deterministic.** The same seed and inputs replay the same match. That makes behaviour
  testable, and it is the foundation for replays, lockstep netcode, or training reinforcement-learning
  agents later.
- **Humans and bots share one interface.** Every knight is driven by `{ moveX, moveY, kick, barge }`: the
  keyboard produces it for you and `BotBrain` for everyone else. A trained policy would be a third producer.
- **Bots reason in their own frame.** Each bot mirrors the pitch so its team always attacks to the right, so
  one set of role logic serves both sides.
- **Bank shots use the real physics.** A wall keeps the ball's speed along it and scales the speed away from
  it by the restitution, so the aim point is the target mirrored _and stretched by 1/restitution_. Uniform
  rolling friction doesn't bend the path, so the aim is exact; a test fires the ball through the real
  physics to prove it.
- **Presentation never feeds back.** Rendering, effects and the camera read the simulation and its events;
  nothing they do can change a match.

## Development

```bash
npm install
npm run dev          # local dev server
npm run test         # unit tests (Vitest)
npm run lint         # ESLint with strict type-checked rules
npm run typecheck
npm run build        # typecheck + production build into dist/
npm run balance      # play 120 bot matches headless and report how scoring happens
npm run smoke        # build, then play a full match in headless Chromium; fails on console errors
```

The first `npm run smoke` needs a browser: `npx playwright install chromium`.

Controls: **WASD / arrows** run · **Space** kick (hold to kick on contact) · **Shift / E** barge · **Esc**
pause.

## Releases

Every version is listed in the in-game chronicle (`changelog.html`, linked from the home screen). To
publish an update, add an entry at the top of `src/changelog/releases.ts`; the chronicle and the home
screen's version badge both read from it.

## Deploying (Cloudflare Pages)

1. Push the repo to GitHub.
2. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, then pick the repo.
3. Build command `npm run build`, output directory `dist`. Every push to `main` then deploys.

The build is a static site with relative asset paths, so any static host works.

## License

[MIT](LICENSE)
