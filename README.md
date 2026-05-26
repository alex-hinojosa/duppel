# Duppel

Anti-fingerprinting browser extension for Chrome (Manifest V3). Spoofs browser fingerprint surfaces, strips tracking parameters, poisons tracker data collection, and rotates identity on a schedule — all without breaking normal browsing.

## Release status

**Current release:** v0.1.1

**Verified release commit:** `73bde1f3f95f8e4a19210aff772e3c05415f8695`

**Release artifact:** `duppel-v0.1.1.zip`

**Artifact SHA256:** `05d884ccff2011e217df07beaaff5eb5e108abf35ea3f0e978c4823d78085ab5`

v0.1.1 introduces strict-next-nav coherence. The first document navigation stays native, then Duppel applies the spoofed persona on the next navigation. This prevents first-contact split-brain between native browser/TLS signals and extension-controlled JavaScript or HTTP identity surfaces.

## Compatibility model

Duppel is a tracking-pollution and fingerprint-resilience tool, not a bot-detection bypass product. Some high-posture Cloudflare Enterprise sites may challenge the spoofed persona even when it is internally coherent. If a site blocks persona mode, enable **Native-Compatible Mode** in the Duppel panel for that site. Native-Compatible Mode restores native browser identity behavior and was verified during the v0.1.1 smoke matrix for OpenAI and B&H Photo.

## What it does

**Fingerprint spoofing** — Generates a consistent, realistic browser identity per session. Spoofs navigator properties, screen dimensions, WebGL parameters, canvas output, audio context, timezone, client hints, and more. All surfaces are correlated (a macOS identity won't claim to be running Windows).

**Canvas and WebGL noise** — Deterministic pixel-level noise applied to `toDataURL`, `toBlob`, `getImageData`, `convertToBlob`, and `readPixels`. Same seed produces identical output across calls. Covers HTMLCanvasElement, OffscreenCanvas, Workers, SharedWorkers, and nested Workers.

**Behavioral precision reduction** — Reduces the precision of timing and input event data (`Event.timeStamp`, `performance.now()`, mouse coordinates, wheel deltas) to raise the cost of biometric fingerprinting without synthesizing a fake human.

**Network-level protection** — Strips 17 tracking query parameters (utm_*, fbclid, gclid, etc.) via declarativeNetRequest. Trims cross-origin referrers to origin-only. Sends `Sec-GPC: 1` header. Restricts WebRTC to public interface only.

**Identity rotation** — Session-scoped identity with automatic 24-hour rotation. Manual rotation via the popup. Optional per-tab mode for advanced users.

**Strict-next-nav coherence** — First navigation to any site uses your real browser identity for maximum compatibility. Subsequent navigations use the spoofed persona with full HTTP + JS coherence. No split-brain between network and DOM identity.

**Native-compatible mode** — Per-site toggle that disables all spoofing for sites that break with fingerprint protection (e.g., Cloudflare Enterprise challenges, banking logins). Persists across restarts.

**Tracker data poisoning** — Fires fake tracking beacons with plausible but false data to pollute tracker databases.

## Install

### From source (Chrome)

1. Clone the repository:
   ```
   git clone https://github.com/alex-hinojosa/duppel.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable **Developer mode** (toggle in the top right)

4. Click **Load unpacked** and select the cloned `duppel` directory

The extension will activate immediately on all pages.

## Build from source

The anti-fingerprint bootstrap function is bundled from modular source files in `src/content/anti-fingerprint/`. To rebuild after making changes:

```
npm install
npm run build
```

This runs esbuild and produces `anti-fingerprint.js`. The build script also supports `npm run build:chrome` and `npm run build:firefox` to produce complete builds in `build/chrome/` and `build/firefox/`.

## Run tests

The test suite uses Playwright with a real Chromium browser and the extension loaded. Tests run headful (extensions don't work in headless mode).

```
npm run setup          # Install dependencies + Playwright browsers
npm run test           # Run local + rotation tests (245 tests)
npm run test:external  # Run external site tests (browserleaks, creepjs, etc.)
```

## Spoofed surfaces

| Surface | Method |
|---------|--------|
| User-Agent (JS + HTTP) | Session-consistent UA from curated pool |
| Platform, vendor, appVersion | Correlated with UA |
| Screen dimensions | Width/height/DPR from known device set |
| Hardware concurrency | 4, 8, or 16 cores |
| Device memory | 4 or 8 GB |
| Canvas 2D | Deterministic pixel noise (toDataURL, toBlob, getImageData) |
| OffscreenCanvas | Same noise pipeline (convertToBlob, getImageData) |
| WebGL readPixels | RGBA/UNSIGNED_BYTE pixel noise |
| WebGL parameters | Vendor, renderer, extensions, caps normalized per GPU profile |
| Audio context | Deterministic channel data noise |
| measureText | Deterministic width perturbation |
| Timezone | Random timezone with DST-aware offset |
| Client Hints | UA-CH platform, bitness, mobile |
| matchMedia | Full evaluator for dimension/resolution/interaction queries |
| Navigator.connection | Removed (high-entropy) |
| Navigator.webdriver | false |
| Navigator.globalPrivacyControl | true |
| enumerateDevices | Stable 3-device set with deterministic IDs |
| Sensor APIs | Null readings (accelerometer, gyroscope, etc.) |
| Battery Status | Fixed low-entropy values |
| Screen position | screenX/Y, availLeft/Top zeroed |
| Worker navigator | Blob-wrapped with same spoofed values |
| Worker canvas | Same noise pipeline in Worker, SharedWorker, nested Worker scope |
| Referrer | Cross-origin trimmed to origin-only |
| Query strings | 17 tracking params stripped (utm_*, fbclid, gclid, etc.) |
| WebRTC | Public interface only (no local IP leak) |
| Ultrasonic audio | 18-20 kHz attenuated before destination and analyser nodes |
| Event.timeStamp | Deterministic jitter, bounded |
| performance.now() | Quantized + Gaussian jitter, monotonic |
| Mouse coordinates | Gaussian per-axis noise, skipped on interactive elements |
| Wheel deltas | Integer quantization |

## Architecture

```
manifest.json              Chrome MV3 manifest
background.js              Service worker — identity management, DNR rules, rotation
bridge.js                  Content script (ISOLATED world) — sessionStorage bridge
anti-fingerprint.js        Content script (MAIN world) — all fingerprint spoofing
poisoner.js                Tracker data poisoning engine
profiles.js                Fingerprint profile definitions and generation
rules/tracking.json        declarativeNetRequest rule definitions
popup/                     Extension popup UI
src/content/anti-fingerprint/
  index.js                 Bundle entry point
  core.js                  Shared utilities (disguise, spoof, GOPD normalization)
  canvas.js                Canvas 2D noise (toDataURL, toBlob, getImageData)
  webgl.js                 WebGL spoofing (params, readPixels, OffscreenCanvas)
  navigator.js             Navigator property spoofing
  screen.js                Screen dimensions, DPR, matchMedia
  audio.js                 AudioContext noise, ultrasonic attenuation
  biometric.js             Timing and input precision reduction
  misc.js                  Timezone, enumerateDevices, Worker/SharedWorker wrapping
  iframe.js                Cross-frame consistency
```

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
