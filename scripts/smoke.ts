/// <reference types="node" />
/**
 * Browser smoke test: builds the game, serves it, and plays a full match in headless Chromium.
 * Fails on any console error or warning, and reports the JS heap along the way.
 *
 *   npm run smoke                                   (first run: `npx playwright install chromium`)
 *   SMOKE_URL=https://mob-ball.pages.dev npx tsx scripts/smoke.ts   (check a deployed site instead)
 */
import { chromium, type Locator, type Page } from 'playwright';
import { preview } from 'vite';

const MATCH_TIMEOUT_MS = 240_000;
const MOVE_KEYS = ['w', 'a', 's', 'd'] as const;

async function heapMb(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return (usedSize / 1048576).toFixed(1);
}

async function expectPressed(button: Locator, expected: string, failure: string): Promise<void> {
  const actual = await button.getAttribute('aria-pressed');
  if (actual !== expected) throw new Error(`${failure} (aria-pressed=${actual ?? 'missing'})`);
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
