/// <reference types="node" />
/**
 * Browser smoke test: builds the game, serves it, plays a full match in headless Chromium, starts a
 * Realm Cup, drafts and plays two Manager matchdays, starts a career and plays two matchdays of it,
 * then plays with touch on a landscape phone. Fails
 * on any console error or warning, and reports the JS heap along the way.
 *
 *   npm run smoke                                   (first run: `npx playwright install chromium`)
 *   SMOKE_URL=https://mob-ball.pages.dev npx tsx scripts/smoke.ts   (check a deployed site instead)
 */
import { chromium, type Browser, type CDPSession, type Locator, type Page } from 'playwright';
import { preview } from 'vite';
import {
  drawCup,
  pendingSimulations,
  playerFixture,
  recordPlayerResult,
  recordResult,
  type CupState,
} from '../src/modes/cup/bracket';
import { REALM_HOUSES } from '../src/setup/houses';

const MATCH_TIMEOUT_MS = 240_000;
const MOVE_KEYS = ['w', 'a', 's', 'd'] as const;

async function heapMb(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return (usedSize / 1048576).toFixed(1);
}

/** Every full-time button whole on screen and on top, at each window size, with every rating opened. */
async function expectResultActionsInView(page: Page): Promise<void> {
  const before = page.viewportSize();
  await page.locator('.rt-open[aria-expanded="false"]').evaluateAll((buttons) => {
    for (const b of buttons) if (b instanceof HTMLElement) b.click();
  });
  if (await page.locator('.rt-open[aria-expanded="false"]').count())
    throw new Error('A rating breakdown did not open');
  for (const [width, height] of [
    [1280, 900],
    [1280, 720],
    [844, 390],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    const hidden = await page.locator('.overlay-actions button').evaluateAll((buttons) =>
      buttons
        .filter((b) => {
          const r = b.getBoundingClientRect();
          const onTop = document.elementFromPoint((r.left + r.right) / 2, r.bottom - 2);
          const inside = r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
          return !inside || !onTop || !(onTop === b || b.contains(onTop));
        })
        .map((b) => b.textContent),
    );
    if (hidden.length)
      throw new Error(`At ${width}×${height} full-time buttons are cut off: ${hidden.join(', ')}`);
  }
  if (before) await page.setViewportSize(before);
}

async function expectPressed(button: Locator, expected: string, failure: string): Promise<void> {
  const actual = await button.getAttribute('aria-pressed');
  if (actual !== expected) throw new Error(`${failure} (aria-pressed=${actual ?? 'missing'})`);
}

async function shot(page: Page, name: string, fullPage = true): Promise<void> {
  const dir = process.env.SMOKE_SHOTS;
  if (!dir) return;
  await page.locator('.gates').waitFor({ state: 'detached' });
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage });
}

/** A cup the player has won, every tie settled, for screenshots of the champion screen. */
function wonCup(): CupState {
  let cup = drawCup(
    { seed: 5, levelId: 'knight', teamSize: 4, playerHouse: 'ember' },
    REALM_HOUSES.map((h) => h.id),
  );
  for (let round = 0; round < 3; round++) {
    const mine = playerFixture(cup);
    if (!mine) throw new Error('Expected a cup match to play');
    cup = recordPlayerResult(cup, mine, [3, round]);
    for (const f of pendingSimulations(cup)) cup = recordResult(cup, f.round, f.index, [2, 1]);
  }
  return cup;
}

