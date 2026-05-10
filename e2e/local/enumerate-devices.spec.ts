import { test, expect } from '../fixtures/extension';
import { getTestPageUrl } from '../fixtures/extension';

// ---------------------------------------------------------------------------
// enumerateDevices spoofing (v2 item 11)
//
// navigator.mediaDevices.enumerateDevices() returns a stable, low-entropy
// device list: 1 audioinput, 1 audiooutput, 1 videoinput. Device IDs are
// deterministic 64-char hex strings derived from the session seed. Labels
// are empty (matches browser behavior before getUserMedia permission).
// ---------------------------------------------------------------------------

test.describe('enumerateDevices spoofing (v2 item 11)', () => {
  test('enumerateDevices returns exactly 3 devices', async ({ extensionPage }) => {
    const devices = await extensionPage.evaluate(async () => {
      return navigator.mediaDevices.enumerateDevices();
    });
    expect(devices).toHaveLength(3);
  });

  test('device kinds are audioinput, audiooutput, videoinput', async ({ extensionPage }) => {
    const kinds = await extensionPage.evaluate(async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.map((d: any) => d.kind);
    });
    expect(kinds).toEqual(['audioinput', 'audiooutput', 'videoinput']);
  });

  test('device IDs are 64-char hex strings', async ({ extensionPage }) => {
    const deviceIds = await extensionPage.evaluate(async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.map((d: any) => d.deviceId);
    });
    for (const id of deviceIds) {
      expect(id).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('all devices share a common groupId', async ({ extensionPage }) => {
    const groupIds = await extensionPage.evaluate(async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.map((d: any) => d.groupId);
    });
    expect(groupIds[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(groupIds[0]).toBe(groupIds[1]);
    expect(groupIds[1]).toBe(groupIds[2]);
  });

  test('device IDs are distinct from each other', async ({ extensionPage }) => {
    const deviceIds = await extensionPage.evaluate(async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.map((d: any) => d.deviceId);
    });
    const unique = new Set(deviceIds);
    expect(unique.size).toBe(3);
  });

  test('labels are empty strings (pre-permission behavior)', async ({ extensionPage }) => {
    const labels = await extensionPage.evaluate(async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.map((d: any) => d.label);
    });
    for (const label of labels) {
      expect(label).toBe('');
    }
  });

  test('repeated calls return stable values', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      const d1 = await navigator.mediaDevices.enumerateDevices();
      const d2 = await navigator.mediaDevices.enumerateDevices();
      return {
        ids1: d1.map((d: any) => d.deviceId),
        ids2: d2.map((d: any) => d.deviceId),
      };
    });
    expect(result.ids1).toEqual(result.ids2);
  });

  test('enumerateDevices returns a promise', async ({ extensionPage }) => {
    const isPromise = await extensionPage.evaluate(() => {
      const result = navigator.mediaDevices.enumerateDevices();
      return result instanceof Promise;
    });
    expect(isPromise).toBe(true);
  });

  test('mediaDevices object is still present', async ({ extensionPage }) => {
    const exists = await extensionPage.evaluate(() => {
      return typeof navigator.mediaDevices === 'object' && navigator.mediaDevices !== null;
    });
    expect(exists).toBe(true);
  });
});

test.describe('enumerateDevices stealth (v2 item 11)', () => {
  test('enumerateDevices.name is "enumerateDevices"', async ({ extensionPage }) => {
    const name = await extensionPage.evaluate(() => {
      return navigator.mediaDevices.enumerateDevices.name;
    });
    expect(name).toBe('enumerateDevices');
  });

  test('enumerateDevices.length is 0', async ({ extensionPage }) => {
    const length = await extensionPage.evaluate(() => {
      return navigator.mediaDevices.enumerateDevices.length;
    });
    expect(length).toBe(0);
  });

  test('enumerateDevices toString returns native format', async ({ extensionPage }) => {
    const str = await extensionPage.evaluate(() => {
      return navigator.mediaDevices.enumerateDevices.toString();
    });
    expect(str).toMatch(/^function enumerateDevices\(\) \{ \[native code\] \}$/);
  });
});

test.describe('enumerateDevices regression (v2 item 11)', () => {
  test('Sec-GPC header still present', async ({ extensionPage }) => {
    const headers = await extensionPage.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      return resp.json();
    });
    expect(headers['sec-gpc']).toBe('1');
  });

  test('UA header still spoofed', async ({ extensionPage }) => {
    const headers = await extensionPage.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      return resp.json();
    });
    expect(headers['user-agent']).toMatch(/^Mozilla\/5\.0/);
  });

  test('query stripping still works', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();
    await page.goto(`${base}?utm_source=test&q=hello`);
    await page.waitForLoadState('domcontentloaded');
    const url = new URL(page.url());
    expect(url.searchParams.has('utm_source')).toBe(false);
    expect(url.searchParams.get('q')).toBe('hello');
    await page.close();
  });

  test('WebRTC policy still active', async ({ context }) => {
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
});
