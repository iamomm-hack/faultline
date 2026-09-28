import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('outputs/cinema', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
const errors = [],
  requests = [],
  report = { phases: [], chapters: [], accessibility: [], images: [] };
page.on('request', (r) => requests.push(r.url()));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:3001');
  await page.locator('.exposure-photo').evaluate((image) => image.decode());
  await page.waitForTimeout(800);
  if (await page.locator('canvas').count())
    errors.push('Unexpected WebGL on image-led landing');
  if (await page.locator('.hero-layer').count())
    errors.push('Hero progression loaded before intentional scroll');
  for (const [phase, y] of [
    [0, 0],
    [1, 650],
    [2, 1350],
    [3, 1950],
    [4, 2550],
  ]) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(1000);
    await page.locator('.cinema-frames img').evaluateAll(async (images) => {
      await Promise.all(images.map((image) => image.decode().catch(() => {})));
    });
    const actual = Number(
      await page.locator('.cinema-hero').getAttribute('data-phase'),
    );
    report.phases.push({ expected: phase, actual, y });
    if (actual !== phase) errors.push('Hero phase mismatch at ' + y);
    await page.screenshot({
      path: 'outputs/cinema/hero-phase-' + phase + '.png',
    });
  }
  const held = await page
    .locator('.hero-held')
    .evaluate((el) => getComputedStyle(el).clipPath);
  if (!held.includes('16%'))
    errors.push('Held gate did not remain partially closed: ' + held);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(400);
  if (await page.locator('.pin-spacer').count())
    errors.push('Reduced motion retained a pin');
  // Decode explicitly for full-page QA only; production keeps below-fold media lazy.
  await page.evaluate(async () => {
    const initialY = scrollY;
    for (const image of Array.from(document.images)) {
      image.scrollIntoView({ block: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 60));
      if (image.currentSrc) await image.decode().catch(() => {});
    }
    window.scrollTo(0, initialY);
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const chapter of await page.locator('[data-cinema-chapter]').all()) {
      const name = await chapter.getAttribute('data-cinema-chapter');
      const geometry = await chapter.evaluate((el) => ({
        top: el.getBoundingClientRect().top + scrollY,
        height: el.clientHeight,
      }));
      for (const [frame, offset] of [
        ['start', 0],
        ['middle', Math.max(0, (geometry.height - 700) / 2)],
        ['end', Math.max(0, geometry.height - 700)],
      ]) {
        await page.evaluate(
          (y) => window.scrollTo(0, y),
          geometry.top + offset - 85,
        );
        await page.screenshot({
          path: 'outputs/cinema/' + name + '-' + width + '-' + frame + '.png',
        });
      }
      report.chapters.push({ name, width });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: 'outputs/cinema/landing-' + width + '-full.png',
      fullPage: true,
    });
    const a = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    report.accessibility.push({
      width,
      violations: a.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    });
    errors.push(...a.violations.map((v) => v.id + ' at ' + width));
  }
  report.images = await page
    .locator('.image-led-landing img')
    .evaluateAll((images) =>
      images.map((i) => ({
        src: i.currentSrc,
        loaded: i.complete && i.naturalWidth > 0,
        local: new URL(i.currentSrc).origin === location.origin,
      })),
    );
  if (report.images.some((i) => !i.loaded || !i.local))
    errors.push('Broken or remote photograph');
  if (
    requests.some((url) => /GuardScene|three\.module|images\.pexels/.test(url))
  )
    errors.push('Unexpected heavy or external runtime media');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('link', { name: 'Launch App', exact: true }).click();
  await page.getByRole('heading', { name: 'Protocol overview' }).waitFor();
  if (await page.locator('.pin-spacer').count())
    errors.push('Route retained a pin');
  await page.goto('http://127.0.0.1:3001/');
  await page.locator('h1').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  if (await page.locator('.pin-spacer').count())
    errors.push('Mobile resize retained desktop pin');
} finally {
  await writeFile(
    'outputs/cinema/motion-report.json',
    JSON.stringify({ ...report, errors }, null, 2),
  );
  console.log(
    JSON.stringify(
      { ...report, images: report.images.length, errors },
      null,
      2,
    ),
  );
  await browser.close();
}
if (errors.length) throw new Error(errors.join('\n'));
