/**
 * Custom Playwright fixture that launches Chromium with PhantomGrid loaded.
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

let _server: http.Server | null = null;
let _serverPort = 0;

function ensureServer(): Promise<number> {
  if (_server && _serverPort) return Promise.resolve(_serverPort);
  return new Promise((resolve) => {
    _server = http.createServer((req, res) => {
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
      path.join(os.tmpdir(), 'phantomgrid-test-')
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
    await waitForServiceWorker(context);

    await use(context);
    await context.close();

    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  extensionPage: async ({ context }, use) => {
    const port = _serverPort;
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForLoadState('domcontentloaded');

    // Allow anti-fingerprint.js to apply overrides (runs at document_start)
    await page.waitForTimeout(500);

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
