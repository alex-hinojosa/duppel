# PhantomGrid Product Roadmap

Informed by "The Architecture of Extraction" (NAS, 2026-05-08), rowan QA
passes 1-8, lux QA sign-off, and three-way review synthesis.

Positioning: **controlled plausibility**. PhantomGrid reduces uniquely
identifying signals, avoids obvious extension signatures, and disrupts
tracker synthesis — without creating a new "statistical ghost" fingerprint.
Zero-profile is not the objective; the paper demonstrates it is
mathematically improbable and itself a detection signal.

---

## v1.0 — Fingerprint Hardening (current, lab candidate)

Ship scope. All items implemented and QA-reviewed.

### Spoofing surfaces

| Vector               | API / Target                        | Status    |
|----------------------|-------------------------------------|-----------|
| User-Agent           | navigator.userAgent, appVersion     | Done      |
| Platform             | navigator.platform                  | Done      |
| CPU / Memory         | hardwareConcurrency, deviceMemory   | Done      |
| Screen               | screen.width/height/avail/color     | Done      |
| Window dimensions    | innerWidth/Height, outerWidth/Height| Done      |
| devicePixelRatio     | window.devicePixelRatio             | Done      |
| visualViewport       | width, height, scale                | Done      |
| Canvas               | toDataURL, toBlob, getImageData     | Done      |
| Font metrics         | measureText                         | Done      |
| WebGL                | vendor, renderer, extensions        | Done      |
| Audio                | getChannelData                      | Done      |
| Timezone             | DateTimeFormat, getTimezoneOffset   | Done      |
| Languages            | navigator.languages, language       | Done      |
| Client Hints         | userAgentData, getHighEntropyValues | Done      |
| Touch                | maxTouchPoints (pinned to 0)        | Done      |
| Connection           | navigator.connection (removed)      | Done      |
| Webdriver            | navigator.webdriver (false)         | Done      |
| Worker scope         | Classic Worker navigator overrides  | Done      |

### Noise model

Deterministic per-input hash noise (rowan pass 4 fix). No advancing PRNG.
Repeated identical probes return identical output within a session.

- Canvas: pixelNoise(seed, pixelIndex, pixelValue)
- measureText: hash(text + font + canvasSeed)
- Audio: hash(audioSeed + channel + sampleIndex + quantizedValue),
  applied once per buffer+channel via WeakMap guard (rowan pass 6 fix)

### Poisoner

- Auto-fire: chaos mode only
- Targets: GA, GA4, Meta Pixel with varied domains, screens, SDK versions
- Lab/experimental label for public release

### Tracker blocking

- Static declarativeNetRequest rules (header stripping, known domains)
- Per-site disable via cookie (__pgd)

### Known limitations (documented, not hidden)

- sessionStorage.__pg_seed__ readable by same-origin page JS
- __pgd cookie readable by page JS (JS cookies cannot be httpOnly)
- matchMedia not intercepted (gap documented)
- Module/Shared/Service Workers and Worklets not covered
- Cross-origin iframe fingerprint desync (inherent to content-script model)

### Test harness

- Manual regression suite: canvas, audio, measureText stability (N=20)
- Rotation/change-after-reload test (manual two-step)
- Profile consistency checks (navigator/screen/DPR/viewport/WebGL/UA-CH)
- Classic Blob Worker navigator parity test
- Accepted at manual release-gate bar (rowan pass 8)

---

## v1.1 — Credibility + Threat Surface Expansion

Extension-level work. No network infrastructure required.

### 1. Poisoner credibility redesign — DONE (rowan sign-off 2026-05-08)

Paper reference: IDPI "1% bypass zone" — burying adversarial lures at
<1% of total data drops AI classification accuracy to 53%.

- **Session personas**: 6 interest clusters (tech, home, fashion, fitness,
  family, finance). Each rotation picks 2-3 clusters; all chaff within
  the session draws from them for coherence. Locked identifiers per
  session: screen resolution, GA client ID, GA property IDs, Meta pixel ID.
- **Stealth mode**: 1 beacon every 8-20 min. Coherent persona, long
  stagger delays (4-8s between beacons). Auto-fire ON.
- **Balanced mode**: 1-3 beacons every 3-8 min. Moderate stagger (1.5-3s).
  Auto-fire ON.
- **Chaos mode**: 5-15 beacons every 1-3 min. Short stagger (0.5-1s).
  Auto-fire ON. Lab-only.
- Variable timing via one-shot alarms (each fire schedules the next).
- Sent to rowan for review (2026-05-08).

### 2. Worker scope expansion — DONE (Module + Shared, rowan sign-off 2026-05-08)

Priority order (by fingerprinting prevalence):

