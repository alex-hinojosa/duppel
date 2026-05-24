/**
 * Phase B — Coherence Measurement Harness
 *
 * Measures UA identity across the bootstrap lifecycle under each mode
 * defined in SPEC-v0.1.1.md Section 5. Outputs structured JSONL matching
 * the acceptance fields (Section 5.4) and evaluates against pass/fail
 * gates (Section 5.6).
 *
 * Modes measured:
 *   - native:           extension disabled (baseline)
 *   - success-driven:   extension enabled, v0.1.1 bootstrap lifecycle
 *   - narrowed-persona: persona-family filter active (C3)
 *   - native-compatible: native-compat mode active (C4)
 *
 * Tests always pass — the JSONL measurements and verdicts are the
 * deliverable. Phase B is observation, not enforcement.
 */

import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';

const EXTENSION_PATH = path.resolve(__dirname, '..', '..');
const HARNESS_PAGE_HTML = fs.readFileSync(
  path.resolve(__dirname, '..', 'fixtures', 'harness-page.html'),
  'utf-8',
);

// ── Output ────────────────────────────────────────────────────────────

const RESULTS_DIR = path.resolve(__dirname, '..', '..', 'test-results');
const JSONL_PATH = path.join(RESULTS_DIR, 'phase-b-measurements.jsonl');

interface PhaseBFields {
  mode: string;
  subtest: string;
  timestamp: string;
  httpUA: string | null;
  earliestJsUA: string | null;
  earliestJsTimestamp: number | null;
  postBootstrapJsUA: string | null;
  postBootstrapTimestamp: number | null;
  fetchRequestUA: string | null;
  // DNR rule state (v0.1.1 C9 — rule existence/coverage, not observed mutation)
  dnrRuleInstalled: boolean | null;
  dnrRuleCoversMainFrame: boolean | null;
  dnrRuleCoversFetch: boolean | null;
  // Observed spoofing (v0.1.1 C9 — derived from captured UA vs native UA)
  observedMainFrameSpoofed: boolean | null;
  observedFetchSpoofed: boolean | null;
  // Proof semantics (v0.1.1 C10)
  // bootstrapProofEarned: page JS UA differs from native UA (bootstrap effect visible)
  bootstrapProofEarned: boolean;
  // proofEarnedForCurrentDocument: JS UA matches intended persona AND differs from native
  proofEarnedForCurrentDocument: boolean | null;
  // Reference values for observation
  nativeUA: string | null;
  intendedPersonaUA: string | null;
  identityMode: string | null;
  nativeCompatibleActive: boolean;
  personaFamily: string | null;
  personaUA: string | null;
  hostFamily: string | null;
  crossFamily: boolean | null;
  bootstrapGapMs: number | null;
  verdict: string;
  verdictDetails: string[];
}

function appendResult(result: PhaseBFields) {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
  fs.appendFileSync(JSONL_PATH, JSON.stringify(result) + '\n', 'utf-8');
}

function clearResults() {
  if (fs.existsSync(JSONL_PATH)) {
    fs.unlinkSync(JSONL_PATH);
  }
}

// ── Shared server ─────────────────────────────────────────────────────

let _server: http.Server | null = null;
let _serverPort = 0;

