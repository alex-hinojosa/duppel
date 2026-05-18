/**
 * Shared utilities for benchmark specs that test against live fingerprinting services.
 *
 * Provides rotation triggering (extracted from rotation.spec.ts), DOM polling
 * with configurable timeout, and structured JSON result output.
 */

import type { BrowserContext, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export interface BenchmarkMetrics {
  [key: string]: string | number | boolean | null | undefined | string[];
}

export interface BenchmarkResult {
  service: string;
  timestamp: string;
  preRotation: BenchmarkMetrics;
  postRotation: BenchmarkMetrics | null;
  sessionStable: boolean;
  rotationChanged: boolean;
}

/**
 * Poll for a selector to appear on the page with a custom timeout.
 * Live services can be slow — default Playwright timeouts are often too short.
 */
export async function waitForSelector(
  page: Page,
  selector: string,
  timeout = 30_000,
): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Trigger identity rotation via the extension popup.
 * Extracted from e2e/rotation/rotation.spec.ts for reuse.
 */
export async function triggerRotation(
  context: BrowserContext,
  extensionId: string,
): Promise<void> {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popupPage.waitForLoadState('domcontentloaded');
  await popupPage.waitForTimeout(500);

  await popupPage.click('#rotateBtn');

  // Wait for rotation to complete (button text changes to "Done — reloading")
  await popupPage.waitForTimeout(2000);
  await popupPage.close();
}

/**
 * Write a structured benchmark result to test-results/benchmark-<name>.json.
 */
export function writeBenchmarkResult(
  name: string,
  data: BenchmarkResult,
): void {
  const dir = path.resolve(__dirname, '..', '..', 'test-results');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, `benchmark-${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Extract text content from the page body, with regex matching.
 * Fallback extraction method when DOM selectors are fragile.
 */
export async function extractByRegex(
  page: Page,
  pattern: RegExp,
): Promise<string | null> {
  const body = await page.textContent('body').catch(() => '');
  if (!body) return null;
  const match = body.match(pattern);
  return match ? match[1] ?? match[0] : null;
}
