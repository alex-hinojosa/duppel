/**
 * Duppel — Background Service Worker
 * Manages identity rotation, cookie cleanup, tracker monitoring,
 * and fake beacon generation.
 */

importScripts("profiles.js", "poisoner.js", "anti-fingerprint-bootstrap.js");

// === Storage Architecture (v2 Item 1, Round 6: closure-local bootstrap) ===
// Two storage layers serve different lifetimes:
//
// 1. chrome.storage.session — Extension-session scoped.
//    Survives SW restart within a browser session. Dies on browser quit.
//    Stores: profile, sessionSeed, tabSeeds, enabled, siteOverrides, chaosLevel.
//    This is NOT the same as web sessionStorage.
//
// 2. chrome.storage.local — Persistent across browser restarts.
//    Stores: stats, chaosLevel, identityMode.
//    identityMode persists so the user's preference survives browser restarts.
//
// Seed delivery (Round 6 — closure-local, zero window rendezvous):
//    chrome.scripting.executeScript({ func: bootstrapAntiFingerprint, args: [seed] })
//    injects the entire anti-fingerprint bundle as a closure-local function.
//    The seed is a function parameter — never written to window, cookies, or
//    sessionStorage. No content script in manifest for anti-fingerprinting.
//    No deferred setter trap. No dead setter. No convergence events.
//    Idempotence tracked extension-side via tabId/documentId.
//
// Strict bootstrap contract (Round 10 — success-driven DNR):
//    HTTP UA spoofing (session-scoped DNR with condition.tabIds) applies
//    ONLY for tabs with verified MAIN-world bootstrap for the current document.
//    Proof lifecycle:
//    - Tab enters DNR only after executeScript .then() confirms (never before).
//    - On navigation/reload: proof cleared via onBeforeNavigate + tabs.onUpdated.
//      Tab removed from DNR until new document's bootstrap succeeds.
//    - On rotate/mode-switch: bootstrappedTabs cleared, DNR cleared before reload.
//      Tabs re-verify via executeScript on reload.
//    - On SW wake: bootstrappedTabs NOT rebuilt from tabSeeds. Instead, tabs
//      are re-bootstrapped via executeScript and re-earn DNR eligibility.
//    - On injection failure: tabSeed AND proof removed (no false inference).
//    First-navigation residual (documented per rowan Gate 3):
//    main_frame request may race with DNR update from onBeforeNavigate.
//    JS UA is native until executeScript completes. From first subresource
//    after bootstrap: both JS and HTTP are coherent.
//
//    Round 8: mode-transition safety. When switching from per-tab mode
//    (which uses global dynamic rule UA_RULE_ID=9999) back to session mode,
//    the stale global rule is explicitly removed. updateTabScopedDNR()
//    defensively clears it in session mode. Only per-tab mode may install
//    the global dynamic UA rule.
//
// Identity lifetime (session mode, the default):
//   One identity per browser session, rotating every 24h (alarm-based).
//   On browser restart, chrome.storage.session is empty → restoreState() finds
//   no profile → calls rotateIdentity() → fresh identity + new UA rule.
//   The 24h alarm also rotates within a running session.

// === State ===
const STATE = {
  enabled: true,
  chaosLevel: "balanced",  // stealth | balanced | chaos
  identityMode: "session", // "session" (default) | "per-tab" (expert)
  currentSeed: 0,
  sessionSeed: 0,          // canonical seed for session mode
  tabSeeds: {},  // { tabId: seed } — per-tab seed, background is authority
  bootstrappedDocs: new Set(),  // Set<docKey> — idempotence (P0-4: extension-side only)
  bootstrappedTabs: new Set(),  // Set<tabId> — tabs with active JS bootstrap (for tab-scoped DNR)
  stats: {
    trackersBlocked: 0,
    cookiesCleaned: 0,
    fakeBeaconsFired: 0,
    identityRotations: 0,
  },
  // v0.1.1 C4: native-compatible sites (Spec Section 3).
  // Persisted in chrome.storage.local. Key = eTLD+1, value = true.
  nativeCompatSites: {},
  // v0.1.1 D3a: strict first-document mode.
  // When enabled, the first navigation for a tab stays entirely native
  // (no bootstrap, no DNR). On the second navigation, DNR is pre-activated
  // before the HTTP request and bootstrap runs normally.
  strictFirstDoc: true,
};

// v0.1.1 D3a: tabs that have completed their first navigation in strict mode.
// Armed tabs get DNR pre-activated in onBeforeNavigate for their next nav.
const armedTabs = new Set();

// === Side Panel — open on extension icon click ===
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// === WebRTC IP Leak Prevention (v2 item 10) ===
// Set WebRTC to default_public_interface_only so ICE candidates do not
// expose private/local IP addresses.  Idempotent — safe to call on every
// install, startup, and service-worker wake.  NOT relay-only: that is more
// detectable and breaks apps without a TURN server.
async function applyWebRTCPolicy() {
  try {
    await chrome.privacy.network.webRTCIPHandlingPolicy.set({
      value: 'default_public_interface_only',
    });
  } catch (e) {
    // Log failure visibly — do not silently claim protection
    console.error('[Duppel] Failed to set WebRTC policy:', e);
  }
}
applyWebRTCPolicy();

