# PhantomGrid v2 Roadmap

Ordered by dependency chain, then value. Each item is a single PR — build, review, merge, move on.

**Status:** Items 1-4, 5-11 COMPLETE/ACCEPTED. Item 4 dual-gate accepted (rowan engineering UID 297, lux methodology UID 296, corrective commit 8a4f974).

---

## Context

Alex's review identified a structural tension: the research thesis argues cloaking is the wrong category, but PhantomGrid is ~90% cloaking / ~10% chaff. The v2 roadmap rebalances toward the poisoning/inundation thesis while closing real gaps identified in the LibreWolf comparison and rowan's hardening backlog.

Rowan's reorder rationale: session-level identity is the dependency that makes everything else less contradictory. Once all tabs share one identity, the UA rule is coherent, first-nav gets easier, and biometric linking isn't amplified by impossible per-tab hardware swaps.

---

## Tier 1 — Thesis Alignment

### 1. Session-Level Identity Default — COMPLETE

**Status:** Merged (commit 8daff43). Rowan engineering accepted after two corrective rounds. Lux methodology accepted. 20 e2e tests in `session-identity.spec.ts`.

**Why first:** This is the dependency that unblocks the rest. Per-tab rotation creates cross-tab contradiction signals when biometrics link tabs as the same human. Fixing this first means the UA rule is correct for all tabs, first-nav alignment becomes simpler, and biometric noise doesn't have to compensate for impossible per-tab hardware swaps.

**Scope:**
- Default: one identity per browser session, all tabs share one seed
- Rotation cadence: user-configurable, default 24h
- Per-tab mode retained as opt-in expert/chaos toggle with explicit warning that it increases linkability against biometric trackers
- `STATE.tabSeeds` replaced by `STATE.sessionSeed` in default mode; per-tab map retained for opt-in
- UA header DNR rule is now naturally consistent (one identity = one rule = all tabs match)

**Files:** `background.js` (identity lifecycle), side panel UI (toggle)

### 2. First-Navigation UA Alignment — ACCEPTED

**Status:** Dual-gate accepted. Rowan engineering accepted (UID 274, commit 6a37be9). Lux methodology accepted (UID 275). 5 e2e tests in `first-nav-alignment.spec.ts`. Three non-blocking follow-ups pending (see below).

**Why second:** With session identity locked, the DNR rule can be pre-set permanently to the session identity rather than updated per tab activation. Every navigation — including first loads — carries the correct UA.

**Implementation (three-part fix):**
1. **Cold-start persistence:** `createIdentity()` persists `{lastSeed, lastUA}` to `chrome.storage.local`. On cold start, `restoreState()` reads these and applies the stale UA to the DNR rule immediately — spoofed UA floor from first request, even before `rotateIdentity()` generates a fresh identity (~ms later).
2. **Seed pre-injection:** `chrome.tabs.onUpdated` listener with `injectImmediately:true` pre-injects session seed into `sessionStorage` before `anti-fingerprint.js` runs. If the injection wins the race, no desync occurs.
3. **Reload elimination:** `seedObserved` handler silently corrects `sessionStorage` instead of reloading on desync. The reload was itself a fingerprinting signal (`performance.navigation.type === 1`).

**Documented residual gap:** If pre-injection loses the IPC race (SW→renderer latency), the first page load on a new origin has a JS/network UA mismatch. SessionStorage is silently corrected; all subsequent same-origin navigations are aligned. No reload.

**Follow-ups from rowan (non-blocking for Items 3-4):**
1. Add a forced-desync test: write wrong `__pg_seed__`, trigger `seedObserved`, verify sessionStorage corrects to session seed without tab reload.
2. Document that `allFrames:false` in the pre-injection is intentional (top-frame only); cross-origin iframe residual is explicit.
3. Update stale background.js top-of-file comment that still describes the old desync-reload behavior.

**Files:** `background.js` (4 edits), `anti-fingerprint.js` (comment), `bridge.js` (comment)

### 3. Behavioral Biometric Precision-Reduction Layer — ACCEPTED

**Status:** Dual-gate accepted. Rowan engineering accepted (UID 292, commit 56682c9). Lux methodology accepted (UID 291). 4 e2e tests in `biometric.spec.ts`. Implementation: commits 7a4d018 (initial) + 56682c9 (monotonicity corrective).

**Why:** Every spoofed surface in PhantomGrid is static. Keystroke dynamics, mouse trajectory, scroll velocity are untouched. LexisNexis ThreatMetrix, IBM Trusteer, and FingerprintJS Pro all use behavioral biometrics. This is the gap that makes the entire cloaking layer defeatable.

