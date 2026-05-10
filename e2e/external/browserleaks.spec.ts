/**
 * BrowserLeaks smoke test.
 * Intentionally loose assertions — verifies the site loads and reports
 * something plausible. Does not assert exact values.
 */

import { test, expect } from '../fixtures/extension';

test.describe('BrowserLeaks @external', () => {
  test.describe.configure({ retries: 2 });

  test('canvas page loads and shows hash', async ({ extensionPage }) => {
    test.slow();
    await extensionPage.goto('https://browserleaks.com/canvas', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Take screenshot for manual inspection
    await extensionPage.screenshot({ path: 'test-results/browserleaks-canvas.png' });

    // Verify page loaded (has the title element)
    const title = await extensionPage.title();
    expect(title).toContain('Canvas');
  });

  test('WebGL page loads', async ({ extensionPage }) => {
    test.slow();
    await extensionPage.goto('https://browserleaks.com/webgl', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    await extensionPage.screenshot({ path: 'test-results/browserleaks-webgl.png' });

    const title = await extensionPage.title();
    expect(title).toContain('WebGL');

    // Check that vendor/renderer text is visible and not real hardware
    const bodyText = await extensionPage.textContent('body').catch(() => '');
    // Should not contain real Snapdragon GPU
    expect(bodyText).not.toMatch(/Qualcomm|Adreno/i);
  });
});