// === Native-Compatible Mode (v0.1.1 C4, Spec Section 3) ===
// eTLD+1 derivation with minimal embedded public suffix list.
// Covers common multi-part TLDs. Falls back to last-two-label split.
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "org.au",
  "co.nz", "co.jp", "or.jp", "co.kr", "co.in", "co.za",
  "com.br", "org.br", "com.mx", "com.cn", "com.tw", "com.hk",
  "github.io", "herokuapp.com", "pages.dev", "workers.dev",
  "netlify.app", "vercel.app", "web.app", "firebaseapp.com",
  "cloudfront.net", "azurewebsites.net", "blob.core.windows.net",
  "co.id", "com.sg", "com.my", "co.th", "com.ar", "com.co",
]);

function getETLD1(hostname) {
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) {
    return parts.length <= 3 ? hostname : parts.slice(-3).join(".");
  }
  return lastTwo;
}

function isNativeCompatible(url) {
  try {
    const hostname = new URL(url).hostname;
    return !!STATE.nativeCompatSites[getETLD1(hostname)];
  } catch(e) {
    return false;
  }
}

// === Initialization ===
chrome.runtime.onInstalled.addListener(async (details) => {
  // WebRTC policy — also applied at top-level, but re-apply on install
  // to ensure the setting takes effect even if the initial top-level
  // call raced with permission grant.
  await applyWebRTCPolicy();

  // Set default state (identity creation is handled by restoreState
  // to avoid a double-rotation race on first install).
  await chrome.storage.session.set({
    enabled: true,
    chaosLevel: "balanced",
    siteOverrides: {},
  });

  await chrome.storage.local.set({
    stats: STATE.stats,
    chaosLevel: "balanced",
    identityMode: "session",
  });

  // Legacy __pg_s cookie cleanup (Spec Section 4.4, v0.1.1 C5).
  // __pg_s was the seed-transport cookie eliminated in Round 6.
  // On extension update, remove any stale __pg_s cookies from all domains.
  if (details.reason === "update") {
    try {
      const pgsCookies = await chrome.cookies.getAll({ name: "__pg_s" });
      for (const cookie of pgsCookies) {
        const url = `http${cookie.secure ? "s" : ""}://${cookie.domain.replace(/^\./, "")}${cookie.path}`;
        await chrome.cookies.remove({ url, name: "__pg_s" });
      }
    } catch(e) {}
  }

  // Set up periodic alarms
  // Session mode: 24h rotation (realistic browser session cadence)
  chrome.alarms.create("rotateIdentity", { periodInMinutes: 1440 });
  chrome.alarms.create("cleanCookies", { periodInMinutes: 15 });
  // Poison beacons use variable timing — schedule the first one
  scheduleNextBeacon("balanced");
});

// Restore state on service worker wake (also runs when SW wakes from idle).
// Promise guard: both the top-level call and onStartup can fire concurrently
// on fresh browser launch. Without the guard, two restoreState() calls both
// see no session profile and both call rotateIdentity(), creating two different
// seeds — the last writer wins storage but the first seed may already be used
// for a tab injection (race condition).
let _restorePromise = null;
function restoreState() {
  if (!_restorePromise) _restorePromise = _doRestore();
  return _restorePromise;
}
async function _doRestore() {
  const data = await chrome.storage.local.get(["stats", "chaosLevel", "identityMode", "nativeCompatSites"]);
  // v0.1.1 C4: restore native-compatible sites
  if (data.nativeCompatSites) STATE.nativeCompatSites = data.nativeCompatSites;
  if (data.stats) Object.assign(STATE.stats, data.stats);
  if (data.chaosLevel) STATE.chaosLevel = data.chaosLevel;
  if (data.identityMode) STATE.identityMode = data.identityMode;

  // Restore enabled flag — defaults to true only if never explicitly set
  const sessionData = await chrome.storage.session.get(["profile", "enabled", "tabSeeds", "sessionSeed"]);
  if (sessionData.enabled === false) {
    STATE.enabled = false;
  } else if (sessionData.enabled === true) {
    STATE.enabled = true;
  }
  // else: session never written (first load), keep default true

  // Restore tabSeeds from session storage (survives SW restart within
  // the same browser session). Without this, SW idle/restart loses all
  // tab-to-seed mappings and getState falls back to rotation profile.
  // Reconcile against live tabs to prune stale IDs from previous sessions.
  if (sessionData.tabSeeds) {
    try {
      const liveTabs = await chrome.tabs.query({});
      const liveIds = new Set(liveTabs.map(t => t.id));
      for (const [tabId, seed] of Object.entries(sessionData.tabSeeds)) {
        const id = parseInt(tabId, 10);
        if (liveIds.has(id)) {
          STATE.tabSeeds[id] = seed;
        }
      }
    } catch(e) {
      // If tab query fails, restore all rather than lose everything
      Object.assign(STATE.tabSeeds, sessionData.tabSeeds);
    }
  }

  // Restore session seed
  if (sessionData.sessionSeed) {
    STATE.sessionSeed = sessionData.sessionSeed;
    STATE.currentSeed = sessionData.sessionSeed;
  }

  // Session mode hardening: normalize all tabSeeds to the session seed.
  // Prevents stale per-tab seeds from surviving SW wake and becoming
  // authoritative if the user later switches to per-tab mode.
  if (STATE.identityMode === "session" && STATE.sessionSeed) {
    for (const tabId of Object.keys(STATE.tabSeeds)) {
      STATE.tabSeeds[tabId] = STATE.sessionSeed;
    }
  }

  // Round 6: cold start vs warm restart.
  if (!sessionData.profile) {
    // Cold start (no session profile). restoreState is the sole authority
    // for identity creation — onInstalled only sets up alarms and defaults.
    // This avoids the double-rotation race on first install.
    await rotateIdentity();
  } else {
    // Warm restart (SW woke from idle with existing profile).
    // Round 10: success-driven DNR. Do NOT rebuild bootstrappedTabs from
    // tabSeeds — that infers proof from intent (rowan Gate 2). Instead,
    // re-inject executeScript into tabs that had seeds and let each tab
    // re-earn DNR eligibility via the normal .then() proof path.
    // Round 8: if restoring into session mode, remove any stale global
    // dynamic UA rule that may have been left from a prior per-tab session.
    if (STATE.identityMode === "session") {
      await removeGlobalUAHeaderRule();
    }
    // Re-bootstrap tabs with verified proof (not inferred from tabSeeds).
    const rebootstrapPromises = Object.keys(STATE.tabSeeds).map(tabIdStr => {
      const tabId = parseInt(tabIdStr, 10);
      const seed = STATE.tabSeeds[tabId];
      return chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        world: "MAIN",
        injectImmediately: true,
        func: bootstrapAntiFingerprint,
        args: [seed],
      }).then(() => {
        STATE.bootstrappedTabs.add(tabId);
      }).catch(() => {
        // Tab no longer injectable (closed, navigated to chrome://, etc.)
        delete STATE.tabSeeds[tabId];
      });
    });
    await Promise.allSettled(rebootstrapPromises);
    await persistTabSeeds();
    await updateTabScopedDNR();
    if (!POISONER._activeClusters) {
      // SW woke from idle with existing profile — reinit persona
      POISONER.selectPersona();
    }
    // Ensure beacon scheduler is running if enabled
    if (STATE.enabled) {
      scheduleNextBeacon(STATE.chaosLevel);
    }
  }
}

