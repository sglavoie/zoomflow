import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const runs = Number(process.argv[3] ?? 3);
const cpuRate = Number(process.argv[4] ?? 1);
if (!Number.isInteger(runs) || runs < 1) throw new Error('Runs must be a positive integer');
if (!Number.isFinite(cpuRate) || cpuRate < 1) throw new Error('CPU rate must be at least 1');

const browser = await chromium.launch();
try {
  for (let run = 1; run <= runs; run++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 40, downloadThroughput: 10_000_000 / 8, uploadThroughput: 10_000_000 / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => document.querySelector('#preview-status')?.getAttribute('data-state') === 'ready', null, { timeout: 120_000 });
    const result = await page.evaluate(() => {
      const navigation = /** @type {PerformanceNavigationTiming} */ (performance.getEntriesByType('navigation')[0]);
      const resources = /** @type {PerformanceResourceTiming[]} */ (performance.getEntriesByType('resource'))
        .filter((item) => /\/assets\//.test(item.name))
        .map((item) => ({
          name: item.name.split('/').pop() ?? '', start: Math.round(item.startTime), end: Math.round(item.responseEnd),
          duration: Math.round(item.duration), bytes: item.transferSize,
        }));
      return { readyMs: Math.round(performance.now()), domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
        starterSvgLoadedMs: resources.find((item) => item.name.startsWith('order-preview-'))?.end ?? null, resources };
    });
    console.log(JSON.stringify({ run, ...result }));
    await context.close();
  }
} finally {
  await browser.close();
}
