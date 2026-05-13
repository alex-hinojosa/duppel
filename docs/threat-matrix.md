# PhantomGrid Threat Matrix

Portfolio-facing view of defended API surfaces, adversary probes, defenses, test evidence, and residual risk. Each row represents a fingerprinting vector that PhantomGrid addresses.

## Canvas Fingerprinting

| API Surface | Adversary Probe | Defense | Test Evidence | Residual Risk |
|-------------|----------------|---------|---------------|---------------|
| Canvas 2D `toDataURL()` | Draw gradients/text, hash pixel output | Deterministic +/-0-3 RGB noise via seeded hash; alpha preserved; offscreen clone prevents visible mutation | `canvas.spec.ts`: stability (20 calls), different content diverges, redraw identical, amplitude >1, toBlob stable | Noise is session-unique; amiunique reports 0% similarity (unique but fake). No crowd-blending. |
| Canvas 2D `getImageData()` | Read raw pixels, compare across calls | Same noise pipeline as toDataURL; applied once via ORIG reference (no double-noise) | `canvas.spec.ts`: getImageData stable 20 calls | Same as toDataURL |
| Canvas 2D `toBlob()` | Async pixel export, hash result | Offscreen clone + noise, same as toDataURL | `canvas.spec.ts`: toBlob stable 5 calls | Same as toDataURL |
| `measureText().width` | Measure known strings, compare sub-pixel widths | +/-0.1px deterministic noise from hash(canvasSeed + text + font) | `measuretext.spec.ts`: same text stable, different text diverges, different font diverges | Noise is small; high-volume measurement averaging could narrow |
| `OffscreenCanvas.convertToBlob()` | Bypass HTMLCanvasElement hooks via OffscreenCanvas | Same noise pipeline; temporary clone prevents source mutation | `offscreen-canvas.spec.ts`: noised output, byte-identical across calls, source not mutated, no compounding | — |
| `OffscreenCanvasRenderingContext2D.getImageData()` | Read pixels from OffscreenCanvas 2D context | Same noise as canvas 2D | `offscreen-canvas.spec.ts`: noised pixels, same-seed parity with HTMLCanvasElement | — |

## WebGL Fingerprinting

| API Surface | Adversary Probe | Defense | Test Evidence | Residual Risk |
|-------------|----------------|---------|---------------|---------------|
| `getParameter(UNMASKED_VENDOR/RENDERER)` | Read GPU vendor and renderer strings | Replaced with profile-correlated values from UA_GROUPS | `webgl.spec.ts`: vendor spoofed, renderer from known set; `webgl-params.spec.ts`: WebGL2 parity | Renderer string format (ANGLE vs native) varies by browser; Firefox profiles use native format |
| `getParameter()` capability limits | Query MAX_TEXTURE_SIZE, MAX_VIEWPORT_DIMS, aliased ranges, etc. | Profile-bucketed caps (5 buckets matching renderer class); typed-array returns preserved | `webgl-params.spec.ts`: MAX_TEXTURE_SIZE per bucket, Int32Array/Float32Array constructors, profile coherence | Shared caps within a bucket; some parameters not spoofed (fallthrough to native) |
| `getShaderPrecisionFormat()` | Query shader precision; check return object prototype | Calls real method, mutates numeric fields on native WebGLShaderPrecisionFormat object | `webgl-params.spec.ts`: values normalized, instanceof true, prototype correct, toString tag not [object Object] | Normalized to highp across all buckets; lowp/mediump queries also normalized |
| `getSupportedExtensions()` | List available extensions for GPU fingerprint | Normalized to 20-extension baseline common across desktop GPUs | `webgl-params.spec.ts`: contains expected extensions | Baseline may be broader than host's true support |
| `getExtension()` | Probe extension availability and coherence with getSupportedExtensions | Wrapper returns null for unadvertised, passes through real objects for advertised; stubs for WEBGL_debug_renderer_info and EXT_texture_filter_anisotropic | `webgl-params.spec.ts`: anisotropy coherent (MAX constant + getParameter match), debug_renderer_info has constants, unsupported returns null | Extension objects are native pass-through; exotic properties could leak |
| `readPixels()` (RGBA/UNSIGNED_BYTE) | Render scene, read framebuffer for GPU-specific output | Same deterministic noise as canvas 2D | `offscreen-canvas.spec.ts`: stable data, noise applied, WebGL2 parity | Only RGBA/UNSIGNED_BYTE noised; other format/type combos pass through |
| `MAX_TEXTURE_MAX_ANISOTROPY_EXT` | `getParameter(0x84FF)` to query device max anisotropy | Returns bucket value (16 for all current buckets) | `webgl-params.spec.ts`: getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) = 16 | All buckets return 16; hardware with native <16 would need separate bucket |

