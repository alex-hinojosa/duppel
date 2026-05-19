/**
 * PhantomGrid — Anti-Fingerprint Entry Point
 * Imports all modules and calls install functions in order.
 * esbuild bundles this back to a single IIFE for content script injection.
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
  const ctx = createContext();
  if (!ctx) return; // disabled via cookie

  // Seed convergence: expose for background.js to call when the content
  // script won the seed pre-injection race. Background's pre-injection
  // or seedObserved handler calls __pg_converge__(correctSeed) to update
  // the live profile before page scripts can observe it.
  //
  // Detection surface mitigation:
  //   - Non-enumerable: invisible to for...in, Object.keys()
  //   - toString disguised: returns "function __pg_converge__() { [native code] }"
  //   - Cleanup: primary cleanup by background.js injection scripts (delete
  //     immediately after use). Fallback cleanup via setTimeout(200) — well
  //     after pre-injection (~1-5ms) but before fingerprinting scripts run
  //     (DOMContentLoaded or later). Page scripts cannot detect this property.
  //
  // Protection boundary:
  //   Path A (pre-injection, primary): runs at document_start timing via
  //   chrome.scripting.executeScript(injectImmediately:true). Executes AFTER
  //   this content script yields. Hook is still alive. Deterministic.
  //   Path B (seedObserved, fallback): async round-trip via bridge.js →
  //   background → executeScript. Best-effort only — hook may be cleaned up
  //   before Path B arrives. Only needed if pre-injection skipped entirely
  //   (STATE.sessionSeed=0 during initialization, <50ms window).
  try {
    const _converge = function(correctSeed) {
      ctx.convergeToSeed(correctSeed);
    };
    // Disguise toString to match native function signature
    ctx._nativeStrings.set(_converge, 'function __pg_converge__() { [native code] }');

    Object.defineProperty(window, '__pg_converge__', {
      value: _converge,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  } catch(e) {}

  installNavigator(ctx);
  installScreen(ctx);
  installCanvas(ctx);
  installWebGL(ctx);
  installAudio(ctx);
  installBiometric(ctx);
  installMisc(ctx);
  installIframe(ctx); // after installCanvas (needs ctx.applyCanvasNoise)

  // Cleanup fallback: delete convergence hook after generous delay.
  // Primary cleanup is in background.js — pre-injection and seedObserved
  // correction scripts delete the hook immediately after use. This
  // setTimeout is a final fallback for the rare case where neither
  // background path runs (e.g., STATE.sessionSeed=0 during init).
  // 200ms is well after pre-injection completes (~1-5ms) but before
  // fingerprinting scripts run (DOMContentLoaded or later on real pages).
  try {
    setTimeout(function() {
      try { delete window.__pg_converge__; } catch(e) {}
    }, 200);
  } catch(e) {}
})();
