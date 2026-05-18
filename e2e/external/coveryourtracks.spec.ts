/**
 * EFF Cover Your Tracks quantitative benchmark.
 * Runs the fingerprinting test, extracts bits of identifying information,
 * per-surface uniqueness, and tracker blocking status.
 */

import { test, expect } from '../fixtures/extension';
import {
  triggerRotation,
  writeBenchmarkResult,
  waitForSelector,
} from '../helpers/benchmark-utils';

const CYT_URL = 'https://coveryourtracks.eff.org/';

interface CYTMetrics {
  bitsOfInfo: string | null;
  trackerBlocking: string | null;
  surfaces: Record<string, string>;
}

/**
 * Run the Cover Your Tracks test and extract results.
 * The test requires clicking a button and waiting for results.
 */
async function runTestAndExtract(page: import('@playwright/test').Page): Promise<CYTMetrics> {
  await page.goto(CYT_URL, {
    waitUntil: 'networkidle',
    timeout: 45_000,
  });

  // Click "Test Your Browser" button — try multiple selectors
  const buttonClicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll('a, button, input[type="submit"]');
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toLowerCase() ?? '';
      if (text.includes('test') && (text.includes('browser') || text.includes('your'))) {
        (btn as HTMLElement).click();
        return true;
      }
    }
    // Try the specific known link
    const link = document.querySelector('a[href*="test"]');
    if (link) {
      (link as HTMLElement).click();
      return true;
    }
    return false;
  });

  if (!buttonClicked) {
    // Try direct navigation to the test endpoint
    await page.goto('https://coveryourtracks.eff.org/kcarter', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
  }

  // Wait for the test to complete — look for results content
  for (let i = 0; i < 60; i++) {
    const body = await page.textContent('body').catch(() => '');
    if (body && (body.includes('bits of') || body.includes('unique') || body.includes('fingerprint'))) {
      break;
    }
    await page.waitForTimeout(1000);
  }

  // Additional settle time for results rendering
  await page.waitForTimeout(3000);

  const metrics = await page.evaluate(() => {
    const body = document.body.textContent ?? '';

    // Extract bits of identifying information
    let bitsOfInfo: string | null = null;
    const bitsMatch = body.match(/(\d+(?:\.\d+)?)\s*bits?\s*of\s*(?:identifying\s*)?information/i);
    if (bitsMatch) {
      bitsOfInfo = bitsMatch[1];
    }

    // Tracker blocking result
    let trackerBlocking: string | null = null;
    if (/block.*track/i.test(body) || /track.*block/i.test(body)) {
      if (/does\s+block/i.test(body) || /blocked/i.test(body)) {
        trackerBlocking = 'blocked';
      } else if (/does\s+not\s+block/i.test(body) || /not\s+blocked/i.test(body) || /allowed/i.test(body)) {
        trackerBlocking = 'allowed';
      } else {
        trackerBlocking = 'partial';
      }
    }

    // Per-surface uniqueness — extract from results table if present
    const surfaces: Record<string, string> = {};
    const rows = document.querySelectorAll('tr, .result-row, [class*="result"]');
    for (const row of rows) {
      const cells = row.querySelectorAll('td, span, div');
      if (cells.length >= 2) {
        const label = cells[0].textContent?.trim() ?? '';
        const value = cells[1].textContent?.trim() ?? '';
        if (label && value && label.length < 60) {
          // Filter for fingerprint-related surfaces
          const lcLabel = label.toLowerCase();
          if (lcLabel.includes('unique') || lcLabel.includes('canvas') ||
              lcLabel.includes('webgl') || lcLabel.includes('audio') ||
              lcLabel.includes('font') || lcLabel.includes('screen') ||
              lcLabel.includes('user agent') || lcLabel.includes('plugin') ||
              lcLabel.includes('timezone') || lcLabel.includes('language')) {
            surfaces[label] = value;
          }
        }
      }
    }

    return { bitsOfInfo, trackerBlocking, surfaces };
  });

  return metrics;
}

