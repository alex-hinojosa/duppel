/**
 * FingerprintJS quantitative benchmark.
 * Extracts visitorId, validates cross-tab behavior, and verifies
 * rotation produces distinct identities.
 *
 * Required metrics are hard assertions — missing extraction is a test
 * failure, not a skip.
 */

import { test, expect } from '../fixtures/extension';
import {
  triggerRotation,
  writeBenchmarkResult,
} from '../helpers/benchmark-utils';

const FPJS_URL = 'https://fingerprintjs.github.io/fingerprintjs/';

/**
 * Wait for FingerprintJS to compute and extract the visitorId.
 * The demo page displays a hex string once computation completes.
 */
async function extractVisitorId(page: import('@playwright/test').Page): Promise<string | null> {
  await page.waitForTimeout(5000);

  const visitorId = await page.evaluate(() => {
    const selectors = ['.visitor-id', '[data-visitor-id]', '.fp-result', 'code', 'pre'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent?.trim() ?? '';
        const match = text.match(/\b([0-9a-f]{16,64})\b/i);
        if (match) return match[1];
      }
    }
    const body = document.body.textContent ?? '';
    const match = body.match(/\b([0-9a-f]{20,64})\b/i);
    return match ? match[1] : null;
  });

  return visitorId;
}

test.describe('FingerprintJS @external', () => {
  test.describe.configure({ retries: 2 });

  test('visitorId is generated', async ({ extensionPage }) => {
    test.slow();
    await extensionPage.goto(FPJS_URL, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    const visitorId = await extractVisitorId(extensionPage);
    await extensionPage.screenshot({ path: 'test-results/fingerprintjs.png' });

    // Required metric
    expect(visitorId, 'Required metric: FingerprintJS visitorId must be extractable').not.toBeNull();
    expect(visitorId).toMatch(/^[0-9a-f]{16,64}$/i);

    writeBenchmarkResult('fingerprintjs-generated', {
      service: 'FingerprintJS',
      timestamp: new Date().toISOString(),
      status: 'pass',
      preRotation: { visitorId },
      postRotation: null,
      sessionStable: true,
      rotationChanged: false,
    });
  });

  test('visitorId cross-tab measurement', async ({ context }) => {
    test.slow();

    const tab1 = await context.newPage();
    await tab1.goto(FPJS_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    const id1 = await extractVisitorId(tab1);

    const tab2 = await context.newPage();
    await tab2.goto(FPJS_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    const id2 = await extractVisitorId(tab2);

    await tab1.close();
    await tab2.close();

    // Required: both IDs must be extractable
    expect(id1, 'Required metric: visitorId from tab 1 must be extractable').not.toBeNull();
    expect(id2, 'Required metric: visitorId from tab 2 must be extractable').not.toBeNull();

    // PhantomGrid's per-page canvas noise means FingerprintJS will compute
    // a different visitorId per tab. This is by design — per-page randomness
    // is the stronger anti-fingerprinting posture. Record as measurement.
    const stable = id1 === id2;
    if (!stable) {
      console.warn('NOTE: visitorId differs across tabs — expected with per-page canvas noise');
    }

    writeBenchmarkResult('fingerprintjs-stability', {
      service: 'FingerprintJS',
      timestamp: new Date().toISOString(),
      status: 'pass',
      preRotation: { visitorId_tab1: id1, visitorId_tab2: id2 },
      postRotation: null,
      sessionStable: stable,
      rotationChanged: false,
    });
  });

  test('visitorId changes on rotation', async ({ context, extensionId }) => {
    test.slow();

    // Pre-rotation
    const prePage = await context.newPage();
    await prePage.goto(FPJS_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    const preId = await extractVisitorId(prePage);
    await prePage.screenshot({ path: 'test-results/fingerprintjs-pre.png' });
    await prePage.close();

    // Required metric
    expect(preId, 'Required metric: pre-rotation visitorId must be extractable').not.toBeNull();

    // Rotate
    await triggerRotation(context, extensionId);

    // Post-rotation
    const postPage = await context.newPage();
    await postPage.goto(FPJS_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    const postId = await extractVisitorId(postPage);
    await postPage.screenshot({ path: 'test-results/fingerprintjs-post.png' });
    await postPage.close();

    // Required metric
    expect(postId, 'Required metric: post-rotation visitorId must be extractable').not.toBeNull();
    expect(preId).not.toBe(postId);

    writeBenchmarkResult('fingerprintjs-rotation', {
      service: 'FingerprintJS',
      timestamp: new Date().toISOString(),
      status: 'pass',
      preRotation: { visitorId: preId },
      postRotation: { visitorId: postId },
      sessionStable: true,
      rotationChanged: preId !== postId,
    });
  });

  test('3 rotations produce 3 distinct visitorIds', async ({ context, extensionId }) => {
    test.slow();
    const ids: string[] = [];

    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        await triggerRotation(context, extensionId);
      }

      const page = await context.newPage();
      await page.goto(FPJS_URL, { waitUntil: 'networkidle', timeout: 30_000 });
      const id = await extractVisitorId(page);
      await page.close();

      // Required metric per rotation
      expect(id, `Required metric: visitorId must be extractable on rotation ${i}`).not.toBeNull();
      ids.push(id!);
    }

    const unique = new Set(ids).size;
    expect(unique).toBe(3);

    writeBenchmarkResult('fingerprintjs-3rotations', {
      service: 'FingerprintJS',
      timestamp: new Date().toISOString(),
      status: 'pass',
      preRotation: { visitorIds: ids },
      postRotation: null,
      sessionStable: true,
      rotationChanged: unique === 3,
    });
  });
});
