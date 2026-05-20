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

  function spoofGlGetParameter(origFn) {
    return disguise(function(param) {
      if (param === 0x9245) return profile.gpu.vendor;
      if (param === 0x9246) return profile.gpu.renderer;
      if (activeGlCaps[param] !== undefined) return activeGlCaps[param];
      if (param === 0x0D3D) return new Int32Array(activeGlCaps.viewportDims);        // MAX_VIEWPORT_DIMS
      if (param === 0x846E) return new Float32Array(activeGlCaps.lineWidthRange);    // ALIASED_LINE_WIDTH_RANGE
      if (param === 0x8460) return new Float32Array(activeGlCaps.pointSizeRange);    // ALIASED_POINT_SIZE_RANGE
      if (param === 0x84FF) return activeGlCaps.maxAnisotropy;                       // MAX_TEXTURE_MAX_ANISOTROPY_EXT
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

  // === WebGL getExtension() coherence wrapper ===
  // getSupportedExtensions() advertises a normalized list; getExtension() must
  // return coherent objects for spoofed extensions, pass through for others,
  // and return null for extensions not in the advertised set.
  const COMMON_EXT_SET = new Set(COMMON_WEBGL_EXTENSIONS);

  function spoofGetExtension(origFn) {
    return disguise(function(name) {
      // Extensions not in our advertised set → null (coherent with getSupportedExtensions)
      if (!COMMON_EXT_SET.has(name)) return null;

      // WEBGL_debug_renderer_info: return constants matching spoofed vendor/renderer
      if (name === "WEBGL_debug_renderer_info") {
        // Try to get the real extension object to preserve native prototype
        const real = origFn.call(this, name);
        if (real) return real; // Real object has the correct constants (0x9245, 0x9246)
        // Fallback: return a stub with the standard constants
        return {
          UNMASKED_VENDOR_WEBGL: 0x9245,
          UNMASKED_RENDERER_WEBGL: 0x9246,
        };
      }

      // EXT_texture_filter_anisotropic: return object with MAX constant = 16
      if (name === "EXT_texture_filter_anisotropic") {
        const real = origFn.call(this, name);
        if (real) return real; // Real object has TEXTURE_MAX_ANISOTROPY_EXT + MAX constant
        // Fallback stub matching the spec constants
        return {
          TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE,
          MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF,
        };
      }

      // All other advertised extensions: pass through to native
      return origFn.call(this, name);
    }, "getExtension");
  }
  if (ORIG.glGetExtension) {
    WebGLRenderingContext.prototype.getExtension = spoofGetExtension(ORIG.glGetExtension);
  }
  if (ORIG.gl2GetExtension) {
    WebGL2RenderingContext.prototype.getExtension = spoofGetExtension(ORIG.gl2GetExtension);
  }

  // === WebGL getShaderPrecisionFormat normalization ===
  // Shader precision varies by GPU: mantissa bits, range min/max differ
  // across vendors. Normalize to highp everywhere (standard float: 23-bit
  // mantissa, [-127, 127] range) — common on desktop GPUs.
  // Option A (atlas): call real method to get native WebGLShaderPrecisionFormat
  // object, then mutate numeric fields. Preserves prototype/constructor/instanceof.
  function spoofGetShaderPrecisionFormat(origFn) {
    return disguise(function(shaderType, precisionType) {
      const real = origFn.call(this, shaderType, precisionType);
      if (!real) return real;
      // Mutate the native object's fields — preserves [[Class]], prototype chain,
      // instanceof WebGLShaderPrecisionFormat, descriptor shape, and toString tag.
      ORIG.defineProperty.call(Object, real, "rangeMin", { value: 127, writable: false, enumerable: true, configurable: false });
      ORIG.defineProperty.call(Object, real, "rangeMax", { value: 127, writable: false, enumerable: true, configurable: false });
      ORIG.defineProperty.call(Object, real, "precision", { value: 23, writable: false, enumerable: true, configurable: false });
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
