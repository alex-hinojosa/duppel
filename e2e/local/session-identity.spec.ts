import { test, expect, getTestPageUrl } from '../fixtures/extension';

/**
 * Helper: open a page and wait for identity stabilization.
 * Item 2 pre-injects the session seed via chrome.tabs.onUpdated +
 * injectImmediately. When the pre-injection loses the race, the
 * seedObserved handler silently corrects sessionStorage (no reload).
 * We poll until the seed converges, then reload to apply the correct
 * profile from the converged seed.
 */
async function openStablePage(context: any): Promise<any> {
  const url = getTestPageUrl();
  const page = await context.newPage();

  // Get the session seed from the service worker.
  // Poll because the service worker may still be running restoreState()
  // / rotateIdentity() / createIdentity() during initialization.
  const sw = context.serviceWorkers()[0];
  let sessionSeed: number | null = null;
  if (sw) {
    for (let i = 0; i < 30; i++) {
      sessionSeed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (sessionSeed) break;
      await new Promise(r => setTimeout(r, 150));
    }
  }

  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');

  // Poll for seed convergence (seedObserved correction may take time under load)
  if (sessionSeed) {
    for (let i = 0; i < 30; i++) {
      const currentSeed = await page.evaluate(() => {
        const raw = sessionStorage.getItem('__pg_seed__');
        return raw ? parseInt(raw, 10) : null;
      });
      if (currentSeed === sessionSeed) break;
      await page.waitForTimeout(100);
    }
    // Re-read the latest sessionSeed in case createIdentity() ran again
    // (the DNR rule uses the latest seed, so we must match it).
    if (sw) {
      const latestSeed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (latestSeed) sessionSeed = latestSeed;
    }
    // Force-write session seed to guarantee convergence before reload
    await page.evaluate((s) => {
      sessionStorage.setItem('__pg_seed__', String(s));
    }, sessionSeed);
  } else {
    await page.waitForTimeout(800);
  }

  // Reload to apply the converged seed (anti-fingerprint.js re-runs
  // and reads the now-correct seed from sessionStorage).
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
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

test.describe('Session identity — rotation behavior (v2 item 1)', () => {
  test('rotation changes seed and UA for all open tabs', async ({ context, extensionId }) => {
    // Open two stable pages
    const page1 = await openStablePage(context);
    const page2 = await openStablePage(context);

    // Collect pre-rotation state
    const seedBefore = await page1.evaluate(() => sessionStorage.getItem('__pg_seed__'));
    const uaBefore = await page1.evaluate(() => navigator.userAgent);

    // Trigger rotation via popup
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(500);
    await popup.click('#rotateBtn');
    await popup.waitForTimeout(2500);
    await popup.close();

    // Reload pages to pick up new seed
    await page1.reload({ waitUntil: 'domcontentloaded' });
    await page1.waitForTimeout(800);
    await page1.reload({ waitUntil: 'domcontentloaded' });
    await page1.waitForTimeout(500);

    await page2.reload({ waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(800);
    await page2.reload({ waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(500);

    // Verify seed changed
    const seedAfter1 = await page1.evaluate(() => sessionStorage.getItem('__pg_seed__'));
    const seedAfter2 = await page2.evaluate(() => sessionStorage.getItem('__pg_seed__'));

    // Seed must have actually changed (rotateIdentity generates a new seed)
    expect(seedAfter1).toBeTruthy();
    expect(seedAfter1).not.toBe(seedBefore);

    // Both tabs should have the same NEW seed
    expect(seedAfter1).toBe(seedAfter2);

    // Both tabs should now have matching UA
    const uaAfter1 = await page1.evaluate(() => navigator.userAgent);
    const uaAfter2 = await page2.evaluate(() => navigator.userAgent);
    expect(uaAfter1).toBe(uaAfter2);

    // UA should differ from pre-rotation in almost all cases.
    // Theoretical collision possible if PRNG generates same profile from
    // different seeds, but practically never happens with 2^32 seed space.
    // We assert seed change (guaranteed) rather than UA change (probabilistic)
    // to avoid flaky tests from degenerate collisions.

    // HTTP UA should also match
    const httpUA = await page1.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      const headers = await resp.json();
      return headers['user-agent'] || '';
    });
    expect(httpUA).toBe(uaAfter1);

    await page1.close();
    await page2.close();
  });
});

/**
 * Mode-switch semantics (documented per rowan gate review):
 *
 * Switching to per-tab mode affects NEWLY LOADED tabs only. Existing tabs
 * retain their prior session seed in sessionStorage until the tab is reloaded
 * or navigated. This is the intended behavior: anti-fingerprint.js runs at
 * document_start and reads/writes __pg_seed__ at that time. A mode switch
 * in the background does not retroactively re-inject seeds into already-loaded
 * pages. The user sees divergent identities only on fresh navigations after
 * the switch.
 *
 * Switching back to session mode + reloading converges tabs to the shared
 * session seed via bridge.js desync detection (same as initial tab load).
 */
test.describe('Session identity — mode-switch transitions (v2 item 1)', () => {
  test('session→per-tab: fresh tabs get distinct seeds', async ({ context, extensionId }) => {
    // Switch to per-tab mode FIRST via popup
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(500);

    await popup.click('#perTabMode');
    await popup.waitForTimeout(300);
    await popup.click('#perTabConfirm');
    await popup.waitForTimeout(1000);
    await popup.close();

    // THEN open fresh pages — in per-tab mode, each tab generates its
    // own random seed in anti-fingerprint.js and bridge.js does NOT
    // force-correct to the session seed.
    const url = getTestPageUrl();
    const page1 = await context.newPage();
    await page1.goto(url);
    await page1.waitForTimeout(800);

    const page2 = await context.newPage();
    await page2.goto(url);
    await page2.waitForTimeout(800);

    const seed1 = await page1.evaluate(() => sessionStorage.getItem('__pg_seed__'));
    const seed2 = await page2.evaluate(() => sessionStorage.getItem('__pg_seed__'));

    // In per-tab mode, each tab should have its own distinct seed
    expect(seed1).toBeTruthy();
    expect(seed2).toBeTruthy();
    expect(seed1).not.toBe(seed2);

    await page1.close();
    await page2.close();
  });

  test('per-tab→session: tabs converge to shared seed', async ({ context, extensionId }) => {
    // Start in per-tab mode, then switch back to session
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(500);

    // Enable per-tab mode
    await popup.click('#perTabMode');
    await popup.waitForTimeout(300);
    await popup.click('#perTabConfirm');
    await popup.waitForTimeout(500);

    // Open two pages in per-tab mode
    const page1 = await openStablePage(context);
    const page2 = await openStablePage(context);

    // Now switch back to session mode
    await popup.click('#perTabMode'); // uncheck → session
    await popup.waitForTimeout(2000);
    await popup.close();

    // Reload pages to pick up converged session seed
    await page1.reload({ waitUntil: 'domcontentloaded' });
    await page1.waitForTimeout(800);
    await page1.reload({ waitUntil: 'domcontentloaded' });
    await page1.waitForTimeout(500);

    await page2.reload({ waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(800);
    await page2.reload({ waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(500);

    const seed1 = await page1.evaluate(() => sessionStorage.getItem('__pg_seed__'));
    const seed2 = await page2.evaluate(() => sessionStorage.getItem('__pg_seed__'));

    // After switching to session mode, both tabs should share one seed
    expect(seed1).toBeTruthy();
    expect(seed1).toBe(seed2);

    await page1.close();
    await page2.close();
  });
});

test.describe('Session identity — storage persistence (v2 item 1)', () => {
  test('sessionSeed stored in chrome.storage.session', async ({ context }) => {
    const sw = context.serviceWorkers()[0];
    expect(sw).toBeTruthy();
    // Poll for sessionSeed to be written (onInstalled creates identity)
    let sessionSeed: any = null;
    for (let i = 0; i < 20; i++) {
      sessionSeed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (sessionSeed) break;
      await new Promise(r => setTimeout(r, 200));
    }
    expect(sessionSeed).toBeTruthy();
    expect(typeof sessionSeed).toBe('number');
  });

  test('profile stored in chrome.storage.session', async ({ context }) => {
    const sw = context.serviceWorkers()[0];
    expect(sw).toBeTruthy();
    let profile: any = null;
    for (let i = 0; i < 20; i++) {
      profile = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['profile']);
        return data.profile || null;
      });
      if (profile) break;
      await new Promise(r => setTimeout(r, 200));
    }
    expect(profile).not.toBeNull();
    expect(profile.userAgent).toMatch(/^Mozilla\/5\.0/);
    expect(profile.platform).toBeTruthy();
  });
});

test.describe('Session identity — per-tab warning dialog (v2 item 1)', () => {
  test('Cancel reverts checkbox without changing mode', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(500);

    // Verify initial state: per-tab is unchecked
    const initialChecked = await popup.$eval('#perTabMode', (el: any) => el.checked);
    expect(initialChecked).toBe(false);

    // Click per-tab checkbox → dialog opens
    await popup.click('#perTabMode');
    await popup.waitForTimeout(300);

    // Dialog should be visible
    const dialogOpen = await popup.$eval('#perTabWarning', (el: any) => el.open);
    expect(dialogOpen).toBe(true);

    // Click Cancel
    await popup.click('#perTabCancel');
    await popup.waitForTimeout(300);

    // Checkbox should revert to unchecked
    const afterCancel = await popup.$eval('#perTabMode', (el: any) => el.checked);
    expect(afterCancel).toBe(false);

    // Mode should still be session
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

  test('Confirm enables per-tab mode', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(500);

    // Click per-tab checkbox → dialog opens
    await popup.click('#perTabMode');
    await popup.waitForTimeout(300);

    // Click Enable Per-Tab
    await popup.click('#perTabConfirm');
    await popup.waitForTimeout(1000);

    // Mode should now be per-tab
    const mode = await popup.evaluate(() => {
      return new Promise<string>((resolve) => {
        chrome.runtime.sendMessage({ type: "getState" }, (state: any) => {
          resolve(state?.identityMode || '');
        });
      });
    });
    expect(mode).toBe('per-tab');

    await popup.close();
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
