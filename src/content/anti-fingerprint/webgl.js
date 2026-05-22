/**
 * Duppel — WebGL Fingerprint Spoofing Module
 * WebGL parameter spoofing, extensions, shader precision, readPixels, OffscreenCanvas noise.
 */

export function installWebGL(ctx) {
  const { ORIG, profile, disguise, applyCanvasNoise } = ctx;

  // === WebGL fingerprint spoofing (profile-bucketed) ===
  // WebGL capability parameters leak hardware identity through unique
  // combinations of limits. Caps are bucketed by renderer profile to
  // avoid contradiction fingerprints (e.g., Apple M1 caps on NVIDIA renderer).
  //
  // Cap buckets derived from real-world WebGL reports:
  // - apple: OpenGL 4.1 limits (M1/M2, Iris Plus on Mac)
  // - intel_low: Intel HD 620 class
  // - intel_mid: Intel UHD 630 / Iris Xe class
  // - nvidia_mid: GTX 1060 / RTX 3060 / AMD RX class
  // - nvidia_high: RTX 4070+ class
  const GL_CAP_BUCKETS = {
    apple: {
      0x0D33: 16384, 0x851C: 16384, 0x84E8: 16384,
      0x8869: 16, 0x8872: 4096, 0x8B4C: 16, 0x8871: 30,
      0x8824: 1024, 0x8B4D: 16, 0x8B4A: 32,
      viewportDims: [16384, 16384], lineWidthRange: [1, 1],
      pointSizeRange: [1, 255], maxAnisotropy: 16,
    },
    intel_low: {
      0x0D33: 16384, 0x851C: 16384, 0x84E8: 16384,
      0x8869: 16, 0x8872: 4096, 0x8B4C: 16, 0x8871: 30,
      0x8824: 1024, 0x8B4D: 16, 0x8B4A: 32,
      viewportDims: [16384, 16384], lineWidthRange: [1, 7.375],
      pointSizeRange: [1, 255], maxAnisotropy: 16,
    },
    intel_mid: {
      0x0D33: 16384, 0x851C: 16384, 0x84E8: 16384,
      0x8869: 16, 0x8872: 4096, 0x8B4C: 16, 0x8871: 30,
      0x8824: 1024, 0x8B4D: 16, 0x8B4A: 32,
      viewportDims: [32767, 32767], lineWidthRange: [1, 7.375],
      pointSizeRange: [1, 255], maxAnisotropy: 16,
    },
    nvidia_mid: {
      0x0D33: 16384, 0x851C: 16384, 0x84E8: 16384,
      0x8869: 16, 0x8872: 4096, 0x8B4C: 16, 0x8871: 32,
      0x8824: 1024, 0x8B4D: 16, 0x8B4A: 32,
      viewportDims: [32767, 32767], lineWidthRange: [1, 1],
      pointSizeRange: [1, 1024], maxAnisotropy: 16,
    },
    nvidia_high: {
      0x0D33: 32768, 0x851C: 32768, 0x84E8: 32768,
      0x8869: 16, 0x8872: 4096, 0x8B4C: 16, 0x8871: 32,
      0x8824: 1024, 0x8B4D: 16, 0x8B4A: 32,
      viewportDims: [32767, 32767], lineWidthRange: [1, 1],
      pointSizeRange: [1, 1024], maxAnisotropy: 16,
    },
  };

  // Map renderer strings to cap buckets
  function getCapBucket(renderer) {
    if (/Apple\s+M[12]/.test(renderer)) return GL_CAP_BUCKETS.apple;
    if (/Iris.*Plus/.test(renderer)) return GL_CAP_BUCKETS.apple; // Mac Intel Iris Plus uses same OGL 4.1 limits
    if (/HD\s+Graphics\s+6[12]0/.test(renderer)) return GL_CAP_BUCKETS.intel_low;
    if (/UHD\s+Graphics|Iris.*Xe/.test(renderer)) return GL_CAP_BUCKETS.intel_mid;
    if (/RTX\s+4/.test(renderer)) return GL_CAP_BUCKETS.nvidia_high;
    // GTX, RTX 3xxx, AMD RX → nvidia_mid (shared mid-range discrete GPU bucket)
    return GL_CAP_BUCKETS.nvidia_mid;
  }

  const activeGlCaps = getCapBucket(profile.gpu.renderer);

  // Safe passthrough params: state queries + browser-normalized values that
  // don't leak hardware identity. These reflect current WebGL state or are
  // already normalized by Chrome (VERSION = "WebGL 1.0", VENDOR = "WebKit").
  var GL_SAFE_PASSTHROUGH = new Set([
    0x1F00, // VENDOR ("WebKit" — browser-normalized)
    0x1F01, // RENDERER ("WebKit WebGL" — browser-normalized)
    0x1F02, // VERSION ("WebGL 1.0 (OpenGL ES 2.0 Chromium)")
    0x8B8C, // SHADING_LANGUAGE_VERSION
    // Current state queries (reflect app state, not hardware)
    0x0B44, 0x0B45, 0x0B46, 0x0B47, // CULL_FACE, CULL_FACE_MODE, FRONT_FACE, DEPTH_RANGE
    0x0B70, 0x0B71, 0x0B72, 0x0B73, // DITHER, BLEND_DST, BLEND_SRC, BLEND
    0x0B74, 0x0C10, 0x0C11, 0x0C22, // LOGIC_OP_MODE, SCISSOR_BOX, SCISSOR_TEST, COLOR_CLEAR_VALUE
    0x0C23, 0x0BA1, 0x0BA2, 0x0BE2, // COLOR_WRITEMASK, VIEWPORT, DEPTH_TEST, BLEND_SRC_ALPHA
    0x0B52, 0x0B54, 0x0B56, 0x0B21, // LINE_SMOOTH, POLYGON_SMOOTH, DEPTH_WRITEMASK, DEPTH_FUNC
    0x0D55, 0x0D56, 0x0D57, 0x0D58, // RED_BITS, GREEN_BITS, BLUE_BITS, ALPHA_BITS
    0x0D52, 0x0D53, 0x0D54,         // SUBPIXEL_BITS, DEPTH_BITS, STENCIL_BITS
    0x8005, 0x8006, 0x8009, 0x800A, // BLEND_COLOR, BLEND_EQUATION, BLEND_EQUATION_RGB, BLEND_EQUATION_ALPHA
    0x80C8, 0x80C9, 0x80CA, 0x80CB, // BLEND_DST_RGB, BLEND_SRC_RGB, BLEND_DST_ALPHA, BLEND_SRC_ALPHA
    0x8894, 0x8895,                   // ARRAY_BUFFER_BINDING, ELEMENT_ARRAY_BUFFER_BINDING
    0x8B8D,                           // CURRENT_PROGRAM
    0x8CA6, 0x8CA7,                   // FRAMEBUFFER_BINDING, RENDERBUFFER_BINDING
    0x0B57,                           // DEPTH_CLEAR_VALUE
    0x8069, 0x8514,                   // TEXTURE_BINDING_2D, TEXTURE_BINDING_CUBE_MAP
    0x84E0,                           // ACTIVE_TEXTURE
    0x846D,                           // POLYGON_OFFSET_FACTOR (state, not capability)
    0x8038,                           // POLYGON_OFFSET_UNITS
    0x8037, 0x2A00,                   // POLYGON_OFFSET_FILL, POLYGON_OFFSET_LINE (state toggles)
    0x8B49, 0x8DFB,                   // MAX_VERTEX_UNIFORM_VECTORS duplicate, READ_FRAMEBUFFER_BINDING (WebGL2)
    0x0CF5, 0x0D05,                   // UNPACK_ALIGNMENT, PACK_ALIGNMENT
    0x84C0,                           // TEXTURE0
    0x0B71,                           // BLEND_SRC_RGB (duplicate-safe in Set)
    0x8C2F,                           // ANY_SAMPLES_PASSED (WebGL2 query)
  ]);

  function spoofGlGetParameter(origFn) {
    return disguise(function(param) {
      if (param === 0x9245) return profile.gpu.vendor;
      if (param === 0x9246) return profile.gpu.renderer;
      if (activeGlCaps[param] !== undefined) return activeGlCaps[param];
      if (param === 0x0D3D) return new Int32Array(activeGlCaps.viewportDims);        // MAX_VIEWPORT_DIMS
      if (param === 0x846E) return new Float32Array(activeGlCaps.lineWidthRange);    // ALIASED_LINE_WIDTH_RANGE
      if (param === 0x8460) return new Float32Array(activeGlCaps.pointSizeRange);    // ALIASED_POINT_SIZE_RANGE
      if (param === 0x84FF) return activeGlCaps.maxAnisotropy;                       // MAX_TEXTURE_MAX_ANISOTROPY_EXT
      // Safe passthrough: state queries and browser-normalized values
      if (GL_SAFE_PASSTHROUGH.has(param)) return origFn.call(this, param);
      // Fail-closed: unknown params return null instead of leaking real GPU caps.
      // WebGL spec: getParameter returns null for unsupported/unknown params.
      return null;
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
  //
  // Round 7 (P1-6, rowan review): only advertise extensions that are either
  // (a) natively available (pass-through to real implementation), or
  // (b) have explicit coherent stubs (WEBGL_debug_renderer_info,
  //     EXT_texture_filter_anisotropic). This prevents returning generic {}
  //     stubs which are detectable (wrong prototype, missing constants).
  const BASELINE_WEBGL_EXTENSIONS = [
    "ANGLE_instanced_arrays", "EXT_blend_minmax", "EXT_color_buffer_half_float",
    "EXT_float_blend", "EXT_frag_depth", "EXT_shader_texture_lod",
    "EXT_texture_filter_anisotropic", "OES_element_index_uint",
    "OES_standard_derivatives", "OES_texture_float", "OES_texture_float_linear",
    "OES_texture_half_float", "OES_texture_half_float_linear",
    "OES_vertex_array_object", "WEBGL_color_buffer_float",
    "WEBGL_compressed_texture_s3tc", "WEBGL_debug_renderer_info",
    "WEBGL_depth_texture", "WEBGL_draw_buffers", "WEBGL_lose_context",
  ];
  // Extensions we have explicit stubs for — always safe to advertise
  var STUBBED_EXTENSIONS = new Set([
    "WEBGL_debug_renderer_info",
    "EXT_texture_filter_anisotropic",
  ]);
  var BASELINE_SET = new Set(BASELINE_WEBGL_EXTENSIONS);
  function makeSpoofedGetSupportedExtensions(origGetSupportedFn) {
    return disguise(function() {
      // Get real native extensions, intersect with our baseline.
      // Only advertise what we can back with a real object or a coherent stub.
      var nativeExts = new Set(origGetSupportedFn ? origGetSupportedFn.call(this) || [] : []);
      return BASELINE_WEBGL_EXTENSIONS.filter(function(ext) {
        return STUBBED_EXTENSIONS.has(ext) || nativeExts.has(ext);
      });
    }, "getSupportedExtensions");
  }
  if (typeof WebGLRenderingContext !== "undefined" && ORIG.glGetSupportedExtensions) {
    WebGLRenderingContext.prototype.getSupportedExtensions =
      makeSpoofedGetSupportedExtensions(ORIG.glGetSupportedExtensions);
  }
  if (typeof WebGL2RenderingContext !== "undefined" && ORIG.gl2GetSupportedExtensions) {
    WebGL2RenderingContext.prototype.getSupportedExtensions =
      makeSpoofedGetSupportedExtensions(ORIG.gl2GetSupportedExtensions);
  }

  // === WebGL getExtension() coherence wrapper ===
  // getSupportedExtensions() advertises a runtime-filtered list; getExtension()
  // returns the real native object for natively available extensions, coherent
  // stubs for explicitly stubbed extensions, and null for everything else.
  function spoofGetExtension(origFn, origGetSupportedFn) {
    return disguise(function(name) {
      // Build the coherent advertised set for this context (same logic as
      // getSupportedExtensions to avoid advertise/get mismatch).
      var nativeExts = new Set(origGetSupportedFn ? origGetSupportedFn.call(this) || [] : []);
      var advertised = BASELINE_WEBGL_EXTENSIONS.filter(function(ext) {
        return STUBBED_EXTENSIONS.has(ext) || nativeExts.has(ext);
      });
      var advertisedSet = new Set(advertised);

      // Extensions not in our advertised set → null
      if (!advertisedSet.has(name)) return null;

      // WEBGL_debug_renderer_info: return constants matching spoofed vendor/renderer
      if (name === "WEBGL_debug_renderer_info") {
        var real = origFn.call(this, name);
        if (real) return real; // Real object has the correct constants (0x9245, 0x9246)
        // Fallback: return a stub with the standard constants
        return {
          UNMASKED_VENDOR_WEBGL: 0x9245,
          UNMASKED_RENDERER_WEBGL: 0x9246,
        };
      }

      // EXT_texture_filter_anisotropic: return object with MAX constant = 16
      if (name === "EXT_texture_filter_anisotropic") {
        var real = origFn.call(this, name);
        if (real) return real;
        return {
          TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE,
          MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF,
        };
      }

      // All other advertised extensions: pass through to native.
      // Since we only advertise natively available extensions, this returns
      // the real object (never null for a correctly advertised extension).
      return origFn.call(this, name);
    }, "getExtension");
  }
  if (ORIG.glGetExtension) {
    WebGLRenderingContext.prototype.getExtension = spoofGetExtension(ORIG.glGetExtension, ORIG.glGetSupportedExtensions);
  }
  if (ORIG.gl2GetExtension) {
    WebGL2RenderingContext.prototype.getExtension = spoofGetExtension(ORIG.gl2GetExtension, ORIG.gl2GetSupportedExtensions);
  }

  // === WebGL getShaderPrecisionFormat normalization ===
  // Shader precision varies by GPU: mantissa bits, range min/max differ
  // across vendors. Normalize per precision tier (lowp/mediump/highp) to
  // avoid detectable anomaly of all tiers returning identical values.
  // Values derived from desktop Chromium on Intel/NVIDIA/Apple GPUs.
  // Option A (atlas): call real method to get native WebGLShaderPrecisionFormat
  // object, then mutate numeric fields. Preserves prototype/constructor/instanceof.
  var PRECISION_TIERS = {};
  PRECISION_TIERS[0x8DF0] = { rangeMin: 1,   rangeMax: 1,   precision: 8  }; // LOW_FLOAT
  PRECISION_TIERS[0x8DF1] = { rangeMin: 14,  rangeMax: 14,  precision: 10 }; // MEDIUM_FLOAT
  PRECISION_TIERS[0x8DF2] = { rangeMin: 127, rangeMax: 127, precision: 23 }; // HIGH_FLOAT
  PRECISION_TIERS[0x8DF3] = { rangeMin: 8,   rangeMax: 8,   precision: 0  }; // LOW_INT
  PRECISION_TIERS[0x8DF4] = { rangeMin: 16,  rangeMax: 16,  precision: 0  }; // MEDIUM_INT
  PRECISION_TIERS[0x8DF5] = { rangeMin: 24,  rangeMax: 24,  precision: 0  }; // HIGH_INT

  function spoofGetShaderPrecisionFormat(origFn) {
    return disguise(function(shaderType, precisionType) {
      const real = origFn.call(this, shaderType, precisionType);
      if (!real) return real;
      var tier = PRECISION_TIERS[precisionType];
      if (!tier) tier = PRECISION_TIERS[0x8DF2]; // fallback to highp
      // Mutate the native object's fields — preserves [[Class]], prototype chain,
      // instanceof WebGLShaderPrecisionFormat, descriptor shape, and toString tag.
      ORIG.defineProperty.call(Object, real, "rangeMin", { value: tier.rangeMin, writable: false, enumerable: true, configurable: false });
      ORIG.defineProperty.call(Object, real, "rangeMax", { value: tier.rangeMax, writable: false, enumerable: true, configurable: false });
      ORIG.defineProperty.call(Object, real, "precision", { value: tier.precision, writable: false, enumerable: true, configurable: false });
      return real;
    }, "getShaderPrecisionFormat");
  }
  if (ORIG.glGetShaderPrecisionFormat) {
    WebGLRenderingContext.prototype.getShaderPrecisionFormat = spoofGetShaderPrecisionFormat(ORIG.glGetShaderPrecisionFormat);
  }
  if (ORIG.gl2GetShaderPrecisionFormat) {
    WebGL2RenderingContext.prototype.getShaderPrecisionFormat = spoofGetShaderPrecisionFormat(ORIG.gl2GetShaderPrecisionFormat);
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
          const ocCtx = this.getContext("2d");
          if (ocCtx) {
            const getImageData = ORIG.offscreenGetImageData || ocCtx.getImageData.bind(ocCtx);
            const id = getImageData.call(ocCtx, 0, 0, this.width, this.height);
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
}
