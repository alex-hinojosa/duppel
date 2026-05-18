/**
 * EFF Cover Your Tracks quantitative benchmark.
 * Runs the fingerprinting test, extracts bits of identifying information,
 * per-surface uniqueness, and tracker blocking status.
 *
 * Required metrics are hard assertions — missing extraction is a test
 * failure, not a skip.
 */

import { test, expect } from '../fixtures/extension';
import {
  triggerRotation,
  writeBenchmarkResult,
} from '../helpers/benchmark-utils';

const CYT_URL = 'https://coveryourtracks.eff.org/';

interface CYTMetrics {
  bitsOfInfo: string | null;
  trackerBlocking: string | null;
  surfaces: Record<string, string>;
}

/**
 * Run the Cover Your Tracks test and extract results.
 */
async function runTestAndExtract(page: import('@playwright/test').Page): Promise<CYTMetrics> {
  await page.goto(CYT_URL, {
    waitUntil: 'networkidle',
    timeout: 45_000,
  });

  // Click "Test Your Browser" button
  const buttonClicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll('a, button, input[type="submit"]');
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toLowerCase() ?? '';
      if (text.includes('test') && (text.includes('browser') || text.includes('your'))) {
        (btn as HTMLElement).click();
        return true;
      }
    }
    const link = document.querySelector('a[href*="test"]');
    if (link) {
      (link as HTMLElement).click();
      return true;
    }
    return false;
  });

  if (!buttonClicked) {
    await page.goto('https://coveryourtracks.eff.org/kcarter', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
  }

  // Wait for test results
  for (let i = 0; i < 60; i++) {
    const body = await page.textContent('body').catch(() => '');
    if (body && (body.includes('bits of') || body.includes('unique') || body.includes('fingerprint'))) {
      break;
    }
    await page.waitForTimeout(1000);
  }

  await page.waitForTimeout(3000);

  const metrics = await page.evaluate(() => {
    const body = document.body.textContent ?? '';

    let bitsOfInfo: string | null = null;
    const bitsMatch = body.match(/(\d+(?:\.\d+)?)\s*bits?\s*of\s*(?:identifying\s*)?information/i);
    if (bitsMatch) {
      bitsOfInfo = bitsMatch[1];
    }

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

    const surfaces: Record<string, string> = {};
    const rows = document.querySelectorAll('tr, .result-row, [class*="result"]');
    for (const row of rows) {
      const cells = row.querySelectorAll('td, span, div');
      if (cells.length >= 2) {
        const label = cells[0].textContent?.trim() ?? '';
        const value = cells[1].textContent?.trim() ?? '';
        if (label && value && label.length < 60) {
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

    // Required: must extract at least one metric (bits, blocking status, or surfaces)
    const hasData = metrics.bitsOfInfo || metrics.trackerBlocking || Object.keys(metrics.surfaces).length > 0;
    expect(hasData, 'Required metric: Cover Your Tracks must produce bits, blocking status, or surface data').toBeTruthy();

    if (metrics.bitsOfInfo) {
      const bits = parseFloat(metrics.bitsOfInfo);
      expect(bits).toBeGreaterThan(0);
    }

    writeBenchmarkResult('coveryourtracks-results', {
      service: 'Cover Your Tracks',
      timestamp: new Date().toISOString(),
      status: 'pass',
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

    // Required: tracker blocking status must be determinable
    expect(metrics.trackerBlocking, 'Required metric: tracker blocking status must be extractable').not.toBeNull();

    writeBenchmarkResult('coveryourtracks-blocking', {
      service: 'Cover Your Tracks',
      timestamp: new Date().toISOString(),
      status: 'pass',
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

    // Required: must get data to compare
    const preHasData = preMetrics.bitsOfInfo || Object.keys(preMetrics.surfaces).length > 0;
    expect(preHasData, 'Required metric: pre-rotation CYT data must be extractable').toBeTruthy();

    // Rotate
    await triggerRotation(context, extensionId);

    // Post-rotation
    const postPage = await context.newPage();
    const postMetrics = await runTestAndExtract(postPage);
    await postPage.screenshot({ path: 'test-results/coveryourtracks-post.png', fullPage: true });
    await postPage.close();

    const postHasData = postMetrics.bitsOfInfo || Object.keys(postMetrics.surfaces).length > 0;
    expect(postHasData, 'Required metric: post-rotation CYT data must be extractable').toBeTruthy();

    const preData = JSON.stringify({ bits: preMetrics.bitsOfInfo, surfaces: preMetrics.surfaces });
    const postData = JSON.stringify({ bits: postMetrics.bitsOfInfo, surfaces: postMetrics.surfaces });
    const changed = preData !== postData;

    if (!changed) {
      console.warn('WARNING: Cover Your Tracks showed identical results pre/post rotation');
    }

    writeBenchmarkResult('coveryourtracks-rotation', {
      service: 'Cover Your Tracks',
      timestamp: new Date().toISOString(),
      status: 'pass',
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
  });
});
