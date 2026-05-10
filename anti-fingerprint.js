/**
 * PhantomGrid — Anti-Fingerprint Content Script
 * Runs in MAIN world at document_start, before any page script.
 *
 * Architecture (rowan review pass 2, 2026-05-08):
 * - One-way immutable bootstrap. Reads seed from sessionStorage once,
 *   generates profile, applies overrides. NO message bus, NO live updates.
 * - Original function references saved BEFORE wrapping — prevents wrapper
 *   stacking on any future re-application.
 * - Rotation = background.js clears sessionStorage seed + reloads tabs.
 *   Each tab generates a fresh identity on reload.
 * - Cross-origin iframes generate independent seeds. This is an inherent
 *   limitation of the content-script model. The HTTP User-Agent header
 *   still matches (set globally via declarativeNetRequest). JS-level
 *   fingerprints in cross-origin iframes may differ from the top frame.
 *   Fixable only at network level (Phase 2 proxy).
 * - Per-site disable via cookie (__pgd). Set by background.js via
 *   chrome.scripting.executeScript in MAIN world before reload;
 *   checked synchronously here. NOTE: JS-created cookies cannot be
 *   httpOnly, so __pgd IS readable by page JS. The key is generic
 *   but detectable once known. This is a detection risk (reveals
 *   extension presence), not a privacy leak (does not expose real
 *   identity). Known limitation for v1.0.
 */

