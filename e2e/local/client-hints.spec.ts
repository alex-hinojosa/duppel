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

  test('userAgentData has NavigatorUAData-like shape', async ({ extensionPage }) => {
    const shape = await extensionPage.evaluate(async () => {
      const uad = (navigator as any).userAgentData;
      if (!uad) return null;
      const hasToJSON = typeof uad.toJSON === 'function';
      const hasGetHEV = typeof uad.getHighEntropyValues === 'function';
      const json = hasToJSON ? uad.toJSON() : null;
      const jsonKeys = json ? Object.keys(json).sort() : [];
      return { hasToJSON, hasGetHEV, jsonKeys };
    });
    if (!shape) {
      test.skip(true, 'userAgentData not available (Firefox UA profile)');
      return;
    }
    expect(shape.hasToJSON).toBe(true);
    expect(shape.hasGetHEV).toBe(true);
    expect(shape.jsonKeys).toEqual(expect.arrayContaining(['brands', 'mobile', 'platform']));
  });

  test('getHighEntropyValues returns correct shape', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      const uad = (navigator as any).userAgentData;
      if (!uad) return null;
      const vals = await uad.getHighEntropyValues([
        'architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList',
      ]);
      return {
        hasArchitecture: 'architecture' in vals,
        hasBitness: 'bitness' in vals,
        hasModel: 'model' in vals,
        hasPlatformVersion: 'platformVersion' in vals,
        hasFullVersionList: 'fullVersionList' in vals,
        fullVersionListIsArray: Array.isArray(vals.fullVersionList),
      };
    });
    if (!result) {
      test.skip(true, 'userAgentData not available');
      return;
    }
    expect(result.hasArchitecture).toBe(true);
    expect(result.hasBitness).toBe(true);
    expect(result.hasModel).toBe(true);
    expect(result.hasPlatformVersion).toBe(true);
    expect(result.hasFullVersionList).toBe(true);
    expect(result.fullVersionListIsArray).toBe(true);
  });

  test('toJSON returns only low-entropy fields', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const uad = (navigator as any).userAgentData;
      if (!uad) return null;
      const json = uad.toJSON();
      const keys = Object.keys(json).sort();
      const hasArchitecture = 'architecture' in json;
      const hasBitness = 'bitness' in json;
      return { keys, hasArchitecture, hasBitness };
    });
    if (!result) {
      test.skip(true, 'userAgentData not available');
      return;
    }
    // toJSON must NOT leak high-entropy fields
    expect(result.hasArchitecture).toBe(false);
    expect(result.hasBitness).toBe(false);
    expect(result.keys).toEqual(expect.arrayContaining(['brands', 'mobile', 'platform']));
  });

  test('userAgentData methods have native toString', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const uad = (navigator as any).userAgentData;
      if (!uad) return null;
      const toJSONStr = uad.toJSON.toString();
      const getHEVStr = uad.getHighEntropyValues.toString();
      return { toJSONStr, getHEVStr };
    });
    if (!result) {
      test.skip(true, 'userAgentData not available');
      return;
    }
    // Methods should appear native (not expose spoofing internals)
    expect(result.toJSONStr).toMatch(/\[native code\]|function toJSON/);
    expect(result.getHEVStr).toMatch(/\[native code\]|function getHighEntropyValues/);
  });
});