1. Module Worker (type: "module") — DONE. Blob wrapper with dynamic
   `import()` to reload the original script. Caveat: blob URLs have
   opaque origins; cross-origin worker scripts without CORS will fail.
2. SharedWorker — DONE. Blob wrapper with `importScripts()`.
3. ServiceWorker — NOT covered. Registered via `navigator.serviceWorker.register()`,
   runs in a separate registration scope that content scripts cannot intercept.
4. Worklets (AudioWorklet, PaintWorklet) — NOT covered (lowest priority).

### 3. Sensor API / DeviceMotion defense — DONE (rowan + lux sign-off 2026-05-08)

Paper reference: zero-permission UXDT via MEMS gyroscope resonance
(19-29 kHz). Gyroscope data accessible without consent via Sensor API
(Android) and Core Motion (iOS).

- Audit: Desktop Chrome exposes DeviceMotion/Orientation events and
  Generic Sensor API (Accelerometer, Gyroscope, LinearAccelerationSensor,
  AbsoluteOrientationSensor, RelativeOrientationSensor) on convertible
  laptops. Default Permissions-Policy is `self` with no user prompt.
  AmbientLightSensor behind expired Chrome flag (negligible risk).
- Defense: prototype getter overrides (JShelter-proven approach).
  DeviceMotion/Orientation return null readings; Generic Sensor x/y/z
  return null. Matches standard desktop behavior (no sensor hardware).
  Constructors preserved to avoid API-surface fingerprinting.
- Breakage risk: low. Spoofed desktop identity already implies no sensors.
  Convertible-specific motion UIs will see null values (expected behavior
  when browsing as a desktop).

### 4. WebAudio near-ultrasonic attenuation — DONE (rowan + lux sign-off 2026-05-08)

Paper reference: USAT framework uses createMediaElementSource() to
analyze audio tracks without microphone permission, operating at
18.5-19.5 kHz.

- Approach: Silverdog/SilverWall (PETS 2017) proven method. Intercept
  `AudioNode.prototype.connect()` — when destination is
  `AudioDestinationNode`, insert a `BiquadFilterNode` (type: highshelf,
  frequency: 17999 Hz, Q: 0, gain: -70 dB) between source and output.
- Coverage: all WebAudio paths that connect to speakers. AudioWorklet
  processors NOT covered (separate thread, not patchable from content
  script — documented as known limitation).
- Breakage risk: low. 17-20 kHz is inaudible to most adults. Affected
  niche uses: data-over-sound pairing (Chirp.io, Google Nearby — both
  deprecated), dog whistle apps, web audiometry. Per-site bypass via
  existing __pgd cookie mechanism.
- Regression test: 19 kHz oscillator confirms attenuation (<0.01 peak);
  1 kHz oscillator confirms pass-through (>0.5 peak).

### 5. matchMedia evaluator — DONE (rowan + lux sign-off 2026-05-08)

Rowan pass 4 removed the fragile regex-based approach. Implemented a
full CSS media query parser and evaluator:

- Handles min-/max- prefixes for all dimension features
- Resolves orientation, pointer, hover, display-mode correctly
- Resists binary-search contradiction probes (boundary at spoofed value)
- Returns consistent results with spoofed screen/DPR values
- Preference features (prefers-color-scheme, prefers-reduced-motion,
  etc.) pass through to real matchMedia to avoid breaking dark mode
  and accessibility styling.

### 6. Automated E2E testing — DONE (rowan + lux sign-off 2026-05-08)

- Headful Playwright with --load-extension flag
- 75 tests: 67 local + 2 rotation + 6 external smoke
- Automated rotation verification (replaces manual two-step)
- CI-capable: `npm test` returns pass/fail exit code

Setup (required for clean checkout):
```
npm run setup    # installs @playwright/test + Chromium
npm test         # local + rotation (CI default)
npm run test:external  # smoke tests (network-dependent)
```

---

## Phase 2 — Network-Level Protection

Sits between all LAN devices and the ISP router. Protects devices
that cannot run browser extensions (phones, smart TVs, IoT, guests).

### 1. CNAME cloaking detection

Paper reference: 21% of subdomain deployments use CNAME cloaking.
28% use obfuscated path endpoints.

- CNAME chain resolution: inspect DNS responses, flag subdomains that
  CNAME to known tracker infrastructure
- First-party relay heuristics: detect patterns where a first-party
  subdomain proxies to a third-party backend
- Suspicious path clustering: identify obfuscated endpoints
  (e.g., /ag/g/c) by request pattern and payload shape
- User-facing warnings when the browser can only see the first-party hop

### 2. Server-side tagging (sGTM) visibility

Paper reference: sGTM shifts tracking from client to cloud. Browser
extensions are blind to the ultimate destination of telemetry.

