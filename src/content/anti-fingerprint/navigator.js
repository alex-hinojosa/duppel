/**
 * PhantomGrid — Navigator Spoofing Module
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
}