chrome.runtime.onStartup.addListener(restoreState);
// Also restore immediately on script load (covers SW wake from idle)
restoreState();

// === Closure-local bootstrap injection (Round 6/7) ===
// Delivers the entire anti-fingerprint bundle + seed via executeScript.
// Zero window rendezvous — seed is a closure-local function argument.
// bootstrapAntiFingerprint(seed) is loaded via importScripts above.
//
// Strict bootstrap contract (Round 10 — success-driven DNR):
// DNR eligibility requires verified MAIN-world bootstrap for the current
// document. Proof is revoked on every navigation/reload (onBeforeNavigate
// + tabs.onUpdated clears bootstrappedTabs) and re-earned only after
// executeScript .then() confirms. No pre-trust from tabSeeds, intent,
// or prior-document bootstrap. SW wake re-bootstraps via executeScript
// instead of inferring proof. Rotate/mode-switch clear before reload.
//
// Idempotence (P0-4): tracked extension-side via tabId:url.
// No window flags (__pg_bootstrapped__ etc.) — nothing page-observable.

// v0.1.1 C2: revoke DNR eligibility before navigation starts (fail-closed).
// onBeforeNavigate fires before the main_frame request. Await the DNR
// update so the rule is cleared before the main-frame request goes out.
// Eliminates the race where stale DNR spoofs a new navigation.
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;

  // v0.1.1 D3a: strict mode — armed tab has STRICT_ARM_RULE_ID active
  // (main_frame only, installed at end of nav 1). Don't interfere — the
  // main-frame rule will spoof this navigation's HTTP request.
  if (STATE.strictFirstDoc && armedTabs.has(details.tabId)) {
    return; // STRICT_ARM_RULE already covers this tab's main_frame requests
  }

  if (STATE.bootstrappedTabs.has(details.tabId)) {
    STATE.bootstrappedTabs.delete(details.tabId);
    await updateTabScopedDNR();
  }
});

