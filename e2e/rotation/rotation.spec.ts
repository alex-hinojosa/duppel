/**
 * Automated rotation tests — replaces the manual two-step in regression.js.
 *
 * Strategy: collect fingerprints → trigger rotation via popup → collect
 * again → assert at least one high-entropy surface changed.
 */

import { test, expect, getTestPageUrl } from '../fixtures/extension';
import { collectFull, type FullFP } from '../helpers/fingerprint-collector';

async function triggerRotation(context: any, extensionId: string) {
  // Navigate to extension popup and click Rotate Identity
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popupPage.waitForLoadState('domcontentloaded');
  await popupPage.waitForTimeout(500);

  // Click the rotate button
  await popupPage.click('#rotateBtn');

  // Wait for rotation to complete (button text changes to "Done — reloading")
  await popupPage.waitForTimeout(2000);
  await popupPage.close();
}

function countChanges(fp1: FullFP, fp2: FullFP): string[] {
  const changes: string[] = [];
  if (fp1.canvas !== fp2.canvas) changes.push('canvas');
  if (fp1.measureText !== fp2.measureText) changes.push('measureText');
  if (fp1.userAgent !== fp2.userAgent) changes.push('userAgent');
  if (fp1.platform !== fp2.platform) changes.push('platform');
  if (fp1.hardwareConcurrency !== fp2.hardwareConcurrency) changes.push('cores');
  if (fp1.deviceMemory !== fp2.deviceMemory) changes.push('memory');
  if (fp1.languages !== fp2.languages) changes.push('languages');
  if (fp1.screenWidth !== fp2.screenWidth) changes.push('screen');
  if (fp1.colorDepth !== fp2.colorDepth) changes.push('colorDepth');
  if (fp1.timezone !== fp2.timezone) changes.push('timezone');
  if (fp1.glRenderer && fp2.glRenderer && fp1.glRenderer !== fp2.glRenderer) changes.push('webgl');
  return changes;
}

test.describe('Identity rotation', () => {
  test('fingerprint changes after rotation', async ({ context, extensionId }) => {
    // Collect fingerprints from first page
    const page1 = await context.newPage();
    await page1.goto(getTestPageUrl());
    await page1.waitForTimeout(500);
    const fp1 = await collectFull(page1);
    await page1.close();

    // Trigger rotation via popup
    await triggerRotation(context, extensionId);

    // Collect fingerprints from fresh page
    const page2 = await context.newPage();
    await page2.goto(getTestPageUrl());
    await page2.waitForTimeout(500);
    const fp2 = await collectFull(page2);

    // At least one high-entropy surface must have changed
    const changes = countChanges(fp1, fp2);
    expect(changes.length, `Expected changes but got none. FP1 UA: ${fp1.userAgent.slice(0, 50)}... FP2 UA: ${fp2.userAgent.slice(0, 50)}...`).toBeGreaterThan(0);

    // Within the new session, fingerprint should be stable
    const fp2verify = await collectFull(page2);
    expect(fp2.canvas).toBe(fp2verify.canvas);

    await page2.close();
  });

  test('5 rotations produce at least 3 distinct profiles', async ({ context, extensionId }) => {
    const fingerprints: string[] = [];

    for (let i = 0; i < 5; i++) {
      if (i > 0) {
        await triggerRotation(context, extensionId);
      }

      const page = await context.newPage();
      await page.goto(getTestPageUrl());
      await page.waitForTimeout(500);
      const fp = await collectFull(page);
      fingerprints.push(JSON.stringify(fp));
      await page.close();
    }

    const unique = new Set(fingerprints).size;
    expect(unique).toBeGreaterThanOrEqual(3);
  });
});
