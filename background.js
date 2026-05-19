/**
 * PhantomGrid — Background Service Worker
 * Manages identity rotation, cookie cleanup, tracker monitoring,
 * and fake beacon generation.
 */

importScripts("profiles.js", "poisoner.js");

// === Storage Architecture (v2 Item 1: Session-Level Identity Default) ===
// Three storage layers serve different lifetimes:
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
// 3. sessionStorage (MAIN world) — Per-tab, per-origin.
//    Stores: __pg_seed__ — the seed anti-fingerprint.js uses to derive its profile.
//    Set by background.js via chrome.scripting.executeScript (MAIN world injection).
//    Read by both anti-fingerprint.js (MAIN) and bridge.js (ISOLATED, shared storage).
//    Dies when the tab closes or navigates cross-origin.
//
// Identity lifetime (session mode, the default):
//   One identity per browser session, rotating every 24h (alarm-based).
//   On browser restart, chrome.storage.session is empty → restoreState() finds
//   no profile → calls rotateIdentity() → fresh identity + new UA rule.
//   The 24h alarm also rotates within a running session.
//
// Cold-start alignment (Item 2):
//   On cold start, restoreState() reads lastSeed/lastUA from chrome.storage.local
//   and applies the stale UA to the DNR rule immediately, before rotateIdentity()
//   generates a fresh identity (~ms later). Pre-injection via chrome.tabs.onUpdated
//   (injectImmediately:true) races the session seed into sessionStorage before
//   anti-fingerprint.js runs. If pre-injection wins, no desync occurs.
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
    console.error('[PhantomGrid] Failed to set WebRTC policy:', e);
  }
}
applyWebRTCPolicy();

// === Initialization ===
chrome.runtime.onInstalled.addListener(async () => {
  // WebRTC policy — also applied at top-level, but re-apply on install
  // to ensure the setting takes effect even if the initial top-level
  // call raced with permission grant.
  await applyWebRTCPolicy();

  // Generate initial identity (writes profile to session storage, updates UA)
  await createIdentity();

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

  // Select initial poisoner persona
  POISONER.selectPersona();

  // Set up periodic alarms
  // Session mode: 24h rotation (realistic browser session cadence)
  chrome.alarms.create("rotateIdentity", { periodInMinutes: 1440 });
  chrome.alarms.create("cleanCookies", { periodInMinutes: 15 });
  // Poison beacons use variable timing — schedule the first one
  scheduleNextBeacon("balanced");
});

// Restore state on service worker wake (also runs when SW wakes from idle)
async function restoreState() {
  const data = await chrome.storage.local.get(["stats", "chaosLevel", "identityMode"]);
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

  // Item 2: On cold start (no session profile), apply stale UA from local
  // storage immediately so the DNR rule has a spoofed value before any
  // navigation fires. rotateIdentity() below overwrites with fresh UA ~ms later.
  if (!sessionData.profile) {
    const local = await chrome.storage.local.get(["lastSeed", "lastUA"]);
    if (local.lastUA) {
      await updateUAHeaderRule(local.lastUA);
    }
    await rotateIdentity();
  } else {
    // Re-apply UA header rule from stored profile. DNR dynamic rules
    // persist across SW restarts, but re-applying ensures the rule
    // matches the current profile after extension updates or if the
    // rule was cleared for any reason.
    await updateUAHeaderRule(sessionData.profile.userAgent);
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

// === Item 2: Seed Pre-injection ===
// Pre-inject session seed into sessionStorage before content scripts run.
// chrome.tabs.onUpdated fires with status "loading" when a navigation commits.
// injectImmediately:true races ahead of document_start content scripts.
// If the injection wins, anti-fingerprint.js finds __pg_seed__ already set
// and uses the session profile — no desync, no reload.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading") return;
  if (!STATE.sessionSeed || !STATE.enabled) return;
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;

  const seedToInject = (STATE.identityMode === "session")
    ? STATE.sessionSeed
    : (STATE.tabSeeds[tabId] || STATE.sessionSeed);

  chrome.scripting.executeScript({
    // allFrames:false is intentional — pre-inject into the top frame only.
    // Cross-origin iframes have their own sessionStorage partitions and cannot
    // share __pg_seed__ with the top frame. Injecting into iframes would write
    // seeds that anti-fingerprint.js in those frames may or may not read
    // (depends on iframe origin). The cross-origin iframe residual is explicit
    // and accepted as a boundary of Item 2's alignment guarantee.
    target: { tabId: tabId, allFrames: false },
    world: "MAIN",
    injectImmediately: true,
    func: (s, isSession) => {
      try {
        const existing = sessionStorage.getItem("__pg_seed__");
        if (!existing) {
          // Pre-injection won the race: set seed before content script reads it.
          sessionStorage.setItem("__pg_seed__", String(s));
        } else if (isSession && parseInt(existing, 10) !== s) {
          // Seed race: content script generated a random seed before
          // pre-injection arrived. Overwrite sessionStorage and call
          // the convergence function to update the live profile in place.
          // This runs at document_start timing, before page scripts execute.
          sessionStorage.setItem("__pg_seed__", String(s));
          if (typeof window.__pg_converge__ === "function") {
            window.__pg_converge__(s);
          }
        }
        // Primary cleanup: delete convergence hook immediately after use.
        // Pre-injection is the first background path to run — once it has
        // either converged or confirmed no mismatch, the hook is no longer
        // needed. Deleting here ensures the hook is not observable by page
        // scripts (pre-injection runs at document_start before page JS).
        try { delete window.__pg_converge__; } catch(e2) {}
      } catch(e) {}
    },
    args: [seedToInject, STATE.identityMode === "session"],
  }).catch(() => {}); // Tab may not be injectable (chrome://, devtools, etc.)
});