/** Starts a Realm Cup, kicks off the quarter-final, quits, and checks the cup can be resumed. */
async function playCup(page: Page): Promise<void> {
  const cupCard = page.locator('.mode', { hasText: 'Realm Cup' });
  await cupCard.getByRole('button', { name: 'Play' }).click();
  await page.getByRole('button', { name: 'Draw the bracket' }).click();
  await page.locator('.bracket').waitFor();
  const ties = await page.locator('.bracket .tie').count();
  if (ties !== 7) throw new Error(`Bracket shows ${ties} ties, expected 7`);
  await shot(page, 'cup-bracket');
  await page.getByRole('button', { name: 'Play quarter-final' }).click();
  await page.waitForSelector('canvas.pitch');
  await page.waitForTimeout(1500);
  console.log(`cup quarter-final started · heap ${await heapMb(page)} MB`);
  await page.getByRole('button', { name: 'Pause (Esc)' }).click();
  await page.getByRole('button', { name: 'Quit to home' }).click();
  await page.locator('.modes').waitFor();

  await page.reload();
  const note = await cupCard.locator('.mode-progress').textContent();
  if (!note?.startsWith('Quarter-final next, against'))
    throw new Error(`Home does not offer the cup in progress (shows ${note ?? 'nothing'})`);
  await cupCard.getByRole('button', { name: 'Continue cup' }).click();
  await page.getByRole('button', { name: 'Play quarter-final' }).waitFor();
  console.log(`cup resumed from home: ${note}`);

  if (!process.env.SMOKE_SHOTS) return;
  await page.evaluate((cup) => {
    localStorage.setItem('mobball.cup.v1', JSON.stringify(cup));
    localStorage.setItem('mobball.honours.v1', JSON.stringify({ cupWins: 2 }));
  }, wonCup());
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(page.url());
    await page.locator('.trophy').waitFor();
    await shot(page, `home-trophy-${width}`);
    await cupCard.getByRole('button', { name: 'See the cup' }).click();
    await page.locator('.cup-champion').waitFor();
    await page.waitForTimeout(900);
    await shot(page, `cup-champion-${width}`);
  }
}

