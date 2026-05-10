/**
 * EFF Cover Your Tracks smoke test.
 */

import { test, expect } from '../fixtures/extension';

test.describe('Cover Your Tracks @external', () => {
  test.describe.configure({ retries: 2 });

  test('page loads', async ({ extensionPage }) => {
    test.slow();
    await extensionPage.goto('https://coveryourtracks.eff.org/', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    await extensionPage.screenshot({ path: 'test-results/coveryourtracks.png' });

    const title = await extensionPage.title();
    expect(title.length).toBeGreaterThan(0);
  });
});
