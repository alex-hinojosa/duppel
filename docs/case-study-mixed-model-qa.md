# PhantomGrid v1.1: A Case Study in Mixed-Model Code Review and QA

**Project:** PhantomGrid — Chrome Manifest V3 anti-tracking extension
**Period:** 2026-05-08 (single-day development sprint)
**Models involved:**

| Agent | Model | Role |
|-------|-------|------|
| **snapdragon** | Claude (claude-code) | Author — code, architecture, research synthesis |
| **rowan** | Claude (Sonnet) | Primary reviewer — 9 QA passes across v1.0 + v1.1 |
| **lux** | Gemini (via Gemini CLI) | Secondary reviewer — detection surface analysis, independent validation |

**Human:** alex — gating authority, research direction, final approval

---

## 1. Context: What PhantomGrid Does

PhantomGrid is a Chrome extension that provides three layers of anti-tracking protection:

1. **Fingerprint spoofing** — Overrides 18+ browser APIs at the prototype level to present plausible but fake hardware profiles (user agent, screen, GPU, CPU, memory, timezone, canvas, audio, WebGL, fonts)
2. **Tracker blocking** — declarativeNetRequest rules blocking 42 ad-tech domains, stripping identifying headers
3. **Data poisoning** — Fires fake Google Analytics, GA4, and Meta Pixel beacons with coherent session personas to degrade data broker pipelines

The extension runs entirely locally with no external dependencies. All fingerprint noise is deterministic and session-stable: repeated probes return identical output within a session, but different output after identity rotation.

---

## 2. The Review Model

PhantomGrid used a **sequential multi-model review process** with increasing adversarial depth:

```
snapdragon authors code
    → rowan reviews (multiple passes, architectural + correctness)
    → lux reviews (independent, detection surface + plausibility)
    → both sign off
    → snapdragon implements fixes
    → re-review until clean
```

This was not a single-pass code review. rowan performed **8 passes** across v1.0 and v1.1, with each pass building on findings from the previous one. lux provided **independent validation** — reviewing the same code without access to rowan's findings, which surfaced both overlapping and unique issues.

The key insight: **different models catch different categories of bugs.** Claude (rowan) excelled at architectural consistency, state management, and edge-case correctness. Gemini (lux) excelled at adversarial detection surface analysis and real-world attack pattern recognition.

---

## 3. Research Driving Product Development

A research paper dropped during development — "The Architecture of Extraction" — which directly shaped three v1.1 features:

### Paper finding → Product decision

| Paper concept | Product impact |
|--------------|----------------|
| **IDPI "1% bypass zone"** — burying adversarial lures at <1% of data drops AI classification accuracy to 53% | Poisoner redesign: stealth mode fires 1 beacon every 8-20 min with coherent personas instead of high-volume noise |
| **UXDT ultrasonic beacons** — 18.5-19.5 kHz cross-device tracking via WebAudio without microphone permission | New v1.1 feature: highshelf filter at 17999 Hz, -70 dB attenuation on AudioNode.connect() |
| **MEMS gyroscope fingerprinting** — zero-permission device identification via Sensor API resonance patterns | New v1.1 feature: Sensor API defense nulling DeviceMotion, DeviceOrientation, and 8 Generic Sensor classes |
| **"Absence of data is itself a data point"** — blocking creates a detectable "statistical ghost" | Product positioning shifted from "undetectable" to "controlled plausibility" — rowan's framing |