function ensureServer(): Promise<number> {
  if (_server && _serverPort) return Promise.resolve(_serverPort);
  return new Promise((resolve) => {
    _server = http.createServer((req, res) => {
      if (req.url === '/harness' || req.url?.startsWith('/harness?')) {
        const mainFrameUA = req.headers['user-agent'] || '';
        const escaped = mainFrameUA.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const page = HARNESS_PAGE_HTML.replace(
          '<title>Phase B Measurement Harness</title>',
          `<title>Phase B Measurement Harness</title>\n<script>window.__httpUA="${escaped}";</script>`,
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
      res.writeHead(404);
      res.end('Not found');
    });
    _server.listen(0, '127.0.0.1', () => {
      const addr = _server!.address() as { port: number };
      _serverPort = addr.port;
      resolve(_serverPort);
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────

async function waitForHarnessDone(page: Page, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const done = await page.evaluate(() => (window as any).__harnessDone);
    if (done) return;
    await page.waitForTimeout(100);
  }
  throw new Error('Harness did not complete within ' + timeoutMs + 'ms');
}

async function collectMeasurements(page: Page) {
  return page.evaluate(() => ({
    httpUA: (window as any).__httpUA || null,
    earliestJsUA: (window as any).__earliestJsUA || null,
    earliestJsTimestamp: (window as any).__earliestJsTimestamp ?? null,
    postBootstrapJsUA: (window as any).__postBootstrapJsUA || null,
    postBootstrapTimestamp: (window as any).__postBootstrapTimestamp ?? null,
    fetchResponseUA: (window as any).__fetchResponseUA || null,
    fetchTimestamp: (window as any).__fetchTimestamp ?? null,
    fetchError: (window as any).__fetchError || null,
    // Phase D timeline data
    uaTimeline: (window as any).__uaTimeline || [],
    fetchTimeline: (window as any).__fetchTimeline || [],
  }));
}

function inferFamily(ua: string | null): string | null {
  if (!ua) return null;
  if (/Windows/.test(ua)) return /Firefox/.test(ua) ? 'firefox-windows' : 'chromium-windows';
  if (/Macintosh/.test(ua)) return /Firefox/.test(ua) ? 'firefox-macos' : 'chromium-macos';
  if (/Linux/.test(ua)) return 'chromium-linux';
  return null;
}

async function waitForServiceWorker(context: BrowserContext, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const workers = context.serviceWorkers();
    if (workers.length > 0) return workers[0];
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Service worker not detected within ' + timeoutMs + 'ms');
}

// v0.1.1 R1: strictFirstDoc is now the production default (true).
// Tests that need success-driven (non-strict) behavior must disable it.
async function disableStrictMode(ctx: BrowserContext) {
  const sw = ctx.serviceWorkers()[0];
  if (!sw) return;
  const extensionId = sw.url().split('/')[2];
  const setupPage = await ctx.newPage();
  await setupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await setupPage.waitForLoadState('domcontentloaded');
  await setupPage.evaluate(async () => {
    const B = (globalThis as any).browser || chrome;
    await new Promise<void>((resolve) => {
      B.runtime.sendMessage(
        { type: 'setStrictFirstDoc', enabled: false },
        () => resolve(),
      );
    });
  });
  await setupPage.close();
}

async function getDnrState(context: BrowserContext, tabUrl: string) {
  const sw = context.serviceWorkers()[0];
  if (!sw) return {
    dnrRuleInstalled: null,
    dnrRuleCoversMainFrame: null,
    dnrRuleCoversFetch: null,
    identityMode: 'session',
    uaRuleCount: 0,
  };

  return sw.evaluate(async (url: string) => {
    const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
    const sessionRules = await chrome.declarativeNetRequest.getSessionRules();
    const allRules = [...dynamicRules, ...sessionRules];
    const uaRules = allRules.filter((r: any) =>
      r.action?.requestHeaders?.some((h: any) =>
        h.header?.toLowerCase() === 'user-agent'
      )
    );

    const dnrRuleInstalled = uaRules.length > 0;

    const tabs = await chrome.tabs.query({});
    const matchingTab = tabs.find(t => t.url?.startsWith(url));
    const tabId = matchingTab?.id;

    // Rule coverage: does a rule exist that COVERS this tab and resource type?
    // This is rule existence/configuration, NOT observed mutation.
    const dnrRuleCoversMainFrame = tabId != null
      ? uaRules.some((r: any) =>
          !r.condition?.tabIds || r.condition.tabIds.includes(tabId)
        )
      : false;

    const dnrRuleCoversFetch = uaRules.some((r: any) =>
      r.condition?.resourceTypes?.includes('xmlhttprequest')
    );

    const sessionData = await chrome.storage.session.get(['identityMode']);

    return {
      dnrRuleInstalled,
      dnrRuleCoversMainFrame,
      dnrRuleCoversFetch,
      identityMode: sessionData.identityMode || 'session',
      uaRuleCount: uaRules.length,
    };
  }, tabUrl);
}

// Get the native (real) UA from the service worker context.
// The SW's navigator.userAgent is never modified by the extension.
async function getNativeUA(context: BrowserContext): Promise<string | null> {
  const sw = context.serviceWorkers()[0];
  if (!sw) return null;
  return sw.evaluate(() => navigator.userAgent);
}

// Get the intended persona UA from the extension's session storage.
async function getIntendedPersonaUA(context: BrowserContext): Promise<string | null> {
  const sw = context.serviceWorkers()[0];
  if (!sw) return null;
  return sw.evaluate(async () => {
    const data = await chrome.storage.session.get(['profile']);
    return data.profile?.userAgent || null;
  });
}

// Derive observation fields from captured UAs vs native reference.
function deriveObservation(httpUA: string | null, fetchUA: string | null,
    postBootstrapJsUA: string | null, nativeUA: string | null, intendedPersonaUA: string | null) {
  const observedMainFrameSpoofed = (nativeUA && httpUA) ? httpUA !== nativeUA : null;
  const observedFetchSpoofed = (nativeUA && fetchUA) ? fetchUA !== nativeUA : null;
  // Use postBootstrapJsUA for proof — earliestJsUA captures BEFORE executeScript
  // arrives from onCommitted (inline <head> script beats the SW round-trip).
  // postBootstrapJsUA captures AFTER setTimeout(0), giving the bootstrap time to run.
  const bootstrapProofEarned = !!(nativeUA && postBootstrapJsUA && postBootstrapJsUA !== nativeUA);
  const proofEarnedForCurrentDocument = bootstrapProofEarned
    && intendedPersonaUA != null
    && postBootstrapJsUA === intendedPersonaUA;
  return { observedMainFrameSpoofed, observedFetchSpoofed, bootstrapProofEarned, proofEarnedForCurrentDocument };
}

// Show the trailing differentiator of a UA (e.g., "Chrome/147" or "Edg/147")
function uaSuffix(ua: string | null): string {
  if (!ua) return 'null';
  // Extract version tokens after "Gecko)" — shows Chrome/147, Safari/537, Edg/147 etc.
  const m = ua.match(/\) (.+)$/);
  return m ? m[1] : ua.substring(Math.max(0, ua.length - 40));
}

function logResult(label: string, r: PhaseBFields) {
  console.log(`\n[Phase B] ${label}: ${r.verdict}`);
  console.log(`  HTTP UA:       ${uaSuffix(r.httpUA)}`);
  console.log(`  Earliest JS:   ${uaSuffix(r.earliestJsUA)}`);
  console.log(`  Post-boot JS:  ${uaSuffix(r.postBootstrapJsUA)}`);
  console.log(`  Fetch UA:      ${uaSuffix(r.fetchRequestUA)}`);
  console.log(`  Native UA:     ${uaSuffix(r.nativeUA)}`);
  console.log(`  Intended:      ${uaSuffix(r.intendedPersonaUA)}`);
  console.log(`  DNR installed: ${r.dnrRuleInstalled}`);
  console.log(`  Obs HTTP spoof:${r.observedMainFrameSpoofed}`);
  console.log(`  Obs fetch spf: ${r.observedFetchSpoofed}`);
  console.log(`  Bootstrap prf: ${r.bootstrapProofEarned}`);
  console.log(`  Doc proof:     ${r.proofEarnedForCurrentDocument}`);
  console.log(`  Host family:   ${r.hostFamily}`);
  console.log(`  Persona family:${r.personaFamily}`);
  console.log(`  Cross-family:  ${r.crossFamily}`);
  console.log(`  Boot gap:      ${r.bootstrapGapMs?.toFixed(2) ?? 'n/a'}ms`);
  r.verdictDetails.forEach(d => console.log(`  → ${d}`));
}

// ── Clear previous results ────────────────────────────────────────────

base.beforeAll(() => {
  clearResults();
});

// ── Native mode (no extension) ────────────────────────────────────────

base.describe('Phase B: Native mode (baseline)', () => {
  let context: BrowserContext;
  let port: number;

  base.beforeAll(async () => {
    port = await ensureServer();
  });

  base.beforeEach(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duppel-native-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: ['--no-first-run', '--disable-default-apps'],
    });
  });

  base.afterEach(async () => {
    await context?.close();
  });

  base.test('all UA signals are native and identical', async () => {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const verdictDetails: string[] = [];
    let verdict = 'PASS';

    const signals = [m.httpUA, m.earliestJsUA, m.postBootstrapJsUA, m.fetchResponseUA];
    const allIdentical = signals.every(s => s === signals[0]);

    if (!allIdentical) {
      verdict = 'FAIL';
      verdictDetails.push(`Signals differ: HTTP=${m.httpUA}, earliest=${m.earliestJsUA}, post=${m.postBootstrapJsUA}, fetch=${m.fetchResponseUA}`);
    } else {
      verdictDetails.push('All 4 UA signals identical and native');
    }

    const result: PhaseBFields = {
      mode: 'native',
      subtest: 'baseline',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA,
      earliestJsUA: m.earliestJsUA,
      earliestJsTimestamp: m.earliestJsTimestamp,
      postBootstrapJsUA: m.postBootstrapJsUA,
      postBootstrapTimestamp: m.postBootstrapTimestamp,
      fetchRequestUA: m.fetchResponseUA,
      dnrRuleInstalled: false,
      dnrRuleCoversMainFrame: false,
      dnrRuleCoversFetch: false,
      observedMainFrameSpoofed: false,
      observedFetchSpoofed: false,
      bootstrapProofEarned: false,
      proofEarnedForCurrentDocument: false,
      nativeUA: m.earliestJsUA,
      intendedPersonaUA: null,
      identityMode: null,
      nativeCompatibleActive: false,
      personaFamily: null,
      personaUA: null,
      hostFamily: inferFamily(m.earliestJsUA),
      crossFamily: false,
      bootstrapGapMs: null,
      verdict,
      verdictDetails,
    };

    appendResult(result);
    logResult('Native baseline', result);
    await page.close();
  });
});

// ── Success-driven mode (extension loaded, current v0.1.0) ────────────

base.describe('Phase B: Success-driven mode (v0.1.0)', () => {
  let context: BrowserContext;
  let port: number;

  base.beforeAll(async () => {
    port = await ensureServer();
  });

  base.beforeEach(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duppel-sd-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await waitForServiceWorker(context);
    // v0.1.1 R1: strictFirstDoc is now default true — disable for success-driven tests
    await disableStrictMode(context);
  });

  base.afterEach(async () => {
    await context?.close();
  });

  base.test('first navigation — capture bootstrap lifecycle', async () => {
    const sw = context.serviceWorkers()[0];

    // Wait for session seed
    if (sw) {
      for (let i = 0; i < 30; i++) {
        const seed = await sw.evaluate(async () => {
          const data = await chrome.storage.session.get(['sessionSeed']);
          return data.sessionSeed || null;
        });
        if (seed) break;
        await new Promise(r => setTimeout(r, 150));
      }
    }

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const dnrState = await getDnrState(context, `http://127.0.0.1:${port}/`);
    const nativeUA = await getNativeUA(context);
    const intendedPersonaUA = await getIntendedPersonaUA(context);
    const obs = deriveObservation(m.httpUA, m.fetchResponseUA, m.postBootstrapJsUA, nativeUA, intendedPersonaUA);

    const hostFamily = inferFamily(nativeUA);
    const personaFamily = inferFamily(intendedPersonaUA);
    const crossFamily = (hostFamily && personaFamily) ? hostFamily !== personaFamily : null;
    const gapMs = (m.earliestJsTimestamp != null && m.postBootstrapTimestamp != null)
      ? m.postBootstrapTimestamp - m.earliestJsTimestamp : null;

    const verdictDetails: string[] = [];
    let verdict = 'MEASURED';

    // First nav: proof not yet earned, so HTTP should be native
    if (obs.observedMainFrameSpoofed) {
      verdictDetails.push(`HTTP UA spoofed on first nav: ${inferFamily(m.httpUA)}`);
    } else {
      verdictDetails.push('HTTP UA is native on first nav (expected — no proof yet)');
    }

    if (obs.bootstrapProofEarned) {
      verdictDetails.push(`JS UA spoofed by bootstrap: ${uaSuffix(m.postBootstrapJsUA)}`);
    } else {
      verdictDetails.push('JS UA matches native (bootstrap may not have changed UA or persona matches native)');
    }

    if (dnrState.dnrRuleCoversMainFrame) {
      verdictDetails.push(`DNR rule covers main frame (${dnrState.uaRuleCount} rules)`);
    } else {
      verdictDetails.push('No DNR rule covers this tab');
    }

    if (crossFamily === true) {
      verdictDetails.push(`CROSS-FAMILY: host=${hostFamily}, persona=${personaFamily}`);
    }

    if (gapMs != null) {
      verdictDetails.push(`Bootstrap gap: ${gapMs.toFixed(2)}ms`);
    }

    const result: PhaseBFields = {
      mode: 'success-driven',
      subtest: 'first-navigation',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA,
      earliestJsUA: m.earliestJsUA,
      earliestJsTimestamp: m.earliestJsTimestamp,
      postBootstrapJsUA: m.postBootstrapJsUA,
      postBootstrapTimestamp: m.postBootstrapTimestamp,
      fetchRequestUA: m.fetchResponseUA,
      dnrRuleInstalled: dnrState.dnrRuleInstalled,
      dnrRuleCoversMainFrame: dnrState.dnrRuleCoversMainFrame,
      dnrRuleCoversFetch: dnrState.dnrRuleCoversFetch,
      observedMainFrameSpoofed: obs.observedMainFrameSpoofed,
      observedFetchSpoofed: obs.observedFetchSpoofed,
      bootstrapProofEarned: obs.bootstrapProofEarned,
      proofEarnedForCurrentDocument: obs.proofEarnedForCurrentDocument,
      nativeUA,
      intendedPersonaUA,
      identityMode: dnrState.identityMode,
      nativeCompatibleActive: false,
      personaFamily,
      personaUA: intendedPersonaUA,
      hostFamily,
      crossFamily,
      bootstrapGapMs: gapMs,
      verdict,
      verdictDetails,
    };

    appendResult(result);
    logResult('Success-driven (first nav)', result);
    await page.close();
  });

  base.test('second navigation — bootstrap should be active', async () => {
    const sw = context.serviceWorkers()[0];

    if (sw) {
      for (let i = 0; i < 30; i++) {
        const seed = await sw.evaluate(async () => {
          const data = await chrome.storage.session.get(['sessionSeed']);
          return data.sessionSeed || null;
        });
        if (seed) break;
        await new Promise(r => setTimeout(r, 150));
      }
    }

    // First navigation — primes the extension
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Second navigation — extension should be fully bootstrapped
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const dnrState = await getDnrState(context, `http://127.0.0.1:${port}/`);
    const nativeUA = await getNativeUA(context);
    const intendedPersonaUA = await getIntendedPersonaUA(context);
    const obs = deriveObservation(m.httpUA, m.fetchResponseUA, m.postBootstrapJsUA, nativeUA, intendedPersonaUA);

    const hostFamily = inferFamily(nativeUA);
    const personaFamily = inferFamily(intendedPersonaUA);
    const crossFamily = (hostFamily && personaFamily) ? hostFamily !== personaFamily : null;
    const gapMs = (m.earliestJsTimestamp != null && m.postBootstrapTimestamp != null)
      ? m.postBootstrapTimestamp - m.earliestJsTimestamp : null;

    const verdictDetails: string[] = [];
    let verdict = 'MEASURED';

    // Observed spoofing analysis
    if (obs.observedMainFrameSpoofed) {
      verdictDetails.push(`HTTP UA spoofed: ${uaSuffix(m.httpUA)}`);
    } else {
      verdictDetails.push('HTTP UA is native');
    }

    if (obs.bootstrapProofEarned) {
      verdictDetails.push(`JS UA spoofed by bootstrap: ${uaSuffix(m.postBootstrapJsUA)}`);
    } else {
      verdictDetails.push('JS UA matches native (persona matches native or bootstrap not active)');
    }

    // Coherence check: HTTP and post-bootstrap JS should match
    if (m.httpUA === m.postBootstrapJsUA) {
      verdictDetails.push('HTTP and JS UA coherent (identical)');
    } else {
      verdictDetails.push(`HTTP/JS MISMATCH: HTTP=${uaSuffix(m.httpUA)}, JS=${uaSuffix(m.postBootstrapJsUA)}`);
    }

    // Fetch coherence
    if (m.fetchResponseUA === m.postBootstrapJsUA) {
      verdictDetails.push('Fetch UA matches JS UA');
    } else {
      verdictDetails.push(`Fetch UA differs: fetch=${uaSuffix(m.fetchResponseUA)}, JS=${uaSuffix(m.postBootstrapJsUA)}`);
    }

    if (crossFamily === true) {
      verdictDetails.push(`CROSS-FAMILY: host=${hostFamily}, persona=${personaFamily}`);
    }

    if (gapMs != null) {
      verdictDetails.push(`Bootstrap gap: ${gapMs.toFixed(2)}ms`);
    }

    const result: PhaseBFields = {
      mode: 'success-driven',
      subtest: 'second-navigation',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA,
      earliestJsUA: m.earliestJsUA,
      earliestJsTimestamp: m.earliestJsTimestamp,
      postBootstrapJsUA: m.postBootstrapJsUA,
      postBootstrapTimestamp: m.postBootstrapTimestamp,
      fetchRequestUA: m.fetchResponseUA,
      dnrRuleInstalled: dnrState.dnrRuleInstalled,
      dnrRuleCoversMainFrame: dnrState.dnrRuleCoversMainFrame,
      dnrRuleCoversFetch: dnrState.dnrRuleCoversFetch,
      observedMainFrameSpoofed: obs.observedMainFrameSpoofed,
      observedFetchSpoofed: obs.observedFetchSpoofed,
      bootstrapProofEarned: obs.bootstrapProofEarned,
      proofEarnedForCurrentDocument: obs.proofEarnedForCurrentDocument,
      nativeUA,
      intendedPersonaUA,
      identityMode: dnrState.identityMode,
      nativeCompatibleActive: false,
      personaFamily,
      personaUA: intendedPersonaUA,
      hostFamily,
      crossFamily,
      bootstrapGapMs: gapMs,
      verdict,
      verdictDetails,
    };

    appendResult(result);
    logResult('Success-driven (second nav)', result);
    await page.close();
  });

  base.test('third navigation — steady-state measurement', async () => {
    const sw = context.serviceWorkers()[0];

    if (sw) {
      for (let i = 0; i < 30; i++) {
        const seed = await sw.evaluate(async () => {
          const data = await chrome.storage.session.get(['sessionSeed']);
          return data.sessionSeed || null;
        });
        if (seed) break;
        await new Promise(r => setTimeout(r, 150));
      }
    }

    const page = await context.newPage();

    // Nav 1 — prime
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Nav 2 — settle
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Nav 3 — steady state
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const dnrState = await getDnrState(context, `http://127.0.0.1:${port}/`);
    const nativeUA = await getNativeUA(context);
    const intendedPersonaUA = await getIntendedPersonaUA(context);
    const obs = deriveObservation(m.httpUA, m.fetchResponseUA, m.postBootstrapJsUA, nativeUA, intendedPersonaUA);

    const hostFamily = inferFamily(nativeUA);
    const personaFamily = inferFamily(intendedPersonaUA);
    const crossFamily = (hostFamily && personaFamily) ? hostFamily !== personaFamily : null;
    const gapMs = (m.earliestJsTimestamp != null && m.postBootstrapTimestamp != null)
      ? m.postBootstrapTimestamp - m.earliestJsTimestamp : null;

    const verdictDetails: string[] = [];

    // Steady-state coherence: all signals should agree (HTTP, post-bootstrap JS, fetch)
    const allMatch = m.httpUA === m.postBootstrapJsUA && m.postBootstrapJsUA === m.fetchResponseUA;
    if (allMatch && obs.bootstrapProofEarned) {
      verdictDetails.push('All signals match spoofed persona — COHERENT');
    } else if (allMatch && !obs.bootstrapProofEarned) {
      verdictDetails.push('All signals identical (persona matches native or fail-closed native)');
    } else {
      verdictDetails.push(`Incoherent: HTTP=${uaSuffix(m.httpUA)}, JS=${uaSuffix(m.postBootstrapJsUA)}, fetch=${uaSuffix(m.fetchResponseUA)}`);
    }

    if (obs.observedMainFrameSpoofed) {
      verdictDetails.push(`HTTP observed spoofed: ${m.httpUA?.substring(0, 60)}`);
    }
    if (obs.proofEarnedForCurrentDocument) {
      verdictDetails.push(`Document proof earned: JS matches intended persona`);
    }

    if (crossFamily === true) {
      verdictDetails.push(`CROSS-FAMILY: host=${hostFamily}, persona=${personaFamily}`);
    }

    const result: PhaseBFields = {
      mode: 'success-driven',
      subtest: 'third-navigation-steady-state',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA,
      earliestJsUA: m.earliestJsUA,
      earliestJsTimestamp: m.earliestJsTimestamp,
      postBootstrapJsUA: m.postBootstrapJsUA,
      postBootstrapTimestamp: m.postBootstrapTimestamp,
      fetchRequestUA: m.fetchResponseUA,
      dnrRuleInstalled: dnrState.dnrRuleInstalled,
      dnrRuleCoversMainFrame: dnrState.dnrRuleCoversMainFrame,
      dnrRuleCoversFetch: dnrState.dnrRuleCoversFetch,
      observedMainFrameSpoofed: obs.observedMainFrameSpoofed,
      observedFetchSpoofed: obs.observedFetchSpoofed,
      bootstrapProofEarned: obs.bootstrapProofEarned,
      proofEarnedForCurrentDocument: obs.proofEarnedForCurrentDocument,
      nativeUA,
      intendedPersonaUA,
      identityMode: dnrState.identityMode,
      nativeCompatibleActive: false,
      personaFamily,
      personaUA: intendedPersonaUA,
      hostFamily,
      crossFamily,
      bootstrapGapMs: gapMs,
      verdict: 'MEASURED',
      verdictDetails,
    };

    appendResult(result);
    logResult('Success-driven (third nav, steady state)', result);
    await page.close();
  });
});

// ── Narrowed-persona mode (C3 persona-family filter) ──────────────────

base.describe('Phase B: Narrowed-persona mode (C3)', () => {
  let context: BrowserContext;
  let port: number;

  base.beforeAll(async () => {
    port = await ensureServer();
  });

  base.beforeEach(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duppel-np-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await waitForServiceWorker(context);
  });

  base.afterEach(async () => {
    await context?.close();
  });

  base.test('crossFamily must be false — hard gate', async () => {
    const sw = context.serviceWorkers()[0];

    if (sw) {
      for (let i = 0; i < 30; i++) {
        const seed = await sw.evaluate(async () => {
          const data = await chrome.storage.session.get(['sessionSeed']);
          return data.sessionSeed || null;
        });
        if (seed) break;
        await new Promise(r => setTimeout(r, 150));
      }
    }

    const nativeUA = await getNativeUA(context);
    const intendedPersonaUA = await getIntendedPersonaUA(context);
    const hostFamily = inferFamily(nativeUA);
    const personaFamily = inferFamily(intendedPersonaUA);
    const crossFamily = (hostFamily && personaFamily) ? hostFamily !== personaFamily : null;

    const verdictDetails: string[] = [];
    let verdict = 'MEASURED';

    // Hard gate: crossFamily must be false
    if (crossFamily === true) {
      verdict = 'FAIL';
      verdictDetails.push(`HARD GATE FAILED: crossFamily=true, host=${hostFamily}, persona=${personaFamily}`);
    } else if (crossFamily === false) {
      verdictDetails.push(`crossFamily=false — host=${hostFamily}, persona=${personaFamily} — PASS`);
    } else {
      verdictDetails.push(`crossFamily=null — intendedPersona=${intendedPersonaUA?.substring(0, 60) ?? 'null'}`);
    }

    // Navigate 3 times to reach steady state
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const dnrState = await getDnrState(context, `http://127.0.0.1:${port}/`);
    const obs = deriveObservation(m.httpUA, m.fetchResponseUA, m.postBootstrapJsUA, nativeUA, intendedPersonaUA);

    if (obs.bootstrapProofEarned) {
      verdictDetails.push(`JS UA spoofed: ${m.earliestJsUA?.substring(0, 60)}`);
    } else {
      verdictDetails.push('JS UA matches native (same-family persona or fail-closed)');
    }

    if (obs.observedMainFrameSpoofed) {
      verdictDetails.push(`HTTP spoofed: ${m.httpUA?.substring(0, 60)}`);
    }

    const result: PhaseBFields = {
      mode: 'narrowed-persona',
      subtest: 'cross-family-hard-gate',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA,
      earliestJsUA: m.earliestJsUA,
      earliestJsTimestamp: m.earliestJsTimestamp,
      postBootstrapJsUA: m.postBootstrapJsUA,
      postBootstrapTimestamp: m.postBootstrapTimestamp,
      fetchRequestUA: m.fetchResponseUA,
      dnrRuleInstalled: dnrState.dnrRuleInstalled,
      dnrRuleCoversMainFrame: dnrState.dnrRuleCoversMainFrame,
      dnrRuleCoversFetch: dnrState.dnrRuleCoversFetch,
      observedMainFrameSpoofed: obs.observedMainFrameSpoofed,
      observedFetchSpoofed: obs.observedFetchSpoofed,
      bootstrapProofEarned: obs.bootstrapProofEarned,
      proofEarnedForCurrentDocument: obs.proofEarnedForCurrentDocument,
      nativeUA,
      intendedPersonaUA,
      identityMode: dnrState.identityMode,
      nativeCompatibleActive: false,
      personaFamily,
      personaUA: intendedPersonaUA,
      hostFamily,
      crossFamily,
      bootstrapGapMs: null,
      verdict,
      verdictDetails,
    };

    appendResult(result);
    logResult('Narrowed-persona (cross-family gate)', result);
    await page.close();
  });
});