test.describe('Client Hints HTTP↔JS coherence (A1)', () => {
  test('fetch sec-ch-ua* matches userAgentData (Chromium) or absent (Firefox)', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      const headers = await resp.json();
      const uad = (navigator as any).userAgentData;
      const jsUA = navigator.userAgent;
      const isFirefox = /Firefox\//.test(jsUA) && !/Chrome\//.test(jsUA);

      let hev: any = null;
      if (uad && typeof uad.getHighEntropyValues === 'function') {
        hev = await uad.getHighEntropyValues([
          'architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList', 'wow64',
        ]);
      }

      return {
        isFirefox,
        jsUA,
        jsAvailable: !!uad,
        jsMobile: uad ? uad.mobile : null,
        jsPlatform: uad ? uad.platform : null,
        jsBrands: uad ? uad.brands : null,
        jsArchitecture: hev ? hev.architecture : null,
        jsBitness: hev ? hev.bitness : null,
        jsModel: hev ? hev.model : null,
        jsPlatformVersion: hev ? hev.platformVersion : null,
        jsWow64: hev ? hev.wow64 : null,
        httpUA: headers['user-agent'] || '',
        httpSecChUa: headers['sec-ch-ua'],
        httpMobile: headers['sec-ch-ua-mobile'],
        httpPlatform: headers['sec-ch-ua-platform'],
        httpPlatformVersion: headers['sec-ch-ua-platform-version'],
        httpArch: headers['sec-ch-ua-arch'],
        httpBitness: headers['sec-ch-ua-bitness'],
        httpModel: headers['sec-ch-ua-model'],
        httpFullVersionList: headers['sec-ch-ua-full-version-list'],
        httpWow64: headers['sec-ch-ua-wow64'],
      };
    });

    // UA parity still holds (regression)
    expect(result.httpUA).toBe(result.jsUA);

    if (result.isFirefox || !result.jsAvailable) {
      // Firefox persona: no userAgentData → CH must not be present on wire
      expect(result.httpSecChUa).toBeUndefined();
      expect(result.httpMobile).toBeUndefined();
      expect(result.httpPlatform).toBeUndefined();
      expect(result.httpPlatformVersion).toBeUndefined();
      expect(result.httpArch).toBeUndefined();
      expect(result.httpBitness).toBeUndefined();
      expect(result.httpModel).toBeUndefined();
      expect(result.httpFullVersionList).toBeUndefined();
      expect(result.httpWow64).toBeUndefined();
      return;
    }

    // Chromium persona: HTTP CH must match JS userAgentData
    expect(result.httpMobile).toBe(result.jsMobile ? '?1' : '?0');
    expect(result.httpPlatform).toBe(`"${result.jsPlatform}"`);
    expect(result.httpPlatformVersion).toBe(`"${result.jsPlatformVersion}"`);
    expect(result.httpArch).toBe(`"${result.jsArchitecture}"`);
    expect(result.httpBitness).toBe(`"${result.jsBitness}"`);
    expect(result.httpModel).toBe(`"${result.jsModel ?? ''}"`);
    expect(result.httpWow64).toBe(result.jsWow64 ? '?1' : '?0');

    // Brand list: each JS brand appears in sec-ch-ua with matching major version
    expect(result.httpSecChUa).toBeTruthy();
    for (const b of result.jsBrands || []) {
      expect(result.httpSecChUa).toContain(`"${b.brand}";v="${b.version}"`);
    }
    expect(result.httpFullVersionList).toBeTruthy();
    for (const b of result.jsBrands || []) {
      expect(result.httpFullVersionList).toContain(`"${b.brand}";v="${b.version}.0.0.0"`);
    }
  });

  test('main_frame subresource after bootstrap: CH platform matches JS when Chromium', async ({ context }) => {
    const { getTestPageUrl } = await import('../fixtures/extension');
    const base = getTestPageUrl();
    const port = new URL(base).port;
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/echo-page`);
    // Subresource after bootstrap is the success-driven contract (first paint may race)
    await page.waitForTimeout(500);
    const result = await page.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      const headers = await resp.json();
      const uad = (navigator as any).userAgentData;
      return {
        jsUA: navigator.userAgent,
        jsPlatform: uad ? uad.platform : null,
        httpUA: headers['user-agent'] || '',
        httpPlatform: headers['sec-ch-ua-platform'],
        httpSecChUa: headers['sec-ch-ua'],
      };
    });
    expect(result.httpUA).toBe(result.jsUA);
    if (result.jsPlatform) {
      expect(result.httpPlatform).toBe(`"${result.jsPlatform}"`);
      expect(result.httpSecChUa).toBeTruthy();
    } else if (/Firefox\//.test(result.jsUA)) {
      expect(result.httpSecChUa).toBeUndefined();
    }
    await page.close();
  });
});
