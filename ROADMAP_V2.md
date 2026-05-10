# PhantomGrid v2 Roadmap

Ordered by dependency chain, then value. Each item is a single PR — build, review, merge, move on.

**Status:** LOCKED. Rowan reordered, lux endorsed. Building item 1.

---

## Context

Alex's review identified a structural tension: the research thesis argues cloaking is the wrong category, but PhantomGrid is ~90% cloaking / ~10% chaff. The v2 roadmap rebalances toward the poisoning/inundation thesis while closing real gaps identified in the LibreWolf comparison and rowan's hardening backlog.

Rowan's reorder rationale: session-level identity is the dependency that makes everything else less contradictory. Once all tabs share one identity, the UA rule is coherent, first-nav gets easier, and biometric linking isn't amplified by impossible per-tab hardware swaps.

---

## Tier 1 — Thesis Alignment

### 1. Session-Level Identity Default

**Why first:** This is the dependency that unblocks the rest. Per-tab rotation creates cross-tab contradiction signals when biometrics link tabs as the same human. Fixing this first means the UA rule is correct for all tabs, first-nav alignment becomes simpler, and biometric noise doesn't have to compensate for impossible per-tab hardware swaps.

**Scope:**
- Default: one identity per browser session, all tabs share one seed
- Rotation cadence: user-configurable, default 24h
- Per-tab mode retained as opt-in expert/chaos toggle with explicit warning that it increases linkability against biometric trackers
- `STATE.tabSeeds` replaced by `STATE.sessionSeed` in default mode; per-tab map retained for opt-in
- UA header DNR rule is now naturally consistent (one identity = one rule = all tabs match)

**Files:** `background.js` (identity lifecycle), side panel UI (toggle)

### 2. First-Navigation UA Alignment

**Why second:** With session identity locked, the DNR rule can be pre-set permanently to the session identity rather than updated per tab activation. Every navigation — including first loads — carries the correct UA.

**Scope:**
- Pre-set DNR UA rule to session identity on rotation and on SW wake
- Rule persists across tab switches (no longer needs onActivated updates in session mode)
- Investigate `chrome.webNavigation.onBeforeNavigate` for any remaining edge cases

**Files:** `background.js`

### 3. Behavioral Biometric Precision-Reduction Layer

**Why:** Every spoofed surface in PhantomGrid is static. Keystroke dynamics, mouse trajectory, scroll velocity are untouched. LexisNexis ThreatMetrix, IBM Trusteer, and FingerprintJS Pro all use behavioral biometrics. This is the gap that makes the entire cloaking layer defeatable.

**Correct claim class:** Reduces precision and classifier confidence. Does NOT defeat behavioral biometrics or synthesize a different human. A high-grade classifier can still link the same operator from trajectory shape, dwell cadence, correction patterns, and task rhythm. Noise raises cost; it will not make one operator look like a population.

**Scope:**
- Override `Event.prototype.timeStamp` getter: small deterministic jitter, seeded. **Must preserve monotonicity** — never negative or out-of-order deltas. Same-event re-reads must return the same jittered value.
- `performance.now()`: modest precision reduction + small deterministic jitter. **Not** a global 100ms bucket — too coarse for animations, editors, perf-sensitive apps. Start conservative, measure breakage.
- `MouseEvent` coordinate getters (`clientX`, `clientY`, `screenX`, `screenY`): ±0-1px noise. **Off or near-zero** for editable controls, pointer capture, drag/drop, canvas interaction, drawing, games.
- `WheelEvent.deltaY`: modest quantization. **Must preserve sign, zero, and small-scroll intent.** Don't erase trackpad micro-scroll behavior.
- Per-site kill switch. Ship with allowlist of high-interaction regression targets: Google Docs, Figma, canvas drawing, drag/drop, maps, simple games.
- All noise derived from session seed for determinism.

**Acceptance gates (rowan):**
- Regression suite proves monotonic timing and stable repeated reads
- No visible breakage on forms, drag/drop, canvas draw, Google Docs, Figma, maps, one simple browser game
- Diagnostic page records before/after distributions for timestamp deltas, mouse deltas, wheel deltas, performance.now precision
- PR explicitly labels this as precision reduction, not biometric spoofing