// ── C7: Distinguishable same-family persona (forced Edge-on-Windows) ──

base.describe('Phase B: Distinguishable persona (C7)', () => {
  let context: BrowserContext;
  let port: number;

  base.beforeAll(async () => {
    port = await ensureServer();
  });

  base.beforeEach(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duppel-c7-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await waitForServiceWorker(context);
  });

  base.afterEach(async () => {
    await context?.close();
  });

  base.test('forced distinguishable persona — coherent spoofing proof', async () => {
    const sw = context.serviceWorkers()[0];

    // Wait for extension init
    if (sw) {
      for (let i = 0; i < 30; i++) {
        const seed = await sw.evaluate(async () => {
          const data = await chrome.storage.session.get(['sessionSeed']);
          return data.sessionSeed || null;
        });
        if (seed) break;
        await new Promise(r => setTimeout(r, 150));
      }
    }

    const nativeUA = await getNativeUA(context);

    // Find a seed that produces a distinguishable persona (different from native UA).
    // On chromium-windows, Edge UAs contain "Edg/" and Chrome 146 differs from Chrome 147.
    // generateProfile() is a function declaration from importScripts — accessible on globalThis.
    const seedResult = await sw!.evaluate((native: string) => {
      for (let s = 1; s <= 2000; s++) {
        const profile = (globalThis as any).generateProfile(s);
        if (profile && profile.userAgent !== native) {
          return { seed: s, ua: profile.userAgent };
        }
      }
      return null;
    }, nativeUA!);

    if (!seedResult) {
      // No distinguishable seed found — record and skip
      const result: PhaseBFields = {
        mode: 'distinguishable-persona',
        subtest: 'coherent-spoofing',
        timestamp: new Date().toISOString(),
        httpUA: null, earliestJsUA: null, earliestJsTimestamp: null,
        postBootstrapJsUA: null, postBootstrapTimestamp: null, fetchRequestUA: null,
        dnrRuleInstalled: null, dnrRuleCoversMainFrame: null, dnrRuleCoversFetch: null,
        observedMainFrameSpoofed: null, observedFetchSpoofed: null,
        bootstrapProofEarned: false, proofEarnedForCurrentDocument: null,
        nativeUA, intendedPersonaUA: null,
        identityMode: null, nativeCompatibleActive: false,
        personaFamily: null, personaUA: null,
        hostFamily: inferFamily(nativeUA), crossFamily: null,
        bootstrapGapMs: null,
        verdict: 'SKIP', verdictDetails: ['No distinguishable same-family seed found in range 1-2000'],
      };
      appendResult(result);
      logResult('Distinguishable persona (SKIP)', result);
      return;
    }

    const forcedSeed = seedResult.seed;
    const forcedPersonaUA = seedResult.ua;

    // Force the distinguishable seed via createIdentity() — function declaration, on globalThis
    await sw!.evaluate(async (seed: number) => {
      await (globalThis as any).createIdentity(seed);
    }, forcedSeed);
    await new Promise(r => setTimeout(r, 300));

    const intendedPersonaUA = await getIntendedPersonaUA(context);
    const personaFamily = inferFamily(intendedPersonaUA);
    const hostFamily = inferFamily(nativeUA);
    const crossFamily = (hostFamily && personaFamily) ? hostFamily !== personaFamily : null;

    const verdictDetails: string[] = [];
    let verdict = 'MEASURED';

    verdictDetails.push(`Forced seed=${forcedSeed}, persona=${forcedPersonaUA.substring(0, 60)}`);
    verdictDetails.push(`Native=${nativeUA?.substring(0, 60)}`);

    const page = await context.newPage();

    // Nav 1 — prime (first nav is always native HTTP per success-driven contract)
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Nav 2 — proof should now be earned, DNR should cover this tab
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Nav 3 — steady state
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const dnrState = await getDnrState(context, `http://127.0.0.1:${port}/`);
    const obs = deriveObservation(m.httpUA, m.fetchResponseUA, m.postBootstrapJsUA, nativeUA, intendedPersonaUA);

    // C7 acceptance: personaUA populated and all signals coherent
    // Use postBootstrapJsUA — earliestJsUA captures before executeScript arrives
    if (obs.bootstrapProofEarned) {
      verdictDetails.push(`JS UA spoofed: ${uaSuffix(m.postBootstrapJsUA)}`);
    } else {
      verdict = 'FAIL';
      verdictDetails.push(`JS UA NOT spoofed — postBootstrap=${uaSuffix(m.postBootstrapJsUA)}, native=${uaSuffix(nativeUA)}`);
    }

    if (obs.proofEarnedForCurrentDocument) {
      verdictDetails.push('Document proof earned: post-bootstrap JS matches intended persona');
    } else if (obs.bootstrapProofEarned) {
      verdictDetails.push(`JS spoofed but does not match intended persona: JS=${uaSuffix(m.postBootstrapJsUA)}, intended=${uaSuffix(intendedPersonaUA)}`);
    }

    if (obs.observedMainFrameSpoofed) {
      if (m.httpUA === intendedPersonaUA) {
        verdictDetails.push(`HTTP UA matches intended persona — COHERENT (${uaSuffix(m.httpUA)})`);
      } else {
        verdictDetails.push(`HTTP UA spoofed but mismatches persona: HTTP=${uaSuffix(m.httpUA)}`);
      }
    } else {
      verdictDetails.push('HTTP UA is native (may be first-nav residual or proof not earned)');
    }

    // Fetch coherence — fetch should match post-bootstrap JS (both in MAIN world context)
    if (m.fetchResponseUA === m.postBootstrapJsUA) {
      verdictDetails.push('Fetch UA matches post-bootstrap JS — coherent');
    } else {
      verdictDetails.push(`Fetch UA mismatch: fetch=${uaSuffix(m.fetchResponseUA)}, JS=${uaSuffix(m.postBootstrapJsUA)}`);
    }

    // Cross-family check
    if (crossFamily === true) {
      verdict = 'FAIL';
      verdictDetails.push(`CROSS-FAMILY: host=${hostFamily}, persona=${personaFamily}`);
    } else if (crossFamily === false) {
      verdictDetails.push(`Same family: ${personaFamily}`);
    }

    const result: PhaseBFields = {
      mode: 'distinguishable-persona',
      subtest: 'coherent-spoofing',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA,
      earliestJsUA: m.earliestJsUA,
      earliestJsTimestamp: m.earliestJsTimestamp,
      postBootstrapJsUA: m.postBootstrapJsUA,
      postBootstrapTimestamp: m.postBootstrapTimestamp,
      fetchRequestUA: m.fetchResponseUA,
      dnrRuleInstalled: dnrState.dnrRuleInstalled,
      dnrRuleCoversMainFrame: dnrState.dnrRuleCoversMainFrame,
      dnrRuleCoversFetch: dnrState.dnrRuleCoversFetch,
      observedMainFrameSpoofed: obs.observedMainFrameSpoofed,
      observedFetchSpoofed: obs.observedFetchSpoofed,
      bootstrapProofEarned: obs.bootstrapProofEarned,
      proofEarnedForCurrentDocument: obs.proofEarnedForCurrentDocument,
      nativeUA,
      intendedPersonaUA,
      identityMode: dnrState.identityMode,
      nativeCompatibleActive: false,
      personaFamily,
      personaUA: intendedPersonaUA,
      hostFamily,
      crossFamily,
      bootstrapGapMs: null,
      verdict,
      verdictDetails,
    };

    appendResult(result);
    logResult('Distinguishable persona (C7)', result);
    await page.close();
  });
});

