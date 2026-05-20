/**
 * Duppel — Anti-Fingerprint Entry Point
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

  // Seed convergence via event listener — background.js dispatches a
  // CustomEvent('__pgc') when the content script won the seed pre-injection
  // race. Event listeners have zero observable window properties: not
  // discoverable via in/Object.keys/GOPN/typeof/getOwnPropertyDescriptor.
  // Only the non-standard DevTools getEventListeners() can list them,
  // which is not available to page scripts.
  //
  // dispatchEvent() is synchronous — the handler runs inline during the
  // dispatch call, so the profile is updated before the injection script
  // returns. Same timing guarantee as a synchronous function call.
  //
  // The handler self-removes after first invocation (one-shot). The
  // setTimeout fallback removes it if neither background path fires
  // (e.g., STATE.sessionSeed=0 during initialization, <50ms window).
  const _onConverge = function(e) {
    ctx.convergeToSeed(e.detail);
    window.removeEventListener('__pgc', _onConverge);
  };
  try {
    window.addEventListener('__pgc', _onConverge);
  } catch(e) {}

  installNavigator(ctx);
  installScreen(ctx);
  installCanvas(ctx);
  installWebGL(ctx);
  installAudio(ctx);
  installBiometric(ctx);
  installMisc(ctx);
  installIframe(ctx); // after installCanvas (needs ctx.applyCanvasNoise)

  // Cleanup fallback: remove convergence listener after generous delay.
  // Primary cleanup is the one-shot self-removal in _onConverge itself.
  // This setTimeout catches the case where neither background path fires.
  // 200ms is well after pre-injection (~1-5ms) but before fingerprinting
  // scripts run (DOMContentLoaded or later on real pages). The listener
  // is harmless even if not removed — it's not discoverable by page scripts.
  try {
    setTimeout(function() {
      try { window.removeEventListener('__pgc', _onConverge); } catch(e) {}
    }, 200);
  } catch(e) {}
})();