**Files:** `anti-fingerprint.js` (MAIN world additions)

### 4. Chaff Engine Redesign — Interaction-Coupled Chaff

**Why:** Current chaff beacons fire from the service worker with no preceding user gesture, no DOM context, no behavioral envelope. Server-side, a one-feature classifier separates them from real navigation. The 1% bypass zone only works when lures ride real telemetry.

**Scope (revised per rowan):**
- Prefer `fetch`/`sendBeacon`/`new Image()` fired from page context during real trusted interaction windows (click, navigation)
- Fires carry real referrer, real cookie jar, real temporal proximity to user action
- DOM mutation (injecting `<img>` pixels) is secondary path — only into plausible existing tracker/ad containers, low rate
- Background.js still controls persona selection (active interest clusters), timing cadence, mode (stealth/balanced/chaos)
- Content script receives chaff URLs via message and fires on qualifying interactions

**Goal:** Real referrer + cookie jar + temporal proximity to real user action. Not necessarily a durable DOM node.

**Files:** `poisoner.js` (refactor), `anti-fingerprint.js` or new `chaff-injector.js` (page-context handler), `background.js` (message passing)

---

## Tier 2 — Detection Hardening

### 5. OffscreenCanvas + WebGL readPixels Coverage

**Why:** FingerprintJS commercial uses these today. The canvas defense is bypassable by trackers already in production. Not optional hardening — do not let Tier 1 risk block this.

**Scope:**
- Intercept `OffscreenCanvas` constructor, apply same noise pipeline
- Intercept `WebGLRenderingContext.prototype.readPixels` and `WebGL2RenderingContext.prototype.readPixels`
- Intercept `OffscreenCanvas.prototype.convertToBlob`

**Files:** `anti-fingerprint.js`

### 6. Property Descriptor + toString Hardening

**Why:** `disguise()` is necessary but not sufficient. `Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent')` reveals the override. FingerprintJS checks this. Not optional.

**Scope:**
- Wrap `Object.getOwnPropertyDescriptor` to return native-shaped descriptors for all spoofed properties
- Ensure `configurable: true` on navigator getters (matching Chrome's real descriptors)
- Patch `Object.getOwnPropertyDescriptors` (plural)
- Verify `Reflect.getOwnPropertyDescriptor` coverage

**Files:** `anti-fingerprint.js`

---

## Tier 3 — Quick Wins (LibreWolf comparison)

Batched only if mechanically small. Each still gets review.

### 7. Global Privacy Control (GPC)

DNR adds `Sec-GPC: 1` header. MAIN world sets `navigator.globalPrivacyControl = true`.

**Files:** `background.js`, `anti-fingerprint.js`

### 8. Query String Stripping

DNR redirect rules strip ~40 known tracking parameters: `utm_*`, `fbclid`, `gclid`, `mc_eid`, `msclkid`, `yclid`, `twclid`, `dclid`, `_ga`, `_gl`, etc.

**Files:** `background.js`

### 9. Cross-Origin Referrer Trimming

DNR modifies `Referer` header to origin-only on cross-origin requests. MAIN world patches `document.referrer` getter to match.

**Files:** `background.js`, `anti-fingerprint.js`

### 10. WebRTC IP Leak Prevention

`chrome.privacy.network.webRTCIPHandlingPolicy` set to `default_public_interface_only`.

**Files:** `background.js`

### 11. enumerateDevices() Spoofing

Override `navigator.mediaDevices.enumerateDevices()` to return single default audio input/output device.

**Files:** `anti-fingerprint.js`

---

## Review Protocol

Same as v1.1: snapdragon builds, rowan + lux review, merge on sign-off. One item at a time. No batching.

## Ordering Note (rowan)

If item 3 (biometric precision reduction) proves risky after spike testing, do not let it block items 5-6. OffscreenCanvas and descriptor hardening are lower thesis value but higher certainty.

## Out of Scope (v3+)

- Full synthetic behavioral biometrics around chaff (generating realistic mouse trails, keystroke patterns)
- Crowd-blending canvas (making multiple users share identical output)
- Firefox persona removal from profile pool
- CSS font probing defense (no JS-hookable surface, engine-level only)
