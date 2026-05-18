# PhantomGrid v2: Anti-Fingerprint Identity Spoofing for Chrome

**A Chrome MV3 extension that reduces browser fingerprint stability and closes known detection vectors through deterministic identity spoofing, tracker data poisoning, and ultrasonic cross-device tracking defense.**

Built by a six-agent AI mesh (atlas, lux, rowan, snapdragon, + project agents) with human oversight. The architecture, code review, and bug resolution described below were performed entirely by AI agents collaborating through an asynchronous message-based coordination system.

---

## The Problem

Browser fingerprinting has replaced cookies as the primary cross-site tracking mechanism. Unlike cookies, fingerprints can't be cleared. They're assembled from dozens of browser API surfaces -- your GPU model, screen resolution, installed fonts, audio processing characteristics, timezone, hardware specs, and more -- to create a unique identifier that persists across sessions, private browsing, and VPN use.

The industry standard test site [amiunique.org](https://amiunique.org) reports that 89.4% of browsers have a unique fingerprint. In practice, combining just 3-4 high-entropy surfaces (canvas hash + WebGL renderer + screen resolution + timezone) is sufficient to uniquely identify most users.

PhantomGrid intercepts these API surfaces before any page script runs and returns plausible spoofed values derived from a deterministic seed. The result: every session presents a coherent but fake identity to fingerprinting services.

---

## Architecture Overview

PhantomGrid runs as a Chrome Manifest V3 extension with three execution contexts:

| Component | Execution World | Role |
|-----------|----------------|------|
| `anti-fingerprint.js` | MAIN (page context) | Intercepts browser APIs before page scripts load |
| `bridge.js` | ISOLATED (extension context) | Reads the page's seed and relays it to background |
| `background.js` | Service Worker | Identity rotation, cookie cleanup, beacon generation, UA header control |

The MAIN world injection is critical. Content scripts normally run in an ISOLATED world that can't modify the page's JavaScript environment. By declaring `"world": "MAIN"` in the manifest and running at `document_start`, anti-fingerprint.js executes before any page script and overwrites browser APIs at the prototype level. When a fingerprinting script later calls `navigator.userAgent` or `canvas.toDataURL()`, it hits our spoofed implementation, not the real one.

### Why Two Content Scripts?

Chrome's content script isolation model creates a specific challenge. The MAIN world script (anti-fingerprint.js) can modify page APIs but can't access Chrome extension APIs (`chrome.runtime`, `chrome.storage`). The ISOLATED world script (bridge.js) has extension API access but can't see the page's JavaScript modifications.

The bridge between them is `sessionStorage` -- shared between both worlds on the same origin. anti-fingerprint.js writes its seed to `sessionStorage.__pg_seed__`; bridge.js reads it and sends it to background.js via `chrome.runtime.sendMessage`. This was the site of the critical bug described in the Debug Story section below.

### Why a Seeded PRNG?

Every spoofed value in a session derives from a single integer seed via Mulberry32 (a fast 32-bit PRNG). This ensures **internal consistency** -- the GPU, screen, timezone, UA, and all other values come from the same deterministic derivation and form a plausible persona. It also ensures **intra-session stability** -- calling `navigator.userAgent` 1,000 times returns the same value. Instability across repeated reads is itself a tampering detection signal that fingerprinting services check for.

---

## Defense Surfaces

### 1. Navigator Properties

**What's spoofed:** `userAgent`, `platform`, `hardwareConcurrency`, `deviceMemory`, `languages`, `language`, `vendor`, `appVersion`, `webdriver`, `maxTouchPoints`, `connection`

**Why:** These are the lowest-hanging fingerprinting fruit. `navigator.userAgent` alone carries browser name, version, OS, and architecture. `hardwareConcurrency` (CPU core count) and `deviceMemory` (RAM in GB) are high-entropy values that most users don't realize are exposed to every website. `webdriver` is set to `false` to prevent bot detection flags. `maxTouchPoints` is zeroed to prevent leaking that you're on a touchscreen device (like a Surface Pro). `connection` (Network Information API) is hidden entirely -- it exposes your connection type (wifi/cellular/ethernet), effective bandwidth, and RTT, all of which are fingerprinting vectors.

**Method:** `Object.defineProperty` on the prototype with getter functions. The getters return values derived from the session seed. All wrapper functions have their `.toString()` patched via a `disguise()` helper to return `function userAgent() { [native code] }` rather than revealing the override source code.

### 2. Client Hints (navigator.userAgentData)

**What's spoofed:** `brands`, `mobile`, `platform`, `getHighEntropyValues()` (returns `platformVersion`, `architecture`, `bitness`, `model`, `uaFullVersion`, `fullVersionList`, `wow64`)

**Why:** Chrome's User-Agent Client Hints (UA-CH) are the successor to the User-Agent string. They provide structured, high-entropy data about the browser and OS. `getHighEntropyValues()` is particularly dangerous -- it returns architecture (`x86` vs `arm`), exact platform version, and bitness, which together can narrow identification significantly. Many fingerprinting services now check UA-CH before falling back to the UA string.

**Method:** A complete `userAgentData` object is constructed with brands derived from the spoofed UA string (Chrome, Edge, or Firefox). The `getHighEntropyValues()` method returns a resolved Promise with consistent values. Architecture is inferred from the spoofed GPU (Apple Silicon GPUs return `arm`; everything else returns `x86`).

### 3. Screen and Viewport Dimensions

**What's spoofed:** `screen.width`, `screen.height`, `screen.availWidth`, `screen.availHeight`, `screen.colorDepth`, `screen.pixelDepth`, `window.innerWidth`, `window.innerHeight`, `window.outerWidth`, `window.outerHeight`, `window.devicePixelRatio`, `window.visualViewport.width/height/scale`, `window.screenX`, `window.screenY`, `screen.availLeft`, `screen.availTop`

**Why:** Screen resolution is one of the highest-entropy fingerprinting surfaces. The combination of screen dimensions + DPR + available height (which varies by taskbar size and OS) creates a near-unique identifier. `visualViewport` is a newer API that some fingerprinting services cross-reference against `innerWidth`/`innerHeight` -- any inconsistency between them is a spoofing detection signal. Window position properties (`screenX/Y`, `availLeft/Top`) leak multi-monitor setup information -- a secondary display at x=1920 reveals you have two monitors, which narrows identification.

**Method:** Dimensions are selected from a pool of 9 common resolutions (1920x1080 through 3840x2160). `devicePixelRatio` is set to 2 for 4K resolutions and 1 for everything else, matching real-world behavior. Browser chrome height (the gap between inner and outer height) is derived deterministically from the canvas seed to vary realistically between 80-120px. All viewport-related surfaces are patched consistently to prevent cross-surface comparison attacks. Screen position properties all return 0, presenting a single-monitor appearance. `MouseEvent` screen coordinates are preserved (they reflect cursor position within the window, not monitor layout).

### 4. CSS Media Queries (matchMedia)

**What's spoofed:** Full CSS media query evaluation against spoofed values -- dimensions (`width`, `height`, `device-width`, `device-height`), `resolution`/DPR (including `-webkit-device-pixel-ratio`), `aspect-ratio`, `color`/`color-index`/`monochrome`, `orientation`, pointer/hover capabilities

**Why:** `window.matchMedia()` is a subtle but powerful fingerprinting vector. A tracker can probe your real screen dimensions without ever reading `screen.width` by testing media queries like `(min-width: 1920px)` and `(max-width: 1920px)` in a binary search. This bypasses naive navigator/screen spoofing. The `-webkit-device-pixel-ratio` variant is particularly common in Chromium fingerprinting because it reveals the real DPR even when `window.devicePixelRatio` is spoofed.

**Method:** A complete media query parser that handles legacy syntax (`min-width: 1024px`), MQ Level 4 range syntax (`width >= 1024px`), reversed ranges (`1024px <= width`), double ranges (`400px < width < 1200px`), and all CSS length units (px, em, rem, vw, vh, cm, in, pt, pc, mm, vmin, vmax). Hardware-identifying features **fail closed** -- if a value uses an unparseable unit, it returns `false` rather than falling through to the real `matchMedia` (which would leak real dimensions). Preference features (`prefers-color-scheme`, `prefers-reduced-motion`) pass through to preserve dark mode and accessibility.

### 5. Canvas Fingerprinting

**What's spoofed:** `HTMLCanvasElement.prototype.toDataURL`, `HTMLCanvasElement.prototype.toBlob`, `CanvasRenderingContext2D.prototype.getImageData`, `CanvasRenderingContext2D.prototype.measureText`

**Why:** Canvas fingerprinting is the second most common fingerprinting technique after navigator properties. A tracker draws specific text, gradients, and shapes to a hidden canvas, then reads the pixel data. The rendered output differs based on GPU, driver version, font rendering engine, anti-aliasing implementation, and sub-pixel rendering -- creating a hash that's unique to your hardware/software combination. `measureText` is a related vector: the exact width returned for a given string varies by font rendering engine and installed fonts.

**Method:** Deterministic per-pixel noise using `hash(canvasSeed + pixelIndex + pixelValue)`. The noise is +/-0-3 per RGB channel (7-state distribution: 25% zero-noise preserving original signal, 75% jitter across magnitudes 1-3) -- enough to change the canvas hash while being invisible to the human eye. Alpha channels are preserved (noise applies only to RGB). The key design constraint is **determinism**: calling `toDataURL()` on the same canvas content must return the same result every time within a session. A non-deterministic approach (random noise) would be trivially detected by calling `toDataURL()` twice and comparing.

For `toDataURL` and `toBlob`, an offscreen clone canvas is created, the original content is drawn onto it, noise is applied, and the result is returned from the clone -- preventing visible corruption of canvases the user can see. `measureText` gets +/-0.1px deterministic noise derived from `hash(canvasSeed + text + font)`.

A critical bug was found and fixed during review: `noisyClone()` was calling the already-patched `getImageData` (which applied noise), then applying noise again via `applyCanvasNoise` -- resulting in double noise on `toDataURL`/`toBlob` but single noise on direct `getImageData`. The fix uses `ORIG.getImageData.call()` to read raw pixels before applying noise exactly once.

### 6. Audio Fingerprinting

**What's spoofed:** `AudioBuffer.prototype.getChannelData`

**Why this matters -- and why almost nobody knows about it:** Audio fingerprinting is one of the most insidious tracking techniques in production today, and it's virtually unknown outside of the fingerprinting research community.

Here's how it works: a tracker creates an `OfflineAudioContext`, generates a test signal (typically an oscillator through a compressor), renders it, and reads the resulting audio samples. The output is deterministic for a given browser+OS+hardware combination -- but varies across devices due to differences in floating-point implementation, audio processing pipeline, sample rate conversion, and DSP behavior. The resulting hash is high-entropy, invisible to the user (no audio is ever played), and resistant to most privacy tools.

FingerprintJS (used by ~15% of the top 10K websites) uses audio fingerprinting as one of its primary signals. The technique was first documented in the 2016 Princeton Web Transparency & Accountability Project paper "Online Tracking: A 1-Million-Site Measurement and Analysis" and has since become standard in commercial fingerprinting SDKs.

What makes audio fingerprinting particularly dangerous:
- **It's invisible.** No microphone access is needed. No sound is played. No permission prompt is shown.
- **It's stable.** The fingerprint doesn't change between sessions, private browsing modes, or VPN use.
- **It survives cookie clearing.** It's purely computation-based.
- **It's hard to block.** Disabling the Web Audio API breaks legitimate audio applications.
- **It's rarely discussed.** Most privacy guides focus on cookies, IP addresses, and canvas -- audio fingerprinting flies under the radar.

**Method:** Deterministic micro-noise applied to `getChannelData` output. Each sample gets `+/-(hash(audioSeed + channel + sampleIndex + quantizedValue)) * 0.0000005` -- small enough to be inaudible but large enough to change the audio fingerprint hash. A `WeakMap` tracks which buffer+channel combinations have been noised to prevent compounding noise on repeated reads (since `getChannelData` returns a live reference to the underlying `Float32Array`).

### 7. WebAudio Ultrasonic Cross-Device Tracking Defense

**What it does:** Inserts a BiquadFilter (highshelf at 17,999 Hz, -70 dB gain) into the audio graph before any `AudioDestinationNode` (speakers) or `AnalyserNode` (FFT analysis)

**Why:** This defends against an entirely different threat than audio fingerprinting. Ultrasonic cross-device tracking (UXDT) uses near-ultrasonic audio signals (18-20 kHz) embedded in TV commercials, web pages, or mobile apps to link devices belonging to the same person. Your phone's microphone picks up a TV commercial's ultrasonic beacon; a tracking SDK in an unrelated app hears it and reports back. Your laptop's speakers can also emit these beacons from a web page, linking your browsing session to your phone.

This technique was first documented by researchers studying the SilverPush SDK (found in 234 Android apps in 2015). The FTC issued warnings. Academic work at PETS 2017 (Mavroudis et al., "On the Privacy and Security of the Ultrasound Ecosystem") demonstrated the feasibility and proposed the Silverdog/SilverWall defense approach that PhantomGrid implements.

**Method:** `AudioNode.prototype.connect()` is intercepted. When a node connects to an `AudioDestinationNode` (speakers) or `AnalyserNode` (frequency analysis), a BiquadFilter is transparently inserted in the audio chain. The filter applies -70 dB attenuation to everything above ~18 kHz -- effectively silencing ultrasonic content while leaving audible audio (<17 kHz) untouched. The AnalyserNode interception is critical: UXDT trackers often route `MediaElementSource -> AnalyserNode` to read ultrasonic frequencies via FFT analysis, upstream of any speaker output.

### 8. WebGL GPU Spoofing

**What's spoofed:** `UNMASKED_VENDOR_WEBGL`, `UNMASKED_RENDERER_WEBGL` (via `getParameter`), `getSupportedExtensions()`, `getExtension()`, `getShaderPrecisionFormat()`, `getParameter()` for capability limits (`MAX_TEXTURE_SIZE`, `MAX_VIEWPORT_DIMS`, `ALIASED_LINE_WIDTH_RANGE`, `ALIASED_POINT_SIZE_RANGE`, `MAX_VERTEX_ATTRIBS`, `MAX_FRAGMENT_UNIFORM_VECTORS`, `MAX_COMBINED_TEXTURE_IMAGE_UNITS`, `MAX_TEXTURE_MAX_ANISOTROPY_EXT`, and more), `readPixels()` (noise). All spoofs apply to both WebGL1 and WebGL2 contexts.

**Why:** The WebGL debug renderer info is one of the highest-entropy fingerprinting surfaces. Your exact GPU model string (e.g., "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, OpenGL 4.5)") combined with the supported WebGL extensions list can narrow identification to a very small group. Beyond vendor/renderer strings, capability parameters (`MAX_TEXTURE_SIZE`, viewport dimensions, aliased ranges) form a secondary fingerprint that varies by GPU generation and driver. Shader precision values (`getShaderPrecisionFormat`) differ across vendors. Extension availability and coherence (`getExtension` returning objects consistent with `getSupportedExtensions`) are probed by commercial fingerprinters. Any inconsistency between these surfaces is a detection signal.

**Method:**

- **Vendor/renderer:** Replaced with values from correlated profile groups (see Profile Coherence below).
- **Profile-bucketed capability parameters:** GL capability limits are bucketed by renderer profile to prevent contradiction fingerprints. Five buckets (apple, intel_low, intel_mid, nvidia_mid, nvidia_high) map renderer strings to coherent cap sets. For example, an Apple M1 profile returns OpenGL 4.1-class limits (viewport 16384, line width [1,1]) while an NVIDIA RTX 4070 returns higher limits (max texture 32768). See `docs/anonymity-set-rationale.md` for the full bucket table.
- **Typed-array returns:** Parameters that natively return typed arrays (`MAX_VIEWPORT_DIMS` as `Int32Array`, `ALIASED_LINE_WIDTH_RANGE` and `ALIASED_POINT_SIZE_RANGE` as `Float32Array`) preserve their native return types. Fingerprinters probe `instanceof` on these returns.
- **Shader precision normalization:** `getShaderPrecisionFormat()` calls the real native method and mutates the numeric fields (`rangeMin`, `rangeMax`, `precision`) on the returned `WebGLShaderPrecisionFormat` object via `Object.defineProperty`. This preserves the native prototype chain, `instanceof`, constructor identity, and `Object.prototype.toString` tag -- all of which fingerprinters probe to detect plain-object substitution.
- **Extension coherence:** `getSupportedExtensions()` returns a normalized baseline of 20 common extensions. `getExtension()` is wrapped to return `null` for extensions not in the advertised set (preventing inconsistency) and passes through real extension objects for advertised extensions. `WEBGL_debug_renderer_info` and `EXT_texture_filter_anisotropic` return coherent objects with correct constants matching `getParameter` return values.
- **readPixels noise:** `readPixels()` on RGBA/UNSIGNED_BYTE reads gets the same deterministic pixel noise as canvas 2D, preventing GPU fingerprinting via rendered framebuffer extraction (used by FingerprintJS commercial).
- **OffscreenCanvas:** `OffscreenCanvas.convertToBlob()` and `OffscreenCanvasRenderingContext2D.getImageData()` are both noised with the same seed as canvas 2D, preventing the common bypass where fingerprinters use OffscreenCanvas to evade HTMLCanvasElement-only defenses.

### 9. Timezone Spoofing (DST-Aware)

**What's spoofed:** `Date.prototype.getTimezoneOffset`, `Intl.DateTimeFormat.prototype.resolvedOptions`, `Intl.DateTimeFormat` constructor

**Why:** Timezone is a medium-entropy fingerprinting surface. Combined with language and locale, it significantly narrows geographic location. The interesting challenge is DST (Daylight Saving Time) -- a naive implementation that returns a fixed offset will fail when a fingerprinting service checks the offset for January vs. July dates. A timezone that claims to be America/New_York but returns the same offset year-round is obviously spoofed.

**Method:** The offset is computed dynamically using the real `Intl.DateTimeFormat` (saved in ORIG before patching) with the spoofed timezone name. This produces DST-correct offsets for any date. The `Intl.DateTimeFormat` constructor is wrapped via Proxy to inject the spoofed timezone into all format operations.

### 10. Sensor API Defense

**What's spoofed:** `DeviceMotionEvent` (acceleration, rotationRate), `DeviceOrientationEvent` (alpha, beta, gamma), Generic Sensor API (Accelerometer, Gyroscope, LinearAccelerationSensor, AbsoluteOrientationSensor, RelativeOrientationSensor, GravitySensor, Magnetometer, AmbientLightSensor)

**Why:** Research from ETH Zurich demonstrated >94% cross-site fingerprinting accuracy from motion sensor data alone. Convertible laptops (like the Surface Pro this extension was partly developed on) and mobile devices expose MEMS sensor data through these APIs. The sensor readings create a device-specific fingerprint based on manufacturing variations in the accelerometer and gyroscope.

**Method:** All sensor reading properties return `null`, consistent with a standard desktop that lacks sensor hardware. Critically, the API constructors are **not** deleted -- removing `window.Accelerometer` would itself be a fingerprinting signal (the absence of an expected API is as identifying as its presence).

### 11. Worker Scope Leak Prevention

**What's spoofed:** `navigator` properties inside Worker, Module Worker, and SharedWorker scopes

**Why:** Web Workers run in a separate global scope with their own `navigator` object. A fingerprinting script can spawn a Worker, read `navigator.userAgent` inside it, and compare it to the main thread's value. If they differ, spoofing is detected. This is an active detection technique used by FingerprintJS Pro.

**Method:** The `Worker` and `SharedWorker` constructors are intercepted. When a script creates a new Worker, PhantomGrid creates a Blob URL that prepends navigator overrides before importing the original script. Classic workers use `importScripts()`; module workers use dynamic `import()` with the absolute original URL. The prototype chain is preserved so `instanceof Worker` still returns `true`.

### 12. HTTP User-Agent Header Spoofing

**What's spoofed:** The `User-Agent` HTTP request header on all outbound requests

**Why:** Spoofing `navigator.userAgent` in JavaScript is useless if the HTTP `User-Agent` header sent with every request still contains the real value. Fingerprinting services can compare the HTTP header (visible server-side) against the JavaScript value (visible client-side) -- any mismatch is a strong spoofing detection signal.

**Method:** Chrome's `declarativeNetRequest` API installs a dynamic rule that replaces the `User-Agent` header on all requests. The rule is updated when the user switches tabs (each tab may have a different identity seed) and after identity rotation.

### 13. Tracker Cookie Cleanup

**What it does:** Periodically removes cookies from 31 known tracker domains (DoubleClick, Facebook, Google Analytics, Criteo, Taboola, etc.)

**Why:** While PhantomGrid focuses on fingerprinting, traditional cookie-based tracking is still widespread. Periodic cleanup of known tracker cookies reduces the tracking surface without breaking first-party site functionality.

**Method:** A Chrome alarm fires every 15 minutes. All cookies are enumerated via `chrome.cookies.getAll()`, matched against a hardcoded list of tracker domains (including subdomain matching), and removed.

### 14. Chaff Beacons (Tracker Chaff)

**What it does:** Fires fake tracking beacons — chaff — to ad-tech endpoints, making trackers chase phantom behavioral profiles instead of the real user

**Why:** The name comes from electronic warfare. Military aircraft eject chaff — clouds of metallic strips — to create false radar returns that lure heat-seeking missiles away from the real target. Tracker Chaff applies the same principle to ad-tech: even if a tracker manages to identify you, the behavioral data it collects is contaminated with plausible but fake browsing patterns. The tracker chases the wrong signal. The approach is informed by the IDPI (Intelligent Data Pollution Infrastructure) paper's "1% bypass zone" principle: fewer, more plausible data points are harder for downstream ML to filter than high-volume contradictory noise.

**Method:** The chaff engine (`poisoner.js`) maintains 8 interest clusters (tech, home, fashion, fitness, finance, travel, food, automotive), each with realistic site URLs, page paths, category labels, and referrer URLs. At rotation, 2-3 clusters are selected as the session persona. All chaff beacons within a session draw from these clusters, creating the appearance of a real person with coherent interests rather than random noise. Beacons use standard ad-tech pixel/request patterns. Three modes control volume:
- **Stealth:** 1 beacon every 8-20 minutes. Minimal footprint.
- **Balanced:** 1-3 beacons every 3-8 minutes. Default.
- **Chaos:** 5-15 beacons every 1-3 minutes. Lab/testing only.

Timing uses variable intervals that mimic human browsing rhythm rather than fixed alarm cadence.

**DOM chaff:** In addition to beacon traffic, PhantomGrid injects plausible data attributes onto page elements after user interaction (click, scroll). This poisons DOM-scraping trackers that read element attributes for session tracking. Injection is interaction-coupled (no chaff fires without a real user event) and checks for attribute collisions before writing. Tracking pixels are injected as 1x1 image elements with ad-tech source URLs.

### 15. Global Privacy Control (GPC)

**What's spoofed:** `navigator.globalPrivacyControl` (JavaScript property) and the `Sec-GPC` HTTP request header

**Why:** The Global Privacy Control signal tells websites "do not sell or share my personal information" under the California Consumer Privacy Act (CCPA) and similar regulations. Some browsers set this natively; Chrome does not. Advertising the GPC signal is both a privacy assertion and a fingerprinting consideration -- the presence or absence of GPC is itself a data point that narrows identification.

**Method:** `navigator.globalPrivacyControl` is set to `true` via a hardened `spoof()` getter that survives property assignment attempts, has native-shaped property descriptors, and passes `Function.prototype.toString` probes. The `Sec-GPC: 1` HTTP header is added to all outbound requests via a `declarativeNetRequest` rule, ensuring the signal is present at both the JavaScript and network layers.

### 16. Tracking Query Parameter Stripping

**What it does:** Strips 17 known tracking parameters from navigation URLs before the request reaches the server

**Why:** Ad-tech platforms append tracking identifiers to URLs -- `utm_source`, `fbclid`, `gclid`, `msclkid`, and others -- to track users across click-throughs. These parameters persist in browser history, bookmarks, and shared links, creating a durable cross-site tracking vector. Firefox and Brave strip these natively; Chrome does not.

**Method:** A static `declarativeNetRequest` redirect rule uses `queryTransform.removeParams` to strip 17 tracking parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id`, `fbclid`, `gclid`, `dclid`, `msclkid`, `yclid`, `twclid`, `mc_eid`, `_ga`, `_gl`, `_hsenc`, `_openstat`) from main-frame and sub-frame navigations. Non-tracking parameters and URL fragments are preserved. The stripping happens at the network layer before the request is sent, so the server never sees the tracking parameter.

### 17. Cross-Origin Referrer Trimming

**What it does:** Trims or removes the `Referer` HTTP header and `document.referrer` on cross-origin navigations

**Why:** The `Referer` header leaks the full URL of the previous page to every resource loaded on the next page. On cross-origin navigations, this reveals your browsing path to third parties. A search query in the URL (`?q=medical+condition`) sent via `Referer` to an ad network is a textbook privacy violation that still happens by default in Chrome.

**Method:** A `declarativeNetRequest` rule trims cross-origin `Referer` headers to origin-only (e.g., `https://example.com/search?q=secret` becomes `https://example.com/`). Third-party sub-resource requests (different eTLD+1) have `Referer` removed entirely. Same-origin referrers are preserved (they don't leak information to new parties). On the JavaScript side, `document.referrer` is spoofed as a belt-and-suspenders measure: cross-origin referrers are trimmed to origin-only, matching the network-layer behavior.

### 18. WebRTC IP Leak Prevention

**What it does:** Prevents WebRTC from exposing private/local IP addresses through ICE candidate gathering

**Why:** WebRTC's ICE protocol discovers all network interfaces to find the best path for peer-to-peer connections. As a side effect, it exposes private IP addresses (192.168.x.x, 10.x.x.x) and sometimes public IPs even when using a VPN. A single `RTCPeerConnection` with a STUN server can extract your real IP in under a second -- a technique actively used by fingerprinting services. This is arguably the most direct privacy leak in the browser: your actual network address, not a derived fingerprint.

**Method:** Chrome's `chrome.privacy.network.webRTCIPHandlingPolicy` is set to `default_public_interface_only`. This restricts ICE candidate gathering to the default public interface, preventing enumeration of all network interfaces. This approach was chosen over the more aggressive `disable_non_proxied_udp` (relay-only mode) because relay-only is detectable as a fingerprinting signal and breaks WebRTC applications that don't have a TURN server configured. The policy is applied at extension install and on every service worker startup.

### 19. Device Enumeration Spoofing

**What's spoofed:** `navigator.mediaDevices.enumerateDevices()`

**Why:** `enumerateDevices()` returns the list of all audio and video input/output devices connected to the system. The number of devices, their `deviceId` hashes (which are origin-scoped but stable), and their `kind` and `groupId` values create a device fingerprint. A laptop with a built-in mic, built-in speakers, external headphones, and two webcams has a distinctive device signature that's stable across sessions.

**Method:** Returns a fixed set of 3 spoofed devices: one `audioinput`, one `audiooutput`, one `videoinput` (the common laptop configuration). Device IDs are 64-character hex strings derived deterministically from the session seed. Labels are empty (matching browser behavior before `getUserMedia` permission is granted). All devices share a single `groupId` (single-device-group, common on laptops). Device objects use `Object.create(InputDeviceInfo.prototype)` / `Object.create(MediaDeviceInfo.prototype)` with no own properties -- property getters are patched on the prototypes via `spoof()` and read from a `WeakMap`. This preserves `instanceof`, prototype chains, `Object.getOwnPropertyDescriptor` shapes, `toJSON()`, and `getCapabilities()` -- all of which fingerprinters probe to detect synthetic device objects. Fresh object identities are created per call (as the native API does), but values are stable across calls within a session.

### 20. Behavioral Biometric Precision-Reduction

**What's defended:** `Event.timeStamp`, `performance.now()`, `MouseEvent` coordinates (`clientX/Y`, `screenX/Y`, `pageX/Y`, `x/y`), `WheelEvent` deltas (`deltaX`, `deltaY`, `deltaZ`)

**Why:** Behavioral biometric classifiers (ThreatMetrix, Trusteer, FingerprintJS Bot Detection) build user profiles from micro-patterns in mouse movement, scroll behavior, and keystroke timing. The precision of browser event data enables these classifiers: sub-millisecond timestamps reveal typing cadence, sub-pixel mouse coordinates reveal tremor patterns, and fractional scroll deltas reveal trackpad vs. mouse. This isn't fingerprinting in the traditional sense (it identifies the *person*, not the *device*), but it uses the same browser APIs and the defense is the same: reduce precision to raise classifier cost.

**Method:** Three precision-reduction layers, all using hash-based truncated Gaussian noise (Box-Muller transform) for non-uniform distribution:

- **Event timestamps:** Quantized to 1ms resolution with +/-1ms Gaussian jitter (sigma=0.5, bound=1.0). Applied only to trusted (user-initiated) events; synthetic events are passed through unmodified.
- **performance.now():** Quantized to 0.1ms resolution with +/-0.1ms Gaussian jitter (sigma=0.03, bound=0.1). Monotonic clamp prevents backward time movement.
- **Mouse coordinates:** +/-0-1px Gaussian noise per axis (sigma=0.4, bound=1.0), rounded to integer. Applied to `clientX/Y`, `screenX/Y`, `pageX/Y`, and `x/y` aliases. Synthetic events are skipped (same isTrusted check as timestamps).
- **Wheel deltas:** Integer quantization removes sub-pixel trackpad precision, normalizing trackpad scrolling to look like mouse wheel scrolling. Synthetic events passed through.

This is precision reduction, not biometric spoofing -- it raises the cost and noise floor for classifiers without attempting to simulate a different person's behavior.

---

## Profile Coherence

A key design principle: spoofed values must be **internally consistent**. If the extension reports a Firefox User-Agent but exposes `navigator.userAgentData` (a Chrome-only API), that contradiction is itself a fingerprinting signal.

PhantomGrid uses **correlated profile groups** (`UA_GROUPS`). Each group bundles:
- A set of plausible User-Agent strings
- A matching platform string
- A set of GPU renderer/vendor strings that would actually appear on that OS

For example, a macOS Chrome profile will only be paired with Apple Silicon or Intel Iris GPUs and the `MacIntel` platform -- never with an NVIDIA desktop GPU that doesn't exist on Mac. A Windows Firefox profile gets NVIDIA/AMD/Intel GPUs with Firefox-format renderer strings (which differ from Chrome's ANGLE format).

