/**
 * PhantomGrid — Screen Spoofing Module
 * Screen dimensions, position, DPR, visualViewport, matchMedia evaluator.
 */

export function installScreen(ctx) {
  const { ORIG, profile, spoof, disguise, mulberry32 } = ctx;

  // === Screen spoofing ===
  spoof(Screen.prototype, "width", () => profile.screen.width);
  spoof(Screen.prototype, "height", () => profile.screen.height);
  spoof(Screen.prototype, "availWidth", () => profile.screen.width);
  spoof(Screen.prototype, "availHeight", () => profile.screen.avail);
  spoof(Screen.prototype, "colorDepth", () => profile.colorDepth);
  spoof(Screen.prototype, "pixelDepth", () => profile.colorDepth);

  // === Screen position spoofing ===
  // window.screenX/screenY and screen.availLeft/availTop leak the browser
  // window's absolute position on the physical display. On multi-monitor
  // setups this is nearly unique (ratio <0.00001 on AmIUnique). Spoof to 0
  // (single-monitor primary position) for all profiles.
  spoof(Screen.prototype, "availLeft", () => 0);
  spoof(Screen.prototype, "availTop", () => 0);
  spoof(window, "screenX", () => 0);
  spoof(window, "screenY", () => 0);
  spoof(window, "screenLeft", () => 0);
  spoof(window, "screenTop", () => 0);

  const browserChrome = 80 + Math.floor(mulberry32(profile.canvasSeed)() * 40);
  const innerW = profile.screen.width;
  const innerH = profile.screen.height - browserChrome;
  spoof(window, "innerWidth", () => innerW);
  spoof(window, "innerHeight", () => innerH);
  spoof(window, "outerWidth", () => profile.screen.width);
  spoof(window, "outerHeight", () => profile.screen.height);

  // === devicePixelRatio (rowan pass 3: CSS/display surface consistency) ===
  // 4K (3840x2160) typically runs at 2x DPR. Everything else: 1.
  const spoofedDPR = profile.screen.width >= 3840 ? 2 : 1;
  spoof(window, "devicePixelRatio", () => spoofedDPR);

  // === visualViewport (rowan pass 3) ===
  // Must align with spoofed innerWidth/innerHeight to avoid desync detection.
  if (typeof VisualViewport !== "undefined" && window.visualViewport) {
    spoof(window.visualViewport, "width", () => innerW);
    spoof(window.visualViewport, "height", () => innerH);
    spoof(window.visualViewport, "scale", () => 1);
  }

  // === matchMedia evaluator (v1.1, revised per rowan + lux review) ===
  // Full CSS media query parser resolving against spoofed profile values.
  // Handles both legacy (min-width: 1024px) and MQ Level 4 range syntax
  // (width >= 1024px), (1024px <= width), (400px < width < 1200px).
  //
  // Security invariants (rowan + lux findings):
  // - Hardware features (width, height, resolution, etc.) FAIL CLOSED
  //   when values use unparseable units — never falls through to real
  //   matchMedia for hardware-identifying queries.
  // - All CSS length units (px, em, rem, vw, vh, cm, in, etc.) are parsed
  //   using spoofed viewport dimensions, not real ones.
  // - Listener callbacks are no-ops on spoofed queries — spoofed values
  //   are fixed per session, so forwarding real resize/orientation events
  //   would leak real dimensions through event.matches.
  // - Preference features (prefers-color-scheme, etc.) pass through.
  if (typeof window.matchMedia === "function") {
    const origMatchMedia = window.matchMedia.bind(window);

    const mq = {
      width: innerW,
      height: innerH,
      deviceWidth: profile.screen.width,
      deviceHeight: profile.screen.height,
      dpr: spoofedDPR,
      colorBits: profile.colorDepth,
      orientation: profile.screen.width >= profile.screen.height ? "landscape" : "portrait",
    };

    // Features that reveal hardware/display characteristics — must never
    // delegate to real matchMedia, even if we can't parse the value.
    const HARDWARE_FEATURES = new Set([
      "width", "height", "device-width", "device-height",
      "aspect-ratio", "device-aspect-ratio", "resolution",
      "color", "color-index", "monochrome",
    ]);

    // Parse CSS length to px using spoofed viewport dimensions.
    // Handles all standard CSS length units to prevent leak via exotic units.
    function parseLen(v) {
      if (!v) return null;
      const m = v.match(/^([\d.]+)\s*(px|em|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc)?$/);
      if (!m) return null;
      const n = parseFloat(m[1]);
      switch (m[2] || "px") {
        case "px": return n;
        case "em": case "rem": return n * 16;
        case "vw": return n * mq.width / 100;
        case "vh": return n * mq.height / 100;
        case "vmin": return n * Math.min(mq.width, mq.height) / 100;
        case "vmax": return n * Math.max(mq.width, mq.height) / 100;
        case "cm": return n * 96 / 2.54;
        case "mm": return n * 96 / 25.4;
        case "in": return n * 96;
        case "pt": return n * 96 / 72;
        case "pc": return n * 96 / 6;
        default: return null;
      }
    }

    function parseRes(v) {
      if (!v) return null;
      const m = v.match(/^([\d.]+)\s*(dppx|dpi|x)?$/);
      if (!m) return null;
      const n = parseFloat(m[1]);
      if (!m[2]) return n; // bare number = dppx (e.g. -webkit-device-pixel-ratio: 2)
      return m[2] === "dpi" ? n / 96 : n;
    }

    function parseRatio(v) {
      if (!v) return null;
      const parts = v.split("/").map(s => parseFloat(s.trim()));
      if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1]) || parts[1] === 0) return null;
      return parts[0] / parts[1];
    }

    // Get spoofed numeric value for a dimensional feature.
    function featureValue(feat) {
      switch (feat) {
        case "width": return mq.width;
        case "height": return mq.height;
        case "device-width": return mq.deviceWidth;
        case "device-height": return mq.deviceHeight;
        case "resolution": return mq.dpr;
        case "color": return 8;
        case "color-index": return 0;
        case "monochrome": return 0;
        case "aspect-ratio": return mq.width / mq.height;
        case "device-aspect-ratio": return mq.deviceWidth / mq.deviceHeight;
        default: return undefined;
      }
    }

    // Parse a feature's target value depending on the feature type.
    function parseTarget(feat, valStr) {
      if (feat === "resolution") return parseRes(valStr);
      if (feat === "aspect-ratio" || feat === "device-aspect-ratio") return parseRatio(valStr);
      return parseLen(valStr);
    }

    // Evaluate a discrete (non-dimensional) or preference feature.
    function evalDiscrete(feat, val) {
      switch (feat) {
        case "pointer": case "any-pointer":
          return val ? { matches: val === "fine" } : { matches: true };
        case "hover": case "any-hover":
          return val ? { matches: val === "hover" } : { matches: true };
        case "orientation":
          return val ? { matches: val === mq.orientation } : { matches: true };
        case "display-mode":
          return val ? { matches: val === "browser" } : { matches: true };
        // Preference features — pass through to real matchMedia
        case "prefers-color-scheme":
        case "prefers-reduced-motion":
        case "prefers-contrast":
        case "forced-colors":
        case "prefers-reduced-transparency":
          return null;
        default:
          return null; // unknown — pass through
      }
    }

    // Normalize WebKit-prefixed DPR queries to standard resolution.
    // -webkit-device-pixel-ratio is a common Chromium fingerprinting vector
    // that must not fall through to real matchMedia (rowan pass 9 finding).
    function normalizeWebkitDPR(s) {
      return s
        .replace(/-webkit-min-device-pixel-ratio/g, "min-resolution")
        .replace(/-webkit-max-device-pixel-ratio/g, "max-resolution")
        .replace(/-webkit-device-pixel-ratio/g, "resolution");
    }

    // Evaluate a single parenthesized media feature expression.
    // Handles legacy (feature: value) and MQ Level 4 range syntax.
    function evalFeature(raw) {
      const inner = normalizeWebkitDPR(raw.trim().replace(/^\(\s*/, "").replace(/\s*\)$/, "").trim());

      // --- MQ Level 4 double range: value op feature op value ---
      // e.g., (400px < width < 1200px), (1/2 <= aspect-ratio <= 16/9)
      const dbl = inner.match(
        /^(.+?)\s*(<=|>=|<|>)\s*([a-z][a-z0-9-]*)\s*(<=|>=|<|>)\s*(.+)$/
      );
      if (dbl) {
        const [, v1s, op1, feat, op2, v2s] = dbl;
        const actual = featureValue(feat);
        if (actual === undefined) return evalDiscrete(feat, null);
        const t1 = parseTarget(feat, v1s.trim());
        const t2 = parseTarget(feat, v2s.trim());
        if (t1 === null || t2 === null) {
          return HARDWARE_FEATURES.has(feat) ? { matches: false } : null;
        }
        // v1 op1 feat: "v1 < feat" means feat > v1
        let left;
        if (op1 === "<") left = actual > t1;
        else if (op1 === "<=") left = actual >= t1;
        else if (op1 === ">") left = actual < t1;
        else if (op1 === ">=") left = actual <= t1;
        else left = false;
        let right;
        if (op2 === "<") right = actual < t2;
        else if (op2 === "<=") right = actual <= t2;
        else if (op2 === ">") right = actual > t2;
        else if (op2 === ">=") right = actual >= t2;
        else right = false;
        return { matches: left && right };
      }

      // --- MQ Level 4 single range: feature op value ---
      // e.g., (width >= 1024px), (resolution >= 2dppx)
      const fov = inner.match(/^([a-z][a-z0-9-]*)\s*(<=|>=|<|>|=)\s*(.+)$/);
      if (fov) {
        const [, feat, op, valStr] = fov;
        const actual = featureValue(feat);
        if (actual === undefined) return evalDiscrete(feat, op === "=" ? valStr.trim() : null);
        const target = parseTarget(feat, valStr.trim());
        if (target === null) {
          return HARDWARE_FEATURES.has(feat) ? { matches: false } : null;
        }
        switch (op) {
          case ">=": return { matches: actual >= target };
          case ">":  return { matches: actual > target };
          case "<=": return { matches: actual <= target };
          case "<":  return { matches: actual < target };
          case "=":  return { matches: actual === target };
          default:   return null;
        }
      }

      // --- MQ Level 4 reversed: value op feature ---
      // e.g., (1024px <= width)
      const vof = inner.match(/^(.+?)\s*(<=|>=|<|>|=)\s*([a-z][a-z0-9-]*)$/);
      if (vof) {
        const [, valStr, op, feat] = vof;
        const actual = featureValue(feat);
        if (actual === undefined) return evalDiscrete(feat, op === "=" ? valStr.trim() : null);
        const target = parseTarget(feat, valStr.trim());
        if (target === null) {
          return HARDWARE_FEATURES.has(feat) ? { matches: false } : null;
        }
        // Reverse operator: "1024px <= width" means "width >= 1024px"
        const revOps = { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "=": "=" };
        const rev = revOps[op];
        switch (rev) {
          case ">=": return { matches: actual >= target };
          case ">":  return { matches: actual > target };
          case "<=": return { matches: actual <= target };
          case "<":  return { matches: actual < target };
          case "=":  return { matches: actual === target };
          default:   return null;
        }
      }

      // --- Legacy colon syntax: (feature: value) or (feature) ---
      const legacy = inner.match(/^([a-z][a-z0-9-]*)\s*(?::\s*(.+))?$/);
      if (!legacy) return null;
      let feat = legacy[1];
      const val = legacy[2] ? legacy[2].trim() : null;
      let prefix = "";
      if (feat.startsWith("min-")) { prefix = "min"; feat = feat.slice(4); }
      else if (feat.startsWith("max-")) { prefix = "max"; feat = feat.slice(4); }

      const actual = featureValue(feat);
      if (actual !== undefined) {
        if (!val && !prefix) return { matches: actual > 0 };
        const target = parseTarget(feat, val);
        if (target === null) {
          return HARDWARE_FEATURES.has(feat) ? { matches: false } : null;
        }
        if (prefix === "min") return { matches: actual >= target };
        if (prefix === "max") return { matches: actual <= target };
        return { matches: actual === target };
      }
      return evalDiscrete(feat, val);
    }

    // Evaluate a full media query string.
    // Handles "and" combinators and comma-separated lists (OR).
    function evalQuery(query) {
      const orClauses = query.split(",").map(s => s.trim());
      let anyNull = false;

      for (const clause of orClauses) {
        let work = clause
          .replace(/^\s*only\s+/i, "")
          .replace(/^\s*(all|screen|print|speech)\s*/i, "")
          .replace(/^\s*and\s+/i, "");
        let invert = false;
        if (/^\s*not\s+/i.test(clause)) {
          invert = true;
          work = clause.replace(/^\s*not\s+/i, "")
            .replace(/^\s*(all|screen|print|speech)\s*/i, "")
            .replace(/^\s*and\s+/i, "");
        }
        if (/^\s*(not\s+)?(print|speech)\b/i.test(clause)) {
          if (!invert) continue;
          return true;
        }
        const features = work.match(/\([^)]+\)/g);
        if (!features || features.length === 0) {
          if (invert) continue;
          return true;
        }
        let clauseResult = true;
        for (const feat of features) {
          const result = evalFeature(feat);
          if (result === null) { anyNull = true; clauseResult = false; break; }
          if (result.matches === null) { anyNull = true; clauseResult = false; break; }
          if (!result.matches) { clauseResult = false; break; }
        }
        if (invert) clauseResult = !clauseResult;
        if (clauseResult) return true;
      }
      if (anyNull) return null;
      return false;
    }

    window.matchMedia = disguise(function(query) {
      const result = evalQuery(query);
      if (result === null) {
        // Unrecognized/preference features — delegate to real matchMedia
        return origMatchMedia(query);
      }

      // Build a fake MediaQueryList with fixed spoofed matches.
      // Listeners are no-ops: spoofed values don't change mid-session,
      // so forwarding real change events would leak actual dimensions
      // via event.matches (rowan finding #2).
      const fakeList = Object.create(MediaQueryList.prototype);
      Object.defineProperties(fakeList, {
        matches: { get: () => result, enumerable: true },
        media: { get: () => query, enumerable: true },
      });
      fakeList.addEventListener = function() {};
      fakeList.removeEventListener = function() {};
      fakeList.addListener = function() {};
      fakeList.removeListener = function() {};
      fakeList.dispatchEvent = function() { return true; };
      return fakeList;
    }, "matchMedia");
  }
}
