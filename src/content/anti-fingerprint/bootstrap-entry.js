/**
 * Duppel — Anti-Fingerprint Bootstrap Entry Point (Round 6)
 *
 * Closure-local bootstrap for executeScript injection.
 * esbuild bundles this into an IIFE; post-build wraps the body in
 * `function bootstrapAntiFingerprint(seed) { ... }` for importScripts
 * in the service worker. The `seed` parameter is a free variable here —
 * it becomes a closure-local argument when background.js passes this
 * function to chrome.scripting.executeScript({ func, args: [seed] }).
 *
 * Round 6 architecture (rowan + lux gate, 2026-05-21):
 * - Zero window.__pg_s. Zero named page-world rendezvous.
 * - Seed delivered as closure-local arg only.
 * - No deferred setter trap. No dead setter. No window flags.
 * - Idempotence tracked extension-side (tabId/documentId).
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

// Wrapped in IIFE so esbuild allows `return` statements.
// The post-build step strips both the esbuild outer IIFE and this inner
// one, leaving the body inside `function bootstrapAntiFingerprint(seed)`.
(function() {
  "use strict";

  // === Disable check (before any work) ===
  // __pgd cookie set by background.js via checkSiteOverride.
  try {
    if (document.cookie.split(";").some(function(c) { return c.trim().startsWith("__pgd=1"); })) return;
  } catch(e) {}

  // seed is a closure-local parameter from the enclosing
  // bootstrapAntiFingerprint(seed) function wrapper.
  if (typeof seed !== 'number') return;

  var ctx = createContext(seed);
  if (!ctx) return;

  // Each module is wrapped in try/catch so a single module failure
  // doesn't disable the entire anti-fingerprint suite.
  // Order matters: canvas MUST run before webgl and iframe
  // (canvas exports ctx.applyCanvasNoise).
  try { installNavigator(ctx); } catch(e) {}
  try { installScreen(ctx); } catch(e) {}
  try { installCanvas(ctx); } catch(e) {}
  try { installWebGL(ctx); } catch(e) {}
  try { installAudio(ctx); } catch(e) {}
  try { installBiometric(ctx); } catch(e) {}
  try { installMisc(ctx); } catch(e) {}
  try { installIframe(ctx); } catch(e) {}
})();