(function() {
  "use strict";

  // === Disable check (synchronous, before any overrides) ===
  // Uses a cookie instead of localStorage to avoid extension-detection
  // leaks (rowan pass 3: page JS could read localStorage.__pg_off__
  // to detect PhantomGrid). The cookie key is intentionally generic.
  try {
    if (document.cookie.split(";").some(c => c.trim().startsWith("__pgd=1"))) return;
  } catch(e) {}

  // === Save original function references BEFORE any wrapping ===
  // Prevents wrapper stacking (rowan pass 2 finding #2): even if this
  // code ever runs twice, wrappers always delegate to the true originals.
  const ORIG = {
    toDataURL: HTMLCanvasElement.prototype.toDataURL,
    toBlob: HTMLCanvasElement.prototype.toBlob,
    getImageData: CanvasRenderingContext2D.prototype.getImageData,
    getTimezoneOffset: Date.prototype.getTimezoneOffset,
    resolvedOptions: Intl.DateTimeFormat.prototype.resolvedOptions,
    DateTimeFormat: Intl.DateTimeFormat,
    // Descriptor/toString hardening originals (v2 item 6)
    fnToString: Function.prototype.toString,
    defineProperty: Object.defineProperty,
    getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
    getOwnPropertyDescriptors: Object.getOwnPropertyDescriptors,
    reflectGOPD: typeof Reflect !== "undefined" ? Reflect.getOwnPropertyDescriptor : null,
    promiseResolve: Promise.resolve,
  };
  if (typeof WebGLRenderingContext !== "undefined") {
    ORIG.glGetParameter = WebGLRenderingContext.prototype.getParameter;
    ORIG.glReadPixels = WebGLRenderingContext.prototype.readPixels;
  }
  if (typeof WebGL2RenderingContext !== "undefined") {
    ORIG.gl2GetParameter = WebGL2RenderingContext.prototype.getParameter;
    ORIG.gl2ReadPixels = WebGL2RenderingContext.prototype.readPixels;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    ORIG.offscreenConvertToBlob = OffscreenCanvas.prototype.convertToBlob;
    if (typeof OffscreenCanvasRenderingContext2D !== "undefined") {
      ORIG.offscreenGetImageData = OffscreenCanvasRenderingContext2D.prototype.getImageData;
    }
  }
  if (typeof AudioBuffer !== "undefined") {
    ORIG.getChannelData = AudioBuffer.prototype.getChannelData;
  }
  if (typeof AudioNode !== "undefined") {
    ORIG.audioConnect = AudioNode.prototype.connect;
  }

  // === Plausible profile combos (correlated GPU/UA groups) ===
  const UA_GROUPS = [
    {
      uas: [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      ],
      platform: "Win32",
      gpus: [
        { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)" },
        { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB, OpenGL 4.5)" },
        { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)" },
        { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, OpenGL 4.5)" },
        { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)" },
        { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 6700 XT, OpenGL 4.5)" },
        { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.5)" },
        { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) HD Graphics 620, OpenGL 4.5)" },
      ],
    },
    {
      uas: [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      ],
      platform: "MacIntel",
      gpus: [
        { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M1, OpenGL 4.1)" },
        { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M2, OpenGL 4.1)" },
        { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Plus Graphics, OpenGL 4.1)" },
      ],
    },
    {
      uas: [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
      ],
      platform: "Win32",
      gpus: [
        { vendor: "Intel", renderer: "Intel(R) UHD Graphics 630" },
        { vendor: "NVIDIA Corporation", renderer: "NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2" },
        { vendor: "NVIDIA Corporation", renderer: "NVIDIA GeForce RTX 3060/PCIe/SSE2" },
        { vendor: "ATI Technologies Inc.", renderer: "AMD Radeon RX 580" },
        { vendor: "Intel", renderer: "Intel(R) Iris(R) Xe Graphics" },
      ],
    },
    {
      uas: [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0",
      ],
      platform: "MacIntel",
      gpus: [
        { vendor: "Apple", renderer: "Apple M1" },
        { vendor: "Apple", renderer: "Apple M2" },
        { vendor: "Intel Inc.", renderer: "Intel(R) Iris(R) Plus Graphics" },
      ],
    },
    {
      uas: [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
      ],
      platform: "Win32",
      gpus: [
        { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)" },
        { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)" },
        { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, OpenGL 4.5)" },
        { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.5)" },
      ],
    },
    {
      uas: [
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      ],
      platform: "Linux x86_64",
      gpus: [
        { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)" },
        { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB, OpenGL 4.5)" },
        { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)" },
      ],
    },
  ];

  const SCREENS = [
    { width: 1920, height: 1080, avail: 1040 },
    { width: 2560, height: 1440, avail: 1400 },
    { width: 1366, height: 768,  avail: 728  },
    { width: 1536, height: 864,  avail: 824  },
    { width: 1440, height: 900,  avail: 860  },
    { width: 1680, height: 1050, avail: 1010 },
    { width: 3840, height: 2160, avail: 2120 },
    { width: 1280, height: 720,  avail: 680  },
    { width: 1600, height: 900,  avail: 860  },
  ];
  const CORES = [2, 4, 6, 8, 10, 12, 16];
  const MEMORY = [4, 8, 8, 8, 16, 16, 32];
  const COLOR_DEPTHS = [24, 24, 24, 32];
  const LANGUAGES = [
    ["en-US", "en"], ["en-US", "en", "es"], ["en-GB", "en"],
    ["en-US"], ["en-US", "en", "fr"], ["en-US", "en", "de"],
  ];
  const TIMEZONES = [
    "America/New_York", "America/Chicago", "America/Denver",
    "America/Los_Angeles", "America/Phoenix",
    "Europe/London", "Europe/Berlin", "America/Toronto",
  ];

  // Seeded PRNG
  function mulberry32(seed) {
    return function() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function pickFrom(arr, rng) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function generateProfile(seed) {
    const rng = mulberry32(seed);
    const group = pickFrom(UA_GROUPS, rng);
    const ua = pickFrom(group.uas, rng);
    const gpu = pickFrom(group.gpus, rng);
    return {
      userAgent: ua,
      platform: group.platform,
      hardwareConcurrency: pickFrom(CORES, rng),
      deviceMemory: pickFrom(MEMORY, rng),
      screen: pickFrom(SCREENS, rng),
      colorDepth: pickFrom(COLOR_DEPTHS, rng),
      gpu: gpu,
      languages: pickFrom(LANGUAGES, rng),
      timezone: pickFrom(TIMEZONES, rng),
      canvasSeed: (rng() * 0xFFFFFFFF) >>> 0,
      audioSeed: (rng() * 0xFFFFFFFF) >>> 0,
    };
  }

  // === DST-aware timezone offset ===
  // Uses the REAL Intl.DateTimeFormat (saved in ORIG) before we proxy it.
  function getTimezoneOffset(tz) {
    try {
      const now = new Date();
      const fmt = new ORIG.DateTimeFormat("en-US", {
        timeZone: tz, timeZoneName: "shortOffset",
      });
      const parts = fmt.formatToParts(now);
      const tzPart = parts.find(p => p.type === "timeZoneName");
      if (tzPart) {
        const match = tzPart.value.match(/GMT([+-]?\d+)?(?::(\d+))?/);
        if (match) {
          const hours = parseInt(match[1] || "0", 10);
          const minutes = parseInt(match[2] || "0", 10);
          return -(hours * 60 + (hours < 0 ? -minutes : minutes));
        }
      }
    } catch(e) {}
    const fallback = {
      "America/New_York": 300, "America/Chicago": 360, "America/Denver": 420,
      "America/Los_Angeles": 480, "America/Phoenix": 420,
      "Europe/London": 0, "Europe/Berlin": -60, "America/Toronto": 300,
    };
    return fallback[tz] || 300;
  }

  // === Session seed ===
  let sessionSeed;
  try {
    // Iframes: try to inherit parent seed (same-origin only)
    if (window !== window.top) {
      try {
        const parentSeed = window.top.sessionStorage.getItem("__pg_seed__");
        if (parentSeed) sessionSeed = parseInt(parentSeed, 10);
      } catch(e) {
        // Cross-origin iframe — inherent limitation, generates own seed
      }
    }
    if (!sessionSeed) {
      const stored = sessionStorage.getItem("__pg_seed__");
      if (stored) {
        sessionSeed = parseInt(stored, 10);
      } else {
        sessionSeed = Date.now() ^ (crypto.getRandomValues(new Uint32Array(1))[0]);
        sessionStorage.setItem("__pg_seed__", String(sessionSeed));
      }
    }
  } catch(e) {
    sessionSeed = Date.now() ^ (crypto.getRandomValues(new Uint32Array(1))[0]);
  }

  const profile = generateProfile(sessionSeed);

  // Compute DST-aware offset BEFORE we proxy Intl.DateTimeFormat
  const currentTzOffset = getTimezoneOffset(profile.timezone);

  // === toString / descriptor hardening infrastructure (v2 item 6) ===
  // WeakMap-based toString: disguised functions don't carry an own toString
  // property (detectable via hasOwnProperty / in / getOwnPropertyDescriptor).
  // Instead, Function.prototype.toString is overridden once to check the
  // WeakMap before delegating to the real toString.
  const _nativeStrings = new WeakMap();

  // Registry of spoofed (obj, prop) → original descriptor, so GOPD/GOPDs
  // can return native-shaped descriptors for overridden properties.
  // Key is `obj`, value is Map<prop, originalDescriptor>.
  const _spoofedProps = new WeakMap();

  // Override Function.prototype.toString FIRST — before any disguise() call.
  ORIG.defineProperty.call(Object, Function.prototype, "toString", {
    value: function toString() {
      const fake = _nativeStrings.get(this);
      if (fake !== undefined) return fake;
      return ORIG.fnToString.call(this);
    },
    writable: true, configurable: true, enumerable: false,
  });
  // The toString override itself must look native
  _nativeStrings.set(Function.prototype.toString, "function toString() { [native code] }");

  // === Helper: make a wrapper look native (hardened) ===
  // Registers the function in the WeakMap. Does NOT set own toString/
  // toLocaleString properties — those are the primary detection vectors.
  // Sets function name and length to match the native original.
  // Third argument `expectedLength` overrides fn.length when the wrapper
  // uses rest args (...args) which sets length to 0.
  function disguise(fn, name, expectedLength) {
    _nativeStrings.set(fn, `function ${name}() { [native code] }`);
    try {
      ORIG.defineProperty.call(Object, fn, "name", {
        value: name, configurable: true,
      });
      ORIG.defineProperty.call(Object, fn, "length", {
        value: expectedLength !== undefined ? expectedLength : fn.length,
        configurable: true,
      });
    } catch(e) {}
    return fn;
  }

  // === Helper: override a property on a prototype (hardened) ===
  // Saves the pristine descriptor so GOPD can normalize flags.
  // Sets getter.name to "get propName" (matches native getter naming).
  // Uses pristine descriptor flags for configurable/enumerable.
  function spoof(obj, prop, getter) {
    try {
      // Save pristine descriptor before overwrite
      const origDesc = ORIG.getOwnPropertyDescriptor.call(Object, obj, prop);
      if (!_spoofedProps.has(obj)) _spoofedProps.set(obj, new Map());
      _spoofedProps.get(obj).set(prop, origDesc || null);

      // Disguise the getter: native toString + native-shaped name
      _nativeStrings.set(getter, `function get ${prop}() { [native code] }`);
      try {
        ORIG.defineProperty.call(Object, getter, "name", {
          value: "get " + prop, configurable: true,
        });
      } catch(e) {}

      // Preserve pristine descriptor flags
      const configurable = origDesc ? origDesc.configurable !== false : true;
      const enumerable = origDesc ? origDesc.enumerable !== false : true;

      ORIG.defineProperty.call(Object, obj, prop, {
        get: getter, configurable: configurable, enumerable: enumerable,
      });
    } catch(e) {}
  }

  // === Descriptor hardening: GOPD / GOPDs / Reflect.getOwnPropertyDescriptor ===
  // Fingerprinters call GOPD on spoofed properties and inspect the getter's
  // toString, name, prototype presence, or descriptor shape. We intercept
  // GOPD to normalize descriptor flags against the pristine baseline from
  // _spoofedProps, ensuring configurable/enumerable match the original.
  Object.getOwnPropertyDescriptor = disguise(function getOwnPropertyDescriptor(obj, prop) {
    const desc = ORIG.getOwnPropertyDescriptor.call(Object, obj, prop);
    if (!desc || !desc.get) return desc;

    // Normalize descriptor flags against pristine baseline
    const spoofed = _spoofedProps.get(obj);
    if (spoofed && spoofed.has(prop)) {
      const pristine = spoofed.get(prop);
      if (pristine) {
        desc.configurable = pristine.configurable;
        desc.enumerable = pristine.enumerable;
      }
    }
    return desc;
  }, "getOwnPropertyDescriptor");

  Object.getOwnPropertyDescriptors = disguise(function getOwnPropertyDescriptors(obj) {
    const descs = ORIG.getOwnPropertyDescriptors.call(Object, obj);
    // Normalize any spoofed property descriptors
    const spoofed = _spoofedProps.get(obj);
    if (spoofed) {
      for (const [prop, pristine] of spoofed) {
        if (descs[prop] && descs[prop].get && pristine) {
          descs[prop].configurable = pristine.configurable;
          descs[prop].enumerable = pristine.enumerable;
        }
      }
    }
    return descs;
  }, "getOwnPropertyDescriptors");

  if (ORIG.reflectGOPD) {
    Reflect.getOwnPropertyDescriptor = disguise(function getOwnPropertyDescriptor(target, prop) {
      const desc = ORIG.reflectGOPD.call(Reflect, target, prop);
      if (!desc || !desc.get) return desc;

      const spoofed = _spoofedProps.get(target);
      if (spoofed && spoofed.has(prop)) {
        const pristine = spoofed.get(prop);
        if (pristine) {
          desc.configurable = pristine.configurable;
          desc.enumerable = pristine.enumerable;
        }
      }
      return desc;
    }, "getOwnPropertyDescriptor");
  }

  // === Navigator spoofing ===
  spoof(Navigator.prototype, "userAgent", () => profile.userAgent);
  spoof(Navigator.prototype, "platform", () => profile.platform);
  spoof(Navigator.prototype, "hardwareConcurrency", () => profile.hardwareConcurrency);
  spoof(Navigator.prototype, "deviceMemory", () => profile.deviceMemory);
  spoof(Navigator.prototype, "languages", () => Object.freeze([...profile.languages]));
  spoof(Navigator.prototype, "language", () => profile.languages[0]);
  spoof(Navigator.prototype, "webdriver", () => false);

  spoof(Navigator.prototype, "vendor", () => profile.userAgent.includes("Firefox") ? "" : "Google Inc.");
  spoof(Navigator.prototype, "appVersion", () => profile.userAgent.replace("Mozilla/", ""));

  // maxTouchPoints — desktop = 0, prevents Surface Pro touch leak
  spoof(Navigator.prototype, "maxTouchPoints", () => 0);

  // Global Privacy Control — always true, consistent with Sec-GPC header (v2 item 7)
  spoof(Navigator.prototype, "globalPrivacyControl", () => true);

  // Cross-origin referrer trimming (v2 item 9)
  const _origReferrer = document.referrer;
  spoof(Document.prototype, "referrer", () => {
    if (!_origReferrer) return '';
    try {
      const refOrigin = new URL(_origReferrer).origin;
      const curOrigin = location.origin;
      if (refOrigin === curOrigin) return _origReferrer;
      return refOrigin + '/';
    } catch(e) {
      return _origReferrer;
    }
  });

  // Network Information API — hide real connection type
  try {
    if (navigator.connection) {
      spoof(Navigator.prototype, "connection", () => undefined);
    }
  } catch(e) {}

  // === Client Hints (navigator.userAgentData) ===
  const chromeMatch = profile.userAgent.match(/Chrome\/(\d+)/);
  const edgeMatch = profile.userAgent.match(/Edg\/(\d+)/);

  if (chromeMatch && typeof NavigatorUAData !== "undefined") {
    const chromeVer = chromeMatch[1];
    const isEdge = !!edgeMatch;
    const brands = isEdge
      ? [{ brand: "Microsoft Edge", version: edgeMatch[1] }, { brand: "Chromium", version: chromeVer }, { brand: "Not.A/Brand", version: "8" }]
      : [{ brand: "Google Chrome", version: chromeVer }, { brand: "Chromium", version: chromeVer }, { brand: "Not.A/Brand", version: "8" }];
    const isMac = profile.platform === "MacIntel";
    const isLinux = profile.platform.startsWith("Linux");
    const uaPlatform = isMac ? "macOS" : isLinux ? "Linux" : "Windows";

    // Apple Silicon GPUs → ARM architecture (rowan pass 3: UA-CH consistency)
    const isAppleSilicon = profile.gpu.renderer.includes("Apple M");
    const arch = isAppleSilicon ? "arm" : "x86";

    const fakeUAData = {
      brands, mobile: false, platform: uaPlatform,
      toJSON() { return { brands: this.brands, mobile: this.mobile, platform: this.platform }; },
      getHighEntropyValues() {
        return Promise.resolve({
          brands, mobile: false, platform: uaPlatform,
          platformVersion: isMac ? "15.5.0" : isLinux ? "6.8.0" : "15.0.0",
          architecture: arch, bitness: "64", model: "",
          uaFullVersion: `${chromeVer}.0.0.0`,
          fullVersionList: brands.map(b => ({ brand: b.brand, version: `${b.version}.0.0.0` })),
          wow64: false,
        });
      },
    };
    disguise(fakeUAData.getHighEntropyValues, "getHighEntropyValues");
    disguise(fakeUAData.toJSON, "toJSON");
    spoof(Navigator.prototype, "userAgentData", () => fakeUAData);
  }

  if (profile.userAgent.includes("Firefox") && !chromeMatch) {
    spoof(Navigator.prototype, "userAgentData", () => undefined);
  }

  // === Screen spoofing ===
  spoof(Screen.prototype, "width", () => profile.screen.width);
  spoof(Screen.prototype, "height", () => profile.screen.height);
  spoof(Screen.prototype, "availWidth", () => profile.screen.width);
  spoof(Screen.prototype, "availHeight", () => profile.screen.avail);
  spoof(Screen.prototype, "colorDepth", () => profile.colorDepth);
  spoof(Screen.prototype, "pixelDepth", () => profile.colorDepth);

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

  // === Canvas fingerprint noise ===
  // Rowan pass 4 finding #5: noise MUST be deterministic for the same input.
  // An advancing PRNG means repeated identical toDataURL() calls produce
  // different output — a strong tampering signal. Instead, derive noise
  // from hash(canvasSeed + pixelIndex + pixelValue). Same canvas content
  // always produces the same noised output within the same session.
  //
  // Offscreen clone prevents visible canvas corruption (lux review).
  // Always wraps from ORIG references, never from current prototype (rowan pass 2).

  // Fast deterministic hash: derive a ±1 noise value from seed + position + pixel value.
  // Uses a simple xorshift-like mixing function instead of a PRNG.
  function pixelNoise(seed, i, val) {
    let h = seed ^ (i * 2654435761);
    h = (h ^ (val * 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = (h ^ (h >>> 16)) >>> 0;
    return (h & 1) ? 1 : -1;
  }

  // Apply deterministic ±1 noise to an ImageData's RGB channels in-place.
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
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0);
    // Use ORIG.getImageData to get raw pixel data WITHOUT noise.
    // The patched getImageData (below) already applies applyCanvasNoise,
    // so calling the patched version here would apply noise once, then
    // applyCanvasNoise below would apply it AGAIN — double noise on
    // toDataURL/toBlob but single noise on direct getImageData.
    const id = ORIG.getImageData.call(ctx, 0, 0, c.width, c.height);
    applyCanvasNoise(id.data, profile.canvasSeed);
    ctx.putImageData(id, 0, 0);
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
    const noise = ((h % 200) - 100) / 1000; // ±0.1px, stable for same input
    return new Proxy(metrics, {
      get(target, prop) {
        if (prop === "width") return target.width + noise;
        const val = target[prop];
        return typeof val === "function" ? val.bind(target) : val;
      }
    });
  }, "measureText");

  // === WebGL fingerprint spoofing ===
  function spoofGlGetParameter(origFn) {
    return disguise(function(param) {
      if (param === 0x9245) return profile.gpu.vendor;
      if (param === 0x9246) return profile.gpu.renderer;
      return origFn.call(this, param);
    }, "getParameter");
  }
  if (ORIG.glGetParameter) {
    WebGLRenderingContext.prototype.getParameter = spoofGlGetParameter(ORIG.glGetParameter);
  }
  if (ORIG.gl2GetParameter) {
    WebGL2RenderingContext.prototype.getParameter = spoofGlGetParameter(ORIG.gl2GetParameter);
  }

  // === WebGL getSupportedExtensions spoofing ===
  // The extension list is highly specific to the real GPU. Normalize to
  // a common baseline set that matches the spoofed GPU vendor.
  const COMMON_WEBGL_EXTENSIONS = [
    "ANGLE_instanced_arrays", "EXT_blend_minmax", "EXT_color_buffer_half_float",
    "EXT_float_blend", "EXT_frag_depth", "EXT_shader_texture_lod",
    "EXT_texture_filter_anisotropic", "OES_element_index_uint",
    "OES_standard_derivatives", "OES_texture_float", "OES_texture_float_linear",
    "OES_texture_half_float", "OES_texture_half_float_linear",
    "OES_vertex_array_object", "WEBGL_color_buffer_float",
    "WEBGL_compressed_texture_s3tc", "WEBGL_debug_renderer_info",
    "WEBGL_depth_texture", "WEBGL_draw_buffers", "WEBGL_lose_context",
  ];
  const spoofedGetSupportedExtensions = disguise(function() {
    return [...COMMON_WEBGL_EXTENSIONS];
  }, "getSupportedExtensions");
  if (typeof WebGLRenderingContext !== "undefined") {
    WebGLRenderingContext.prototype.getSupportedExtensions = spoofedGetSupportedExtensions;
  }
  if (typeof WebGL2RenderingContext !== "undefined") {
    WebGL2RenderingContext.prototype.getSupportedExtensions = spoofedGetSupportedExtensions;
  }

  // === WebGL readPixels noise (v2 item 5) ===
  // FingerprintJS commercial uses readPixels to extract rendered framebuffer
  // data for GPU fingerprinting. Same pixelNoise pipeline as canvas 2D.
  // readPixels writes into caller-supplied ArrayBufferView (mutate in-place).
  function spoofGlReadPixels(origFn) {
    return disguise(function(x, y, w, h, format, type, pixels) {
      origFn.call(this, x, y, w, h, format, type, pixels);
      // Only noise RGBA/UNSIGNED_BYTE reads (the fingerprinting path).
      // Other format/type combos (FLOAT, HALF_FLOAT, depth, stencil) are
      // rendering-critical and not used for fingerprinting.
      if (pixels && format === 0x1908 /* RGBA */ && type === 0x1401 /* UNSIGNED_BYTE */) {
        applyCanvasNoise(pixels, profile.canvasSeed);
      }
    }, "readPixels");
  }
  if (ORIG.glReadPixels) {
    WebGLRenderingContext.prototype.readPixels = spoofGlReadPixels(ORIG.glReadPixels);
  }
  if (ORIG.gl2ReadPixels) {
    WebGL2RenderingContext.prototype.readPixels = spoofGlReadPixels(ORIG.gl2ReadPixels);
  }

  // === OffscreenCanvas noise (v2 item 5) ===
  // OffscreenCanvas is the main bypass for canvas fingerprinting defenses.
  // FingerprintJS, CreepJS, and commercial trackers use it because most
  // extensions only patch HTMLCanvasElement.
  if (typeof OffscreenCanvas !== "undefined") {
    // convertToBlob: OffscreenCanvas equivalent of toBlob.
    // Uses a temporary clone to avoid mutating the caller's canvas.
    // Without the clone, repeated convertToBlob calls would compound noise
    // and page JS could detect the mutation via getImageData before/after.
    OffscreenCanvas.prototype.convertToBlob = disguise(function(...args) {
      try {
        if (this.width > 0 && this.height > 0) {
          const ctx = this.getContext("2d");
          if (ctx) {
            const getImageData = ORIG.offscreenGetImageData || ctx.getImageData.bind(ctx);
            const id = getImageData.call(ctx, 0, 0, this.width, this.height);
            applyCanvasNoise(id.data, profile.canvasSeed);
            // Export from a temporary clone — never mutate the caller's canvas
            const tmp = new OffscreenCanvas(this.width, this.height);
            const tmpCtx = tmp.getContext("2d");
            tmpCtx.putImageData(id, 0, 0);
            return ORIG.offscreenConvertToBlob.apply(tmp, args);
          }
        }
      } catch(e) {}
      return ORIG.offscreenConvertToBlob.apply(this, args);
    }, "convertToBlob");

    // OffscreenCanvasRenderingContext2D.getImageData: same noise as 2D canvas.
    if (typeof OffscreenCanvasRenderingContext2D !== "undefined" && ORIG.offscreenGetImageData) {
      OffscreenCanvasRenderingContext2D.prototype.getImageData = disguise(function(...args) {
        const id = ORIG.offscreenGetImageData.apply(this, args);
        applyCanvasNoise(id.data, profile.canvasSeed);
        return id;
      }, "getImageData", 4);
    }
  }

  // === AudioContext fingerprint noise ===
  // Rowan pass 4 finding #5: deterministic per-sample noise.
  // Uses hash(audioSeed + channel + sampleIndex + sampleValue) for stability.
  //
  // Rowan pass 6 finding #3: getChannelData returns a live reference to the
  // underlying Float32Array. Mutating in-place means repeated reads compound
  // noise (each call re-noises already-noised data). Fix: track which
  // buffer+channel combos have been noised via WeakMap. Apply noise exactly
  // once per buffer+channel; subsequent reads return the already-noised buffer.
  if (ORIG.getChannelData) {
    const _noisedBuffers = new WeakMap();

    AudioBuffer.prototype.getChannelData = disguise(function(channel) {
      const data = ORIG.getChannelData.call(this, channel);

      // Only noise each buffer+channel once
      let noised = _noisedBuffers.get(this);
      if (!noised) { noised = new Set(); _noisedBuffers.set(this, noised); }
      if (noised.has(channel)) return data;
      noised.add(channel);

      const seed = profile.audioSeed ^ (channel * 0x9e3779b9);
      for (let i = 0; i < data.length; i++) {
        // Deterministic micro-noise from seed + position + quantized value
        let h = seed ^ (i * 2654435761);
        h = Math.imul(h ^ ((data[i] * 1e6) >>> 0), 0x45d9f3b);
        h = (h ^ (h >>> 16)) >>> 0;
        data[i] += ((h % 200) - 100) * 0.0000005; // ~±0.00005
      }
      return data;
    }, "getChannelData");
  }

  // === Sensor API defense (v1.1 item 3) ===
  // Desktop Chrome exposes DeviceMotion/Orientation events and Generic
  // Sensor API on convertible laptops with MEMS sensors (accelerometer,
  // gyroscope). Research: ETH Zurich demonstrated >94% cross-site
  // fingerprinting accuracy from motion data alone. JShelter proves the
  // prototype-override approach works in production.
  //
  // Strategy: override prototype getters to return null/zero values,
  // consistent with a standard desktop without sensor hardware.
  // Does NOT delete constructors (that changes API surface and is
  // itself a fingerprinting signal).

  // DeviceMotionEvent: null acceleration/rotationRate = no sensor hardware
  if (typeof DeviceMotionEvent !== "undefined") {
    spoof(DeviceMotionEvent.prototype, "acceleration", () => null);
    spoof(DeviceMotionEvent.prototype, "accelerationIncludingGravity", () => null);
    spoof(DeviceMotionEvent.prototype, "rotationRate", () => null);
    spoof(DeviceMotionEvent.prototype, "interval", () => 0);
  }

  // DeviceOrientationEvent: null alpha/beta/gamma = no sensor hardware
  if (typeof DeviceOrientationEvent !== "undefined") {
    spoof(DeviceOrientationEvent.prototype, "alpha", () => null);
    spoof(DeviceOrientationEvent.prototype, "beta", () => null);
    spoof(DeviceOrientationEvent.prototype, "gamma", () => null);
    spoof(DeviceOrientationEvent.prototype, "absolute", () => false);
  }

  // Generic Sensor API: override reading properties on all sensor prototypes.
  // Accelerometer, Gyroscope, etc. — x/y/z return null (no hardware).
  // AmbientLightSensor is behind an expired Chrome flag, included for completeness.
  const _sensorClasses = [
    "Accelerometer", "Gyroscope", "LinearAccelerationSensor",
    "AbsoluteOrientationSensor", "RelativeOrientationSensor",
    "GravitySensor", "Magnetometer", "AmbientLightSensor",
  ];
  const _sensorProps = ["x", "y", "z", "quaternion", "illuminance"];
  for (const cls of _sensorClasses) {
    if (typeof window[cls] !== "undefined") {
      for (const prop of _sensorProps) {
        spoof(window[cls].prototype, prop, () => null);
      }
    }
  }

  // === WebAudio near-ultrasonic attenuation (v1.1 item 4) ===
  // Intercepts AudioNode.connect() to insert a BiquadFilterNode (highshelf
  // at 17999 Hz, -70 dB) before any AudioDestinationNode. Attenuates
  // near-ultrasonic frequencies (17-20 kHz) used by cross-device tracking
  // beacons (SilverPush, USAT framework). Based on Silverdog/SilverWall
  // proven approach (PETS 2017). Does not affect audible audio (<17 kHz).
  //
  // Breakage risk: low. Near-ultrasonic frequencies are inaudible to most
  // adults. Affected niche uses: data-over-sound device pairing (Chirp.io,
  // Google Nearby — both deprecated), dog whistle apps, web audiometry.
  // These can be whitelisted per-site via the existing __pgd cookie.
  if (ORIG.audioConnect) {
    AudioNode.prototype.connect = disguise(function connect(destination, output, input) {
      // Insert ultrasonic filter before AudioDestinationNode (speakers)
      // AND before AnalyserNode (lux review: USAT trackers route
      // MediaElementSource → AnalyserNode to read ultrasonic frequencies
      // upstream of any destination filter).
      if (destination instanceof AudioDestinationNode ||
          destination instanceof AnalyserNode) {
        try {
          const ctx = this.context || destination.context;
          const filter = ctx.createBiquadFilter();
          filter.type = "highshelf";
          filter.frequency.value = 17999;
          filter.Q.value = 0;
          filter.gain.value = -70;
          // Preserve caller's output index; filter input is always 0
          ORIG.audioConnect.call(this, filter, output, 0);
          // Preserve caller's input index; filter output is always 0
          return ORIG.audioConnect.call(filter, destination, 0, input);
        } catch(e) {
          return ORIG.audioConnect.call(this, destination, output, input);
        }
      }
      return ORIG.audioConnect.call(this, destination, output, input);
    }, "connect", 1);
  }

  // === Behavioral biometric precision-reduction (v2 item 3) ===
  // Reduces precision of timing, coordinate, and scroll surfaces used by
  // behavioral biometric classifiers (ThreatMetrix, Trusteer, FingerprintJS
  // Pro). Does NOT synthesize a different human — raises classification cost
  // by adding deterministic noise. All noise derived from session seed.
  //
  // Surfaces: Event.timeStamp, performance.now(), MouseEvent coordinates,
  // WheelEvent deltas. Coordinate/wheel noise skipped for synthetic events
  // (isTrusted=false), editable/canvas/SVG targets, drag events, and
  // allowlisted high-interaction sites. Timestamp jitter applies to trusted
  // events only (synthetic events bypass); performance.now quantization
  // applies everywhere. Both are invisible to the user.

  // Allowlist: skip coordinate + wheel noise on high-interaction sites.
  const _bioCoordSkip = new Set([
    "docs.google.com", "sheets.google.com", "slides.google.com",
    "figma.com", "www.figma.com",
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

      let h = profile.canvasSeed ^ ((real * 1000) >>> 0);
      h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
      h = (h ^ (h >>> 16)) >>> 0;
      const jitter = ((h % 200) - 100) / 100; // ±1ms

      const result = real + jitter;
      _tsCache.set(this, result);
      return result;
    });
  }

  // --- performance.now() precision reduction ---
  // Quantize to 0.1ms. Conservative — does not break animations,
  // editors, or perf-sensitive apps (60fps = 16.67ms frames).
  const _origPerfNow = Performance.prototype.now;
  Performance.prototype.now = disguise(function() {
    return Math.round(_origPerfNow.call(this) * 10) / 10;
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

      // X-axis noise from hash(canvasSeed, clientX)
      let hx = profile.canvasSeed ^ Math.imul(rx | 0, 2654435761);
      hx = Math.imul(hx ^ (hx >>> 16), 0x45d9f3b);
      hx = (hx ^ (hx >>> 16)) >>> 0;

      // Y-axis noise from hash(canvasSeed ^ golden_ratio, clientY)
      let hy = (profile.canvasSeed ^ 0x9e3779b9) ^ Math.imul(ry | 0, 2654435761);
      hy = Math.imul(hy ^ (hy >>> 16), 0x45d9f3b);
      hy = (hy ^ (hy >>> 16)) >>> 0;

      // 50% no change, 25% +1, 25% -1
      cached = {
        nx: (hx & 3) === 0 ? 1 : (hx & 3) === 1 ? -1 : 0,
        ny: (hy & 3) === 0 ? 1 : (hy & 3) === 1 ? -1 : 0,
      };
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

  // === Timezone spoofing (DST-aware) ===
  ORIG.DateTimeFormat.prototype.resolvedOptions = disguise(function() {
    const opts = ORIG.resolvedOptions.call(this);
    opts.timeZone = profile.timezone;
    return opts;
  }, "resolvedOptions");

  const tzProxy = new Proxy(ORIG.DateTimeFormat, {
    construct(target, args) {
      if (args[1]) { args[1].timeZone = profile.timezone; }
      else { args[1] = { timeZone: profile.timezone }; }
      return new target(...args);
    },
    apply(target, thisArg, args) {
      if (args[1]) { args[1].timeZone = profile.timezone; }
      else { args[1] = { timeZone: profile.timezone }; }
      return target.apply(thisArg, args);
    }
  });
  try {
    ORIG.defineProperty.call(Object, Intl, "DateTimeFormat", {
      value: tzProxy, writable: true, configurable: true,
    });
  } catch(e) {}

  Date.prototype.getTimezoneOffset = disguise(function() {
    return currentTzOffset;
  }, "getTimezoneOffset");

  // === WebRTC ===
  // v2 item 10: Chrome privacy API sets webRTCIPHandlingPolicy to
  // default_public_interface_only (background.js). This prevents ICE
  // candidates from exposing private/local IPs without forcing relay-only
  // (which is detectable and breaks apps without TURN — rowan pass 4
  // finding #6). No MAIN-world RTCPeerConnection override needed.

  // === enumerateDevices spoofing (v2 item 11) ===
  // Returns a stable, low-entropy device list: one audioinput, one
  // audiooutput, one videoinput. Device IDs are deterministic hex strings
  // derived from the session seed. Labels are empty (matches browser
  // behavior before getUserMedia permission is granted). groupId is shared
  // across all devices (single-device-group, common on laptops).
  if (typeof navigator !== 'undefined' && navigator.mediaDevices &&
      typeof navigator.mediaDevices.enumerateDevices === 'function') {
    const _origEnumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);

    // Deterministic device ID: 64-char hex from seed + kind string
    function makeDeviceId(seed, kind) {
      const rng = mulberry32(seed ^ hashStr(kind));
      let hex = '';
      for (let i = 0; i < 16; i++) {
        hex += ((rng() * 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
      }
      return hex.slice(0, 64);
    }

    function hashStr(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      }
      return h;
    }

    const groupId = makeDeviceId(sessionSeed, 'group');
    const spoofedDevices = [
      { kind: 'audioinput',  deviceId: makeDeviceId(sessionSeed, 'audioinput'),  groupId: groupId, label: '' },
      { kind: 'audiooutput', deviceId: makeDeviceId(sessionSeed, 'audiooutput'), groupId: groupId, label: '' },
      { kind: 'videoinput',  deviceId: makeDeviceId(sessionSeed, 'videoinput'),  groupId: groupId, label: '' },
    ];

    // Freeze entries to match native MediaDeviceInfo immutability
    const frozenDevices = spoofedDevices.map(d => Object.freeze(d));
    Object.freeze(frozenDevices);

    navigator.mediaDevices.enumerateDevices = disguise(function enumerateDevices() {
      return ORIG.promiseResolve.call(Promise, frozenDevices.slice());
    }, 'enumerateDevices', 0);
  }

  // === Worker navigator override script ===
  // Shared by Worker, Module Worker, and SharedWorker wrappers below.
  // Hoisted here so it's in scope for all three constructor intercepts.
  const workerOverrides = `
    Object.defineProperty(self.navigator.__proto__, "userAgent", { get: () => ${JSON.stringify(profile.userAgent)} });
    Object.defineProperty(self.navigator.__proto__, "platform", { get: () => ${JSON.stringify(profile.platform)} });
    Object.defineProperty(self.navigator.__proto__, "hardwareConcurrency", { get: () => ${profile.hardwareConcurrency} });
    Object.defineProperty(self.navigator.__proto__, "deviceMemory", { get: () => ${profile.deviceMemory} });
    Object.defineProperty(self.navigator.__proto__, "language", { get: () => ${JSON.stringify(profile.languages[0])} });
    Object.defineProperty(self.navigator.__proto__, "languages", { get: () => Object.freeze(${JSON.stringify(profile.languages)}) });
    Object.defineProperty(self.navigator.__proto__, "appVersion", { get: () => ${JSON.stringify(profile.userAgent.replace("Mozilla/", ""))} });
  `;

  // === Web Worker scope leak prevention ===
  // Workers run in a separate global scope with unspoofed navigator.
  // Intercept Worker constructor to inject a wrapper that overrides
  // navigator properties inside the worker.
  if (typeof Worker !== "undefined") {
    const OrigWorker = Worker;

    window.Worker = disguise(function(url, opts) {
      const isModule = opts && opts.type === "module";
      try {
        const origUrl = new URL(url, location.href).href;
        if (isModule) {
          // Module workers: can't use importScripts(). Prepend overrides,
          // then re-import the original script via dynamic import().
          // Blob URLs have opaque origins, so static `import "..."` with
          // relative paths would break. Dynamic import() with an absolute
          // URL works because it resolves against the network, not the blob origin.
          const blob = new Blob(
            [workerOverrides + `;\nawait import(${JSON.stringify(origUrl)});`],
            { type: "application/javascript" }
          );
          return new OrigWorker(URL.createObjectURL(blob), { ...opts, type: "module" });
        } else {
          // Classic workers: prepend overrides, importScripts the original
          const blob = new Blob(
            [workerOverrides + `;\nimportScripts(${JSON.stringify(origUrl)});`],
            { type: "application/javascript" }
          );
          return new OrigWorker(URL.createObjectURL(blob), opts);
        }
      } catch(e) {
        // Fallback: if Blob approach fails, use original unspoofed
        return new OrigWorker(url, opts);
      }
    }, "Worker", 1);
    window.Worker.prototype = OrigWorker.prototype;
  }

  // === SharedWorker scope leak prevention ===
  // SharedWorkers share a single global scope across tabs. Intercept
  // the constructor to inject navigator overrides the same way.
  if (typeof SharedWorker !== "undefined") {
    const OrigSharedWorker = SharedWorker;
    window.SharedWorker = disguise(function(url, nameOrOpts) {
      try {
        const origUrl = new URL(url, location.href).href;
        // SharedWorkers are always classic (no module support in most browsers).
        // Use importScripts to load the original script after overrides.
        const blob = new Blob(
          [workerOverrides + `;\nimportScripts(${JSON.stringify(origUrl)});`],
          { type: "application/javascript" }
        );
        return new OrigSharedWorker(URL.createObjectURL(blob), nameOrOpts);
      } catch(e) {
        return new OrigSharedWorker(url, nameOrOpts);
      }
    }, "SharedWorker", 1);
    window.SharedWorker.prototype = OrigSharedWorker.prototype;
  }

  // === NO postMessage, NO message listener ===
  // The seed is NOT broadcast via postMessage (lux review: any tracker
  // script could listen for it and use it as a tracking identifier).
  // Instead, bridge.js reads sessionStorage.__pg_seed__ directly — the
  // ISOLATED world shares sessionStorage with the MAIN world.
  // Overrides are immutable for the lifetime of the page.
  // Rotation = background.js clears sessionStorage seed + reloads tabs.
  // Disable = background.js sets cookie __pgd via chrome.scripting.
  //
  // Known detection surfaces (v2):
  // - sessionStorage.__pg_seed__ readable by same-origin page JS
  // - document.cookie __pgd readable by page JS (JS cookies can't be httpOnly)
  // - Classic + Module Workers: navigator spoofed via blob wrapper
  // - SharedWorker: navigator spoofed via blob wrapper
  // - ServiceWorker: NOT covered (registered via navigator.serviceWorker.register,
  //   runs in a separate registration scope that content scripts cannot intercept)
  // - Worklets (AudioWorklet, PaintWorklet): NOT covered (lowest priority).
  //   AudioWorklet processors are also exempt from ultrasonic filtering
  //   (they run in a separate thread, not patchable from content script).
  // - matchMedia: full evaluator for dimension/resolution/interaction
  //   features. Preference features (prefers-color-scheme, etc.) pass
  //   through to real matchMedia to avoid breaking dark mode / a11y.
  // - Module Worker caveat: blob URLs have opaque origins. Dynamic import()
  //   of the original script URL works for same-origin scripts but will fail
  //   for cross-origin worker scripts that don't serve CORS headers.
  // - Worker blob: URL detection (lux review): self.location.href inside a
  //   wrapped worker returns blob:https://... instead of the original script
  //   URL. Sophisticated trackers (FingerprintJS) could inspect self.location
  //   to detect dynamic wrapping. Phase 2 consideration.
  // - Sensor API: DeviceMotion/Orientation events and Generic Sensor API
  //   (Accelerometer, Gyroscope, etc.) return null readings, matching a
  //   standard desktop without MEMS sensors. Convertible laptop hardware
  //   (Surface Pro) is masked. API constructors preserved (removal is itself
  //   a fingerprinting signal).
  // - WebAudio ultrasonic: BiquadFilterNode highshelf at 17999 Hz / -70 dB
  //   inserted before AudioDestinationNode AND AnalyserNode. Attenuates
  //   UXDT cross-device beacons (18-20 kHz) and prevents upstream FFT
  //   analysis of ultrasonic content. AudioWorklet-based processing is
  //   NOT covered. MediaStreamAudioDestinationNode is NOT covered (used
  //   for recording/WebRTC output, not speaker output — documented bypass).
  //   Per-site bypass via __pgd cookie for legitimate near-ultrasonic use.
  // - Behavioral biometrics (v2 item 3): precision-reduction layer.
  //   Event.timeStamp: ±1ms deterministic jitter, bounded (>2ms apart cannot
  //   invert), stable re-reads via WeakMap. Synthetic events (isTrusted=false)
  //   bypass jitter — modifying constructor-controlled values is a detection
  //   oracle.
  //   performance.now(): 0.1ms quantization (10x coarser than Chrome default).
  //   MouseEvent clientX/Y/screenX/Y/pageX/Y/x/y: ±0-1px per-axis noise
  //   (all x-props share one noise, all y-props share another — preserves
  //   pageX-clientX=scrollX invariant). Skipped on synthetic events, editable
  //   elements, canvas, SVG, drag events, and allowlisted sites (Google Docs,
  //   Figma). WheelEvent deltaY/X: integer quantization removes sub-pixel
  //   trackpad precision, same skip contract as MouseEvent. This is precision
  //   reduction, NOT biometric spoofing — raises classifier cost, does not
  //   synthesize a different human.
  // - OffscreenCanvas (v2 item 5): convertToBlob and getImageData apply
  //   same pixelNoise pipeline as HTMLCanvasElement. convertToBlob exports
  //   from a temporary OffscreenCanvas clone — the caller's canvas is never
  //   mutated, preventing noise compounding on repeated calls and
  //   before/after detection via getImageData. 2D context path only; if
  //   the OffscreenCanvas has a WebGL context, getContext("2d") returns
  //   null and the wrapper falls through to the original unnoised export.
  //   WebGL-rendered OffscreenCanvas exports are covered by the readPixels
  //   override (same prototype chain) but NOT by convertToBlob.
  // - WebGL readPixels (v2 item 5): RGBA/UNSIGNED_BYTE reads get pixelNoise
  //   applied in-place. Other format/type combos (FLOAT, HALF_FLOAT, depth,
  //   stencil) are rendering-critical and pass through unmodified. Covers
  //   both WebGLRenderingContext and WebGL2RenderingContext.
  // - toString/descriptor hardening (v2 item 6): WeakMap-based
  //   Function.prototype.toString override. Disguised functions have no own
  //   toString property (defeats hasOwnProperty detection). Getter names
  //   set to "get propName" format. GOPD/GOPDs/Reflect.GOPD normalize
  //   descriptor flags against pristine baselines via _spoofedProps registry.
  //   Wrapper function.length preserved to match native arity.
  //
  // - Global Privacy Control (v2 item 7): navigator.globalPrivacyControl
  //   returns true via hardened spoof() path. Sec-GPC: 1 header added as
  //   static DNR rule (rule ID 3). Header/JS parity guaranteed — both
  //   surfaces always advertise GPC.
  //
  // - Query string stripping (v2 item 8): static DNR redirect rule (ID 4)
  //   strips 17 tracking params (utm_*, fbclid, gclid, dclid, msclkid,
  //   yclid, twclid, mc_eid, _ga, _gl, wbraid, gbraid) via
  //   queryTransform.removeParams. Main-frame + sub-frame only.
  //
  // - Cross-origin referrer trimming (v2 item 9): static DNR rule (ID 5)
  //   sets Referrer-Policy: origin-when-cross-origin on all responses.
  //   Combined with pre-existing rule 1 (Referer removal for domainType
  //   thirdParty sub-requests), the effective policy is:
  //     Main-frame cross-origin → origin-only Referer
  //     Same-domain cross-origin (different port/scheme) → origin-only Referer
  //     Third-party sub-resources (different eTLD+1) → no Referer (rule 1)
  //     Same-origin → full path+query preserved
  //   JS belt-and-suspenders: document.referrer spoofed to origin-only
  //   for cross-origin, full path preserved for same-origin.
  // - WebRTC IP leak prevention (v2 item 10): background.js sets
  //   chrome.privacy.network.webRTCIPHandlingPolicy to
  //   default_public_interface_only. No MAIN-world override needed.
  // - enumerateDevices spoofing (v2 item 11): overrides
  //   navigator.mediaDevices.enumerateDevices() to return a stable,
  //   low-entropy device list (1 audioinput, 1 audiooutput, 1 videoinput).
  //   Device IDs are deterministic hex from session seed. Labels empty
  //   (matches pre-permission browser behavior).

})();
