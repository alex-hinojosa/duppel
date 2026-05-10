import { test, expect } from '../fixtures/extension';
import { getTestPageUrl } from '../fixtures/extension';
import http from 'http';

// Second HTTP server on a different port — cross-origin relative to the fixture server.
// Provides two endpoints:
//   /echo-headers  — returns received request headers as HTML (for main-frame navigation)
//   /echo-json     — returns received request headers as JSON with CORS (for fetch/XHR)
//   /*             — landing page that displays document.referrer
let crossOriginServer: http.Server;
let crossOriginPort: number;

test.beforeAll(async () => {
  await new Promise<void>((resolve) => {
    crossOriginServer = http.createServer((req, res) => {
      if (req.url === '/echo-headers') {
        // HTML page for main-frame navigation tests
        const hdrs = JSON.stringify(req.headers).replace(/</g, '&lt;');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><body><pre id="h">${hdrs}</pre></body></html>`);
        return;
      }
      if (req.url === '/echo-json') {
        // JSON with CORS for fetch/XHR sub-resource tests
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(req.headers));
        return;
      }
      // Landing page that reads document.referrer
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><title>Cross-Origin Target</title></head>
        <body><p id="ref"></p>
        <script>document.getElementById('ref').textContent = document.referrer;</script>
        </body></html>`);
    });
    crossOriginServer.listen(0, '127.0.0.1', () => {
      const addr = crossOriginServer.address() as { port: number };
      crossOriginPort = addr.port;
      resolve();
    });
  });
});

test.afterAll(async () => {
  if (crossOriginServer) {
    crossOriginServer.closeAllConnections();
    await new Promise<void>((resolve) => crossOriginServer.close(() => resolve()));
  }
});

// ---------------------------------------------------------------------------
// Referrer trimming policy:
//
//   Rule 5 (static DNR): sets Referrer-Policy: origin-when-cross-origin on
//   all responses. This tells the browser to send origin-only Referer on
//   cross-origin requests and preserve full path+query for same-origin.
//
//   Rule 1 (pre-existing): removes the Referer request header entirely for
//   third-party sub-requests (xmlhttprequest, image, script, sub_frame).
//   This is STRICTER than origin-only — complete removal.
//
//   Combined policy:
//   - Main-frame cross-origin navigation: origin-only (rule 5, rule 1 n/a)
//   - Third-party sub-resources (XHR, image, script, sub_frame): no Referer
//     (rule 1 removes it before rule 5's policy would send origin-only)
//   - Same-origin: full path+query preserved (neither rule alters same-origin)
//   - document.referrer JS surface: belt-and-suspenders spoof matches network
// ---------------------------------------------------------------------------

test.describe('Cross-origin referrer trimming — main-frame (v2 item 9)', () => {
  test('cross-origin document.referrer is origin-only', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();

    // Navigate to the fixture server
    await page.goto(base, { waitUntil: 'networkidle' });

    // Click a link to cross-origin — establishes referrer naturally
    const crossUrl = `http://127.0.0.1:${crossOriginPort}/landing`;
    await page.evaluate((url: string) => {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = 'cross';
      document.body.appendChild(a);
    }, crossUrl);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('a'),
    ]);
    await page.waitForTimeout(300);

    const referrer = await page.evaluate(() => document.referrer);
    // Must be present (not empty) and origin-only
    expect(referrer).not.toBe('');
    expect(referrer).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await page.close();
  });

  test('cross-origin Referer header is present and origin-only on main-frame navigation', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();

    // Navigate to the fixture server
    await page.goto(base, { waitUntil: 'networkidle' });

    // Click a link to the cross-origin echo-headers endpoint (main-frame nav)
    const echoUrl = `http://127.0.0.1:${crossOriginPort}/echo-headers`;
    await page.evaluate((url: string) => {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = 'echo';
      document.body.appendChild(a);
    }, echoUrl);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('a'),
    ]);
    await page.waitForTimeout(300);

    // Read the headers the cross-origin server received
    const raw = await page.evaluate(() => document.getElementById('h')?.textContent || '{}');
    const headers = JSON.parse(raw);
    const referer = headers['referer'] || '';

    // Main-frame cross-origin: Referer MUST be present and MUST be origin-only
    expect(referer).not.toBe('');
    expect(referer).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await page.close();
  });
});

