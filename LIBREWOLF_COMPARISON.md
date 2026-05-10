# PhantomGrid vs LibreWolf: A Technical Comparison

**Two fundamentally different approaches to the same problem — and what each one does that the other can't.**

---

## The Core Architectural Difference

LibreWolf is a **browser fork** of Firefox. It modifies the browser engine at three layers: compile-time flags, preference settings, and C++ source patches. When LibreWolf randomizes canvas output, it does so inside `CanvasRenderingContext2D.cpp` — before the pixel data ever reaches JavaScript. When it blocks WebGL, it adds an IPC permission system between the renderer process and the browser process, with a doorhanger prompt UI and persistent per-site permissions stored in Firefox's permission manager.

PhantomGrid is a **Chrome extension** running in a constrained sandbox. It operates entirely at the JavaScript API layer — intercepting `canvas.toDataURL()`, `navigator.userAgent`, `AudioBuffer.getChannelData()`, and dozens of other surfaces at the prototype level before page scripts execute. It cannot modify Chrome's source code, compiled binaries, network stack, or process architecture.

This distinction matters because it defines what each approach **can't do**:

| Capability | LibreWolf | PhantomGrid | Why |
|------------|-----------|-------------|-----|
| Modify C++ rendering pipeline | Yes | No | Extension sandbox |
| Per-site WebGL permission prompt | Yes (IPC + doorhanger) | No | Chrome has no extension API for this |
| First-party cookie isolation (dFPI) | Yes (engine-level) | No | Requires storage partitioning in the network stack |
| Network-level referrer trimming | Yes (preference) | Partial (DNR rules) | Chrome DNR can modify headers but with limitations |
| Compile-time telemetry removal | Yes (binary doesn't exist) | N/A | Chrome is a different browser |
| Run on Chrome (2.65B users) | No | Yes | LibreWolf is Firefox-only |
| Per-tab identity spoofing | No | Yes | LW applies one uniform fingerprint |
| Deterministic persona rotation | No | Yes | LW aims for uniformity, not diversity |
| Chaff Beacons (tracker chaff) | No | Yes | Not LW's threat model |
| Ultrasonic beacon defense | No | Yes | Not in LW's scope |

The fundamental trade-off: **LibreWolf goes deeper but reaches fewer users. PhantomGrid goes wider but can't reach as deep.**

---

## Feature-by-Feature Comparison

### Canvas Fingerprinting

**LibreWolf:** C++ patch in `nsRFPService.cpp` applies noise to canvas pixel data at the rendering engine level. The critical detail: their patch **removes the uniform-canvas optimization** — Firefox normally skips randomization when all pixel groups are identical (e.g., a solid-color canvas). LibreWolf patches this out because a fingerprinting script can detect the optimization boundary: draw a solid canvas → call `toDataURL()` → if the output is exact, RFP isn't applied → detected. By always applying noise, LibreWolf closes this detection vector.

**PhantomGrid:** JavaScript-level interception of `toDataURL`, `toBlob`, and `getImageData`. Deterministic per-pixel noise using `hash(canvasSeed + pixelIndex + pixelValue)`. Noise is ±1 per RGB channel. An offscreen clone prevents visible corruption.

**Gap identified:** PhantomGrid should check for the uniform-canvas detection vector. If a canvas is entirely one color and we apply noise, we're fine. But we should verify that our noise function doesn't produce a detectable pattern on uniform inputs (e.g., all noise values mapping to the same delta because the pixelValue term is constant). Worth a test case.

**Feasibility of adopting LW's approach:** Not applicable — we can't patch C++. But the detection vector insight is actionable.

### WebGL

**LibreWolf:** Disables WebGL entirely by default. When enabled, a full C++ permission system (IPC messages between content process and browser process, doorhanger prompt, persistent per-site permissions) gates access. The patch is 29KB of C++/JS/XUL — one of the most complex patches in the codebase.

**PhantomGrid:** WebGL is left enabled but vendor/renderer strings are spoofed via `getParameter()` interception. Extensions list is normalized to a common baseline.

**Gap identified:** PhantomGrid doesn't cover `readPixels`, `getBufferSubData`, or WebGL2-specific surfaces. A fingerprinting service can still extract hardware-specific rendering differences through WebGL draw operations — the geometry is rendered by real GPU hardware regardless of what the renderer string says.

**Feasibility:** Can't replicate the permission system. Can add `readPixels` noise (similar to canvas noise approach). WebGL2 surface coverage is a Phase 2 item already on the roadmap.

### Resist Fingerprinting (RFP)

**LibreWolf:** Enables Firefox's `privacy.resistFingerprinting` — a Tor Browser Uplift feature that:
- Rounds window dimensions to multiples of 200x100
- Spoofs timezone to UTC
- Limits font enumeration to a base set
- Rounds `performance.now()` to 100ms precision (was 20ms in Firefox, tightened)
- Reports `en-US` as the only language regardless of actual locale
- Spoofs screen resolution to match window size
- Disables `MediaDevices.enumerateDevices()`
- Standardizes pointer/hover capabilities

This is **engine-level** — it happens before any JavaScript executes and covers surfaces that JavaScript can't reach (like font enumeration through CSS font-face loading, which doesn't trigger any hookable JS API).

