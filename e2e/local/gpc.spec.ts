import { test, expect } from '../fixtures/extension';

test.describe('Global Privacy Control — JS surface (v2 item 7)', () => {
  test('navigator.globalPrivacyControl is true', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => ({
      value: (navigator as any).globalPrivacyControl,
      type: typeof (navigator as any).globalPrivacyControl,
    }));
    expect(result.value).toBe(true);
    expect(result.type).toBe('boolean');
  });

  test('globalPrivacyControl survives assignment attempt', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      try {
        (navigator as any).globalPrivacyControl = false;
      } catch(e) {}
      return (navigator as any).globalPrivacyControl;
    });
    expect(result).toBe(true);
  });
});

test.describe('Global Privacy Control — descriptor hardening (v2 item 7)', () => {
  test('GOPD returns getter-shaped descriptor', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(
        Navigator.prototype, 'globalPrivacyControl'
      );
      if (!desc) return { exists: false } as any;
      return {
        exists: true,
        hasGet: typeof desc.get === 'function',
        hasValue: 'value' in desc,
        configurable: desc.configurable,
        enumerable: desc.enumerable,
      };
    });
    expect(result.exists).toBe(true);
    expect(result.hasGet).toBe(true);
    expect(result.hasValue).toBe(false);
    expect(result.configurable).toBe(true);
    expect(result.enumerable).toBe(true);
  });

  test('getter.name is "get globalPrivacyControl"', async ({ extensionPage }) => {
    const name = await extensionPage.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(
        Navigator.prototype, 'globalPrivacyControl'
      );
      return desc && desc.get ? desc.get.name : '';
    });
    expect(name).toBe('get globalPrivacyControl');
  });

  test('getter has no own toString property', async ({ extensionPage }) => {
    const hasOwn = await extensionPage.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(
        Navigator.prototype, 'globalPrivacyControl'
      );
      return desc && desc.get ? desc.get.hasOwnProperty('toString') : true;
    });
    expect(hasOwn).toBe(false);
  });

  test('getter toString returns native format', async ({ extensionPage }) => {
    const str = await extensionPage.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(
        Navigator.prototype, 'globalPrivacyControl'
      );
      return desc && desc.get ? desc.get.toString() : '';
    });
    expect(str).toBe('function get globalPrivacyControl() { [native code] }');
  });

  test('Function.prototype.toString.call returns native format', async ({ extensionPage }) => {
    const str = await extensionPage.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(
        Navigator.prototype, 'globalPrivacyControl'
      );
      return desc && desc.get ? Function.prototype.toString.call(desc.get) : '';
    });
    expect(str).toBe('function get globalPrivacyControl() { [native code] }');
  });

  test('GOPD, GOPDs, and Reflect.GOPD return consistent results', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const gopd = Object.getOwnPropertyDescriptor(
        Navigator.prototype, 'globalPrivacyControl'
      );
      const gopds = Object.getOwnPropertyDescriptors(Navigator.prototype);
      const rgopd = Reflect.getOwnPropertyDescriptor(
        Navigator.prototype, 'globalPrivacyControl'
      );

      if (!gopd || !gopds.globalPrivacyControl || !rgopd) {
        return { allExist: false } as any;
      }

      return {
        allExist: true,
        gopdStr: gopd.get!.toString(),
        gopdsStr: gopds.globalPrivacyControl.get!.toString(),
        rgopdStr: rgopd.get!.toString(),
        gopdConf: gopd.configurable,
        gopdsConf: gopds.globalPrivacyControl.configurable,
        rgopdConf: rgopd.configurable,
        gopdEnum: gopd.enumerable,
        gopdsEnum: gopds.globalPrivacyControl.enumerable,
        rgopdEnum: rgopd.enumerable,
      };
    });

    expect(result.allExist).toBe(true);
    expect(result.gopdStr).toBe(result.gopdsStr);
    expect(result.gopdStr).toBe(result.rgopdStr);
    expect(result.gopdConf).toBe(result.gopdsConf);
    expect(result.gopdConf).toBe(result.rgopdConf);
    expect(result.gopdEnum).toBe(result.gopdsEnum);
    expect(result.gopdEnum).toBe(result.rgopdEnum);
  });
});

test.describe('Global Privacy Control — Sec-GPC header (v2 item 7)', () => {
  test('Sec-GPC: 1 header present on fetch', async ({ extensionPage }) => {
    const headers = await extensionPage.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      return resp.json();
    });
    expect(headers['sec-gpc']).toBe('1');
  });

  test('User-Agent header still spoofed after GPC rule added (regression)', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      const headers = await resp.json();
      return {
        serverUA: headers['user-agent'] || '',
        jsUA: navigator.userAgent,
      };
    });
    // JS and HTTP UA should match (header/JS parity from item 1)
    expect(result.serverUA).toBe(result.jsUA);
    // UA should be spoofed (not empty, matches Mozilla pattern)
    expect(result.serverUA).toMatch(/^Mozilla\/5\.0/);
  });

  test('Sec-GPC header present on page navigation', async ({ context }) => {
    const page = await context.newPage();
    const [response] = await Promise.all([
      page.waitForEvent('response', r => r.url().includes('/echo-headers')),
      page.goto(`http://127.0.0.1:${await getPort()}/echo-headers`),
    ]);
    const headers = await response.json();
    expect(headers['sec-gpc']).toBe('1');
    await page.close();
  });
});

/** Helper to get the test server port from the running fixture server. */
async function getPort(): Promise<number> {
  // Import dynamically to avoid circular dependency
  const { getTestPageUrl } = await import('../fixtures/extension');
  const url = getTestPageUrl();
  return parseInt(new URL(url).port, 10);
}
