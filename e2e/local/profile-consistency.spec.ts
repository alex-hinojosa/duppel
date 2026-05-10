import { test, expect } from '../fixtures/extension';
import { collectNavigator, collectScreen, collectWebGL, collectClientHints } from '../helpers/fingerprint-collector';

test.describe('Profile consistency (cross-surface)', () => {
  test('UA OS matches platform matches UA-CH', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    const ch = await collectClientHints(extensionPage);

    const isWin = nav.userAgent.includes('Windows');
    const isMac = nav.userAgent.includes('Macintosh');
    const isLinux = nav.userAgent.includes('Linux');

    if (isWin) {
      expect(nav.platform).toBe('Win32');
      if (ch.available) expect(ch.platform).toBe('Windows');
    } else if (isMac) {
      expect(nav.platform).toBe('MacIntel');
      if (ch.available) expect(ch.platform).toBe('macOS');
    } else if (isLinux) {
      expect(nav.platform).toMatch(/^Linux/);
      if (ch.available) expect(ch.platform).toBe('Linux');
    }
  });

  test('Firefox UA has no userAgentData', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    const ch = await collectClientHints(extensionPage);
    if (nav.userAgent.includes('Firefox')) {
      expect(nav.vendor).toBe('');
      expect(ch.available).toBe(false);
    }
  });

  test('screen width >= 3840 implies DPR = 2', async ({ extensionPage }) => {
    const s = await collectScreen(extensionPage);
    if (s.width >= 3840) {
      expect(s.devicePixelRatio).toBe(2);
    } else {
      expect(s.devicePixelRatio).toBe(1);
    }
  });

  test('innerWidth equals visualViewport.width', async ({ extensionPage }) => {
    const s = await collectScreen(extensionPage);
    if (s.visualViewportWidth !== undefined) {
      expect(s.visualViewportWidth).toBe(s.innerWidth);
    }
  });

  test('GPU vendor correlates with platform', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    const gl = await collectWebGL(extensionPage);
    if (!gl.vendor) return;

    const isMac = nav.platform === 'MacIntel';
    if (isMac) {
      // macOS profiles should have Apple or Intel GPU, not NVIDIA/AMD
      expect(gl.vendor).toMatch(/Apple|Intel/i);
    }
  });
});
