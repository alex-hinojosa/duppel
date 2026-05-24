/**
 * Custom Playwright fixture that launches Chromium with Duppel loaded.
 *
 * Uses chromium.launchPersistentContext() with --load-extension — the only
 * Playwright API that supports Chrome extension loading.
 *
 * Requires headful mode (extensions don't work in headless Chromium).
 * Uses Playwright's bundled "Chrome for Testing" (default channel).
 * System Chrome (channel: 'chrome') does NOT work — Playwright's CDP
 * connection suppresses extension loading.
 */

import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';

const EXTENSION_PATH = path.resolve(__dirname, '..', '..');

// Minimal test page served over HTTP (content scripts need http(s):// URLs)
const TEST_PAGE_HTML = fs.readFileSync(path.resolve(__dirname, 'test-page.html'), 'utf-8');
const HARNESS_PAGE_HTML = fs.readFileSync(path.resolve(__dirname, 'harness-page.html'), 'utf-8');

let _server: http.Server | null = null;
let _serverPort = 0;

function ensureServer(): Promise<number> {
  if (_server && _serverPort) return Promise.resolve(_serverPort);
  return new Promise((resolve) => {
    _server = http.createServer((req, res) => {
      // Phase B measurement harness endpoints
      if (req.url === '/harness') {
        const mainFrameUA = req.headers['user-agent'] || '';
        const headersJSON = JSON.stringify(req.headers).replace(/</g, '\\u003c');
        // Serve harness page with server-observed HTTP UA embedded
        const page = HARNESS_PAGE_HTML.replace(
          '<title>Phase B Measurement Harness</title>',
          `<title>Phase B Measurement Harness</title>\n<script>window.__httpUA="${mainFrameUA.replace(/"/g, '\\"')}";</script>`
        );
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end(page);
        return;
      }
      if (req.url === '/harness-echo') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(req.headers));
        return;
      }
      if (req.url === '/echo-headers') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(req.headers));
        return;
      }
      // Serve an HTML page with server-received headers embedded.
      // Used by first-navigation evidence tests to capture main_frame UA
      // as seen by the server (after DNR modification, if any).
      if (req.url === '/echo-page') {
        const headersJSON = JSON.stringify(req.headers).replace(/</g, '\\u003c');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><head></head><body><script>window.__serverHeaders=${headersJSON};</script></body></html>`);
        return;
      }
      // Serve worker test scripts with correct content-type and CORS
      // (blob-wrapped module workers have opaque origin, need CORS for import())
      if (req.url?.startsWith('/worker-scripts/') && req.url.endsWith('.js')) {
        const scriptPath = path.resolve(__dirname, '.' + req.url);
        try {
          const content = fs.readFileSync(scriptPath, 'utf-8');
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end('Not found');
        }
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(TEST_PAGE_HTML);
    });
    _server.listen(0, '127.0.0.1', () => {
      const addr = _server!.address() as { port: number };
      _serverPort = addr.port;
      resolve(_serverPort);
    });
  });
}

/** Poll for service worker (may fire before CDP is fully ready). */
async function waitForServiceWorker(context: BrowserContext, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const workers = context.serviceWorkers();
    if (workers.length > 0) return workers[0];
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Service worker not detected within ' + timeoutMs + 'ms');
}

export const test = base.extend<{
  context: BrowserContext;
  extensionPage: Page;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const port = await ensureServer();
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'duppel-test-')
    );

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
        '--disable-popup-blocking',
      ],
    });

    // Wait for extension service worker to register
    const sw = await waitForServiceWorker(context);

    // v0.1.1 R1: strictFirstDoc defaults to true in production.
    // Local tests need spoofing on first meaningful navigation → disable strict mode.
    const extensionId = sw.url().split('/')[2];
    const disablePage = await context.newPage();
    await disablePage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await disablePage.waitForLoadState('domcontentloaded');
    await disablePage.evaluate(async () => {
      const B = (globalThis as any).browser || chrome;
      await new Promise<void>((resolve) => {
        B.runtime.sendMessage(
          { type: 'setStrictFirstDoc', enabled: false },
          () => resolve(),
        );
      });
    });
    await disablePage.close();

    await use(context);
    await context.close();

    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  extensionPage: async ({ context }, use) => {
    const port = _serverPort;
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForLoadState('domcontentloaded');

    // Round 6+: seed delivered via closure-local executeScript({ func, args }).
    // No window properties, no convergence events, no sessionStorage.
    // Wait for SW to initialize (so tabs.onUpdated handler is registered),
    // then reload so bootstrap injection runs with the session seed.
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
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    await use(page);
    await page.close();
  },

  extensionId: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0];
    if (!sw) throw new Error('Extension service worker not found');
    const id = sw.url().split('/')[2];
    await use(id);
  },
});

export { expect } from '@playwright/test';

// Export test page URL helper for rotation tests that need to open new pages
export function getTestPageUrl() {
  return `http://127.0.0.1:${_serverPort}/`;
}

/**
 * Set native-compatible mode for a hostname via extension popup page.
 * chrome.runtime.sendMessage can't be called from the SW to itself, and
 * const STATE isn't accessible via globalThis from sw.evaluate.
 * Extension pages (popup) have full chrome.runtime access.
 * Used by Phase B native-compatible test block (C6).
 */
export async function setNativeCompat(
  context: BrowserContext,
  hostname: string,
  enabled: boolean,
) {
  const sw = context.serviceWorkers()[0];
  if (!sw) throw new Error('Service worker not found — cannot set native-compat');
  const extensionId = sw.url().split('/')[2];
  const setupPage = await context.newPage();
  await setupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await setupPage.waitForLoadState('domcontentloaded');
  await setupPage.evaluate(
    async (args: { hostname: string; enabled: boolean }) => {
      const B = (globalThis as any).browser || chrome;
      await new Promise<void>((resolve) => {
        B.runtime.sendMessage(
          { type: 'setNativeCompat', hostname: args.hostname, enabled: args.enabled },
          () => resolve(),
        );
      });
    },
    { hostname, enabled },
  );
  await setupPage.close();
  // Wait for storage + DNR update to settle
  await new Promise(r => setTimeout(r, 500));
}