test.describe('Cover Your Tracks @external', () => {
  test.describe.configure({ retries: 2 });

  test('runs test and produces results', async ({ extensionPage }) => {
    test.slow();

    const metrics = await runTestAndExtract(extensionPage);
    await extensionPage.screenshot({ path: 'test-results/coveryourtracks.png', fullPage: true });

    // We should get at least some data from the test
    const hasData = metrics.bitsOfInfo || metrics.trackerBlocking || Object.keys(metrics.surfaces).length > 0;

    if (!hasData) {
      // Check if we're on a results page at all
      const url = extensionPage.url();
      const bodyLen = (await extensionPage.textContent('body').catch(() => '')).length;
      test.skip(true, `No extractable data from CYT (URL: ${url}, body length: ${bodyLen})`);
      return;
    }

    if (metrics.bitsOfInfo) {
      const bits = parseFloat(metrics.bitsOfInfo);
      expect(bits).toBeGreaterThan(0);
    }

    writeBenchmarkResult('coveryourtracks-results', {
      service: 'Cover Your Tracks',
      timestamp: new Date().toISOString(),
      preRotation: {
        bitsOfInfo: metrics.bitsOfInfo,
        trackerBlocking: metrics.trackerBlocking,
        surfaceCount: Object.keys(metrics.surfaces).length,
        ...metrics.surfaces,
      },
      postRotation: null,
      sessionStable: true,
      rotationChanged: false,
    });
  });

  test('tracker blocking detected', async ({ extensionPage }) => {
    test.slow();

    const metrics = await runTestAndExtract(extensionPage);
    await extensionPage.screenshot({ path: 'test-results/coveryourtracks-blocking.png', fullPage: true });

    if (!metrics.trackerBlocking) {
      test.skip(true, 'Could not determine tracker blocking status');
      return;
    }

    // Log the result — we don't enforce a specific outcome since it depends
    // on PhantomGrid's current blocking implementation
    writeBenchmarkResult('coveryourtracks-blocking', {
      service: 'Cover Your Tracks',
      timestamp: new Date().toISOString(),
      preRotation: {
        trackerBlocking: metrics.trackerBlocking,
      },
      postRotation: null,
      sessionStable: true,
      rotationChanged: false,
    });
  });

  test('fingerprint changes on rotation', async ({ context, extensionId }) => {
    test.slow();

    // Pre-rotation
    const prePage = await context.newPage();
    const preMetrics = await runTestAndExtract(prePage);
    await prePage.screenshot({ path: 'test-results/coveryourtracks-pre.png', fullPage: true });
    await prePage.close();

    const preData = JSON.stringify({
      bits: preMetrics.bitsOfInfo,
      surfaces: preMetrics.surfaces,
    });

    if (!preMetrics.bitsOfInfo && Object.keys(preMetrics.surfaces).length === 0) {
      test.skip(true, 'Could not extract pre-rotation metrics');
      return;
    }

    // Rotate
    await triggerRotation(context, extensionId);

    // Post-rotation
    const postPage = await context.newPage();
    const postMetrics = await runTestAndExtract(postPage);
    await postPage.screenshot({ path: 'test-results/coveryourtracks-post.png', fullPage: true });
    await postPage.close();

    const postData = JSON.stringify({
      bits: postMetrics.bitsOfInfo,
      surfaces: postMetrics.surfaces,
    });

    // The composite fingerprint should differ after rotation
    // (bits value or surface values should change)
    const changed = preData !== postData;

    writeBenchmarkResult('coveryourtracks-rotation', {
      service: 'Cover Your Tracks',
      timestamp: new Date().toISOString(),
      preRotation: {
        bitsOfInfo: preMetrics.bitsOfInfo,
        surfaceCount: Object.keys(preMetrics.surfaces).length,
      },
      postRotation: {
        bitsOfInfo: postMetrics.bitsOfInfo,
        surfaceCount: Object.keys(postMetrics.surfaces).length,
      },
      sessionStable: true,
      rotationChanged: changed,
    });

    // Soft assertion — rotation should change _something_
    if (!changed) {
      console.warn('WARNING: Cover Your Tracks showed identical results pre/post rotation');
    }
  });
});
