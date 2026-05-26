/**
 * Smoke test fixture — launches Chromium with Duppel loaded in PRODUCTION mode.
 *
 * Unlike the standard extension fixture, this does NOT disable strictFirstDoc.
 * The extension runs exactly as a real user would experience it:
 *   - First navigation: all-native (strict-next-nav arms DNR for next nav)
 *   - Second navigation: full persona (JS bootstrap + DNR coherent)
 *
 * This is the v0.1.1 release smoke matrix fixture.
 */

import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const EXTENSION_PATH = path.resolve(__dirname, '..', '..');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'duppel-smoke-')
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
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      const workers = context.serviceWorkers();
      if (workers.length > 0) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (context.serviceWorkers().length === 0) {
      throw new Error('Service worker not detected within 10s');
    }

    // Wait for session seed initialization
    const sw = context.serviceWorkers()[0];
    for (let i = 0; i < 30; i++) {
      const sessionSeed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (sessionSeed) break;
      await new Promise(r => setTimeout(r, 150));
    }

    // strictFirstDoc: true is the production default — do NOT disable it.
    await use(context);
    await context.close();

    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0];
    if (!sw) throw new Error('Extension service worker not found');
    const id = sw.url().split('/')[2];
    await use(id);
  },
});

export { expect } from '@playwright/test';