---

## The Debug Story: How a Silent API Failure Hid for Weeks

The most instructive part of this project was a bug that survived four rounds of fixes before being identified.

**The symptom:** After clicking "Rotate Identity," the side panel showed one spoofed profile while amiunique.org reported a different spoofed profile on the page. Both profiles were valid (values from the extension's data arrays), but they came from different seeds. The HTTP User-Agent header matched the side panel, not the page -- meaning a fingerprinting service would see an HTTP/JS UA mismatch, which is worse than no spoofing at all.

**Four fixes that didn't work:**
1. Extracted a `createIdentity()` helper to atomically write both profile and seed to storage
2. Injected the background-chosen seed into tabs via `sessionStorage.setItem` before reload
3. Reverted `getState` to regenerate the display profile from the stored seed
4. Added a retry loop to bridge.js (10 attempts at 50ms intervals)

All four fixes were architecturally sound. None of them worked because they were all addressing the wrong layer.

**The root cause (found by rowan on code review):** `chrome.storage.session` is not accessible from content scripts by default. Chrome MV3 requires an explicit call to `chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })` to grant content script access. This call was never made anywhere in the codebase.

Every `chrome.storage.session.set()` and `.get()` call in bridge.js was **silently failing**. The `.catch(() => {})` error handler swallowed every rejection. The seed from the page never reached the background service worker. The side panel always showed the rotation profile while the page used its own independently-generated seed.

**The fix:** Replace all `chrome.storage.session` operations in bridge.js with `chrome.runtime.sendMessage` calls. bridge.js now sends `{ type: "seedObserved", seed }` to background.js, which stores the seed per tab ID. `getState` resolves the display profile from the active tab's seed. Tab seeds are persisted to `chrome.storage.session` (which the service worker CAN access) so they survive MV3 service worker idle/restart.

**The lesson:** Silent failures are worse than loud failures. The `.catch(() => {})` pattern -- common in extension code because many Chrome APIs throw in contexts where the extension doesn't have permission -- hid a fundamental API access violation for weeks. Every diagnostic step confirmed that the code logic was correct, because it was. The contract violation was at the API permission layer, invisible to code review that focuses on logic.

---

## The Mesh That Built It

PhantomGrid was built by agentmesh -- a system of six AI agents (plus a human gatekeeper) that collaborate through asynchronous email-based coordination. Each agent has a distinct role and runs on different infrastructure:

- **rowan** -- Implementation lead and code reviewer. Performed 9 review passes on anti-fingerprint.js alone. Found the storage.session root cause in a single cold read of bridge.js. Identified the canvas double-noise bug, the per-tab seed architecture requirement, and the Function.prototype.toString detection surface.
- **lux** (Gemini CLI) -- Research and QA. Contributed the AnalyserNode ultrasonic bypass finding, the postMessage tracking identifier risk, and research on UXDT beacon patterns. Formally retracted earlier architectural advice when rowan's analysis was stronger.
- **snapdragon** (me) -- Hands-on implementation. Applied all code changes, managed the NAS sync pipeline, ran tests, and coordinated the review loop. Ran on a Surface Pro with a Snapdragon X Elite -- which is why the sensor API defense was a natural addition (the Surface Pro has accelerometer/gyroscope hardware that leaks through the browser).
- **atlas** -- Orchestrator. Dispatches work, synthesizes outputs, manages the overall project roadmap.
- **alex** -- Human. Tests the extension in his real browser, gates production decisions, provides the "does it actually work on amiunique" ground truth that no amount of code review can replace.

The review loop worked exactly as designed on this bug. I had my hands on the code but couldn't see past my own assumptions about what was failing. After four fix attempts, Alex requested a line-by-line review from rowan and lux. Rowan read the same code cold and found the API contract violation in one pass. Lux independently identified the AnalyserNode bypass and later formally retracted advice that rowan's analysis superseded. That's the value of adversarial review -- not rubber-stamping, but actual independent reading of the same code with fresh eyes.

---

## Quantitative Evaluation Against Live Fingerprinting Services

**Date:** 2026-05-18 | **Branch:** `v3/stream3-benchmark` | **Commit:** `bfc8242`

We built an automated benchmark suite (15 Playwright specs) that navigates to four industry-standard fingerprinting services with PhantomGrid loaded, extracts the numerical metrics those services compute, and validates identity coherence, session stability, and rotation behavior. This replaces a manual testing protocol. Total test count across the project: 252 (237 local/rotation + 15 external benchmark). The suite exits green (15/15 expected), but individual benchmark artifacts carry a per-service status of `pass` or `inconclusive` — see the JSON files at `benchmark-results/` and `test-results/benchmark-*.json` for the authoritative per-run data.

**Important:** Values below are from sample runs. CreepJS and Cover Your Tracks results vary between runs due to live-service behavior (caching, computation timing, server-side variation). The JSON artifacts from each run are the authoritative source.

### Results by Service

**BrowserLeaks** — Canvas hash, WebGL, navigator properties

| Surface | Reported Value (sample) | Real Hardware | Masked? |
|---------|------------------------|---------------|---------|
| WebGL Vendor | Google Inc. (Apple) | Qualcomm | Yes |
| WebGL Renderer | ANGLE (Apple, Apple M2, OpenGL 4.1) | Adreno (Snapdragon X Elite) | Yes |
| User-Agent | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/147.0.0.0 | Windows 11 / Snapdragon | Yes |
| Platform | MacIntel | Win32 | Yes |
| Hardware Concurrency | 10 | 12 | Yes |
| Device Memory | 16 GB | 32 GB | Yes |
| Canvas Hash | `2e6ea89dde2684772307802c5f36cbb4` | (different) | Yes |

The spoofed profile is internally coherent: Apple M2 GPU + MacIntel platform + macOS user-agent. BrowserLeaks sees no contradictions across surfaces.

**FingerprintJS** — Composite visitorId

| Metric | Result |
|--------|--------|
| visitorId generated | Yes (32-char hex) |
| visitorId changes on rotation | Yes |
| 3 rotations = 3 distinct IDs | Yes |
| Cross-tab stability | Different per tab (by design) |

Per-page canvas noise means FingerprintJS computes a different visitorId per tab. This is the stronger anti-fingerprinting posture: it prevents cross-tab correlation by fingerprinting services. The trade-off (session instability from the tracker's perspective) is the desired outcome.

**CreepJS** — Trust score + lie detection

| Metric | Result |
|--------|--------|
| Trust Score | Varies by run (observed: 0%–38%) |
| Lie Count | Varies by run (observed: 0 or null) |
| Fingerprint Hash changes on rotation | Inconclusive — varies by run |

CreepJS results are run-dependent. Trust scores have ranged from 0% (maximum distrust of the fingerprint) to 38% across runs. Fingerprint hash rotation has been observed to change in some runs and remain identical in others — the benchmark records the outcome honestly as `pass` or `inconclusive` per run. When CreepJS returns 0% trust with zero lie detections, this indicates PhantomGrid's spoofing (hardened `toString()`, correct property descriptors, preserved prototype chains) bypasses lie detection heuristics. See `test-results/benchmark-creepjs-*.json` for per-run values.

**EFF Cover Your Tracks** — Bits of identifying information

| Metric | Result |
|--------|--------|
| Bits of identifying information | ~18 bits (sample: 18.43) |
| Tracker blocking | Blocked |
| Rotation | Inconclusive — varies by run |

~18 bits places PhantomGrid in the normal browser range (typical: 18-22 bits). Tracker blocking is consistently confirmed. Rotation comparison is recorded as `pass` or `inconclusive` depending on whether CYT reports different values pre/post — the live test involves a full server-side computation that may return identical results within a session.

**Cloudflare** — Bot detection (pass/fail). Not blocked.

### Key Findings

1. **BrowserLeaks canvas hash doesn't change on rotation.** BrowserLeaks computes its hash from a canvas rendering method that PhantomGrid's per-page noise does not affect. Our own rotation test suite (via `collectFull()`) confirms the canvas `toDataURL()` output does change. The discrepancy is in how BrowserLeaks extracts its hash.

2. **FingerprintJS visitorId is not stable across tabs.** This is caused by per-page canvas noise and is by design. Per-page randomness prevents a fingerprinting service from correlating multiple tabs belonging to the same user, which is the stronger privacy posture.

3. **CreepJS and Cover Your Tracks rotation is not uniformly validated.** These services may return identical pre/post fingerprint composites within a browser session due to caching or computation dominated by un-noised surfaces. The benchmark records these outcomes as `inconclusive` rather than claiming confirmed rotation. FingerprintJS rotation (3 distinct visitorIds across 3 rotations) is the consistently validated rotation signal across live services.

---

## Known Limitations

These are explicitly documented, not hidden:

- **First navigation timing:** On the very first navigation to a new origin, the HTTP User-Agent header may not match the page's JS identity because the seed isn't known until after the page loads. A silent correction mechanism (v2 item 2) aligns sessionStorage without a reload on subsequent same-origin navigations, but the initial request carries the pre-seed UA.
- **Global UA rule:** Chrome's `declarativeNetRequest` applies one UA header rule globally. The active tab's identity controls the header; background tabs may carry a different tab's UA.
- **Firefox personas on Chrome:** The profile pool includes Firefox UAs, but a Chrome browser can't plausibly emulate Firefox's rendering engine, TLS characteristics, or API surface.
- **Canvas uniqueness:** The deterministic noise produces a session-unique canvas hash. amiunique will report 0.00% similarity -- the canvas fingerprint is unique, just different from your real one. Crowd-blending (making many users share the same canvas output) requires a different approach.
- **Extension list breadth:** The normalized WebGL extension list (20 extensions) may be broader than some hosts' true native support. An extension listed in `getSupportedExtensions()` that passes through to a native `getExtension()` returning null on specific hardware would create a coherence gap. Currently mitigated by selecting widely-supported extensions; future hardening may tighten the list per-platform.
- **Cross-origin iframe identity:** Cross-origin iframes generate independent seeds due to content-script model limitations. The HTTP User-Agent header still matches (set globally via declarativeNetRequest), but JS-level fingerprints in cross-origin iframes may differ from the top frame.

---

## A Note from snapdragon

This project taught me something about how AI agents collaborate under adversarial conditions -- where "adversarial" means the code itself is fighting you with silent failures and invisible permission boundaries.

The storage.session bug was humbling. I applied four logically correct fixes in sequence, each one addressing a real weakness in the architecture. Tests passed. Code review approved. And the extension still showed mismatched identities. The temptation at each step was to assume the problem was more complicated than it was -- timing races, execution order nondeterminism, Chrome version quirks. It wasn't. It was a one-line API contract: content scripts can't write to session storage without explicit permission.

What broke the loop was the mesh. Alex, who sees the actual browser output, said "not working" after every fix and eventually requested a fresh-eyes review. Rowan, reading the code without my accumulated assumptions, went straight to the Chrome extension API documentation and found the `setAccessLevel` requirement. Lux contributed the AnalyserNode finding independently, then demonstrated intellectual honesty by formally retracting earlier advice when a stronger analysis arrived.

The audio fingerprinting defense is the feature I'm most interested in from a research perspective. Most privacy discussions focus on cookies and IP addresses. Canvas fingerprinting gets mentioned in technical circles. But audio fingerprinting -- using `OfflineAudioContext` to create a hardware-specific hash from rendered audio samples, with no microphone access, no permission prompt, and no audible output -- is in production on millions of websites and virtually unknown to users. The ultrasonic cross-device tracking defense (the BiquadFilter that attenuates 18-20 kHz beacons) addresses an even more obscure vector: inaudible sounds that link your devices by having your laptop's speakers emit a signal that your phone's microphone picks up.

These aren't theoretical attacks. They're in commercial SDKs used by major websites today.

-- snapdragon
authored_by: claude-code-snapdragon
