/**
 * Duppel — Anti-Fingerprint Core Module
 * Creates an immutable context object with all shared state.
 *
 * Architecture (Round 6, 2026-05-21 — closure-local bootstrap):
 * - One-way immutable bootstrap. Seed passed as parameter from
 *   bootstrapAntiFingerprint(seed), which is injected by background.js
 *   via chrome.scripting.executeScript({ func, args }). Zero window
 *   rendezvous — the seed is a closure-local function argument.
 *   No cookie channel, no window properties, no setter traps.
 * - Original function references saved BEFORE wrapping — prevents wrapper
 *   stacking on any future re-application.
 * - Rotation = background.js updates STATE.tabSeeds + reloads tabs.
 *   Each tab gets bootstrap via executeScript on reload.
 * - Cross-origin iframes get no spoofing (different security origin).
 *   Same-origin iframes share prototypes with the top frame.
 *   Tab-scoped DNR ensures HTTP UA coherence per tab.
 * - Per-site disable via cookie (__pgd). Set by background.js via
 *   chrome.scripting.executeScript in MAIN world before reload;
 *   checked synchronously in bootstrap-entry.js.
 */

export function createContext(sessionSeed) {
  // Disable check runs in the bootstrap entry before createContext is called.
  // createContext is only called with a validated seed.

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
    promiseReject: Promise.reject,
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

  // Host OS detection (v0.1.1 C3 — persona-family filter, Spec Section 2.3).
  // Parse the REAL UA string (captured above, before any spoofing).
  // MAIN world cannot use navigator.userAgentData reliably after spoofing.
  let _hostOS = "windows"; // fail-safe default
  if (/Windows/.test(_realUA)) _hostOS = "windows";
  else if (/Macintosh|Mac OS X/.test(_realUA)) _hostOS = "macos";
  else if (/Linux|CrOS/.test(_realUA)) _hostOS = "linux";

  // === Plausible profile combos (correlated GPU/UA groups) ===
  const UA_GROUPS = [
    {
      engine: "chromium",
      os: "windows",
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
      os: "macos",
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
      os: "windows",
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
      os: "macos",
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
      os: "windows",
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
      os: "linux",
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
  const MEMORY = [4, 8]; // Chrome clamps navigator.deviceMemory to max 8; >8 is an impossible-value tell. Keep in sync with profiles.js.
  const COLOR_DEPTHS = [24]; // Modern Chrome reports 24 ~universally; 32 is a legacy tell. Keep in sync with profiles.js.
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

  // Engine + OS filtered pool (v0.1.1 C3 — Spec Section 2.3).
  // Prevents cross-family personas (e.g., Linux persona on Windows host).
  // Mirrors profiles.js UA_GROUPS_FILTERED exactly.
  const _hostEngine = _isFirefox ? "firefox" : "chromium";
  const UA_GROUPS_FILTERED = UA_GROUPS.filter(g => g.engine === _hostEngine && g.os === _hostOS);

  // Returns null if no groups match (fail-closed per Spec Section 2.3).
  function generateProfile(seed) {
    if (UA_GROUPS_FILTERED.length === 0) return null;
    const rng = mulberry32(seed);
    const group = pickFrom(UA_GROUPS_FILTERED, rng);
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

  // === Session seed — passed from bootstrap-entry.js ===
  // The bootstrap function receives the seed as a closure-local parameter
  // via chrome.scripting.executeScript({ func, args }). createContext
  // receives the validated seed. No window interaction here.
  const profile = generateProfile(sessionSeed);
  if (!profile) return null; // Fail-closed: no matching persona family (C3)

  // Mutable state — exposed via ctx.state so closures in installMisc/
  // installBiometric read current values at call time, not stale
  // destructured primitives (rowan P0 R2 finding #3).
  // sessionSeed included so enumerateDevices computes device IDs at
  // call time (rowan P0 R3 finding #2: stale deviceSpecs fix).
  const state = {
    sessionSeed: sessionSeed,
    bioSeed: (profile.canvasSeed ^ 0x42494F4D) >>> 0,
    currentTzOffset: getTimezoneOffset(profile.timezone),
  };

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
    state,
    spoof,
    disguise,
    mulberry32,
    _nativeStrings,
    _spoofedProps,
  };
}
