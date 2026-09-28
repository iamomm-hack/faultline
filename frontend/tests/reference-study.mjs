import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('outputs/references', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const [name, url] of [
  ['kimia', 'https://kimia.live/'],
  ['valdyum', 'https://www.valdyum.live/'],
]) {
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await page.waitForTimeout(4500);
    console.log(
      name,
      response.status(),
      (await page.locator('body').innerText()).slice(0, 3000),
    );
    for (const [frame, y] of [
      ['opening', 0],
      ['middle', 1000],
      ['lower', 2500],
    ]) {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      await page.waitForTimeout(1500);
      await page.screenshot({
        path: `outputs/references/${name}-${frame}.png`,
      });
    }
  } catch (e) {
    console.log(name, e.message);
  }
}
try {
  const response = await fetch(
    'https://api.github.com/repos/SATISH-JALAN/Vouch/git/trees/main?recursive=1',
  );
  const tree = await response.json();
  console.log(
    'Vouch',
    response.status,
    tree.tree
      ?.filter(
        (x) =>
          x.path.startsWith('frontend/') &&
          /motion|lenis|scroll|transition|preload|cursor|package.json/i.test(
            x.path,
          ),
      )
      .map((x) => x.path),
  );
} catch (e) {
  console.log('Vouch', e.message);
}
await browser.close();
