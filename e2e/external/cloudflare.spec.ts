/**
 * Cloudflare bot detection smoke test.
 * Verifies we can load a Cloudflare-protected page without being blocked.
 */

import { test, expect } from '../fixtures/extension';

test.describe('Cloudflare @external', () => {
  test.describe.configure({ retries: 2 });

  test('loads Cloudflare-protected page without block', async ({ extensionPage }) => {
    test.slow();
    // Use Cloudflare's own site as a smoke test
    await extensionPage.goto('https://www.cloudflare.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await extensionPage.screenshot({ path: 'test-results/cloudflare.png' });

    // Should not be on a challenge/block page
    const title = await extensionPage.title();
    expect(title).not.toMatch(/Attention Required|Challenge/i);

    // Page should have meaningful content
    const bodyText = await extensionPage.textContent('body').catch(() => '');
    expect(bodyText!.length).toBeGreaterThan(100);
  });
});
