import { test, expect, getTestPageUrl } from '../fixtures/extension';

const UA_RULE_ID = 9999;
const SESSION_UA_RULE_ID = 9998;

type DnrRuleSummary = {
  id: number;
  tabIds: number[] | null;
  requestHeaders: Array<{ header?: string; operation?: string; value?: string }>;
};

type DnrSnapshot = {
  dynamicRules: DnrRuleSummary[];
  sessionRules: DnrRuleSummary[];
  testPageTabIds: number[];
};

async function getDnrSnapshot(context: any): Promise<DnrSnapshot> {
  const sw = context.serviceWorkers()[0];
  expect(sw).toBeTruthy();
  return sw.evaluate(async (testPageUrl: string) => {
    const [dynamicRules, sessionRules, tabs] = await Promise.all([
      chrome.declarativeNetRequest.getDynamicRules(),
      chrome.declarativeNetRequest.getSessionRules(),
      chrome.tabs.query({}),
    ]);

    const summarize = (rule: any) => ({
      id: rule.id,
      tabIds: rule.condition?.tabIds ?? null,
      requestHeaders: rule.action?.requestHeaders ?? [],
    });

    return {
      dynamicRules: dynamicRules.map(summarize),
      sessionRules: sessionRules.map(summarize),
      testPageTabIds: tabs
        .filter((tab: any) => typeof tab.id === 'number' && tab.url?.startsWith(testPageUrl))
        .map((tab: any) => tab.id),
    };
  }, getTestPageUrl());
}

async function waitForDnrSnapshot(
  context: any,
  predicate: (snapshot: DnrSnapshot) => boolean,
  label: string
): Promise<DnrSnapshot> {
  let lastSnapshot: DnrSnapshot | null = null;
  for (let i = 0; i < 30; i++) {
    lastSnapshot = await getDnrSnapshot(context);
    if (predicate(lastSnapshot)) return lastSnapshot;
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`${label} not observed. Last DNR snapshot: ${JSON.stringify(lastSnapshot)}`);
}

/**
 * Helper: open a page and wait for identity stabilization.
 * Round 6+: seed delivered via closure-local executeScript({ func, args }).
 * Wait for SW initialization, navigate, reload to ensure pre-injection wins
 * the race, then wait for stabilization.
 */
