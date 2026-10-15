/// <reference types="node" />
/**
 * Renders the link-preview art into public/: og-image.png (1200x630) from scripts/og/og-image.html,
 * which draws with the game's own code, and apple-touch-icon.png (180x180) from public/favicon.svg.
 *
 *   npm run og-image                                (first run: `npx playwright install chromium`)
 */
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/** Clear of the smoke test (4173) and the usual dev servers (5173, 5174). */
const PORT = 5180;
const STONE = '#1f1c22';

async function main(): Promise<void> {
  const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'warn' });
  await server.listen();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
    });
    await page.goto(`http://localhost:${PORT}/scripts/og/og-image.html`);
    await page.waitForFunction(() => window.ogReady === true, null, { timeout: 30_000 });
    if (problems.length) throw new Error(`Render page failed:\n${problems.join('\n')}`);
    await page.screenshot({ path: 'public/og-image.png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
    console.log('wrote public/og-image.png (1200x630)');

    const favicon = await readFile('public/favicon.svg', 'utf8');
    const icon = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
    // iOS rounds the corners itself, so the icon drops the favicon's rounded corners and goes full-bleed.
    const square = favicon.replace('rx="14"', 'rx="0"').replace('<svg ', '<svg width="180" height="180" ');
    await icon.setContent(`<body style="margin:0;background:${STONE}">${square}</body>`);
    await icon.screenshot({
      path: 'public/apple-touch-icon.png',
      clip: { x: 0, y: 0, width: 180, height: 180 },
    });
    console.log('wrote public/apple-touch-icon.png (180x180)');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