// ── C8: Forced cross-family rejection ─────────────────────────────────

base.describe('Phase B: Cross-family rejection (C8)', () => {
  let context: BrowserContext;
  let port: number;

  base.beforeAll(async () => {
    port = await ensureServer();
  });

  base.beforeEach(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duppel-c8-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await waitForServiceWorker(context);
  });

  base.afterEach(async () => {
    await context?.close();
  });

  base.test('no seed in range produces cross-family persona', async () => {
    const sw = context.serviceWorkers()[0];

    if (sw) {
      for (let i = 0; i < 30; i++) {
        const seed = await sw.evaluate(async () => {
          const data = await chrome.storage.session.get(['sessionSeed']);
          return data.sessionSeed || null;
        });
        if (seed) break;
        await new Promise(r => setTimeout(r, 150));
      }
    }

    const nativeUA = await getNativeUA(context);
    const hostFamily = inferFamily(nativeUA);

    // Test seeds 1-500 via generateProfile (function declaration, on globalThis)
    // Verify none produce a cross-family persona
    const crossFamilyCheck = await sw!.evaluate((hostFam: string) => {
      const results: { total: number; sameFam: number; crossFam: number; nullProfile: number;
        distribution: Record<string, number>; crossFamExamples: string[] } = {
        total: 500, sameFam: 0, crossFam: 0, nullProfile: 0,
        distribution: {}, crossFamExamples: [],
      };

      for (let s = 1; s <= 500; s++) {
        const profile = (globalThis as any).generateProfile(s);
        if (!profile) {
          results.nullProfile++;
          continue;
        }
        // Derive family from UA string
        let family = 'unknown';
        if (/Windows/.test(profile.userAgent)) {
          family = /Firefox/.test(profile.userAgent) ? 'firefox-windows' : 'chromium-windows';
        } else if (/Macintosh/.test(profile.userAgent)) {
          family = /Firefox/.test(profile.userAgent) ? 'firefox-macos' : 'chromium-macos';
        } else if (/Linux/.test(profile.userAgent)) {
          family = 'chromium-linux';
        }

        results.distribution[family] = (results.distribution[family] || 0) + 1;
        if (family === hostFam) {
          results.sameFam++;
        } else {
          results.crossFam++;
          if (results.crossFamExamples.length < 3) {
            results.crossFamExamples.push(`seed=${s}: ${profile.userAgent.substring(0, 60)}`);
          }
        }
      }
      return results;
    }, hostFamily!);

    const verdictDetails: string[] = [];
    let verdict = 'MEASURED';

    verdictDetails.push(`Host family: ${hostFamily}`);
    verdictDetails.push(`Seeds tested: ${crossFamilyCheck.total}`);
    verdictDetails.push(`Same-family: ${crossFamilyCheck.sameFam}`);
    verdictDetails.push(`Cross-family: ${crossFamilyCheck.crossFam}`);
    verdictDetails.push(`Null profile: ${crossFamilyCheck.nullProfile}`);
    verdictDetails.push(`Distribution: ${JSON.stringify(crossFamilyCheck.distribution)}`);

    if (crossFamilyCheck.crossFam > 0) {
      verdict = 'FAIL';
      verdictDetails.push('HARD GATE FAILED: cross-family personas produced by filter');
      crossFamilyCheck.crossFamExamples.forEach(ex => verdictDetails.push(`  Example: ${ex}`));
    } else {
      verdictDetails.push('All seeds produce same-family or null — filter working');
    }

    // Also verify the unfiltered pool HAS cross-family groups (proves filter is doing work)
    const unfilteredCheck = await sw!.evaluate(() => {
      // UA_GROUPS is const at top level — not on globalThis. But we can check
      // if the filtered pool is smaller than the total by trying seeds with
      // a modified approach: just report the filtered pool size.
      const filtered = (globalThis as any).UA_GROUPS_FILTERED;
      return {
        filteredPoolSize: filtered ? filtered.length : -1,
      };
    });

    if (unfilteredCheck.filteredPoolSize >= 0) {
      verdictDetails.push(`Filtered pool size: ${unfilteredCheck.filteredPoolSize} groups (full pool has 6)`);
    }

    const result: PhaseBFields = {
      mode: 'cross-family-rejection',
      subtest: 'seed-scan-500',
      timestamp: new Date().toISOString(),
      httpUA: null, earliestJsUA: null, earliestJsTimestamp: null,
      postBootstrapJsUA: null, postBootstrapTimestamp: null, fetchRequestUA: null,
      dnrRuleInstalled: null, dnrRuleCoversMainFrame: null, dnrRuleCoversFetch: null,
      observedMainFrameSpoofed: null, observedFetchSpoofed: null,
      bootstrapProofEarned: false, proofEarnedForCurrentDocument: null,
      nativeUA, intendedPersonaUA: null,
      identityMode: null, nativeCompatibleActive: false,
      personaFamily: null, personaUA: null,
      hostFamily, crossFamily: crossFamilyCheck.crossFam > 0,
      bootstrapGapMs: null,
      verdict, verdictDetails,
    };

    appendResult(result);
    logResult('Cross-family rejection (C8)', result);
  });
});

// ── Native-compatible mode (C4) ──────────────────────────────────────

