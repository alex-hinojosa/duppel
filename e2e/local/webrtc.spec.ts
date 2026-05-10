import { test, expect } from '../fixtures/extension';
import { getTestPageUrl } from '../fixtures/extension';

// ---------------------------------------------------------------------------
// WebRTC IP Leak Prevention (v2 item 10)
//
// background.js sets chrome.privacy.network.webRTCIPHandlingPolicy to
// "default_public_interface_only" on install, startup, and SW wake.
//
// This prevents ICE candidates from exposing private/local IPs.
// NOT relay-only: relay-only is detectable and breaks apps without TURN.
// ---------------------------------------------------------------------------

test.describe('WebRTC policy (v2 item 10)', () => {
  test('webRTCIPHandlingPolicy is default_public_interface_only', async ({ context }) => {
    // Read the policy via the service worker (background.js has chrome.privacy)
    const sw = context.serviceWorkers()[0];
    expect(sw).toBeTruthy();

    const policy = await sw.evaluate(() => {
      return new Promise((resolve) => {
        chrome.privacy.network.webRTCIPHandlingPolicy.get({}, (details) => {
          resolve(details);
        });
      });
    });

    expect((policy as any).value).toBe('default_public_interface_only');
  });

  test('webRTCIPHandlingPolicy is controlled by this extension', async ({ context }) => {
    const sw = context.serviceWorkers()[0];
    expect(sw).toBeTruthy();

    const policy = await sw.evaluate(() => {
      return new Promise((resolve) => {
        chrome.privacy.network.webRTCIPHandlingPolicy.get({}, (details) => {
          resolve(details);
        });
      });
    });

    // levelOfControl should indicate this extension controls the setting
    expect((policy as any).levelOfControl).toBe('controlled_by_this_extension');
  });

  test('ICE candidates do not contain private IPs', async ({ extensionPage }) => {
    // Create RTCPeerConnection and gather ICE candidates.
    // Under default_public_interface_only, host candidates with private
    // IPs (10.x, 172.16-31.x, 192.168.x) should NOT appear.
    //
    // Caveat: in headless/CI environments, ICE gathering may produce zero
    // candidates (no network interfaces exposed to the browser sandbox).
    // That's acceptable — zero candidates means zero IP leakage.
    const candidates = await extensionPage.evaluate(() => {
      return new Promise<string[]>((resolve) => {
        const gathered: string[] = [];
        const pc = new RTCPeerConnection({ iceServers: [] });

        pc.createDataChannel('test');

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            gathered.push(event.candidate.candidate);
          } else {
            pc.close();
            resolve(gathered);
          }
        };

        pc.createOffer().then((offer) => pc.setLocalDescription(offer));

        // Timeout safety — resolve with whatever we have after 5s
        setTimeout(() => {
          pc.close();
          resolve(gathered);
        }, 5000);
      });
    });

    const privateIpPattern = /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/;

    for (const candidate of candidates) {
      if (candidate.includes('typ host')) {
        expect(candidate).not.toMatch(privateIpPattern);
      }
    }
  });
});

test.describe('WebRTC regression (v2 item 10)', () => {
  test('Sec-GPC header still present after privacy permission added', async ({ extensionPage }) => {
    const headers = await extensionPage.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      return resp.json();
    });
    expect(headers['sec-gpc']).toBe('1');
  });

  test('UA header still spoofed after privacy permission added', async ({ extensionPage }) => {
    const headers = await extensionPage.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      return resp.json();
    });
    expect(headers['user-agent']).toMatch(/^Mozilla\/5\.0/);
  });

  test('query stripping still works after privacy permission added', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();
    await page.goto(`${base}?utm_source=test&q=hello`);
    await page.waitForLoadState('domcontentloaded');
    const url = new URL(page.url());
    expect(url.searchParams.has('utm_source')).toBe(false);
    expect(url.searchParams.get('q')).toBe('hello');
    await page.close();
  });
});