**Correct claim class:** Reduces precision and classifier confidence. Does NOT defeat behavioral biometrics or synthesize a different human. A high-grade classifier can still link the same operator from trajectory shape, dwell cadence, correction patterns, and task rhythm. Noise raises cost; it will not make one operator look like a population.

**Scope:**
- Override `Event.prototype.timeStamp` getter: small deterministic jitter, seeded. **Must preserve monotonicity** — never negative or out-of-order deltas. Same-event re-reads must return the same jittered value.
- `performance.now()`: modest precision reduction + small deterministic jitter. **Not** a global 100ms bucket — too coarse for animations, editors, perf-sensitive apps. Start conservative, measure breakage.
- `MouseEvent` coordinate getters (`clientX`, `clientY`, `screenX`, `screenY`): ±0-1px noise. **Off or near-zero** for editable controls, pointer capture, drag/drop, canvas interaction, drawing, games.
- `WheelEvent.deltaY`: modest quantization. **Must preserve sign, zero, and small-scroll intent.** Don't erase trackpad micro-scroll behavior.
- Per-site kill switch. Ship with allowlist of high-interaction regression targets: Google Docs, Figma, canvas drawing, drag/drop, maps, simple games.
- All noise derived from session seed for determinism.
- **Seeded non-uniform jitter required** (rowan/lux): distribution must not be a fixed offset, fixed cadence, or simple uniform pattern. Seeded Gaussian or truncated Gaussian is acceptable if bounded.

**Acceptance gates (rowan, UID 267 — updated):**
1. **Session-stable:** identical seed + identical session context produces reproducible jitter for audit and replay.
2. **Non-uniform:** distribution must not be a fixed offset, fixed cadence, or simple uniform pattern. Seeded Gaussian or truncated Gaussian acceptable if bounded.
3. **Bounded:** jitter cannot break UI semantics, event ordering, debounce thresholds, accessibility timing, or site functionality.
4. **Cross-surface coherent:** timing perturbation must stay internally consistent across mouse, scroll, keyboard, and navigation surfaces — not independent RNG per API.
5. **No mid-session drift:** distribution parameters must remain stable for the session identity. Rotation belongs at persona/session boundary, not inside a live browse.
6. **Measurable overhead:** retain the current performance budget; fail if instrumentation adds observable latency beyond the agreed envelope.
7. **Regression tests:** include a deterministic replay test, a distribution-shape sanity test, and a no-fixed-periodicity test.

**Acceptance wording (rowan):** "Item 3 passes only if behavioral timing precision is reduced through bounded, seeded, non-uniform jitter that is deterministic within a session, coherent across related interaction surfaces, and free of fixed offsets or repeating cadence artifacts."

**Methodology endorsement (lux, UID 270):** Seeded Gaussian distribution provides necessary entropy to break rhythm-detection oracles while maintaining deterministic reproducibility. Cross-surface coherence is formally required — asynchronous jittering across APIs would create a coherence signal that is itself a fingerprint.

**Out of scope:** Audio-context fingerprinting is a Tier 2 surface, tracked separately.

**Files:** `anti-fingerprint.js` (MAIN world additions)

### 4. Chaff Engine Redesign — Interaction-Coupled Chaff — ACCEPTED

**Status:** Dual-gate accepted. Rowan engineering accepted (UID 297, corrective commit 8a4f974). Lux methodology accepted (UID 296). Initial submission (08f42e8) NOT ACCEPTED by rowan (UID 294, 2 blockers + 1 medium); corrective (8a4f974) addresses all three. 5 e2e tests in `chaff-dom.spec.ts`, 8 unit tests in `poisoner-test.js`.

**Non-blocking cleanup (rowan):** Randomize matched element order before `slice(0, maxTargets)` for stealth realism. Current code deterministically selects first-in-selector-order.

**Why:** Current chaff beacons fire from the service worker with no preceding user gesture, no DOM context, no behavioral envelope. Server-side, a one-feature classifier separates them from real navigation. The 1% bypass zone only works when lures ride real telemetry.

**Scope (revised per rowan UID 272):**
- Prefer `fetch`/`sendBeacon`/`new Image()` fired from page context during real trusted interaction windows (click, navigation)
- Fires carry real referrer, real cookie jar, real temporal proximity to user action
- DOM mutation (injecting `<img>` pixels) is secondary path — only into plausible existing tracker/ad containers, low rate
- Background.js still controls persona selection (active interest clusters), timing cadence, mode (stealth/balanced/chaos)
- Content script receives chaff URLs via message and fires on qualifying interactions
- **HTML-attribute-level chaff metadata allowed** as credibility enhancement — bounded to plausible tracker/ad/container sinks only. No broad DOM noise. (rowan UID 272, lux UID 270)