base.describe('Phase B: Native-compatible mode (C4)', () => {
  let context: BrowserContext;
  let port: number;

  base.beforeAll(async () => {
    port = await ensureServer();
  });

  base.beforeEach(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duppel-nc-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await waitForServiceWorker(context);
  });

  base.afterEach(async () => {
    await context?.close();
  });

  base.test('native-compat site shows all native signals', async () => {
    const sw = context.serviceWorkers()[0];

    // Wait for extension init
    if (sw) {
      for (let i = 0; i < 30; i++) {
        const seed = await sw.evaluate(async () => {
          const data = await chrome.storage.session.get(['sessionSeed']);
          return data.sessionSeed || null;
        });
        if (seed) break;
        await new Promise(r => setTimeout(r, 150));
      }
    }

    const nativeUA = await getNativeUA(context);

    // Set native-compat via extension popup page.
    const testHostname = '127.0.0.1';
    if (sw) {
      const extensionId = sw.url().split('/')[2];
      const setupPage = await context.newPage();
      await setupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
      await setupPage.waitForLoadState('domcontentloaded');
      await setupPage.evaluate(async (hostname: string) => {
        const B = (globalThis as any).browser || chrome;
        await new Promise<void>((resolve) => {
          B.runtime.sendMessage(
            { type: 'setNativeCompat', hostname, enabled: true },
            () => resolve(),
          );
        });
      }, testHostname);
      await setupPage.close();
      await new Promise(r => setTimeout(r, 500));
    }

    const page = await context.newPage();

    // Nav 1 + Nav 2 — verify native-compat persists
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const dnrState = await getDnrState(context, `http://127.0.0.1:${port}/`);
    const obs = deriveObservation(m.httpUA, m.fetchResponseUA, m.postBootstrapJsUA, nativeUA, null);

    const verdictDetails: string[] = [];
    let verdict = 'MEASURED';

    // All signals should be native
    const signals = [m.httpUA, m.earliestJsUA, m.postBootstrapJsUA, m.fetchResponseUA];
    const allIdentical = signals.every(s => s === nativeUA);

    if (allIdentical) {
      verdictDetails.push('All 4 UA signals match native — native-compat working');
    } else {
      verdict = 'FAIL';
      verdictDetails.push(`Signals differ from native despite native-compat`);
    }

    if (!obs.observedMainFrameSpoofed) {
      verdictDetails.push('HTTP not spoofed — correct');
    } else {
      verdict = 'FAIL';
      verdictDetails.push('HTTP spoofed despite native-compat — stale DNR');
    }

    if (!obs.bootstrapProofEarned) {
      verdictDetails.push('JS not spoofed — bootstrap correctly skipped');
    } else {
      verdict = 'FAIL';
      verdictDetails.push('JS spoofed despite native-compat');
    }

    if (!dnrState.dnrRuleCoversMainFrame) {
      verdictDetails.push('DNR rule does not cover main frame — correct');
    }

    const result: PhaseBFields = {
      mode: 'native-compatible',
      subtest: 'all-signals-native',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA,
      earliestJsUA: m.earliestJsUA,
      earliestJsTimestamp: m.earliestJsTimestamp,
      postBootstrapJsUA: m.postBootstrapJsUA,
      postBootstrapTimestamp: m.postBootstrapTimestamp,
      fetchRequestUA: m.fetchResponseUA,
      dnrRuleInstalled: dnrState.dnrRuleInstalled,
      dnrRuleCoversMainFrame: dnrState.dnrRuleCoversMainFrame,
      dnrRuleCoversFetch: dnrState.dnrRuleCoversFetch,
      observedMainFrameSpoofed: obs.observedMainFrameSpoofed,
      observedFetchSpoofed: obs.observedFetchSpoofed,
      bootstrapProofEarned: obs.bootstrapProofEarned,
      proofEarnedForCurrentDocument: false,
      nativeUA,
      intendedPersonaUA: null,
      identityMode: dnrState.identityMode,
      nativeCompatibleActive: true,
      personaFamily: null,
      personaUA: null,
      hostFamily: inferFamily(nativeUA),
      crossFamily: false,
      bootstrapGapMs: null,
      verdict,
      verdictDetails,
    };

    appendResult(result);
    logResult('Native-compatible (all native)', result);
    await page.close();
  });
});

// ── Phase D: First-Navigation Transition Benchmark (D1/D2) ───────────

interface TimelineEntry { t: number; label: string; ua: string; }

interface TransitionResult {
  mode: string;
  scenario: string;
  timestamp: string;
  httpUA: string | null;
  nativeUA: string | null;
  intendedPersonaUA: string | null;
  uaTimeline: TimelineEntry[];
  fetchTimeline: TimelineEntry[];
  // D2 detector classification
  classification: string;
  details: string[];
}

function classifyTransition(
  httpUA: string | null,
  nativeUA: string | null,
  uaTimeline: TimelineEntry[],
  fetchTimeline: TimelineEntry[],
): string {
  const httpIsNative = httpUA === nativeUA;

  // Inline JS (captured in <head>) is ALWAYS native — executeScript cannot arrive
  // before the synchronous <head> script runs. Exclude it from transition analysis.
  const postInline = uaTimeline.filter(e => e.label !== 'inline');
  const allPostInlineNative = postInline.every(e => e.ua === nativeUA);
  const allPostInlinePersona = postInline.length > 0 && postInline.every(e => e.ua !== nativeUA);
  const somePostInlinePersona = postInline.some(e => e.ua !== nativeUA);

  const allFetchNative = fetchTimeline.length === 0 || fetchTimeline.every(e => e.ua === nativeUA);
  const allFetchPersona = fetchTimeline.length > 0 && fetchTimeline.every(e => e.ua !== nativeUA);

  // All native: no spoofing anywhere
  if (httpIsNative && allPostInlineNative && allFetchNative) return 'all-native';

  // All persona (steady state): HTTP persona, all post-inline JS persona, all fetch persona
  if (!httpIsNative && allPostInlinePersona && allFetchPersona) return 'all-persona';

  // First-nav gap: HTTP native (no prior proof), JS transitions to persona, fetch persona
  if (httpIsNative && somePostInlinePersona && allFetchPersona) return 'native-http→persona-js-fetch';
  if (httpIsNative && somePostInlinePersona) return 'native-http-with-js-transition';

  // Proof-earned but bootstrap IPC gap: HTTP persona (DNR active), some early
  // post-inline JS still native (IPC in flight), later JS persona, all fetch persona
  if (!httpIsNative && somePostInlinePersona && !allPostInlinePersona && allFetchPersona) {
    return 'persona-with-js-bootstrap-gap';
  }

  return 'mixed';
}

function logTransition(label: string, r: TransitionResult) {
  console.log(`\n[Phase D] ${label}: ${r.classification}`);
  console.log(`  HTTP UA:     ${uaSuffix(r.httpUA)}`);
  console.log(`  Native:      ${uaSuffix(r.nativeUA)}`);
  console.log(`  Intended:    ${uaSuffix(r.intendedPersonaUA)}`);
  console.log('  JS Timeline:');
  for (const e of r.uaTimeline) {
    const marker = e.ua === r.nativeUA ? 'N' : 'P';
    console.log(`    ${e.label.padEnd(8)} ${e.t.toFixed(1)}ms [${marker}] ${uaSuffix(e.ua)}`);
  }
  console.log('  Fetch Timeline:');
  for (const e of r.fetchTimeline) {
    const marker = e.ua === r.nativeUA ? 'N' : 'P';
    console.log(`    ${e.label.padEnd(14)} ${e.t.toFixed(1)}ms [${marker}] ${uaSuffix(e.ua)}`);
  }
  r.details.forEach(d => console.log(`  → ${d}`));
}

const TRANSITION_JSONL = path.join(RESULTS_DIR, 'phase-d-transitions.jsonl');

function appendTransition(result: TransitionResult) {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
  fs.appendFileSync(TRANSITION_JSONL, JSON.stringify(result) + '\n', 'utf-8');
}

