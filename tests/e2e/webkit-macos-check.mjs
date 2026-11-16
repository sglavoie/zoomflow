// Native lifecycle regression: no app server or full browser matrix needed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { webkit } from '@playwright/test';
import { macOSWebKitLaunchOptions } from './webkit-macos.ts';

if (process.platform !== 'darwin' || Number(release().split('.')[0]) !== 27) {
  console.log('Screen Time regression check applies to macOS 27 only.');
} else if (process.argv.includes('--child')) {
  async function exercise(headless, count) {
    const browser = await webkit.launch({ ...macOSWebKitLaunchOptions(true), headless });
    try {
      for (let index = 0; index < count; index++) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.setContent('<button onclick="this.textContent=\'Clicked\'">Ready</button>');
          await page.getByRole('button', { name: 'Ready' }).click();
          assert.equal(await page.getByRole('button').textContent(), 'Clicked');
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => exercise(true, 50)));
  await exercise(false, 5);
} else {
  const start = performance.now();
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child'], {
    encoding: 'utf8', timeout: 180_000, maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, DEBUG: 'pw:browser' },
  });
  const artifact = new URL('../../dist/webkit-macos/lifecycle-check.log', import.meta.url);
  mkdirSync(new URL('.', artifact), { recursive: true });
  writeFileSync(artifact, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  assert.ifError(result.error);
  assert.equal(result.status, 0, `Browser lifecycle failed; see ${fileURLToPath(artifact)}`);
  // This must come from the injected code at the actual native initialization
  // boundary. Successful browser launches alone cannot validate this workaround.
  const disabled = result.stderr.match(/ScreenTimeEnabled=0 before WKWebView initialization/g) ?? [];
  assert.equal(disabled.length, 205, 'Every view must confirm that Screen Time is disabled');
  assert.doesNotMatch(result.stderr, /exitCode=(?!0\b)\d+|signal=SIG/);
  console.log(`205 contexts passed (200 headless, 5 headed), with 205 native preference checks, in ${((performance.now() - start) / 1000).toFixed(1)}s.`);
}