**Implementation gates (rowan, UID 272):**
- Interaction-coupled, low-rate chaff as default behavior
- HTML-attribute metadata bounded to plausible tracker/ad/container sinks
- No generic DOM noise beyond plausible injection targets
- Preserve existing mode controls (stealth/balanced/chaos)

**Methodology endorsement (lux, UID 270):** HTML-attribute-level chaff metadata integration explicitly endorsed. Injected metadata must be bounded to the same trust-envelope as the host application. Provides credibility signal that distinguishes PhantomGrid chaff from detectable synthetic traffic.

**Goal:** Real referrer + cookie jar + temporal proximity to real user action. Not necessarily a durable DOM node.

**Files:** `poisoner.js` (DOM chaff config generation), `bridge.js` (DOM chaff application), `background.js` (dispatch)

---

## Tier 2 — Detection Hardening

### 5. OffscreenCanvas + WebGL readPixels Coverage — COMPLETE

**Status:** Merged. Implemented prior to v2 roadmap formalization.

**Why:** FingerprintJS commercial uses these today. The canvas defense is bypassable by trackers already in production. Not optional hardening — do not let Tier 1 risk block this.

**Scope:**
- Intercept `OffscreenCanvas` constructor, apply same noise pipeline
- Intercept `WebGLRenderingContext.prototype.readPixels` and `WebGL2RenderingContext.prototype.readPixels`
- Intercept `OffscreenCanvas.prototype.convertToBlob`

**Files:** `anti-fingerprint.js`

### 6. Property Descriptor + toString Hardening — COMPLETE

**Status:** Merged. Implemented prior to v2 roadmap formalization.

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

### 7. Global Privacy Control (GPC) — COMPLETE

**Status:** Merged. E2e tests in `gpc.spec.ts`.

DNR adds `Sec-GPC: 1` header. MAIN world sets `navigator.globalPrivacyControl = true`.

**Files:** `background.js`, `anti-fingerprint.js`

### 8. Query String Stripping — COMPLETE

**Status:** Merged. E2e tests in `query-stripping.spec.ts`.

DNR redirect rules strip ~40 known tracking parameters: `utm_*`, `fbclid`, `gclid`, `mc_eid`, `msclkid`, `yclid`, `twclid`, `dclid`, `_ga`, `_gl`, etc.

**Files:** `background.js`

### 9. Cross-Origin Referrer Trimming — COMPLETE

**Status:** Merged. E2e tests in `referrer.spec.ts`.

DNR modifies `Referer` header to origin-only on cross-origin requests. MAIN world patches `document.referrer` getter to match.

**Files:** `background.js`, `anti-fingerprint.js`

### 10. WebRTC IP Leak Prevention — COMPLETE

**Status:** Merged. E2e tests in `webrtc.spec.ts`.

`chrome.privacy.network.webRTCIPHandlingPolicy` set to `default_public_interface_only`.

**Files:** `background.js`

### 11. enumerateDevices() Spoofing — COMPLETE

**Status:** Merged (commit 45b3a0a). E2e tests in `enumerate-devices.spec.ts`.

Override `navigator.mediaDevices.enumerateDevices()` to return single default audio input/output device.

**Files:** `anti-fingerprint.js`

---

## Review Protocol

Same as v1.1: snapdragon builds, rowan + lux review, merge on sign-off. One item at a time. No batching.

## Ordering Note (rowan)

If item 3 (biometric precision reduction) proves risky after spike testing, do not let it block items 5-6. OffscreenCanvas and descriptor hardening are lower thesis value but higher certainty. *(Note: Items 5-6 are now complete; this constraint is satisfied.)*

## Out of Scope (v3+)

- Full synthetic behavioral biometrics around chaff (generating realistic mouse trails, keystroke patterns)
- Crowd-blending canvas (making multiple users share identical output)
- Firefox persona removal from profile pool
- CSS font probing defense (no JS-hookable surface, engine-level only)
- Android TV ACR disruption — companion app that poisons Automatic Content Recognition (audio fingerprinting used by Samba TV, Alphonso, etc. to identify what's playing on the TV). Research vectors: ultrasonic watermark injection, audio overlay that shifts ACR hash without audible distortion, or periodic content-signature confusion bursts. Requires understanding of Shazam-style spectrogram hashing and TV-specific ACR SDKs. Platform: Android app targeting TV-connected devices or sideloaded onto Android TV directly.