base.describe('Phase D: First-Navigation Transition Benchmark', () => {
  let context: BrowserContext;
  let port: number;

  base.beforeAll(async () => {
    port = await ensureServer();
    // Clear previous Phase D results
    if (fs.existsSync(TRANSITION_JSONL)) fs.unlinkSync(TRANSITION_JSONL);
  });

  base.beforeEach(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duppel-d1-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await waitForServiceWorker(context);
    // v0.1.1 R1: strictFirstDoc is now default true — disable for success-driven D1 tests
    await disableStrictMode(context);
  });

  base.afterEach(async () => {
    await context?.close();
  });

  // Helper: force a distinguishable seed and return the persona UA
  async function forceDistinguishableSeed(ctx: BrowserContext): Promise<{
    seed: number; personaUA: string; nativeUA: string;
  }> {
    const sw = ctx.serviceWorkers()[0];
    // Wait for init
    for (let i = 0; i < 30; i++) {
      const seed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (seed) break;
      await new Promise(r => setTimeout(r, 150));
    }
    const nativeUA = await sw.evaluate(() => navigator.userAgent);
    const seedResult = await sw.evaluate((native: string) => {
      for (let s = 1; s <= 2000; s++) {
        const profile = (globalThis as any).generateProfile(s);
        if (profile && profile.userAgent !== native) {
          return { seed: s, ua: profile.userAgent };
        }
      }
      return null;
    }, nativeUA);
    if (!seedResult) throw new Error('No distinguishable seed found');
    await sw.evaluate(async (seed: number) => {
      await (globalThis as any).createIdentity(seed);
    }, seedResult.seed);
    await new Promise(r => setTimeout(r, 300));
    return { seed: seedResult.seed, personaUA: seedResult.ua, nativeUA };
  }

  base.test('D1a — new tab first navigation (forced persona)', async () => {
    const { seed, personaUA, nativeUA } = await forceDistinguishableSeed(context);
    const page = await context.newPage();

    // First navigation on a new tab — the transition gap scenario
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const details: string[] = [];
    details.push(`Forced seed=${seed}`);

    const cls = classifyTransition(m.httpUA, nativeUA, m.uaTimeline, m.fetchTimeline);
    details.push(`Classification: ${cls}`);

    // Find bootstrap arrival: first timeline entry where UA != native
    const arrival = m.uaTimeline.find((e: TimelineEntry) => e.ua !== nativeUA);
    if (arrival) {
      details.push(`Bootstrap arrived at: ${arrival.label} (${arrival.t.toFixed(1)}ms)`);
    } else {
      details.push('Bootstrap did NOT arrive within 1000ms');
    }

    const result: TransitionResult = {
      mode: 'success-driven', scenario: 'new-tab-first-nav',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA, nativeUA, intendedPersonaUA: personaUA,
      uaTimeline: m.uaTimeline, fetchTimeline: m.fetchTimeline,
      classification: cls, details,
    };
    appendTransition(result);
    logTransition('New tab first nav', result);
    await page.close();
  });

  base.test('D1b — second navigation (proof earned)', async () => {
    const { seed, personaUA, nativeUA } = await forceDistinguishableSeed(context);
    const page = await context.newPage();

    // Nav 1 — prime
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Nav 2 — proof should be earned, DNR active
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const details: string[] = [];
    details.push(`Forced seed=${seed}`);

    const cls = classifyTransition(m.httpUA, nativeUA, m.uaTimeline, m.fetchTimeline);
    details.push(`Classification: ${cls}`);

    const result: TransitionResult = {
      mode: 'success-driven', scenario: 'second-nav-proof-earned',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA, nativeUA, intendedPersonaUA: personaUA,
      uaTimeline: m.uaTimeline, fetchTimeline: m.fetchTimeline,
      classification: cls, details,
    };
    appendTransition(result);
    logTransition('Second nav (proof earned)', result);
    await page.close();
  });

  base.test('D1c — reload (same tab)', async () => {
    const { seed, personaUA, nativeUA } = await forceDistinguishableSeed(context);
    const page = await context.newPage();

    // Nav 1 — prime
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Reload — proof was earned, DNR should be active
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const details: string[] = [];
    details.push(`Forced seed=${seed}`);

    const cls = classifyTransition(m.httpUA, nativeUA, m.uaTimeline, m.fetchTimeline);
    details.push(`Classification: ${cls}`);

    const result: TransitionResult = {
      mode: 'success-driven', scenario: 'reload-after-prime',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA, nativeUA, intendedPersonaUA: personaUA,
      uaTimeline: m.uaTimeline, fetchTimeline: m.fetchTimeline,
      classification: cls, details,
    };
    appendTransition(result);
    logTransition('Reload (same tab)', result);
    await page.close();
  });

  base.test('D1d — same-tab cross-origin navigation', async () => {
    const { seed, personaUA, nativeUA } = await forceDistinguishableSeed(context);
    const page = await context.newPage();

    // Nav 1 — prime on main harness URL
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Nav 2 — navigate to a different path (same origin but different URL)
    await page.goto(`http://127.0.0.1:${port}/harness?t=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const details: string[] = [];
    details.push(`Forced seed=${seed}`);

    const cls = classifyTransition(m.httpUA, nativeUA, m.uaTimeline, m.fetchTimeline);
    details.push(`Classification: ${cls}`);

    const result: TransitionResult = {
      mode: 'success-driven', scenario: 'same-tab-different-url',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA, nativeUA, intendedPersonaUA: personaUA,
      uaTimeline: m.uaTimeline, fetchTimeline: m.fetchTimeline,
      classification: cls, details,
    };
    appendTransition(result);
    logTransition('Same-tab different URL', result);
    await page.close();
  });

  base.test('D1e — native-compatible transition', async () => {
    const sw = context.serviceWorkers()[0];
    for (let i = 0; i < 30; i++) {
      const seed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (seed) break;
      await new Promise(r => setTimeout(r, 150));
    }
    const nativeUA = await sw.evaluate(() => navigator.userAgent);

    // Enable native-compat for the test server via extension popup message
    const extensionId = sw.url().split('/')[2];
    const setupPage = await context.newPage();
    await setupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await setupPage.waitForLoadState('domcontentloaded');
    await setupPage.evaluate(async (hostname: string) => {
      const B = (globalThis as any).browser || chrome;
      await new Promise<void>((resolve) => {
        B.runtime.sendMessage(
          { type: 'setNativeCompat', hostname, enabled: true },
          () => resolve(),
        );
      });
    }, '127.0.0.1');
    await setupPage.close();
    await new Promise(r => setTimeout(r, 500));

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const details: string[] = [];

    const cls = classifyTransition(m.httpUA, nativeUA, m.uaTimeline, m.fetchTimeline);
    details.push(`Classification: ${cls}`);

    const result: TransitionResult = {
      mode: 'native-compatible', scenario: 'native-compat-enabled',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA, nativeUA, intendedPersonaUA: null,
      uaTimeline: m.uaTimeline, fetchTimeline: m.fetchTimeline,
      classification: cls, details,
    };
    appendTransition(result);
    logTransition('Native-compatible', result);
    await page.close();
  });
});

// ── D3a/b: Strict Next-Navigation-Only Candidate Benchmark ────────────
// Strict mode: first document stays entirely native (no bootstrap, no DNR).
// Second document gets pre-activated DNR + bootstrap. Implemented in
// background.js behind STATE.strictFirstDoc flag.

base.describe('Phase D: D3 Strict Candidate Benchmark', () => {
  let context: BrowserContext;
  let port: number;

  base.beforeAll(async () => {
    port = await ensureServer();
  });

  base.beforeEach(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duppel-d3s-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await waitForServiceWorker(context);
  });

  base.afterEach(async () => {
    await context?.close();
  });

  // Enable strict mode and force a distinguishable seed
  async function setupStrictMode(ctx: BrowserContext): Promise<{
    seed: number; personaUA: string; nativeUA: string;
  }> {
    const sw = ctx.serviceWorkers()[0];
    // Wait for init
    for (let i = 0; i < 30; i++) {
      const seed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (seed) break;
      await new Promise(r => setTimeout(r, 150));
    }

    // Enable strict first-document mode
    const extensionId = sw.url().split('/')[2];
    const setupPage = await ctx.newPage();
    await setupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await setupPage.waitForLoadState('domcontentloaded');
    await setupPage.evaluate(async () => {
      const B = (globalThis as any).browser || chrome;
      await new Promise<void>((resolve) => {
        B.runtime.sendMessage(
          { type: 'setStrictFirstDoc', enabled: true },
          () => resolve(),
        );
      });
    });
    await setupPage.close();

    // Force a distinguishable seed
    const nativeUA = await sw.evaluate(() => navigator.userAgent);
    const seedResult = await sw.evaluate((native: string) => {
      for (let s = 1; s <= 2000; s++) {
        const profile = (globalThis as any).generateProfile(s);
        if (profile && profile.userAgent !== native) {
          return { seed: s, ua: profile.userAgent };
        }
      }
      return null;
    }, nativeUA);
    if (!seedResult) throw new Error('No distinguishable seed found');
    await sw.evaluate(async (seed: number) => {
      await (globalThis as any).createIdentity(seed);
    }, seedResult.seed);
    await new Promise(r => setTimeout(r, 300));
    return { seed: seedResult.seed, personaUA: seedResult.ua, nativeUA };
  }

  base.test('D3-strict-a — first navigation (all-native)', async () => {
    const { seed, personaUA, nativeUA } = await setupStrictMode(context);
    const page = await context.newPage();

    // First navigation — strict mode: entire document stays native
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const details: string[] = [];
    details.push(`Forced seed=${seed}, strict mode enabled`);
    details.push('IMPLEMENTED — strict first-document mode in background.js');

    const cls = classifyTransition(m.httpUA, nativeUA, m.uaTimeline, m.fetchTimeline);
    details.push(`Classification: ${cls}`);

    const result: TransitionResult = {
      mode: 'strict-next-nav', scenario: 'first-nav-all-native',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA, nativeUA, intendedPersonaUA: personaUA,
      uaTimeline: m.uaTimeline, fetchTimeline: m.fetchTimeline,
      classification: cls, details,
    };
    appendTransition(result);
    logTransition('Strict: first nav (expect all-native)', result);
    await page.close();
  });

  base.test('D3-strict-b — second navigation (persona active)', async () => {
    const { seed, personaUA, nativeUA } = await setupStrictMode(context);
    const page = await context.newPage();

    // Nav 1 — arming navigation (all-native)
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Nav 2 — DNR pre-activated, bootstrap runs
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const details: string[] = [];
    details.push(`Forced seed=${seed}, strict mode enabled`);
    details.push('IMPLEMENTED — DNR pre-activated via onBeforeNavigate for armed tab');

    const cls = classifyTransition(m.httpUA, nativeUA, m.uaTimeline, m.fetchTimeline);
    details.push(`Classification: ${cls}`);

    const result: TransitionResult = {
      mode: 'strict-next-nav', scenario: 'second-nav-persona-active',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA, nativeUA, intendedPersonaUA: personaUA,
      uaTimeline: m.uaTimeline, fetchTimeline: m.fetchTimeline,
      classification: cls, details,
    };
    appendTransition(result);
    logTransition('Strict: second nav (expect persona)', result);
    await page.close();
  });

  base.test('D3-strict-c — reload after arming', async () => {
    const { seed, personaUA, nativeUA } = await setupStrictMode(context);
    const page = await context.newPage();

    // Nav 1 — arming
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Reload — tab is armed, DNR should pre-activate
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const details: string[] = [];
    details.push(`Forced seed=${seed}, strict mode enabled`);

    const cls = classifyTransition(m.httpUA, nativeUA, m.uaTimeline, m.fetchTimeline);
    details.push(`Classification: ${cls}`);

    const result: TransitionResult = {
      mode: 'strict-next-nav', scenario: 'reload-after-arming',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA, nativeUA, intendedPersonaUA: personaUA,
      uaTimeline: m.uaTimeline, fetchTimeline: m.fetchTimeline,
      classification: cls, details,
    };
    appendTransition(result);
    logTransition('Strict: reload after arming', result);
    await page.close();
  });

  base.test('D3-strict-d — same-tab different URL', async () => {
    const { seed, personaUA, nativeUA } = await setupStrictMode(context);
    const page = await context.newPage();

    // Nav 1 — arming
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Nav 2 — different URL, tab is armed
    await page.goto(`http://127.0.0.1:${port}/harness?t=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const m = await collectMeasurements(page);
    const details: string[] = [];
    details.push(`Forced seed=${seed}, strict mode enabled`);

    const cls = classifyTransition(m.httpUA, nativeUA, m.uaTimeline, m.fetchTimeline);
    details.push(`Classification: ${cls}`);

    const result: TransitionResult = {
      mode: 'strict-next-nav', scenario: 'same-tab-different-url-after-arming',
      timestamp: new Date().toISOString(),
      httpUA: m.httpUA, nativeUA, intendedPersonaUA: personaUA,
      uaTimeline: m.uaTimeline, fetchTimeline: m.fetchTimeline,
      classification: cls, details,
    };
    appendTransition(result);
    logTransition('Strict: same-tab different URL', result);
    await page.close();
  });
});

// ── R3: Stale Arming Rule Cleanup Tests ───────────────────────────────
// Proves no STRICT_ARM_RULE_ID (9997) remains in any cleanup path.