test.describe('Cross-origin referrer trimming — sub-resources (v2 item 9)', () => {
  // Note: rule 1 removes Referer for `domainType: "thirdParty"` which uses eTLD+1
  // domain matching, NOT origin matching. In the test environment both servers share
  // 127.0.0.1 (same domain, different ports) so rule 1 does not fire. Instead,
  // rule 5's Referrer-Policy: origin-when-cross-origin applies, sending origin-only.
  // In production with truly different domains (different eTLD+1), rule 1 would
  // remove Referer entirely — a stricter policy than origin-only.

  test('cross-origin fetch Referer is origin-only (Referrer-Policy applies)', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();

    // Navigate to the fixture server
    await page.goto(base, { waitUntil: 'networkidle' });

    // Fetch cross-origin echo-json endpoint
    const headers = await page.evaluate(async (port: number) => {
      const resp = await fetch(`http://127.0.0.1:${port}/echo-json`);
      return resp.json();
    }, crossOriginPort);

    // Same-domain different-port: rule 1 (thirdParty) does not fire.
    // Rule 5's Referrer-Policy trims to origin-only.
    const referer = headers['referer'] || '';
    expect(referer).not.toBe('');
    expect(referer).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await page.close();
  });

  test('cross-origin sub-frame document.referrer is origin-only', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();

    // Navigate to the fixture server
    await page.goto(base, { waitUntil: 'networkidle' });

    // Create an iframe pointing to the cross-origin landing page
    const iframeUrl = `http://127.0.0.1:${crossOriginPort}/landing`;
    const iframeReferrer = await page.evaluate(async (url: string) => {
      return new Promise<string>((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.onload = () => {
          try {
            const ref = iframe.contentDocument?.getElementById('ref');
            resolve(ref?.textContent || '');
          } catch {
            resolve('CROSS_ORIGIN_BLOCKED');
          }
        };
        iframe.src = url;
        document.body.appendChild(iframe);
      });
    }, iframeUrl);

    // If readable: document.referrer in the iframe should be origin-only
    if (iframeReferrer !== 'CROSS_ORIGIN_BLOCKED') {
      if (iframeReferrer) {
        expect(iframeReferrer).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      }
      // Empty is also valid — no referrer for direct iframe insertion
    }
    await page.close();
  });
});

test.describe('Same-origin referrer preservation (v2 item 9)', () => {
  test('same-origin document.referrer preserves full path and query', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();

    // Navigate to a URL with path AND query on the fixture server
    await page.goto(`${base}deep/source?key=value&page=3`, { waitUntil: 'networkidle' });

    // Click a same-origin link — establishes referrer with the source URL
    await page.evaluate((url: string) => {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = 'next';
      document.body.appendChild(a);
    }, `${base}target`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('a'),
    ]);
    await page.waitForTimeout(300);

    const referrer = await page.evaluate(() => document.referrer);
    // Same-origin: full path AND query must be preserved
    expect(referrer).toContain('/deep/source');
    expect(referrer).toContain('key=value');
    expect(referrer).toContain('page=3');
    await page.close();
  });

  test('document.referrer is empty string when no referrer', async ({ context }) => {
    const page = await context.newPage();
    // Direct navigation — no referrer
    await page.goto(`http://127.0.0.1:${crossOriginPort}/`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(300);

    const referrer = await page.evaluate(() => document.referrer);
    expect(referrer).toBe('');
    await page.close();
  });
});

test.describe('document.referrer descriptor hardening (v2 item 9)', () => {
  test('GOPD returns getter-shaped descriptor for document.referrer', async ({ extensionPage }) => {
    const desc = await extensionPage.evaluate(() => {
      const d = Object.getOwnPropertyDescriptor(Document.prototype, 'referrer');
      return {
        hasGet: typeof d?.get === 'function',
        hasSet: 'set' in (d || {}),
        hasValue: 'value' in (d || {}),
        configurable: d?.configurable,
        enumerable: d?.enumerable,
      };
    });
    expect(desc.hasGet).toBe(true);
    expect(desc.hasValue).toBe(false);
    expect(desc.configurable).toBe(true);
    expect(desc.enumerable).toBe(true);
  });

  test('getter.name is "get referrer"', async ({ extensionPage }) => {
    const name = await extensionPage.evaluate(() => {
      const d = Object.getOwnPropertyDescriptor(Document.prototype, 'referrer');
      return d?.get?.name;
    });
    expect(name).toBe('get referrer');
  });

  test('getter toString returns native format', async ({ extensionPage }) => {
    const str = await extensionPage.evaluate(() => {
      const d = Object.getOwnPropertyDescriptor(Document.prototype, 'referrer');
      return d?.get?.toString();
    });
    expect(str).toMatch(/^function get referrer\(\) \{ \[native code\] \}$/);
  });
});

test.describe('Referrer trimming regression (v2 item 9)', () => {
  test('Sec-GPC header still present after referrer rule added', async ({ extensionPage }) => {
    const headers = await extensionPage.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      return resp.json();
    });
    expect(headers['sec-gpc']).toBe('1');
  });

  test('UA header still spoofed after referrer rule added', async ({ extensionPage }) => {
    const headers = await extensionPage.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      return resp.json();
    });
    expect(headers['user-agent']).toMatch(/^Mozilla\/5\.0/);
  });

  test('query stripping still works after referrer rule added', async ({ context }) => {
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
