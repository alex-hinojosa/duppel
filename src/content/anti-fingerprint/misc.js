/**
 * Duppel — Miscellaneous Spoofing Module
 * Timezone spoofing, enumerateDevices, Worker navigator overrides.
 */

export function installMisc(ctx) {
  const { ORIG, profile, sessionSeed, currentTzOffset, spoof, disguise, mulberry32 } = ctx;

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
  //
  // Stealth: no synthetic intermediate prototypes. Property getters are
  // patched directly on MediaDeviceInfo.prototype via spoof() (GOPD
  // normalization, native toString, getter.name all automatic). Devices
  // are Object.create(NativeProto) with no own properties. Fresh object
  // identities per call; stable values across calls.
  if (typeof navigator !== 'undefined' && navigator.mediaDevices &&
      typeof MediaDevices !== 'undefined' &&
      typeof MediaDevices.prototype.enumerateDevices === 'function' &&
      typeof MediaDeviceInfo !== 'undefined') {

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

    // Per-device value store — patched prototype getters read from here.
    // Spoofed devices are registered; real devices fall through to the
    // original native getter.
    const _devData = new WeakMap();

    const MDI = MediaDeviceInfo;
    const IDI = typeof InputDeviceInfo !== 'undefined' ? InputDeviceInfo : null;

    // Patch getters directly on MediaDeviceInfo.prototype via spoof().
    // In Chrome, deviceId/groupId/kind/label getters live on
    // MediaDeviceInfo.prototype (InputDeviceInfo inherits them).
    // spoof() saves pristine descriptors → GOPD normalization automatic.
    for (const prop of ['deviceId', 'groupId', 'kind', 'label']) {
      const origGetter = (ORIG.getOwnPropertyDescriptor.call(Object, MDI.prototype, prop) || {}).get;
      spoof(MDI.prototype, prop, function() {
        const data = _devData.get(this);
        if (data) return data[prop] || '';
        // Real device — delegate to original native getter
        if (origGetter) return origGetter.call(this);
        return undefined;
      });
    }

    // Patch toJSON on MediaDeviceInfo.prototype — native toJSON reads
    // this.deviceId etc, which hits our patched getters automatically.
    // But the original toJSON may throw on spoofed objects that lack
    // internal slots, so we intercept it.
    const origToJSON = MDI.prototype.toJSON;
    MDI.prototype.toJSON = disguise(function toJSON() {
      if (_devData.has(this)) {
        return { deviceId: this.deviceId, kind: this.kind,
                 label: this.label, groupId: this.groupId };
      }
      if (origToJSON) return origToJSON.call(this);
      return { deviceId: this.deviceId, kind: this.kind,
               label: this.label, groupId: this.groupId };
    }, 'toJSON', 0);

    // Patch getCapabilities on InputDeviceInfo.prototype
    if (IDI) {
      const origGetCaps = (ORIG.getOwnPropertyDescriptor.call(Object, IDI.prototype, 'getCapabilities') || {}).value;
      IDI.prototype.getCapabilities = disguise(function getCapabilities() {
        if (_devData.has(this)) return {};
        if (origGetCaps) return origGetCaps.call(this);
        return {};
      }, 'getCapabilities', 0);
    }

    // Stable device values — fresh wrapper objects created per call
    const groupId = makeDeviceId(sessionSeed, 'group');
    const deviceSpecs = [
      { kind: 'audioinput',  deviceId: makeDeviceId(sessionSeed, 'audioinput'),  groupId: groupId, label: '' },
      { kind: 'audiooutput', deviceId: makeDeviceId(sessionSeed, 'audiooutput'), groupId: groupId, label: '' },
      { kind: 'videoinput',  deviceId: makeDeviceId(sessionSeed, 'videoinput'),  groupId: groupId, label: '' },
    ];

    // Patch at prototype level (not instance) — native location.
    // Each call creates fresh device objects (distinct identity) with
    // stable values (same deviceId/groupId/kind/label).
    MediaDevices.prototype.enumerateDevices = disguise(function enumerateDevices() {
      const devices = deviceSpecs.map(function(spec) {
        const isInput = spec.kind === 'audioinput' || spec.kind === 'videoinput';
        const proto = isInput && IDI ? IDI.prototype : MDI.prototype;
        const dev = Object.create(proto);
        _devData.set(dev, spec);
        return dev;
      });
      return ORIG.promiseResolve.call(Promise, devices);
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

  // === Worker canvas noise override script ===
  // Workers have their own OffscreenCanvas/WebGL prototypes — unpatched by
  // the main-world installCanvas/installWebGL. This function returns a
  // self-contained IIFE that patches OffscreenCanvas.convertToBlob,
  // OffscreenCanvasRenderingContext2D.getImageData, and WebGL readPixels
  // inside the worker scope. Called at Worker construction time (not install
  // time) so profile.canvasSeed is read after seed convergence.
  //
  // The pixelNoise and applyCanvasNoise functions are inlined — identical
  // algorithm to canvas.js:19-41. The IIFE prevents variable leakage into
  // the worker global scope.
  //
  // Nested Worker protection: Workers can create sub-workers via self.Worker.
  // Without wrapping, nested workers bypass all overrides (the native Worker
  // constructor has no injection). The injected code includes a self.Worker
  // wrapper that injects navigator + canvas overrides into nested workers.
  // Depth-limited to 2 levels (Level 1 gets full overrides + wrapper,
  // Level 2 gets overrides only, Level 3+ unprotected). Two levels covers
  // all practical fingerprinting attack vectors.
  function buildCanvasWorkerOverrides(seed) {
    // Canvas-only IIFE — patches OffscreenCanvas and WebGL prototypes
    const canvasIife = `
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

    // Leaf overrides = navigator + canvas (no Worker wrapper).
    // Level 2 nested workers get these — they have full protection but
    // can't inject further (depth limit = 2).
    const leafOverrides = workerOverrides + canvasIife;

    // Nested Worker wrapper IIFE: intercepts self.Worker inside Level 1
    // workers to inject leafOverrides into any sub-workers they create.
    const nestedWorkerWrapper = `
;(function(){
  if(typeof Worker!=='undefined'){
    var _OW=Worker;
    var _ovr=${JSON.stringify(leafOverrides)};
    self.Worker=function(u,o){
      try{
        var ru=new URL(u,self.location.href).href;
        if(o&&o.type==='module'){
          var b=new Blob([_ovr+';\\nawait import('+JSON.stringify(ru)+');'],{type:'application/javascript'});
          return new _OW(URL.createObjectURL(b),Object.assign({},o,{type:'module'}));
        }else{
          var b=new Blob([_ovr+';\\nimportScripts('+JSON.stringify(ru)+');'],{type:'application/javascript'});
          return new _OW(URL.createObjectURL(b),o);
        }
      }catch(e){return new _OW(u,o);}
    };
    self.Worker.prototype=_OW.prototype;
  }
})();`;

    return canvasIife + nestedWorkerWrapper;
  }

  // === Web Worker scope leak prevention ===
  // Workers run in a separate global scope with unspoofed navigator.
  // Intercept Worker constructor to inject a wrapper that overrides
  // navigator properties inside the worker.
  if (typeof Worker !== "undefined") {
    const OrigWorker = Worker;

    window.Worker = disguise(function(url, opts) {
      const isModule = opts && opts.type === "module";
      // Build canvas overrides at construction time — reads profile.canvasSeed
      // AFTER convergence, not at installMisc time.
      const allOverrides = workerOverrides + buildCanvasWorkerOverrides(profile.canvasSeed);
      try {
        const origUrl = new URL(url, location.href).href;
        if (isModule) {
          // Module workers: can't use importScripts(). Prepend overrides,
          // then re-import the original script via dynamic import().
          // Blob URLs have opaque origins, so static `import "..."` with
          // relative paths would break. Dynamic import() with an absolute
          // URL works because it resolves against the network, not the blob origin.
          const blob = new Blob(
            [allOverrides + `;\nawait import(${JSON.stringify(origUrl)});`],
            { type: "application/javascript" }
          );
          return new OrigWorker(URL.createObjectURL(blob), { ...opts, type: "module" });
        } else {
          // Classic workers: prepend overrides, importScripts the original
          const blob = new Blob(
            [allOverrides + `;\nimportScripts(${JSON.stringify(origUrl)});`],
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
      const allOverrides = workerOverrides + buildCanvasWorkerOverrides(profile.canvasSeed);
      try {
        const origUrl = new URL(url, location.href).href;
        // SharedWorkers are always classic (no module support in most browsers).
        // Use importScripts to load the original script after overrides.
        const blob = new Blob(
          [allOverrides + `;\nimportScripts(${JSON.stringify(origUrl)});`],
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
  //   performance.now(): 0.1ms quantization + Gaussian jitter (±0.1ms max),
  //   monotonic-clamped to prevent backward movement.
  //   MouseEvent clientX/Y/screenX/Y/pageX/Y/x/y: ±0-1px Gaussian per-axis
  //   noise (all x-props share one noise, all y-props share another — preserves
  //   pageX-clientX=scrollX invariant). Skipped on synthetic events, editable
  //   elements, canvas, SVG, drag events, and allowlisted sites (Google Docs,
  //   Figma, Google Maps, OpenStreetMap, Excalidraw, Canva).
  //   WheelEvent deltaY/X: integer quantization removes sub-pixel
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
}