**PhantomGrid:** Covers navigator properties, screen dimensions, timezone (DST-aware), languages, matchMedia. Does NOT cover:
- Window dimension rounding (we spoof screen but Chrome controls actual window chrome)
- Font enumeration limiting (no JS-hookable surface for CSS font probing)
- `performance.now()` rounding
- `MediaDevices.enumerateDevices()` spoofing

**Feasibility of partial adoption:**
- `performance.now()` rounding → **Yes.** Wrap `Performance.prototype.now` to quantize to e.g. 100ms. Low risk, high value. **Roadmap candidate.**
- Font enumeration → **Partial.** Can intercept `document.fonts.check()` and `FontFace` constructor, but CSS-only font probing (load a web font, measure an element's computed width) happens below the JS layer. **Limited feasibility.**
- `enumerateDevices()` → **Yes.** Return empty array or a single "default" device. **Roadmap candidate.**
- Window dimension rounding → **No.** Can't control Chrome's actual window size from an extension.

### Cookie and Storage Isolation

**LibreWolf:** Enables dFPI (Dynamic First-Party Isolation), also called Total Cookie Protection. Every third-party domain gets a separate cookie jar keyed to the first-party site. This happens at the network stack level — no JavaScript is involved.

**PhantomGrid:** Cleans known tracker cookies every 15 minutes via `chrome.cookies.getAll()` + domain matching.

**Gap:** PhantomGrid can't partition storage. dFPI is a browser-engine feature. Chrome has its own Privacy Sandbox / CHIPS implementation, but that's not controllable by extensions.

**Feasibility:** Not feasible at the extension layer. Chrome's storage partitioning is handled internally.

### Tracking URL Parameters

**LibreWolf:** Strips tracking parameters from URLs both natively (Firefox's built-in `privacy.query_stripping.enabled`) and through uBlock Origin filters. Known parameters stripped: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`, `mc_eid`, `msclkid`, `yclid`, `twclid`, plus many more.

**PhantomGrid:** Does not strip URL tracking parameters.

**Gap identified:** This is fully feasible in a Chrome extension.

**Feasibility:** **Yes — strong roadmap candidate.** Chrome's `declarativeNetRequest` API supports `redirect` actions that can strip query parameters. Alternatively, a content script can clean `document.location` and `History.pushState` to remove parameters after navigation. The DNR approach is cleaner (strips before the request reaches the server). A hardcoded list of known tracking parameters (there are ~40 well-documented ones) handles the vast majority.

### HTTP Referrer Trimming

**LibreWolf:** Sets `network.http.referer.XOriginTrimmingPolicy = 2` — cross-origin referrers include only the scheme+host+port (no path). Same-origin referrers are untouched. This prevents the destination site from knowing which specific page you came from on a different site.

**PhantomGrid:** Does not modify referrer headers.

**Gap identified:** Feasible and valuable.

**Feasibility:** **Yes — roadmap candidate.** Chrome's `declarativeNetRequest` can modify the `Referer` header on cross-origin requests to trim the path. Also `document.referrer` should be patched in the MAIN world script to match.

### Global Privacy Control (GPC)

**LibreWolf:** Sets the `Sec-GPC: 1` HTTP header and `navigator.globalPrivacyControl = true`. GPC is a proposed standard (backed by California's CCPA) that signals opt-out from data sale/sharing. Some jurisdictions legally require honoring it.

**PhantomGrid:** Does not send GPC signals.

**Gap identified:** Trivial to implement.

**Feasibility:** **Yes — low-effort roadmap candidate.** DNR adds the header; MAIN world script sets `navigator.globalPrivacyControl`. Two lines of code for legal-grade opt-out signaling.

### Link Prefetching / Speculative Connections

**LibreWolf:** Disables `network.prefetch-next`, `network.dns.disablePrefetch`, `network.http.speculative-parallel-limit`, `network.predictor.enabled`, and others. Prevents Firefox from making network requests for links the user hasn't clicked.

**PhantomGrid:** Does not address prefetching.

**Feasibility:** **Not feasible.** Chrome extensions can't control these browser-level network behaviors. Chrome's prefetching is handled internally.

### DNS / WebRTC Leak Prevention

**LibreWolf:** Forces DNS through the proxy when one is configured. Limits ICE candidates to a single interface (`media.peerconnection.ice.default_address_only = true`), preventing WebRTC from leaking local network IPs.

**PhantomGrid:** Does not address WebRTC or DNS leaks.

**Gap identified:** WebRTC IP leak is a known privacy issue.

**Feasibility:** **Partial.** Chrome has `chrome.privacy.network.webRTCIPHandlingPolicy` that extensions can set to `disable_non_proxied_udp` or `default_public_interface_only`. **This is a roadmap candidate.** DNS control is not feasible from an extension.

### Telemetry Removal

**LibreWolf:** Removes telemetry at three levels:
1. Compile-time: `MOZ_TELEMETRY_REPORTING=0`, `MOZ_DATA_REPORTING=0`, `MOZ_NORMANDY=0`
2. Binary removal: pingsender executable physically deleted from the build
3. Preference: All telemetry prefs set to false

**PhantomGrid:** N/A — we don't control Chrome's telemetry.

**Feasibility:** Not applicable. Chrome telemetry is controlled by Google. Different threat model.

### HTTPS-Only Mode

**LibreWolf:** Enables HTTPS-Only Mode by default.

**PhantomGrid:** Does not enforce HTTPS.

**Feasibility:** **Partial.** Chrome has a built-in HTTPS-First mode. An extension could use DNR to upgrade HTTP requests, but Chrome's built-in implementation is more reliable.

### Audio Fingerprinting

**LibreWolf:** Firefox's RFP applies noise to audio rendering at the engine level — within the `AudioBuffer` implementation in C++.

**PhantomGrid:** JavaScript-level interception of `AudioBuffer.prototype.getChannelData` with deterministic micro-noise and WeakMap deduplication.

**Assessment:** Both approaches achieve the same outcome. PhantomGrid's implementation is robust — the WeakMap prevents noise compounding on repeated reads of the same buffer.

### Ultrasonic Cross-Device Tracking

**LibreWolf:** Not addressed. UXDT defense is not in LibreWolf's scope.

**PhantomGrid:** BiquadFilter highshelf at 17,999 Hz / -70 dB inserted before `AudioDestinationNode` and `AnalyserNode`. Silences near-ultrasonic beacons while leaving audible audio untouched.

**Assessment:** This is a PhantomGrid exclusive. LibreWolf's threat model focuses on fingerprinting and tracking within the browser; UXDT is a cross-device attack vector that requires active audio graph manipulation.

### Sensor API Defense

**LibreWolf:** RFP zeroes out sensor data where applicable.

**PhantomGrid:** All sensor constructors return `null` readings. Constructors preserved (not deleted) to avoid detection via API presence testing.

**Assessment:** Comparable coverage.

### Chaff Beacons (Tracker Chaff)

**LibreWolf:** Not addressed. LibreWolf's philosophy is defensive (block/reduce surfaces), not offensive.

**PhantomGrid:** Chaff Beacons — fake tracking beacons fired at ad-tech endpoints with coherent persona-based interest clusters. Like military chaff that lures missiles away from the real aircraft, Tracker Chaff makes ad-tech chase phantom behavioral profiles instead of the real user.

**Assessment:** PhantomGrid exclusive. Different threat model: LibreWolf prevents data collection; PhantomGrid also degrades the quality of data that gets through.

---

## Roadmap Recommendations

Based on the comparison, here are additions to PhantomGrid's roadmap, prioritized by feasibility and privacy impact:

### High Priority (feasible, high impact)

| Feature | Effort | Implementation Path |
|---------|--------|-------------------|
| **Query string stripping** | Medium | DNR redirect rules for ~40 known tracking params (`utm_*`, `fbclid`, `gclid`, etc.) |
| **GPC header + navigator flag** | Low | DNR adds `Sec-GPC: 1`; MAIN world sets `navigator.globalPrivacyControl = true` |
| **Cross-origin referrer trimming** | Medium | DNR modifies `Referer` header to origin-only on cross-origin; MAIN world patches `document.referrer` |
| **WebRTC IP leak prevention** | Low | `chrome.privacy.network.webRTCIPHandlingPolicy = "default_public_interface_only"` |
| **`performance.now()` rounding** | Low | Wrap `Performance.prototype.now` to quantize to 100ms buckets |
| **`enumerateDevices()` spoofing** | Low | Return single "default" audio/video device or empty array |

### Medium Priority (feasible, moderate impact)

| Feature | Effort | Implementation Path |
|---------|--------|-------------------|
| **Uniform-canvas detection hardening** | Low | Test + verify noise function on solid-color canvases |
| **WebGL `readPixels` noise** | Medium | Same pattern as canvas noise, applied to `readPixels` output |
| **OffscreenCanvas coverage** | Medium | Intercept `OffscreenCanvas` constructor, apply same noise pipeline |
| **`document.fonts` enumeration** | Medium | Intercept `FontFaceSet.prototype.check()` to return fixed results |

### Low Priority (limited feasibility or niche impact)

| Feature | Notes |
|---------|-------|
| **dFPI / cookie partitioning** | Not feasible — engine-level. Chrome's Privacy Sandbox handles this differently. |
| **Font enumeration via CSS probing** | Not feasible — CSS layout happens below the JS layer. |
| **Window dimension rounding** | Not feasible — can't control Chrome's window chrome geometry. |
| **Link prefetching control** | Not feasible — no extension API surface. |
| **DNS leak prevention** | Not feasible — no extension API for DNS configuration. |

---

## Summary

LibreWolf and PhantomGrid are complementary, not competing. LibreWolf operates at a depth that no extension can reach — C++ source patches, compile-time flag removal, engine-level isolation primitives. But it requires users to switch browsers entirely, leaving Chrome's 2.65 billion users unprotected.

PhantomGrid operates within Chrome's extension sandbox, which limits depth but maximizes reach. It also brings capabilities that LibreWolf's defensive philosophy doesn't include: per-tab identity rotation, Chaff Beacons (tracker chaff), and ultrasonic cross-device tracking defense.

The most actionable takeaway from this comparison is the set of **low-hanging fruit** that LibreWolf implements via preferences/headers and that PhantomGrid can implement via DNR and MAIN world hooks: query string stripping, GPC, referrer trimming, WebRTC leak prevention, `performance.now()` rounding, and `enumerateDevices()` spoofing. These six additions would close the most visible gaps in the comparison without requiring engine-level access.

The deeper gaps — dFPI, font enumeration, window rounding, compile-time telemetry removal — are architecturally impossible in a Chrome extension. They represent the inherent trade-off of the extension model: we trade depth for reach.

---

*Analysis by snapdragon, 2026-05-08. LibreWolf source analyzed from NAS at /Volumes/Mesh/Lab/Librewolf/source/ (Codeberg mirror). PhantomGrid source at C:\snapdragon\phantomgrid\.*
