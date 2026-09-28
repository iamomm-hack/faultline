import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
await mkdir('outputs', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = { routes: [], errors: [], accessibility: [], interactions: [] };
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.on('pageerror', (e) => report.errors.push(e.message));
page.on('console', (e) => {
  if (e.type() === 'error') report.errors.push(e.text());
});
const routes = [
  '/',
  '/app',
  '/proposals',
  '/proposals/proposal-v2',
  '/proposals/proposal-v3',
  '/demo',
  '/docs',
];
try {
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [360, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const route of routes) {
      await page.goto(`http://127.0.0.1:3001${route}`);
      await page.locator('h1').waitFor();
      await page.evaluate(async () => {
        const initialY = scrollY;
        for (const image of Array.from(document.images)) {
          image.scrollIntoView({ block: 'center' });
          await new Promise((resolve) => setTimeout(resolve, 60));
          if (image.currentSrc) await image.decode().catch(() => {});
        }
        window.scrollTo(0, initialY);
      });
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      const name =
        route === '/' ? 'landing' : route.slice(1).replaceAll('/', '-');
      await page.screenshot({
        path: `outputs/${name}-${width}.png`,
        fullPage: true,
      });
      if (width === 1440 || width === 390)
        await page.screenshot({
          path: `outputs/${name}-${width}-viewport.png`,
        });
      report.routes.push({ route, width, height, overflow });
      if (overflow) console.error('OVERFLOW', route, width);
      if (width === 1440 || width === 390) {
        const a = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        report.accessibility.push({
          route,
          width,
          violations: a.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:3001/demo?candidate=v2');
  for (let i = 0; i < 7; i++)
    await page.locator('.demo-control>.button').click();
  await page
    .getByRole('heading', { name: 'Candidate rejected. Boundary intact.' })
    .waitFor();
  report.interactions.push('v2 rejection and settlement complete');
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await page.getByRole('checkbox', { name: /Simulate a worker fault/ }).check();
  for (let i = 0; i < 5; i++)
    await page.locator('.demo-control>.button').click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'RESULT_MISMATCH' })
    .waitFor();
  report.interactions.push('divergent worker blocks attestation submission');
  await page.getByRole('button', { name: /CANDIDATE \/ V3/ }).click();
  for (let i = 0; i < 7; i++)
    await page.locator('.demo-control>.button').click();
  if (
    !(await page.locator('.demo-announcement').textContent()).includes(
      'HOLD is not approval',
    )
  )
    throw Error('HOLD boundary missing');
  await page.locator('.demo-control>.button').click();
  await page.locator('.demo-control>.button').click();
  if (!(await page.locator('.demo-control>.button').isDisabled()))
    throw Error('Eligibility delay not enforced');
  await page
    .getByRole('button', { name: 'Execute through Guard', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Execute through Guard', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Guarded execution. Simulated.' })
    .waitFor();
  report.interactions.push(
    'v3 HOLD, separate approval, delay and simulated execution complete',
  );
  await page.getByRole('button', { name: 'Reset demo' }).click();
  if (
    !(await page.locator('.demo-announcement').textContent()).includes('Ready')
  )
    throw Error('Reset failed');
  report.interactions.push('reset without refresh');
  await page.goto('http://127.0.0.1:3001/proposals');
  await page.getByRole('button', { name: 'HOLD', exact: true }).click();
  if ((await page.locator('.proposal-row').count()) !== 1)
    throw Error('HOLD filter failed');
  await page
    .getByRole('textbox', { name: 'Search proposals' })
    .fill('does-not-exist');
  await page.getByRole('heading', { name: 'No matching proposals.' }).waitFor();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('button', { name: 'Expanded view' }).click();
  if ((await page.locator('.proposal-row code').count()) !== 2)
    throw Error('Expanded view failed');
  report.interactions.push(
    'explorer filter, search, empty, reset and expanded view',
  );
  await page.getByRole('combobox', { name: 'Data source' }).selectOption('rpc');
  await page
    .getByRole('alert')
    .filter({ hasText: 'RPC_NOT_CONFIGURED' })
    .waitFor();
  if (await page.locator('.proposal-row').count())
    throw Error('RPC leaked mock data');
  report.interactions.push(
    'RPC unavailable: explicit error and no mock fallback',
  );
  await page
    .getByRole('combobox', { name: 'Data source' })
    .selectOption('demo');
  await page.locator('.proposal-row').first().waitFor();
  await page.goto('http://127.0.0.1:3001/proposals/proposal-v3');
  await page.getByRole('button', { name: 'Inspect with SDK' }).click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Commitment matches the committed vector.' })
    .waitFor();
  report.interactions.push(
    'browser SDK commitment parity and unsigned instruction construction',
  );
  await page.goto('http://127.0.0.1:3001/');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.cinema-hero').waitFor();
  for (const y of [0, 650, 1350, 2000, 2600]) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(850);
    await page.screenshot({ path: `outputs/hero-motion-${y}.png` });
  }
  await page.getByRole('link', { name: 'Launch App', exact: true }).click();
  await page.getByRole('heading', { name: 'Protocol overview' }).waitFor();
  const pinCount = await page.locator('.pin-spacer').count();
  if (pinCount) throw Error('Route left pin spacers behind');
  report.interactions.push(
    'scroll-driven photographic narrative and route cleanup',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:3001/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Docs', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Authority with conditions.' })
    .waitFor();
  report.interactions.push('mobile menu navigation');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.keyboard.press('Escape');
  if (
    !(await page
      .getByRole('button', { name: 'Open menu' })
      .evaluate((el) => el === document.activeElement))
  )
    throw Error('Menu Escape focus restoration failed');
  await page.goto('http://127.0.0.1:3001/');
  await page
    .getByRole('heading', { name: 'Unsafe upgrades stop here.' })
    .waitFor();
  await page.keyboard.press('Tab');
  if (
    !(await page
      .getByRole('link', { name: 'Skip to content' })
      .evaluate((el) => el === document.activeElement))
  )
    throw Error('Skip link is not first keyboard target');
  await page.keyboard.press('Enter');
  report.interactions.push('keyboard skip link and Escape focus restoration');
} finally {
  await writeFile('outputs/qa-results.json', JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        routeChecks: report.routes.length,
        overflow: report.routes.filter((r) => r.overflow),
        errors: report.errors,
        accessibility: report.accessibility.filter((a) => a.violations.length),
        interactions: report.interactions,
      },
      null,
      2,
    ),
  );
  await browser.close();
  if (
    report.errors.length ||
    report.routes.some((r) => r.overflow) ||
    report.accessibility.some((a) => a.violations.length)
  )
    process.exitCode = 1;
}
