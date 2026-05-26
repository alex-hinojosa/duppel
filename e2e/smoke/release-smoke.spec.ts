/**
 * Duppel v0.1.1 — Release Smoke Matrix
 *
 * Tests the RC artifact against real sites in PRODUCTION configuration:
 *   strictFirstDoc: true (not disabled — this is the real user experience)
 *
 * Per rowan UID 825, the smoke matrix must include:
 *   - Cloudflare challenge site(s)
 *   - OpenAI
 *   - B&H Photo
 *   - LinkedIn
 *   - Meta/Facebook
 *   - BestBuy
 *   - One neutral control site
 *
 * Each site gets TWO navigations per strict-next-nav:
 *   Nav 1: all-native (strict arming only — no JS bootstrap, main_frame-only DNR)
 *   Nav 2: full persona (JS bootstrap + expanded DNR)
 *
 * We record:
 *   - Whether each navigation loads without challenge/block
 *   - Page title and status code
 *   - Cloudflare indicators (cf-ray, turnstile, challenge title)
 *   - Screenshots for evidence
 */

import { test, expect } from './smoke-fixture';
import fs from 'fs';
import path from 'path';

const RESULTS_DIR = path.resolve(__dirname, '..', '..', 'test-results');

interface SmokeResult {
  site: string;
  url: string;
  nav1: NavResult;
  nav2: NavResult;
  verdict: 'pass' | 'fail' | 'degraded';
  notes: string;
}

interface NavResult {
  phase: 'native' | 'persona';
  statusCode: number;
  title: string;
  bodyLength: number;
  challengeDetected: boolean;
  turnstileDetected: boolean;
  cfRay: string | null;
  cfMitigated: string | null;
  loaded: boolean;
  error: string | null;
}

function ensureResultsDir() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

function writeResult(name: string, data: SmokeResult) {
  ensureResultsDir();
  const filePath = path.join(RESULTS_DIR, `smoke-${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function captureNavResult(
  page: ReturnType<Awaited<ReturnType<typeof import('@playwright/test').chromium.launchPersistentContext>>['newPage']> extends Promise<infer P> ? P : never,
  phase: 'native' | 'persona',
  url: string,
  siteName: string,
  navNum: number,
): Promise<NavResult> {
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });

    // Wait for page to settle
    await page.waitForTimeout(3000);

    await page.screenshot({
      path: path.join(RESULTS_DIR, `smoke-${siteName}-nav${navNum}.png`),
    });

    const title = await page.title();
    const bodyText = await page.textContent('body').catch(() => '');
    const bodyLength = bodyText?.length ?? 0;

    const isChallengeTitle = /Attention Required|Challenge|Just a moment|Access denied|Verify you are human/i.test(title);

    const hasTurnstile = await page
      .locator('iframe[src*="challenges.cloudflare.com"]')
      .count()
      .then((c) => c > 0)
      .catch(() => false);

    const statusCode = response?.status() ?? 0;
    const cfRay = (await response?.headerValue('cf-ray')) ?? null;
    const cfMitigated = (await response?.headerValue('cf-mitigated')) ?? null;

    return {
      phase,
      statusCode,
      title,
      bodyLength,
      challengeDetected: isChallengeTitle,
      turnstileDetected: hasTurnstile,
      cfRay,
      cfMitigated,
      loaded: statusCode >= 200 && statusCode < 400 && bodyLength > 100 && !isChallengeTitle,
      error: null,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Try to screenshot even on error
    await page.screenshot({
      path: path.join(RESULTS_DIR, `smoke-${siteName}-nav${navNum}-error.png`),
    }).catch(() => {});

    return {
      phase,
      statusCode: 0,
      title: '',
      bodyLength: 0,
      challengeDetected: false,
      turnstileDetected: false,
      cfRay: null,
      cfMitigated: null,
      loaded: false,
      error: errorMsg,
    };
  }
}

/** Sites required by rowan UID 825 */
const SMOKE_SITES = [
  // Cloudflare challenge sites
  {
    name: 'cloudflare',
    url: 'https://www.cloudflare.com/',
    note: 'Cloudflare own site (baseline)',
  },
  {
    name: 'discord',
    url: 'https://discord.com/',
    note: 'Cloudflare customer — JS challenge common',
  },
  // High-posture sites from rowan's list
  {
    name: 'openai',
    url: 'https://openai.com/',
    note: 'OpenAI — high security posture',
  },
  {
    name: 'bhphoto',
    url: 'https://www.bhphotovideo.com/',
    note: 'B&H Photo — e-commerce, bot detection',
  },
  {
    name: 'linkedin',
    url: 'https://www.linkedin.com/',
    note: 'LinkedIn — login wall, bot detection',
  },
  {
    name: 'facebook',
    url: 'https://www.facebook.com/',
    note: 'Meta/Facebook — aggressive bot detection',
  },
  {
    name: 'bestbuy',
    url: 'https://www.bestbuy.com/',
    note: 'BestBuy — e-commerce, bot detection',
  },
  // Neutral control
  {
    name: 'wikipedia',
    url: 'https://en.wikipedia.org/wiki/Main_Page',
    note: 'Wikipedia — neutral control, no bot detection',
  },
] as const;

test.describe('v0.1.1 Release Smoke Matrix @smoke', () => {
  // No retries — we want honest results
  test.describe.configure({ retries: 0 });

  for (const site of SMOKE_SITES) {
    test(`${site.name} — strict-next-nav two-navigation smoke`, async ({ context }) => {
      test.slow(); // 90s timeout

      const page = await context.newPage();

      // Nav 1: native (strictFirstDoc: true means first nav is all-native)
      const nav1 = await captureNavResult(page, 'native', site.url, site.name, 1);

      // Nav 2: persona (second navigation gets full JS bootstrap + expanded DNR)
      // Use reload to stay on same page — tests the exact strict-next-nav lifecycle
      await page.waitForTimeout(1000);
      const nav2 = await captureNavResult(page, 'persona', site.url, site.name, 2);

      // Determine verdict
      let verdict: 'pass' | 'fail' | 'degraded' = 'pass';
      let notes = '';

      if (!nav1.loaded && !nav2.loaded) {
        verdict = 'fail';
        notes = 'Both navigations failed to load.';
      } else if (!nav1.loaded) {
        verdict = 'degraded';
        notes = `Nav 1 (native) failed: ${nav1.error || 'challenge/block'}. Nav 2 (persona) loaded OK.`;
      } else if (!nav2.loaded) {
        verdict = 'degraded';
        notes = `Nav 1 (native) OK. Nav 2 (persona) failed: ${nav2.error || 'challenge/block'}.`;
      } else {
        notes = 'Both navigations loaded successfully.';
      }

      if (nav1.challengeDetected || nav2.challengeDetected) {
        notes += ' Challenge page detected.';
      }
      if (nav1.turnstileDetected || nav2.turnstileDetected) {
        notes += ' Turnstile widget detected.';
      }

      const result: SmokeResult = {
        site: site.name,
        url: site.url,
        nav1,
        nav2,
        verdict,
        notes: `${site.note}. ${notes}`.trim(),
      };

      writeResult(site.name, result);

      // Soft assertion: at least one navigation should work.
      // We don't hard-fail on challenge pages — some sites may challenge
      // automated browsers regardless of fingerprint spoofing.
      // The evidence (screenshots + JSON) is what matters for the smoke report.
      if (site.name === 'wikipedia') {
        // Control site must pass
        expect(nav1.loaded || nav2.loaded, `${site.name}: control site should load`).toBe(true);
      }

      await page.close();
    });
  }
});
