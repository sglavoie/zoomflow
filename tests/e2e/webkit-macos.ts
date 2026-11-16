import { webkit, type LaunchOptions } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function macOSWebKitLaunchOptions(diagnostics = false): LaunchOptions {
  if (process.platform !== 'darwin' || Number(release().split('.')[0]) !== 27) return {};

  const source = fileURLToPath(new URL('./webkit-macos.m', import.meta.url));
  const cache = fileURLToPath(new URL('../../dist/webkit-macos', import.meta.url));
  const digest = createHash('sha256').update(readFileSync(source)).update(process.arch).update(release()).digest('hex').slice(0, 16);
  const library = join(cache, `screen-time-${digest}.dylib`);
  mkdirSync(cache, { recursive: true });
  if (!existsSync(library)) {
    // Each concurrent runner compiles privately, then publishes a complete file.
    const temporary = mkdtempSync(join(cache, 'build-'));
    try {
      const output = join(temporary, 'screen-time.dylib');
      execFileSync('/usr/bin/xcrun', ['clang', '-dynamiclib', '-Wall', '-Wextra', '-Werror',
        '-framework', 'Cocoa', '-framework', 'WebKit', source, '-o', output], { stdio: 'pipe', timeout: 30_000 });
      renameSync(output, library);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  // pw_run.sh starts a system shell, which strips DYLD_INSERT_LIBRARIES. Launch
  // the same bundled app directly with pw_run.sh's framework search paths.
  const bundle = dirname(webkit.executablePath());
  const executablePath = join(bundle, 'Playwright.app/Contents/MacOS/Playwright');
  if (!existsSync(executablePath)) throw new Error(`Cannot locate bundled WebKit at ${executablePath}`);
  return { executablePath, env: { ...process.env,
    DYLD_FRAMEWORK_PATH: bundle, DYLD_LIBRARY_PATH: bundle,
    DYLD_INSERT_LIBRARIES: [library, process.env.DYLD_INSERT_LIBRARIES].filter(Boolean).join(':'),
    ...(diagnostics ? { ZOOMFLOW_WEBKIT_DIAGNOSTICS: '1' } : {}),
  } };
}
