import { test, expect } from '../fixtures/extension';
import { collectScreen } from '../helpers/fingerprint-collector';
import { KNOWN_SCREENS, KNOWN_WIDTHS, KNOWN_COLOR_DEPTHS } from '../helpers/profile-constants';

test.describe('Screen spoofing', () => {
  test('screen.width is from known set', async ({ extensionPage }) => {
    const s = await collectScreen(extensionPage);
    expect(KNOWN_WIDTHS).toContain(s.width);
  });

  test('screen.height matches known pair', async ({ extensionPage }) => {
    const s = await collectScreen(extensionPage);
    const match = KNOWN_SCREENS.find(k => k.width === s.width);
    expect(match).toBeTruthy();
    expect(s.height).toBe(match!.height);
  });

  test('screen.availHeight matches known value', async ({ extensionPage }) => {
    const s = await collectScreen(extensionPage);
    const match = KNOWN_SCREENS.find(k => k.width === s.width);
    expect(match).toBeTruthy();
    expect(s.availHeight).toBe(match!.avail);
  });

  test('colorDepth is 24 or 32', async ({ extensionPage }) => {
    const s = await collectScreen(extensionPage);
    expect(KNOWN_COLOR_DEPTHS).toContain(s.colorDepth);
  });

  test('pixelDepth equals colorDepth', async ({ extensionPage }) => {
    const s = await collectScreen(extensionPage);
    expect(s.pixelDepth).toBe(s.colorDepth);
  });

  test('devicePixelRatio matches screen width', async ({ extensionPage }) => {
    const s = await collectScreen(extensionPage);
    const expectedDPR = s.width >= 3840 ? 2 : 1;
    expect(s.devicePixelRatio).toBe(expectedDPR);
  });

  test('outerWidth matches screen width', async ({ extensionPage }) => {
    const s = await collectScreen(extensionPage);
    expect(s.outerWidth).toBe(s.width);
  });

  test('outerHeight matches screen height', async ({ extensionPage }) => {
    const s = await collectScreen(extensionPage);
    expect(s.outerHeight).toBe(s.height);
  });

  test('visualViewport matches innerWidth/Height', async ({ extensionPage }) => {
    const s = await collectScreen(extensionPage);
    if (s.visualViewportWidth !== undefined) {
      expect(s.visualViewportWidth).toBe(s.innerWidth);
      expect(s.visualViewportHeight).toBe(s.innerHeight);
      expect(s.visualViewportScale).toBe(1);
    }
  });
});