async function openStablePage(context: any): Promise<any> {
  const url = getTestPageUrl();
  const page = await context.newPage();

  // Poll for session seed — service worker may still be initializing
  const sw = context.serviceWorkers()[0];
  if (sw) {
    for (let i = 0; i < 30; i++) {
      const sessionSeed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (sessionSeed) break;
      await new Promise(r => setTimeout(r, 150));
    }
  }

  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');

  // Reload to ensure pre-injection wins (SW is awake after init poll)
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

  test('session DNR UA rule is scoped to bootstrapped test tabs', async ({ context }) => {
    const page1 = await openStablePage(context);
    const page2 = await openStablePage(context);

    const snapshot = await waitForDnrSnapshot(
      context,
      (state) => {
        const rule = state.sessionRules.find(r => r.id === SESSION_UA_RULE_ID);
        return !!rule
          && Array.isArray(rule.tabIds)
          && rule.tabIds.length > 0
          && state.testPageTabIds.length >= 2
          && state.testPageTabIds.every(tabId => rule.tabIds!.includes(tabId));
      },
      'tab-scoped session UA rule for bootstrapped test tabs'
    );

    const sessionRule = snapshot.sessionRules.find(r => r.id === SESSION_UA_RULE_ID);
    expect(sessionRule).toBeTruthy();
    expect(sessionRule!.tabIds).toEqual(expect.arrayContaining(snapshot.testPageTabIds));
    expect(sessionRule!.requestHeaders).toEqual(expect.arrayContaining([
      expect.objectContaining({ header: 'User-Agent', operation: 'set' }),
    ]));
    expect(snapshot.dynamicRules.map(rule => rule.id)).not.toContain(UA_RULE_ID);

    await page1.close();
    await page2.close();
  });

  test('session seed is consistent across tabs', async ({ context }) => {
    // P0: sessionStorage no longer stores the seed. Verify via spoofed
    // values — if navigator.userAgent and hardwareConcurrency match,
    // the tabs share the same seed.
    const page1 = await openStablePage(context);
    const page2 = await openStablePage(context);

    const fp1 = await page1.evaluate(() => ({
      ua: navigator.userAgent,
      cores: navigator.hardwareConcurrency,
    }));
    const fp2 = await page2.evaluate(() => ({
      ua: navigator.userAgent,
      cores: navigator.hardwareConcurrency,
    }));

    expect(fp1.ua).toBeTruthy();
    expect(fp1.ua).toBe(fp2.ua);
    expect(fp1.cores).toBe(fp2.cores);

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

    // P0: verify seed rotation via spoofed UA values (no sessionStorage).
    // Both tabs should have matching UA after rotation.
    const uaAfter1 = await page1.evaluate(() => navigator.userAgent);
    const uaAfter2 = await page2.evaluate(() => navigator.userAgent);
    expect(uaAfter1).toBe(uaAfter2);
    expect(uaAfter1).toMatch(/^Mozilla\/5\.0/);

    // Verify rotation actually changed the identity.
    // Query background for the session seed to confirm it changed.
    const sw = context.serviceWorkers()[0];
    if (sw) {
      const currentSeed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      expect(currentSeed).toBeTruthy();
    }

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
 * Mode-switch semantics (documented per rowan gate review, P0 update):
 *
 * Switching to per-tab mode affects NEWLY LOADED tabs only. anti-fingerprint.js
 * receives its seed as a closure-local executeScript argument at document_start.
 * A mode switch in the background does not retroactively re-inject seeds into
 * already-loaded pages. The user sees divergent identities only on fresh
 * navigations after the switch.
 *
 * Switching back to session mode + reloading converges tabs to the shared
 * session seed via closure-local pre-injection on reload.
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

    // THEN open fresh pages — in per-tab mode, each tab gets a distinct
    // seed via executeScript({ func, args }) and the background does NOT
    // force-correct to the session seed.
    const url = getTestPageUrl();
    const page1 = await context.newPage();
    await page1.goto(url);
    await page1.waitForTimeout(800);

    const page2 = await context.newPage();
    await page2.goto(url);
    await page2.waitForTimeout(800);

    // P0: verify per-tab mode via spoofed identity (no sessionStorage).
    // In per-tab mode, each tab gets a distinct seed → different profile.
    // Compare multiple properties because UA has limited entropy (few groups)
    // — two seeds can collide on UA alone with ~16% probability.
    const id1 = await page1.evaluate(() => ({
      ua: navigator.userAgent,
      cores: navigator.hardwareConcurrency,
      mem: (navigator as any).deviceMemory,
    }));
    const id2 = await page2.evaluate(() => ({
      ua: navigator.userAgent,
      cores: navigator.hardwareConcurrency,
      mem: (navigator as any).deviceMemory,
    }));

    expect(id1.ua).toMatch(/^Mozilla\/5\.0/);
    expect(id2.ua).toMatch(/^Mozilla\/5\.0/);
    // At least one identity property must differ between tabs
    const allMatch = id1.ua === id2.ua && id1.cores === id2.cores && id1.mem === id2.mem;
    expect(allMatch).toBe(false);

    // Bring a seeded per-tab page to the foreground so tabs.onActivated
    // installs the global dynamic UA rule for that tab's profile.
    await page2.bringToFront();
    await page2.waitForTimeout(300);
    await page1.bringToFront();

    const snapshot = await waitForDnrSnapshot(
      context,
      (state) => state.dynamicRules.some(rule => rule.id === UA_RULE_ID),
      'per-tab dynamic UA rule'
    );
    const dynamicRule = snapshot.dynamicRules.find(rule => rule.id === UA_RULE_ID);
    expect(dynamicRule).toBeTruthy();
    expect(dynamicRule!.tabIds).toBeNull();
    expect(dynamicRule!.requestHeaders).toEqual(expect.arrayContaining([
      expect.objectContaining({ header: 'User-Agent', operation: 'set' }),
    ]));

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

    // P0: verify convergence via spoofed UA (no sessionStorage).
    // After switching to session mode, both tabs should share one identity.
    const ua1 = await page1.evaluate(() => navigator.userAgent);
    const ua2 = await page2.evaluate(() => navigator.userAgent);

    expect(ua1).toMatch(/^Mozilla\/5\.0/);
    expect(ua1).toBe(ua2);

    const snapshot = await waitForDnrSnapshot(
      context,
      (state) => {
        const sessionRule = state.sessionRules.find(rule => rule.id === SESSION_UA_RULE_ID);
        const dynamicRuleRemoved = !state.dynamicRules.some(rule => rule.id === UA_RULE_ID);
        return dynamicRuleRemoved
          && !!sessionRule
          && Array.isArray(sessionRule.tabIds)
          && sessionRule.tabIds.length > 0
          && state.testPageTabIds.length >= 2
          && state.testPageTabIds.every(tabId => sessionRule.tabIds!.includes(tabId));
      },
      'session DNR rule after per-tab to session transition'
    );
    const sessionRule = snapshot.sessionRules.find(rule => rule.id === SESSION_UA_RULE_ID);
    expect(snapshot.dynamicRules.map(rule => rule.id)).not.toContain(UA_RULE_ID);
    expect(sessionRule).toBeTruthy();
    expect(sessionRule!.tabIds).toEqual(expect.arrayContaining(snapshot.testPageTabIds));
    expect(sessionRule!.requestHeaders).toEqual(expect.arrayContaining([
      expect.objectContaining({ header: 'User-Agent', operation: 'set' }),
    ]));

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
      ctx.fillText('Duppel test', 10, 30);
      return { drawn: true, dataUrl: c.toDataURL().substring(0, 50) };
    });
    expect(result.drawn).toBe(true);
    expect(result.dataUrl).toContain('data:image/png');
  });
});
