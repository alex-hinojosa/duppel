/**
 * PhantomGrid — Background Script (Firefox)
 * Firefox-adapted fork of background.js.
 * Manages identity rotation, cookie cleanup, tracker monitoring,
 * and fake beacon generation.
 *
 * Differences from Chrome version:
 * - No importScripts (Firefox manifest loads via scripts array)
 * - No sidePanel API (Firefox has no equivalent)
 * - browser.* namespace instead of chrome.*
 * - No injectImmediately in scripting.executeScript (Firefox unsupported)
 * - UA header spoofing via web-request-rules.js setUA() instead of declarativeNetRequest
 * - URL prefix checks use about: and moz-extension:// instead of chrome:// and chrome-extension://
 * - No testDNRChaff diagnostic (Chrome-only declarativeNetRequest.testMatchOutcome)
 */

// === Storage Architecture (v2 Item 1: Session-Level Identity Default) ===
// Three storage layers serve different lifetimes:
//
// 1. browser.storage.session — Extension-session scoped.
//    Survives background script restart within a browser session. Dies on browser quit.
//    Stores: profile, sessionSeed, tabSeeds, enabled, siteOverrides, chaosLevel.
//    This is NOT the same as web sessionStorage.
//
// 2. browser.storage.local — Persistent across browser restarts.
//    Stores: stats, chaosLevel, identityMode.
//    identityMode persists so the user's preference survives browser restarts.
//
// 3. sessionStorage (MAIN world) — Per-tab, per-origin.
//    Stores: __pg_seed__ — the seed anti-fingerprint.js uses to derive its profile.
//    Set by background.js via browser.scripting.executeScript (MAIN world injection).
//    Read by both anti-fingerprint.js (MAIN) and bridge.js (ISOLATED, shared storage).
//    Dies when the tab closes or navigates cross-origin.
//
// Identity lifetime (session mode, the default):
//   One identity per browser session, rotating every 24h (alarm-based).
//   On browser restart, browser.storage.session is empty → restoreState() finds
//   no profile → calls rotateIdentity() → fresh identity + new UA rule.
//   The 24h alarm also rotates within a running session.
//
// Cold-start alignment (Item 2):
//   On cold start, restoreState() reads lastSeed/lastUA from browser.storage.local
//   and applies the stale UA via setUA() immediately, before rotateIdentity()
//   generates a fresh identity (~ms later). Pre-injection via browser.tabs.onUpdated
//   races the session seed into sessionStorage before anti-fingerprint.js runs.
//   If pre-injection wins, no desync occurs.
//   If pre-injection loses the race, anti-fingerprint.js generates a random seed
//   and bridge.js sends seedObserved — background silently corrects sessionStorage
//   via scripting.executeScript (no reload). The first page load on a new origin
//   may have a JS/network UA mismatch (documented residual gap); all subsequent
//   same-origin navigations are aligned.

// === State ===
const STATE = {
  enabled: true,
  chaosLevel: "balanced",  // stealth | balanced | chaos
  identityMode: "session", // "session" (default) | "per-tab" (expert)
  currentSeed: 0,
  sessionSeed: 0,          // canonical seed for session mode
  tabSeeds: {},  // { tabId: seed } — per-tab seed from page's anti-fingerprint.js
  stats: {
    trackersBlocked: 0,
    cookiesCleaned: 0,
    fakeBeaconsFired: 0,
    identityRotations: 0,
  },
};

// === WebRTC IP Leak Prevention (v2 item 10) ===
// Set WebRTC to default_public_interface_only so ICE candidates do not
// expose private/local IP addresses.  Idempotent — safe to call on every
// install, startup, and service-worker wake.  NOT relay-only: that is more
// detectable and breaks apps without a TURN server.
async function applyWebRTCPolicy() {
  try {
    await browser.privacy.network.webRTCIPHandlingPolicy.set({
      value: 'default_public_interface_only',
    });
  } catch (e) {
    // Log failure visibly — do not silently claim protection
    console.error('[PhantomGrid] Failed to set WebRTC policy:', e);
  }
}
applyWebRTCPolicy();

