# Duppel v0.1.1 — Phase B Measurement Report

**Author:** snapdragon
**Date:** 2026-05-24
**Harness:** `e2e/phase-b/coherence-harness.spec.ts`
**Raw data:** `test-results/phase-b-measurements.jsonl` (4 measurements)
**Test page:** `e2e/fixtures/harness-page.html`
**Host machine:** Windows 11 ARM64, Chrome/Playwright Chrome 147

---

## Summary

Phase B measured UA coherence across the bootstrap lifecycle under two modes: native (no extension) and success-driven (v0.1.0 extension loaded). Two modes (narrowed-persona, native-compatible) require Phase C implementation and are deferred.

### Headline Findings

1. **Native baseline: PASS.** All 4 signals (HTTP, earliest JS, post-bootstrap JS, fetch) are identical and native.

2. **JS bootstrap does not re-run on same-tab navigations.** On first navigation in a new tab, the extension seeds the tab but bootstrap injection does not visibly spoof `navigator.userAgent`. On subsequent navigations, DNR applies HTTP UA spoofing, but the MAIN-world JS bootstrap does not re-execute — `navigator.userAgent` stays native. This creates a persistent HTTP-JS split-brain.

3. **Cross-family personas confirmed.** The harness observed a `chromium-linux` persona (Linux x86_64 UA) assigned to a `chromium-windows` host. This is the exact failure mode the persona-family constraint (Spec Section 2) is designed to eliminate.

4. **First-navigation residual is total.** On first navigation, the extension is loaded and a DNR rule exists, but neither HTTP nor JS is spoofed. The main-frame request goes out native. This is the expected behavior for success-driven DNR (proof not yet earned), but it means the first page load on any new tab is fully native.

---

## Measurements

### Mode: Native (baseline)

| Signal | Value | Family |
|--------|-------|--------|
| HTTP UA | Chrome/147 Windows | chromium-windows |
| Earliest JS UA | Chrome/147 Windows | chromium-windows |
| Post-bootstrap JS UA | Chrome/147 Windows | chromium-windows |
| Fetch UA | Chrome/147 Windows | chromium-windows |
| DNR active | false | — |

**Verdict: PASS.** All signals identical and native. Baseline confirmed.

### Mode: Success-driven, first navigation

| Signal | Value | Family |
|--------|-------|--------|
| HTTP UA | Chrome/147 Windows (native) | chromium-windows |
| Earliest JS UA | Chrome/147 Windows (native) | chromium-windows |
| Post-bootstrap JS UA | Chrome/147 Windows (native) | chromium-windows |
| Fetch UA | Chrome/147 Windows (native) | chromium-windows |
| DNR active | true (1 rule) | — |
| Bootstrap proof | false | — |
| Bootstrap gap | 1.00ms | — |

**Verdict: MEASURED.** DNR rule exists but was not applied to the main-frame request (success-driven: proof not yet earned for this tab/document). JS bootstrap did not spoof. First navigation is entirely native. This is the documented first-navigation residual — correct for the success-driven contract.

### Mode: Success-driven, second navigation (same tab)

| Signal | Value | Family |
|--------|-------|--------|
| HTTP UA | Chrome/147 Linux x86_64 | **chromium-linux** |
| Earliest JS UA | Chrome/147 Windows (native) | chromium-windows |
| Post-bootstrap JS UA | Chrome/147 Windows (native) | chromium-windows |
| Fetch UA | Chrome/147 Windows (native) | chromium-windows |
| DNR active | true (1 rule) | — |
| Bootstrap proof | false (JS not spoofed) | — |
| Bootstrap gap | 0.40ms | — |

**Verdict: MEASURED — two critical findings.**

**Finding 1 — SPLIT-BRAIN:** HTTP UA is spoofed to Linux by DNR, but all JS signals remain native Windows. This means the server sees a Linux Chrome UA in the request header, but any JS-based fingerprinting sees Windows Chrome. A tracker correlating HTTP headers with JS navigator would detect the contradiction.

**Finding 2 — CROSS-FAMILY:** The assigned persona is `chromium-linux` on a `chromium-windows` host. Even if the split-brain is resolved, the persona itself contradicts the TLS/transport-layer identity of the machine. This confirms the need for the persona-family filter (Spec Section 2.3).

### Mode: Success-driven, third navigation (steady state)

| Signal | Value | Family |
|--------|-------|--------|
| HTTP UA | Edge/147 Windows | chromium-windows |
| Earliest JS UA | Chrome/147 Windows (native) | chromium-windows |
| Post-bootstrap JS UA | Chrome/147 Windows (native) | chromium-windows |
| Fetch UA | Chrome/147 Windows (native) | chromium-windows |
| DNR active | true (1 rule) | — |
| Bootstrap proof | false (JS not spoofed) | — |
| Bootstrap gap | 1.80ms | — |

**Verdict: MEASURED.** HTTP UA spoofed to Edge (within Windows family — would pass narrowed-persona gate). JS still native. The split-brain persists: HTTP says Edge, JS says Chrome. Fetch UA is native (DNR only applies to main-frame navigation requests, not subresource fetches from content scripts).

---

## Assessment Against Spec Section 5.6 Pass/Fail Gates

### Native mode
**PASS.** All criteria met.

### Success-driven mode
**Two issues identified, both expected for current v0.1.0:**

1. **Split-brain (HTTP spoofed, JS native):** The MAIN-world bootstrap is not re-running on navigations within an already-seeded tab. DNR applies the HTTP UA spoof, but `navigator.userAgent` in the page remains native. This is a coherence failure — the spec says "if JS UA cannot be forced, HTTP UA should not be spoofed for that document either."

2. **Cross-family persona:** A Linux persona was assigned to a Windows host. Per Spec Section 2.1, this is a MUST-level violation that the Phase C persona-family filter must eliminate.

These are not harness bugs — they are real behavioral observations that Phase C must fix.

### Narrowed-persona mode
**DEFERRED.** Requires Phase C persona-family filter. The harness is ready to measure this mode once the filter is implemented.

### Native-compatible mode
**DEFERRED.** Requires Phase C native-compatible mode. The harness is ready to measure this mode once the toggle is implemented.

---

## Phase C Implications

1. **Investigate JS bootstrap re-execution.** The MAIN-world bootstrap injects the seed and spoofing code via `executeScript`, but this does not re-run on subsequent navigations in the same tab. The `tabs.onUpdated` handler should be triggering re-injection — investigate whether the handler fires, whether `executeScript` succeeds, and whether the MAIN-world override persists across navigations. This is the root cause of the split-brain.

2. **Implement persona-family filter.** The cross-family observation confirms the spec requirement. Filter UA_GROUPS by host engine + OS family before seed-based selection.

3. **DNR scope for subresource requests.** Fetch UA is native even when DNR is active. DNR rules may need `resourceTypes` configuration to cover subresource requests, or this may be an intentional limitation (subresource UA matching is less critical than main-frame).

---

## Artifacts

| Artifact | Path |
|----------|------|
| Measurement harness spec | `e2e/phase-b/coherence-harness.spec.ts` |
| Harness test page | `e2e/fixtures/harness-page.html` |
| Raw JSONL measurements | `test-results/phase-b-measurements.jsonl` |
| This report | `PHASE-B-REPORT.md` |
| Playwright config (phase-b project) | `playwright.config.ts` |

Run: `npm run test:phase-b`
