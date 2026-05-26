/**
 * Duppel v0.1.1 — Native-Compatible Mode Smoke
 *
 * Tests the two sites that received Cloudflare challenges (B&H Photo, OpenAI)
 * with native-compatible mode enabled. This verifies that the C4 escape hatch
 * restores full site functionality.
 */

import { test, expect } from './smoke-fixture';
import fs from 'fs';
import path from 'path';

const RESULTS_DIR = path.resolve(__dirname, '..', '..', 'test-results');

function ensureResultsDir() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

async function enableNativeCompat(
  context: Awaited<ReturnType<typeof import('@playwright/test').chromium.launchPersistentContext>>,
  extensionId: string,
  hostname: string,
) {
  const setupPage = await context.newPage();
  await setupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await setupPage.waitForLoadState('domcontentloaded');
  await setupPage.evaluate(
    async (args: { hostname: string }) => {
      const B = (globalThis as any).browser || chrome;
      await new Promise<void>((resolve) => {
        B.runtime.sendMessage(
          { type: 'setNativeCompat', hostname: args.hostname, enabled: true },
          () => resolve(),
        );
      });
    },
    { hostname },
  );
  await setupPage.close();
  await new Promise(r => setTimeout(r, 500));
}

const CHALLENGED_SITES = [
  {
    name: 'bhphoto-nativecompat',
    url: 'https://www.bhphotovideo.com/',
    hostname: 'www.bhphotovideo.com',
    note: 'B&H Photo with native-compatible mode — should bypass Cloudflare challenge',
  },
  {
    name: 'openai-nativecompat',
    url: 'https://openai.com/',
    hostname: 'openai.com',
    note: 'OpenAI with native-compatible mode — should bypass Cloudflare challenge',
  },
] as const;

test.describe('v0.1.1 Native-Compatible Smoke @smoke', () => {
  test.describe.configure({ retries: 0 });

  for (const site of CHALLENGED_SITES) {
    test(`${site.name} — native-compat bypasses challenge`, async ({ context, extensionId }) => {
      test.slow();

      // Enable native-compatible mode for this site
      await enableNativeCompat(context, extensionId, site.hostname);

      const page = await context.newPage();
      const response = await page.goto(site.url, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });

      await page.waitForTimeout(3000);

      await page.screenshot({
        path: path.join(RESULTS_DIR, `smoke-${site.name}.png`),
      });

      const title = await page.title();
      const bodyText = await page.textContent('body').catch(() => '');
      const bodyLength = bodyText?.length ?? 0;
      const statusCode = response?.status() ?? 0;
      const cfMitigated = (await response?.headerValue('cf-mitigated')) ?? null;
      const isChallengeTitle = /Attention Required|Challenge|Just a moment|Access denied|Verify you are human/i.test(title);

      ensureResultsDir();
      fs.writeFileSync(
        path.join(RESULTS_DIR, `smoke-${site.name}.json`),
        JSON.stringify({
          site: site.name,
          url: site.url,
          nativeCompat: true,
          statusCode,
          title,
          bodyLength,
          challengeDetected: isChallengeTitle,
          cfMitigated,
          loaded: statusCode >= 200 && statusCode < 400 && bodyLength > 100 && !isChallengeTitle,
          note: site.note,
        }, null, 2),
        'utf-8',
      );

      // With native-compat, the site should load without challenge
      expect(isChallengeTitle, `${site.name}: should not see challenge with native-compat`).toBe(false);
      expect(statusCode, `${site.name}: should get 2xx`).toBeGreaterThanOrEqual(200);
      expect(statusCode).toBeLessThan(400);

      await page.close();
    });
  }
});
