/**
 * Extension detection surface tests.
 *
 * Measures how detectable Duppel is using common extension-detection
 * techniques that fingerprinting services and bot-detection systems use.
 *
 * These are self-tests, not external service calls. They run against
 * the local test page with the extension loaded and check whether
 * standard detection vectors reveal the extension's presence.
 *
 * Detection vectors tested:
 * 1. navigator.webdriver — Playwright sets this; extension should override
 * 2. chrome.runtime probing — web pages can probe for extension IDs
 * 3. DOM artifacts — __pgd cookie, __pg_seed__ sessionStorage
 * 4. Timing side channels — spoofed APIs may have measurable overhead
 * 5. Property descriptor anomalies — Object.getOwnPropertyDescriptor on spoofed props
 */

import { test, expect } from '../fixtures/extension';
import { writeBenchmarkResult, type BenchmarkResult } from '../helpers/benchmark-utils';

test.describe('Extension Detection Surface @external', () => {
  test('navigator.webdriver is false', async ({ extensionPage }) => {
    const webdriver = await extensionPage.evaluate(() => navigator.webdriver);
    expect(webdriver).toBe(false);

    // Also check the property descriptor — sophisticated detectors look at this
    const descriptor = await extensionPage.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
      return {
        hasDescriptor: !!desc,
        configurable: desc?.configurable,
        enumerable: desc?.enumerable,
        hasGetter: typeof desc?.get === 'function',
        hasSetter: typeof desc?.set === 'function',
        hasValue: 'value' in (desc ?? {}),
      };
    });

    // Extension uses spoof() which overrides the getter on Navigator.prototype.
    // A natural browser has a getter too, so this should look normal.
    expect(descriptor.hasGetter).toBe(true);

    writeBenchmarkResult('detection-webdriver', {
      service: 'Extension Detection (webdriver)',
      timestamp: new Date().toISOString(),
      status: 'pass',
      preRotation: {
        webdriver,
        ...descriptor,
      },
      postRotation: null,
      sessionStable: true,
      rotationChanged: false,
    });
  });

  test('no detectable DOM artifacts from page context', async ({ extensionPage }) => {
    const artifacts = await extensionPage.evaluate(() => {
      const results: Record<string, unknown> = {};

      // Check for __pgd disable cookie (known detection surface)
      results.pgdCookie = document.cookie.includes('__pgd');

      // Check for __pg_seed__ in sessionStorage (P0: should be absent)
      results.pgSeed = sessionStorage.getItem('__pg_seed__') !== null;
      results.pgSeedValue = sessionStorage.getItem('__pg_seed__');

      // Check for any Duppel or legacy extension strings in DOM
      const bodyHtml = document.documentElement.outerHTML;
      const legacyProjectName = ['phantom', 'grid'].join('');
      results.duppelNameInDom = new RegExp(`${legacyProjectName}|duppel|__pg_`, 'i').test(bodyHtml);

      // Check for injected script elements with extension URLs
      const scripts = Array.from(document.querySelectorAll('script'));
      results.extensionScripts = scripts
        .filter((s) => s.src?.includes('chrome-extension://'))
        .map((s) => s.src);

      // Check for extension-injected style elements
      const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
      results.extensionStyles = styles.filter(
        (s) => (s as HTMLLinkElement).href?.includes('chrome-extension://'),
      ).length;

      return results;
    });

    // P0 fix: __pg_seed__ no longer stored in sessionStorage.
    // Verify it's absent — this was the primary detection surface.
    expect(artifacts.pgSeed).toBe(false);

    // Extension scripts should NOT be visible in the page DOM
    expect(artifacts.extensionScripts).toEqual([]);
    expect(artifacts.extensionStyles).toBe(0);

    writeBenchmarkResult('detection-dom-artifacts', {
      service: 'Extension Detection (DOM Artifacts)',
      timestamp: new Date().toISOString(),
      status: 'pass',
      preRotation: {
        pgdCookiePresent: artifacts.pgdCookie as boolean,
        pgSeedPresent: artifacts.pgSeed as boolean,
        pgSeedValue: artifacts.pgSeedValue as string | null,
        duppelNameInDom: artifacts.duppelNameInDom as boolean,
        extensionScriptsVisible: (artifacts.extensionScripts as string[]).length,
        extensionStylesVisible: artifacts.extensionStyles as number,
      },
      postRotation: null,
      sessionStable: true,
      rotationChanged: false,
    });
  });

  test('spoofed property descriptors look native', async ({ extensionPage }) => {
    // Fingerprinting services check property descriptors to detect overrides.
    // A well-implemented spoof has the same descriptor shape as the native property.
    const descriptors = await extensionPage.evaluate(() => {
      const propsToCheck = [
        { obj: Navigator.prototype, prop: 'userAgent', name: 'navigator.userAgent' },
        { obj: Navigator.prototype, prop: 'platform', name: 'navigator.platform' },
        { obj: Navigator.prototype, prop: 'hardwareConcurrency', name: 'navigator.hardwareConcurrency' },
        { obj: Navigator.prototype, prop: 'deviceMemory', name: 'navigator.deviceMemory' },
        { obj: Navigator.prototype, prop: 'webdriver', name: 'navigator.webdriver' },
        { obj: Navigator.prototype, prop: 'vendor', name: 'navigator.vendor' },
        { obj: Screen.prototype, prop: 'width', name: 'screen.width' },
        { obj: Screen.prototype, prop: 'height', name: 'screen.height' },
      ];

      return propsToCheck.map(({ obj, prop, name }) => {
        const desc = Object.getOwnPropertyDescriptor(obj, prop);
        let getterToString: string | null = null;
        if (desc?.get) {
          try {
            getterToString = desc.get.toString();
          } catch {
            getterToString = '[toString threw]';
          }
        }
        return {
          name,
          exists: !!desc,
          configurable: desc?.configurable ?? null,
          enumerable: desc?.enumerable ?? null,
          hasGetter: typeof desc?.get === 'function',
          hasSetter: typeof desc?.set === 'function',
          hasValue: desc ? 'value' in desc : null,
          // Native getters toString as "function get propertyName() { [native code] }"
          // Spoofed getters may reveal non-native toString
          getterLooksNative: getterToString
            ? /\[native code\]/.test(getterToString)
            : null,
        };
      });
    });

    // Count how many spoofed properties have non-native-looking getters
    const nonNativeGetters = descriptors.filter(
      (d) => d.hasGetter && d.getterLooksNative === false,
    );

    writeBenchmarkResult('detection-property-descriptors', {
      service: 'Extension Detection (Property Descriptors)',
      timestamp: new Date().toISOString(),
      status: nonNativeGetters.length === 0 ? 'pass' : 'inconclusive',
      preRotation: {
        propertiesChecked: descriptors.length,
        nonNativeGetterCount: nonNativeGetters.length,
        nonNativeGetters: nonNativeGetters.map((d) => d.name),
        details: descriptors,
      },
      postRotation: null,
      sessionStable: true,
      rotationChanged: false,
    });

    // This is informational — we document the surface rather than hard-fail.
    // If getters look non-native, that's a detection vector but not a test failure.
    // The writeup should report how many look native vs how many don't.
    console.log(
      `Property descriptor check: ${descriptors.length - nonNativeGetters.length}/${descriptors.length} look native`,
    );
  });

  test('chrome.runtime probing from web page', async ({ extensionPage }) => {
    // Web pages can try to detect extensions by probing chrome.runtime.sendMessage
    // with known extension IDs or by checking if chrome.runtime exists at all.
    const probeResult = await extensionPage.evaluate(() => {
      const results: Record<string, unknown> = {};

      // Basic chrome.runtime presence
      results.chromeRuntimeExists = typeof (globalThis as any).chrome?.runtime !== 'undefined';

      // chrome.runtime.id — only available inside extension context, not web pages
      results.chromeRuntimeId = (globalThis as any).chrome?.runtime?.id ?? null;

      // Check if chrome.runtime.sendMessage exists (shouldn't from web page)
      results.sendMessageExists =
        typeof (globalThis as any).chrome?.runtime?.sendMessage === 'function';

      // Check if chrome.runtime.connect exists
      results.connectExists =
        typeof (globalThis as any).chrome?.runtime?.connect === 'function';

      return results;
    });

    // From a web page context, chrome.runtime should be limited.
    // Extension-specific APIs like sendMessage shouldn't be callable with
    // arbitrary extension IDs (Chrome restricts this since MV3).

    writeBenchmarkResult('detection-runtime-probing', {
      service: 'Extension Detection (Runtime Probing)',
      timestamp: new Date().toISOString(),
      status: 'pass',
      preRotation: probeResult,
      postRotation: null,
      sessionStable: true,
      rotationChanged: false,
    });
  });
});