// v0.1.1 C1: Full bootstrap injection via webNavigation.onCommitted.
// onCommitted fires AFTER the new document has committed — the new JS
// context is established. executeScript with injectImmediately: true will
// target the correct (new) context. This fixes the split-brain where
// tabs.onUpdated injection ran in the dying old context.
//
// Chrome navigation lifecycle:
// 1. onBeforeNavigate → old doc active, DNR revoked (awaited)
// 2. HTTP request goes out (native UA — DNR was cleared)
// 3. Response arrives, browser commits navigation
// 4. onCommitted → new JS context ready, executeScript targets it
// 5. .then() → bootstrappedTabs.add → updateTabScopedDNR
//    (next navigation will have coherent HTTP+JS)
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;

  const tabId = details.tabId;
  const url = details.url;

  // Clear stale docKeys for this tab
  for (const key of STATE.bootstrappedDocs) {
    if (key.startsWith(`${tabId}:`)) STATE.bootstrappedDocs.delete(key);
  }

  // Belt-and-suspenders: revoke DNR proof (also done in onBeforeNavigate)
  // v0.1.1 D3a: skip for armed tabs — DNR must persist through nav 2
  if (STATE.bootstrappedTabs.has(tabId) && !(STATE.strictFirstDoc && armedTabs.has(tabId))) {
    STATE.bootstrappedTabs.delete(tabId);
    updateTabScopedDNR();
  }

  if (!STATE.sessionSeed || !STATE.enabled) return;
  if (!url || url === "about:blank" || url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return;

  // C4: skip injection for native-compatible sites
  if (isNativeCompatible(url)) return;

  // v0.1.1 D3a: strict mode — first navigation stays all-native.
  // Skip executeScript but install a main_frame-ONLY DNR rule so the
  // NEXT navigation's HTTP goes out with persona UA. Using main_frame-only
  // prevents this document's fetch/XHR from being spoofed.
  if (STATE.strictFirstDoc && !armedTabs.has(tabId)) {
    armedTabs.add(tabId);
    const ua = STATE.sessionSeed ? generateProfile(STATE.sessionSeed)?.userAgent : null;
    if (ua) {
      try {
        chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [STRICT_ARM_RULE_ID],
          addRules: [{
            id: STRICT_ARM_RULE_ID,
            priority: 3,
            action: {
              type: "modifyHeaders",
              requestHeaders: [
                { header: "User-Agent", operation: "set", value: ua },
              ],
            },
            condition: {
              urlFilter: "*",
              tabIds: [tabId],
              resourceTypes: ["main_frame"],
            },
          }],
        });
      } catch(e) {}
    }
    return; // Entire first document stays native (JS + fetch) — main_frame rule arms next nav
  }

  const docKey = `${tabId}:${url}`;
  if (STATE.bootstrappedDocs.has(docKey)) return;

  let seedToInject;
  if (STATE.identityMode === "session") {
    seedToInject = STATE.sessionSeed;
  } else {
    // Per-tab mode: use existing tab seed if any, otherwise generate
    // a unique seed for this tab (not the session seed — each tab must differ).
    if (STATE.tabSeeds[tabId]) {
      seedToInject = STATE.tabSeeds[tabId];
    } else {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      seedToInject = arr[0];
    }
  }

  // Track tab seed (background is the authority)
  STATE.tabSeeds[tabId] = seedToInject;
  persistTabSeeds();

  // Inject the FULL bootstrap function with seed as closure-local arg.
  // No window rendezvous. The function runs entirely in closure scope.
  // allFrames:false — top frame only. Same-origin iframes share prototypes.
  chrome.scripting.executeScript({
    target: { tabId: tabId, allFrames: false },
    world: "MAIN",
    injectImmediately: true,
    func: bootstrapAntiFingerprint,
    args: [seedToInject],
  }).then(() => {
    STATE.bootstrappedDocs.add(docKey);
    STATE.bootstrappedTabs.add(tabId);
    armedTabs.delete(tabId); // v0.1.1 D3a: strict arming served its purpose — resume normal DNR lifecycle
    updateTabScopedDNR();
  }).catch(() => {
    // Injection failed (non-injectable page, restricted URL, etc.).
    // Remove BOTH bootstrap proof AND seed — prevents SW wake from
    // falsely inferring this tab was bootstrapped (rowan blocker 1).
    STATE.bootstrappedTabs.delete(tabId);
    delete STATE.tabSeeds[tabId];
    persistTabSeeds();
    updateTabScopedDNR();
  });
});

// Belt-and-suspenders: revoke DNR on tabs.onUpdated status="loading".
// Primary injection is now in onCommitted above. This handler only
// ensures DNR proof is cleared early for edge cases where onBeforeNavigate
// didn't fire (e.g., same-document navigations that Chrome treats as loads).
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  // v0.1.1 D3a: don't clear pre-activated DNR for armed tabs in strict mode
  if (STATE.strictFirstDoc && armedTabs.has(tabId)) return;
  if (STATE.bootstrappedTabs.has(tabId)) {
    STATE.bootstrappedTabs.delete(tabId);
    updateTabScopedDNR();
  }
});

// === Dynamic User-Agent Header Rule (per-tab mode only) ===
// Per-tab mode uses a global dynamic UA rule (not tab-scoped session rule)
// switched via tabs.onActivated. This is NOT covered by the strict bootstrap
// contract — per-tab mode is expert-only and de-scoped from v0.1.0 proof claim.
// Session mode (the default) uses updateTabScopedDNR() with verified proof.
const UA_RULE_ID = 9999;

async function updateUAHeaderRule(userAgent) {
  try {
    // Remove old rule, add new one
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [UA_RULE_ID],
      addRules: [{
        id: UA_RULE_ID,
        priority: 3,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "User-Agent", operation: "set", value: userAgent },
          ],
        },
        condition: {
          urlFilter: "*",
          resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "script", "image", "stylesheet", "font", "media", "other"],
        },
      }],
    });
  } catch(e) {}
}

// Round 8: remove the global per-tab dynamic UA rule.
// Called when entering/restoring session mode to prevent a stale global
// rule from overriding the tab-scoped session rule after a per-tab → session
// transition. Per-tab mode is the only path that may install UA_RULE_ID.
async function removeGlobalUAHeaderRule() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [UA_RULE_ID],
    });
  } catch(e) {}
}

// === Tab-Scoped DNR (Round 10: success-driven via session rules + tabIds) ===
// Session mode: HTTP UA is spoofed only for tabs where JS bootstrap succeeded.
// Uses chrome.declarativeNetRequest.updateSessionRules with condition.tabIds
// so unbootstrapped tabs (chrome://, failed executeScript) get native UA.
// Session rules are ephemeral — they die when the browser closes, which is
// correct because bootstrappedTabs is also ephemeral.
//
// Per-tab mode: uses global dynamic rule (no tabIds) since UA changes per
// active tab via updateUAHeaderRule in tabs.onActivated. Per-tab mode is
// expert-only, de-scoped from v0.1.0 strict proof claim, and the UA
// mismatch on non-bootstrapped tabs is an accepted trade-off.
const SESSION_UA_RULE_ID = 9998;
// v0.1.1 D3a: strict mode arming rule — main_frame only, separate from session rule.
// Prevents the first document's fetches from being spoofed while arming DNR for nav 2.
const STRICT_ARM_RULE_ID = 9997;