// === Initialization ===
browser.runtime.onInstalled.addListener(async () => {
  // WebRTC policy — also applied at top-level, but re-apply on install
  // to ensure the setting takes effect even if the initial top-level
  // call raced with permission grant.
  await applyWebRTCPolicy();

  // Generate initial identity (writes profile to session storage, updates UA)
  await createIdentity();

  await browser.storage.session.set({
    enabled: true,
    chaosLevel: "balanced",
    siteOverrides: {},
  });

  await browser.storage.local.set({
    stats: STATE.stats,
    chaosLevel: "balanced",
    identityMode: "session",
  });

  // Select initial poisoner persona
  POISONER.selectPersona();

  // Set up periodic alarms
  // Session mode: 24h rotation (realistic browser session cadence)
  browser.alarms.create("rotateIdentity", { periodInMinutes: 1440 });
  browser.alarms.create("cleanCookies", { periodInMinutes: 15 });
  // Poison beacons use variable timing — schedule the first one
  scheduleNextBeacon("balanced");
});

// Restore state on background script wake (also runs when script wakes from idle)
async function restoreState() {
  const data = await browser.storage.local.get(["stats", "chaosLevel", "identityMode"]);
  if (data.stats) Object.assign(STATE.stats, data.stats);
  if (data.chaosLevel) STATE.chaosLevel = data.chaosLevel;
  if (data.identityMode) STATE.identityMode = data.identityMode;

  // Restore enabled flag — defaults to true only if never explicitly set
  const sessionData = await browser.storage.session.get(["profile", "enabled", "tabSeeds", "sessionSeed"]);
  if (sessionData.enabled === false) {
    STATE.enabled = false;
  } else if (sessionData.enabled === true) {
    STATE.enabled = true;
  }
  // else: session never written (first load), keep default true

  // Restore tabSeeds from session storage (survives background script restart within
  // the same browser session). Without this, restart loses all
  // tab-to-seed mappings and getState falls back to rotation profile.
  // Reconcile against live tabs to prune stale IDs from previous sessions.
  if (sessionData.tabSeeds) {
    try {
      const liveTabs = await browser.tabs.query({});
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
  // Prevents stale per-tab seeds from surviving restart and becoming
  // authoritative if the user later switches to per-tab mode.
  if (STATE.identityMode === "session" && STATE.sessionSeed) {
    for (const tabId of Object.keys(STATE.tabSeeds)) {
      STATE.tabSeeds[tabId] = STATE.sessionSeed;
    }
  }

  // Item 2: On cold start (no session profile), apply stale UA from local
  // storage immediately so the UA header has a spoofed value before any
  // navigation fires. rotateIdentity() below overwrites with fresh UA ~ms later.
  if (!sessionData.profile) {
    const local = await browser.storage.local.get(["lastSeed", "lastUA"]);
    if (local.lastUA) {
      await updateUAHeaderRule(local.lastUA);
    }
    await rotateIdentity();
  } else {
    // Re-apply UA header rule from stored profile. Re-applying ensures the rule
    // matches the current profile after extension updates or if the
    // rule was cleared for any reason.
    await updateUAHeaderRule(sessionData.profile.userAgent);
    if (!POISONER._activeClusters) {
      // Background woke from idle with existing profile — reinit persona
      POISONER.selectPersona();
    }
    // Ensure beacon scheduler is running if enabled
    if (STATE.enabled) {
      scheduleNextBeacon(STATE.chaosLevel);
    }
  }
}

browser.runtime.onStartup.addListener(restoreState);
// Also restore immediately on script load (covers background script wake from idle)
restoreState();

// === Item 2: Seed Pre-injection ===
// Pre-inject session seed into sessionStorage before content scripts run.
// browser.tabs.onUpdated fires with status "loading" when a navigation commits.
// Firefox does not support injectImmediately — the existing fallback
// (bridge.js seedObserved → background corrects) handles the race.
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading") return;
  if (!STATE.sessionSeed || !STATE.enabled) return;
  if (!tab.url || tab.url.startsWith("about:") || tab.url.startsWith("moz-extension://")) return;

  const seedToInject = (STATE.identityMode === "session")
    ? STATE.sessionSeed
    : (STATE.tabSeeds[tabId] || STATE.sessionSeed);

  browser.scripting.executeScript({
    // allFrames:false is intentional — pre-inject into the top frame only.
    // Cross-origin iframes have their own sessionStorage partitions and cannot
    // share __pg_seed__ with the top frame. Injecting into iframes would write
    // seeds that anti-fingerprint.js in those frames may or may not read
    // (depends on iframe origin). The cross-origin iframe residual is explicit
    // and accepted as a boundary of Item 2's alignment guarantee.
    target: { tabId: tabId, allFrames: false },
    world: "MAIN",
    func: (s) => {
      try {
        // Only set if not already present — preserves existing seed on
        // same-origin navigations and avoids overwriting if anti-fingerprint.js
        // already ran (race lost scenario).
        if (!sessionStorage.getItem("__pg_seed__")) {
          sessionStorage.setItem("__pg_seed__", String(s));
        }
      } catch(e) {}
    },
    args: [seedToInject],
  }).catch(() => {}); // Tab may not be injectable (about:, devtools, etc.)
});