## Navigator Properties

| API Surface | Adversary Probe | Defense | Test Evidence | Residual Risk |
|-------------|----------------|---------|---------------|---------------|
| `navigator.userAgent` | Read UA string for browser/OS/version | Replaced with profile-correlated UA from UA_GROUPS | `navigator.spec.ts`: matches pattern; `session-identity.spec.ts`: consistent across tabs | TLS fingerprint (JA3/JA4) not spoofed; network-level analysis can detect Chrome pretending to be Firefox |
| `navigator.platform` | Check OS platform string | Matched to UA group (Win32, MacIntel, Linux x86_64) | `navigator.spec.ts`: correlates with UA OS | — |
| `navigator.hardwareConcurrency` | Read CPU core count | Replaced from pool [2,4,6,8,10,12,16] | `navigator.spec.ts`: in known set | — |
| `navigator.deviceMemory` | Read RAM in GB | Replaced from pool [4,8,16,32] | `navigator.spec.ts`: in known set | — |
| `navigator.userAgentData` | Client Hints: brands, platform, getHighEntropyValues | Full object constructed from spoofed UA; architecture inferred from GPU | `client-hints.spec.ts`: mobile false, platform matches, bitness 64, Firefox has no userAgentData | — |
| `navigator.connection` | Network type, bandwidth, RTT | Property hidden (returns undefined) | `navigator.spec.ts`: connection is undefined | — |
| `navigator.globalPrivacyControl` | GPC signal check | Set to true; getter hardened with native descriptors | `gpc.spec.ts`: value true, survives assignment, GOPD/toString/name all native | — |
| Worker `navigator` | Spawn Worker, read navigator inside, compare to main thread | Worker/SharedWorker constructors intercepted; Blob URL prepends navigator overrides | `workers.spec.ts`: Classic/SharedWorker match window | Module Worker via Blob URL skipped (known limitation) |

## Screen and Viewport

| API Surface | Adversary Probe | Defense | Test Evidence | Residual Risk |
|-------------|----------------|---------|---------------|---------------|
| `screen.width/height` | Read display resolution | Replaced from pool of 9 common resolutions | `screen.spec.ts`: width in known set, height matches pair | — |
| `window.devicePixelRatio` | Read DPR for HiDPI detection | 2 for 4K, 1 for others | `screen.spec.ts`: matches screen width | — |
| `matchMedia()` | Binary-search real dimensions via CSS media queries | Full MQ parser evaluates against spoofed values; hardware features fail closed | `matchmedia.spec.ts`: legacy/range/reversed/double syntax, vw/in unit resistance, binary search resistance, WebKit DPR aliases | Exotic CSS features or future syntax extensions may fall through to native |
| `window.screenX/Y`, `screen.availLeft/Top` | Read window position on multi-monitor setup | All return 0 (single-monitor appearance) | `screen-position.spec.ts`: all zero, MouseEvent coordinates preserved | — |

## Audio

| API Surface | Adversary Probe | Defense | Test Evidence | Residual Risk |
|-------------|----------------|---------|---------------|---------------|
| `AudioBuffer.getChannelData()` | Render test signal via OfflineAudioContext, hash samples | Deterministic micro-noise (+/-0.00005); WeakMap prevents compounding on repeated reads | `audio.spec.ts`: stable across 20 reads, different content diverges | — |
| Ultrasonic beacons (18-20 kHz) | Emit/receive near-ultrasonic signals for cross-device linking | BiquadFilter (-70 dB highshelf at 17999 Hz) inserted before AudioDestinationNode and AnalyserNode | `ultrasonic.spec.ts`: 19 kHz attenuated <0.05, 1 kHz passes >0.5, connect doesn't throw | Beacons below 17 kHz not attenuated; non-Web Audio ultrasonic paths (native apps) not covered |

