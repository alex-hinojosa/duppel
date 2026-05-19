// @generated — built from src/content/anti-fingerprint/ by esbuild. DO NOT EDIT.
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/content/anti-fingerprint/core.js
  function createContext() {
    try {
      if (document.cookie.split(";").some((c) => c.trim().startsWith("__pgd=1"))) return null;
    } catch (e) {
    }
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
      freeze: Object.freeze
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
    const _realUA = navigator.userAgent;
    const _isFirefox = /Firefox\//.test(_realUA);
    const _isEdge = /Edg\//.test(_realUA);
    const _isChromium = !_isFirefox && /Chrome\//.test(_realUA);
    const UA_GROUPS = [
      {
        engine: "chromium",
        uas: [
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
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
          { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) HD Graphics 620, OpenGL 4.5)" }
        ]
      },
      {
        engine: "chromium",
        uas: [
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
        ],
        platform: "MacIntel",
        gpus: [
          { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M1, OpenGL 4.1)" },
          { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M2, OpenGL 4.1)" },
          { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Plus Graphics, OpenGL 4.1)" }
        ]
      },
      {
        engine: "firefox",
        uas: [
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0"
        ],
        platform: "Win32",
        gpus: [
          { vendor: "Intel", renderer: "Intel(R) UHD Graphics 630" },
          { vendor: "NVIDIA Corporation", renderer: "NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2" },
          { vendor: "NVIDIA Corporation", renderer: "NVIDIA GeForce RTX 3060/PCIe/SSE2" },
          { vendor: "ATI Technologies Inc.", renderer: "AMD Radeon RX 580" },
          { vendor: "Intel", renderer: "Intel(R) Iris(R) Xe Graphics" }
        ]
      },
      {
        engine: "firefox",
        uas: [
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0"
        ],
        platform: "MacIntel",
        gpus: [
          { vendor: "Apple", renderer: "Apple M1" },
          { vendor: "Apple", renderer: "Apple M2" },
          { vendor: "Intel Inc.", renderer: "Intel(R) Iris(R) Plus Graphics" }
        ]
      },
      {
        engine: "chromium",
        uas: [
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0"
        ],
        platform: "Win32",
        gpus: [
          { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)" },
          { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)" },
          { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, OpenGL 4.5)" },
          { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.5)" }
        ]
      },
      {
        engine: "chromium",
        uas: [
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
        ],
        platform: "Linux x86_64",
        gpus: [
          { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)" },
          { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB, OpenGL 4.5)" },
          { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)" }
        ]
      }
    ];
    const SCREENS = [
      { width: 1920, height: 1080, avail: 1040 },
      { width: 2560, height: 1440, avail: 1400 },
      { width: 1366, height: 768, avail: 728 },
      { width: 1536, height: 864, avail: 824 },
      { width: 1440, height: 900, avail: 860 },
      { width: 1680, height: 1050, avail: 1010 },
      { width: 3840, height: 2160, avail: 2120 },
      { width: 1280, height: 720, avail: 680 },
      { width: 1600, height: 900, avail: 860 }
    ];
    const CORES = [2, 4, 6, 8, 10, 12, 16];
    const MEMORY = [4, 8, 8, 8, 16, 16, 32];
    const COLOR_DEPTHS = [24, 24, 24, 32];
    const LANGUAGES = [
      ["en-US", "en"],
      ["en-US", "en", "es"],
      ["en-GB", "en"],
      ["en-US"],
      ["en-US", "en", "fr"],
      ["en-US", "en", "de"]
    ];
    const TIMEZONES = [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Phoenix",
      "Europe/London",
      "Europe/Berlin",
      "America/Toronto"
    ];
    function mulberry32(seed) {
      return function() {
        seed |= 0;
        seed = seed + 1831565813 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    __name(mulberry32, "mulberry32");
    function pickFrom(arr, rng) {
      return arr[Math.floor(rng() * arr.length)];
    }
    __name(pickFrom, "pickFrom");
    const _hostEngine = _isFirefox ? "firefox" : "chromium";
    const UA_GROUPS_FILTERED = UA_GROUPS.filter((g) => g.engine === _hostEngine);
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
        gpu,
        languages: pickFrom(LANGUAGES, rng),
        timezone: pickFrom(TIMEZONES, rng),
        canvasSeed: rng() * 4294967295 >>> 0,
        audioSeed: rng() * 4294967295 >>> 0
      };
    }
    __name(generateProfile, "generateProfile");
    function getTimezoneOffset(tz) {
      try {
        const now = /* @__PURE__ */ new Date();
        const fmt = new ORIG.DateTimeFormat("en-US", {
          timeZone: tz,
          timeZoneName: "shortOffset"
        });
        const parts = fmt.formatToParts(now);
        const tzPart = parts.find((p) => p.type === "timeZoneName");
        if (tzPart) {
          const match = tzPart.value.match(/GMT([+-]?\d+)?(?::(\d+))?/);
          if (match) {
            const hours = parseInt(match[1] || "0", 10);
            const minutes = parseInt(match[2] || "0", 10);
            return -(hours * 60 + (hours < 0 ? -minutes : minutes));
          }
        }
      } catch (e) {
      }
      const fallback = {
        "America/New_York": 300,
        "America/Chicago": 360,
        "America/Denver": 420,
        "America/Los_Angeles": 480,
        "America/Phoenix": 420,
        "Europe/London": 0,
        "Europe/Berlin": -60,
        "America/Toronto": 300
      };
      return fallback[tz] || 300;
    }
    __name(getTimezoneOffset, "getTimezoneOffset");
    let sessionSeed;
    try {
      if (window !== window.top) {
        try {
          const parentSeed = window.top.sessionStorage.getItem("__pg_seed__");
          if (parentSeed) sessionSeed = parseInt(parentSeed, 10);
        } catch (e) {
        }
      }
      if (!sessionSeed) {
        const stored = sessionStorage.getItem("__pg_seed__");
        if (stored) {
          sessionSeed = parseInt(stored, 10);
        } else {
          sessionSeed = Date.now() ^ crypto.getRandomValues(new Uint32Array(1))[0];
          sessionStorage.setItem("__pg_seed__", String(sessionSeed));
        }
      }
    } catch (e) {
      sessionSeed = Date.now() ^ crypto.getRandomValues(new Uint32Array(1))[0];
    }
    const profile = generateProfile(sessionSeed);
    const bioSeed = (profile.canvasSeed ^ 1112100685) >>> 0;
    function convergeToSeed(correctSeed) {
      if (correctSeed === sessionSeed) return false;
      sessionSeed = correctSeed;
      const newProfile = generateProfile(correctSeed);
      for (const key of Object.keys(newProfile)) {
        profile[key] = newProfile[key];
      }
      return true;
    }
    __name(convergeToSeed, "convergeToSeed");
    const currentTzOffset = getTimezoneOffset(profile.timezone);
    const _nativeStrings = /* @__PURE__ */ new WeakMap();
    const _spoofedProps = /* @__PURE__ */ new WeakMap();
    ORIG.defineProperty.call(Object, Function.prototype, "toString", {
      value: /* @__PURE__ */ __name(function toString() {
        const fake = _nativeStrings.get(this);
        if (fake !== void 0) return fake;
        return ORIG.fnToString.call(this);
      }, "toString"),
      writable: true,
      configurable: true,
      enumerable: false
    });
    _nativeStrings.set(Function.prototype.toString, "function toString() { [native code] }");
    function disguise(fn, name, expectedLength) {
      _nativeStrings.set(fn, `function ${name}() { [native code] }`);
      try {
        ORIG.defineProperty.call(Object, fn, "name", {
          value: name,
          configurable: true
        });
        ORIG.defineProperty.call(Object, fn, "length", {
          value: expectedLength !== void 0 ? expectedLength : fn.length,
          configurable: true
        });
      } catch (e) {
      }
      return fn;
    }
    __name(disguise, "disguise");
    function spoof(obj, prop, getter) {
      try {
        const origDesc = ORIG.getOwnPropertyDescriptor.call(Object, obj, prop);
        if (!_spoofedProps.has(obj)) _spoofedProps.set(obj, /* @__PURE__ */ new Map());
        _spoofedProps.get(obj).set(prop, origDesc || null);
        _nativeStrings.set(getter, `function get ${prop}() { [native code] }`);
        try {
          ORIG.defineProperty.call(Object, getter, "name", {
            value: "get " + prop,
            configurable: true
          });
        } catch (e) {
        }
        const configurable = origDesc ? origDesc.configurable !== false : true;
        const enumerable = origDesc ? origDesc.enumerable !== false : true;
        ORIG.defineProperty.call(Object, obj, prop, {
          get: getter,
          configurable,
          enumerable
        });
      } catch (e) {
      }
    }
    __name(spoof, "spoof");
    Object.getOwnPropertyDescriptor = disguise(/* @__PURE__ */ __name(function getOwnPropertyDescriptor(obj, prop) {
      const desc = ORIG.getOwnPropertyDescriptor.call(Object, obj, prop);
      if (!desc || !desc.get) return desc;
      const spoofed = _spoofedProps.get(obj);
      if (spoofed && spoofed.has(prop)) {
        const pristine = spoofed.get(prop);
        if (pristine) {
          desc.configurable = pristine.configurable;
          desc.enumerable = pristine.enumerable;
        }
      }
      return desc;
    }, "getOwnPropertyDescriptor"), "getOwnPropertyDescriptor");
    Object.getOwnPropertyDescriptors = disguise(/* @__PURE__ */ __name(function getOwnPropertyDescriptors(obj) {
      const descs = ORIG.getOwnPropertyDescriptors.call(Object, obj);
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
    }, "getOwnPropertyDescriptors"), "getOwnPropertyDescriptors");
    if (ORIG.reflectGOPD) {
      Reflect.getOwnPropertyDescriptor = disguise(/* @__PURE__ */ __name(function getOwnPropertyDescriptor(target, prop) {
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
      }, "getOwnPropertyDescriptor"), "getOwnPropertyDescriptor");
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
      convergeToSeed
    };
  }
  var init_core = __esm({
    "src/content/anti-fingerprint/core.js"() {
      __name(createContext, "createContext");
    }
  });

  // src/content/anti-fingerprint/navigator.js
  function installNavigator(ctx) {
    const { ORIG, profile, spoof, disguise } = ctx;
    spoof(Navigator.prototype, "userAgent", () => profile.userAgent);
    spoof(Navigator.prototype, "platform", () => profile.platform);
    spoof(Navigator.prototype, "hardwareConcurrency", () => profile.hardwareConcurrency);
    spoof(Navigator.prototype, "deviceMemory", () => profile.deviceMemory);
    spoof(Navigator.prototype, "languages", () => Object.freeze([...profile.languages]));
    spoof(Navigator.prototype, "language", () => profile.languages[0]);
    spoof(Navigator.prototype, "webdriver", () => false);
    spoof(Navigator.prototype, "vendor", () => profile.userAgent.includes("Firefox") ? "" : "Google Inc.");
    spoof(Navigator.prototype, "appVersion", () => profile.userAgent.replace("Mozilla/", ""));
    spoof(Navigator.prototype, "maxTouchPoints", () => 0);
    spoof(Navigator.prototype, "globalPrivacyControl", () => true);
    const _origReferrer = document.referrer;
    spoof(Document.prototype, "referrer", () => {
      if (!_origReferrer) return "";
      try {
        const refOrigin = new URL(_origReferrer).origin;
        const curOrigin = location.origin;
        if (refOrigin === curOrigin) return _origReferrer;
        return refOrigin + "/";
      } catch (e) {
        return _origReferrer;
      }
    });
    try {
      if (navigator.connection) {
        spoof(Navigator.prototype, "connection", () => void 0);
      }
    } catch (e) {
    }
    const chromeMatch = profile.userAgent.match(/Chrome\/(\d+)/);
    const edgeMatch = profile.userAgent.match(/Edg\/(\d+)/);
    if (chromeMatch && typeof NavigatorUAData !== "undefined") {
      const chromeVer = chromeMatch[1];
      const isEdge = !!edgeMatch;
      const brands = isEdge ? [{ brand: "Microsoft Edge", version: edgeMatch[1] }, { brand: "Chromium", version: chromeVer }, { brand: "Not.A/Brand", version: "8" }] : [{ brand: "Google Chrome", version: chromeVer }, { brand: "Chromium", version: chromeVer }, { brand: "Not.A/Brand", version: "8" }];
      const isMac = profile.platform === "MacIntel";
      const isLinux = profile.platform.startsWith("Linux");
      const uaPlatform = isMac ? "macOS" : isLinux ? "Linux" : "Windows";
      const isAppleSilicon = profile.gpu.renderer.includes("Apple M");
      const arch = isAppleSilicon ? "arm" : "x86";
      const fakeUAData = {
        brands,
        mobile: false,
        platform: uaPlatform,
        toJSON() {
          return { brands: this.brands, mobile: this.mobile, platform: this.platform };
        },
        getHighEntropyValues() {
          return Promise.resolve({
            brands,
            mobile: false,
            platform: uaPlatform,
            platformVersion: isMac ? "15.5.0" : isLinux ? "6.8.0" : "15.0.0",
            architecture: arch,
            bitness: "64",
            model: "",
            uaFullVersion: `${chromeVer}.0.0.0`,
            fullVersionList: brands.map((b) => ({ brand: b.brand, version: `${b.version}.0.0.0` })),
            wow64: false
          });
        }
      };
      disguise(fakeUAData.getHighEntropyValues, "getHighEntropyValues");
      disguise(fakeUAData.toJSON, "toJSON");
      spoof(Navigator.prototype, "userAgentData", () => fakeUAData);
    }
    if (profile.userAgent.includes("Firefox") && !chromeMatch) {
      spoof(Navigator.prototype, "userAgentData", () => void 0);
    }
  }
  var init_navigator = __esm({
    "src/content/anti-fingerprint/navigator.js"() {
      __name(installNavigator, "installNavigator");
    }
  });

  // src/content/anti-fingerprint/screen.js
  function installScreen(ctx) {
    const { ORIG, profile, spoof, disguise, mulberry32 } = ctx;
    spoof(Screen.prototype, "width", () => profile.screen.width);
    spoof(Screen.prototype, "height", () => profile.screen.height);
    spoof(Screen.prototype, "availWidth", () => profile.screen.width);
    spoof(Screen.prototype, "availHeight", () => profile.screen.avail);
    spoof(Screen.prototype, "colorDepth", () => profile.colorDepth);
    spoof(Screen.prototype, "pixelDepth", () => profile.colorDepth);
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
    const spoofedDPR = profile.screen.width >= 3840 ? 2 : 1;
    spoof(window, "devicePixelRatio", () => spoofedDPR);
    if (typeof VisualViewport !== "undefined" && window.visualViewport) {
      spoof(window.visualViewport, "width", () => innerW);
      spoof(window.visualViewport, "height", () => innerH);
      spoof(window.visualViewport, "scale", () => 1);
    }
    if (typeof window.matchMedia === "function") {
      let parseLen = function(v) {
        if (!v) return null;
        const m = v.match(/^([\d.]+)\s*(px|em|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc)?$/);
        if (!m) return null;
        const n = parseFloat(m[1]);
        switch (m[2] || "px") {
          case "px":
            return n;
          case "em":
          case "rem":
            return n * 16;
          case "vw":
            return n * mq.width / 100;
          case "vh":
            return n * mq.height / 100;
          case "vmin":
            return n * Math.min(mq.width, mq.height) / 100;
          case "vmax":
            return n * Math.max(mq.width, mq.height) / 100;
          case "cm":
            return n * 96 / 2.54;
          case "mm":
            return n * 96 / 25.4;
          case "in":
            return n * 96;
          case "pt":
            return n * 96 / 72;
          case "pc":
            return n * 96 / 6;
          default:
            return null;
        }
      }, parseRes = function(v) {
        if (!v) return null;
        const m = v.match(/^([\d.]+)\s*(dppx|dpi|x)?$/);
        if (!m) return null;
        const n = parseFloat(m[1]);
        if (!m[2]) return n;
        return m[2] === "dpi" ? n / 96 : n;
      }, parseRatio = function(v) {
        if (!v) return null;
        const parts = v.split("/").map((s) => parseFloat(s.trim()));
        if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1]) || parts[1] === 0) return null;
        return parts[0] / parts[1];
      }, featureValue = function(feat) {
        switch (feat) {
          case "width":
            return mq.width;
          case "height":
            return mq.height;
          case "device-width":
            return mq.deviceWidth;
          case "device-height":
            return mq.deviceHeight;
          case "resolution":
            return mq.dpr;
          case "color":
            return 8;
          case "color-index":
            return 0;
          case "monochrome":
            return 0;
          case "aspect-ratio":
            return mq.width / mq.height;
          case "device-aspect-ratio":
            return mq.deviceWidth / mq.deviceHeight;
          default:
            return void 0;
        }
      }, parseTarget = function(feat, valStr) {
        if (feat === "resolution") return parseRes(valStr);
        if (feat === "aspect-ratio" || feat === "device-aspect-ratio") return parseRatio(valStr);
        return parseLen(valStr);
      }, evalDiscrete = function(feat, val) {
        switch (feat) {
          case "pointer":
          case "any-pointer":
            return val ? { matches: val === "fine" } : { matches: true };
          case "hover":
          case "any-hover":
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
            return null;
        }
      }, normalizeWebkitDPR = function(s) {
        return s.replace(/-webkit-min-device-pixel-ratio/g, "min-resolution").replace(/-webkit-max-device-pixel-ratio/g, "max-resolution").replace(/-webkit-device-pixel-ratio/g, "resolution");
      }, evalFeature = function(raw) {
        const inner = normalizeWebkitDPR(raw.trim().replace(/^\(\s*/, "").replace(/\s*\)$/, "").trim());
        const dbl = inner.match(
          /^(.+?)\s*(<=|>=|<|>)\s*([a-z][a-z0-9-]*)\s*(<=|>=|<|>)\s*(.+)$/
        );
        if (dbl) {
          const [, v1s, op1, feat2, op2, v2s] = dbl;
          const actual2 = featureValue(feat2);
          if (actual2 === void 0) return evalDiscrete(feat2, null);
          const t1 = parseTarget(feat2, v1s.trim());
          const t2 = parseTarget(feat2, v2s.trim());
          if (t1 === null || t2 === null) {
            return HARDWARE_FEATURES.has(feat2) ? { matches: false } : null;
          }
          let left;
          if (op1 === "<") left = actual2 > t1;
          else if (op1 === "<=") left = actual2 >= t1;
          else if (op1 === ">") left = actual2 < t1;
          else if (op1 === ">=") left = actual2 <= t1;
          else left = false;
          let right;
          if (op2 === "<") right = actual2 < t2;
          else if (op2 === "<=") right = actual2 <= t2;
          else if (op2 === ">") right = actual2 > t2;
          else if (op2 === ">=") right = actual2 >= t2;
          else right = false;
          return { matches: left && right };
        }
        const fov = inner.match(/^([a-z][a-z0-9-]*)\s*(<=|>=|<|>|=)\s*(.+)$/);
        if (fov) {
          const [, feat2, op, valStr] = fov;
          const actual2 = featureValue(feat2);
          if (actual2 === void 0) return evalDiscrete(feat2, op === "=" ? valStr.trim() : null);
          const target = parseTarget(feat2, valStr.trim());
          if (target === null) {
            return HARDWARE_FEATURES.has(feat2) ? { matches: false } : null;
          }
          switch (op) {
            case ">=":
              return { matches: actual2 >= target };
            case ">":
              return { matches: actual2 > target };
            case "<=":
              return { matches: actual2 <= target };
            case "<":
              return { matches: actual2 < target };
            case "=":
              return { matches: actual2 === target };
            default:
              return null;
          }
        }
        const vof = inner.match(/^(.+?)\s*(<=|>=|<|>|=)\s*([a-z][a-z0-9-]*)$/);
        if (vof) {
          const [, valStr, op, feat2] = vof;
          const actual2 = featureValue(feat2);
          if (actual2 === void 0) return evalDiscrete(feat2, op === "=" ? valStr.trim() : null);
          const target = parseTarget(feat2, valStr.trim());
          if (target === null) {
            return HARDWARE_FEATURES.has(feat2) ? { matches: false } : null;
          }
          const revOps = { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "=": "=" };
          const rev = revOps[op];
          switch (rev) {
            case ">=":
              return { matches: actual2 >= target };
            case ">":
              return { matches: actual2 > target };
            case "<=":
              return { matches: actual2 <= target };
            case "<":
              return { matches: actual2 < target };
            case "=":
              return { matches: actual2 === target };
            default:
              return null;
          }
        }
        const legacy = inner.match(/^([a-z][a-z0-9-]*)\s*(?::\s*(.+))?$/);
        if (!legacy) return null;
        let feat = legacy[1];
        const val = legacy[2] ? legacy[2].trim() : null;
        let prefix = "";
        if (feat.startsWith("min-")) {
          prefix = "min";
          feat = feat.slice(4);
        } else if (feat.startsWith("max-")) {
          prefix = "max";
          feat = feat.slice(4);
        }
        const actual = featureValue(feat);
        if (actual !== void 0) {
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
      }, evalQuery = function(query) {
        const orClauses = query.split(",").map((s) => s.trim());
        let anyNull = false;
        for (const clause of orClauses) {
          let work = clause.replace(/^\s*only\s+/i, "").replace(/^\s*(all|screen|print|speech)\s*/i, "").replace(/^\s*and\s+/i, "");
          let invert = false;
          if (/^\s*not\s+/i.test(clause)) {
            invert = true;
            work = clause.replace(/^\s*not\s+/i, "").replace(/^\s*(all|screen|print|speech)\s*/i, "").replace(/^\s*and\s+/i, "");
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
            if (result === null) {
              anyNull = true;
              clauseResult = false;
              break;
            }
            if (result.matches === null) {
              anyNull = true;
              clauseResult = false;
              break;
            }
            if (!result.matches) {
              clauseResult = false;
              break;
            }
          }
          if (invert) clauseResult = !clauseResult;
          if (clauseResult) return true;
        }
        if (anyNull) return null;
        return false;
      };
      __name(parseLen, "parseLen");
      __name(parseRes, "parseRes");
      __name(parseRatio, "parseRatio");
      __name(featureValue, "featureValue");
      __name(parseTarget, "parseTarget");
      __name(evalDiscrete, "evalDiscrete");
      __name(normalizeWebkitDPR, "normalizeWebkitDPR");
      __name(evalFeature, "evalFeature");
      __name(evalQuery, "evalQuery");
      const origMatchMedia = window.matchMedia.bind(window);
      const mq = {
        width: innerW,
        height: innerH,
        deviceWidth: profile.screen.width,
        deviceHeight: profile.screen.height,
        dpr: spoofedDPR,
        colorBits: profile.colorDepth,
        orientation: profile.screen.width >= profile.screen.height ? "landscape" : "portrait"
      };
      const HARDWARE_FEATURES = /* @__PURE__ */ new Set([
        "width",
        "height",
        "device-width",
        "device-height",
        "aspect-ratio",
        "device-aspect-ratio",
        "resolution",
        "color",
        "color-index",
        "monochrome"
      ]);
      window.matchMedia = disguise(function(query) {
        const result = evalQuery(query);
        if (result === null) {
          return origMatchMedia(query);
        }
        const fakeList = Object.create(MediaQueryList.prototype);
        Object.defineProperties(fakeList, {
          matches: { get: /* @__PURE__ */ __name(() => result, "get"), enumerable: true },
          media: { get: /* @__PURE__ */ __name(() => query, "get"), enumerable: true }
        });
        fakeList.addEventListener = function() {
        };
        fakeList.removeEventListener = function() {
        };
        fakeList.addListener = function() {
        };
        fakeList.removeListener = function() {
        };
        fakeList.dispatchEvent = function() {
          return true;
        };
        return fakeList;
      }, "matchMedia");
    }
  }
  var init_screen = __esm({
    "src/content/anti-fingerprint/screen.js"() {
      __name(installScreen, "installScreen");
    }
  });

  // src/content/anti-fingerprint/canvas.js
  function installCanvas(ctx) {
    const { ORIG, profile, disguise } = ctx;
    function pixelNoise(seed, i, val) {
      let h = seed ^ i * 2654435761;
      h = (h ^ val * 2246822519) >>> 0;
      h = Math.imul(h ^ h >>> 16, 73244475);
      h = Math.imul(h ^ h >>> 16, 73244475);
      h = (h ^ h >>> 16) >>> 0;
      const magnitude = h >>> 1 & 3;
      return h & 1 ? magnitude : -magnitude;
    }
    __name(pixelNoise, "pixelNoise");
    function applyCanvasNoise(px, seed) {
      for (let i = 0; i < px.length; i += 4) {
        px[i] = Math.max(0, Math.min(255, px[i] + pixelNoise(seed, i, px[i])));
        px[i + 1] = Math.max(0, Math.min(255, px[i + 1] + pixelNoise(seed, i + 1, px[i + 1])));
        px[i + 2] = Math.max(0, Math.min(255, px[i + 2] + pixelNoise(seed, i + 2, px[i + 2])));
      }
    }
    __name(applyCanvasNoise, "applyCanvasNoise");
    function noisyClone(src) {
      const c = document.createElement("canvas");
      c.width = src.width;
      c.height = src.height;
      const cctx = c.getContext("2d");
      cctx.drawImage(src, 0, 0);
      const id = ORIG.getImageData.call(cctx, 0, 0, c.width, c.height);
      applyCanvasNoise(id.data, profile.canvasSeed);
      cctx.putImageData(id, 0, 0);
      return c;
    }
    __name(noisyClone, "noisyClone");
    HTMLCanvasElement.prototype.toDataURL = disguise(function(...args) {
      try {
        if (this.width > 0 && this.height > 0)
          return ORIG.toDataURL.apply(noisyClone(this), args);
      } catch (e) {
      }
      return ORIG.toDataURL.apply(this, args);
    }, "toDataURL");
    HTMLCanvasElement.prototype.toBlob = disguise(function(cb, ...args) {
      try {
        if (this.width > 0 && this.height > 0)
          return ORIG.toBlob.call(noisyClone(this), cb, ...args);
      } catch (e) {
      }
      return ORIG.toBlob.call(this, cb, ...args);
    }, "toBlob");
    CanvasRenderingContext2D.prototype.getImageData = disguise(function(...args) {
      const id = ORIG.getImageData.apply(this, args);
      applyCanvasNoise(id.data, profile.canvasSeed);
      return id;
    }, "getImageData", 4);
    const _fontProbeSet = /* @__PURE__ */ new Set([
      // Top system fonts used by FingerprintJS, CreepJS, and font-enumeration scripts
      "Arial",
      "Verdana",
      "Times New Roman",
      "Georgia",
      "Trebuchet MS",
      "Courier New",
      "Impact",
      "Comic Sans MS",
      "Palatino Linotype",
      "Lucida Console",
      "Lucida Sans Unicode",
      "Tahoma",
      "Century Gothic",
      "Bookman Old Style",
      "Garamond",
      "MS Gothic",
      "MS PGothic",
      "MS Sans Serif",
      "MS Serif",
      "Wingdings",
      "Webdings",
      "Symbol",
      "Segoe UI",
      "Calibri",
      "Cambria",
      "Consolas",
      "Candara",
      "Franklin Gothic Medium",
      "Copperplate Gothic Bold",
      "Papyrus",
      "Brush Script MT",
      "Rockwell",
      "Bodoni MT",
      // macOS-specific probes
      "Helvetica Neue",
      "Menlo",
      "Monaco",
      "Optima",
      "Futura",
      "American Typewriter",
      "Baskerville",
      "Didot",
      "Gill Sans",
      // Linux probes
      "DejaVu Sans",
      "Liberation Sans",
      "Ubuntu",
      "Noto Sans"
    ]);
    function _isFontProbe(fontString) {
      if (!fontString) return false;
      const parts = fontString.split(/\d+(?:px|pt|em|rem|%)\s*/);
      const familyPart = parts.length > 1 ? parts[parts.length - 1] : fontString;
      const families = familyPart.split(",");
      for (const f of families) {
        const clean = f.trim().replace(/^['"]|['"]$/g, "");
        if (_fontProbeSet.has(clean)) return true;
      }
      return false;
    }
    __name(_isFontProbe, "_isFontProbe");
    const origMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = disguise(function(text) {
      const metrics = origMeasureText.call(this, text);
      let h = profile.canvasSeed;
      const input = (text || "") + (this.font || "");
      for (let i = 0; i < input.length; i++) {
        h = Math.imul(h ^ input.charCodeAt(i), 1540483477);
        h = (h ^ h >>> 15) >>> 0;
      }
      const isProbe = _isFontProbe(this.font);
      const noise = isProbe ? (h % 1e3 - 500) / 1e3 : (h % 200 - 100) / 1e3;
      return new Proxy(metrics, {
        get(target, prop) {
          if (prop === "width") return target.width + noise;
          const val = target[prop];
          return typeof val === "function" ? val.bind(target) : val;
        }
      });
    }, "measureText");
    ctx.applyCanvasNoise = applyCanvasNoise;
  }
  var init_canvas = __esm({
    "src/content/anti-fingerprint/canvas.js"() {
      __name(installCanvas, "installCanvas");
    }
  });

  // src/content/anti-fingerprint/webgl.js
  function installWebGL(ctx) {
    const { ORIG, profile, disguise, applyCanvasNoise } = ctx;
    const GL_CAP_BUCKETS = {
      apple: {
        3379: 16384,
        34076: 16384,
        34024: 16384,
        34921: 16,
        34930: 4096,
        35660: 16,
        34929: 30,
        34852: 1024,
        35661: 16,
        35658: 32,
        viewportDims: [16384, 16384],
        lineWidthRange: [1, 1],
        pointSizeRange: [1, 255],
        maxAnisotropy: 16
      },
      intel_low: {
        3379: 16384,
        34076: 16384,
        34024: 16384,
        34921: 16,
        34930: 4096,
        35660: 16,
        34929: 30,
        34852: 1024,
        35661: 16,
        35658: 32,
        viewportDims: [16384, 16384],
        lineWidthRange: [1, 7.375],
        pointSizeRange: [1, 255],
        maxAnisotropy: 16
      },
      intel_mid: {
        3379: 16384,
        34076: 16384,
        34024: 16384,
        34921: 16,
        34930: 4096,
        35660: 16,
        34929: 30,
        34852: 1024,
        35661: 16,
        35658: 32,
        viewportDims: [32767, 32767],
        lineWidthRange: [1, 7.375],
        pointSizeRange: [1, 255],
        maxAnisotropy: 16
      },
      nvidia_mid: {
        3379: 16384,
        34076: 16384,
        34024: 16384,
        34921: 16,
        34930: 4096,
        35660: 16,
        34929: 32,
        34852: 1024,
        35661: 16,
        35658: 32,
        viewportDims: [32767, 32767],
        lineWidthRange: [1, 1],
        pointSizeRange: [1, 1024],
        maxAnisotropy: 16
      },
      nvidia_high: {
        3379: 32768,
        34076: 32768,
        34024: 32768,
        34921: 16,
        34930: 4096,
        35660: 16,
        34929: 32,
        34852: 1024,
        35661: 16,
        35658: 32,
        viewportDims: [32767, 32767],
        lineWidthRange: [1, 1],
        pointSizeRange: [1, 1024],
        maxAnisotropy: 16
      }
    };
    function getCapBucket(renderer) {
      if (/Apple\s+M[12]/.test(renderer)) return GL_CAP_BUCKETS.apple;
      if (/Iris.*Plus/.test(renderer)) return GL_CAP_BUCKETS.apple;
      if (/HD\s+Graphics\s+6[12]0/.test(renderer)) return GL_CAP_BUCKETS.intel_low;
      if (/UHD\s+Graphics|Iris.*Xe/.test(renderer)) return GL_CAP_BUCKETS.intel_mid;
      if (/RTX\s+4/.test(renderer)) return GL_CAP_BUCKETS.nvidia_high;
      return GL_CAP_BUCKETS.nvidia_mid;
    }
    __name(getCapBucket, "getCapBucket");
    const activeGlCaps = getCapBucket(profile.gpu.renderer);
    function spoofGlGetParameter(origFn) {
      return disguise(function(param) {
        if (param === 37445) return profile.gpu.vendor;
        if (param === 37446) return profile.gpu.renderer;
        if (activeGlCaps[param] !== void 0) return activeGlCaps[param];
        if (param === 3389) return new Int32Array(activeGlCaps.viewportDims);
        if (param === 33902) return new Float32Array(activeGlCaps.lineWidthRange);
        if (param === 33888) return new Float32Array(activeGlCaps.pointSizeRange);
        if (param === 34047) return activeGlCaps.maxAnisotropy;
        return origFn.call(this, param);
      }, "getParameter");
    }
    __name(spoofGlGetParameter, "spoofGlGetParameter");
    if (ORIG.glGetParameter) {
      WebGLRenderingContext.prototype.getParameter = spoofGlGetParameter(ORIG.glGetParameter);
    }
    if (ORIG.gl2GetParameter) {
      WebGL2RenderingContext.prototype.getParameter = spoofGlGetParameter(ORIG.gl2GetParameter);
    }
    const COMMON_WEBGL_EXTENSIONS = [
      "ANGLE_instanced_arrays",
      "EXT_blend_minmax",
      "EXT_color_buffer_half_float",
      "EXT_float_blend",
      "EXT_frag_depth",
      "EXT_shader_texture_lod",
      "EXT_texture_filter_anisotropic",
      "OES_element_index_uint",
      "OES_standard_derivatives",
      "OES_texture_float",
      "OES_texture_float_linear",
      "OES_texture_half_float",
      "OES_texture_half_float_linear",
      "OES_vertex_array_object",
      "WEBGL_color_buffer_float",
      "WEBGL_compressed_texture_s3tc",
      "WEBGL_debug_renderer_info",
      "WEBGL_depth_texture",
      "WEBGL_draw_buffers",
      "WEBGL_lose_context"
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
    const COMMON_EXT_SET = new Set(COMMON_WEBGL_EXTENSIONS);
    function spoofGetExtension(origFn) {
      return disguise(function(name) {
        if (!COMMON_EXT_SET.has(name)) return null;
        if (name === "WEBGL_debug_renderer_info") {
          const real = origFn.call(this, name);
          if (real) return real;
          return {
            UNMASKED_VENDOR_WEBGL: 37445,
            UNMASKED_RENDERER_WEBGL: 37446
          };
        }
        if (name === "EXT_texture_filter_anisotropic") {
          const real = origFn.call(this, name);
          if (real) return real;
          return {
            TEXTURE_MAX_ANISOTROPY_EXT: 34046,
            MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047
          };
        }
        return origFn.call(this, name);
      }, "getExtension");
    }
    __name(spoofGetExtension, "spoofGetExtension");
    if (ORIG.glGetExtension) {
      WebGLRenderingContext.prototype.getExtension = spoofGetExtension(ORIG.glGetExtension);
    }
    if (ORIG.gl2GetExtension) {
      WebGL2RenderingContext.prototype.getExtension = spoofGetExtension(ORIG.gl2GetExtension);
    }
    function spoofGetShaderPrecisionFormat(origFn) {
      return disguise(function(shaderType, precisionType) {
        const real = origFn.call(this, shaderType, precisionType);
        if (!real) return real;
        ORIG.defineProperty.call(Object, real, "rangeMin", { value: 127, writable: false, enumerable: true, configurable: false });
        ORIG.defineProperty.call(Object, real, "rangeMax", { value: 127, writable: false, enumerable: true, configurable: false });
        ORIG.defineProperty.call(Object, real, "precision", { value: 23, writable: false, enumerable: true, configurable: false });
        return real;
      }, "getShaderPrecisionFormat");
    }
    __name(spoofGetShaderPrecisionFormat, "spoofGetShaderPrecisionFormat");
    if (ORIG.glGetShaderPrecisionFormat) {
      WebGLRenderingContext.prototype.getShaderPrecisionFormat = spoofGetShaderPrecisionFormat(ORIG.glGetShaderPrecisionFormat);
    }
    if (ORIG.gl2GetShaderPrecisionFormat) {
      WebGL2RenderingContext.prototype.getShaderPrecisionFormat = spoofGetShaderPrecisionFormat(ORIG.gl2GetShaderPrecisionFormat);
    }
    function spoofGlReadPixels(origFn) {
      return disguise(function(x, y, w, h, format, type, pixels) {
        origFn.call(this, x, y, w, h, format, type, pixels);
        if (pixels && format === 6408 && type === 5121) {
          applyCanvasNoise(pixels, profile.canvasSeed);
        }
      }, "readPixels");
    }
    __name(spoofGlReadPixels, "spoofGlReadPixels");
    if (ORIG.glReadPixels) {
      WebGLRenderingContext.prototype.readPixels = spoofGlReadPixels(ORIG.glReadPixels);
    }
    if (ORIG.gl2ReadPixels) {
      WebGL2RenderingContext.prototype.readPixels = spoofGlReadPixels(ORIG.gl2ReadPixels);
    }
    if (typeof OffscreenCanvas !== "undefined") {
      OffscreenCanvas.prototype.convertToBlob = disguise(function(...args) {
        try {
          if (this.width > 0 && this.height > 0) {
            const ocCtx = this.getContext("2d");
            if (ocCtx) {
              const getImageData = ORIG.offscreenGetImageData || ocCtx.getImageData.bind(ocCtx);
              const id = getImageData.call(ocCtx, 0, 0, this.width, this.height);
              applyCanvasNoise(id.data, profile.canvasSeed);
              const tmp = new OffscreenCanvas(this.width, this.height);
              const tmpCtx = tmp.getContext("2d");
              tmpCtx.putImageData(id, 0, 0);
              return ORIG.offscreenConvertToBlob.apply(tmp, args);
            }
          }
        } catch (e) {
        }
        return ORIG.offscreenConvertToBlob.apply(this, args);
      }, "convertToBlob");
      if (typeof OffscreenCanvasRenderingContext2D !== "undefined" && ORIG.offscreenGetImageData) {
        OffscreenCanvasRenderingContext2D.prototype.getImageData = disguise(function(...args) {
          const id = ORIG.offscreenGetImageData.apply(this, args);
          applyCanvasNoise(id.data, profile.canvasSeed);
          return id;
        }, "getImageData", 4);
      }
    }
  }
  var init_webgl = __esm({
    "src/content/anti-fingerprint/webgl.js"() {
      __name(installWebGL, "installWebGL");
    }
  });

  // src/content/anti-fingerprint/audio.js
  function installAudio(ctx) {
    const { ORIG, profile, spoof, disguise } = ctx;
    if (ORIG.getChannelData) {
      const _noisedBuffers = /* @__PURE__ */ new WeakMap();
      AudioBuffer.prototype.getChannelData = disguise(function(channel) {
        const data = ORIG.getChannelData.call(this, channel);
        let noised = _noisedBuffers.get(this);
        if (!noised) {
          noised = /* @__PURE__ */ new Set();
          _noisedBuffers.set(this, noised);
        }
        if (noised.has(channel)) return data;
        noised.add(channel);
        const seed = profile.audioSeed ^ channel * 2654435769;
        for (let i = 0; i < data.length; i++) {
          let h = seed ^ i * 2654435761;
          h = Math.imul(h ^ data[i] * 1e6 >>> 0, 73244475);
          h = (h ^ h >>> 16) >>> 0;
          data[i] += (h % 200 - 100) * 5e-7;
        }
        return data;
      }, "getChannelData");
    }
    if (typeof DeviceMotionEvent !== "undefined") {
      spoof(DeviceMotionEvent.prototype, "acceleration", () => null);
      spoof(DeviceMotionEvent.prototype, "accelerationIncludingGravity", () => null);
      spoof(DeviceMotionEvent.prototype, "rotationRate", () => null);
      spoof(DeviceMotionEvent.prototype, "interval", () => 0);
    }
    if (typeof DeviceOrientationEvent !== "undefined") {
      spoof(DeviceOrientationEvent.prototype, "alpha", () => null);
      spoof(DeviceOrientationEvent.prototype, "beta", () => null);
      spoof(DeviceOrientationEvent.prototype, "gamma", () => null);
      spoof(DeviceOrientationEvent.prototype, "absolute", () => false);
    }
    const _sensorClasses = [
      "Accelerometer",
      "Gyroscope",
      "LinearAccelerationSensor",
      "AbsoluteOrientationSensor",
      "RelativeOrientationSensor",
      "GravitySensor",
      "Magnetometer",
      "AmbientLightSensor"
    ];
    const _sensorProps = ["x", "y", "z", "quaternion", "illuminance"];
    for (const cls of _sensorClasses) {
      if (typeof window[cls] !== "undefined") {
        for (const prop of _sensorProps) {
          spoof(window[cls].prototype, prop, () => null);
        }
      }
    }
    if (ORIG.audioConnect) {
      AudioNode.prototype.connect = disguise(/* @__PURE__ */ __name(function connect(destination, output, input) {
        if (destination instanceof AudioDestinationNode || destination instanceof AnalyserNode) {
          try {
            const audioCtx = this.context || destination.context;
            const filter = audioCtx.createBiquadFilter();
            filter.type = "highshelf";
            filter.frequency.value = 17999;
            filter.Q.value = 0;
            filter.gain.value = -70;
            ORIG.audioConnect.call(this, filter, output, 0);
            return ORIG.audioConnect.call(filter, destination, 0, input);
          } catch (e) {
            return ORIG.audioConnect.call(this, destination, output, input);
          }
        }
        return ORIG.audioConnect.call(this, destination, output, input);
      }, "connect"), "connect", 1);
    }
  }
  var init_audio = __esm({
    "src/content/anti-fingerprint/audio.js"() {
      __name(installAudio, "installAudio");
    }
  });

  // src/content/anti-fingerprint/biometric.js
  function installBiometric(ctx) {
    const { ORIG, profile, bioSeed, spoof, disguise } = ctx;
    const BIO_SALT_TIMESTAMP = 1414090053;
    const BIO_SALT_PERFNOW = 1346720326;
    const BIO_SALT_MOUSE_X = 1297635416;
    const BIO_SALT_MOUSE_Y = 1297701209;
    function bioGaussian(seed, salt, inputHash, sigma, bound) {
      let h1 = seed ^ salt ^ inputHash;
      h1 = Math.imul(h1 ^ h1 >>> 16, 73244475);
      h1 = Math.imul(h1 ^ h1 >>> 16, 73244475);
      h1 = (h1 ^ h1 >>> 16) >>> 0;
      let h2 = seed ^ Math.imul(salt, 2654435769) ^ inputHash;
      h2 = Math.imul(h2 ^ h2 >>> 16, 73244475);
      h2 = Math.imul(h2 ^ h2 >>> 16, 73244475);
      h2 = (h2 ^ h2 >>> 16) >>> 0;
      const u1 = (h1 + 1) / 4294967297;
      const u2 = (h2 + 1) / 4294967297;
      let z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
      if (z > bound) z = bound;
      if (z < -bound) z = -bound;
      return z;
    }
    __name(bioGaussian, "bioGaussian");
    const _bioCoordSkip = /* @__PURE__ */ new Set([
      "docs.google.com",
      "sheets.google.com",
      "slides.google.com",
      "figma.com",
      "www.figma.com",
      "maps.google.com",
      "www.openstreetmap.org",
      "excalidraw.com",
      "www.canva.com"
    ]);
    const _skipCoordNoise = _bioCoordSkip.has(location.hostname);
    const _origTSDesc = ORIG.getOwnPropertyDescriptor.call(Object, Event.prototype, "timeStamp");
    if (_origTSDesc && _origTSDesc.get) {
      const _tsCache = /* @__PURE__ */ new WeakMap();
      spoof(Event.prototype, "timeStamp", function() {
        const cached = _tsCache.get(this);
        if (cached !== void 0) return cached;
        const real = _origTSDesc.get.call(this);
        if (!this.isTrusted) {
          _tsCache.set(this, real);
          return real;
        }
        const jitter = bioGaussian(bioSeed, BIO_SALT_TIMESTAMP, real * 1e3 >>> 0, 0.5, 1);
        const result = real + jitter;
        _tsCache.set(this, result);
        return result;
      });
    }
    const _origPerfNow = Performance.prototype.now;
    let _perfLast = 0;
    Performance.prototype.now = disguise(function() {
      const real = _origPerfNow.call(this);
      const quantized = Math.round(real * 10) / 10;
      const jitter = bioGaussian(bioSeed, BIO_SALT_PERFNOW, quantized * 1e4 >>> 0, 0.03, 0.1);
      const result = quantized + jitter;
      if (result < _perfLast) return _perfLast;
      _perfLast = result;
      return result;
    }, "now");
    function _isEditableOrCanvas(target) {
      if (!target) return false;
      if (target instanceof HTMLInputElement) return true;
      if (target instanceof HTMLTextAreaElement) return true;
      if (target instanceof HTMLCanvasElement) return true;
      if (target instanceof SVGElement) return true;
      try {
        if (target.isContentEditable) return true;
      } catch (e) {
      }
      return false;
    }
    __name(_isEditableOrCanvas, "_isEditableOrCanvas");
    const _hasDragEvent = typeof DragEvent !== "undefined";
    function _shouldSkipNoise(event) {
      if (!event.isTrusted) return true;
      if (_hasDragEvent && event instanceof DragEvent) return true;
      if (_isEditableOrCanvas(event.target)) return true;
      return false;
    }
    __name(_shouldSkipNoise, "_shouldSkipNoise");
    if (!_skipCoordNoise) {
      let _getEventNoise = function(event) {
        let cached = _mouseCache.get(event);
        if (cached) return cached;
        if (_shouldSkipNoise(event)) {
          cached = { nx: 0, ny: 0 };
          _mouseCache.set(event, cached);
          return cached;
        }
        const rx = _origCoordGetters.clientX ? _origCoordGetters.clientX.call(event) : 0;
        const ry = _origCoordGetters.clientY ? _origCoordGetters.clientY.call(event) : 0;
        const gx = bioGaussian(bioSeed, BIO_SALT_MOUSE_X, rx | 0, 0.4, 1);
        const gy = bioGaussian(bioSeed, BIO_SALT_MOUSE_Y, ry | 0, 0.4, 1);
        cached = { nx: Math.round(gx), ny: Math.round(gy) };
        _mouseCache.set(event, cached);
        return cached;
      };
      __name(_getEventNoise, "_getEventNoise");
      const _origCoordGetters = {};
      for (const p of ["clientX", "clientY", "screenX", "screenY", "pageX", "pageY"]) {
        const d = ORIG.getOwnPropertyDescriptor.call(Object, MouseEvent.prototype, p);
        if (d && d.get) _origCoordGetters[p] = d.get;
      }
      const _mouseCache = /* @__PURE__ */ new WeakMap();
      for (const prop of ["clientX", "pageX", "screenX"]) {
        if (!_origCoordGetters[prop]) continue;
        const origGet = _origCoordGetters[prop];
        spoof(MouseEvent.prototype, prop, function() {
          return origGet.call(this) + _getEventNoise(this).nx;
        });
      }
      for (const prop of ["clientY", "pageY", "screenY"]) {
        if (!_origCoordGetters[prop]) continue;
        const origGet = _origCoordGetters[prop];
        spoof(MouseEvent.prototype, prop, function() {
          return origGet.call(this) + _getEventNoise(this).ny;
        });
      }
      for (const [alias, canonical] of [["x", "clientX"], ["y", "clientY"]]) {
        const d = ORIG.getOwnPropertyDescriptor.call(Object, MouseEvent.prototype, alias);
        if (d && d.get) {
          spoof(MouseEvent.prototype, alias, function() {
            return this[canonical];
          });
        }
      }
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
    if (typeof BatteryManager !== "undefined") {
      spoof(BatteryManager.prototype, "charging", function() {
        return true;
      });
      spoof(BatteryManager.prototype, "chargingTime", function() {
        return 0;
      });
      spoof(BatteryManager.prototype, "dischargingTime", function() {
        return Infinity;
      });
      spoof(BatteryManager.prototype, "level", function() {
        return 1;
      });
    }
  }
  var init_biometric = __esm({
    "src/content/anti-fingerprint/biometric.js"() {
      __name(installBiometric, "installBiometric");
    }
  });

  // src/content/anti-fingerprint/misc.js
  function installMisc(ctx) {
    const { ORIG, profile, sessionSeed, currentTzOffset, spoof, disguise, mulberry32 } = ctx;
    ORIG.DateTimeFormat.prototype.resolvedOptions = disguise(function() {
      const opts = ORIG.resolvedOptions.call(this);
      opts.timeZone = profile.timezone;
      return opts;
    }, "resolvedOptions");
    const tzProxy = new Proxy(ORIG.DateTimeFormat, {
      construct(target, args) {
        if (args[1]) {
          args[1].timeZone = profile.timezone;
        } else {
          args[1] = { timeZone: profile.timezone };
        }
        return new target(...args);
      },
      apply(target, thisArg, args) {
        if (args[1]) {
          args[1].timeZone = profile.timezone;
        } else {
          args[1] = { timeZone: profile.timezone };
        }
        return target.apply(thisArg, args);
      }
    });
    try {
      ORIG.defineProperty.call(Object, Intl, "DateTimeFormat", {
        value: tzProxy,
        writable: true,
        configurable: true
      });
    } catch (e) {
    }
    Date.prototype.getTimezoneOffset = disguise(function() {
      return currentTzOffset;
    }, "getTimezoneOffset");
    if (typeof navigator !== "undefined" && navigator.mediaDevices && typeof MediaDevices !== "undefined" && typeof MediaDevices.prototype.enumerateDevices === "function" && typeof MediaDeviceInfo !== "undefined") {
      let makeDeviceId = function(seed, kind) {
        const rng = mulberry32(seed ^ hashStr(kind));
        let hex = "";
        for (let i = 0; i < 16; i++) {
          hex += (rng() * 4294967295 >>> 0).toString(16).padStart(8, "0");
        }
        return hex.slice(0, 64);
      }, hashStr = function(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
          h = (h << 5) - h + s.charCodeAt(i) | 0;
        }
        return h;
      };
      __name(makeDeviceId, "makeDeviceId");
      __name(hashStr, "hashStr");
      const _devData = /* @__PURE__ */ new WeakMap();
      const MDI = MediaDeviceInfo;
      const IDI = typeof InputDeviceInfo !== "undefined" ? InputDeviceInfo : null;
      for (const prop of ["deviceId", "groupId", "kind", "label"]) {
        const origGetter = (ORIG.getOwnPropertyDescriptor.call(Object, MDI.prototype, prop) || {}).get;
        spoof(MDI.prototype, prop, function() {
          const data = _devData.get(this);
          if (data) return data[prop] || "";
          if (origGetter) return origGetter.call(this);
          return void 0;
        });
      }
      const origToJSON = MDI.prototype.toJSON;
      MDI.prototype.toJSON = disguise(/* @__PURE__ */ __name(function toJSON() {
        if (_devData.has(this)) {
          return {
            deviceId: this.deviceId,
            kind: this.kind,
            label: this.label,
            groupId: this.groupId
          };
        }
        if (origToJSON) return origToJSON.call(this);
        return {
          deviceId: this.deviceId,
          kind: this.kind,
          label: this.label,
          groupId: this.groupId
        };
      }, "toJSON"), "toJSON", 0);
      if (IDI) {
        const origGetCaps = (ORIG.getOwnPropertyDescriptor.call(Object, IDI.prototype, "getCapabilities") || {}).value;
        IDI.prototype.getCapabilities = disguise(/* @__PURE__ */ __name(function getCapabilities() {
          if (_devData.has(this)) return {};
          if (origGetCaps) return origGetCaps.call(this);
          return {};
        }, "getCapabilities"), "getCapabilities", 0);
      }
      const groupId = makeDeviceId(sessionSeed, "group");
      const deviceSpecs = [
        { kind: "audioinput", deviceId: makeDeviceId(sessionSeed, "audioinput"), groupId, label: "" },
        { kind: "audiooutput", deviceId: makeDeviceId(sessionSeed, "audiooutput"), groupId, label: "" },
        { kind: "videoinput", deviceId: makeDeviceId(sessionSeed, "videoinput"), groupId, label: "" }
      ];
      MediaDevices.prototype.enumerateDevices = disguise(/* @__PURE__ */ __name(function enumerateDevices() {
        const devices = deviceSpecs.map(function(spec) {
          const isInput = spec.kind === "audioinput" || spec.kind === "videoinput";
          const proto = isInput && IDI ? IDI.prototype : MDI.prototype;
          const dev = Object.create(proto);
          _devData.set(dev, spec);
          return dev;
        });
        return ORIG.promiseResolve.call(Promise, devices);
      }, "enumerateDevices"), "enumerateDevices", 0);
    }
    const workerOverrides = `
    Object.defineProperty(self.navigator.__proto__, "userAgent", { get: () => ${JSON.stringify(profile.userAgent)} });
    Object.defineProperty(self.navigator.__proto__, "platform", { get: () => ${JSON.stringify(profile.platform)} });
    Object.defineProperty(self.navigator.__proto__, "hardwareConcurrency", { get: () => ${profile.hardwareConcurrency} });
    Object.defineProperty(self.navigator.__proto__, "deviceMemory", { get: () => ${profile.deviceMemory} });
    Object.defineProperty(self.navigator.__proto__, "language", { get: () => ${JSON.stringify(profile.languages[0])} });
    Object.defineProperty(self.navigator.__proto__, "languages", { get: () => Object.freeze(${JSON.stringify(profile.languages)}) });
    Object.defineProperty(self.navigator.__proto__, "appVersion", { get: () => ${JSON.stringify(profile.userAgent.replace("Mozilla/", ""))} });
  `;
    function buildCanvasWorkerOverrides(seed) {
      return `
;(function(){
  var __s=${seed};
  function __pn(s,i,v){var h=s^(i*2654435761);h=(h^(v*2246822519))>>>0;h=Math.imul(h^(h>>>16),0x45d9f3b);h=Math.imul(h^(h>>>16),0x45d9f3b);h=(h^(h>>>16))>>>0;var m=(h>>>1)&3;return(h&1)?m:-m;}
  function __an(px,s){for(var i=0;i<px.length;i+=4){px[i]=Math.max(0,Math.min(255,px[i]+__pn(s,i,px[i])));px[i+1]=Math.max(0,Math.min(255,px[i+1]+__pn(s,i+1,px[i+1])));px[i+2]=Math.max(0,Math.min(255,px[i+2]+__pn(s,i+2,px[i+2])));}}
  if(typeof OffscreenCanvas!=='undefined'){
    var _oCtB=OffscreenCanvas.prototype.convertToBlob;
    var _oGID=(typeof OffscreenCanvasRenderingContext2D!=='undefined')?OffscreenCanvasRenderingContext2D.prototype.getImageData:null;
    if(_oGID){OffscreenCanvasRenderingContext2D.prototype.getImageData=function(){var id=_oGID.apply(this,arguments);__an(id.data,__s);return id;};}
    OffscreenCanvas.prototype.convertToBlob=function(){try{if(this.width>0&&this.height>0){var c=this.getContext('2d');if(c){var id=_oGID?_oGID.call(c,0,0,this.width,this.height):c.getImageData(0,0,this.width,this.height);__an(id.data,__s);var t=new OffscreenCanvas(this.width,this.height);t.getContext('2d').putImageData(id,0,0);return _oCtB.apply(t,arguments);}}}catch(e){}return _oCtB.apply(this,arguments);};
  }
  if(typeof WebGLRenderingContext!=='undefined'){var _rp=WebGLRenderingContext.prototype.readPixels;WebGLRenderingContext.prototype.readPixels=function(x,y,w,h,f,t,p){_rp.call(this,x,y,w,h,f,t,p);if(p&&f===0x1908&&t===0x1401)__an(p,__s);};}
  if(typeof WebGL2RenderingContext!=='undefined'){var _rp2=WebGL2RenderingContext.prototype.readPixels;WebGL2RenderingContext.prototype.readPixels=function(x,y,w,h,f,t,p){_rp2.call(this,x,y,w,h,f,t,p);if(p&&f===0x1908&&t===0x1401)__an(p,__s);};}
})();`;
    }
    __name(buildCanvasWorkerOverrides, "buildCanvasWorkerOverrides");
    if (typeof Worker !== "undefined") {
      const OrigWorker = Worker;
      window.Worker = disguise(function(url, opts) {
        const isModule = opts && opts.type === "module";
        const allOverrides = workerOverrides + buildCanvasWorkerOverrides(profile.canvasSeed);
        try {
          const origUrl = new URL(url, location.href).href;
          if (isModule) {
            const blob = new Blob(
              [allOverrides + `;
await import(${JSON.stringify(origUrl)});`],
              { type: "application/javascript" }
            );
            return new OrigWorker(URL.createObjectURL(blob), { ...opts, type: "module" });
          } else {
            const blob = new Blob(
              [allOverrides + `;
importScripts(${JSON.stringify(origUrl)});`],
              { type: "application/javascript" }
            );
            return new OrigWorker(URL.createObjectURL(blob), opts);
          }
        } catch (e) {
          return new OrigWorker(url, opts);
        }
      }, "Worker", 1);
      window.Worker.prototype = OrigWorker.prototype;
    }
    if (typeof SharedWorker !== "undefined") {
      const OrigSharedWorker = SharedWorker;
      window.SharedWorker = disguise(function(url, nameOrOpts) {
        const allOverrides = workerOverrides + buildCanvasWorkerOverrides(profile.canvasSeed);
        try {
          const origUrl = new URL(url, location.href).href;
          const blob = new Blob(
            [allOverrides + `;
importScripts(${JSON.stringify(origUrl)});`],
            { type: "application/javascript" }
          );
          return new OrigSharedWorker(URL.createObjectURL(blob), nameOrOpts);
        } catch (e) {
          return new OrigSharedWorker(url, nameOrOpts);
        }
      }, "SharedWorker", 1);
      window.SharedWorker.prototype = OrigSharedWorker.prototype;
    }
  }
  var init_misc = __esm({
    "src/content/anti-fingerprint/misc.js"() {
      __name(installMisc, "installMisc");
    }
  });

  // src/content/anti-fingerprint/iframe.js
  function installIframe(ctx) {
    const { ORIG, profile, disguise, spoof, applyCanvasNoise } = ctx;
    const _patchedRealms = /* @__PURE__ */ new WeakSet();
    function noisyClone(src) {
      const c = document.createElement("canvas");
      c.width = src.width;
      c.height = src.height;
      const cctx = c.getContext("2d");
      cctx.drawImage(src, 0, 0);
      const id = ORIG.getImageData.call(cctx, 0, 0, c.width, c.height);
      applyCanvasNoise(id.data, profile.canvasSeed);
      cctx.putImageData(id, 0, 0);
      return c;
    }
    __name(noisyClone, "noisyClone");
    function patchIframeRealm(win) {
      if (!win) return;
      if (_patchedRealms.has(win)) return;
      try {
        if (!win.HTMLCanvasElement) return;
      } catch (e) {
        return;
      }
      _patchedRealms.add(win);
      try {
        const iOrigTDU = win.HTMLCanvasElement.prototype.toDataURL;
        const iOrigTB = win.HTMLCanvasElement.prototype.toBlob;
        const iOrigGID = win.CanvasRenderingContext2D.prototype.getImageData;
        win.HTMLCanvasElement.prototype.toDataURL = disguise(function(...args) {
          try {
            if (this.width > 0 && this.height > 0)
              return iOrigTDU.apply(noisyClone(this), args);
          } catch (e) {
          }
          return iOrigTDU.apply(this, args);
        }, "toDataURL");
        win.HTMLCanvasElement.prototype.toBlob = disguise(function(cb, ...args) {
          try {
            if (this.width > 0 && this.height > 0)
              return iOrigTB.call(noisyClone(this), cb, ...args);
          } catch (e) {
          }
          return iOrigTB.call(this, cb, ...args);
        }, "toBlob");
        win.CanvasRenderingContext2D.prototype.getImageData = disguise(
          function(...args) {
            const id = iOrigGID.apply(this, args);
            applyCanvasNoise(id.data, profile.canvasSeed);
            return id;
          },
          "getImageData",
          4
        );
      } catch (e) {
      }
      try {
        if (win.WebGLRenderingContext) {
          const iOrigRP = win.WebGLRenderingContext.prototype.readPixels;
          win.WebGLRenderingContext.prototype.readPixels = disguise(
            function(x, y, w, h, format, type, pixels) {
              iOrigRP.call(this, x, y, w, h, format, type, pixels);
              if (pixels && format === 6408 && type === 5121) {
                applyCanvasNoise(pixels, profile.canvasSeed);
              }
            },
            "readPixels"
          );
        }
      } catch (e) {
      }
      try {
        if (win.WebGL2RenderingContext) {
          const iOrigRP2 = win.WebGL2RenderingContext.prototype.readPixels;
          win.WebGL2RenderingContext.prototype.readPixels = disguise(
            function(x, y, w, h, format, type, pixels) {
              iOrigRP2.call(this, x, y, w, h, format, type, pixels);
              if (pixels && format === 6408 && type === 5121) {
                applyCanvasNoise(pixels, profile.canvasSeed);
              }
            },
            "readPixels"
          );
        }
      } catch (e) {
      }
      try {
        if (win.OffscreenCanvas) {
          const iOrigOCB = win.OffscreenCanvas.prototype.convertToBlob;
          let iOrigOCGID = null;
          if (win.OffscreenCanvasRenderingContext2D) {
            iOrigOCGID = win.OffscreenCanvasRenderingContext2D.prototype.getImageData;
          }
          win.OffscreenCanvas.prototype.convertToBlob = disguise(
            function(...args) {
              try {
                if (this.width > 0 && this.height > 0) {
                  const octx = this.getContext("2d");
                  if (octx) {
                    const gid = iOrigOCGID || octx.getImageData.bind(octx);
                    const id = gid.call(octx, 0, 0, this.width, this.height);
                    applyCanvasNoise(id.data, profile.canvasSeed);
                    const tmp = new win.OffscreenCanvas(this.width, this.height);
                    const tmpCtx = tmp.getContext("2d");
                    tmpCtx.putImageData(id, 0, 0);
                    return iOrigOCB.apply(tmp, args);
                  }
                }
              } catch (e) {
              }
              return iOrigOCB.apply(this, args);
            },
            "convertToBlob"
          );
          if (iOrigOCGID) {
            win.OffscreenCanvasRenderingContext2D.prototype.getImageData = disguise(function(...args) {
              const id = iOrigOCGID.apply(this, args);
              applyCanvasNoise(id.data, profile.canvasSeed);
              return id;
            }, "getImageData", 4);
          }
        }
      } catch (e) {
      }
    }
    __name(patchIframeRealm, "patchIframeRealm");
    const cdDesc = ORIG.getOwnPropertyDescriptor.call(
      Object,
      HTMLIFrameElement.prototype,
      "contentDocument"
    );
    if (cdDesc && cdDesc.get) {
      const origCDGetter = cdDesc.get;
      spoof(HTMLIFrameElement.prototype, "contentDocument", function() {
        const doc = origCDGetter.call(this);
        if (doc) {
          try {
            patchIframeRealm(doc.defaultView);
          } catch (e) {
          }
        }
        return doc;
      });
    }
    const cwDesc = ORIG.getOwnPropertyDescriptor.call(
      Object,
      HTMLIFrameElement.prototype,
      "contentWindow"
    );
    if (cwDesc && cwDesc.get) {
      const origCWGetter = cwDesc.get;
      spoof(HTMLIFrameElement.prototype, "contentWindow", function() {
        const win = origCWGetter.call(this);
        if (win) {
          try {
            patchIframeRealm(win);
          } catch (e) {
          }
        }
        return win;
      });
    }
  }
  var init_iframe = __esm({
    "src/content/anti-fingerprint/iframe.js"() {
      __name(installIframe, "installIframe");
    }
  });

  // src/content/anti-fingerprint/index.js
  var require_index = __commonJS({
    "src/content/anti-fingerprint/index.js"() {
      init_core();
      init_navigator();
      init_screen();
      init_canvas();
      init_webgl();
      init_audio();
      init_biometric();
      init_misc();
      init_iframe();
      (function() {
        "use strict";
        const ctx = createContext();
        if (!ctx) return;
        const _onConverge = /* @__PURE__ */ __name(function(e) {
          ctx.convergeToSeed(e.detail);
          window.removeEventListener("__pgc", _onConverge);
        }, "_onConverge");
        try {
          window.addEventListener("__pgc", _onConverge);
        } catch (e) {
        }
        installNavigator(ctx);
        installScreen(ctx);
        installCanvas(ctx);
        installWebGL(ctx);
        installAudio(ctx);
        installBiometric(ctx);
        installMisc(ctx);
        installIframe(ctx);
        try {
          setTimeout(function() {
            try {
              window.removeEventListener("__pgc", _onConverge);
            } catch (e) {
            }
          }, 200);
        } catch (e) {
        }
      })();
    }
  });
  require_index();
})();
