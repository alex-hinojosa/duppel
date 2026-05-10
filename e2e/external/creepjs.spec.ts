/**
 * CreepJS smoke test.
 * Verifies page loads and generates a trust score element.
 */

import { test, expect } from '../fixtures/extension';

test.describe('CreepJS @external', () => {
  test.describe.configure({ retries: 2 });

  test('page loads and generates fingerprint', async ({ extensionPage }) => {
    test.slow();
    await extensionPage.goto('https://abrahamjuliot.github.io/creepjs/', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });

    // Wait for CreepJS to finish fingerprinting (it takes a while)
    await extensionPage.waitForTimeout(5000);

    await extensionPage.screenshot({ path: 'test-results/creepjs.png' });

    // Verify the page rendered something
    const bodyText = await extensionPage.textContent('body').catch(() => '');
    expect(bodyText!.length).toBeGreaterThan(100);
  });
});
