import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('outputs', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => console.log(m.type(), m.text()));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:3001');
await page.waitForTimeout(4000);
if ((await page.locator('.guard-canvas canvas').count()) !== 1)
  errors.push('Missing desktop WebGL scene');
const accessibility = await new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
  .analyze();
errors.push(
  ...accessibility.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`,
  ),
);
console.log(
  await page.evaluate(() => ({
    motion: document
      .querySelector('[data-motion]')
      ?.getAttribute('data-motion'),
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    saveData: navigator.connection?.saveData,
    width: innerWidth,
    canvas: document.querySelectorAll('canvas').length,
    guard: document
      .querySelector('.guard-canvas')
      ?.getBoundingClientRect()
      .toJSON(),
    webgl: !!document.createElement('canvas').getContext('webgl2'),
  })),
);
await page.screenshot({ path: 'outputs/motion-diagnostic.png' });
for (const y of [550, 1100, 1750]) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `outputs/hero-motion-${y}.png` });
  console.log('scene', y, await page.locator('.chapter').textContent());
}
await page.getByRole('link', { name: 'Launch App', exact: true }).click();
await page.getByRole('heading', { name: 'Protocol overview' }).waitFor();
console.log('Remaining pins', await page.locator('.pin-spacer').count());
if (await page.locator('.pin-spacer').count())
  errors.push('Route cleanup left pinned content');
await browser.close();
if (errors.length) throw new Error(errors.join('\n'));
