/**
 * Duppel — Anti-Fingerprint Entry Point
 * Imports all modules and calls install functions in order.
 * esbuild bundles this back to a single IIFE for content script injection.
 *
 * Round 5 seed delivery (2026-05-21):
 * - Reads window.__pg_s (set by background executeScript, direct assignment).
 * - If seed present: immediate bootstrap.
 * - If seed absent: one-shot setter trap waits for executeScript delivery,
 *   then bootstraps when the seed arrives. No random fallback.
 * - Cookie channel REMOVED — cookies leak in HTTP headers to Cloudflare.
 * - Dead setter installed after bootstrap to swallow late writes.
 */

import { createContext } from './core.js';
import { installNavigator } from './navigator.js';
import { installScreen } from './screen.js';
import { installCanvas } from './canvas.js';
import { installWebGL } from './webgl.js';
import { installAudio } from './audio.js';
import { installBiometric } from './biometric.js';
import { installMisc } from './misc.js';
import { installIframe } from './iframe.js';

(function() {
  "use strict";

  // === Disable check (before any work) ===
  try {
    if (document.cookie.split(";").some(function(c) { return c.trim().startsWith("__pgd=1"); })) return;
  } catch(e) {}

  // Bootstrap: install all anti-fingerprint modules from a validated seed.
  // Called immediately if executeScript already delivered the seed, or
  // deferred via the setter trap when executeScript arrives later.
  function doBootstrap(seed) {
    if (typeof seed !== 'number') return;

    var ctx = createContext(seed);
    if (!ctx) return;

    // Each module is wrapped in try/catch so a single module failure
    // doesn't disable the entire anti-fingerprint suite.
    try { installNavigator(ctx); } catch(e) {}
    try { installScreen(ctx); } catch(e) {}
    try { installCanvas(ctx); } catch(e) {}
    try { installWebGL(ctx); } catch(e) {}
    try { installAudio(ctx); } catch(e) {}
    try { installBiometric(ctx); } catch(e) {}
    try { installMisc(ctx); } catch(e) {}
    try { installIframe(ctx); } catch(e) {} // after installCanvas (needs ctx.applyCanvasNoise)

    // Dead setter: prevents late-arriving executeScript or page JS from
    // creating a visible window.__pg_s property. Writes are silently
    // discarded. Non-enumerable, self-destructs after 100ms.
    try {
      ctx.ORIG.defineProperty.call(Object, window, '__pg_s', {
        set: function() {},
        get: function() { return undefined; },
        configurable: true,
        enumerable: false
      });
      setTimeout(function() {
        try { delete window.__pg_s; } catch(e) {}
      }, 100);
    } catch(e) {}
  }

  // === Seed delivery: immediate or deferred ===
  // Background.js delivers the seed via executeScript (direct assignment
  // to window.__pg_s, injectImmediately). This races with the content
  // script's document_start execution.
  //
  // Immediate: executeScript won the race — seed is already on window.
  // Deferred:  executeScript hasn't arrived — set up a one-shot setter
  //            trap that fires doBootstrap when the seed is written.
  //
  // At document_start, only content scripts run — no page JS yet.
  // The deferred trap fires before any page script can interact with it.
  var seed;
  try {
    if (typeof window.__pg_s === 'number') {
      seed = window.__pg_s;
    }
  } catch(e) {}

  if (seed !== undefined) {
    // Immediate: executeScript delivered the seed before we ran.
    try { delete window.__pg_s; } catch(e) {}
    doBootstrap(seed);
  } else {
    // Deferred: set up one-shot setter trap for when executeScript arrives.
    // The trap is non-enumerable and returns undefined on read — invisible
    // to page JS enumeration. When executeScript writes the seed via
    // direct assignment (window.__pg_s = n), the setter fires, removes
    // itself, and triggers the full bootstrap.
    var _bootstrapped = false;
    try {
      Object.defineProperty(window, '__pg_s', {
        set: function(s) {
          if (_bootstrapped) return; // one-shot guard
          _bootstrapped = true;
          try { delete window.__pg_s; } catch(e) {}
          doBootstrap(s);
        },
        get: function() { return undefined; },
        configurable: true,
        enumerable: false
      });
      // Auto-cleanup: if seed doesn't arrive within 200ms, remove the
      // trap so __pg_s is not discoverable via Object.getOwnPropertyNames.
      // After 200ms, if executeScript hasn't arrived, it's a race loss —
      // equivalent to all-or-nothing (no spoofing, native UA matches).
      setTimeout(function() {
        try { delete window.__pg_s; } catch(e) {}
      }, 200);
    } catch(e) {}
  }
})();