The three-way review (snapdragon + rowan + lux via IRC #phantomgrid) synthesized these findings into the v1.1 roadmap. Research didn't just inform features — it changed the product's fundamental positioning.

---

## 4. What Each Model Caught

### 4.1 rowan (Claude) — 8 Passes, 30+ Findings

rowan's strength was **architectural reasoning and state management**. Findings clustered around correctness of stateful systems, edge-case behavior under composition, and test methodology.

#### v1.0 Review Passes

**Pass 1 — Structural integrity (5 findings)**
- Impossible profile combinations (Firefox UA + ANGLE GPU)
- Message channel authentication missing
- Cross-frame seed desynchronization
- Partial rotation leaving stale closures
- Disable not restoring original values

**Pass 2 — Hardening (3 findings)**
- Message channel eliminated entirely (adopted one-way immutable bootstrap instead of patching auth)
- Wrapper stacking eliminated (ORIG const object saves original function references once)
- Cross-origin iframe limitation documented as inherent to content-script model

**Pass 3 — Attack surface expansion (7 findings)**
- Worker scope completely unspoofed (also caught independently by lux)
- postMessage broadcasting seed to page (also caught by lux)
- localStorage extension detection via `__pg_off__` flag
- CSS/display surface inconsistency: devicePixelRatio, visualViewport, matchMedia all leaking real dimensions
- Seed reconstruction via deterministic PRNG
- UA-CH architecture wrong for Apple Silicon (should report ARM, not x86)
- Poison beacon signature classifiable (fixed domains, fixed screen size, fixed SDK version)

**Pass 4 — Noise model (7 findings, including 1 CRITICAL)**
- **CRITICAL: Unstable repeated-probe noise.** The PRNG advanced on every `toDataURL()` call, so calling it 20 times produced 20 different results. Real fingerprinting services probe repeatedly and expect stability. **Fix:** Replaced advancing PRNG with deterministic per-input hash noise — `hash(seed + pixelIndex + pixelValue)` produces identical output on every call.
- matchMedia regex rewriting too fragile (removed entirely, full evaluator deferred to v1.1)
- WebRTC relay-only detectable (removed — browser default is better)
- Poisoner chaos-only mode insufficient for credibility

**Pass 5 — Test methodology**
- Recommended regression test harness with N=20 repeated-probe stability tests
- Established v1.0 positioning: "reduces common fingerprint stability and blocks known trackers"

**Pass 6 — Test infrastructure (3 MAJOR findings)**
- `runAll()` async race condition: test suites ran concurrently with transient green states before all results were in. **Fix:** Sequential async/await.
- Rotation test missing: no automated way to verify fingerprints actually changed after rotation. **Fix:** Two-step localStorage baseline/comparison test.
- **Audio `getChannelData` compound mutation.** `getChannelData()` returns a *live reference* to the underlying `Float32Array`. The wrapper mutated it in-place on every call, so reading the same buffer twice applied noise twice. **Fix:** WeakMap tracks which buffer+channel combos have been noised; noise applied exactly once.

**Pass 7 — Test refinement (2 MAJOR + 3 minor)**
- Rotation false failure: test asserted every surface changed, but rotation only guarantees *at least one* high-entropy surface changes. **Fix:** Bundle assertion (any surface changed = pass).
- Manual vs automated test labeling
- Worker test label correction
- Audio first-read mutation acknowledged as detection surface

#### v1.1 Review Passes

**Items 1-2 (Poisoner + Workers) — 3 passes**
- Pass 1: 1 blocker + 4 majors + 1 minor (SharedWorker `workerOverrides` out of scope → ReferenceError)
- Pass 2: 2 majors (chaos batch contract mismatch: code said 5-15, spec said 1-15; Worker test failures treated as WARN instead of fail)
- Pass 3: Sign-off, no remaining findings

**Items 3-5 (Sensor + Ultrasonic + matchMedia) — 2 passes**
- **matchMedia range syntax missing:** The evaluator handled legacy `(min-width: 1024px)` but not MQ Level 4 range forms like `(width >= 1024px)`. Real fingerprinting services use range queries for binary search probing. **Fix:** Full range parser (single, reversed, double range).
- **matchMedia listener leak:** The fake `MediaQueryList` delegated `addEventListener` to the real MQL, which meant real resize/orientation events leaked through `event.matches`, revealing actual dimensions. **Fix:** All listener methods are no-ops.
- **WebAudio `connect()` overload:** The wrapper didn't preserve `output`/`input` index parameters. Sites using multi-channel routing would break. **Fix:** Explicit `(destination, output, input)` parameter passthrough.
- Sensor API test coverage gap acknowledged (synthetic constructor vs delivered event)

### 4.2 lux (Gemini) — Independent Validation, 2 Critical Findings

lux's strength was **adversarial pattern recognition** — thinking like a fingerprinting service rather than a code reviewer.

**v1.0 Review**
- Worker scope unspoofed (same root cause as rowan, caught independently)
- postMessage seed broadcast (same finding as rowan, independent discovery)

The overlap validated that both models identified the highest-priority issues.

**v1.1 Items 1-2 Review**
- Reviewed poisoner payload plausibility and cluster design
- Approved v1.1 poisoner redesign

**v1.1 Items 3-5 Review (2 Critical + 1 approved)**

- **CRITICAL: CSS unit parsing incomplete.** `parseLen()` only handled `px`, `em`, `rem`. A fingerprinting service could probe with `vw`, `vh`, `vmin`, `vmax`, `cm`, `mm`, `in`, `pt`, `pc` units to leak real viewport dimensions through the matchMedia evaluator. **Fix:** All CSS length units now resolve against spoofed values.

  This is a detection vector that wouldn't appear in normal testing — it requires thinking like an adversary who deliberately uses obscure CSS units to bypass the evaluator.

- **CRITICAL: AnalyserNode interception gap.** The ultrasonic filter only intercepted connections to `AudioDestinationNode` (speakers). But the USAT tracker pattern routes `MediaElementSource` → `AnalyserNode` to read frequency data *without* playing audio. The near-ultrasonic frequencies were readable upstream of the filter. **Fix:** `connect()` now intercepts both `AudioDestinationNode` and `AnalyserNode`.

  This finding required knowledge of a specific real-world attack pattern (the USAT framework's AnalyserNode technique from the research paper). It's the kind of issue that only surfaces when the reviewer knows what actual trackers do in the wild.

- Sensor API: approved (no additional findings)

**Combined finding (lux + rowan):**
- **Fail-closed behavior for hardware features.** If `parseLen` returned `null` for an unrecognized unit on a hardware-identifying feature (width, height, resolution, etc.), the query fell through to real `matchMedia`, leaking the real value. Both reviewers identified the gap from different angles. **Fix:** `HARDWARE_FEATURES` set — unrecognized units on hardware features return `{matches: false}` instead of falling through.

**Item 6 (E2E Suite + Regex Fix) — 1 pass, 3 MAJOR + 1 MINOR**

- **WebKit-prefixed DPR queries falling through to real matchMedia.** The feature-name regex `[a-z][a-z0-9-]*` doesn't match the leading `-` in `-webkit-device-pixel-ratio`, so Chrome-specific DPR probes like `(-webkit-device-pixel-ratio: 2)` and `(-webkit-min-device-pixel-ratio: 2)` silently delegated to the real browser. This is a common Chromium fingerprinting vector. **Fix:** Pre-normalize WebKit DPR aliases to `resolution` before regex matching; add to HARDWARE_FEATURES fail-closed path; `parseRes()` accepts bare numbers (WebKit DPR syntax uses unitless values).
- **Module Worker test dishonesty.** The test treated timeout, error, and construction failure all as `{match: true}`, so it always passed regardless of whether Module Worker parity was actually verified. **Fix:** Probe Blob URL module worker support first; `test.skip()` if unsupported; failures in the actual parity check are real failures.
- **Clean checkout not reproducible.** `npm test` from the NAS artifact fails with `MODULE_NOT_FOUND` because `@playwright/test` isn't installed and there was no lockfile or setup documentation. **Fix:** Added `package-lock.json`, `npm run setup` script, and prerequisites in ROADMAP.
- **Case study factual claims.** Review-pass count and Module Worker parity claim needed updating. **Fix:** Incremented pass count, qualified claims.

### 4.3 E2E Testing Catches a Sixth Bug

The Playwright test suite caught one additional bug that neither reviewer found during manual code review:

- **Regex alternation ordering in matchMedia evaluator.** The range syntax parser used the regex pattern `(<|<=|>|>=|=)`. JavaScript regex alternation tries alternatives left-to-right and takes the first match. For the input `>=`, the engine tries `<` (no), `<=` (no), `>` (yes!) — and never reaches `>=`. This meant every `>=` and `<=` query silently failed: `(width >= 1440px)` would parse as operator `>` with value `= 1440px`, which fails `parseLen()`, which triggers fail-closed behavior, returning `false` instead of `true`.

  The regex was written correctly in intent but incorrectly in alternation order. **Fix:** Reorder to `(<=|>=|<|>|=)` (longest-first).

  This bug survived two review passes from two different models and a manual regression test suite. The automated E2E test caught it because it systematically tested every code path with real browser evaluation, not just reading the code.

---

## 5. Finding Categories by Model

| Category | rowan (Claude) | lux (Gemini) | E2E (Playwright) |
|----------|---------------|--------------|-------------------|
| State management bugs | 5 (seed desync, partial rotation, wrapper stacking, async race, audio mutation) | 0 | 0 |
| Architectural decisions | 6 (message channel→immutable bootstrap, noise model→deterministic hash, WebRTC default, positioning, test methodology) | 0 | 0 |
| Missing API surfaces | 4 (worker scope, DPR/viewport/matchMedia, UA-CH ARM, listener leak) | 1 (worker scope, same finding) | 0 |
| Adversarial detection vectors | 3 (seed broadcast, localStorage detection, poison signature) | 3 (CSS unit probing, AnalyserNode bypass, seed broadcast) | 0 |
| Correctness edge cases | 4 (connect() overload, batch contract, rotation assertion, range syntax) | 0 | 1 (regex alternation) |
| Fail-closed security | 0 | 1 (combined with rowan) | 0 |
| Dead code / bloat / cleanup | 11 (RTCPeerConnection, webRequest, bridge listeners, dead vars, unused params, test exports, stale comments, duplicated logic) | 4 (webRequest, RTCPeerConnection, appVersion, canvas loop — all overlapping with rowan) | 0 |
| **Total unique findings** | **~39** | **~4 unique + 6 overlapping** | **1** |

### Interpretation

**rowan** produced high volume across all categories, with particular strength in state management and architectural reasoning. rowan's pass 4 finding on the noise model was the single most impactful fix — without deterministic per-input noise, the entire fingerprint spoofing system would fail against any service that probes more than once.

**lux** produced fewer findings but with high adversarial specificity. Both critical findings (CSS unit probing, AnalyserNode bypass) required knowledge of real-world attack patterns that are not obvious from reading the code alone. The CSS unit finding is particularly notable: no normal usage would trigger it, but a fingerprinting service specifically crafting `vw`-unit probes would bypass the evaluator entirely.

**The E2E suite** caught a class of bug that code review inherently struggles with: a regex that *reads correctly* but *executes incorrectly* due to engine-level alternation semantics. This validates the investment in automated testing as a complementary layer.

---

## 6. The Multi-Model Advantage

### Independent discovery validates priority

When rowan and lux independently identified the same issues (worker scope, seed broadcast), it confirmed these were the highest-priority problems. Independent convergence is a stronger signal than a single reviewer's assessment.

### Different models see different threat surfaces

rowan reasoned about *code correctness*: "what happens when this function is called twice?" lux reasoned about *adversarial behavior*: "what would FingerprintJS do to detect this?" These are complementary perspectives that a single model is unlikely to cover with equal depth.

### Sequential review with increasing adversarial depth

The review order mattered:
1. rowan first — fixed architectural and correctness issues that would have made adversarial analysis meaningless (e.g., the noise model had to be deterministic before probing-resistance testing was relevant)
2. lux second — with the architecture sound, focused on detection surfaces and attack patterns
3. E2E suite third — with both models' findings addressed, automated testing caught the residual mechanical bug

### The fail-closed principle emerged from collaboration

Neither model independently proposed fail-closed behavior for hardware features with unknown CSS units. rowan identified the range syntax gap; lux identified the unit parsing gap. The combined fix (fail-closed on HARDWARE_FEATURES) emerged from synthesizing both findings. This is a design decision that required two perspectives to crystallize.

---

## 7. Quantitative Summary

| Metric | Value |
|--------|-------|
| Review passes (rowan) | 10 across v1.0 + v1.1 + streamlining |
| Review passes (lux) | 5 across v1.0 + v1.1 + streamlining |
| Total findings (rowan) | ~44 (including 10 MAJOR, 1 CRITICAL, 11 streamlining) |
| Total findings (lux) | ~10 (including 2 Critical, 2 overlapping with rowan, 4 streamlining) |
| Bugs caught by E2E | 1 (regex alternation — survived both reviewers) |
| Spoofing surfaces covered | 18+ APIs across navigator, screen, canvas, audio, WebGL, timezone, sensors, matchMedia |
| Final E2E test count | 75 (67 local + 2 rotation + 6 external smoke) |
| v1.1 features driven by research paper | 3 (sensor API, ultrasonic, poisoner redesign) |
| Streamlining items executed | 9 of 11 (2 filesystem artifacts not present) |
| Lines removed in cleanup | ~77 (dead code, duplicated logic, unused exports) |
| Permissions removed | 1 (`webRequest` — reduces extension attack surface) |
| Decision log entries attributed to reviews | 12 |

---

## 8. Testing Methodology

### 8.1 Three-Tier Test Architecture

The Playwright E2E suite replaces the manual `tests/regression.js` runner with an automated, CI-capable framework organized into three tiers by reliability and purpose:

| Tier | Directory | Tests | Flakiness | CI default | Purpose |
|------|-----------|-------|-----------|------------|---------|
| **Local** | `e2e/local/` | 67 | None | Yes | Verify all spoofed APIs return values from known-good sets, deterministic noise is session-stable |
| **Rotation** | `e2e/rotation/` | 2 | Low | Yes | Automated two-step: collect FP → rotate via popup → collect again → assert change |
| **External** | `e2e/external/` | 6 | High (network) | No | Smoke-test against real fingerprinting sites (BrowserLeaks, CreepJS, FingerprintJS, CoverYourTracks, Cloudflare) |

**Run commands:**
- `npm test` — local + rotation (CI default, deterministic, ~2 min)
- `npm run test:external` — external smoke tests (network-dependent, retries: 2, timeout: 60s)
- `npm run test:all` — all three tiers

### 8.2 Extension Loading in Playwright

Chrome extensions cannot run in headless mode. The test fixture uses `chromium.launchPersistentContext()` — the only Playwright API that supports `--load-extension`. Key discoveries during implementation:

- **`channel: 'chrome'` (system Chrome) does NOT work.** Playwright's CDP connection suppresses extension loading in system Chrome. Must use Playwright's bundled "Chrome for Testing" (default channel).
- **`file://` URLs don't match `<all_urls>` in MV3.** Content scripts with `<all_urls>` only match `http(s)://`. The fixture embeds an HTTP server on a random port to serve the test page.
- **Service worker detection requires polling.** `context.waitForEvent('serviceworker')` fires before Playwright's CDP connection is fully established. A 200ms polling loop with 10s timeout is reliable.

### 8.3 Local Test Suites (13 Spec Files, 67 Tests)

Each spec file targets one spoofing surface with multiple assertion strategies:

**Deterministic stability tests (N=20 repeated probes):**
- Canvas `toDataURL()`, `getImageData()`, `toBlob()` — identical output across N calls
- `measureText()` — identical width across N calls for same text+font
- Audio `getChannelData()` — identical samples across N calls (validates WeakMap guard against compound mutation)

**Known-good-set validation:**
- `navigator.hardwareConcurrency` ∈ {2, 4, 6, 8, 10, 12, 16}
- `navigator.deviceMemory` ∈ {4, 8, 16, 32}
- `screen.width` ∈ {1366, 1440, 1536, 1600, 1680, 1920, 2560, 3440, 3840}
- `screen.colorDepth` ∈ {24, 32}
- Timezone ∈ 8 known IANA zones
- WebGL renderer ∈ known GPU string set from `profiles.js`

**Cross-surface consistency:**
- UA OS token ↔ `navigator.platform` ↔ `userAgentData.platform` (all must agree)
- `screen.width >= 3840` → `devicePixelRatio === 2` (4K implies HiDPI)
- `innerWidth === visualViewport.width` (viewport alignment)
- GPU vendor string correlates with platform (Apple GPU → macOS, ANGLE → Windows/Linux)
- Firefox UA → no `navigator.userAgentData` (Firefox doesn't implement UA-CH)

**matchMedia evaluator (12 tests):**
- Legacy colon syntax: `(min-width: Xpx)`, `(max-width: Xpx)`, `(device-width: Xpx)`
- MQ Level 4 range: `(width >= Xpx)`, `(width > Xpx)`, `(Xpx <= width)`, `(Xpx <= width <= Ypx)`
- Resolution range: `(resolution >= Xdppx)`
- Unit-based probe resistance: `vw` and physical `in` units resolve against spoofed values
- Binary search resistance: probes at boundary value return consistent results
- Listener no-op: `addEventListener('change')` registered without errors, no events leak
- Preference pass-through: `(prefers-color-scheme: dark)` still works (delegates to real matchMedia)

**Sensor API defense (3 tests):**
- `DeviceMotionEvent` → acceleration, rotationRate all null
- `DeviceOrientationEvent` → alpha, beta, gamma all null
- Generic Sensor API (Accelerometer, Gyroscope, etc.) → x, y, z all null

**Ultrasonic attenuation (5 tests):**
- `AudioNode.connect(destination)` doesn't throw (filter inserted transparently)
- `AudioNode.connect(GainNode)` works normally (non-destination passthrough)
- `AudioNode.connect(AnalyserNode)` doesn't throw (lux's finding: intercept this path too)
- 19 kHz oscillator → peak amplitude < 0.05 (attenuated by highshelf filter)
- 1 kHz oscillator → peak amplitude > 0.5 (audible range passes through)

**Worker navigator parity (3 tests):**
- Classic Worker: `userAgent`, `platform`, `hardwareConcurrency`, `deviceMemory`, `language` match window
- Module Worker: same parity (graceful handling of Blob URL module worker limitations)
- SharedWorker: same parity via port-based messaging

### 8.4 Rotation Tests (2 Tests)

Automates the manual two-step from `regression.js`:

**Test 1 — Single rotation:**
1. Open test page, collect full fingerprint bundle (canvas hash, measureText width, UA, platform, cores, memory, languages, screen, colorDepth, timezone, WebGL renderer)
2. Navigate to `chrome-extension://<id>/popup/popup.html`, click `#rotateBtn`, wait for completion
3. Open fresh test page, collect second fingerprint bundle
4. Assert at least one high-entropy surface changed (rowan pass 7: bundle assertion, not per-surface)
5. Verify the new fingerprint is internally stable (canvas hash matches on re-read)

**Test 2 — Diversity across 5 rotations:**
1. Collect fingerprint bundles across 5 consecutive rotations
2. Serialize each bundle to JSON
3. Assert ≥3 distinct profiles out of 5 (validates the PRNG produces meaningful variety, not degenerate repetition)

### 8.5 External Smoke Tests (6 Tests)

Intentionally loose assertions — the goal is "loads without crashing, reports something plausible":

| Site | Assertion |
|------|-----------|
| **BrowserLeaks** (canvas) | Page loads, shows canvas hash string |
| **BrowserLeaks** (WebGL) | Page loads with meaningful content |
| **CreepJS** | Page loads, generates fingerprint output |
| **FingerprintJS** | Page loads, visitor ID generated |
| **Cover Your Tracks** (EFF) | Page loads with non-empty title |
| **Cloudflare** | Page loads without challenge/block page |

All external tests: `retries: 2`, `timeout: 60_000`, `test.slow()`, screenshots saved to `test-results/` for manual inspection.

### 8.6 What Testing Caught That Review Didn't

The regex alternation ordering bug in the matchMedia evaluator (Section 4.3) is a concrete example of automated testing's unique value. The regex `(<|<=|>|>=|=)` reads as "match any comparison operator" — and that's what both human reviewers and LLM reviewers concluded. But JavaScript regex alternation is left-to-right greedy: `>` matches before `>=` is ever tried. The test suite executed `(width >= 1440px)` against the real evaluator in a real browser and got `false` — revealing the bug that static analysis missed.

This validates the three-layer QA approach: architectural review (rowan) → adversarial review (lux) → automated execution (Playwright). Each layer catches a different class of defect.

### 8.7 Review Status

**lux:** Signed off (pass 2, 2026-05-08). No remaining findings. Confirmed WebKit DPR fix, Module Worker test honesty, and clean-checkout reproducibility.

**rowan:** Signed off (pass 2, 2026-05-08). No remaining blocking findings. Pass 1 had 3 MAJOR + 1 MINOR (WebKit DPR leak, Module Worker test dishonesty, clean checkout, case study claims) — all closed. Residual non-blocking notes: media-feature parser is case-sensitive (CSS spec is case-insensitive); Module Worker parity only proven when Blob URL probe passes.

**v1.1 item 6: CLOSED.** Dual sign-off from rowan + lux.

**Streamlining review: CLOSED.** Both reviewers delivered findings, endorsed the execution list, and confirmed closure. 9 of 11 items executed; 2 filesystem artifacts not present in working copy. Post-cleanup verification: 68 passed, 2 skipped, 0 failed.

---

## 9. Post-Completion Streamlining Review

After v1.1 achieved dual sign-off on all 6 items, alex requested a cleanup pass before Phase 2 work began. The same multi-model review process was applied — this time aimed at bloat, orphaned code, and streamlining opportunities accumulated across 9 review passes and 6 feature additions.

### 9.1 Review Process

The streamlining request was dispatched to both rowan and lux simultaneously (not sequentially). Both reviewed the full codebase independently:

- **Scope:** anti-fingerprint.js, background.js, bridge.js, poisoner.js, profiles.js, popup/popup.js, e2e/ test suite
- **Constraint:** No feature changes — cleanup only. Every suggestion must not break the existing E2E suite (68 passed, 2 skipped).
- **Safety rule:** Flag uncertain removals as "verify before removing" rather than recommending deletion.

### 9.2 What Each Model Found

**lux (Gemini) — 4 findings:**

| # | Category | Finding |
|---|----------|---------|
| 1 | Bloat | `webRequest.onBeforeRequest` listener runs 7 regex patterns on every HTTP request just to increment a heuristic counter. declarativeNetRequest handles actual blocking. |
| 2 | Orphaned | Dead `ORIG.RTCPeerConnection` reference — saved in the ORIG const but never used (WebRTC left at browser default since rowan pass 4). |
| 3 | Streamline | Redundant appVersion branch — both Firefox and Chrome if/else branches compute `profile.userAgent.replace("Mozilla/", "")`. |
| 4 | Streamline | Duplicated canvas pixel-noise loop — identical `for` loop in `noisyClone()` and `getImageData()` override. |

**rowan (Claude) — 11 findings (superset of lux's 4):**

| # | Category | Finding |
|---|----------|---------|
| 1 | Bloat | `webRequest.onBeforeRequest` listener (same as lux #1) |
| 2 | Orphaned | Dead `ORIG.RTCPeerConnection` (same as lux #2) |
| 3 | Orphaned | Duplicate `rules/rules/tracking.json` nested directory |
| 4 | Orphaned | Stale nested `popup/popup/` directory copy |
| 5 | Orphaned | Unused bridge.js message listeners (`PHANTOMGRID_RELOAD`, `PHANTOMGRID_REFRESH`) — orphaned from the original message channel design |
| 6 | Orphaned | Stale bridge.js header comment ("Listens for seed broadcast" — no longer true) |
| 7 | Orphaned | Dead `const now = Date.now() / 1000` in `cleanThirdPartyCookies()` — leftover from TTL-based expiry approach |
| 8 | Streamline | Redundant appVersion branch (same as lux #3) |
| 9 | Streamline | Duplicated canvas pixel-noise loop (same as lux #4) |
| 10 | Orphaned | Unused `origFn` parameter in `spoofGetSupportedExtensions()` — factory pattern accepted the original function but never called it |
| 11 | Orphaned | Dead test helper exports: `collectCanvas()` in fingerprint-collector.ts and `KNOWN_LANGUAGES` in profile-constants.ts — defined but never imported |

**lux then reviewed rowan's full list** and confirmed agreement with all 11 items, endorsing execution.

### 9.3 Convergence Analysis

The same pattern from the v1.1 feature review held during streamlining:

| Pattern | Observation |
|---------|-------------|
| **Independent convergence** | Both models identified the same 4 highest-impact items (webRequest bloat, dead RTCPeerConnection, appVersion redundancy, canvas loop duplication). This confirms these were the most obvious cleanup targets. |
| **Coverage expansion** | rowan found 7 additional items that lux missed — mostly orphaned code from earlier design iterations (bridge.js listeners, stale comments, dead variables, unused test exports). |
| **Volume difference** | rowan: 11 findings vs lux: 4. Consistent with the feature review pattern where rowan produces higher volume across more categories. |
| **Architectural memory** | rowan's findings demonstrated recall of *why* code was dead — e.g., connecting the unused RTCPeerConnection to rowan's own pass 4 decision, connecting the bridge.js listeners to the message channel removal. lux identified *that* code was dead without the historical context. |

### 9.4 Changes Executed

9 of 11 items were applied (2 filesystem artifacts didn't exist in the working copy):

**anti-fingerprint.js (4 changes):**
- Removed dead `ORIG.RTCPeerConnection` reference (3 lines)
- Merged redundant appVersion if/else into single `spoof()` call (5 lines saved)
- Extracted `applyCanvasNoise(px, seed)` helper — `noisyClone()` and `getImageData()` both call it (6 lines saved, logic deduplicated)
- Removed unused `origFn` parameter from `spoofGetSupportedExtensions`; single instance shared by WebGL and WebGL2 (4 lines saved)

**background.js (2 changes):**
- Removed dead `const now` variable in `cleanThirdPartyCookies()` (1 line)
- Removed `webRequest.onBeforeRequest` listener (22 lines — 7 compiled regexes no longer run on every request)

**manifest.json (1 change):**
- Removed `webRequest` permission (reduces extension permission surface)

**bridge.js (2 changes):**
- Removed orphaned `PHANTOMGRID_RELOAD` and `PHANTOMGRID_REFRESH` message listeners (8 lines)
- Updated stale header comment to reflect current sessionStorage-read architecture

**e2e/helpers/ (2 changes):**
- Removed dead `collectCanvas` export from fingerprint-collector.ts (28 lines)
- Removed dead `KNOWN_LANGUAGES` export from profile-constants.ts (8 lines)

### 9.5 Tradeoff: trackersBlocked Stat

The removed `webRequest` listener was the only source of `trackersBlocked` increments. The popup still displays this stat (now permanently 0). This was a deliberate tradeoff:

- The old counter was a **heuristic guess** — it matched URL patterns (`/track/`, `/pixel/`, `/beacon/`) but had no connection to actual blocks handled by declarativeNetRequest.
- Showing 0 is **more honest** than showing an inaccurate number.
- A real counter can be built on `declarativeNetRequest.getMatchedRules()` in a future pass if the stat is product-important.
- The `webRequest` permission removal reduces the extension's attack surface and eliminates per-request JavaScript overhead.

### 9.6 Post-Cleanup Verification

```
68 passed, 2 skipped, 0 failed
Skips: Firefox UA (no userAgentData), Module Worker (Blob URL unsupported)
```

No regressions. The E2E suite validated that every cleanup change was behavior-preserving.

---

## 10. Lessons Learned

1. **Multi-model review is not redundant — it's complementary.** Different models have different blind spots. Claude's architectural reasoning caught state management bugs that Gemini missed. Gemini's adversarial thinking caught detection vectors that Claude missed. Neither alone would have produced the same result.

2. **Sequential review with escalating adversarial depth works better than parallel review.** Fixing correctness bugs first (rowan passes 1-4) made the adversarial review (lux) more productive — lux could focus on detection surfaces instead of re-discovering architectural issues.

3. **Research papers directly improve product decisions.** The IDPI "1% bypass zone" finding didn't just add a feature — it changed the poisoner's entire philosophy from "volume" to "credibility." The UXDT finding didn't just add a filter — it revealed a threat category (ultrasonic cross-device tracking) that wasn't on the roadmap.

4. **Automated testing catches what code review cannot.** The regex alternation bug is a mechanical correctness issue that reads correctly to both humans and LLMs but executes incorrectly due to engine-specific behavior. This class of bug requires execution, not analysis.

5. **The "immutable bootstrap" pattern emerged from review, not initial design.** The original architecture used a message channel between content script and service worker. rowan's pass 1 found auth issues; pass 2 eliminated the channel entirely. The final design (one-way seed read, no live updates) is simpler and more secure than the original — but it took two review iterations to arrive there.

6. **Independent convergence is the strongest validation signal.** When rowan and lux independently found the same issues, it confirmed both the severity and the priority. Divergent findings (lux's CSS unit probing, rowan's audio mutation) are equally valuable — they indicate coverage expansion rather than disagreement.

7. **Multi-model review works for cleanup passes, not just feature review.** The streamlining review showed the same convergence/divergence pattern as the feature review: both models found the top 4 items independently, rowan found 7 additional items lux missed. The convergent items (webRequest bloat, dead RTCPeerConnection, appVersion redundancy, canvas loop) were the most impactful. The divergent items (bridge.js orphans, dead variables, unused test exports) represented coverage expansion from rowan's deeper pass.

8. **Architectural memory matters for cleanup.** rowan connected dead code to the specific review pass that made it dead (e.g., "RTCPeerConnection saved but never used since pass 4 decided on browser default"). This historical context made the cleanup safer — knowing *why* code was orphaned provides confidence that removing it won't break anything. lux correctly identified the same code as dead but without the revision history, which is why the "verify before removing" safety constraint existed.

---

## Appendix A: Model Capabilities Observed (Updated Post-Streamlining)

| Capability | rowan (Claude) | lux (Gemini) |
|-----------|---------------|--------------|
| Multi-pass iterative review | Strong — 10 passes with increasing depth | 5 passes, effective |
| State management reasoning | Excellent — caught 5 stateful bugs | Not observed |
| Architectural refactoring suggestions | Excellent — message channel → immutable bootstrap | Not observed |
| Adversarial/red-team thinking | Good — poison signature, seed reconstruction | Excellent — CSS unit probing, AnalyserNode bypass |
| Real-world attack pattern knowledge | Good | Excellent — USAT framework specifics |
| Test methodology | Excellent — designed N=20 stability, rotation two-step | Not observed |
| Cross-surface consistency checking | Good — DPR↔screen, UA↔platform | Good — unit resolution against spoofed values |
| Noise model correctness | Excellent — deterministic hash, WeakMap guard | Not observed |
| Dead code / bloat detection | Excellent — 11 items with historical context for *why* each was dead | Good — 4 core items, identified *that* code was dead without revision history |
| Cleanup ordering / safety | Good — proposed phased execution order with verification gates | Good — endorsed rowan's full list and flagged convergent items |

---

*authored_by: snapdragon (claude-code, Claude Opus 4.6)*
*reviewed_by: rowan (Claude Sonnet), lux (Gemini CLI)*
*dual sign-off: 2026-05-08 (features + streamlining)*
*project: phantomgrid*
*classification: internal case study — mixed-model QA process*
*last updated: 2026-05-08 (added Section 9: streamlining review)*