- Transparent proxy or DNS-level inspection on the LAN gateway
- Detect sGTM patterns: single encrypted stream to publisher cloud,
  then fan-out to third-party endpoints
- Requires HTTPS inspection (CA cert on opted-in devices) or
  metadata-only heuristics (connection timing, request frequency)

### 3. IDPI-informed poisoning at network level

Paper reference: Indirect Prompt Data Poisoning targets downstream
AI classification systems.

- Inject adversarial metadata into HTTP headers and response bodies
  at the proxy level
- Target the 1% bypass zone: minimal volume, maximum disruption to
  identity graph synthesis
- Structure lures to exploit LLM attention mechanisms in data broker
  classification pipelines
- Requires research spike: what metadata fields do enrichment
  waterfalls actually ingest?

### 4. DNS sinkhole + encrypted upstream

- AdGuard Home or Pi-hole for DNS-level tracker blocking
- DoH/DoT upstream to prevent ISP DNS inspection
- Per-device policies (phones get DNS blocking; laptops get full proxy)

### 5. Behavioral telemetry disruption (research)

Paper reference: keystroke dynamics (EER 2.78% at 190 keystrokes),
mouse trajectories (93% accuracy from single trajectory), gait
recognition (92.68% accuracy).

- Research-only: evaluate feasibility of injecting plausible noise
  into timing-based telemetry at the network level
- High breakage risk: active behavioral spoofing may trigger fraud
  detection and service denial
- Decision gate: do not ship until evidence shows it reduces
  linkability without increasing friction

### 6. Hardware platform

Start with Option A (DNS + proxy on existing hardware):
- Surface Pro or Raspberry Pi 5
- Graduate to dedicated appliance (Option C) once approach is proven

---

## Threat model coverage matrix

| Extraction vector          | Paper section | v1.0      | v1.1       | Phase 2    |
|---------------------------|---------------|-----------|------------|------------|
| Canvas/Audio/WebGL FP     | 1.1           | Spoofed   | —          | —          |
| Navigator/Screen/TZ       | 1.1           | Spoofed   | —          | —          |
| Font metrics              | 1.1           | Noised    | —          | —          |
| Client Hints (UA-CH)      | 1.1           | Spoofed   | —          | —          |
| Worker scope leaks        | 1.1           | Classic   | Full       | —          |
| matchMedia                | 1.1           | Gap       | Evaluator  | Network    |
| UXDT (ultrasonic)         | 1.2           | —         | Attenuated | Network    |
| Gyroscope/Sensor API      | 1.2           | —         | Nulled     | —          |
| Keystroke dynamics         | 1.3           | —         | —          | Research   |
| Mouse/touch dynamics       | 1.3           | —         | —          | Research   |
| CNAME cloaking            | 1.4           | —         | —          | Detect     |
| Server-side tagging       | 1.4           | —         | —          | Detect     |
| Identity graph synthesis  | 2.1-2.3       | —         | —          | Disrupt    |
| Tracker domain blocking   | —             | DNR rules | —          | DNS sink   |
| Header stripping          | —             | DNR rules | —          | Proxy      |
| Data poisoning            | 3.2           | Chaos-only| Credible   | IDPI       |
| AI classification bypass  | 3.3           | —         | —          | IDPI 1%    |

---

## Decision log

| Date       | Decision                                      | Source         |
|------------|-----------------------------------------------|----------------|
| 2026-05-08 | Deterministic per-input noise, not PRNG       | rowan pass 4   |
| 2026-05-08 | WebRTC browser default, not relay-only        | rowan pass 4   |
| 2026-05-08 | matchMedia removed (fragile regex)            | rowan pass 4   |
| 2026-05-08 | Audio WeakMap guard (no compound mutation)    | rowan pass 6   |
| 2026-05-08 | Positioning: "controlled plausibility"        | rowan pass 5+8 |
| 2026-05-08 | Poisoner: credibility > volume                | paper + rowan  |
| 2026-05-08 | UXDT/biometrics: threat model, not v1         | rowan + lux    |
| 2026-05-08 | CNAME/sGTM: Phase 2 priority                  | rowan          |
| 2026-05-08 | IDPI 1% bypass zone: Phase 2 poisoning        | paper + lux    |
| 2026-05-08 | Sensor API: null readings, not constructor delete | JShelter + research |
| 2026-05-08 | Ultrasonic: highshelf -70 dB at 17999 Hz       | Silverdog/PETS 2017 |
| 2026-05-08 | matchMedia: full evaluator, prefs pass-through  | rowan pass 4+5 |

---

authored_by: snapdragon
reviewed_by: rowan, lux
paper: "The Architecture of Extraction" (NAS, 2026-05-08)
date: 2026-05-08
