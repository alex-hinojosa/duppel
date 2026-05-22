/**
 * Cloudflare bot detection tests.
 *
 * Tests multiple Cloudflare-protected sites at varying security levels.
 * Each site is tested independently — a challenge on one doesn't fail the others.
 *
 * Detection signals:
 * - "Attention Required" / "Challenge" in title → JS challenge or managed challenge
 * - Turnstile iframe → interactive challenge widget
 * - cf-mitigated header → Cloudflare actively intervened
 * - Body < 100 chars → challenge page replaced content
 *
 * Limitations documented in the writeup:
 * - We don't know each site's Cloudflare security level (free/pro/business/enterprise)
 * - Cloudflare challenge behavior varies by IP reputation, geo, time of day
 * - A pass here means "not blocked on this run," not "will never be blocked"
 */

import { test, expect } from '../fixtures/extension';
import { writeBenchmarkResult, type BenchmarkResult } from '../helpers/benchmark-utils';

/** Sites to test, ordered roughly by expected Cloudflare aggressiveness. */
const CLOUDFLARE_SITES = [
  {
    name: 'cloudflare.com',
    url: 'https://www.cloudflare.com/',
    note: 'Cloudflare own site — likely minimal challenge (baseline)',
  },
  {
    name: 'discord.com',
    url: 'https://discord.com/',
    note: 'Major Cloudflare customer — JS challenge common for bots',
  },
  {
    name: 'medium.com',
    url: 'https://medium.com/',
    note: 'Content platform behind Cloudflare CDN + WAF',
  },
  {
    name: 'npmjs.com',
    url: 'https://www.npmjs.com/',
    note: 'Developer registry — Cloudflare protected',
  },
  {
    name: 'canva.com',
    url: 'https://www.canva.com/',
    note: 'Design platform — Cloudflare Enterprise customer',
  },
] as const;

test.describe('Cloudflare @external', () => {
  test.describe.configure({ retries: 2 });

  for (const site of CLOUDFLARE_SITES) {
    test(`loads ${site.name} without Cloudflare block`, async ({ extensionPage }) => {
      test.slow();

      const response = await extensionPage.goto(site.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      await extensionPage.screenshot({
        path: `test-results/cloudflare-${site.name.replace(/\./g, '-')}.png`,
      });

      // --- Detect challenge indicators ---

      const title = await extensionPage.title();
      const isChallengeTitle = /Attention Required|Challenge|Just a moment/i.test(title);

      const bodyText = await extensionPage.textContent('body').catch(() => '');
      const bodyLength = bodyText?.length ?? 0;
      const hasMinimalContent = bodyLength > 100;

      // Check for Turnstile widget (Cloudflare's CAPTCHA replacement)
      const hasTurnstile = await extensionPage
        .locator('iframe[src*="challenges.cloudflare.com"]')
        .count()
        .then((c) => c > 0)
        .catch(() => false);

      // Check cf-mitigated response header
      const cfMitigated = (await response?.headerValue('cf-mitigated')) ?? null;
      const cfRay = (await response?.headerValue('cf-ray')) ?? null;
      const statusCode = response?.status() ?? 0;

      // --- Assertions ---

      // Title should not indicate a challenge page
      expect(
        isChallengeTitle,
        `${site.name}: title suggests challenge page: "${title}"`,
      ).toBe(false);

      // Page should have real content, not a challenge stub
      expect(
        hasMinimalContent,
        `${site.name}: body too short (${bodyLength} chars) — likely challenge page`,
      ).toBe(true);

      // No Turnstile widget should be present
      expect(
        hasTurnstile,
        `${site.name}: Turnstile challenge widget detected`,
      ).toBe(false);

      // Status should be 2xx (challenges often return 403 or 503)
      expect(
        statusCode,
        `${site.name}: HTTP ${statusCode} — may indicate block`,
      ).toBeGreaterThanOrEqual(200);
      expect(statusCode).toBeLessThan(400);

      // --- Write structured result ---

      const result: BenchmarkResult = {
        service: `Cloudflare (${site.name})`,
        timestamp: new Date().toISOString(),
        status: 'pass',
        preRotation: {
          url: site.url,
          note: site.note,
          title,
          bodyLength,
          statusCode,
          cfRay,
          cfMitigated: cfMitigated ?? 'none',
          turnstileDetected: hasTurnstile,
          challengeTitle: isChallengeTitle,
        },
        postRotation: null,
        sessionStable: true,
        rotationChanged: false,
      };

      writeBenchmarkResult(`cloudflare-${site.name.replace(/\./g, '-')}`, result);
    });
  }
});
