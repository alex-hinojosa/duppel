/**
 * PhantomGrid — Anti-Fingerprint Core Module
 * Creates an immutable context object with all shared state.
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

export function createContext() {
  // === Disable check (synchronous, before any overrides) ===
  // Uses a cookie instead of localStorage to avoid extension-detection
  // leaks (rowan pass 3: page JS could read localStorage.__pg_off__
  // to detect PhantomGrid). The cookie key is intentionally generic.
  try {
    if (document.cookie.split(";").some(c => c.trim().startsWith("__pgd=1"))) return null;
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
    freeze: Object.freeze,
  };
  if (typeof WebGLRenderingContext !== "undefined") {
    ORIG.glGetParameter = WebGLRenderingContext.prototype.getParameter;
    ORIG.glReadPixels = WebGLRenderingContext.prototype.readPixels;
    ORIG.glGetShaderPrecisionFormat = WebGLRenderingContext.prototype.getShaderPrecisionFormat;
    ORIG.glGetExtension = WebGLRenderingContext.prototype.getExtension;
    ORIG.glGetSupportedExtensions = WebGLRenderingContext.prototype.getSupportedExtensions;
  }
  if (typeof WebGL2RenderingContext !== "undefined") {
    ORIG.gl2GetParameter = WebGL2RenderingContext.prototype.getParameter;
    ORIG.gl2ReadPixels = WebGL2RenderingContext.prototype.readPixels;
    ORIG.gl2GetShaderPrecisionFormat = WebGL2RenderingContext.prototype.getShaderPrecisionFormat;
    ORIG.gl2GetExtension = WebGL2RenderingContext.prototype.getExtension;
    ORIG.gl2GetSupportedExtensions = WebGL2RenderingContext.prototype.getSupportedExtensions;
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

  // === Host browser detection (v3 item 4a) ===
  // Detect BEFORE any spoofing. Used to filter UA_GROUPS to same-engine
  // profiles only — prevents cross-engine contradiction fingerprints
  // (e.g., Chrome TLS + Firefox UA, ANGLE WebGL + native GL strings).
  const _realUA = navigator.userAgent;
  const _isFirefox = /Firefox\//.test(_realUA);
  const _isEdge = /Edg\//.test(_realUA);
  // Chrome, Edge, Opera, Brave all share Chromium engine (ANGLE WebGL, Client Hints)
  const _isChromium = !_isFirefox && /Chrome\//.test(_realUA);

  // === Plausible profile combos (correlated GPU/UA groups) ===
  const UA_GROUPS = [
    {
      engine: "chromium",
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
      engine: "chromium",
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
      engine: "firefox",
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
      engine: "firefox",
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
      engine: "chromium",
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
      engine: "chromium",
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

  // Filter UA_GROUPS to same-engine profiles (v3 item 4a).
  // Chromium hosts get chromium profiles (Chrome + Edge + Linux Chrome).
  // Firefox hosts get firefox profiles only. Prevents TLS/rendering
  // contradiction fingerprints.
  const _hostEngine = _isFirefox ? "firefox" : "chromium";
  const UA_GROUPS_FILTERED = UA_GROUPS.filter(g => g.engine === _hostEngine);

  function generateProfile(seed) {
    const rng = mulberry32(seed);
    const group = pickFrom(UA_GROUPS_FILTERED.length > 0 ? UA_GROUPS_FILTERED : UA_GROUPS, rng);
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
  // Background.js pre-injects the session seed via chrome.tabs.onUpdated +
  // injectImmediately (Item 2). If the pre-injection won the race, __pg_seed__
  // is already set below. If not (race lost or first-ever cold start), a random
  // seed is generated — bridge.js detects the desync and background silently
  // corrects sessionStorage for future same-origin navigations (no reload).
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
  const bioSeed = (profile.canvasSeed ^ 0x42494F4D) >>> 0; // biometric noise seed

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

  return {
    ORIG,
    profile,
    bioSeed,
    sessionSeed,
    currentTzOffset,
    spoof,
    disguise,
    mulberry32,
    _nativeStrings,
    _spoofedProps,
  };
}