// === Dynamic User-Agent Header Rule ===
// Updates the UA HTTP header via web-request-rules.js setUA() (webRequest API).
// Firefox does not use declarativeNetRequest for this — web-request-rules.js
// is loaded before this script via the manifest scripts array and exposes setUA().
async function updateUAHeaderRule(userAgent) {
  setUA(userAgent);
}

// === Identity Rotation ===
// Single authority: background owns seed + profile.
// createIdentity() generates a new seed, derives the profile, writes
// to browser.storage.session, and updates the UA header. The stored
// profile serves as fallback for getState when no tab-specific seed
// is available (e.g., before any page has loaded after rotation).
// Tab-specific seeds from bridge.js (seedObserved) take precedence
// in getState — see tabSeeds.
async function createIdentity(seed) {
  if (seed === undefined) seed = generateSessionSeed();
  STATE.currentSeed = seed;
  STATE.sessionSeed = seed;
  const profile = generateProfile(seed);
  await browser.storage.session.set({ profile: profile, sessionSeed: seed });
  // Item 2: persist for cold-start recovery. On next browser launch,
  // restoreState() reads lastSeed/lastUA to bootstrap the UA rule
  // before rotateIdentity() generates a fresh identity.
  await browser.storage.local.set({ lastSeed: seed, lastUA: profile.userAgent });
  await updateUAHeaderRule(profile.userAgent);
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
    const cookies = await browser.cookies.getAll({});
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
          await browser.cookies.remove({ url: url, name: cookie.name });
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
  browser.alarms.create("firePoisonBeacons", { delayInMinutes: delayMinutes });
}

// === Alarm Handler ===
browser.alarms.onAlarm.addListener(async (alarm) => {
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
      // send to bridge.js (ISOLATED world) via browser.tabs.sendMessage.
      // ISOLATED world fires with page's network identity (real Referer,
      // real cookies) but page scripts CANNOT observe ISOLATED world
      // fetch/sendBeacon calls. bridge.js reports back via chaffFired.
      // Skips and reschedules if no suitable active tab (no background fallback).
      {
        const configs = POISONER.buildBatchConfigs(STATE.chaosLevel);
        let usedPageContext = false;
        try {
          const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
          if (tab && tab.id && tab.url &&
              (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
            // Send configs to bridge.js — it queues and fires on interaction.
            // Stats NOT incremented here; bridge.js sends chaffFired when done.
            // DOM chaff payload rides alongside network configs in the same
            // message. bridge.js applies DOM mutations on the same interaction
            // trigger as beacons (rowan blocker 1 fix).
            const domPayload = POISONER.buildDOMChaffPayload(STATE.chaosLevel);
            await browser.tabs.sendMessage(tab.id, {
              type: "queueChaff",
              configs: configs,
              domChaff: domPayload,
            });
            usedPageContext = true;
          }
        } catch(e) {
          // sendMessage failed (no content script, restricted page, etc.)
        }
        // No background-context fallback. Item 4 requires page-context chaff
        // (ISOLATED world sendBeacon with real Referer/cookies). Background fetch
        // uses xmlhttprequest resource type and lacks proper page context.
        // Skip and reschedule — the next alarm will try again with whatever tab
        // is active at that time.
        scheduleNextBeacon(STATE.chaosLevel);
      }
      break;
  }
});