async function updateTabScopedDNR() {
  // Round 8: defensively remove the global per-tab dynamic rule when in
  // session mode. Prevents a stale UA_RULE_ID=9999 from surviving a
  // per-tab → session mode transition and overriding tab-scoped DNR.
  if (STATE.identityMode === "session") {
    await removeGlobalUAHeaderRule();
  }

  const tabIds = [...STATE.bootstrappedTabs];

  // Get current UA — derive from in-memory STATE.sessionSeed to stay
  // coherent with executeScript injections (which also use STATE.sessionSeed).
  // Avoids async race with chrome.storage.session reads.
  let ua = null;
  if (STATE.sessionSeed) {
    ua = generateProfile(STATE.sessionSeed).userAgent;
  }

  if (tabIds.length === 0 || !ua) {
    // No bootstrapped tabs or no profile — remove session rule AND any stale arming rule
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [SESSION_UA_RULE_ID, STRICT_ARM_RULE_ID],
      });
    } catch(e) {}
    return;
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [SESSION_UA_RULE_ID, STRICT_ARM_RULE_ID],
      addRules: [{
        id: SESSION_UA_RULE_ID,
        priority: 3,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "User-Agent", operation: "set", value: ua },
          ],
        },
        condition: {
          urlFilter: "*",
          tabIds: tabIds,
          resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "script", "image", "stylesheet", "font", "media", "other"],
        },
      }],
    });
  } catch(e) {}
}

// === Identity Rotation ===
// Single authority: background owns seed + profile.
// createIdentity() generates a new seed, derives the profile, writes
// to chrome.storage.session, and updates the UA header. The stored
// profile serves as fallback for getState when no tab-specific seed
// is available (e.g., before any page has loaded after rotation).
// Tab seeds are stored in STATE.tabSeeds (background is the authority).
// In session mode all tabs share STATE.sessionSeed; in per-tab mode
// each tab gets a distinct seed via generateSessionSeed().
async function createIdentity(seed) {
  if (seed === undefined) seed = generateSessionSeed();
  STATE.currentSeed = seed;
  STATE.sessionSeed = seed;
  const profile = generateProfile(seed);
  if (!profile) {
    // Fail-closed (C3): no persona groups match host engine+OS.
    // Store seed but no profile — DNR won't spoof, JS won't override.
    await chrome.storage.session.set({ profile: null, sessionSeed: seed });
    await updateTabScopedDNR();
    return { seed, profile: null };
  }
  await chrome.storage.session.set({ profile: profile, sessionSeed: seed });
  // Item 2: persist for cold-start recovery. On next browser launch,
  // restoreState() reads lastSeed/lastUA to bootstrap the DNR rule
  // before rotateIdentity() generates a fresh identity.
  await chrome.storage.local.set({ lastSeed: seed, lastUA: profile.userAgent });
  // Round 6: update tab-scoped DNR with new UA for all bootstrapped tabs.
  // On rotation, existing bootstrapped tabs need the new UA value.
  await updateTabScopedDNR();
  return { seed, profile };
}

async function rotateIdentity() {
  await createIdentity();
  STATE.stats.identityRotations++;
  await persistStats();
  POISONER.selectPersona();
}

// === Cookie Cleanup ===
async function cleanThirdPartyCookies() {
  try {
    const cookies = await chrome.cookies.getAll({});
    let cleaned = 0;

    // Known tracker cookie domains
    const trackerDomains = [
      "doubleclick.net", "facebook.com", "google-analytics.com",
      "googlesyndication.com", "criteo.com", "criteo.net",
      "adnxs.com", "taboola.com", "outbrain.com",
      "pubmatic.com", "rubiconproject.com", "openx.net",
      "casalemedia.com", "demdex.net", "bluekai.com",
      "sharethis.com", "addthis.com", "adsrvr.org",
      "mathtag.com", "exelator.com", "krxd.net",
      "hotjar.com", "fullstory.com", "mouseflow.com",
      "clarity.ms", "segment.com", "mixpanel.com",
      "amplitude.com", "scorecardresearch.com",
      "quantserve.com", "moatads.com", "bounceexchange.com",
    ];

    for (const cookie of cookies) {
      const domain = cookie.domain.replace(/^\./, "");
      const isTracker = trackerDomains.some(td => domain === td || domain.endsWith("." + td));

      if (isTracker) {
        const url = `http${cookie.secure ? "s" : ""}://${domain}${cookie.path}`;
        try {
          await chrome.cookies.remove({ url: url, name: cookie.name });
          cleaned++;
        } catch(e) {}
      }
    }

    STATE.stats.cookiesCleaned += cleaned;
    await persistStats();
    return cleaned;
  } catch(e) {
    return 0;
  }
}

// === Beacon scheduling (variable timing per chaos level) ===
// Uses one-shot alarms with variable delay instead of fixed-period alarms.
// Each fire schedules the next, creating human-rhythm intervals.
function scheduleNextBeacon(chaosLevel) {
  const delayMinutes = POISONER.getNextInterval(chaosLevel);
  chrome.alarms.create("firePoisonBeacons", { delayInMinutes: delayMinutes });
}

