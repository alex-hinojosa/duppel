import { test, expect } from '../fixtures/extension';
import { collectNavigator } from '../helpers/fingerprint-collector';
import { KNOWN_CORES, KNOWN_MEMORY, KNOWN_PLATFORMS } from '../helpers/profile-constants';

test.describe('Navigator spoofing', () => {
  test('userAgent matches Mozilla/5.0 pattern', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    expect(nav.userAgent).toMatch(/^Mozilla\/5\.0/);
  });

  test('platform correlates with UA OS', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    const isWin = nav.userAgent.includes('Windows');
    const isMac = nav.userAgent.includes('Macintosh');
    const isLinux = nav.userAgent.includes('Linux');

    if (isWin) expect(nav.platform).toBe('Win32');
    else if (isMac) expect(nav.platform).toBe('MacIntel');
    else if (isLinux) expect(nav.platform).toMatch(/^Linux/);
    else throw new Error('UA matches no known OS: ' + nav.userAgent);

    expect(KNOWN_PLATFORMS).toContain(nav.platform);
  });

  test('hardwareConcurrency in known set', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    expect(KNOWN_CORES).toContain(nav.hardwareConcurrency);
  });

  test('deviceMemory in known set', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    expect(KNOWN_MEMORY).toContain(nav.deviceMemory);
  });

  test('webdriver is false', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    expect(nav.webdriver).toBe(false);
  });

  test('maxTouchPoints is 0', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    expect(nav.maxTouchPoints).toBe(0);
  });

  test('connection is undefined (removed)', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    expect(nav.connection).toBeUndefined();
  });

  test('languages is frozen array, first matches language', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    expect(Array.isArray(nav.languages)).toBe(true);
    expect(nav.languages.length).toBeGreaterThan(0);
    expect(nav.languages[0]).toBe(nav.language);
  });

  test('vendor matches UA browser', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    const isFirefox = nav.userAgent.includes('Firefox');
    if (isFirefox) {
      expect(nav.vendor).toBe('');
    } else {
      expect(nav.vendor).toBe('Google Inc.');
    }
  });

  test('appVersion matches UA', async ({ extensionPage }) => {
    const nav = await collectNavigator(extensionPage);
    // appVersion is UA without the "Mozilla/" prefix
    expect(nav.userAgent).toContain(nav.appVersion);
  });
});