// === Message Handler (from popup and content scripts) ===
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "getState":
      (async () => {
        const [sessionData, localData] = await Promise.all([
          browser.storage.session.get(["profile", "enabled", "chaosLevel"]),
          browser.storage.local.get(["stats", "chaosLevel"]),
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
            const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
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
        await browser.storage.session.set({ enabled: msg.enabled });
        // Manage beacon scheduler: clear when disabled, schedule when enabled
        if (!msg.enabled) {
          await browser.alarms.clear("firePoisonBeacons");
        } else {
          scheduleNextBeacon(STATE.chaosLevel);
        }
        sendResponse({ ok: true });
        // Notify all bridge.js content scripts to re-check disable flag
        notifyOverrideChanged();
        // Reload active tab after responding so popup gets the ack
        setTimeout(async () => {
          try {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
              await browser.tabs.reload(tab.id);
            }
          } catch(e) {}
        }, 300);
      })();
      return true;

    case "setChaosLevel":
      STATE.chaosLevel = msg.level;
      browser.storage.local.set({ chaosLevel: msg.level });
      browser.storage.session.set({ chaosLevel: msg.level });
      // Reschedule beacon timer for the new cadence
      scheduleNextBeacon(msg.level);
      sendResponse({ ok: true });
      break;

    case "setIdentityMode":
      (async () => {
        STATE.identityMode = msg.mode; // "session" or "per-tab"
        await browser.storage.local.set({ identityMode: msg.mode });
        // Adjust rotation alarm cadence
        await browser.alarms.clear("rotateIdentity");
        if (msg.mode === "session") {
          browser.alarms.create("rotateIdentity", { periodInMinutes: 1440 });
          // Restore session coherence: update UA header to session profile,
          // inject session seed into all tabs, and reload.
          const sessionData = await browser.storage.session.get(["profile"]);
          if (sessionData.profile) {
            await updateUAHeaderRule(sessionData.profile.userAgent);
          }
          const tabs = await browser.tabs.query({}).catch(() => []);
          const httpTabs = tabs.filter(t => t.url && (t.url.startsWith("http://") || t.url.startsWith("https://")));
          for (const tab of httpTabs) {
            try {
              await browser.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                world: "MAIN",
                func: (s) => {
                  try { sessionStorage.setItem("__pg_seed__", String(s)); } catch(e) {}
                },
                args: [STATE.sessionSeed],
              });
              STATE.tabSeeds[tab.id] = STATE.sessionSeed;
            } catch(e) {}
          }
          await persistTabSeeds();
          sendResponse({ ok: true });
          // Reload all tabs so pages pick up the session seed
          setTimeout(async () => {
            for (const tab of httpTabs) {
              try { await browser.tabs.reload(tab.id); } catch(e) {}
            }
          }, 300);
        } else {
          browser.alarms.create("rotateIdentity", { periodInMinutes: 30 });
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
        const tabs = await browser.tabs.query({}).catch(() => []);

        const targetTabs = allTabs
          ? tabs.filter(t => t.url && (t.url.startsWith("http://") || t.url.startsWith("https://")))
          : [];

        if (!allTabs) {
          try {
            const [active] = await browser.tabs.query({ active: true, currentWindow: true });
            if (active && active.url && (active.url.startsWith("http://") || active.url.startsWith("https://"))) {
              targetTabs.push(active);
            }
          } catch(e) {}
        }

        // Determine active tab for per-tab UA header setting
        let activeTabId = null;
        try {
          const [active] = await browser.tabs.query({ active: true, currentWindow: true });
          if (active) activeTabId = active.id;
        } catch(e) {}

        for (const tab of targetTabs) {
          // Session mode: all tabs get the same seed.
          // Per-tab mode: each tab gets a distinct seed.
          const tabSeed = STATE.identityMode === "session"
            ? sessionSeed
            : generateSessionSeed();

          try {
            await browser.scripting.executeScript({
              target: { tabId: tab.id, allFrames: true },
              world: "MAIN",
              func: (s) => {
                try { sessionStorage.setItem("__pg_seed__", String(s)); } catch(e) {}
              },
              args: [tabSeed],
            });
            STATE.tabSeeds[tab.id] = tabSeed;
          } catch(e) {}

          // Per-tab mode: set UA header to match the active tab's seed
          if (STATE.identityMode === "per-tab" && tab.id === activeTabId) {
            const profile = generateProfile(tabSeed);
            await updateUAHeaderRule(profile.userAgent);
          }
        }

        await persistTabSeeds();

        // Respond BEFORE reloading (reloading active tab kills popup)
        sendResponse({ ok: true, rotated: true });

        // Delay reload so popup receives the response first
        setTimeout(async () => {
          for (const tab of targetTabs) {
            try { await browser.tabs.reload(tab.id); } catch(e) {}
          }
        }, 300);
      })();
      return true;

    case "setSiteOverride":
      (async () => {
        const data = await browser.storage.session.get(["siteOverrides"]);
        const overrides = data.siteOverrides || {};
        overrides[msg.hostname] = msg.enabled;
        await browser.storage.session.set({ siteOverrides: overrides });
        sendResponse({ ok: true });
        // Notify all bridge.js content scripts to re-check disable flag
        notifyOverrideChanged();
        // Reload active tab after responding
        setTimeout(async () => {
          try {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
              await browser.tabs.reload(tab.id);
            }
          } catch(e) {}
        }, 300);
      })();
      return true;

    case "cleanCookiesNow":
      cleanThirdPartyCookies().then(count => {
        sendResponse({ ok: true, cleaned: count });
      });
      return true;

    case "fireBeaconsNow":
      // Manual fire: try page-context via bridge.js.
      (async () => {
        const configs = POISONER.buildBatchConfigs(STATE.chaosLevel);
        let usedPageContext = false;
        try {
          const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
          if (tab && tab.id && tab.url &&
              (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
            const domPayload = POISONER.buildDOMChaffPayload(STATE.chaosLevel);
            await browser.tabs.sendMessage(tab.id, {
              type: "queueChaff",
              configs: configs,
              domChaff: domPayload,
            });
            usedPageContext = true;
          }
        } catch(e) {}
        // No background fallback — page-context only (item 4 invariant).
        // Stats arrive via chaffFired callback from bridge.js.
        sendResponse({ ok: true, queued: usedPageContext, count: configs.length });
      })();
      return true;

    case "getStats":
      sendResponse({ stats: STATE.stats });
      break;

    case "setDisableFlag":
      // Legacy path — bridge.js no longer sends this (uses checkSiteOverride
      // instead). Retained for backward compatibility during transition.
      if (sender.tab && Number.isInteger(sender.tab.id)) {
        const tabId = sender.tab.id;
        const disabled = msg.disabled;
        browser.scripting.executeScript({
          target: { tabId: tabId },
          world: "MAIN",
          func: (flag) => {
            try {
              if (flag) document.cookie = "__pgd=1;path=/;SameSite=Lax";
              else document.cookie = "__pgd=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT";
            } catch(e) {}
          },
          args: [disabled],
        }).catch(() => {});
      }
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

    case "seedObserved":
      // Bridge.js (ISOLATED world) read the seed from sessionStorage
      // (shared with MAIN world anti-fingerprint.js) and sent it here.
      if (sender.tab && Number.isInteger(sender.tab.id) && msg.seed) {
        const observedSeed = parseInt(msg.seed, 10);
        (async () => {
          try {
            if (STATE.identityMode === "session") {
              if (observedSeed !== STATE.sessionSeed && STATE.sessionSeed) {
                // Item 2: Silently correct sessionStorage for future
                // same-origin navigations. Do NOT reload — the reload itself
                // is a fingerprinting signal (performance.navigation.type === 1).
                // The first page load is the documented residual gap; all
                // subsequent navigations on this origin will use the correct seed.
                await browser.scripting.executeScript({
                  target: { tabId: sender.tab.id, allFrames: true },
                  world: "MAIN",
                  func: (s) => {
                    try { sessionStorage.setItem("__pg_seed__", String(s)); } catch(e) {}
                  },
                  args: [STATE.sessionSeed],
                }).catch(() => {});
                // Store the SESSION seed, not the observed (wrong) seed
                STATE.tabSeeds[sender.tab.id] = STATE.sessionSeed;
                await persistTabSeeds();
                return;
              }
              // Seed matches session — store it
              STATE.tabSeeds[sender.tab.id] = observedSeed;
              await persistTabSeeds();
            } else {
              // Per-tab mode: store and update UA if active tab
              STATE.tabSeeds[sender.tab.id] = observedSeed;
              await persistTabSeeds();
              const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
              if (activeTab && activeTab.id === sender.tab.id) {
                const profile = generateProfile(observedSeed);
                await updateUAHeaderRule(profile.userAgent);
              }
            }
          } catch(e) {}
        })();
      }
      break;

    case "checkSiteOverride":
      // Bridge.js asks background to evaluate enabled/siteOverrides and
      // set/clear the __pgd cookie. Replaces the old bridge.js approach
      // of reading browser.storage.session directly (which silently failed).
      if (sender.tab && Number.isInteger(sender.tab.id)) {
        (async () => {
          try {
            const data = await browser.storage.session.get(["enabled", "siteOverrides"]);
            const overrides = data.siteOverrides || {};
            const shouldDisable = overrides[msg.hostname] === false || data.enabled === false;
            browser.scripting.executeScript({
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

// === Tab lifecycle: clean up tabSeeds and update UA header ===
browser.tabs.onRemoved.addListener(async (tabId) => {
  delete STATE.tabSeeds[tabId];
  await persistTabSeeds();
});

// When user switches tabs, update the UA header to match the new
// active tab's identity. Session mode: no-op (UA is always the session
// identity). Per-tab mode: switch UA to the new tab's seed.
browser.tabs.onActivated.addListener(async (activeInfo) => {
  if (STATE.identityMode === "session") return; // UA is already correct
  const seed = STATE.tabSeeds[activeInfo.tabId];
  if (seed) {
    const profile = generateProfile(seed);
    await updateUAHeaderRule(profile.userAgent);
  } else {
    // Tab hasn't reported a seed yet — use the rotation identity
    const sessionData = await browser.storage.session.get(["profile"]);
    if (sessionData.profile) {
      await updateUAHeaderRule(sessionData.profile.userAgent);
    }
  }
});

// === Notify bridge.js content scripts of override changes ===
// Sends a message to all tabs so bridge.js can re-check the disable
// flag. Replaces the old browser.storage.onChanged approach (content
// scripts can't listen for session storage changes without setAccessLevel).
async function notifyOverrideChanged() {
  try {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
        browser.tabs.sendMessage(tab.id, { type: "overrideChanged" }).catch(() => {});
      }
    }
  } catch(e) {}
}

// === Stats Persistence ===
async function persistStats() {
  try {
    await browser.storage.local.set({ stats: STATE.stats });
  } catch(e) {}
}

// === Tab Seeds Persistence ===
// Persists tabSeeds to browser.storage.session so they survive
// background script idle/restart. Without this, restart causes getState
// and tabs.onActivated to fall back to the rotation profile while
// pages keep their sessionStorage seeds.
async function persistTabSeeds() {
  try {
    await browser.storage.session.set({ tabSeeds: STATE.tabSeeds });
  } catch(e) {}
}
