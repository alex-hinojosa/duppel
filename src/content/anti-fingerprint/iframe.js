/**
 * PhantomGrid — iframe Realm Canvas Protection
 *
 * Intercepts HTMLIFrameElement.prototype.contentDocument/contentWindow
 * getters to patch canvas prototypes in same-origin iframe realms lazily
 * on first access. Fixes the about:blank iframe bypass where fingerprinters
 * (BrowserLeaks, etc.) create canvases through iframe.contentDocument to
 * obtain clean un-patched prototype chains.
 *
 * Design constraints (rowan UID 400):
 * - Lazy patch-on-access only; no createElement interception
 * - Preserve native getter behavior exactly
 * - Cross-origin frames: do not inspect or mutate, catch around probing
 * - Idempotent per target realm
 * - Disguise overridden getters with same toString/descriptor hardening
 */

export function installIframe(ctx) {
  const { ORIG, profile, disguise, spoof, applyCanvasNoise } = ctx;
  const seed = profile.canvasSeed;

  // Track patched realms — WeakSet keyed by window object for idempotency
  const _patchedRealms = new WeakSet();

  /**
   * Create a noisy clone of a source canvas using the parent frame's
   * document and ORIG references. Uses ORIG.getImageData to avoid
   * double-noising (same pattern as canvas.js noisyClone).
   */
  function noisyClone(src) {
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    const cctx = c.getContext("2d");
    cctx.drawImage(src, 0, 0);
    const id = ORIG.getImageData.call(cctx, 0, 0, c.width, c.height);
    applyCanvasNoise(id.data, seed);
    cctx.putImageData(id, 0, 0);
    return c;
  }

  /**
   * Patch an iframe window's canvas prototypes with noise.
   * Saves the iframe's native references before wrapping (same ORIG
   * pattern as core.js), then applies canvas noise using the parent
   * frame's seed for session consistency.
   */
  function patchIframeRealm(win) {
    if (!win) return;
    if (_patchedRealms.has(win)) return;

    // Probe same-origin accessibility before touching anything.
    // Cross-origin access throws — catch and leave untouched.
    try {
      if (!win.HTMLCanvasElement) return;
    } catch (e) {
      return;
    }

    _patchedRealms.add(win);

    // === Canvas 2D ===
    try {
      const iOrigTDU = win.HTMLCanvasElement.prototype.toDataURL;
      const iOrigTB = win.HTMLCanvasElement.prototype.toBlob;
      const iOrigGID = win.CanvasRenderingContext2D.prototype.getImageData;

      win.HTMLCanvasElement.prototype.toDataURL = disguise(function (...args) {
        try {
          if (this.width > 0 && this.height > 0)
            return iOrigTDU.apply(noisyClone(this), args);
        } catch (e) {}
        return iOrigTDU.apply(this, args);
      }, "toDataURL");

      win.HTMLCanvasElement.prototype.toBlob = disguise(function (cb, ...args) {
        try {
          if (this.width > 0 && this.height > 0)
            return iOrigTB.call(noisyClone(this), cb, ...args);
        } catch (e) {}
        return iOrigTB.call(this, cb, ...args);
      }, "toBlob");

      win.CanvasRenderingContext2D.prototype.getImageData = disguise(
        function (...args) {
          const id = iOrigGID.apply(this, args);
          applyCanvasNoise(id.data, seed);
          return id;
        },
        "getImageData",
        4
      );
    } catch (e) {}

    // === WebGL readPixels ===
    try {
      if (win.WebGLRenderingContext) {
        const iOrigRP = win.WebGLRenderingContext.prototype.readPixels;
        win.WebGLRenderingContext.prototype.readPixels = disguise(
          function (x, y, w, h, format, type, pixels) {
            iOrigRP.call(this, x, y, w, h, format, type, pixels);
            if (pixels && format === 0x1908 && type === 0x1401) {
              applyCanvasNoise(pixels, seed);
            }
          },
          "readPixels"
        );
      }
    } catch (e) {}

    try {
      if (win.WebGL2RenderingContext) {
        const iOrigRP2 = win.WebGL2RenderingContext.prototype.readPixels;
        win.WebGL2RenderingContext.prototype.readPixels = disguise(
          function (x, y, w, h, format, type, pixels) {
            iOrigRP2.call(this, x, y, w, h, format, type, pixels);
            if (pixels && format === 0x1908 && type === 0x1401) {
              applyCanvasNoise(pixels, seed);
            }
          },
          "readPixels"
        );
      }
    } catch (e) {}

    // === OffscreenCanvas ===
    try {
      if (win.OffscreenCanvas) {
        const iOrigOCB = win.OffscreenCanvas.prototype.convertToBlob;
        let iOrigOCGID = null;
        if (win.OffscreenCanvasRenderingContext2D) {
          iOrigOCGID =
            win.OffscreenCanvasRenderingContext2D.prototype.getImageData;
        }

        win.OffscreenCanvas.prototype.convertToBlob = disguise(
          function (...args) {
            try {
              if (this.width > 0 && this.height > 0) {
                const octx = this.getContext("2d");
                if (octx) {
                  const gid = iOrigOCGID || octx.getImageData.bind(octx);
                  const id = gid.call(octx, 0, 0, this.width, this.height);
                  applyCanvasNoise(id.data, seed);
                  const tmp = new win.OffscreenCanvas(this.width, this.height);
                  const tmpCtx = tmp.getContext("2d");
                  tmpCtx.putImageData(id, 0, 0);
                  return iOrigOCB.apply(tmp, args);
                }
              }
            } catch (e) {}
            return iOrigOCB.apply(this, args);
          },
          "convertToBlob"
        );

        if (iOrigOCGID) {
          win.OffscreenCanvasRenderingContext2D.prototype.getImageData =
            disguise(function (...args) {
              const id = iOrigOCGID.apply(this, args);
              applyCanvasNoise(id.data, seed);
              return id;
            }, "getImageData", 4);
        }
      }
    } catch (e) {}
  }

  // === Intercept contentDocument getter ===
  // Save pristine getter BEFORE overriding.
  const cdDesc = ORIG.getOwnPropertyDescriptor.call(
    Object,
    HTMLIFrameElement.prototype,
    "contentDocument"
  );
  if (cdDesc && cdDesc.get) {
    const origCDGetter = cdDesc.get;
    spoof(HTMLIFrameElement.prototype, "contentDocument", function () {
      const doc = origCDGetter.call(this);
      if (doc) {
        try {
          patchIframeRealm(doc.defaultView);
        } catch (e) {}
      }
      return doc;
    });
  }

  // === Intercept contentWindow getter ===
  const cwDesc = ORIG.getOwnPropertyDescriptor.call(
    Object,
    HTMLIFrameElement.prototype,
    "contentWindow"
  );
  if (cwDesc && cwDesc.get) {
    const origCWGetter = cwDesc.get;
    spoof(HTMLIFrameElement.prototype, "contentWindow", function () {
      const win = origCWGetter.call(this);
      if (win) {
        try {
          patchIframeRealm(win);
        } catch (e) {}
      }
      return win;
    });
  }
}