// === Alarm Handler ===
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!STATE.enabled) return;

  switch (alarm.name) {
    case "rotateIdentity":
      await rotateIdentity();
      break;

    case "cleanCookies":
      await cleanThirdPartyCookies();
      break;

    case "firePoisonBeacons":
      // v2 item 4: interaction-coupled chaff. Generate beacon configs,
      // send to bridge.js (ISOLATED world) via chrome.tabs.sendMessage.
      // ISOLATED world fires with page's network identity (real Referer,
      // real cookies) but page scripts CANNOT observe ISOLATED world
      // fetch/sendBeacon calls. bridge.js reports back via chaffFired.
      // Skips and reschedules if no suitable active tab (no SW fallback).
      {
        const configs = POISONER.buildBatchConfigs(STATE.chaosLevel);
        try {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (tab && tab.id && tab.url &&
              (tab.url.startsWith("http://") || tab.url.startsWith("https://")) &&
              !isNativeCompatible(tab.url)) {
            // Send configs to bridge.js — it queues and fires on interaction.
            // Stats NOT incremented here; bridge.js sends chaffFired when done.
            // DOM chaff payload rides alongside network configs in the same
            // message. bridge.js applies DOM mutations on the same interaction
            // trigger as beacons (rowan blocker 1 fix).
            const domPayload = POISONER.buildDOMChaffPayload(STATE.chaosLevel);
            await chrome.tabs.sendMessage(tab.id, {
              type: "queueChaff",
              configs: configs,
              domChaff: domPayload,
            });
          }
        } catch(e) {
          // sendMessage failed (no content script, restricted page, etc.)
        }
        // No SW-context fallback. Item 4 requires page-context chaff
        // (ISOLATED world sendBeacon with real Referer/cookies). SW fetch
        // uses xmlhttprequest resource type, blocked by DNR rule 103 for
        // GA endpoints and stripped by rule 1 for Referer. Skip and
        // reschedule — the next alarm will try again with whatever tab
        // is active at that time.
        scheduleNextBeacon(STATE.chaosLevel);
      }
      break;
  }
});

