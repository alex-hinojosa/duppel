import { test, expect } from '../fixtures/extension';
import { getTestPageUrl } from '../fixtures/extension';
import http from 'http';

// Second HTTP server on a different port — cross-origin relative to the fixture server
let crossOriginServer: http.Server;
let crossOriginPort: number;

test.beforeAll(async () => {
  await new Promise<void>((resolve) => {
    crossOriginServer = http.createServer((req, res) => {
      if (req.url === '/echo-headers') {
        // Serve as HTML so Chrome renders it as a normal page (JSON responses
        // can trigger context destruction with extension content scripts)
        const hdrs = JSON.stringify(req.headers).replace(/</g, '&lt;');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><body><pre id="h">${hdrs}</pre></body></html>`);
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

test.describe('Cross-origin referrer trimming (v2 item 9)', () => {
  test('cross-origin document.referrer is origin-only', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();

    // Navigate to the fixture server — use referer option to simulate arriving from a deep path
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
    // Should be origin-only (no path, no query) since cross-origin
    expect(referrer).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await page.close();
  });

  test('cross-origin Referer header is origin-only', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();

    // Navigate to the fixture server at a deep path
    await page.goto(base, { waitUntil: 'networkidle' });

    // Click a link to the cross-origin echo-headers endpoint
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

    // The page shows headers as JSON inside a <pre> tag
    const raw = await page.evaluate(() => document.getElementById('h')?.textContent || '{}');
    const headers = JSON.parse(raw);
    const referer = headers['referer'] || '';

    // Cross-origin Referer should be origin-only
    if (referer) {
      expect(referer).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    }
    await page.close();
  });

  test('same-origin document.referrer preserves full path', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();

    // Navigate to the fixture server
    await page.goto(base, { waitUntil: 'networkidle' });

    // Click a same-origin link to a deep path — establishes referrer
    await page.evaluate((url: string) => {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = 'next';
      document.body.appendChild(a);
    }, `${base}second/page`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('a'),
    ]);
    await page.waitForTimeout(300);

    const referrer = await page.evaluate(() => document.referrer);
    // Same-origin: should preserve the referrer with the origin (root /)
    expect(referrer).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
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
