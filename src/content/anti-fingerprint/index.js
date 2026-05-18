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

(function() {
  "use strict";
  const ctx = createContext();
  if (!ctx) return; // disabled via cookie
  installNavigator(ctx);
  installScreen(ctx);
  installCanvas(ctx);
  installWebGL(ctx);
  installAudio(ctx);
  installBiometric(ctx);
  installMisc(ctx);
})();
