import { test, expect } from '../fixtures/extension';

/**
 * Screen position spoofing
 *
 * window.screenX/screenY and screen.availLeft/availTop leak the browser
 * window's absolute position on the physical display. On multi-monitor
 * setups this is nearly unique. All should be spoofed to 0.
 */

test.describe('Screen position spoofing', () => {
  test('window.screenX and window.screenY return 0', async ({ extensionPage: page }) => {
    const result = await page.evaluate(() => ({
      screenX: window.screenX,
      screenY: window.screenY,
    }));
    expect(result.screenX).toBe(0);
    expect(result.screenY).toBe(0);
  });

  test('window.screenLeft and window.screenTop return 0', async ({ extensionPage: page }) => {
    const result = await page.evaluate(() => ({
      screenLeft: window.screenLeft,
      screenTop: window.screenTop,
    }));
    expect(result.screenLeft).toBe(0);
    expect(result.screenTop).toBe(0);
  });

  test('screen.availLeft and screen.availTop return 0', async ({ extensionPage: page }) => {
    const result = await page.evaluate(() => ({
      availLeft: screen.availLeft,
      availTop: (screen as any).availTop,
    }));
    expect(result.availLeft).toBe(0);
    expect(result.availTop).toBe(0);
  });

  test('MouseEvent.screenX/screenY still report event coordinates', async ({ extensionPage: page }) => {
    // MouseEvent.screenX/screenY are per-event mouse coordinates relative to
    // the screen, NOT the window position properties. They should still work
    // (with ±1px biometric noise from Item 3) and not be clamped to 0.
    await page.evaluate(() => {
      (window as any).__mouseScreenCoords = null;
      document.addEventListener('click', (e: MouseEvent) => {
        (window as any).__mouseScreenCoords = {
          screenX: e.screenX,
          screenY: e.screenY,
        };
      }, { once: true });
    });

    // Click at a known position
    await page.mouse.click(150, 150);
    await page.waitForTimeout(200);

    const coords = await page.evaluate(() => (window as any).__mouseScreenCoords);
    expect(coords).toBeTruthy();
    // MouseEvent.screenX/screenY should be non-zero (they report the mouse
    // position on screen, not the window position). With biometric noise
    // they may be ±1 from the real value, but should not be 0.
    // The click is at page position (150, 150) so screen coords will be
    // at least that value (plus any window offset, which the browser still
    // tracks internally even though we spoof the JS property).
    expect(coords.screenX).toBeGreaterThan(0);
    expect(coords.screenY).toBeGreaterThan(0);
  });
});
