import { test, expect } from '../fixtures/extension';
import { getTestPageUrl } from '../fixtures/extension';

test.describe('Query string stripping (v2 item 8)', () => {
  test('strips utm_source from navigation URL', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();
    await page.goto(`${base}?utm_source=newsletter`);
    await page.waitForLoadState('domcontentloaded');
    const url = new URL(page.url());
    expect(url.searchParams.has('utm_source')).toBe(false);
    await page.close();
  });

  test('strips fbclid from navigation URL', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();
    await page.goto(`${base}?fbclid=abc123xyz`);
    await page.waitForLoadState('domcontentloaded');
    const url = new URL(page.url());
    expect(url.searchParams.has('fbclid')).toBe(false);
    await page.close();
  });

  test('strips multiple tracking params at once', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();
    await page.goto(`${base}?utm_source=google&utm_medium=cpc&gclid=abc&fbclid=xyz`);
    await page.waitForLoadState('domcontentloaded');
    const url = new URL(page.url());
    expect(url.searchParams.has('utm_source')).toBe(false);
    expect(url.searchParams.has('utm_medium')).toBe(false);
    expect(url.searchParams.has('gclid')).toBe(false);
    expect(url.searchParams.has('fbclid')).toBe(false);
    await page.close();
  });

  test('strips all 17 tracked param names', async ({ context }) => {
    const params = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
      'fbclid', 'gclid', 'dclid', 'msclkid', 'yclid', 'twclid',
      'mc_eid', '_ga', '_gl', 'wbraid', 'gbraid',
    ];
    const qs = params.map(p => `${p}=test`).join('&');
    const page = await context.newPage();
    const base = getTestPageUrl();
    await page.goto(`${base}?${qs}`);
    await page.waitForLoadState('domcontentloaded');
    const url = new URL(page.url());
    for (const p of params) {
      expect(url.searchParams.has(p), `${p} should be stripped`).toBe(false);
    }
    // All params stripped — no query string should remain
    expect(url.search).toBe('');
    await page.close();
  });

  test('preserves non-tracking query params', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();
    await page.goto(`${base}?q=hello&page=2`);
    await page.waitForLoadState('domcontentloaded');
    const url = new URL(page.url());
    expect(url.searchParams.get('q')).toBe('hello');
    expect(url.searchParams.get('page')).toBe('2');
    await page.close();
  });

  test('mixed tracking + non-tracking: strips only tracking', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();
    await page.goto(`${base}?q=search&utm_source=google&page=3&fbclid=abc`);
    await page.waitForLoadState('domcontentloaded');
    const url = new URL(page.url());
    expect(url.searchParams.get('q')).toBe('search');
    expect(url.searchParams.get('page')).toBe('3');
    expect(url.searchParams.has('utm_source')).toBe(false);
    expect(url.searchParams.has('fbclid')).toBe(false);
    await page.close();
  });

  test('URL with no query params is unchanged', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();
    await page.goto(base);
    await page.waitForLoadState('domcontentloaded');
    const url = new URL(page.url());
    expect(url.search).toBe('');
    await page.close();
  });

  test('URL with only non-tracking params is unchanged', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();
    await page.goto(`${base}?category=books&sort=price`);
    await page.waitForLoadState('domcontentloaded');
    const url = new URL(page.url());
    expect(url.searchParams.get('category')).toBe('books');
    expect(url.searchParams.get('sort')).toBe('price');
    await page.close();
  });

  test('preserves URL hash fragment', async ({ context }) => {
    const page = await context.newPage();
    const base = getTestPageUrl();
    await page.goto(`${base}?utm_source=test&q=hello#section2`);
    await page.waitForLoadState('domcontentloaded');
    const url = new URL(page.url());
    expect(url.searchParams.has('utm_source')).toBe(false);
    expect(url.searchParams.get('q')).toBe('hello');
    expect(url.hash).toBe('#section2');
    await page.close();
  });
});

test.describe('Query stripping regression (v2 item 8)', () => {
  test('UA header still spoofed after query-strip rule added', async ({ extensionPage }) => {
    const headers = await extensionPage.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      return resp.json();
    });
    expect(headers['user-agent']).toMatch(/^Mozilla\/5\.0/);
  });

  test('Sec-GPC header still present after query-strip rule added', async ({ extensionPage }) => {
    const headers = await extensionPage.evaluate(async () => {
      const resp = await fetch('/echo-headers');
      return resp.json();
    });
    expect(headers['sec-gpc']).toBe('1');
  });
});
