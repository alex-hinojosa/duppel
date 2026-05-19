/**
 * Baseline fixture — launches Chromium WITHOUT PhantomGrid extension.
 *
 * Same structure as extension.ts but no --load-extension flags.
 * Provides vanilla Chrome behavior for comparison against extension-loaded runs.
 */

import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';

const TEST_PAGE_HTML = fs.readFileSync(
  path.resolve(__dirname, 'test-page.html'),
  'utf-8',
);

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

export const test = base.extend<{
  context: BrowserContext;
  baselinePage: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    await ensureServer();
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'phantomgrid-baseline-'),
    );

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        '--no-first-run',
        '--disable-default-apps',
        '--disable-popup-blocking',
        // No --load-extension — vanilla Chrome
      ],
    });

    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  baselinePage: async ({ context }, use) => {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${_serverPort}/`);
    await page.waitForLoadState('domcontentloaded');
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
