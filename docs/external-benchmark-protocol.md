# External Benchmark Protocol

How to evaluate PhantomGrid against commercial fingerprinting services. This protocol documents what to test, what to look for, and what qualitative outcomes to expect. It provides a concrete demo path for technical audiences.

## Prerequisites

1. Chrome with PhantomGrid loaded (unpacked extension from repo)
2. A second Chrome profile or browser (control, no extension) for comparison
3. Screenshots or screen recordings for evidence capture

## Test Targets

### 1. BrowserLeaks (browserleaks.com)

**What it tests:** Individual API surfaces in isolation.

**Protocol:**
1. Open `browserleaks.com/canvas` in both control and PhantomGrid profiles
2. Compare canvas fingerprint hashes -- they should differ
3. Open `browserleaks.com/webgl` -- check that:
   - Vendor/Renderer show the spoofed profile (not real hardware)
   - WebGL parameters show normalized values
   - Extension list shows the 20-extension baseline
4. Open `browserleaks.com/javascript` -- check:
   - User-Agent matches the spoofed profile
   - Platform, hardwareConcurrency, deviceMemory are from the spoofed pools
   - Screen resolution matches the spoofed profile
5. Click "Rotate Identity" in PhantomGrid, reload each page
6. Verify the composite fingerprint changed (at least one high-entropy surface like canvas hash, WebGL renderer, or UA string should differ; not every individual field is required to change since pool collisions are possible)

**Expected outcomes:**
- Canvas hash: different from control, changes on rotation
- WebGL renderer: spoofed value, not real GPU
- Navigator properties: all spoofed, internally consistent
- Screen: from the profile pool, not real resolution

### 2. FingerprintJS (fingerprint.com/demo)

**What it tests:** Combined multi-surface fingerprinting (the commercial standard).

**Protocol:**
1. Open `fingerprint.com/demo` in PhantomGrid profile
2. Note the `visitorId` displayed
3. Open the same page in a new tab -- visitorId should be the same (session stability)
4. Click "Rotate Identity," reload -- visitorId should change
5. Open in control profile -- visitorId should differ from PhantomGrid
6. Check the "Browser Fingerprint" detail breakdown for any flagged anomalies

**Expected outcomes:**
- visitorId is stable within a session (no flicker detection)
- visitorId changes on rotation
- visitorId differs from control browser
- The detail breakdown may flag some surfaces as "overridden" -- this is expected; the goal is changing the composite ID, not hiding the extension's presence from FingerprintJS Pro's bot detection

### 3. CreepJS (abrahamjuliot.github.io/creepjs)

**What it tests:** Aggressive lie detection and inconsistency probing.

**Protocol:**
1. Open CreepJS in PhantomGrid profile
2. Check the "Lies" section -- CreepJS actively probes for spoofing
3. Check the "Trust Score" -- lower scores indicate detected spoofing
4. Note which surfaces are flagged as "lied" vs "trusted"
5. Compare with control profile

**Expected outcomes:**
- CreepJS will likely detect that some surfaces are overridden (it probes toString, descriptors, and prototype chains)
- The trust score will be lower than the control
- PhantomGrid's toString/descriptor hardening (v2 item 6) should reduce the number of flagged lies compared to naive spoofing approaches
- Canvas and audio hashes should differ from control
- The composite fingerprint should be different and should change on rotation

**What to look for specifically:**
- "Function toString" lies: should be minimal due to WeakMap-based toString hardening
- "Descriptor" lies: should be minimal due to GOPD/GOPDs/Reflect interception
- WebGL lies: check if profile-bucketed caps and native-shape getShaderPrecisionFormat reduce detection flags

### 4. Cover Your Tracks (coveryourtracks.eff.org)

**What it tests:** EFF's privacy tool; checks uniqueness and blocking.

**Protocol:**
1. Open Cover Your Tracks in PhantomGrid profile
2. Click "Test Your Browser"
3. Review the results table showing which surfaces are unique vs protected
4. Note the "bits of identifying information" count
5. Repeat after rotation

**Expected outcomes:**
- Canvas fingerprint: should show as modified/randomized
- WebGL: should show spoofed vendor/renderer
- The total "bits of identifying information" may still be high (the fingerprint is unique, just different from real) -- PhantomGrid creates unique fake identities rather than blending into a crowd
- The key metric is that the fingerprint CHANGES on rotation, not that it matches other users

## Evidence Capture Protocol

For Deloitte-facing evidence:

1. **Before/after screenshots:** Control profile result next to PhantomGrid result for each test target
2. **Rotation evidence:** Same test target, pre-rotation and post-rotation, showing different fingerprint hashes
3. **Session stability:** Same test target opened in two tabs, showing identical fingerprint (no flicker)
4. **HTTP/JS consistency:** BrowserLeaks showing HTTP User-Agent matches JS navigator.userAgent

## Interpreting Results

PhantomGrid's threat model is **fingerprint rotation** (each session presents a different fake identity) rather than **fingerprint blending** (making all users look identical). This means:

- **Uniqueness scores will still be high.** Each fake identity is unique -- just not YOUR identity.
- **The value is in rotation.** A tracker that sees you today and tomorrow sees two different people.
- **Detection is a spectrum.** Sophisticated services (CreepJS, FingerprintJS Pro bot detection) may detect that spoofing is occurring. The defense goal is changing the composite identifier, not hiding the extension's existence from adversarial detection.
- **Claims should be precise.** "Reduces common fingerprint stability and closes known detection vectors" is accurate. "Defeats all browser fingerprinting" is not.

## Known Limitations Relevant to Benchmarks

- First navigation to a new origin may show a brief HTTP/JS UA mismatch (resolved on subsequent loads)
- Firefox UA profiles on Chrome will show TLS/rendering inconsistencies detectable by sophisticated probes
- Module Worker Blob URL navigator spoofing is not yet covered (skip in worker parity tests)
- Extension list breadth may differ from some hosts' native support
