# Duppel v0.1.1 — Release Specification

**Status:** Phase A r1 — pending dual-gate review (rowan engineering, lux methodology)
**Author:** snapdragon
**Date:** 2026-05-24
**Revision:** r1 (addresses rowan's 7 blocking items from conditional strategy pass)
**Supersedes:** v0.1.0 implicit spec (README.md mission statement)
**Artifact paths:** repo `SPEC-v0.1.1.md`, NAS `/Volumes/Mesh/Duppel/SPEC-v0.1.1.md`
**Provenance:** Mesh consensus from compiled feedback thread (alex, snapdragon, rowan, lux) on TLS decomposition and mission clarification, 2026-05-24.

### r1 Change Log

| # | Blocker | Resolution |
|---|---------|------------|
| 1 | Empty-pool fallback contradicts MUST rule | Fallback changed to fail-closed (native identity). Engine-only fallback moved to lab-only mode only. |
| 2 | Native-compatible DNR timing under-specified | Defined as next-navigation-only until harness proves otherwise. `dnrActiveAtMainFrame` is hard acceptance gate. |
| 3 | `__pg_s` cookie channel missing | New Section 4 added: no cookie transport, explicit removal, legacy cleanup plan. |
| 4 | eTLD+1 handling needs concrete rule | Public suffix list approach specified, naive splitting prohibited. |
| 5 | Permission and detection model must be explicit | Permissions table added. Passive detection marked optional. Manual toggle is release-critical path. |
| 6 | Native-compatible scope must cover frames | Frame behavior specified: all frames in native-compatible tab suppress spoofing/chaff. MV3 limits documented. |
| 7 | Phase B needs pass/fail gates | Explicit per-mode acceptance criteria added with fail conditions. |

---

## 1. Mission Statement

Duppel is an MV3 tracking-pollution and fingerprint-resilience tool. It is not an active bot-detection bypass product.

**Primary mission: POLLUTION.** Duppel makes tracking data less useful, less stable, and less confidently linkable across sessions — without breaking normal browsing. The chaff engine is the product center. Cloaking exists to protect chaff from being filtered out as synthetic.

**Explicit non-goals for v0.1.1:**
- Defeating active bot-detection systems (Cloudflare Turnstile, Akamai Bot Manager, etc.)
- Cross-family identity impersonation (claiming macOS over Windows TLS, or Firefox over Chrome engine)
- Transport-layer fingerprint modification (TLS/JA3/JA4 — outside MV3 substrate control)

**Rationale:** MV3 extensions operate at layers 5-7 (JS, DOM, HTTP headers). Active bot-detection systems read layer 4 (TLS) and correlate across layers. An extension cannot own the full stack. Grading Duppel by whether it defeats Cloudflare is the wrong scorecard. The correct scorecard is whether tracking signals become less stable and less linkable without breaking the user path.

---

## 2. Persona-Family Constraints

### 2.1 Constraint Rule

Personas MUST stay within the host browser's engine family AND broad operating system family. Do not claim an identity family that the lower layers cannot plausibly support.

| Host Browser     | Allowed Persona Engines | Allowed Persona OS Families |
|------------------|-------------------------|-----------------------------|
| Chrome (Windows) | Chromium (Chrome, Edge) | Windows                     |
| Chrome (macOS)   | Chromium (Chrome, Edge) | macOS                       |
| Chrome (Linux)   | Chromium (Chrome)       | Linux                       |
| Firefox (Windows)| Firefox                 | Windows                     |
| Firefox (macOS)  | Firefox                 | macOS                       |

### 2.2 Rationale

Cross-family personas (e.g., macOS UA over Windows TLS, Firefox UA in Chrome engine) are structurally detectable. TLS fingerprints (JA3/JA4) do not literally name the exact hardware, but when joined with HTTP headers, Client Hints, JS APIs, WebGL, fonts, timing, and IP/session reputation, they create a strong family-coherence signal. Broad contradictions are cheap to detect. Trackers can filter cross-family chaff as obviously synthetic, which undermines the pollution mission.

### 2.3 Implementation Shape

**profiles.js / anti-fingerprint core.js:**

The existing `UA_GROUPS_FILTERED` mechanism already filters by host engine (chromium vs firefox). The additional constraint is OS-family filtering:

1. Detect host OS family at extension startup (service worker `navigator.userAgentData.platform` or `navigator.platform` fallback).
2. Filter `UA_GROUPS` to only groups matching BOTH the host engine AND host OS family.
3. **Fail-closed on empty pool:** If the filtered pool is empty, do NOT fall back to engine-only filtering. Instead, use native identity (no spoofing) for that session and log a warning to the extension console. The extension continues to function (chaff, tracking param stripping, etc.) but does not spoof navigator/UA surfaces. This preserves the MUST constraint: no cross-family personas escape to default behavior.

**Pools affected:**

Current pool (6 groups, unrestricted):
- Chrome Windows, Chrome macOS, Firefox Windows, Firefox macOS, Edge Windows, Chrome Linux

Example filtered pool for Chrome on Windows (2 groups):
- Chrome Windows, Edge Windows

**Retained variation axes within family:** GPU vendor/model, screen resolution, hardware concurrency, device memory, color depth, languages, timezone, canvas seed, audio seed. These provide meaningful entropy for pollution without creating family-level contradictions.

### 2.4 Lab-Only / Broader Personas

Cross-family personas and engine-only fallback MAY be retained behind a `lab-only` flag (not exposed in the popup UI). In lab-only mode, engine-only filtering is permitted for research and benchmark comparison. Lab-only mode is never default behavior and must be explicitly enabled via `chrome.storage.local` or a developer-facing setting.

---

## 3. Native Compatibility Mode

### 3.1 Purpose

Active challenge and authentication flows (Cloudflare Turnstile, CAPTCHAs, bank MFA, SSO login) operate outside Duppel's mission layer. Duppel should degrade to native/pass-through behavior on these flows rather than escalating spoofing to fight the wrong layer. This is correct behavior, not an allowlist failure.

### 3.2 User-Facing Design

**Manual toggle (release-critical path):** User can mark an eTLD+1 as native-compatible via the popup UI. This is per-site, persisted in `chrome.storage.local`. The manual toggle is the primary and release-critical mechanism. It must work independently of any passive detection.

**Passive challenge detection (optional helper signal):** Duppel MAY detect Turnstile/challenge asset loads as a signal to suggest native compatibility. This is optional and not required for the v0.1.1 release. If implemented, detection triggers next-navigation stabilization only — if the challenge already loaded, the identity story may already be contaminated. See Section 3.7 for permission implications.

### 3.3 eTLD+1 Derivation

eTLD+1 MUST be derived using a public suffix list (PSL) approach. Naive last-two-label splitting (e.g., splitting on the second-to-last dot) is prohibited — it fails for `co.uk`, `com.au`, `github.io`, and similar multi-part public suffixes.

Implementation options (in preference order):
1. `URL` API + bundled PSL subset covering common multi-part suffixes (no external dependency).
2. `psl` npm package or equivalent at build time, embedded as a lookup table.
3. If no PSL is available, fall back to the full registrable domain from `chrome.cookies` API's `domain` field (requires `cookies` permission — see Section 3.7).

The chosen approach and its known limitations MUST be documented in Phase C implementation notes.

### 3.4 Behavior When Active

For a tab/site in native-compatible mode:

1. **DNR:** Clear tab proof, remove tab-scoped DNR UA rules. HTTP headers pass through native.
2. **MAIN-world spoofing:** Suppress bootstrap injection. `navigator.userAgent`, `navigator.platform`, and all spoofed surfaces return native values.
3. **Chaff:** Suppress on-page chaff (poisoner beacons, interaction-coupled chaff) for this tab. Do not add noise to a login, bank challenge, or payment flow.
4. **Other tabs:** Unaffected. Chaff continues in background channels and non-compatible tabs.
5. **Restoration:** When the user removes native-compatible status for a site, normal spoofing resumes on next navigation.

### 3.5 Frame Scope

Native-compatible mode applies to ALL frames within the affected tab, not just the top frame:

- **Same-origin frames:** No MAIN-world bootstrap injection, no chaff, no poisoner beacons.
- **Cross-origin frames:** No MAIN-world bootstrap injection, no chaff, no poisoner beacons. This includes challenge widgets (e.g., Turnstile iframes from `challenges.cloudflare.com`).
- **MV3 limitation:** `chrome.scripting.executeScript` with `allFrames: true` or specific `frameIds` controls frame-level injection. If a frame's origin cannot be determined before injection (e.g., `about:blank` frames), suppress injection for that frame in native-compatible tabs. Document any frames where suppression cannot be guaranteed.

Anti-bot iframe probes must see the same native surface as the top frame. A native-compatible top frame with spoofed subframes is a detectable contradiction.

### 3.6 DNR Timing and Next-Navigation Semantics

**Native-compatible mode is next-navigation-only** until the Phase B measurement harness proves that DNR rule removal is reliably complete before the main-frame HTTP request for same-navigation transitions.

Rationale: MV3 `declarativeNetRequest.updateSessionRules` / `updateDynamicRules` is asynchronous. If native-compatible state is set for a site and the user is already on that site, existing tab-scoped DNR UA rules from the previous identity may still be active for in-flight or subsequent requests. Clearing DNR and relying on same-navigation effect is not guaranteed.

**Required behavior:**
1. When a site is marked native-compatible, clear the tab's DNR UA rules immediately (best effort).
2. The guaranteed clean state is on next navigation or reload — the `onBeforeNavigate` handler checks native-compatible state and ensures no DNR rules are applied and no bootstrap is injected for the new document.
3. The Phase B harness field `dnrActiveAtMainFrame` is a **hard acceptance gate**: if DNR is still active on a main-frame request to a native-compatible site, that is a FAIL, and the implementation must either fix the timing or document the mode as reload-required.

### 3.7 Permissions

| Capability | Permission Required | v0.1.1 Status |
|------------|-------------------|---------------|
| Manual native-compatible toggle | None beyond existing (`storage`, `activeTab`) | Release-critical |
| eTLD+1 derivation (PSL approach) | None (bundled data) | Release-critical |
| eTLD+1 derivation (cookies API fallback) | `cookies` | Avoid if possible |
| Passive Turnstile detection via request URLs | `webRequest` (observe only) | Optional — do not add if manual toggle is sufficient |
| Passive detection via navigation events | `webNavigation` (already in v0.1.0) | Optional — already permitted |

**Rule:** Do not add new permissions for optional features. If passive challenge detection requires `webRequest` and it is not already in the manifest, defer detection to a future release and ship with manual toggle only.

---

## 4. Cookie Channel Removal (`__pg_s`)

### 4.1 Requirement

v0.1.1 MUST NOT use cookies for seed, proof, or profile-state transport. The `__pg_s` cookie channel (if present in v0.1.0 or earlier code) is removed entirely.

### 4.2 Rationale

Cookies set by the extension ride the first HTTP request header before content scripts run. A server (or intermediary) can observe `__pg_s` in the `Cookie` header, leaking extension presence and session identity. This is a tracking vector that contradicts the pollution mission. The `executeScript({ func, args })` closure-local delivery (introduced in Round 10) replaces cookies as the seed transport.

### 4.3 Removal Scope

1. **No cookie writes:** Remove all `chrome.cookies.set` and `document.cookie` writes for `__pg_s` or any extension-created tracking cookies.
2. **No cookie reads:** Remove all `chrome.cookies.get` and `document.cookie` reads for `__pg_s`.
3. **No cookie permission dependency:** If `cookies` permission was used solely for `__pg_s`, remove it from `manifest.json`. If `cookies` is needed for other purposes (e.g., eTLD+1 derivation fallback), document the retained use explicitly.

### 4.4 Legacy Cookie Cleanup

Existing users who installed v0.1.0 or earlier may have `__pg_s` cookies already set in their browser. These cookies will continue to ride request headers until they expire or are removed.

**Migration plan:**
1. On extension update to v0.1.1, run a one-time cleanup in the service worker `onInstalled` handler (`reason === "update"`).
2. Use `chrome.cookies.getAll({ name: "__pg_s" })` to find all existing `__pg_s` cookies across all domains.
3. Remove each with `chrome.cookies.remove()`.
4. Log the count of removed cookies to the extension console.
5. If `cookies` permission is being removed in v0.1.1, this cleanup MUST run before the permission is dropped. If the permission is removed in the same version, the cleanup runs during the `onInstalled` handler which executes before the new manifest's reduced permissions take effect — verify this assumption in Phase C testing.

### 4.5 Evidence Required for Phase C Review

- `grep` proof that `__pg_s`, `chrome.cookies.set`, and cookie writes are absent from the codebase (or scoped to migration-only).
- Manifest diff showing `cookies` permission status (removed or retained with documented justification).
- Test confirming no `__pg_s` cookie appears in request headers after v0.1.1 update.

---

## 5. Measurement Harness Acceptance Fields

### 5.1 Purpose

Before any v0.1.1 code changes beyond the spec, we need empirical data on where the identity transition appears across the bootstrap lifecycle. The measurement harness replaces architectural reasoning with engineering proof.

### 5.2 Harness Components

**Local test server** (Node.js or Python, runs on localhost):
- Logs main-frame HTTP `User-Agent` header on every request.
- Serves a test page with three measurement points.

**Test page measurement points:**

| Phase | What | How |
|-------|------|-----|
| Earliest JS UA | `navigator.userAgent` read by synchronous inline `<script>` in `<head>`, before any extension bootstrap | Inline script, logged with `performance.now()` timestamp |
| Post-bootstrap JS UA | `navigator.userAgent` read after extension's MAIN-world bootstrap has run | Deferred script or `setTimeout(0)`, logged with timestamp |
| Fetch/XHR request UA | `User-Agent` header on a `fetch()` or `XMLHttpRequest` to the local server | Server logs the header; client logs the send timestamp |

**Extension-side logging:**
- Whether DNR was active at the time of the main-frame request.
- Whether bootstrap proof was earned for the tab (and when).
- Current identity mode (session / per-tab).
- Whether native-compatible mode was active for the tab.

### 5.3 Test Modes

Each measurement must be captured under four configurations:

| Mode | DNR | Bootstrap | Persona Pool |
|------|-----|-----------|--------------|
| Native | OFF | OFF | N/A (real browser identity) |
| Success-driven (current v0.1.0) | Proof-gated | ON | Full pool |
| Narrowed-persona success-driven | Proof-gated | ON | Family-constrained pool |
| Native-compatible | OFF | OFF | N/A (native identity for that site) |

### 5.4 Acceptance Fields (per run)

```
{
  "mode": "success-driven" | "narrowed-persona" | "native" | "native-compatible",
  "timestamp": "<ISO-8601>",
  "httpUA": "<User-Agent from server log>",
  "earliestJsUA": "<navigator.userAgent from inline head script>",
  "earliestJsTimestamp": "<performance.now() ms>",
  "postBootstrapJsUA": "<navigator.userAgent after bootstrap>",
  "postBootstrapTimestamp": "<performance.now() ms>",
  "fetchRequestUA": "<User-Agent from fetch/XHR server log>",
  "dnrActiveAtMainFrame": true | false,
  "bootstrapProofEarned": true | false,
  "bootstrapProofTimestamp": "<ms since navigationStart>",
  "identityMode": "session" | "per-tab",
  "nativeCompatibleActive": true | false,
  "personaFamily": "<engine>-<os>" | null,
  "personaUA": "<spoofed UA string>" | null
}
```

### 5.5 What the Data Must Answer

1. **First-navigation residual:** Is there a window between `navigationStart` and `bootstrapProofEarned` where `httpUA` or `earliestJsUA` expose the native identity?
2. **Success-driven gap:** How large is the gap (in ms) between earliest JS read and bootstrap completion?
3. **DNR timing:** Does DNR activate before or after the main-frame HTTP request?
4. **Narrowed-persona coherence:** With family-constrained personas, do `httpUA` and `postBootstrapJsUA` stay within the same family?
5. **Native-compatible clean pass:** In native-compatible mode, are all four signals (HTTP, earliest JS, post-bootstrap JS, fetch) identical and native?

### 5.6 Pass/Fail Acceptance Criteria

Each mode has explicit pass/fail gates. A mode PASSES only if all its criteria are met.

**Native mode (baseline):**
- PASS: `httpUA`, `earliestJsUA`, `postBootstrapJsUA`, and `fetchRequestUA` are all identical and match the real browser's native UA string.
- FAIL: Any signal differs from native.

**Success-driven mode (current v0.1.0):**
- PASS: `postBootstrapJsUA` matches `personaUA`. `fetchRequestUA` matches `personaUA`. `dnrActiveAtMainFrame` is `true` when `bootstrapProofEarned` is `true`.
- KNOWN RESIDUAL: `earliestJsUA` may be native (first-navigation residual). If present, document the gap duration (`postBootstrapTimestamp - earliestJsTimestamp`) and classify as known risk.
- FAIL: `postBootstrapJsUA` does not match `personaUA`. OR `dnrActiveAtMainFrame` is `true` when `bootstrapProofEarned` is `false` (spoofing without proof). OR `httpUA` is spoofed but `postBootstrapJsUA` is native (split-brain).

**Narrowed-persona success-driven mode:**
- PASS: All success-driven criteria above, PLUS: `personaFamily` matches the host browser's engine + OS family. `httpUA` and `postBootstrapJsUA` are within the same engine/OS family.
- FAIL: Any success-driven failure, OR `personaFamily` does not match host family (cross-family persona escaped filtering).

**Native-compatible mode:**
- PASS: `httpUA`, `earliestJsUA`, `postBootstrapJsUA`, and `fetchRequestUA` are all identical and native. `dnrActiveAtMainFrame` is `false`. `bootstrapProofEarned` is `false`. `nativeCompatibleActive` is `true`.
- FAIL: Any signal is spoofed. OR `dnrActiveAtMainFrame` is `true` (stale DNR rule active on native-compatible site — this is a **hard fail** per Section 3.6).

**DNR timing gate (applies to all spoofing modes):**
- `dnrActiveAtMainFrame` must be reported from actual observation (server-side header inspection), not inferred from extension state. If the harness cannot determine DNR status at main-frame time, that field is `null` and the run is INCONCLUSIVE for DNR timing.

### 5.7 Real-Site Smoke Tests

Manual, low-volume only. Not automated, not n=30. Purpose: validate the Cloudflare-cluster hypothesis.

| Site | v0.1.0 Behavior | Expected v0.1.1 Behavior |
|------|-----------------|--------------------------|
| LinkedIn | Pass | Pass (no change) |
| Meta/Facebook | Pass | Pass (no change) |
| BestBuy | Pass (normal phone MFA) | Pass (no change) |
| ChatGPT | Loop (Cloudflare) | Pass (native-compatible) |
| B&H Photo | Loop (Cloudflare) | Pass (native-compatible) |

---

## 6. Benchmark Updates (V3 Requirements)

Per Alex's benchmark critique and rowan's Phase D requirements, the v0.1.1 benchmark suite must include:

1. **Vanilla Chrome baseline** — side-by-side column for every metric.
2. **Sample sizes** — each test run n>=30 with distribution stats (median, p25, p75), not single examples or ranges.
3. **All supported persona families** — or explicitly state which family was tested.
4. **BrowserLeaks canvas hash investigation** — identify the extraction path Duppel doesn't intercept; close it or document why.
5. **CreepJS variance explanation** — identify variables causing 0%-38% trust score range.
6. **Scope statement** — explicit at top of report: "This measures public fingerprinting surfaces and browsing compatibility. Commercial anti-fraud stacks (ThreatMetrix, Sift, FingerprintJS Pro) are not publicly testable and are out of scope."
7. **Metric separation** — distinguish cloaking metrics (can we hide the real identity?) from pollution metrics (can we make tracking data less useful?).

---

## 7. What v0.1.1 Does NOT Include

- LibreWolf/browser fork work (separate research track, feasibility memo only)
- Optimistic DNR revert (success-driven stays)
- Cross-family persona generation as default
- Automated real-site testing at scale (ToS/friction risk)
- Commercial fingerprinting stack validation (not publicly testable)

---

## 8. Phase Plan

| Phase | Deliverable | Owner | Gate |
|-------|-------------|-------|------|
| A | This spec document | snapdragon | rowan + lux dual-gate |
| B | Measurement harness + data | snapdragon | rowan (measurement validity) + lux (methodology) |
| C | Implementation (persona filter, native-compat mode, cookie removal, challenge detection) | snapdragon | rowan (engineering) + lux (methodology) |
| D | Benchmark report with baselines + scope statement | snapdragon | rowan + lux dual-gate |

---

## Appendix: Decision Record

| Decision | Source | Status |
|----------|--------|--------|
| Mission = pollution, not bot bypass | alex + all agents consensus | Locked |
| Keep success-driven DNR | rowan + lux + snapdragon | Locked |
| Narrow persona pool to host family | rowan + lux + snapdragon | Locked |
| Empty-pool fallback = fail-closed (native identity) | rowan (blocker 1, r1) | Locked |
| Native compatibility mode for challenges | rowan (proposed), lux (endorsed) | Locked |
| Native-compatible = next-navigation-only until harness proves otherwise | rowan (blocker 2, r1) | Locked |
| No cookie transport for seed/proof/profile | rowan (blocker 3, r1) | Locked |
| eTLD+1 via PSL, no naive splitting | rowan (blocker 4, r1) | Locked |
| Manual toggle release-critical, passive detection optional | rowan (blocker 5, r1) | Locked |
| Native-compatible covers all frames in tab | rowan (blocker 6, r1) | Locked |
| Phase B has explicit pass/fail gates per mode | rowan (blocker 7, r1) | Locked |
| Measurement before code changes | rowan (proposed), lux (endorsed) | Locked |
| Browser fork = separate track | all agents consensus | Locked |
| Cloudflare not a Duppel success criterion | rowan + lux + snapdragon | Locked |
