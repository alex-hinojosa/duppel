/**
 * PhantomGrid — Canvas Fingerprint Noise Module
 * Canvas 2D noise, measureText with font probe defense.
 */

export function installCanvas(ctx) {
  const { ORIG, profile, disguise } = ctx;

  // === Canvas fingerprint noise ===
  // Rowan pass 4 finding #5: noise MUST be deterministic for the same input.
  // An advancing PRNG means repeated identical toDataURL() calls produce
  // different output — a strong tampering signal. Instead, derive noise
  // from hash(canvasSeed + pixelIndex + pixelValue). Same canvas content
  // always produces the same noised output within the same session.
  //
  // Offscreen clone prevents visible canvas corruption (lux review).
  // Always wraps from ORIG references, never from current prototype (rowan pass 2).

  // Fast deterministic hash: derive a ±0-3 noise value from seed + position + pixel value.
  // Uses a simple xorshift-like mixing function instead of a PRNG.
  function pixelNoise(seed, i, val) {
    let h = seed ^ (i * 2654435761);
    h = (h ^ (val * 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = (h ^ (h >>> 16)) >>> 0;
    // ±0-3 noise with weighted distribution: creates larger equivalence
    // classes than ±1 while remaining visually imperceptible. Uses 3 bits
    // of hash for magnitude (0-3) and 1 bit for sign.
    const magnitude = (h >>> 1) & 3;
    return (h & 1) ? magnitude : -magnitude;
  }

  // Apply deterministic ±0-3 noise to an ImageData's RGB channels in-place.
  function applyCanvasNoise(px, seed) {
    for (let i = 0; i < px.length; i += 4) {
      px[i]   = Math.max(0, Math.min(255, px[i]   + pixelNoise(seed, i, px[i])));
      px[i+1] = Math.max(0, Math.min(255, px[i+1] + pixelNoise(seed, i+1, px[i+1])));
      px[i+2] = Math.max(0, Math.min(255, px[i+2] + pixelNoise(seed, i+2, px[i+2])));
    }
  }

  function noisyClone(src) {
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    const cctx = c.getContext("2d");
    cctx.drawImage(src, 0, 0);
    // Use ORIG.getImageData to get raw pixel data WITHOUT noise.
    // The patched getImageData (below) already applies applyCanvasNoise,
    // so calling the patched version here would apply noise once, then
    // applyCanvasNoise below would apply it AGAIN — double noise on
    // toDataURL/toBlob but single noise on direct getImageData.
    const id = ORIG.getImageData.call(cctx, 0, 0, c.width, c.height);
    applyCanvasNoise(id.data, profile.canvasSeed);
    cctx.putImageData(id, 0, 0);
    return c;
  }

  HTMLCanvasElement.prototype.toDataURL = disguise(function(...args) {
    try {
      if (this.width > 0 && this.height > 0)
        return ORIG.toDataURL.apply(noisyClone(this), args);
    } catch(e) {}
    return ORIG.toDataURL.apply(this, args);
  }, "toDataURL");

  HTMLCanvasElement.prototype.toBlob = disguise(function(cb, ...args) {
    try {
      if (this.width > 0 && this.height > 0)
        return ORIG.toBlob.call(noisyClone(this), cb, ...args);
    } catch(e) {}
    return ORIG.toBlob.call(this, cb, ...args);
  }, "toBlob");

  CanvasRenderingContext2D.prototype.getImageData = disguise(function(...args) {
    const id = ORIG.getImageData.apply(this, args);
    applyCanvasNoise(id.data, profile.canvasSeed);
    return id;
  }, "getImageData", 4);

  // === Font fingerprinting defense (measureText noise) ===
  // Rowan pass 4 finding #5: noise must be deterministic for the same input.
  // Hash the text content + font + canvasSeed to produce stable noise.
  //
  // v3 item 5b: Font enumeration resistance. CSS font probing works by
  // measuring text width with a candidate font vs a fallback — if widths
  // differ, the font is installed. Amplified noise for known probe fonts
  // collapses the width delta signal, making font presence undetectable
  // via measureText. The JS-side measurement becomes unreliable while
  // CSS rendering is unaffected.
  const _fontProbeSet = new Set([
    // Top system fonts used by FingerprintJS, CreepJS, and font-enumeration scripts
    "Arial", "Verdana", "Times New Roman", "Georgia", "Trebuchet MS",
    "Courier New", "Impact", "Comic Sans MS", "Palatino Linotype",
    "Lucida Console", "Lucida Sans Unicode", "Tahoma", "Century Gothic",
    "Bookman Old Style", "Garamond", "MS Gothic", "MS PGothic",
    "MS Sans Serif", "MS Serif", "Wingdings", "Webdings", "Symbol",
    "Segoe UI", "Calibri", "Cambria", "Consolas", "Candara",
    "Franklin Gothic Medium", "Copperplate Gothic Bold",
    "Papyrus", "Brush Script MT", "Rockwell", "Bodoni MT",
    // macOS-specific probes
    "Helvetica Neue", "Menlo", "Monaco", "Optima", "Futura",
    "American Typewriter", "Baskerville", "Didot", "Gill Sans",
    // Linux probes
    "DejaVu Sans", "Liberation Sans", "Ubuntu", "Noto Sans",
  ]);

  function _isFontProbe(fontString) {
    if (!fontString) return false;
    // CSS font shorthand: "12px Arial" or "bold 14px 'Times New Roman', serif"
    // Extract font-family portion (everything after the last size token)
    const parts = fontString.split(/\d+(?:px|pt|em|rem|%)\s*/);
    const familyPart = parts.length > 1 ? parts[parts.length - 1] : fontString;
    // Check each family in the comma-separated list
    const families = familyPart.split(",");
    for (const f of families) {
      const clean = f.trim().replace(/^['"]|['"]$/g, "");
      if (_fontProbeSet.has(clean)) return true;
    }
    return false;
  }

  const origMeasureText = CanvasRenderingContext2D.prototype.measureText;
  CanvasRenderingContext2D.prototype.measureText = disguise(function(text) {
    const metrics = origMeasureText.call(this, text);
    // Deterministic noise: hash text + font + seed → stable offset
    let h = profile.canvasSeed;
    const input = (text || "") + (this.font || "");
    for (let i = 0; i < input.length; i++) {
      h = Math.imul(h ^ input.charCodeAt(i), 0x5bd1e995);
      h = (h ^ (h >>> 15)) >>> 0;
    }
    // v3 5b: amplify noise for known font-probe fonts (±0.5px vs ±0.1px)
    // to collapse the width delta used by font enumeration scripts
    const isProbe = _isFontProbe(this.font);
    const noise = isProbe
      ? ((h % 1000) - 500) / 1000  // ±0.5px for probe fonts
      : ((h % 200) - 100) / 1000;  // ±0.1px for normal use
    return new Proxy(metrics, {
      get(target, prop) {
        if (prop === "width") return target.width + noise;
        const val = target[prop];
        return typeof val === "function" ? val.bind(target) : val;
      }
    });
  }, "measureText");

  // Export applyCanvasNoise for use by webgl.js (readPixels, OffscreenCanvas)
  ctx.applyCanvasNoise = applyCanvasNoise;
}