// === Message Handler (from popup and content scripts) ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "getState":
      (async () => {
        const [sessionData, localData] = await Promise.all([
          chrome.storage.session.get(["profile", "enabled", "chaosLevel"]),
          chrome.storage.local.get(["stats", "chaosLevel"]),
        ]);
        // Restore in-memory state from storage if stale
        if (localData.chaosLevel) STATE.chaosLevel = localData.chaosLevel;
        if (sessionData.chaosLevel) STATE.chaosLevel = sessionData.chaosLevel;
        if (localData.stats) Object.assign(STATE.stats, localData.stats);

        // Resolve display profile.
        // Session mode: always show the session profile (all tabs share one identity).
        // Per-tab mode: show the active tab's seed-derived profile if available.
        let displayProfile = sessionData.profile || null;
        if (STATE.identityMode === "per-tab") {
          try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab && STATE.tabSeeds[activeTab.id]) {
              displayProfile = generateProfile(STATE.tabSeeds[activeTab.id]);
            }
          } catch(e) {}
        }
        sendResponse({
          enabled: sessionData.enabled !== false,
          chaosLevel: STATE.chaosLevel,
          identityMode: STATE.identityMode,
          stats: STATE.stats,
          profile: displayProfile,
        });
      })();
      return true;

    case "toggleEnabled":
      (async () => {
        STATE.enabled = msg.enabled;
        await chrome.storage.session.set({ enabled: msg.enabled });
        // Manage beacon scheduler: clear when disabled, schedule when enabled
        if (!msg.enabled) {
          await chrome.alarms.clear("firePoisonBeacons");
        } else {
          scheduleNextBeacon(STATE.chaosLevel);
        }
        sendResponse({ ok: true });
        // Notify all bridge.js content scripts to re-check disable flag
        notifyOverrideChanged();
        // Reload active tab after responding so popup gets the ack
        setTimeout(async () => {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
              await chrome.tabs.reload(tab.id);
            }
          } catch(e) {}
        }, 300);
      })();
      return true;

    case "setChaosLevel":
      STATE.chaosLevel = msg.level;
      chrome.storage.local.set({ chaosLevel: msg.level });
      chrome.storage.session.set({ chaosLevel: msg.level });
      // Reschedule beacon timer for the new cadence
      scheduleNextBeacon(msg.level);
      sendResponse({ ok: true });
      break;

    case "setIdentityMode":
      (async () => {
        STATE.identityMode = msg.mode; // "session" or "per-tab"
        await chrome.storage.local.set({ identityMode: msg.mode });
        // Adjust rotation alarm cadence
        await chrome.alarms.clear("rotateIdentity");
        if (msg.mode === "session") {
          chrome.alarms.create("rotateIdentity", { periodInMinutes: 1440 });
          // Round 8: explicitly remove the global per-tab dynamic rule before
          // switching to session mode's tab-scoped DNR. updateTabScopedDNR
          // also removes it defensively, but this ensures it's gone even if
          // the tab-scoped update is a no-op (e.g., no bootstrapped tabs yet).
          await removeGlobalUAHeaderRule();
          // Restore session coherence: update tab-scoped DNR to session profile,
          // inject session seed into all tabs, and reload.
          // Round 6: tabs.onUpdated delivers bootstrap via executeScript on reload.
          const tabs = await chrome.tabs.query({}).catch(() => []);
          const httpTabs = tabs.filter(t => t.url && (t.url.startsWith("http://") || t.url.startsWith("https://")));
          for (const tab of httpTabs) {
            STATE.tabSeeds[tab.id] = STATE.sessionSeed;
          }
          // Clear bootstrappedTabs — reload will re-verify via executeScript.
          // Don't pre-trust: DNR stays stale until tabs.onUpdated .then() confirms.
          STATE.bootstrappedTabs.clear();
          await persistTabSeeds();
          await updateTabScopedDNR();
          sendResponse({ ok: true });
          // Reload all tabs — tabs.onUpdated delivers bootstrap on reload
          setTimeout(async () => {
            for (const tab of httpTabs) {
              try { await chrome.tabs.reload(tab.id); } catch(e) {}
            }
          }, 300);
        } else {
          chrome.alarms.create("rotateIdentity", { periodInMinutes: 30 });
          sendResponse({ ok: true });
        }
      })();
      return true;

    case "rotateNow":
      (async () => {
        // Session mode: one seed for all tabs.
        // Per-tab mode: distinct seed per tab.
        const { seed: sessionSeed } = await createIdentity();
        STATE.stats.identityRotations++;
        await persistStats();
        POISONER.selectPersona();

        const allTabs = STATE.identityMode === "session" || !!msg.allTabs;
        const tabs = await chrome.tabs.query({}).catch(() => []);

        const targetTabs = allTabs
          ? tabs.filter(t => t.url && (t.url.startsWith("http://") || t.url.startsWith("https://")))
          : [];

        if (!allTabs) {
          try {
            const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (active && active.url && (active.url.startsWith("http://") || active.url.startsWith("https://"))) {
              targetTabs.push(active);
            }
          } catch(e) {}
        }

        // Determine active tab for per-tab UA header setting
        let activeTabId = null;
        try {
          const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (active) activeTabId = active.id;
        } catch(e) {}

        for (const tab of targetTabs) {
          // Session mode: all tabs get the same seed.
          // Per-tab mode: each tab gets a distinct seed.
          const tabSeed = STATE.identityMode === "session"
            ? sessionSeed
            : generateSessionSeed();

          // Store seed so tabs.onUpdated uses it on reload. Do NOT add to
          // bootstrappedTabs — reload will re-verify via executeScript .then().
          STATE.tabSeeds[tab.id] = tabSeed;

          // Per-tab mode: set UA header to match the active tab's seed
          if (STATE.identityMode === "per-tab" && tab.id === activeTabId) {
            const profile = generateProfile(tabSeed);
            await updateUAHeaderRule(profile.userAgent);
          }
        }

        // Clear bootstrappedTabs for target tabs — DNR stays stale until
        // tabs.onUpdated .then() confirms each bootstrap after reload.
        for (const tab of targetTabs) {
          STATE.bootstrappedTabs.delete(tab.id);
        }
        await persistTabSeeds();
        await updateTabScopedDNR();

        // Respond BEFORE reloading (reloading active tab kills popup)
        sendResponse({ ok: true, rotated: true });

        // Delay reload so popup receives the response first
        setTimeout(async () => {
          for (const tab of targetTabs) {
            try { await chrome.tabs.reload(tab.id); } catch(e) {}
          }
        }, 300);
      })();
      return true;

    case "setSiteOverride":
      (async () => {
        const data = await chrome.storage.session.get(["siteOverrides"]);
        const overrides = data.siteOverrides || {};
        overrides[msg.hostname] = msg.enabled;
        await chrome.storage.session.set({ siteOverrides: overrides });
        sendResponse({ ok: true });
        // Notify all bridge.js content scripts to re-check disable flag
        notifyOverrideChanged();
        // Reload active tab after responding
        setTimeout(async () => {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
              await chrome.tabs.reload(tab.id);
            }
          } catch(e) {}
        }, 300);
      })();
      return true;

    // v0.1.1 D3a: strict first-document mode toggle
    case "setStrictFirstDoc":
      STATE.strictFirstDoc = !!msg.enabled;
      armedTabs.clear();
      // Remove any stale arming rule when toggling strict mode off
      if (!msg.enabled) {
        chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [STRICT_ARM_RULE_ID],
        }).catch(() => {});
      }
      callback({ ok: true, strictFirstDoc: STATE.strictFirstDoc });
      break;

    // v0.1.1 C4: native-compatible mode toggle (Spec Section 3)
    case "setNativeCompat":
      (async () => {
        const hostname = msg.hostname;
        const etld1 = getETLD1(hostname);
        if (msg.enabled) {
          STATE.nativeCompatSites[etld1] = true;
        } else {
          delete STATE.nativeCompatSites[etld1];
        }
        await chrome.storage.local.set({ nativeCompatSites: STATE.nativeCompatSites });
        // Clear DNR proof for tabs on this site
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.url) {
            try {
              if (getETLD1(new URL(tab.url).hostname) === etld1) {
                STATE.bootstrappedTabs.delete(tab.id);
                armedTabs.delete(tab.id); // v0.1.1 R2: clear stale arming for native-compat tabs
                delete STATE.tabSeeds[tab.id];
                for (const key of STATE.bootstrappedDocs) {
                  if (key.startsWith(`${tab.id}:`)) STATE.bootstrappedDocs.delete(key);
                }
              }
            } catch(e) {}
          }
        }
        await persistTabSeeds();
        await updateTabScopedDNR();
        notifyOverrideChanged();
        sendResponse({ ok: true });
        // Reload affected tabs
        setTimeout(async () => {
          for (const tab of tabs) {
            if (tab.url) {
              try {
                if (getETLD1(new URL(tab.url).hostname) === etld1) {
                  await chrome.tabs.reload(tab.id);
                }
              } catch(e) {}
            }
          }
        }, 300);
      })();
      return true;

    case "getNativeCompat":
      (async () => {
        const hostname = msg.hostname;
        const etld1 = getETLD1(hostname);
        sendResponse({ enabled: !!STATE.nativeCompatSites[etld1], etld1 });
      })();
      return true;

    case "cleanCookiesNow":
      cleanThirdPartyCookies().then(count => {
        sendResponse({ ok: true, cleaned: count });
      });
      return true;

    case "fireBeaconsNow":
      // Manual fire: try page-context via bridge.js, fall back to SW.
      (async () => {
        const configs = POISONER.buildBatchConfigs(STATE.chaosLevel);
        let usedPageContext = false;
        try {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (tab && tab.id && tab.url &&
              (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
            const domPayload = POISONER.buildDOMChaffPayload(STATE.chaosLevel);
            await chrome.tabs.sendMessage(tab.id, {
              type: "queueChaff",
              configs: configs,
              domChaff: domPayload,
            });
            usedPageContext = true;
          }
        } catch(e) {}
        // No SW fallback — page-context only (item 4 invariant).
        // Stats arrive via chaffFired callback from bridge.js.
        sendResponse({ ok: true, queued: usedPageContext, count: configs.length });
      })();
      return true;

    case "getStats":
      sendResponse({ stats: STATE.stats });
      break;

    case "chaffFired":
      // bridge.js reports actual beacon count after page-context firing.
      // Stats only increment here — never on queue/injection.
      if (typeof msg.count === "number" && msg.count > 0) {
        STATE.stats.fakeBeaconsFired += msg.count;
        persistStats();
      }
      break;

    case "domChaffApplied":
      // bridge.js reports how many ad containers received attribute injection.
      // Informational — does not increment fakeBeaconsFired (no network).
      break;

    case "checkSiteOverride":
      // Bridge.js asks background to evaluate enabled/siteOverrides and
      // set/clear the __pgd cookie. Replaces the old bridge.js approach
      // of reading chrome.storage.session directly (which silently failed).
      if (sender.tab && Number.isInteger(sender.tab.id)) {
        (async () => {
          try {
            const data = await chrome.storage.session.get(["enabled", "siteOverrides"]);
            const overrides = data.siteOverrides || {};
            const shouldDisable = overrides[msg.hostname] === false || data.enabled === false
              || isNativeCompatible("https://" + msg.hostname);
            chrome.scripting.executeScript({
              target: { tabId: sender.tab.id },
              world: "MAIN",
              func: (flag) => {
                try {
                  if (flag) document.cookie = "__pgd=1;path=/;SameSite=Lax";
                  else document.cookie = "__pgd=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT";
                } catch(e) {}
              },
              args: [shouldDisable],
            }).catch(() => {});
          } catch(e) {}
        })();
      }
      break;
  }
});

