/**
 * PhantomGrid — Behavioral Biometric Precision-Reduction Module
 * Event.timeStamp jitter, performance.now() quantization, MouseEvent coordinate
 * noise, WheelEvent delta quantization, Battery API spoofing.
 */

export function installBiometric(ctx) {
  const { ORIG, profile, bioSeed, spoof, disguise } = ctx;

  // === Behavioral biometric precision-reduction (v2 item 3) ===
  // Reduces precision of timing, coordinate, and scroll surfaces used by
  // behavioral biometric classifiers (ThreatMetrix, Trusteer, FingerprintJS
  // Pro). Does NOT synthesize a different human — raises classification cost
  // by adding deterministic noise. All noise derived from session seed via
  // bioSeed, using truncated Gaussian (hash-based Box-Muller) for non-uniform
  // distribution. Cross-surface coherence: shared bioSeed + per-surface salts.
  //
  // Surfaces: Event.timeStamp, performance.now(), MouseEvent coordinates,
  // WheelEvent deltas. Coordinate/wheel noise skipped for synthetic events
  // (isTrusted=false), editable/canvas/SVG targets, drag events, and
  // allowlisted high-interaction sites. Timestamp jitter applies to trusted
  // events only (synthetic events bypass); performance.now quantization +
  // Gaussian jitter applies everywhere (monotonic-clamped). Both are invisible
  // to the user.

  // Per-surface salts for cross-surface coherence (Gate 4).
  const BIO_SALT_TIMESTAMP = 0x54494D45;
  const BIO_SALT_PERFNOW   = 0x50455246;
  const BIO_SALT_MOUSE_X   = 0x4D585858;
  const BIO_SALT_MOUSE_Y   = 0x4D595959;

  // Truncated Gaussian via hash-based Box-Muller (Gate 2: non-uniform).
  // Pure function of inputs — no advancing state (Gate 5).
  // Clamp (not re-sample) preserves determinism.
  function bioGaussian(seed, salt, inputHash, sigma, bound) {
    let h1 = seed ^ salt ^ inputHash;
    h1 = Math.imul(h1 ^ (h1 >>> 16), 0x45d9f3b);
    h1 = Math.imul(h1 ^ (h1 >>> 16), 0x45d9f3b);
    h1 = (h1 ^ (h1 >>> 16)) >>> 0;
    let h2 = seed ^ Math.imul(salt, 0x9e3779b9) ^ inputHash;
    h2 = Math.imul(h2 ^ (h2 >>> 16), 0x45d9f3b);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 0x45d9f3b);
    h2 = (h2 ^ (h2 >>> 16)) >>> 0;
    const u1 = (h1 + 1) / 4294967297;
    const u2 = (h2 + 1) / 4294967297;
    let z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
    if (z > bound) z = bound;
    if (z < -bound) z = -bound;
    return z;
  }

  // Allowlist: skip coordinate + wheel noise on high-interaction sites.
  const _bioCoordSkip = new Set([
    "docs.google.com", "sheets.google.com", "slides.google.com",
    "figma.com", "www.figma.com",
    "maps.google.com", "www.openstreetmap.org",
    "excalidraw.com", "www.canva.com",
  ]);
  const _skipCoordNoise = _bioCoordSkip.has(location.hostname);

  // --- Event.timeStamp jitter ---
  // ±1ms deterministic jitter. WeakMap cache ensures stable re-reads.
  // No global monotonicity state — bounded ±1ms jitter means events
  // >2ms apart cannot invert. Events <2ms apart are within the browser's
  // own event scheduling jitter and not meaningful for biometric analysis.
  const _origTSDesc = ORIG.getOwnPropertyDescriptor.call(Object, Event.prototype, "timeStamp");
  if (_origTSDesc && _origTSDesc.get) {
    const _tsCache = new WeakMap();

    spoof(Event.prototype, "timeStamp", function() {
      const cached = _tsCache.get(this);
      if (cached !== undefined) return cached;

      const real = _origTSDesc.get.call(this);

      // Synthetic events (isTrusted=false) pass through unjittered —
      // modifying constructor-controlled values is a detection oracle.
      if (!this.isTrusted) {
        _tsCache.set(this, real);
        return real;
      }

      const jitter = bioGaussian(bioSeed, BIO_SALT_TIMESTAMP, (real * 1000) >>> 0, 0.5, 1.0); // ±1ms Gaussian

      const result = real + jitter;
      _tsCache.set(this, result);
      return result;
    });
  }

  // --- performance.now() precision reduction ---
  // Quantize to 0.1ms + Gaussian jitter (±0.1ms max), with monotonic clamp.
  // The jitter is a pure function of the quantized bucket, so adjacent buckets
  // can produce different offsets. Without clamping, a later call could return
  // a smaller value — violating the monotonic non-decreasing invariant that
  // timing consumers and fingerprint detectors expect. The closure-held
  // _perfLast ensures output never decreases.
  const _origPerfNow = Performance.prototype.now;
  let _perfLast = 0;
  Performance.prototype.now = disguise(function() {
    const real = _origPerfNow.call(this);
    const quantized = Math.round(real * 10) / 10;
    const jitter = bioGaussian(bioSeed, BIO_SALT_PERFNOW, (quantized * 10000) >>> 0, 0.03, 0.1);
    const result = quantized + jitter;
    if (result < _perfLast) return _perfLast;
    _perfLast = result;
    return result;
  }, "now");

  // --- Shared helpers for coordinate/wheel noise ---
  function _isEditableOrCanvas(target) {
    if (!target) return false;
    if (target instanceof HTMLInputElement) return true;
    if (target instanceof HTMLTextAreaElement) return true;
    if (target instanceof HTMLCanvasElement) return true;
    if (target instanceof SVGElement) return true;
    try { if (target.isContentEditable) return true; } catch(e) {}
    return false;
  }

  const _hasDragEvent = typeof DragEvent !== "undefined";

  // Skip noise for synthetic events, editable/canvas targets, and drags.
  function _shouldSkipNoise(event) {
    if (!event.isTrusted) return true;
    if (_hasDragEvent && event instanceof DragEvent) return true;
    if (_isEditableOrCanvas(event.target)) return true;
    return false;
  }

  // --- MouseEvent coordinate noise + WheelEvent delta quantization ---
  if (!_skipCoordNoise) {
    // Save original coordinate getters
    const _origCoordGetters = {};
    for (const p of ["clientX", "clientY", "screenX", "screenY", "pageX", "pageY"]) {
      const d = ORIG.getOwnPropertyDescriptor.call(Object, MouseEvent.prototype, p);
      if (d && d.get) _origCoordGetters[p] = d.get;
    }

    // Per-event axis noise cache. One x-noise and one y-noise per event,
    // derived from clientX/clientY position. All x-axis properties
    // (clientX, pageX, screenX, x) share the same noise; same for y-axis.
    // This preserves cross-property invariants (pageX - clientX = scrollX).
    const _mouseCache = new WeakMap();

    function _getEventNoise(event) {
      let cached = _mouseCache.get(event);
      if (cached) return cached;

      if (_shouldSkipNoise(event)) {
        cached = { nx: 0, ny: 0 };
        _mouseCache.set(event, cached);
        return cached;
      }

      const rx = _origCoordGetters.clientX ? _origCoordGetters.clientX.call(event) : 0;
      const ry = _origCoordGetters.clientY ? _origCoordGetters.clientY.call(event) : 0;

      // Gaussian coordinate noise: sigma=0.4, bound=1.0, then round.
      // ~62% zero, ~19% +1, ~19% -1. Still ±1px max.
      const gx = bioGaussian(bioSeed, BIO_SALT_MOUSE_X, rx | 0, 0.4, 1.0);
      const gy = bioGaussian(bioSeed, BIO_SALT_MOUSE_Y, ry | 0, 0.4, 1.0);
      cached = { nx: Math.round(gx), ny: Math.round(gy) };
      _mouseCache.set(event, cached);
      return cached;
    }

    // Override x-axis properties (all share same noise)
    for (const prop of ["clientX", "pageX", "screenX"]) {
      if (!_origCoordGetters[prop]) continue;
      const origGet = _origCoordGetters[prop];
      spoof(MouseEvent.prototype, prop, function() { return origGet.call(this) + _getEventNoise(this).nx; });
    }

    // Override y-axis properties (all share same noise)
    for (const prop of ["clientY", "pageY", "screenY"]) {
      if (!_origCoordGetters[prop]) continue;
      const origGet = _origCoordGetters[prop];
      spoof(MouseEvent.prototype, prop, function() { return origGet.call(this) + _getEventNoise(this).ny; });
    }

    // x/y are aliases for clientX/clientY — redirect to noised getters
    for (const [alias, canonical] of [["x", "clientX"], ["y", "clientY"]]) {
      const d = ORIG.getOwnPropertyDescriptor.call(Object, MouseEvent.prototype, alias);
      if (d && d.get) {
        spoof(MouseEvent.prototype, alias, function() { return this[canonical]; });
      }
    }

    // WheelEvent delta quantization — round to nearest integer.
    // Removes sub-pixel trackpad precision. Preserves sign and zero.
    // Skipped for synthetic events, editable/canvas/SVG targets, drags.
    for (const deltaProp of ["deltaY", "deltaX"]) {
      const d = ORIG.getOwnPropertyDescriptor.call(Object, WheelEvent.prototype, deltaProp);
      if (d && d.get) {
        const origDeltaGet = d.get;
        spoof(WheelEvent.prototype, deltaProp, function() {
          const real = origDeltaGet.call(this);
          if (real === 0) return 0;
          if (_shouldSkipNoise(this)) return real;
          return Math.sign(real) * Math.max(1, Math.round(Math.abs(real)));
        });
      }
    }
  }

  // === Battery Status API spoofing (v3 item 5c) ===
  // navigator.getBattery() returns charging state, level, charging/discharging
  // time. Deprecated but still available in Chrome. High-entropy surface.
  // Spoofed to lowest-entropy state: fully charged on AC power.
  //
  // Native shape preserved: BatteryManager inherits from EventTarget.
  // Properties (charging, level, chargingTime, dischargingTime) are getters
  // on BatteryManager.prototype. Event methods (addEventListener etc.)
  // inherited from EventTarget.prototype. We spoof the getters on the
  // prototype via spoof() — same pattern as navigator properties. GOPD
  // normalization, toString hardening, getter.name all automatic via spoof().
  // getBattery() is NOT overridden; it returns the real BatteryManager
  // instance whose prototype getters now return fixed values.
  // No fake objects, no own properties, native prototype chain preserved.
  if (typeof BatteryManager !== 'undefined') {
    spoof(BatteryManager.prototype, 'charging', function() { return true; });
    spoof(BatteryManager.prototype, 'chargingTime', function() { return 0; });
    spoof(BatteryManager.prototype, 'dischargingTime', function() { return Infinity; });
    spoof(BatteryManager.prototype, 'level', function() { return 1.0; });
  }
}
