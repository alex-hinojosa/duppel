# PhantomGrid V3 Evaluation Plan

**Date:** 2026-05-18
**Status:** Draft — pending dual-gate review
**Context:** Alex's feedback on V2 benchmark results (`24e98d4`) identified framing softness that needs tightening before the benchmark becomes the canonical reference for PhantomGrid effectiveness. V2 is shippable as an artifact; V3 adds statistical rigor, baseline comparison, persona coverage, and gap closure.

---

## Work Items

### 1. BrowserLeaks Canvas Hash Gap Investigation

**Problem:** BrowserLeaks reports the same canvas hash before and after identity rotation. PhantomGrid's `toDataURL()` noise does change the canvas data URI (confirmed by local rotation tests), but BrowserLeaks uses a different extraction method that produces a stable hash. If a public tool can extract a rotation-stable canvas fingerprint, a commercial fingerprinter can too.

**Investigation plan:**
1. Read BrowserLeaks' open-source canvas test page to identify the extraction method (likely visible in client-side JS)
2. Test each canvas extraction path independently:
   - `CanvasRenderingContext2D.getImageData()` — does PhantomGrid's noiser cover this?
   - `WebGLRenderingContext.readPixels()` — WebGL-based canvas extraction
   - `OffscreenCanvas` + `convertToBlob()` / `transferToImageBitmap()`
   - `HTMLCanvasElement.toBlob()` (vs `toDataURL()` which is already noised)
3. Write a targeted Playwright test that extracts canvas data via each method pre/post rotation
4. Identify which path(s) produce stable output
5. Either extend PhantomGrid's canvas noiser to cover the gap, or document specifically why it cannot be closed (e.g., if the path is used by legitimate web apps in ways that would break functionality)

**Deliverable:** Code fix or documented technical explanation. Re-run BrowserLeaks benchmark to verify.

### 2. Distributional Runs (n >= 30)

**Problem:** V2 results are from low single-digit runs (n < 5). "Observed: 0%–38%" for CreepJS trust scores is two data points, not a distribution. Claims like "consistently validated" for FingerprintJS have unknown statistical weight.

**Implementation:**
1. Add a `--repeat` flag or loop wrapper to `npm run test:benchmark`
2. Run each benchmark test n >= 30 times
3. Collect per-run JSON artifacts into a corpus
4. Compute and report: n, median, p25, p75, min, max for each quantitative metric
5. For CreepJS, attempt to isolate the source of variance: seed value, timing, network conditions, browser warm/cold state, persona state

**Metrics to report distributionally:**
| Service | Metric | Current V2 Report | V3 Target |
|---------|--------|-------------------|-----------|
| FingerprintJS | visitorId rotation success rate | "consistently validated" | n/30 pass rate |
| FingerprintJS | cross-tab distinctness rate | "different per tab" | n/30 distinct rate |
| CreepJS | trust score | "0%–38%" | median, p25, p75 over n >= 30 |
| CreepJS | lie count | "0 or null" | median, distribution |
| CreepJS | rotation hash change rate | "inconclusive" | n/30 change rate |
| EFF CYT | bits of identifying info | "~18 bits" | median, p25, p75 over n >= 30 |
| EFF CYT | rotation change rate | "inconclusive" | n/30 change rate |
| BrowserLeaks | canvas hash rotation | "unchanged" | n/30 change rate (expect 0/30 until gap closed) |

**Deliverable:** Aggregated JSON report with distributional statistics. Updated benchmark docs with n and percentiles.

**Blocker risk:** Public services may rate-limit or CAPTCHA-gate after 30+ automated visits in a session. Mitigation: add configurable delay between runs (e.g., 30s cooldown), spread runs across multiple sessions, or accept lower n with disclosure.

### 3. Baseline Comparison (Vanilla Chrome)

**Problem:** V2 reports PhantomGrid metrics in isolation. Without knowing what unmodified Chrome scores on the same tests, "we got X" is hard to interpret. Alex's example: PhantomGrid at 18 bits on CYT is at the low end of the normal 18-22 bit range — good but not dramatic, and impossible to evaluate without the baseline.

**Implementation:**
1. Add a `baseline` project to `playwright.config.ts` that runs the same benchmark specs without the PhantomGrid extension loaded
2. Collect baseline metrics for every service
3. Present results as side-by-side: `| Metric | Vanilla Chrome | PhantomGrid | Delta |`
4. For CYT, report entropy reduction in bits (e.g., "22 bits → 18 bits = 4 bits of entropy removed")
5. For FingerprintJS, report whether vanilla Chrome produces stable visitorIds across tabs and rotations (it should — no noise means deterministic fingerprint)