// === Tab lifecycle: clean up tabSeeds, bootstrap state, and DNR ===
chrome.tabs.onRemoved.addListener(async (tabId) => {
  delete STATE.tabSeeds[tabId];
  STATE.bootstrappedTabs.delete(tabId);
  armedTabs.delete(tabId); // v0.1.1 D3a
  for (const key of STATE.bootstrappedDocs) {
    if (key.startsWith(`${tabId}:`)) STATE.bootstrappedDocs.delete(key);
  }
  await persistTabSeeds();
  updateTabScopedDNR();
});

// When user switches tabs in per-tab mode, update the tab-scoped DNR
// rule's UA value to match the new active tab's identity.
// Session mode: no-op (all tabs share the same UA).
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (STATE.identityMode === "session") return; // UA is already correct
  const seed = STATE.tabSeeds[activeInfo.tabId];
  if (seed) {
    // Per-tab mode: temporarily override the session profile's UA
    // with this tab's profile UA for the DNR rule. updateTabScopedDNR
    // reads from session storage, so we update the stored profile.
    const profile = generateProfile(seed);
    await updateUAHeaderRule(profile.userAgent);
  }
});

// === Notify bridge.js content scripts of override changes ===
// Sends a message to all tabs so bridge.js can re-check the disable
// flag. Replaces the old chrome.storage.onChanged approach (content
// scripts can't listen for session storage changes without setAccessLevel).
async function notifyOverrideChanged() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
        chrome.tabs.sendMessage(tab.id, { type: "overrideChanged" }).catch(() => {});
      }
    }
  } catch(e) {}
}

// === Stats Persistence ===
async function persistStats() {
  try {
    await chrome.storage.local.set({ stats: STATE.stats });
  } catch(e) {}
}

// === Tab Seeds Persistence ===
// Persists tabSeeds to chrome.storage.session so they survive MV3
// service worker idle/restart. Without this, SW restart causes getState
// and tabs.onActivated to fall back to the rotation profile.
async function persistTabSeeds() {
  try {
    await chrome.storage.session.set({ tabSeeds: STATE.tabSeeds });
  } catch(e) {}
}
