/**
 * Vanilla Chrome baseline benchmark.
 *
 * Runs the same fingerprinting services WITHOUT Duppel to establish
 * baseline metrics for comparison. Covers:
 *   - BrowserLeaks: canvas hash, WebGL vendor/renderer, navigator properties
 *   - FingerprintJS: visitorId (should be stable across tabs without noise)
 *   - EFF Cover Your Tracks: bits of identifying information
 *   - CreepJS: trust score, lie count
 */

import { test, expect } from '../fixtures/baseline';
import fs from 'fs';
import path from 'path';

function writeBaseline(name: string, data: Record<string, unknown>): void {
  const dir = path.resolve(__dirname, '..', '..', 'test-results');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `baseline-${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

test.describe('Vanilla Chrome Baseline @baseline', () => {
  test.describe.configure({ retries: 2 });

  test('BrowserLeaks canvas baseline', async ({ context }) => {
    test.slow();

    const page = await context.newPage();
    await page.goto('https://browserleaks.com/canvas', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'test-results/baseline-browserleaks-canvas.png' });

    const results = await page.evaluate(() => {
      // Extract hash from BrowserLeaks table
      let hash = null;
      const rows = document.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const label = cells[0].textContent?.trim().toLowerCase() ?? '';
          if (label.includes('hash') || label.includes('signature')) {
            hash = cells[1].textContent?.trim() ?? null;
          }
        }
      }

      // Also read navigator properties
      return {
        canvasHash: hash,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: (navigator as any).deviceMemory ?? null,
      };
    });

    await page.close();

    expect(results.canvasHash, 'Canvas hash must be extractable').not.toBeNull();

    writeBaseline('browserleaks-canvas', {
      service: 'BrowserLeaks Canvas (Baseline)',
      timestamp: new Date().toISOString(),
      ...results,
    });
  });

  test('BrowserLeaks WebGL baseline', async ({ context }) => {
    test.slow();

    const page = await context.newPage();
    await page.goto('https://browserleaks.com/webgl', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/baseline-browserleaks-webgl.png' });

    const results = await page.evaluate(() => {
      const getText = (label: string): string | null => {
        const rows = document.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const cellLabel = cells[0].textContent?.trim().toLowerCase() ?? '';
            if (cellLabel.includes(label.toLowerCase())) {
              return cells[1].textContent?.trim() ?? null;
            }
          }
        }
        return null;
      };
      return {
        vendor: getText('unmasked vendor') ?? getText('vendor'),
        renderer: getText('unmasked renderer') ?? getText('renderer'),
      };
    });

    await page.close();

    const hasWebGL = results.vendor || results.renderer;
    expect(hasWebGL, 'WebGL info must be extractable').toBeTruthy();

    writeBaseline('browserleaks-webgl', {
      service: 'BrowserLeaks WebGL (Baseline)',
      timestamp: new Date().toISOString(),
      ...results,
    });
  });

  test('FingerprintJS baseline', async ({ context }) => {
    test.slow();

    const page = await context.newPage();
    await page.goto('https://fingerprintjs.github.io/fingerprintjs/', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
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

    // Open second tab — vanilla Chrome should produce the SAME visitorId
    const page2 = await context.newPage();
    await page2.goto('https://fingerprintjs.github.io/fingerprintjs/', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page2.waitForTimeout(5000);

    const visitorId2 = await page2.evaluate(() => {
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

    await page.close();
    await page2.close();

    expect(visitorId, 'Baseline visitorId must be extractable').not.toBeNull();

    writeBaseline('fingerprintjs', {
      service: 'FingerprintJS (Baseline)',
      timestamp: new Date().toISOString(),
      visitorId_tab1: visitorId,
      visitorId_tab2: visitorId2,
      crossTabStable: visitorId === visitorId2,
    });
  });

  test('EFF Cover Your Tracks baseline', async ({ context }) => {
    test.slow();

    const page = await context.newPage();
    await page.goto('https://coveryourtracks.eff.org/', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });

    // Click "Test Your Browser" — same strategy as benchmark spec
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

    // Poll for results (up to 60s)
    for (let i = 0; i < 60; i++) {
      const body = await page.textContent('body').catch(() => '');
      if (body && (body.includes('bits of') || body.includes('unique') || body.includes('fingerprint'))) {
        break;
      }
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'test-results/baseline-coveryourtracks.png' });

    const results = await page.evaluate(() => {
      const body = document.body.textContent ?? '';
      const bitsMatch = body.match(/(\d+(?:\.\d+)?)\s*bits?\s*of\s*(?:identifying\s*)?information/i);

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

      return {
        bitsOfInfo: bitsMatch ? parseFloat(bitsMatch[1]) : null,
        trackerBlocking,
      };
    });

    await page.close();

    writeBaseline('coveryourtracks', {
      service: 'EFF Cover Your Tracks (Baseline)',
      timestamp: new Date().toISOString(),
      ...results,
    });
  });

  test('CreepJS baseline', async ({ context }) => {
    test.slow();

    const page = await context.newPage();
    await page.goto('https://abrahamjuliot.github.io/creepjs/', {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });

    // Poll for CreepJS to finish — same as benchmark spec
    for (let i = 0; i < 60; i++) {
      const body = await page.textContent('body').catch(() => '');
      if (body && (body.includes('trust score') || body.includes('Trust Score') || body.match(/\d+(\.\d+)?%/))) {
        break;
      }
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/baseline-creepjs.png' });

    const results = await page.evaluate(() => {
      const body = document.body.textContent ?? '';

      // Trust score — match "XX%" pattern (CreepJS displays percentage)
      let trustScore: string | null = null;
      const trustMatch = body.match(/(?:trust\s*score[:\s]*)?(\d+(?:\.\d+)?)\s*%/i);
      if (trustMatch) {
        trustScore = trustMatch[1] + '%';
      }

      // Lie count
      let lieCount: number | null = null;
      const lieMatch = body.match(/(\d+)\s*lie/i);
      if (lieMatch) {
        lieCount = parseInt(lieMatch[1], 10);
      }

      // Fingerprint hash
      let fingerprintHash: string | null = null;
      const fpMatch = body.match(/\b([0-9a-f]{8,64})\b/i);
      if (fpMatch) {
        fingerprintHash = fpMatch[1];
      }

      return {
        trustScore,
        lieCount,
        fingerprintHash,
      };
    });

    await page.close();

    writeBaseline('creepjs', {
      service: 'CreepJS (Baseline)',
      timestamp: new Date().toISOString(),
      ...results,
    });
  });
});
