/**
 * PhantomGrid — Bridge Content Script (ISOLATED world)
 *
 * Rowan pass 5 rewrite (2026-05-08):
 * - Reads seed from sessionStorage (shared with MAIN world) and syncs
 *   it to background.js via chrome.runtime.sendMessage.
 * - DOES NOT use chrome.storage.session (not accessible from content
 *   scripts without setAccessLevel — all previous .set()/.get() calls
 *   were silently failing, which was the root cause of the side panel
 *   identity mismatch).
 * - Handles site override / disable by asking background.js, which
 *   sets the __pgd cookie via chrome.scripting.executeScript (CSP-safe).
 * - Only the top frame syncs the seed (iframe desync prevention).
 *
 * Item 2 note (2026-05-12): seedObserved desync no longer triggers tab
 * reload. Background silently corrects sessionStorage instead. The reload
 * was itself a fingerprinting signal (performance.navigation.type === 1).
 */

(function() {
  "use strict";

  // === Read seed from sessionStorage and send to background ===
  // ISOLATED world shares sessionStorage with MAIN world, so we can
  // read __pg_seed__ directly. No postMessage needed (lux review: the
  // old postMessage broadcast was visible to any tracker script on the
  // page and could be used as a tracking identifier).
  //
  // Sends { type: "seedObserved", seed } to background.js instead of
  // writing to chrome.storage.session (which silently fails from
  // content scripts without setAccessLevel).
  function syncSeedToExtension() {
    if (window !== window.top) return false;

    try {
      const raw = sessionStorage.getItem("__pg_seed__");
      if (raw) {
        const seed = parseInt(raw, 10);
        if (seed) {
          chrome.runtime.sendMessage({ type: "seedObserved", seed: seed });
          return true;
        }
      }
    } catch(e) {}
    return false;
  }

  // === Check site overrides ===
  // Asks background.js to evaluate enabled/siteOverrides state and
  // set/clear the __pgd cookie disable flag via executeScript.
  // Previous version tried chrome.storage.session.get() which silently
  // failed from content scripts.
  function checkSiteOverride() {
    try {
      chrome.runtime.sendMessage({
        type: "checkSiteOverride",
        hostname: window.location.hostname,
      });
    } catch(e) {}
  }

  // === Interaction-coupled chaff queue (v2 item 4) ===
  // Background sends beacon configs here via chrome.tabs.sendMessage.
  // ISOLATED world fires beacons from the page's network identity
  // (real Referer, real cookies) but page scripts CANNOT observe
  // ISOLATED world's fetch/sendBeacon calls or event listeners.
  //
  // Queue is a singleton per page load. Navigation clears it
  // naturally (content script re-runs). Only one armed batch at a
  // time — new configs replace the pending batch, not stack.
  let _chaffQueue = null; // null = no armed batch
  let _chaffListenersActive = false;
  let _chaffFallbackTimer = null; // singleton 5-min fallback timer

  function _fireChaffBatch() {
    if (!_chaffQueue || _chaffQueue.length === 0) return;

    const configs = _chaffQueue;
    _chaffQueue = null;
    _clearChaffFallbackTimer();
    _removeChaffListeners();

    // sendBeacon only — no fetch fallback from content script.
    // DNR rules block google-analytics.com for xmlhttprequest (rule 103)
    // and strip Referer from third-party xmlhttprequest (rule 1).
    // sendBeacon uses Chrome's "ping" resource type, which is NOT listed
    // in any DNR blocking/stripping rule. This is the only safe content-
    // script transport for chaff URLs that are also in the tracker blocklist.
    //
    // sendBeacon returns true = browser accepted into beacon queue.
    // Returns false = queue full or page unloading. Only true counts as
    // "browser-accepted dispatch" in stats.
    let accepted = 0;
    let completed = 0;
    const total = configs.length;

    configs.forEach(function(cfg, i) {
      // Stagger beacons: 50-250ms between each
      setTimeout(function() {
        try {
          if (navigator.sendBeacon && navigator.sendBeacon(cfg.url)) {
            accepted++;
          }
        } catch(e) {}

        // Track completed callbacks, not index order. setTimeout
        // execution order is not strictly guaranteed when delays
        // are randomized; an earlier index can complete after a
        // later index. Report when all callbacks have fired.
        completed++;
        if (completed === total) {
          setTimeout(function() {
            try {
              chrome.runtime.sendMessage({
                type: "chaffFired",
                count: accepted,
              });
            } catch(e) {}
          }, 100);
        }
      }, i * (50 + Math.floor(Math.random() * 250)));
    });
  }

  function _onChaffInteraction() {
    _fireChaffBatch();
  }

  // Scroll debounce: avoid firing on every scroll event
  let _chaffScrollTimer = null;
  function _onChaffScroll() {
    if (_chaffScrollTimer) return;
    _chaffScrollTimer = setTimeout(function() {
      _chaffScrollTimer = null;
      _fireChaffBatch();
    }, 200);
  }

  function _clearChaffFallbackTimer() {
    if (_chaffFallbackTimer) {
      clearTimeout(_chaffFallbackTimer);
      _chaffFallbackTimer = null;
    }
  }

  function _setupChaffListeners() {
    if (_chaffListenersActive) return;
    _chaffListenersActive = true;
    document.addEventListener("click", _onChaffInteraction, { capture: true });
    document.addEventListener("keydown", _onChaffInteraction, { capture: true });
    document.addEventListener("scroll", _onChaffScroll, { capture: true, passive: true });
  }

  function _removeChaffListeners() {
    if (!_chaffListenersActive) return;
    _chaffListenersActive = false;
    document.removeEventListener("click", _onChaffInteraction, true);
    document.removeEventListener("keydown", _onChaffInteraction, true);
    document.removeEventListener("scroll", _onChaffScroll, true);
    if (_chaffScrollTimer) {
      clearTimeout(_chaffScrollTimer);
      _chaffScrollTimer = null;
    }
  }

  // === DOM Chaff — attribute injection into ad containers (v2 item 4) ===
  // Applies HTML-attribute-level chaff metadata to existing ad/tracker
  // containers found on the page. One-shot per page load (no mutation
  // observer, no repeated injection). Uses data: URI pixels only —
  // no network requests from DOM chaff path.
  let _domChaffApplied = false;

  function _applyDOMChaff(configs) {
    if (_domChaffApplied) return 0;
    _domChaffApplied = true;

    let applied = 0;
    for (const cfg of configs) {
      let el;
      try { el = document.querySelector(cfg.selector); } catch(e) { continue; }
      if (!el) continue;

      for (const attr of cfg.attributes) {
        if (!el.hasAttribute(attr.key)) {
          el.setAttribute(attr.key, attr.value);
        }
      }

      if (cfg.injectPixel && cfg.pixelSrc) {
        const img = document.createElement("img");
        img.src = cfg.pixelSrc;
        img.width = 1;
        img.height = 1;
        img.style.cssText = "position:absolute;left:-9999px;top:-9999px;opacity:0;pointer-events:none;";
        img.setAttribute("data-ad-status", "filled");
        el.appendChild(img);
      }

      applied++;
    }
    return applied;
  }

  // === Listen for messages from background ===
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "overrideChanged") {
      checkSiteOverride();
    } else if (msg.type === "queueChaff" && Array.isArray(msg.configs)) {
      // Replace any pending batch (prevents stacking — BLOCKER 3 fix).
      // Only top frame handles chaff (iframes don't fire beacons).
      if (window !== window.top) return;

      _chaffQueue = msg.configs;
      _setupChaffListeners();

      // Singleton fallback timer: clear any previous timer before arming.
      // Prevents stacked timers from firing old/new batches at wrong times.
      _clearChaffFallbackTimer();
      _chaffFallbackTimer = setTimeout(function() {
        _chaffFallbackTimer = null;
        if (_chaffQueue) _fireChaffBatch();
      }, 5 * 60 * 1000);
    } else if (msg.type === "queueDOMChaff" && Array.isArray(msg.configs)) {
      if (window !== window.top) return;
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function() {
          const count = _applyDOMChaff(msg.configs);
          try {
            chrome.runtime.sendMessage({ type: "domChaffApplied", count: count });
          } catch(e) {}
        }, { once: true });
      } else {
        const count = _applyDOMChaff(msg.configs);
        try {
          chrome.runtime.sendMessage({ type: "domChaffApplied", count: count });
        } catch(e) {}
      }
    }
  });

  // === Initialize ===
  // Retry seed sync: MAIN world (anti-fingerprint.js) and ISOLATED world
  // (this script) both run at document_start. Execution order between
  // worlds is not guaranteed. If we run before anti-fingerprint.js writes
  // the seed to sessionStorage, the first read returns null. Retry with
  // short delays to catch it once it appears.
  if (!syncSeedToExtension()) {
    let retries = 0;
    const retrySeed = () => {
      if (syncSeedToExtension() || ++retries >= 10) return;
      setTimeout(retrySeed, 50);
    };
    setTimeout(retrySeed, 10);
  }
  checkSiteOverride();
})();