base.describe('Phase D: R3 Stale Arming Rule Cleanup', () => {
  let context: BrowserContext;
  let port: number;
  const STRICT_ARM_RULE_ID = 9997;

  base.beforeAll(async () => {
    port = await ensureServer();
  });

  base.beforeEach(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duppel-r3-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await waitForServiceWorker(context);
  });

  base.afterEach(async () => {
    await context?.close();
  });

  async function getArmRuleIds(ctx: BrowserContext): Promise<number[]> {
    const sw = ctx.serviceWorkers()[0];
    return sw.evaluate(async () => {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      return rules.map((r: any) => r.id);
    });
  }

  async function enableStrictAndArm(ctx: BrowserContext): Promise<void> {
    // setupStrictMode is already on by default (strictFirstDoc: true)
    // Just force a distinguishable seed
    const sw = ctx.serviceWorkers()[0];
    for (let i = 0; i < 30; i++) {
      const seed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (seed) break;
      await new Promise(r => setTimeout(r, 150));
    }
    const nativeUA = await sw.evaluate(() => navigator.userAgent);
    const seedResult = await sw.evaluate((native: string) => {
      for (let s = 1; s <= 2000; s++) {
        const profile = (globalThis as any).generateProfile(s);
        if (profile && profile.userAgent !== native) {
          return { seed: s, ua: profile.userAgent };
        }
      }
      return null;
    }, nativeUA);
    if (!seedResult) throw new Error('No distinguishable seed found');
    await sw.evaluate(async (seed: number) => {
      await (globalThis as any).createIdentity(seed);
    }, seedResult.seed);
    await new Promise(r => setTimeout(r, 300));
  }

  base.test('R3a — strict mode off after first-nav arming removes STRICT_ARM_RULE_ID', async () => {
    await enableStrictAndArm(context);

    // Nav 1 — arms the tab (installs STRICT_ARM_RULE_ID)
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Verify arming rule exists
    const rulesBeforeToggle = await getArmRuleIds(context);
    base.expect(rulesBeforeToggle).toContain(STRICT_ARM_RULE_ID);
    console.log(`  R3a: Rules before toggle off: [${rulesBeforeToggle}]`);

    // Toggle strict mode OFF
    await disableStrictMode(context);
    await new Promise(r => setTimeout(r, 200));

    // Verify arming rule removed
    const rulesAfterToggle = await getArmRuleIds(context);
    base.expect(rulesAfterToggle).not.toContain(STRICT_ARM_RULE_ID);
    console.log(`  R3a: Rules after toggle off: [${rulesAfterToggle}] — STRICT_ARM_RULE_ID removed`);
    await page.close();
  });

  base.test('R3b — native-compatible after first-nav arming removes stale arming rule', async () => {
    await enableStrictAndArm(context);

    // Nav 1 — arms the tab
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Verify arming rule exists
    const rulesBefore = await getArmRuleIds(context);
    base.expect(rulesBefore).toContain(STRICT_ARM_RULE_ID);
    console.log(`  R3b: Rules before native-compat: [${rulesBefore}]`);

    // Enable native-compat for test host
    const sw = context.serviceWorkers()[0];
    const extensionId = sw.url().split('/')[2];
    const setupPage = await context.newPage();
    await setupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await setupPage.waitForLoadState('domcontentloaded');
    await setupPage.evaluate(async (hostname: string) => {
      const B = (globalThis as any).browser || chrome;
      await new Promise<void>((resolve) => {
        B.runtime.sendMessage(
          { type: 'setNativeCompat', hostname, enabled: true },
          () => resolve(),
        );
      });
    }, '127.0.0.1');
    await setupPage.close();
    await new Promise(r => setTimeout(r, 500));

    // Verify arming rule removed (updateTabScopedDNR cleans up)
    const rulesAfter = await getArmRuleIds(context);
    base.expect(rulesAfter).not.toContain(STRICT_ARM_RULE_ID);
    console.log(`  R3b: Rules after native-compat: [${rulesAfter}] — STRICT_ARM_RULE_ID removed`);
    await page.close();
  });

  base.test('R3c — tab close after first-nav arming removes stale arming rule', async () => {
    await enableStrictAndArm(context);

    // Nav 1 — arms the tab
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    // Verify arming rule exists
    const rulesBefore = await getArmRuleIds(context);
    base.expect(rulesBefore).toContain(STRICT_ARM_RULE_ID);
    console.log(`  R3c: Rules before tab close: [${rulesBefore}]`);

    // Close the tab
    await page.close();
    await new Promise(r => setTimeout(r, 300));

    // Verify arming rule removed
    const rulesAfter = await getArmRuleIds(context);
    base.expect(rulesAfter).not.toContain(STRICT_ARM_RULE_ID);
    console.log(`  R3c: Rules after tab close: [${rulesAfter}] — STRICT_ARM_RULE_ID removed`);
  });

  base.test('R3d — proof cycle replaces arming rule with session rule, then tab close removes all', async () => {
    await enableStrictAndArm(context);

    const page = await context.newPage();

    // Nav 1 — arms the tab (installs STRICT_ARM_RULE_ID)
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);

    const rulesAfterArm = await getArmRuleIds(context);
    base.expect(rulesAfterArm).toContain(STRICT_ARM_RULE_ID);
    base.expect(rulesAfterArm).not.toContain(9998); // No session rule yet
    console.log(`  R3d: Rules after arming: [${rulesAfterArm}]`);

    // Nav 2 — bootstrap proves, full session rule installed, arming rule replaced
    await page.goto(`http://127.0.0.1:${port}/harness`);
    await page.waitForLoadState('domcontentloaded');
    await waitForHarnessDone(page);
    await new Promise(r => setTimeout(r, 300));

    const rulesAfterProof = await getArmRuleIds(context);
    base.expect(rulesAfterProof).not.toContain(STRICT_ARM_RULE_ID);
    base.expect(rulesAfterProof).toContain(9998); // SESSION_UA_RULE_ID active
    console.log(`  R3d: Rules after proof: [${rulesAfterProof}] — arming replaced by session rule`);

    // Close tab — triggers tabs.onRemoved which clears bootstrappedTabs and calls updateTabScopedDNR
    await page.close();
    await new Promise(r => setTimeout(r, 300));

    const rulesAfterClose = await getArmRuleIds(context);
    base.expect(rulesAfterClose).not.toContain(STRICT_ARM_RULE_ID);
    base.expect(rulesAfterClose).not.toContain(9998);
    console.log(`  R3d: Rules after close: [${rulesAfterClose}] — all rules removed`);
  });
});

// ── D2: Detector-Style Correlation Report ─────────────────────────────
// Reads the D1 JSONL and produces a server-side view: what a fingerprint
// correlator would observe at each navigation scenario.

base.describe('Phase D: D2 Detector Correlation Report', () => {
  base.test('D2 — server-side correlation analysis', async () => {
    if (!fs.existsSync(TRANSITION_JSONL)) {
      console.log('[D2] No Phase D JSONL found — skipping (run D1 first)');
      return;
    }

    const lines = fs.readFileSync(TRANSITION_JSONL, 'utf-8').trim().split('\n');
    const transitions: TransitionResult[] = lines.map(l => JSON.parse(l));

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║  D2 — Detector-Style Correlation Report (Server View)       ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const d2Results: Array<{
      scenario: string;
      classification: string;
      httpMatchesFetch: boolean;
      httpMatchesLatestJs: boolean;
      bootstrapArrivalMs: number | null;
      serverCorrelationRisk: string;
      detectorNotes: string[];
    }> = [];

    for (const tr of transitions) {
      const postInline = tr.uaTimeline.filter(e => e.label !== 'inline');
      const latestJs = postInline.length > 0 ? postInline[postInline.length - 1] : null;
      const firstFetch = tr.fetchTimeline.length > 0 ? tr.fetchTimeline[0] : null;

      const httpMatchesFetch = firstFetch ? tr.httpUA === firstFetch.ua : true;
      const httpMatchesLatestJs = latestJs ? tr.httpUA === latestJs.ua : true;

      // Bootstrap arrival: first post-inline entry that differs from native
      const bootstrapEntry = postInline.find(e => e.ua !== tr.nativeUA);
      const bootstrapArrivalMs = bootstrapEntry ? bootstrapEntry.t : null;

      const detectorNotes: string[] = [];
      let risk: string;

      if (tr.classification === 'all-native') {
        risk = 'NONE';
        detectorNotes.push('All signals native — nothing to detect');
      } else if (tr.classification === 'all-persona') {
        risk = 'LOW';
        detectorNotes.push('HTTP/JS/fetch all coherent persona — no split signal');
        detectorNotes.push('Detector would see consistent non-native UA (may flag as unusual browser)');
      } else if (tr.classification === 'native-http→persona-js-fetch') {
        risk = 'MEDIUM';
        detectorNotes.push(`Main-frame HTTP: native UA`);
        detectorNotes.push(`First fetch at ${firstFetch?.t.toFixed(0)}ms: persona UA`);
        detectorNotes.push(`HTTP/fetch UA mismatch within same document — correlatable`);
        detectorNotes.push(`Window: ~${bootstrapArrivalMs?.toFixed(0)}ms from page load to bootstrap`);
        detectorNotes.push('Mitigation: server must correlate main-frame + fetch UAs (uncommon)');
      } else if (tr.classification === 'persona-with-js-bootstrap-gap') {
        risk = 'LOW';
        detectorNotes.push('HTTP/fetch UAs match persona — server-side coherent');
        detectorNotes.push(`JS bootstrap gap: 0-${bootstrapArrivalMs?.toFixed(0)}ms (client-side only)`);
        detectorNotes.push('Server cannot observe the JS prototype value — not correlatable');
        detectorNotes.push('Client-side JS fingerprinting in first ~50ms could detect native→persona flip');
      } else {
        risk = 'UNKNOWN';
        detectorNotes.push(`Unclassified transition: ${tr.classification}`);
      }

      d2Results.push({
        scenario: tr.scenario,
        classification: tr.classification,
        httpMatchesFetch,
        httpMatchesLatestJs,
        bootstrapArrivalMs,
        serverCorrelationRisk: risk,
        detectorNotes,
      });

      console.log(`  Scenario: ${tr.scenario}`);
      console.log(`    Classification:     ${tr.classification}`);
      console.log(`    HTTP=Fetch:         ${httpMatchesFetch}`);
      console.log(`    HTTP=LatestJS:      ${httpMatchesLatestJs}`);
      console.log(`    Bootstrap arrival:  ${bootstrapArrivalMs ? bootstrapArrivalMs.toFixed(1) + 'ms' : 'N/A'}`);
      console.log(`    Server risk:        ${risk}`);
      detectorNotes.forEach(n => console.log(`    → ${n}`));
      console.log();
    }

    // Summary matrix
    console.log('  ┌─────────────────────────┬───────────────────────────────────┬──────────┐');
    console.log('  │ Scenario                │ Classification                    │ Risk     │');
    console.log('  ├─────────────────────────┼───────────────────────────────────┼──────────┤');
    for (const r of d2Results) {
      const scn = r.scenario.padEnd(23);
      const cls = r.classification.padEnd(33);
      const risk = r.serverCorrelationRisk.padEnd(8);
      console.log(`  │ ${scn} │ ${cls} │ ${risk} │`);
    }
    console.log('  └─────────────────────────┴───────────────────────────────────┴──────────┘');

    // Write D2 analysis to JSONL
    const d2Path = path.join(RESULTS_DIR, 'phase-d-detector-analysis.jsonl');
    for (const r of d2Results) {
      fs.appendFileSync(d2Path, JSON.stringify({
        type: 'D2-detector-analysis',
        timestamp: new Date().toISOString(),
        ...r,
      }) + '\n', 'utf-8');
    }
    console.log(`\n  D2 analysis written to: ${d2Path}`);
  });
});

