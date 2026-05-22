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
