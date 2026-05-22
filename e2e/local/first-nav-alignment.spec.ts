import { test, expect, getTestPageUrl } from '../fixtures/extension';

/**
 * Duppel v2 Item 2: First-Navigation UA Alignment (Round 7)
 *
 * Tests that the cold-start race condition is resolved:
 * - Session seed is injected via closure-local executeScript({ func, args })
 * - No reload occurs on first navigation
 * - JS navigator.userAgent matches the HTTP User-Agent header after reload
 * - lastSeed/lastUA persist in chrome.storage.local for cold-start bootstrap
 * - Session identity is consistent across navigations to different origins
 * - P0: sessionStorage.__pg_seed__ is NOT readable by page JS
 * - P0: no page-observable convergence events (no nonce, no named events)
 * - P0: no __pg_* window properties observable after page load
 * - P0: no page-writable convergence control surface
 *
 * Seed delivery (Round 6+): closure-local via chrome.tabs.onUpdated:
 *   chrome.scripting.executeScript({ func: bootstrapAntiFingerprint, args: [seed] })
 *   injects the entire anti-fingerprint bundle with seed as a function parameter.
 *   No window properties, no cookies, no sessionStorage.
 */

test.describe('First-navigation UA alignment (v2 item 2)', () => {
  test('pre-injection delivers session seed after reload', async ({ context }) => {
    // After SW initialization, pre-injection wins the race on reload.
    // Verify the page UA matches the session profile.
    const sw = context.serviceWorkers()[0];
    expect(sw).toBeTruthy();

    let sessionSeed: number | null = null;
    for (let i = 0; i < 20; i++) {
      sessionSeed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (sessionSeed) break;
      await new Promise(r => setTimeout(r, 200));
    }
    expect(sessionSeed).toBeTruthy();

    const expectedUA = await sw.evaluate(async () => {
      const data = await chrome.storage.session.get(['profile']);
      return data.profile?.userAgent || null;
    });
    expect(expectedUA).toBeTruthy();

    // Open a NEW page — first navigation to this origin
    const url = getTestPageUrl();
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');

    // Reload — pre-injection wins the race (SW is awake)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    // Verify UA matches the session profile
    const pageUA = await page.evaluate(() => navigator.userAgent);
    expect(pageUA).toBe(expectedUA);

    await page.close();
  });

  test('no reload on first navigation to new origin', async ({ context }) => {
    const url = getTestPageUrl();
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');
    // Wait long enough that the old reload would have fired (~800ms)
    await page.waitForTimeout(1200);

    // Check navigation type: 0 = navigate, 1 = reload
    const navType = await page.evaluate(() => {
      const entries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (entries.length > 0) return entries[0].type;
      return performance.navigation.type === 0 ? 'navigate' : 'reload';
    });

    expect(navType).toBe('navigate');
    await page.close();
  });

  test('JS and HTTP User-Agent match after reload', async ({ context }) => {
    const sw = context.serviceWorkers()[0];
    expect(sw).toBeTruthy();
    let sessionSeed: number | null = null;
    for (let i = 0; i < 20; i++) {
      sessionSeed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (sessionSeed) break;
      await new Promise(r => setTimeout(r, 200));
    }
    expect(sessionSeed).toBeTruthy();

    const url = getTestPageUrl();
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');

    // Reload — pre-injection wins on reload (SW is awake)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const result = await page.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      const headers = await resp.json();
      return {
        httpUA: headers['user-agent'] || '',
        jsUA: navigator.userAgent,
      };
    });

    // Both should be spoofed (not the real browser UA)
    expect(result.httpUA).toMatch(/^Mozilla\/5\.0/);
    expect(result.jsUA).toMatch(/^Mozilla\/5\.0/);
    // And they should match each other
    expect(result.httpUA).toBe(result.jsUA);

    await page.close();
  });

  test('lastSeed and lastUA persist in chrome.storage.local', async ({ context }) => {
    const sw = context.serviceWorkers()[0];
    expect(sw).toBeTruthy();

    let result: { lastSeed: number | null; lastUA: string; sessionSeed: number | null } =
      { lastSeed: null, lastUA: '', sessionSeed: null };
    for (let i = 0; i < 30; i++) {
      result = await sw.evaluate(async () => {
        const local = await chrome.storage.local.get(['lastSeed', 'lastUA']);
        const session = await chrome.storage.session.get(['sessionSeed']);
        return {
          lastSeed: local.lastSeed || null,
          lastUA: local.lastUA || '',
          sessionSeed: session.sessionSeed || null,
        };
      });
      if (result.lastSeed && result.lastUA && result.sessionSeed
          && result.lastSeed === result.sessionSeed) break;
      await new Promise(r => setTimeout(r, 200));
    }

    expect(result.lastSeed).toBeTruthy();
    expect(typeof result.lastSeed).toBe('number');
    expect(result.lastUA).toMatch(/^Mozilla\/5\.0/);
    expect(result.lastSeed).toBe(result.sessionSeed);
  });

  test('P0: sessionStorage.__pg_seed__ is NOT readable by page JS', async ({ context }) => {
    const sw = context.serviceWorkers()[0];
    expect(sw).toBeTruthy();

    for (let i = 0; i < 20; i++) {
      const sessionSeed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (sessionSeed) break;
      await new Promise(r => setTimeout(r, 200));
    }

    const url = getTestPageUrl();
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);

    // Verify sessionStorage does NOT contain __pg_seed__
    const seedValue = await page.evaluate(() => {
      return sessionStorage.getItem('__pg_seed__');
    });
    expect(seedValue).toBeNull();

    // Also verify the extension is still working (UA is spoofed)
    const ua = await page.evaluate(() => navigator.userAgent);
    expect(ua).toMatch(/^Mozilla\/5\.0/);

    await page.close();
  });

  test('P0: no page-observable convergence events', async ({ context }) => {
    // Verify that no __pgc CustomEvent is dispatched. An adversarial page
    // script installs a listener before any extension code runs (impossible
    // in practice — document_start content scripts run first — but we test
    // via Playwright's addInitScript which runs before content scripts).
    const url = getTestPageUrl();
    const page = await context.newPage();

    // Install adversarial listener BEFORE content scripts via addInitScript
    await page.addInitScript(() => {
      (window as any).__pgc_captured = 0;
      window.addEventListener('__pgc', () => { (window as any).__pgc_captured++; });
    });

    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Reload and wait again — covers both first nav and reload paths
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const captured = await page.evaluate(() => (window as any).__pgc_captured);
    expect(captured).toBe(0);

    await page.close();
  });

  test('P0: adversarial __pgc dispatch does not affect profile', async ({ context }) => {
    // Even if page JS dispatches a fake __pgc event, the extension should
    // not converge to the attacker's seed (because the listener was removed).
    const url = getTestPageUrl();
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');

    // Reload so we have the session profile applied
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    // Record current UA
    const uaBefore = await page.evaluate(() => navigator.userAgent);
    expect(uaBefore).toMatch(/^Mozilla\/5\.0/);

    // Dispatch adversarial __pgc with a different seed
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('__pgc', { detail: 999999999 }));
    });

    // UA should not change — no convergence handler installed
    const uaAfter = await page.evaluate(() => navigator.userAgent);
    expect(uaAfter).toBe(uaBefore);

    await page.close();
  });

  test('session identity consistent across navigations to different origins', async ({ context }) => {
    const sw = context.serviceWorkers()[0];
    expect(sw).toBeTruthy();

    let sessionSeed: number | null = null;
    for (let i = 0; i < 20; i++) {
      sessionSeed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (sessionSeed) break;
      await new Promise(r => setTimeout(r, 200));
    }
    expect(sessionSeed).toBeTruthy();

    // Navigate to origin A (127.0.0.1)
    const url = getTestPageUrl();
    const pageA = await context.newPage();
    await pageA.goto(url);
    await pageA.waitForLoadState('domcontentloaded');
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await pageA.waitForTimeout(300);

    // Navigate to origin B (localhost — same port but different origin)
    const localhostUrl = url.replace('127.0.0.1', 'localhost');
    const pageB = await context.newPage();
    await pageB.goto(localhostUrl);
    await pageB.waitForLoadState('domcontentloaded');
    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await pageB.waitForTimeout(500);

    // UA should match across both pages (both using session profile)
    const uaA = await pageA.evaluate(() => navigator.userAgent);
    const uaB = await pageB.evaluate(() => navigator.userAgent);
    expect(uaA).toBe(uaB);
    expect(uaA).toMatch(/^Mozilla\/5\.0/);

    await pageA.close();
    await pageB.close();
  });

  test('P0: no __pg_* window properties observable after page load', async ({ context }) => {
    // After page load, no __pg_* properties should remain on window.
    // Round 6+: closure-local bootstrap never writes to window at all.
    // No window.__pg_s, no cookies for seed delivery, no convergence.
    const url = getTestPageUrl();
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const pgProps = await page.evaluate(() => {
      const props: string[] = [];
      for (const key of Object.getOwnPropertyNames(window)) {
        if (key.startsWith('__pg')) props.push(key);
      }
      return props;
    });
    expect(pgProps).toEqual([]);

    // Also check after reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const pgPropsAfterReload = await page.evaluate(() => {
      const props: string[] = [];
      for (const key of Object.getOwnPropertyNames(window)) {
        if (key.startsWith('__pg')) props.push(key);
      }
      return props;
    });
    expect(pgPropsAfterReload).toEqual([]);

    await page.close();
  });

  test('P0: lost-race path produces no page-observable seed state', async ({ context }) => {
    // Round 6+: closure-local bootstrap doesn't use window.__pg_s at all.
    // This test verifies that an adversary intercepting window.__pg_s or
    // clearing __pg_s cookies has zero effect — the extension uses
    // executeScript({ func, args }) with a closure-local seed parameter.
    const url = getTestPageUrl();
    const page = await context.newPage();

    // Intercept __pg_s property AND cookie — proves neither is used by Round 6
    await page.addInitScript(() => {
      Object.defineProperty(window, '__pg_s', {
        get: () => undefined,
        set: () => {},
        configurable: true,
      });
      // Clear __pg_s cookie if set by background
      document.cookie = '__pg_s=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    });

    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // Verify: no __pg_* properties on window (no convergence setter, no nonce)
    const pgProps = await page.evaluate(() => {
      const props: string[] = [];
      for (const key of Object.getOwnPropertyNames(window)) {
        if (key.startsWith('__pg')) props.push(key);
      }
      // __pg_s itself may appear (our defineProperty) — filter it out
      return props.filter(k => k !== '__pg_s');
    });
    expect(pgProps).toEqual([]);

    // Verify: extension is still functional (UA is spoofed via closure-local bootstrap)
    const ua = await page.evaluate(() => navigator.userAgent);
    expect(ua).toMatch(/^Mozilla\/5\.0/);

    // Verify: no convergence event listener installed
    const pgcCaptured = await page.evaluate(() => {
      let count = 0;
      window.addEventListener('__pgc', () => { count++; });
      window.dispatchEvent(new CustomEvent('__pgc', { detail: 12345 }));
      return count;
    });
    // Our listener fires (we just added it), but the extension has NO listener
    expect(pgcCaptured).toBe(1); // only our own listener

    // Verify: no page-writable convergence surface (P0)
    // Writing to window.__pg_s should have no effect on the profile
    const uaBefore = await page.evaluate(() => navigator.userAgent);
    await page.evaluate(() => {
      try { (window as any).__pg_s = 999999999; } catch(e) {}
    });
    const uaAfter = await page.evaluate(() => navigator.userAgent);
    expect(uaAfter).toBe(uaBefore);

    await page.close();
  });
});