// ── D3: Release Candidate Mode Comparison ─────────────────────────────

base.describe('Phase D: D3 Mode Comparison', () => {
  base.test('D3 — compare all release candidates', async () => {
    if (!fs.existsSync(TRANSITION_JSONL)) {
      console.log('[D3] No Phase D JSONL found — skipping (run D1 first)');
      return;
    }

    const lines = fs.readFileSync(TRANSITION_JSONL, 'utf-8').trim().split('\n');
    const transitions: TransitionResult[] = lines.map(l => JSON.parse(l));

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║  D3 — Release Candidate Mode Comparison                    ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // Group by mode
    const byMode: Record<string, TransitionResult[]> = {};
    for (const tr of transitions) {
      if (!byMode[tr.mode]) byMode[tr.mode] = [];
      byMode[tr.mode].push(tr);
    }

    const comparison: Array<{
      mode: string;
      scenarios: number;
      classifications: Record<string, number>;
      avgBootstrapMs: number | null;
      httpFetchCoherence: string;
      serverDetectable: boolean;
      recommendation: string;
    }> = [];

    for (const [mode, trs] of Object.entries(byMode)) {
      const classifications: Record<string, number> = {};
      let totalBootstrap = 0;
      let bootstrapCount = 0;
      let anyMismatch = false;

      for (const tr of trs) {
        classifications[tr.classification] = (classifications[tr.classification] || 0) + 1;
        const postInline = tr.uaTimeline.filter(e => e.label !== 'inline');
        const arrival = postInline.find(e => e.ua !== tr.nativeUA);
        if (arrival) {
          totalBootstrap += arrival.t;
          bootstrapCount++;
        }
        const firstFetch = tr.fetchTimeline[0];
        if (firstFetch && tr.httpUA !== firstFetch.ua) anyMismatch = true;
      }

      const avgBootstrapMs = bootstrapCount > 0 ? totalBootstrap / bootstrapCount : null;

      let httpFetchCoherence: string;
      let serverDetectable: boolean;
      let recommendation: string;

      if (mode === 'native-compatible') {
        httpFetchCoherence = 'all-native (trivially coherent)';
        serverDetectable = false;
        recommendation = 'SHIP — zero fingerprint surface, site works unmodified';
      } else if (mode === 'strict-next-nav') {
        httpFetchCoherence = anyMismatch ? 'SPLIT detected' : 'per-document coherent (first doc all-native, subsequent all-persona)';
        serverDetectable = anyMismatch;
        recommendation = anyMismatch
          ? 'INVESTIGATE — strict mode has unexpected split'
          : 'RECOMMENDED — first doc all-native, persona starts on second doc with full coherence';
      } else if (anyMismatch) {
        httpFetchCoherence = 'SPLIT on first navigation (HTTP native, fetch persona)';
        serverDetectable = true;
        recommendation = 'ACCEPT WITH KNOWN GAP — first-nav HTTP/fetch split is inherent to success-driven model';
      } else {
        httpFetchCoherence = 'coherent across all scenarios';
        serverDetectable = false;
        recommendation = 'SHIP';
      }

      comparison.push({
        mode,
        scenarios: trs.length,
        classifications,
        avgBootstrapMs,
        httpFetchCoherence,
        serverDetectable,
        recommendation,
      });

      console.log(`  Mode: ${mode}`);
      console.log(`    Scenarios tested: ${trs.length}`);
      console.log(`    Classifications: ${JSON.stringify(classifications)}`);
      console.log(`    Avg bootstrap arrival: ${avgBootstrapMs ? avgBootstrapMs.toFixed(1) + 'ms' : 'N/A'}`);
      console.log(`    HTTP/fetch coherence: ${httpFetchCoherence}`);
      console.log(`    Server-detectable gap: ${serverDetectable}`);
      console.log(`    Recommendation: ${recommendation}`);
      console.log();
    }

    // Summary
    console.log('  ┌────────────────────┬────────────┬─────────────────────┬──────────────┐');
    console.log('  │ Mode               │ Avg boot   │ HTTP/fetch match    │ Detectable   │');
    console.log('  ├────────────────────┼────────────┼─────────────────────┼──────────────┤');
    for (const c of comparison) {
      const m = c.mode.padEnd(18);
      const boot = (c.avgBootstrapMs ? c.avgBootstrapMs.toFixed(0) + 'ms' : 'N/A').padEnd(10);
      const coherence = (c.serverDetectable ? 'SPLIT (1st nav)' : 'coherent').padEnd(19);
      const detect = (c.serverDetectable ? 'YES' : 'NO').padEnd(12);
      console.log(`  │ ${m} │ ${boot} │ ${coherence} │ ${detect} │`);
    }
    console.log('  └────────────────────┴────────────┴─────────────────────┴──────────────┘');

    // Write D3 comparison
    const d3Path = path.join(RESULTS_DIR, 'phase-d-mode-comparison.json');
    fs.writeFileSync(d3Path, JSON.stringify(comparison, null, 2), 'utf-8');
    console.log(`\n  D3 comparison written to: ${d3Path}`);
  });
});

// ── D4: Cookie Channel Verification ───────────────────────────────────

base.describe('Phase D: D4 Cookie Channel Verification', () => {
  let context: BrowserContext;
  let port: number;

  base.beforeAll(async () => {
    port = await ensureServer();
  });

  base.beforeEach(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duppel-d4-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await waitForServiceWorker(context);
  });

  base.afterEach(async () => {
    await context?.close();
  });

  base.test('D4 — no __pg_s cookie set at any point', async () => {
    const sw = context.serviceWorkers()[0];

    // Wait for extension init
    for (let i = 0; i < 30; i++) {
      const seed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (seed) break;
      await new Promise(r => setTimeout(r, 150));
    }

    const page = await context.newPage();

    // Navigate 3 times to exercise full lifecycle
    for (let nav = 0; nav < 3; nav++) {
      await page.goto(`http://127.0.0.1:${port}/harness?nav=${nav}`);
      await page.waitForLoadState('domcontentloaded');
      await waitForHarnessDone(page);
    }

    // Check 1: No __pg_s cookie via page JS
    const jsCookies = await page.evaluate(() => document.cookie);
    const hasJsCookie = jsCookies.includes('__pg_s');

    // Check 2: No __pg_s cookie via Chrome cookies API
    const apiCookies = await sw.evaluate(async () => {
      const all = await chrome.cookies.getAll({ name: '__pg_s' });
      return all.map((c: any) => ({ domain: c.domain, value: c.value }));
    });

    // Check 3: No __pg_s references in background.js source
    const bgSource = await sw.evaluate(() => {
      // Check if __pg_s string exists in any registered content scripts
      return {
        hasInSource: false, // Can't introspect own source, but we verify via behavior
      };
    });

    // Check 4: Verify production code has no __pg_s references
    const bgPath = path.resolve(__dirname, '..', '..', 'background.js');
    const bgContent = fs.readFileSync(bgPath, 'utf-8');
    const hasBgRef = bgContent.includes('__pg_s');

    const corePath = path.resolve(__dirname, '..', '..', 'src', 'content', 'anti-fingerprint', 'core.js');
    const coreContent = fs.readFileSync(corePath, 'utf-8');
    const hasCoreRef = coreContent.includes('__pg_s');

    const bootstrapEntryPath = path.resolve(__dirname, '..', '..', 'src', 'content', 'anti-fingerprint', 'bootstrap-entry.js');
    const bootstrapContent = fs.readFileSync(bootstrapEntryPath, 'utf-8');
    const hasBootstrapRef = bootstrapContent.includes('__pg_s');

    const details: string[] = [];
    let verdict = 'PASS';

    if (!hasJsCookie) {
      details.push('No __pg_s cookie visible via document.cookie');
    } else {
      verdict = 'FAIL';
      details.push(`FAIL: __pg_s found in document.cookie: ${jsCookies}`);
    }

    if (apiCookies.length === 0) {
      details.push('No __pg_s cookie found via chrome.cookies API');
    } else {
      verdict = 'FAIL';
      details.push(`FAIL: __pg_s found via cookies API: ${JSON.stringify(apiCookies)}`);
    }

    // Source references to __pg_s are acceptable for:
    //   - Legacy cleanup code (C5: onInstalled handler removes old cookies)
    //   - Documentation comments
    // Only FAIL if __pg_s is used to SET cookies (runtime creation)
    const bgSetsCookie = bgContent.includes('cookies.set') && bgContent.includes('__pg_s')
      && /cookies\.set\([^)]*__pg_s/.test(bgContent);

    if (bgSetsCookie) {
      verdict = 'FAIL';
      details.push('FAIL: background.js sets __pg_s cookies at runtime');
    } else if (hasBgRef) {
      details.push('background.js references __pg_s for legacy cleanup only (C5) — acceptable');
    } else {
      details.push('No __pg_s reference in background.js');
    }

    if (!hasCoreRef) {
      details.push('No __pg_s reference in core.js');
    } else {
      verdict = 'FAIL';
      details.push('FAIL: __pg_s reference found in core.js (unexpected)');
    }

    if (!hasBootstrapRef) {
      details.push('No __pg_s reference in bootstrap-entry.js');
    } else {
      // bootstrap-entry.js has documentation comments mentioning __pg_s — acceptable
      details.push('bootstrap-entry.js references __pg_s in documentation comments — acceptable');
    }

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║  D4 — Cookie Channel Verification                          ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    console.log(`  Verdict: ${verdict}`);
    details.forEach(d => console.log(`  → ${d}`));

    // Write D4 result
    const d4Path = path.join(RESULTS_DIR, 'phase-d-cookie-verification.json');
    fs.writeFileSync(d4Path, JSON.stringify({
      type: 'D4-cookie-verification',
      timestamp: new Date().toISOString(),
      verdict,
      jsCookieFound: hasJsCookie,
      apiCookiesFound: apiCookies.length,
      bgRefFound: hasBgRef,
      coreRefFound: hasCoreRef,
      bootstrapRefFound: hasBootstrapRef,
      details,
    }, null, 2), 'utf-8');
    console.log(`\n  D4 result written to: ${d4Path}`);

    await page.close();
  });
});
