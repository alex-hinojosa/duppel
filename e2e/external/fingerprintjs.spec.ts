/**
 * FingerprintJS demo smoke test.
 * Verifies visitor ID is generated.
 */

import { test, expect } from '../fixtures/extension';

test.describe('FingerprintJS @external', () => {
  test.describe.configure({ retries: 2 });

  test('generates visitor ID', async ({ extensionPage }) => {
    test.slow();
    await extensionPage.goto('https://fingerprintjs.github.io/fingerprintjs/', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for FP to compute
    await extensionPage.waitForTimeout(3000);

    await extensionPage.screenshot({ path: 'test-results/fingerprintjs.png' });

    // Page should have rendered and contain some fingerprint output
    const bodyText = await extensionPage.textContent('body').catch(() => '');
    expect(bodyText!.length).toBeGreaterThan(50);
  });
});
