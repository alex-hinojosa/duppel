# PhantomGrid Defense Taxonomy

How each defense surface operates, classified by mechanism. This taxonomy supports precise claim-making: "PhantomGrid does X" means a specific thing depending on the defense class.

---

## Defense Classes

**Cloaking** — Identity substitution. Replaces the real value with a plausible fake. The fake value is internally consistent within the session profile. A tracker sees a complete, coherent identity — just not yours.

**Precision Reduction** — Signal degradation. Adds bounded noise or quantizes output to reduce the precision available to classifiers. Does not substitute a different identity; makes the real signal harder to extract. Raises classification cost without claiming to defeat it.

**Poisoning** — False signal injection. Generates fabricated data designed to be mistaken for real user activity. Increases the noise floor in tracker datasets. Effectiveness depends on credibility of the injected signals.

**Blocking** — Signal elimination. Removes, suppresses, or policy-restricts a data channel entirely. The tracker gets nothing rather than something fake. Simplest mechanism, but absence can itself be a fingerprint.

---

## Surface Classification

| # | Surface | Class | Mechanism | Files |
|---|---------|-------|-----------|-------|
| 1 | Navigator properties (UA, platform, concurrency, memory, languages, vendor) | Cloaking | Profile-correlated values from UA_GROUPS; browser-filtered (v3 4a) | anti-fingerprint.js |
| 2 | Client Hints (userAgentData, getHighEntropyValues) | Cloaking | Full object constructed from spoofed UA profile | anti-fingerprint.js |
| 3 | Screen/viewport dimensions (8 surfaces) | Cloaking | Replaced from pool of 9 common resolutions | anti-fingerprint.js |
| 4 | CSS media queries (matchMedia) | Cloaking | Full MQ parser evaluates against spoofed profile values | anti-fingerprint.js |
| 5 | Canvas 2D fingerprinting (toDataURL, toBlob, getImageData) | Cloaking | Deterministic RGB noise from seeded hash; offscreen clone prevents visible mutation | anti-fingerprint.js |
| 6 | Canvas measureText | Cloaking + Precision Reduction | Deterministic width noise; amplified for known font-probe fonts (v3 5b) | anti-fingerprint.js |
| 7 | Audio fingerprinting (getChannelData) | Cloaking | Deterministic micro-noise on audio samples | anti-fingerprint.js |
| 8 | WebGL GPU identity (vendor, renderer, capabilities) | Cloaking | Profile-bucketed values (5 GPU classes); native-shape objects | anti-fingerprint.js |
| 9 | Timezone (Intl.DateTimeFormat, getTimezoneOffset) | Cloaking | DST-aware offset from profile timezone | anti-fingerprint.js |
| 10 | Device enumeration (enumerateDevices) | Cloaking | Fixed 3-device list; deterministic IDs from session seed | anti-fingerprint.js |
| 11 | Worker navigator properties | Cloaking | Blob URL pre-injection of spoofed navigator values | anti-fingerprint.js |
| 12 | HTTP User-Agent header | Cloaking | DNR rule replaces header to match JS-level spoofed UA | background.js |
| 13 | Event.timeStamp (all events incl. keyboard) | Precision Reduction | +-1ms seeded Gaussian jitter; WeakMap cached; synthetic events bypass | anti-fingerprint.js |
| 14 | performance.now() | Precision Reduction | 0.1ms quantization + seeded Gaussian jitter; monotonic clamp | anti-fingerprint.js |
| 15 | MouseEvent coordinates (clientX/Y, pageX/Y, screenX/Y) | Precision Reduction | +-0-1px Gaussian noise per axis; skipped on editable/canvas/SVG targets | anti-fingerprint.js |
| 16 | WheelEvent deltas (deltaX, deltaY) | Precision Reduction | Integer quantization; preserves sign and zero | anti-fingerprint.js |
| 17 | Battery Status API | Precision Reduction | Fixed lowest-entropy state (fully charged, AC power) | anti-fingerprint.js |
| 18 | Ultrasonic audio defense (17-20 kHz) | Blocking | BiquadFilter highshelf at 17999 Hz / -70 dB before output and analyser | anti-fingerprint.js |
| 19 | Sensor APIs (DeviceMotion, Orientation, Generic) | Blocking | Prototype getters return null/zero | anti-fingerprint.js |
| 20 | Global Privacy Control | Blocking | Sec-GPC: 1 header + navigator.globalPrivacyControl = true | background.js, anti-fingerprint.js |
| 21 | Query string stripping (utm_*, fbclid, gclid, etc.) | Blocking | DNR redirect strips 17 tracking parameters | background.js |
| 22 | Cross-origin referrer trimming | Blocking | DNR + document.referrer spoofed to origin-only cross-origin | background.js, anti-fingerprint.js |
| 23 | WebRTC IP leak prevention | Blocking | chrome.privacy policy: default_public_interface_only | background.js |
| 24 | Tracker cookie cleanup (31 domains) | Blocking | Periodic removal every 15 min | background.js |
| 25 | Chaff beacons (interaction-coupled) | Poisoning | Fake ad-tech beacons fired during real user interactions; 8 interest clusters, 3 modes | poisoner.js, bridge.js, background.js |
| 26 | DOM attribute chaff | Poisoning | Plausible tracker/ad attributes injected on page elements post-interaction | bridge.js |

---

## Class Distribution

| Class | Count | Surfaces |
|-------|-------|----------|
| Cloaking | 12 | Navigator, Client Hints, Screen, CSS MQ, Canvas 2D, Audio, WebGL, Timezone, Devices, Workers, HTTP UA, measureText |
| Precision Reduction | 6 | Event.timeStamp, performance.now(), MouseEvent coords, WheelEvent deltas, Battery, measureText (font probe) |
| Blocking | 7 | Ultrasonic, Sensors, GPC, Query stripping, Referrer, WebRTC, Tracker cookies |
| Poisoning | 2 | Chaff beacons, DOM attribute chaff |

Note: measureText appears in both Cloaking (baseline noise) and Precision Reduction (amplified noise for font probes). The mechanism differs by context.

---

## Claim Classes

When describing PhantomGrid's capabilities, use these precise formulations:

- **Cloaking surfaces:** "Replaces [surface] with a plausible spoofed value, consistent within the session profile." Does NOT claim to be undetectable — sophisticated probes (CreepJS, FingerprintJS Pro) can detect that spoofing is occurring. The value is that the *composite fingerprint changes* on rotation.

- **Precision reduction surfaces:** "Reduces precision available to behavioral biometric classifiers." Does NOT claim to defeat behavioral fingerprinting or synthesize a different human. A high-grade classifier can still link the same operator from trajectory shape, dwell cadence, and task rhythm.

- **Blocking surfaces:** "Eliminates [signal] via [policy/filter/removal]." The strongest claim class — the data channel is shut. Residual risk: absence of the signal can itself be a fingerprint (e.g., no DeviceMotion events implies desktop or privacy extension).

- **Poisoning surfaces:** "Injects fabricated [beacons/attributes] designed to pollute tracker datasets." Effectiveness depends on chaff credibility — a one-feature classifier can separate current chaff from real traffic if PhantomGrid's patterns become widely known.