**Deliverable:** Baseline JSON artifacts + updated benchmark docs with comparison columns.

### 4. Persona Coverage

**Problem:** V2 tested only Apple M2 / macOS / Chrome 147. PhantomGrid supports multiple persona groups (Windows, Linux, various GPUs). Each persona is its own coherence test — a Windows persona that leaks macOS WebGL values would be caught by a fingerprinter.

**Implementation:**
1. Identify all persona groups in PhantomGrid's profile pool (from `profile-constants.ts` and seed logic)
2. For each persona group, run the full benchmark suite with that persona forced
3. Validate internal coherence per persona: UA matches platform matches WebGL matches screen
4. Report per-persona results in the benchmark matrix

**Benchmark matrix target:**

| Persona Group | BrowserLeaks Coherence | FingerprintJS Rotation | CreepJS Trust (median) | CYT Bits (median) | Cloudflare |
|--------------|----------------------|----------------------|----------------------|-------------------|------------|
| Apple M2 / macOS | ✓ (V2) | ✓ (V2) | 0%–38% (V2) | ~18 (V2) | ✓ (V2) |
| Windows / NVIDIA | TBD | TBD | TBD | TBD | TBD |
| Windows / Intel | TBD | TBD | TBD | TBD | TBD |
| Linux / AMD | TBD | TBD | TBD | TBD | TBD |

**Deliverable:** Per-persona benchmark results. Any coherence failures become PhantomGrid code fixes before the benchmark claims pass.

### 5. Scope and Claim Tightening

**Problem:** V2 framing includes overclaims. "Fools the same services ad-tech companies use" conflates research/educational tools with production fingerprinting stacks. "Normal range" for 18 bits understates what 18 bits means to a large tracker.

**Already patched in V2 doc (this commit):**
- Scope statement added at top of both docs
- "Industry-standard" → "publicly-available"
- "Fools ad-tech" → "presents coherent identity to public services that approximate ad-tech techniques"
- Commercial stacks explicitly named as not evaluated
- 18 bits reframed honestly (1 in 260K, reduced uniqueness, not anonymity)
- Sample size (n < 5) and single-persona coverage disclosed
- "What This Benchmark Does Not Measure" section added

**V3 additional work:**
- With baseline and distributional data, replace qualitative claims with quantitative ones
- Per-persona results replace single-persona generalization

### 6. Explicit Non-Measured Areas (Documentation)

These are out of scope for the public benchmark suite. Each needs separate methodology if measured:

- **Behavioral biometrics across tabs** — keystroke/mouse-trajectory linking. Requires a purpose-built collector, not a public fingerprinting service.
- **Chaff/poisoning effectiveness** — measures contamination of tracker profiles, not identity cloaking. Requires either a controlled tracker simulation or instrumented ad-tech endpoint.
- **First-navigation UA mismatch** — V2 Playwright flow waits for seed convergence. A separate test that measures the first-navigation window (before extension content scripts inject) is needed.
- **Commercial fingerprinting stacks** — ThreatMetrix, FingerprintJS Pro, Sift, Forter. Not publicly testable without a paid account or partnership.

---

## Execution Order

1. **V2 doc framing patch** (this commit) — ship now
2. **BrowserLeaks canvas hash investigation** — highest priority V3 item; determines if there's a code fix needed
3. **Baseline comparison** — foundational for all other V3 reporting
4. **Distributional runs** — depends on baseline being available for side-by-side
5. **Persona coverage** — can run in parallel with distributional runs once baseline infra is in place

---

## Acceptance Criteria (per rowan's dispatch)

- [ ] V2 doc patch committed with narrowed claims, scope statement, sample/persona disclosure
- [ ] V3 eval plan committed (this document)
- [ ] Benchmark matrix showing: metrics, public service, persona group, baseline requirement, n requirement, expected output field
- [ ] BrowserLeaks canvas investigation plan with first concrete test
- [ ] Blockers identified (rate limiting for n >= 30 is the primary risk)

---

## Blockers

**Rate limiting for n >= 30 runs:** BrowserLeaks, CreepJS, and EFF CYT may rate-limit or serve CAPTCHAs after repeated automated visits. Mitigation options:
1. Add configurable delay between runs (30-60s cooldown)
2. Spread runs across multiple sessions/days
3. Accept lower n (e.g., n = 10-15) with honest disclosure if rate limiting prevents n = 30
4. For FingerprintJS (GitHub Pages demo), rate limiting is unlikely — can likely achieve n >= 30

**Persona forcing mechanism:** Need to verify PhantomGrid supports forcing a specific persona group for testing purposes (vs random selection from pool). If not, need a test-mode seed override.