// === Dynamic User-Agent Header Rule ===
// Updates the declarativeNetRequest dynamic rule to spoof the UA HTTP header
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

// === Identity Rotation ===
// Single authority: background owns seed + profile.
// createIdentity() generates a new seed, derives the profile, writes
// to chrome.storage.session, and updates the UA header. The stored
// profile serves as fallback for getState when no tab-specific seed
// is available (e.g., before any page has loaded after rotation).
// Tab-specific seeds from bridge.js (seedObserved) take precedence
// in getState — see tabSeeds.
async function createIdentity(seed) {
  if (seed === undefined) seed = generateSessionSeed();
  STATE.currentSeed = seed;
  STATE.sessionSeed = seed;
  const profile = generateProfile(seed);
  await chrome.storage.session.set({ profile: profile, sessionSeed: seed });
  // Item 2: persist for cold-start recovery. On next browser launch,
  // restoreState() reads lastSeed/lastUA to bootstrap the DNR rule
  // before rotateIdentity() generates a fresh identity.
  await chrome.storage.local.set({ lastSeed: seed, lastUA: profile.userAgent });
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
        let usedPageContext = false;
        try {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (tab && tab.id && tab.url &&
              (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
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
            usedPageContext = true;
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
          // Restore session coherence: update UA header to session profile,
          // inject session seed into all tabs, and reload.
          const sessionData = await chrome.storage.session.get(["profile"]);
          if (sessionData.profile) {
            await updateUAHeaderRule(sessionData.profile.userAgent);
          }
          const tabs = await chrome.tabs.query({}).catch(() => []);
          const httpTabs = tabs.filter(t => t.url && (t.url.startsWith("http://") || t.url.startsWith("https://")));
          for (const tab of httpTabs) {
            try {
              await chrome.scripting.executeScript({
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

          try {
            await chrome.scripting.executeScript({
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

    case "setDisableFlag":
      // Legacy path — bridge.js no longer sends this (uses checkSiteOverride
      // instead). Retained for backward compatibility during transition.
      if (sender.tab && Number.isInteger(sender.tab.id)) {
        const tabId = sender.tab.id;
        const disabled = msg.disabled;
        chrome.scripting.executeScript({
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

    case "testDNRChaff":
      // Diagnostic: prove sendBeacon (ping) bypasses DNR rules while
      // fetch (xmlhttprequest) is blocked. Uses testMatchOutcome() which
      // requires declarativeNetRequestFeedback permission.
      // Call from extension console: chrome.runtime.sendMessage({type:"testDNRChaff"}, r => console.log(JSON.stringify(r, null, 2)))
      (async () => {
        try {
          const testUrls = [
            "https://www.google-analytics.com/collect?v=1&t=pageview",
            "https://www.google-analytics.com/g/collect?v=2&en=page_view",
            "https://www.facebook.com/tr/?id=123456&ev=PageView",
          ];
          const results = [];
          for (const url of testUrls) {
            // Test as "ping" (sendBeacon resource type)
            const pingResult = await chrome.declarativeNetRequest.testMatchOutcome({
              url: url,
              type: "ping",
              initiator: "https://example.com",
            });
            // Test as "xmlhttprequest" (fetch resource type)
            const xhrResult = await chrome.declarativeNetRequest.testMatchOutcome({
              url: url,
              type: "xmlhttprequest",
              initiator: "https://example.com",
            });
            results.push({
              url: url.substring(0, 60),
              ping: { matched: pingResult.matchedRules.length, rules: pingResult.matchedRules },
              xmlhttprequest: { matched: xhrResult.matchedRules.length, rules: xhrResult.matchedRules },
            });
          }
          sendResponse({ ok: true, results: results });
        } catch(e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;

    case "seedObserved":
      // Bridge.js (ISOLATED world) read the seed from sessionStorage
      // (shared with MAIN world anti-fingerprint.js) and sent it here.
      if (sender.tab && Number.isInteger(sender.tab.id) && msg.seed) {
        const observedSeed = parseInt(msg.seed, 10);
        (async () => {
          try {
            if (STATE.identityMode === "session") {
              if (observedSeed !== STATE.sessionSeed && STATE.sessionSeed) {
                // Item 2: Correct sessionStorage and converge the live profile.
                // The pre-injection may have already converged (if it ran after
                // the content script but before bridge.js). convergeToSeed is
                // idempotent — calling it twice with the same seed is a no-op.
                // No reload needed — convergence updates profile in place.
                await chrome.scripting.executeScript({
                  target: { tabId: sender.tab.id, allFrames: true },
                  world: "MAIN",
                  func: (s) => {
                    try {
                      sessionStorage.setItem("__pg_seed__", String(s));
                      if (typeof window.__pg_converge__ === "function") {
                        window.__pg_converge__(s);
                      }
                      // Cleanup: delete convergence hook after use. If pre-injection
                      // already deleted it, this is a no-op (delete on non-existent
                      // configurable property returns true silently).
                      try { delete window.__pg_converge__; } catch(e2) {}
                    } catch(e) {}
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
              const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
      // of reading chrome.storage.session directly (which silently failed).
      if (sender.tab && Number.isInteger(sender.tab.id)) {
        (async () => {
          try {
            const data = await chrome.storage.session.get(["enabled", "siteOverrides"]);
            const overrides = data.siteOverrides || {};
            const shouldDisable = overrides[msg.hostname] === false || data.enabled === false;
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

// === Tab lifecycle: clean up tabSeeds and update UA header ===
chrome.tabs.onRemoved.addListener(async (tabId) => {
  delete STATE.tabSeeds[tabId];
  await persistTabSeeds();
});

// When user switches tabs, update the UA header to match the new
// active tab's identity. Session mode: no-op (UA is always the session
// identity). Per-tab mode: switch UA to the new tab's seed.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (STATE.identityMode === "session") return; // UA is already correct
  const seed = STATE.tabSeeds[activeInfo.tabId];
  if (seed) {
    const profile = generateProfile(seed);
    await updateUAHeaderRule(profile.userAgent);
  } else {
    // Tab hasn't reported a seed yet — use the rotation identity
    const sessionData = await chrome.storage.session.get(["profile"]);
    if (sessionData.profile) {
      await updateUAHeaderRule(sessionData.profile.userAgent);
    }
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
// and tabs.onActivated to fall back to the rotation profile while
// pages keep their sessionStorage seeds.
async function persistTabSeeds() {
  try {
    await chrome.storage.session.set({ tabSeeds: STATE.tabSeeds });
  } catch(e) {}
}
