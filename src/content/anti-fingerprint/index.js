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
  // Non-enumerable to minimize detection surface. Configurable for cleanup.
  try {
    Object.defineProperty(window, '__pg_converge__', {
      value: function(correctSeed) {
        ctx.convergeToSeed(correctSeed);
      },
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
})();
