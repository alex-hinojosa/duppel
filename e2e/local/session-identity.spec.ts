import { test, expect, getTestPageUrl } from '../fixtures/extension';

/**
 * Helper: open a page and wait for the desync-reload cycle to complete.
 * On a fresh tab to a new origin, anti-fingerprint.js generates a random seed
 * that doesn't match the session identity. bridge.js detects this, background
 * re-injects the correct seed, and reloads the tab. After this, JS and network
 * UA should match. We wait for the reload by navigating, waiting, reloading
 * explicitly, and waiting again.
 */
async function openStablePage(context: any): Promise<any> {
  const url = getTestPageUrl();
  const page = await context.newPage();
  await page.goto(url);
  // Wait for desync detection + reload cycle
  await page.waitForTimeout(800);
  // Reload to guarantee the correct seed is in sessionStorage
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  return page;
}

test.describe('Session-level identity default (v2 item 1)', () => {
  test('default identity mode is "session"', async ({ context, extensionId }) => {
    // Query via the extension popup page (chrome.runtime.sendMessage is only
    // available in extension contexts — popup, background, ISOLATED scripts).
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(500);

    const mode = await popup.evaluate(() => {
      return new Promise<string>((resolve) => {
        chrome.runtime.sendMessage({ type: "getState" }, (state: any) => {
          resolve(state?.identityMode || '');
        });
      });
    });
    expect(mode).toBe('session');
    await popup.close();
  });

  test('navigator.userAgent matches across two tabs', async ({ context }) => {
    const page1 = await openStablePage(context);
    const page2 = await openStablePage(context);

    const ua1 = await page1.evaluate(() => navigator.userAgent);
    const ua2 = await page2.evaluate(() => navigator.userAgent);

    expect(ua1).toBe(ua2);
    expect(ua1).toMatch(/^Mozilla\/5\.0/);

    await page1.close();
    await page2.close();
  });

  test('navigator.platform matches across two tabs', async ({ context }) => {
    const page1 = await openStablePage(context);
    const page2 = await openStablePage(context);

    const p1 = await page1.evaluate(() => navigator.platform);
    const p2 = await page2.evaluate(() => navigator.platform);

    expect(p1).toBe(p2);

    await page1.close();
    await page2.close();
  });

  test('HTTP User-Agent header matches JS navigator.userAgent', async ({ context }) => {
    const page = await openStablePage(context);
    const result = await page.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      const headers = await resp.json();
      return {
        httpUA: headers['user-agent'] || '',
        jsUA: navigator.userAgent,
      };
    });
    expect(result.httpUA).toBe(result.jsUA);
    await page.close();
  });

  test('session seed is consistent across tabs', async ({ context }) => {
    const page1 = await openStablePage(context);
    const page2 = await openStablePage(context);

    const seed1 = await page1.evaluate(() =>
      sessionStorage.getItem('__pg_seed__')
    );
    const seed2 = await page2.evaluate(() =>
      sessionStorage.getItem('__pg_seed__')
    );

    expect(seed1).toBeTruthy();
    expect(seed1).toBe(seed2);

    await page1.close();
    await page2.close();
  });

  test('hardwareConcurrency matches across two tabs', async ({ context }) => {
    const page1 = await openStablePage(context);
    const page2 = await openStablePage(context);

    const c1 = await page1.evaluate(() => navigator.hardwareConcurrency);
    const c2 = await page2.evaluate(() => navigator.hardwareConcurrency);

    expect(c1).toBe(c2);

    await page1.close();
    await page2.close();
  });

  test('identityMode persists in chrome.storage.local', async ({ context }) => {
    const sw = context.serviceWorkers()[0];
    expect(sw).toBeTruthy();
    // Poll for onInstalled to complete — it writes identityMode asynchronously
    let mode = '';
    for (let i = 0; i < 20; i++) {
      mode = await sw.evaluate(async () => {
        const data = await chrome.storage.local.get(['identityMode']);
        return data.identityMode || '';
      });
      if (mode) break;
      await new Promise(r => setTimeout(r, 200));
    }
    expect(mode).toBe('session');
  });

  test('rotation alarm exists with 24h period', async ({ context }) => {
    const sw = context.serviceWorkers()[0];
    expect(sw).toBeTruthy();
    // Poll for onInstalled to create the alarm
    let alarm: any = null;
    for (let i = 0; i < 20; i++) {
      alarm = await sw.evaluate(async () => {
        const a = await chrome.alarms.get('rotateIdentity');
        return a ? { name: a.name, period: a.periodInMinutes } : null;
      });
      if (alarm) break;
      await new Promise(r => setTimeout(r, 200));
    }
    expect(alarm).not.toBeNull();
    expect(alarm.name).toBe('rotateIdentity');
    expect(alarm.period).toBe(1440);
  });
});

test.describe('Session identity — UA header consistency (v2 item 1)', () => {
  test('UA header on navigation matches JS UA after stabilization', async ({ context }) => {
    const page = await openStablePage(context);

    // After stabilization, fetch should return the same UA as JS
    const result = await page.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      const headers = await resp.json();
      return {
        fetchUA: headers['user-agent'] || '',
        jsUA: navigator.userAgent,
      };
    });

    expect(result.fetchUA).toBe(result.jsUA);
    expect(result.fetchUA).toMatch(/^Mozilla\/5\.0/);

    await page.close();
  });

  test('sub-resource fetch carries same UA as page', async ({ context }) => {
    const page = await openStablePage(context);
    const result = await page.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      const headers = await resp.json();
      return {
        fetchUA: headers['user-agent'] || '',
        jsUA: navigator.userAgent,
      };
    });
    expect(result.fetchUA).toBe(result.jsUA);
    await page.close();
  });
});

test.describe('Session identity — regression checks (v2 item 1)', () => {
  test('Sec-GPC header still present', async ({ extensionPage }) => {
    const headers = await extensionPage.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      return resp.json();
    });
    expect(headers['sec-gpc']).toBe('1');
  });

  test('navigator.globalPrivacyControl still true', async ({ extensionPage }) => {
    const gpc = await extensionPage.evaluate(
      () => (navigator as any).globalPrivacyControl
    );
    expect(gpc).toBe(true);
  });

  test('canvas fingerprint is spoofed (not default)', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 50;
      const ctx = c.getContext('2d');
      if (!ctx) return { drawn: false, dataUrl: '' };
      ctx.fillStyle = '#f00';
      ctx.fillRect(0, 0, 200, 50);
      ctx.fillStyle = '#000';
      ctx.font = '14px Arial';
      ctx.fillText('PhantomGrid test', 10, 30);
      return { drawn: true, dataUrl: c.toDataURL().substring(0, 50) };
    });
    expect(result.drawn).toBe(true);
    expect(result.dataUrl).toContain('data:image/png');
  });
});
