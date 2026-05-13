import { test, expect } from '../fixtures/extension';

/**
 * PhantomGrid v2 Item 4: Chaff Engine Redesign — DOM Credibility Layer
 *
 * Tests DOM chaff injection via the interaction-coupled path:
 * 1. DOM chaff is interaction-coupled (applied on click, not on message arrival)
 * 2. No attribute collision (existing attributes preserved)
 * 3. Pixel injection (data: URI, 1x1, offscreen)
 * 4. One-shot guard not consumed on selector miss
 * 5. Production path: buildDOMChaffPayload() through alarm dispatch
 */

test.describe('DOM chaff injection (v2 item 4)', () => {
  test('interaction-coupled: DOM chaff applied after click, not on message arrival', async ({ extensionPage: page }) => {
    // Inject a mock ad container
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'google_ads_iframe_coupled';
      div.style.cssText = 'width:300px;height:250px;';
      document.body.appendChild(div);
    });

    const sw = page.context().serviceWorkers()[0];
    expect(sw).toBeTruthy();

    const tabId = await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tab?.id || null;
    });
    expect(tabId).toBeTruthy();

    // Send queueChaff with domChaff payload — should NOT apply immediately
    await sw.evaluate(async (tid: number) => {
      await chrome.tabs.sendMessage(tid, {
        type: "queueChaff",
        configs: [{ url: "https://localhost:1/__pg_noop__", body: null }],
        domChaff: {
          selectors: ['[id*="google_ads"]'],
          maxTargets: 1,
          attributeSets: [[{ key: "data-ad-slot", value: "coupled-test" }]],
          pixelChance: 0,
          pixelSrc: null,
        },
      });
    }, tabId);

    // Wait a moment — DOM chaff should NOT be applied yet
    await page.waitForTimeout(500);

    const beforeClick = await page.evaluate(() => {
      const el = document.getElementById('google_ads_iframe_coupled');
      return el ? el.getAttribute('data-ad-slot') : null;
    });
    expect(beforeClick).toBeNull(); // NOT applied before interaction

    // Trigger a click — this fires _fireChaffBatch() which applies DOM chaff
    await page.click('body');
    await page.waitForTimeout(500);

    const afterClick = await page.evaluate(() => {
      const el = document.getElementById('google_ads_iframe_coupled');
      return el ? el.getAttribute('data-ad-slot') : null;
    });
    expect(afterClick).toBe('coupled-test'); // Applied after interaction
  });

  test('no attribute collision: existing attributes preserved', async ({ extensionPage: page }) => {
    // Inject mock container with an existing data-ad-client attribute
    await page.evaluate(() => {
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.setAttribute('data-ad-client', 'existing-ca-pub-value');
      ins.style.cssText = 'width:728px;height:90px;';
      document.body.appendChild(ins);
    });

    const sw = page.context().serviceWorkers()[0];
    const tabId = await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tab?.id || null;
    });

    // Send chaff with domChaff that would overwrite data-ad-client
    await sw.evaluate(async (tid: number) => {
      await chrome.tabs.sendMessage(tid, {
        type: "queueChaff",
        configs: [{ url: "https://localhost:1/__pg_noop__", body: null }],
        domChaff: {
          selectors: ['ins.adsbygoogle'],
          maxTargets: 1,
          attributeSets: [[
            { key: "data-ad-client", value: "ca-pub-SHOULD-NOT-APPEAR" },
            { key: "data-ad-slot", value: "9876543210" },
          ]],
          pixelChance: 0,
          pixelSrc: null,
        },
      });
    }, tabId);

    // Trigger interaction to fire chaff
    await page.click('body');
    await page.waitForTimeout(500);

    const attrs = await page.evaluate(() => {
      const el = document.querySelector('ins.adsbygoogle');
      if (!el) return null;
      return {
        adClient: el.getAttribute('data-ad-client'),
        adSlot: el.getAttribute('data-ad-slot'),
      };
    });

    expect(attrs).toBeTruthy();
    // Existing attribute must NOT be overwritten
    expect(attrs!.adClient).toBe('existing-ca-pub-value');
    // New attribute should be added
    expect(attrs!.adSlot).toBe('9876543210');
  });

  test('pixel injection: data URI img with correct properties', async ({ extensionPage: page }) => {
    // Inject a mock ad container
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.className = 'ad-container';
      div.id = 'pixel-test-container';
      div.style.cssText = 'width:300px;height:250px;position:relative;';
      document.body.appendChild(div);
    });

    const sw = page.context().serviceWorkers()[0];
    const tabId = await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tab?.id || null;
    });

    // Send chaff with pixel injection (pixelChance=1 to guarantee injection)
    await sw.evaluate(async (tid: number) => {
      await chrome.tabs.sendMessage(tid, {
        type: "queueChaff",
        configs: [{ url: "https://localhost:1/__pg_noop__", body: null }],
        domChaff: {
          selectors: ['[class*="ad-container"]'],
          maxTargets: 1,
          attributeSets: [[{ key: "data-ad-slot", value: "5555555555" }]],
          pixelChance: 1.0,
          pixelSrc: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        },
      });
    }, tabId);

    await page.click('body');
    await page.waitForTimeout(500);

    // Verify pixel was injected
    const pixel = await page.evaluate(() => {
      const container = document.getElementById('pixel-test-container');
      if (!container) return null;
      const img = container.querySelector('img');
      if (!img) return null;
      return {
        src: img.src,
        width: img.width,
        height: img.height,
        adStatus: img.getAttribute('data-ad-status'),
        hasOffscreenStyle: img.style.cssText.includes('-9999px'),
      };
    });

    expect(pixel).toBeTruthy();
    expect(pixel!.src).toContain('data:image/gif;base64,');
    expect(pixel!.width).toBe(1);
    expect(pixel!.height).toBe(1);
    expect(pixel!.adStatus).toBe('filled');
    expect(pixel!.hasOffscreenStyle).toBe(true);
  });

  test('selector miss: one-shot guard not consumed when no selectors match', async ({ extensionPage: page }) => {
    // Page has NO ad containers — selector miss should not burn one-shot
    const sw = page.context().serviceWorkers()[0];
    const tabId = await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tab?.id || null;
    });

    // Send chaff with selectors that won't match anything
    await sw.evaluate(async (tid: number) => {
      await chrome.tabs.sendMessage(tid, {
        type: "queueChaff",
        configs: [{ url: "https://localhost:1/__pg_noop__", body: null }],
        domChaff: {
          selectors: ['[id*="nonexistent_ad_container"]', '[class*="no-such-ad"]'],
          maxTargets: 1,
          attributeSets: [[{ key: "data-ad-slot", value: "miss-test" }]],
          pixelChance: 0,
          pixelSrc: null,
        },
      });
    }, tabId);

    // Trigger interaction — DOM chaff should find no matches
    await page.click('body');
    await page.waitForTimeout(300);

    // Now inject an ad container and send a second batch
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'gpt-ad-after-miss';
      div.style.cssText = 'width:300px;height:250px;';
      document.body.appendChild(div);
    });

    // Second dispatch — one-shot should NOT be consumed from the miss
    await sw.evaluate(async (tid: number) => {
      await chrome.tabs.sendMessage(tid, {
        type: "queueChaff",
        configs: [{ url: "https://localhost:1/__pg_noop2__", body: null }],
        domChaff: {
          selectors: ['[id*="gpt-ad"]'],
          maxTargets: 1,
          attributeSets: [[{ key: "data-ad-slot", value: "after-miss-success" }]],
          pixelChance: 0,
          pixelSrc: null,
        },
      });
    }, tabId);

    await page.click('body');
    await page.waitForTimeout(500);

    // Second dispatch should succeed since one-shot was not consumed
    const result = await page.evaluate(() => {
      const el = document.getElementById('gpt-ad-after-miss');
      return el ? el.getAttribute('data-ad-slot') : null;
    });
    expect(result).toBe('after-miss-success');
  });

  test('production path: buildDOMChaffPayload with one matching selector', async ({ extensionPage: page }) => {
    // Inject a single ad container — only one of the 12 selectors will match
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'dfp-ad-production-test';
      div.style.cssText = 'width:300px;height:250px;';
      document.body.appendChild(div);
    });

    const sw = page.context().serviceWorkers()[0];
    const tabId = await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tab?.id || null;
    });

    // Use the production path: background builds payload, sends via queueChaff
    await sw.evaluate(async (tid: number) => {
      // @ts-ignore - POISONER is available in SW context
      const domPayload = POISONER.buildDOMChaffPayload("balanced");
      await chrome.tabs.sendMessage(tid, {
        type: "queueChaff",
        configs: [{ url: "https://localhost:1/__pg_noop__", body: null }],
        domChaff: domPayload,
      });
    }, tabId);

    // Trigger interaction
    await page.click('body');
    await page.waitForTimeout(500);

    // The container should have at least one data-ad-* or data-analytics-* attribute
    const result = await page.evaluate(() => {
      const el = document.getElementById('dfp-ad-production-test');
      if (!el) return { found: false, attrs: [] };
      const dataAttrs: string[] = [];
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        if (attr.name.startsWith('data-')) dataAttrs.push(attr.name);
      }
      return { found: true, attrs: dataAttrs };
    });

    expect(result.found).toBe(true);
    // At least one data-* attribute was injected (2-3 per attribute set)
    expect(result.attrs.length).toBeGreaterThanOrEqual(2);
  });
});
