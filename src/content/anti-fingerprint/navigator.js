/**
 * Duppel — Navigator Spoofing Module
 * Navigator property spoofing, Client Hints, GPC, referrer trimming.
 */

export function installNavigator(ctx) {
  const { ORIG, profile, spoof, disguise } = ctx;

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

  // Network Information API — passthrough with frozen clone.
  // Returning undefined is a bot signal on Chromium (which always exposes
  // navigator.connection). The real object is already coarsened by the browser
  // (effectiveType: 4 values, downlink: 25KB steps, rtt: 25ms steps) — low
  // entropy, not worth spoofing. Freeze a snapshot so trackers can't use the
  // change event or onchange handler as a side channel.
  try {
    if (navigator.connection) {
      var _conn = navigator.connection;
      var frozenConn = Object.create(Object.getPrototypeOf(_conn));
      var connProps = ['effectiveType', 'downlink', 'rtt', 'saveData', 'type'];
      for (var i = 0; i < connProps.length; i++) {
        var p = connProps[i];
        if (p in _conn) {
          var val = _conn[p];
          ORIG.defineProperty.call(Object, frozenConn, p, {
            get: disguise(function() { return val; }, 'get ' + p, 0),
            enumerable: true, configurable: true
          });
        }
      }
      // Kill the change event — no network condition side channel
      ORIG.defineProperty.call(Object, frozenConn, 'onchange', {
        get: disguise(function() { return null; }, 'get onchange', 0),
        set: disguise(function() {}, 'set onchange', 1),
        enumerable: true, configurable: true
      });
      frozenConn.addEventListener = disguise(function addEventListener() {}, 'addEventListener', 2);
      frozenConn.removeEventListener = disguise(function removeEventListener() {}, 'removeEventListener', 2);
      frozenConn.dispatchEvent = disguise(function dispatchEvent() { return false; }, 'dispatchEvent', 1);
      // P1: freeze the clone so trackers can't detect mutability as a side channel.
      try { ORIG.freeze.call(Object, frozenConn); } catch(e) {}
      spoof(Navigator.prototype, "connection", () => frozenConn);
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

    // Build a NavigatorUAData-shaped object. We construct a custom prototype
    // with the same method layout as the native one (toJSON, getHighEntropyValues)
    // but put data accessors on the instance to avoid native internal-slot getters.
    const highEntropyResult = {
      brands, mobile: false, platform: uaPlatform,
      platformVersion: isMac ? "15.5.0" : isLinux ? "6.8.0" : "15.0.0",
      architecture: arch, bitness: "64", model: "",
      uaFullVersion: `${chromeVer}.0.0.0`,
      fullVersionList: brands.map(b => ({ brand: b.brand, version: `${b.version}.0.0.0` })),
      wow64: false,
    };

    // Intermediate prototype that INHERITS from NavigatorUAData.prototype, so
    // `x instanceof NavigatorUAData`, `x.constructor`, and prototype-chain
    // probes resolve natively — no custom Symbol.hasInstance trap needed.
    // brands/mobile/platform/toJSON/getHighEntropyValues are defined here,
    // shadowing the native prototype's internal-slot getters (which would throw
    // on a slot-less fake). The fake instance itself carries zero own properties,
    // matching the native shape (getOwnPropertyNames(navigator.userAgentData) === []).
    const uadProto = Object.create(NavigatorUAData.prototype);
    Object.defineProperties(uadProto, {
      brands:   { get() { return brands; },     enumerable: true, configurable: true },
      mobile:   { get() { return false; },      enumerable: true, configurable: true },
      platform: { get() { return uaPlatform; }, enumerable: true, configurable: true },
    });
    // toJSON: arity 0 (native shape), on prototype
    uadProto.toJSON = function toJSON() {
      return { brands, mobile: false, platform: uaPlatform };
    };
    // getHighEntropyValues: arity 1 (accepts hints array, native shape), on prototype
    uadProto.getHighEntropyValues = function getHighEntropyValues(hints) {
      return Promise.resolve(highEntropyResult);
    };
    disguise(uadProto.getHighEntropyValues, "getHighEntropyValues");
    disguise(uadProto.toJSON, "toJSON");

    // No Symbol.hasInstance override: the prior trap delegated to
    // `obj instanceof uadProto.constructor` where uadProto.constructor was Object,
    // which made EVERY object report `instanceof NavigatorUAData === true` (a lie
    // detector trips on `({}) instanceof NavigatorUAData`) and left an own
    // Symbol.hasInstance on the constructor (itself a tell). Inheriting from
    // NavigatorUAData.prototype gives correct instanceof semantics natively.
    const fakeUAData = Object.create(uadProto);
    spoof(Navigator.prototype, "userAgentData", () => fakeUAData);
  }

  if (profile.userAgent.includes("Firefox") && !chromeMatch) {
    spoof(Navigator.prototype, "userAgentData", () => undefined);
  }
}