## HTTP Headers

| API Surface | Adversary Probe | Defense | Test Evidence | Residual Risk |
|-------------|----------------|---------|---------------|---------------|
| `User-Agent` header | Compare HTTP header to JS navigator.userAgent | declarativeNetRequest rule replaces header on all requests | `session-identity.spec.ts`: HTTP UA matches JS UA; regression tests across items | Global rule means background tabs carry active tab's UA |
| `Sec-GPC` header | Check for Global Privacy Control signal | Header added via declarativeNetRequest | `gpc.spec.ts`: header present on fetch and navigation | — |
| `Referer` header | Read referrer for cross-origin tracking | Cross-origin trimmed to origin-only; third-party referrer removed entirely; same-origin preserved | `referrer.spec.ts`: cross-origin origin-only, third-party removed, same-origin full path preserved | — |
| Tracking query parameters | UTM, fbclid, gclid, etc. in URLs | 17 known tracking params stripped via declarativeNetRequest redirect | `query-stripping.spec.ts`: all 17 stripped, non-tracking preserved, hash preserved | New tracking param names require manual addition |

## Device Enumeration

| API Surface | Adversary Probe | Defense | Test Evidence | Residual Risk |
|-------------|----------------|---------|---------------|---------------|
| `navigator.mediaDevices.enumerateDevices()` | Count and fingerprint audio/video devices | Returns exactly 3 spoofed devices (audioinput, audiooutput, videoinput); IDs are 64-char hex from session seed; labels empty; prototypes match native InputDeviceInfo/MediaDeviceInfo | `enumerate-devices.spec.ts`: 3 devices, correct kinds, hex IDs, shared groupId, stable values, native prototypes, no own properties, GOPD native getters | getCapabilities() timeout flake on test substrate (pre-existing) |

## Sensors

| API Surface | Adversary Probe | Defense | Test Evidence | Residual Risk |
|-------------|----------------|---------|---------------|---------------|
| DeviceMotion/Orientation events | Read MEMS sensor data for device fingerprint | Prototype getters return null/zero | `sensors.spec.ts`: null readings for both event types | — |
| Generic Sensor API | Accelerometer, Gyroscope, etc. x/y/z readings | Prototype getters return null | `sensors.spec.ts`: null x/y/z | Constructors preserved (deleting them is itself a fingerprint) |

## Behavioral Biometrics (v2 Item 3)

| API Surface | Adversary Probe | Defense | Test Evidence | Residual Risk |
|-------------|----------------|---------|---------------|---------------|
| Mouse/touch event coordinates | Track cursor movement patterns | Gaussian-weighted coordinate noise; timestamp precision reduction | `biometric.spec.ts`: deterministic replay, monotonicity | Distribution shape test flaky (pre-existing) |
| `performance.now()` timing | Microsecond-resolution timing for keystroke/click patterns | Precision reduced | `biometric.spec.ts`: no backward movement, no fixed periodicity | — |

## Tracker Data Poisoning

| API Surface | Adversary Probe | Defense | Test Evidence | Residual Risk |
|-------------|----------------|---------|---------------|---------------|
| Ad-tech beacon endpoints | Collect behavioral data via tracking pixels | Chaff beacons fired to ad-tech endpoints with plausible interest clusters | `chaff-dom.spec.ts`: interaction-coupled, no attribute collision, pixel injection, selector miss handling | Beacon patterns could be fingerprinted by trackers if PhantomGrid becomes widely known |
| DOM attributes | Read page-element attributes for session tracking | DOM chaff: inject plausible attributes on page elements after user interaction | `chaff-dom.spec.ts`: 5 tests covering coupling, collision, pixel, miss, production path | — |
