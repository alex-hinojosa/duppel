import { test, expect } from '../fixtures/extension';
import { collectClientHints, collectNavigator } from '../helpers/fingerprint-collector';

test.describe('Client Hints spoofing', () => {
  test('userAgentData.mobile is false', async ({ extensionPage }) => {
    const ch = await collectClientHints(extensionPage);
    if (!ch.available) {
      test.skip(true, 'userAgentData not available (Firefox UA profile)');
      return;
    }
    expect(ch.mobile).toBe(false);
  });

  test('userAgentData.platform matches navigator.platform', async ({ extensionPage }) => {
    const ch = await collectClientHints(extensionPage);
    const nav = await collectNavigator(extensionPage);
    if (!ch.available) {
      test.skip(true, 'userAgentData not available');
      return;
    }

    const expectedPlatform =
      nav.platform === 'MacIntel' ? 'macOS' :
      nav.platform.startsWith('Linux') ? 'Linux' : 'Windows';
    expect(ch.platform).toBe(expectedPlatform);
  });

  test('bitness is 64', async ({ extensionPage }) => {
    const ch = await collectClientHints(extensionPage);
    if (!ch.available) {
      test.skip(true, 'userAgentData not available');
      return;
    }
    expect(ch.bitness).toBe('64');
  });

  test('Firefox UA has no userAgentData', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    const ch = await collectClientHints(extensionPage);
    if (nav.userAgent.includes('Firefox')) {
      expect(ch.available).toBe(false);
    }
  });
});