/** Drafts a squad, skips one matchday, watches the next with the dugout and Skip, then resumes from home. */
async function playManager(page: Page): Promise<void> {
  const card = page.locator('.mode', { hasText: 'Manager' });
  await card.getByRole('button', { name: 'Play' }).click();
  await page.getByRole('button', { name: /^Start the draft as/ }).click();
  const skipReveal = page.getByRole('button', { name: 'Skip to my pick' });
  if (await skipReveal.isVisible()) await skipReveal.click();
  await page.getByRole('button', { name: 'Auto-pick the rest' }).click();
  await shot(page, 'manager-draft-complete');
  await page.getByRole('button', { name: 'To the season' }).click();

  await page.getByRole('button', { name: 'Skip to the result' }).click();
  await page.getByRole('button', { name: 'On to matchday 2' }).click({ timeout: 60_000 });
  console.log(`manager matchday 1 skipped · heap ${await heapMb(page)} MB`);

  await page.getByRole('button', { name: 'Watch the match' }).click();
  await page.waitForSelector('canvas.pitch');
  await page.getByRole('button', { name: '4×' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pause (Esc)' }).click();
  await page.getByRole('heading', { name: 'Dugout' }).waitFor();
  await shot(page, 'manager-dugout', false);
  await page.getByRole('button', { name: 'Hold!' }).click();
  await page.getByRole('button', { name: 'Back to the match' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Results across the realm' }).click();
  await page.getByRole('button', { name: 'On to matchday 3' }).waitFor({ timeout: 60_000 });
  console.log(`manager matchday 2 watched, dugout used, skipped · heap ${await heapMb(page)} MB`);

  await page.goto(page.url());
  const note = await card.locator('.mode-progress').textContent();
  if (!note?.startsWith('Matchday 3 of 14'))
    throw new Error(`Home does not offer the season in progress (shows ${note ?? 'nothing'})`);
  console.log(`manager season resumed from home: ${note}`);
}

/** Plays a career match to full time: runs and kicks while he's on, and skips once he's off or benched. */
async function playCareerMatch(page: Page): Promise<void> {
  const started = Date.now();
  while (!(await page.locator('.overlay:not([hidden]) .ratings').count())) {
    if (Date.now() - started > MATCH_TIMEOUT_MS) throw new Error('Career match never reached full time');
    const skip = page.getByRole('button', { name: 'Skip', exact: true });
    if (await skip.isVisible()) {
      await skip.click();
      continue;
    }
    const key = MOVE_KEYS[Math.floor(Math.random() * MOVE_KEYS.length)] ?? 'd';
    await page.keyboard.down(key);
    await page.keyboard.down(' ');
    await page.waitForTimeout(400);
    await page.keyboard.up(key);
    await page.keyboard.up(' ');
  }
}

/** Starts a career, sims matchday 1, plays matchday 2 and reloads while the realm's results come in. */
async function playCareer(page: Page): Promise<void> {
  const card = page.locator('.mode', { hasText: 'My Career' });
  await card.getByRole('button', { name: 'Play' }).click();
  await page.getByRole('button', { name: /^Midfield/ }).click();
  await shot(page, 'career-start');
  await page.getByRole('button', { name: 'Begin your career' }).click();
  await page.locator('.cr-next .ribbon', { hasText: 'Matchday 1 of 14' }).waitFor();
  await shot(page, 'career-hub');

  await page.getByRole('button', { name: 'Sim the match' }).click();
  await page.getByRole('button', { name: 'On to matchday 2' }).waitFor({ timeout: 60_000 });
  if ((await page.locator('.cr-results .tie').count()) !== 11)
    throw new Error('Matchday results do not show the realm’s eleven other fixtures');
  await shot(page, 'career-results');
  await page.getByRole('button', { name: 'On to matchday 2' }).click();
  await page.locator('.cr-next .ribbon', { hasText: 'Matchday 2 of 14' }).waitFor();
  const played = await page.locator('.cr-table tbody tr.is-you td:nth-child(3)').textContent();
  if (played !== '1') throw new Error(`The hub table shows ${played ?? 'nothing'} played after matchday 1`);
  console.log(`career matchday 1 simmed · heap ${await heapMb(page)} MB`);

  await page.locator('.cr-next .btn-primary').click();
  await page.waitForSelector('canvas.pitch');
  await page.waitForTimeout(3000);
  await shot(page, 'career-match', false);
  await page.getByRole('button', { name: 'Pause (Esc)' }).click();
  if (await page.getByRole('button', { name: 'Restart' }).count())
    throw new Error('A career match offers a restart');
  await page.getByRole('button', { name: 'Continue' }).click();
  await playCareerMatch(page);
  await page.getByRole('button', { name: 'Results across the realm' }).click();
  await page.locator('.cr-results').waitFor();
  console.log(`career matchday 2 played · heap ${await heapMb(page)} MB`);

  // Leave mid-matchday: the hub must pick up the results still to come.
  const pending = await page.locator('.cr-results .tie.is-pending').count();
  if (!pending) throw new Error('Every result was in before the reload; nothing left to resume');
  await page.reload();
  const note = await card.locator('.mode-progress').textContent();
  if (!note?.startsWith('Season 1 · Village League ·'))
    throw new Error(`Home does not offer the career in progress (shows ${note ?? 'nothing'})`);
  await card.getByRole('button', { name: 'Continue career' }).click();
  await page.locator('.cr-results .tie.is-pending').first().waitFor();
  await page.getByRole('button', { name: 'On to matchday 3' }).click({ timeout: 60_000 });
  await page.locator('.cr-next .ribbon', { hasText: 'Matchday 3 of 14' }).waitFor();
  console.log(`career resumed from home (${note}) and on to matchday 3 · heap ${await heapMb(page)} MB`);
}

interface Finger {
  id: number;
  x: number;
  y: number;
}

/** Real multi-touch through CDP: every call lists all the fingers still down, as a touchscreen does. */
type TouchType = 'touchStart' | 'touchMove' | 'touchEnd';

async function touch(cdp: CDPSession, type: TouchType, fingers: Finger[]): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: fingers });
}

async function centre(locator: Locator, id: number): Promise<Finger> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Touch control is not on screen');
  return { id, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

/** Waits for the input the knight was sent from touch (the stage's data-touch-input) to match. */
async function expectTouchInput(
  page: Page,
  test: (shown: string) => boolean,
  failure: string,
): Promise<void> {
  const started = Date.now();
  let shown = '';
  while (Date.now() - started < 2000) {
    shown = (await page.locator('.stage').getAttribute('data-touch-input')) ?? '';
    if (test(shown)) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`${failure} (data-touch-input="${shown}")`);
}

/** A landscape phone: drags the stick, holds Kick with a second finger, taps Barge, pauses by tap. */
async function playTouch(browser: Browser, baseUrl: string, problems: string[]): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`touch ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`touch pageerror: ${e.message}`));
  await page.goto(baseUrl);
  await page.locator('.mode', { hasText: 'Exhibition' }).getByRole('button', { name: 'Play' }).tap();
  await page.getByRole('button', { name: /Kick off/ }).tap();
  await page.locator('.touch-controls').waitFor();
  await page.locator('.gates').waitFor({ state: 'detached' });
  await page.waitForTimeout(1800);

  const cdp = await context.newCDPSession(page);
  const thumb: Finger = { id: 1, x: 130, y: 300 };
  const pushed: Finger = { ...thumb, x: thumb.x + 40, y: thumb.y - 12 };
  await touch(cdp, 'touchStart', [thumb]);
  await touch(cdp, 'touchMove', [pushed]);
  await expectTouchInput(page, (s) => s === 'run', 'Dragging the stick did not run the knight');
  await shot(page, 'touch-run', false);

  const kick = await centre(page.locator('.tc-kick'), 2);
  await touch(cdp, 'touchStart', [pushed, kick]);
  await expectTouchInput(page, (s) => s === 'run kick', 'Holding Kick while running did not kick');
  await shot(page, 'touch-run-kick', false);
  await touch(cdp, 'touchEnd', [kick]);
  await touch(cdp, 'touchEnd', []);
  await expectTouchInput(page, (s) => s === '', 'Lifting both fingers did not let go');

  // The barge must reach the engine: its cooldown is what empties the button's ring.
  const charge = async (): Promise<number> =>
    Number(await page.locator('.match').evaluate((el) => getComputedStyle(el).getPropertyValue('--p')));
  if ((await charge()) < 1) throw new Error('Barge was not ready before the tap');
  // A rival's barge can stun the knight for a moment, so a tap gets a few tries.
  const barge = await centre(page.locator('.tc-barge'), 3);
  let after = 1;
  for (let attempt = 0; attempt < 4 && after >= 0.95; attempt++) {
    await touch(cdp, 'touchStart', [barge]);
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(250);
    after = await charge();
  }
  if (after >= 0.95) throw new Error(`Tapping Barge did not barge (ring at ${after})`);
  console.log(`touch: stick ran, kick held, barge tapped (ring ${after.toFixed(2)})`);

  await page.getByRole('button', { name: 'Pause (Esc)' }).tap();
  await page.getByRole('button', { name: 'Continue' }).waitFor();
  if (await page.locator('.touch-controls').isVisible())
    throw new Error('Touch controls show over the pause menu');
  await page.getByRole('button', { name: 'Continue' }).tap();
  await page.locator('.touch-controls').waitFor();
  await context.close();
}

async function main(): Promise<void> {
  const deployedUrl = process.env.SMOKE_URL;
  const server = deployedUrl ? null : await preview({ preview: { port: 4173, strictPort: true } });
  const baseUrl = deployedUrl ?? 'http://localhost:4173/';
  const browser = await chromium.launch();
  const problems: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

    await page.goto(baseUrl);
    await page.getByRole('link', { name: /Read the chronicle/ }).click();
    await page.getByRole('heading', { level: 1, name: 'The Chronicle' }).waitFor();
    if ((await page.locator('.scroll').count()) === 0) throw new Error('Chronicle shows no releases');
    if (process.env.SMOKE_SHOTS)
      await page.screenshot({ path: `${process.env.SMOKE_SHOTS}/chronicle.png`, fullPage: true });
    await page.getByRole('link', { name: /Back to the game/ }).click();
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: `${process.env.SMOKE_SHOTS}/home.png` });
    await page.getByRole('button', { name: /Forge your knight/ }).click();
    await page.getByRole('tab', { name: /Armour/ }).click();
    await page.getByRole('button', { name: /Take the field/ }).click();

    // Level controls: a team-wide setting, then one knight's arrow.
    await page.getByRole('group', { name: 'Teammates' }).getByRole('button', { name: 'Peasant' }).click();
    const firstRaise = page.getByRole('button', { name: /^Raise .*'s level$/ }).first();
    const firstCard = page.locator('.card-knight').first();
    if (!(await firstCard.textContent())?.includes('Peasant'))
      throw new Error('Teammates level did not apply');
    await firstRaise.click();
    if (!(await firstCard.textContent())?.includes('Squire'))
      throw new Error('Card level arrow did not apply');
    if (process.env.SMOKE_SHOTS)
      await page.screenshot({ path: `${process.env.SMOKE_SHOTS}/setup.png`, fullPage: true });

    await page.getByRole('button', { name: /Kick off/ }).click();
    await page.waitForSelector('canvas.pitch');
    if (await page.locator('.touch-controls').count()) throw new Error('Touch controls show with a mouse');
    // The READY banner must appear once per kick-off, not be re-rendered every few frames.
    const bannerRenders = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const msg = document.querySelector('.msg');
          let count = 0;
          const observer = new MutationObserver((records) => {
            count += records.filter((r) => r.addedNodes.length > 0).length;
          });
          if (msg) observer.observe(msg, { childList: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(count);
          }, 900);
        }),
    );
    if (bannerRenders > 2) throw new Error(`READY banner re-rendered ${bannerRenders} times during kick-off`);
    console.log(`match started · READY rendered ${bannerRenders}x · heap ${await heapMb(page)} MB`);

    // Mute toggles by button and by the M key; the match then plays on with sound.
    const mute = page.getByRole('button', { name: 'Mute (M)' });
    await expectPressed(mute, 'false', 'Sound should start on');
    await mute.click();
    await expectPressed(mute, 'true', 'Mute button did not mute');
    await page.keyboard.press('m');
    await expectPressed(mute, 'false', 'M key did not unmute');

    // Pause menu: continue, then restart from a fresh clock.
    const pause = page.getByRole('button', { name: 'Pause (Esc)' });
    await pause.click();
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: `${process.env.SMOKE_SHOTS}/paused.png` });
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForSelector('.overlay[hidden]', { state: 'attached' });
    await page.waitForTimeout(1500);
    await pause.click();
    await page.getByRole('button', { name: 'Restart' }).click();
    await page.waitForTimeout(300);
    const clock = await page.locator('.clock').textContent();
    if (clock !== '1:30') throw new Error(`Restart did not reset the clock (shows ${clock ?? 'nothing'})`);

    const started = Date.now();
    while (!(await page.locator('.overlay:not([hidden])').count())) {
      if (Date.now() - started > MATCH_TIMEOUT_MS) throw new Error('Match never reached full time');
      const key = MOVE_KEYS[Math.floor(Math.random() * MOVE_KEYS.length)] ?? 'd';
      await page.keyboard.down(key);
      await page.keyboard.down(' ');
      await page.waitForTimeout(400);
      await page.keyboard.up(key);
      await page.keyboard.up(' ');
    }
    console.log(`full time: ${await page.locator('.final').textContent()} · heap ${await heapMb(page)} MB`);
    await expectResultActionsInView(page);
    console.log('full-time buttons whole on screen at 1280×900, 1280×720, 844×390 and 390×844');

    await page.getByRole('button', { name: /Rematch/ }).click();
    await page.waitForSelector('.overlay[hidden]', { state: 'attached' });
    console.log(`rematch started · heap ${await heapMb(page)} MB`);
    await page.getByRole('button', { name: 'Pause (Esc)' }).click();
    await page.getByRole('button', { name: 'Quit to home' }).click();
    await page.locator('.modes').waitFor();

    // Muting on the home screen survives a reload.
    await page.getByRole('button', { name: 'Mute sound' }).click();
    await page.reload();
    await expectPressed(page.getByRole('button', { name: 'Mute sound' }), 'true', 'Mute was not remembered');

    await playCup(page);
    if (process.env.SMOKE_SHOTS) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Play another cup' }).click();
      await page.getByRole('button', { name: 'Draw the bracket' }).click();
      await page.locator('.bracket').waitFor();
      await shot(page, 'cup-bracket-390');
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(baseUrl);
    await playManager(page);
    await page.goto(baseUrl);
    await playCareer(page);
    await playTouch(browser, baseUrl, problems);
  } finally {
    await browser.close();
    server?.httpServer.close();
  }
  if (problems.length) throw new Error(`Console problems:\n${problems.join('\n')}`);
  console.log('smoke test passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
