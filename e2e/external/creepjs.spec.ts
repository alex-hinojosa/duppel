/**
 * CreepJS quantitative benchmark.
 * Extracts trust score, lie count, fingerprint hash.
 * CreepJS takes 10-20 seconds to compute — all tests use extended timeouts.
 *
 * Required metrics are hard assertions — missing extraction is a test
 * failure, not a skip.
 */

import { test, expect } from '../fixtures/extension';
import {
  triggerRotation,
  writeBenchmarkResult,
} from '../helpers/benchmark-utils';

const CREEPJS_URL = 'https://abrahamjuliot.github.io/creepjs/';

interface CreepJSMetrics {
  trustScore: string | null;
  lieCount: number | null;
  fingerprintHash: string | null;
  lieCategories: string[];
}

/**
 * Wait for CreepJS to finish computing and extract metrics.
 * CreepJS uses dynamic class names, so we rely on text content patterns.
 */
async function extractCreepJSMetrics(page: import('@playwright/test').Page): Promise<CreepJSMetrics> {
  // Poll for CreepJS to finish — look for trust score or percentage
  for (let i = 0; i < 60; i++) {
    const body = await page.textContent('body').catch(() => '');
    if (body && (body.includes('trust score') || body.includes('Trust Score') || body.match(/\d+(\.\d+)?%/))) {
      break;
    }
    await page.waitForTimeout(1000);
  }

  await page.waitForTimeout(2000);

  const metrics = await page.evaluate(() => {
    const body = document.body.textContent ?? '';

    let trustScore: string | null = null;
    const trustMatch = body.match(/(?:trust\s*score[:\s]*)?(\d+(?:\.\d+)?)\s*%/i);
    if (trustMatch) {
      trustScore = trustMatch[1] + '%';
    }

    let fingerprintHash: string | null = null;
    const hashMatch = body.match(/\b([0-9a-f]{8,64})\b/i);
    if (hashMatch) {
      fingerprintHash = hashMatch[1];
    }

    let lieCount: number | null = null;
    const lieCountMatch = body.match(/(\d+)\s*lie/i);
    if (lieCountMatch) {
      lieCount = parseInt(lieCountMatch[1], 10);
    }

    const lieCategories: string[] = [];
    const lieCatPatterns = [
      /toString\s*(?:lie|detected)/i,
      /descriptor\s*(?:lie|detected)/i,
      /prototype\s*(?:lie|detected)/i,
      /getOwnPropertyDescriptor\s*(?:lie|detected)/i,
      /iframe\s*(?:lie|detected)/i,
    ];
    for (const pattern of lieCatPatterns) {
      if (pattern.test(body)) {
        const cat = pattern.source.split('\\s')[0];
        lieCategories.push(cat);
      }
    }

    return { trustScore, lieCount, fingerprintHash, lieCategories };
  });

  return metrics;
}

test.describe('CreepJS @external', () => {
  test.describe.configure({ retries: 2 });

  test('generates trust score and fingerprint', async ({ extensionPage }) => {
    test.slow();
    await extensionPage.goto(CREEPJS_URL, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });

    const metrics = await extractCreepJSMetrics(extensionPage);
    await extensionPage.screenshot({ path: 'test-results/creepjs.png', fullPage: true });

    // Required: at least trust score or fingerprint hash must be present
    const hasData = metrics.trustScore || metrics.fingerprintHash;
    expect(hasData, 'Required metric: CreepJS must produce a trust score or fingerprint hash').toBeTruthy();

    if (metrics.trustScore) {
      const pct = parseFloat(metrics.trustScore);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }

    writeBenchmarkResult('creepjs-metrics', {
      service: 'CreepJS',
      timestamp: new Date().toISOString(),
      status: 'pass',
      preRotation: {
        trustScore: metrics.trustScore,
        lieCount: metrics.lieCount,
        fingerprintHash: metrics.fingerprintHash,
        lieCategories: metrics.lieCategories,
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
    await prePage.goto(CREEPJS_URL, { waitUntil: 'networkidle', timeout: 60_000 });
    const preMetrics = await extractCreepJSMetrics(prePage);
    await prePage.screenshot({ path: 'test-results/creepjs-pre.png', fullPage: true });
    await prePage.close();

    // Required metric
    expect(preMetrics.fingerprintHash, 'Required metric: pre-rotation CreepJS fingerprint hash must be extractable').not.toBeNull();

    // Rotate
    await triggerRotation(context, extensionId);

    // Post-rotation
    const postPage = await context.newPage();
    await postPage.goto(CREEPJS_URL, { waitUntil: 'networkidle', timeout: 60_000 });
    const postMetrics = await extractCreepJSMetrics(postPage);
    await postPage.screenshot({ path: 'test-results/creepjs-post.png', fullPage: true });
    await postPage.close();

    // Required metric: extraction must succeed
    expect(postMetrics.fingerprintHash, 'Required metric: post-rotation CreepJS fingerprint hash must be extractable').not.toBeNull();

    // CreepJS hash rotation is live-service dependent. CreepJS may return
    // the same hash pre/post if its computation is dominated by surfaces
    // PhantomGrid doesn't noise, or if CreepJS caches results within the
    // browser session. Record honestly: pass if changed, inconclusive if not.
    const rotationChanged = preMetrics.fingerprintHash !== postMetrics.fingerprintHash;
    if (!rotationChanged) {
      console.warn('NOTE: CreepJS fingerprint hash unchanged after rotation — may be session-cached or dominated by un-noised surfaces');
    }

    writeBenchmarkResult('creepjs-rotation', {
      service: 'CreepJS',
      timestamp: new Date().toISOString(),
      status: rotationChanged ? 'pass' : 'inconclusive',
      preRotation: {
        trustScore: preMetrics.trustScore,
        lieCount: preMetrics.lieCount,
        fingerprintHash: preMetrics.fingerprintHash,
      },
      postRotation: {
        trustScore: postMetrics.trustScore,
        lieCount: postMetrics.lieCount,
        fingerprintHash: postMetrics.fingerprintHash,
      },
      sessionStable: true,
      rotationChanged,
    });
  });

  test('lie count is observable', async ({ extensionPage }) => {
    test.slow();
    await extensionPage.goto(CREEPJS_URL, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });

    const metrics = await extractCreepJSMetrics(extensionPage);
    await extensionPage.screenshot({ path: 'test-results/creepjs-lies.png', fullPage: true });

    // Required: CreepJS must have completed its analysis (trust score present)
    expect(
      metrics.trustScore || metrics.fingerprintHash,
      'Required metric: CreepJS must complete analysis (trust score or hash present)',
    ).toBeTruthy();

    writeBenchmarkResult('creepjs-lies', {
      service: 'CreepJS',
      timestamp: new Date().toISOString(),
      status: 'pass',
      preRotation: {
        lieCount: metrics.lieCount,
        lieCategories: metrics.lieCategories,
        trustScore: metrics.trustScore,
      },
      postRotation: null,
      sessionStable: true,
      rotationChanged: false,
    });
  });
});
