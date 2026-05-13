import { test, expect } from '../fixtures/extension';

/**
 * PhantomGrid v2 Item 4: Chaff Engine Redesign — DOM Credibility Layer
 *
 * Tests DOM chaff injection into ad/tracker containers:
 * 1. Attribute injection into matching containers
 * 2. No attribute collision (existing attributes preserved)
 * 3. Pixel injection (data: URI, 1x1, offscreen)
 * 4. One-shot guard (no double injection)
 */

test.describe('DOM chaff injection (v2 item 4)', () => {
  test('attribute injection into matching ad containers', async ({ extensionPage: page }) => {
    // Inject mock ad containers into the test page
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'google_ads_iframe_test';
      div.style.cssText = 'width:300px;height:250px;';
      document.body.appendChild(div);
    });

    // Send queueDOMChaff message directly via the extension messaging API
    const result = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        // Listen for the domChaffApplied callback
        const handler = (event: MessageEvent) => {
          // Can't directly listen to chrome.runtime from page context.
          // Instead, check the DOM after a delay.
        };

        // Dispatch the message via bridge.js (ISOLATED world listens)
        // We need to use chrome.runtime.sendMessage from the extension context.
        // Since we're in MAIN world, we'll simulate by injecting the configs
        // directly into the DOM and verifying the shape.
        // For e2e: use service worker to dispatch.
        resolve(0);
      });
    });

    // Use the service worker to send the queueDOMChaff message to the tab
    const sw = page.context().serviceWorkers()[0];
    expect(sw).toBeTruthy();

    const tabId = await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tab?.id || null;
    });
    expect(tabId).toBeTruthy();

    // Send DOM chaff configs targeting our mock container
    await sw.evaluate(async (tid: number) => {
      await chrome.tabs.sendMessage(tid, {
        type: "queueDOMChaff",
        configs: [
          {
            selector: '[id*="google_ads"]',
            attributes: [
              { key: "data-ad-slot", value: "1234567890" },
              { key: "data-ad-format", value: "auto" },
            ],
            injectPixel: false,
          },
        ],
      });
    }, tabId);

    // Wait for DOM chaff to be applied
    await page.waitForTimeout(300);

    // Verify attributes were injected
    const attrs = await page.evaluate(() => {
      const el = document.getElementById('google_ads_iframe_test');
      if (!el) return null;
      return {
        adSlot: el.getAttribute('data-ad-slot'),
        adFormat: el.getAttribute('data-ad-format'),
      };
    });

    expect(attrs).toBeTruthy();
    expect(attrs!.adSlot).toBe('1234567890');
    expect(attrs!.adFormat).toBe('auto');
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

    // Send DOM chaff that would overwrite data-ad-client
    await sw.evaluate(async (tid: number) => {
      await chrome.tabs.sendMessage(tid, {
        type: "queueDOMChaff",
        configs: [
          {
            selector: 'ins.adsbygoogle',
            attributes: [
              { key: "data-ad-client", value: "ca-pub-SHOULD-NOT-APPEAR" },
              { key: "data-ad-slot", value: "9876543210" },
            ],
            injectPixel: false,
          },
        ],
      });
    }, tabId);

    await page.waitForTimeout(300);

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

    // Send DOM chaff with pixel injection enabled
    await sw.evaluate(async (tid: number) => {
      await chrome.tabs.sendMessage(tid, {
        type: "queueDOMChaff",
        configs: [
          {
            selector: '[class*="ad-container"]',
            attributes: [
              { key: "data-ad-slot", value: "5555555555" },
            ],
            injectPixel: true,
            pixelSrc: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          },
        ],
      });
    }, tabId);

    await page.waitForTimeout(300);

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

  test('one-shot guard: second dispatch returns 0 applied', async ({ extensionPage: page }) => {
    // Inject mock ad containers
    await page.evaluate(() => {
      const div1 = document.createElement('div');
      div1.id = 'gpt-ad-oneshot-1';
      div1.style.cssText = 'width:300px;height:250px;';
      document.body.appendChild(div1);

      const div2 = document.createElement('div');
      div2.id = 'gpt-ad-oneshot-2';
      div2.style.cssText = 'width:728px;height:90px;';
      document.body.appendChild(div2);
    });

    const sw = page.context().serviceWorkers()[0];
    const tabId = await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tab?.id || null;
    });

    // First dispatch — should apply
    const firstResult = await sw.evaluate(async (tid: number) => {
      return new Promise<number>((resolve) => {
        const handler = (msg: any) => {
          if (msg.type === "domChaffApplied") {
            chrome.runtime.onMessage.removeListener(handler);
            resolve(msg.count);
          }
        };
        chrome.runtime.onMessage.addListener(handler);
        chrome.tabs.sendMessage(tid, {
          type: "queueDOMChaff",
          configs: [
            {
              selector: '[id*="gpt-ad"]',
              attributes: [{ key: "data-ad-slot", value: "first-inject" }],
              injectPixel: false,
            },
          ],
        });
        // Timeout fallback
        setTimeout(() => resolve(-1), 3000);
      });
    }, tabId);

    // First dispatch should have applied to at least 1 container
    expect(firstResult).toBeGreaterThan(0);

    // Second dispatch — should be blocked by one-shot guard
    const secondResult = await sw.evaluate(async (tid: number) => {
      return new Promise<number>((resolve) => {
        const handler = (msg: any) => {
          if (msg.type === "domChaffApplied") {
            chrome.runtime.onMessage.removeListener(handler);
            resolve(msg.count);
          }
        };
        chrome.runtime.onMessage.addListener(handler);
        chrome.tabs.sendMessage(tid, {
          type: "queueDOMChaff",
          configs: [
            {
              selector: '[id*="gpt-ad"]',
              attributes: [{ key: "data-ad-format", value: "should-not-appear" }],
              injectPixel: false,
            },
          ],
        });
        setTimeout(() => resolve(-1), 3000);
      });
    }, tabId);

    // One-shot guard: second dispatch returns 0
    expect(secondResult).toBe(0);
  });
});
