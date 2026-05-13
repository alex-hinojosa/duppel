import { test, expect } from '../fixtures/extension';

test.describe('WebGL parameter normalization', () => {
  test('MAX_TEXTURE_SIZE returns expected value per bucket', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      return gl.getParameter(0x0D33); // MAX_TEXTURE_SIZE
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect([16384, 32768]).toContain(val);
  });

  test('MAX_VIEWPORT_DIMS returns profile-coherent Int32Array', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const dims = gl.getParameter(0x0D3D); // MAX_VIEWPORT_DIMS
      return {
        values: [dims[0], dims[1]],
        isInt32Array: dims instanceof Int32Array,
        constructorName: dims.constructor?.name,
      };
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect([[16384, 16384], [32767, 32767]]).toContainEqual(val.values);
    expect(val.isInt32Array).toBe(true);
    expect(val.constructorName).toBe('Int32Array');
  });

  test('ALIASED_LINE_WIDTH_RANGE returns profile-coherent Float32Array', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const range = gl.getParameter(0x846E); // ALIASED_LINE_WIDTH_RANGE
      return {
        values: [range[0], range[1]],
        isFloat32Array: range instanceof Float32Array,
        constructorName: range.constructor?.name,
      };
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect([[1, 1], [1, 7.375]]).toContainEqual(val.values);
    expect(val.isFloat32Array).toBe(true);
    expect(val.constructorName).toBe('Float32Array');
  });

  test('ALIASED_POINT_SIZE_RANGE returns profile-coherent Float32Array', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const range = gl.getParameter(0x8460); // ALIASED_POINT_SIZE_RANGE
      return {
        values: [range[0], range[1]],
        isFloat32Array: range instanceof Float32Array,
      };
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect([[1, 255], [1, 1024]]).toContainEqual(val.values);
    expect(val.isFloat32Array).toBe(true);
  });

  test('MAX_VERTEX_ATTRIBS returns 16', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      return gl.getParameter(0x8869); // MAX_VERTEX_ATTRIBS
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val).toBe(16);
  });

  test('MAX_FRAGMENT_UNIFORM_VECTORS returns 1024', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      return gl.getParameter(0x8824); // MAX_FRAGMENT_UNIFORM_VECTORS
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val).toBe(1024);
  });

  test('MAX_COMBINED_TEXTURE_IMAGE_UNITS returns 32', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      return gl.getParameter(0x8B4A); // MAX_COMBINED_TEXTURE_IMAGE_UNITS
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val).toBe(32);
  });

  test('getShaderPrecisionFormat returns normalized values with native shape', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const fmt = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (!fmt) return null;
      return {
        rangeMin: fmt.rangeMin,
        rangeMax: fmt.rangeMax,
        precision: fmt.precision,
        isInstance: fmt instanceof WebGLShaderPrecisionFormat,
        protoName: Object.getPrototypeOf(fmt)?.constructor?.name,
        toStringTag: Object.prototype.toString.call(fmt),
      };
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val.rangeMin).toBe(127);
    expect(val.rangeMax).toBe(127);
    expect(val.precision).toBe(23);
    // Native shape probes — must pass instanceof and have correct prototype
    expect(val.isInstance).toBe(true);
    expect(val.protoName).toBe('WebGLShaderPrecisionFormat');
  });

  test('getSupportedExtensions returns normalized list', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      return gl.getSupportedExtensions();
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val).toContain('ANGLE_instanced_arrays');
    expect(val).toContain('WEBGL_debug_renderer_info');
    expect(val).toContain('OES_texture_float');
    expect(val).toContain('EXT_texture_filter_anisotropic');
  });

  test('getExtension returns coherent EXT_texture_filter_anisotropic', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (!ext) return { available: false };
      return {
        available: true,
        hasMaxConst: 'MAX_TEXTURE_MAX_ANISOTROPY_EXT' in ext,
        hasTexConst: 'TEXTURE_MAX_ANISOTROPY_EXT' in ext,
        maxAnisotropy: gl.getParameter(ext.TEXTURE_MAX_ANISOTROPY_EXT),
      };
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val.available).toBe(true);
    expect(val.hasMaxConst).toBe(true);
    expect(val.hasTexConst).toBe(true);
    // MAX_ANISOTROPY from getParameter must match the profile
    expect(val.maxAnisotropy).toBe(16);
  });

  test('getExtension returns coherent WEBGL_debug_renderer_info', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (!ext) return { available: false };
      return {
        available: true,
        hasVendor: 'UNMASKED_VENDOR_WEBGL' in ext,
        hasRenderer: 'UNMASKED_RENDERER_WEBGL' in ext,
        vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
      };
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val.available).toBe(true);
    expect(val.hasVendor).toBe(true);
    expect(val.hasRenderer).toBe(true);
    // Vendor and renderer must be non-empty strings from the profile
    expect(typeof val.vendor).toBe('string');
    expect(val.vendor!.length).toBeGreaterThan(0);
    expect(typeof val.renderer).toBe('string');
    expect(val.renderer!.length).toBeGreaterThan(0);
  });

  test('getExtension returns null for unsupported extension', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return 'no-webgl';
      return gl.getExtension('WEBGL_compressed_texture_astc');
    });
    if (val === 'no-webgl') { test.skip(true, 'WebGL not available'); return; }
    expect(val).toBeNull();
  });

  test('WebGL2 context returns same spoofed vendor/renderer', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl1 = document.createElement('canvas').getContext('webgl');
      const gl2 = document.createElement('canvas').getContext('webgl2');
      if (!gl1 || !gl2) return null;
      return {
        gl1Vendor: gl1.getParameter(0x9245),
        gl1Renderer: gl1.getParameter(0x9246),
        gl2Vendor: gl2.getParameter(0x9245),
        gl2Renderer: gl2.getParameter(0x9246),
        gl2MaxTexture: gl2.getParameter(0x0D33),
      };
    });
    if (val === null) { test.skip(true, 'WebGL2 not available'); return; }
    expect(val.gl1Vendor).toBe(val.gl2Vendor);
    expect(val.gl1Renderer).toBe(val.gl2Renderer);
    // WebGL2 must also return a bucketed MAX_TEXTURE_SIZE
    expect([16384, 32768]).toContain(val.gl2MaxTexture);
  });

  test('negative tamper probe: spoofed getShaderPrecisionFormat is not a plain object', async ({ extensionPage }) => {
    // Defensive assertion: if the spoof were broken and returned a plain object,
    // these probes would catch it. This test asserts the anti-detection properties.
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const fmt = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT);
      if (!fmt) return null;
      return {
        // A plain {} would fail all of these
        isInstance: fmt instanceof WebGLShaderPrecisionFormat,
        protoIsNotObjectProto: Object.getPrototypeOf(fmt) !== Object.prototype,
        constructorIsNotObject: fmt.constructor !== Object,
        toStringTag: Object.prototype.toString.call(fmt),
      };
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val.isInstance).toBe(true);
    expect(val.protoIsNotObjectProto).toBe(true);
    expect(val.constructorIsNotObject).toBe(true);
    // toString tag should NOT be "[object Object]" (that's the detection signal)
    expect(val.toStringTag).not.toBe('[object Object]');
  });

  test('GL caps are coherent with selected renderer profile', async ({ extensionPage }) => {
    // Verifies no contradiction fingerprint: Apple renderers should have
    // Apple-class caps, NVIDIA should have NVIDIA-class caps, etc.
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
      const maxTex = gl.getParameter(0x0D33);
      const dims = gl.getParameter(0x0D3D);
      const lineWidth = gl.getParameter(0x846E);
      return {
        renderer,
        maxTex,
        viewportDim0: dims[0],
        lineWidthMax: lineWidth[1],
      };
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }

    const r = val.renderer as string;
    if (/Apple|Iris.*Plus/.test(r)) {
      // Apple/Mac Intel profiles: viewport 16384, line width 1
      expect(val.viewportDim0).toBe(16384);
      expect(val.lineWidthMax).toBe(1);
      expect(val.maxTex).toBe(16384);
    } else if (/RTX\s+4/.test(r)) {
      // High-end NVIDIA: max texture 32768
      expect(val.maxTex).toBe(32768);
    } else if (/HD\s+Graphics\s+6[12]0/.test(r)) {
      // Intel low: viewport 16384, line width 7.375
      expect(val.viewportDim0).toBe(16384);
      expect(val.lineWidthMax).toBe(7.375);
    }
    // All profiles: MAX_TEXTURE_SIZE is either 16384 or 32768
    expect([16384, 32768]).toContain(val.maxTex);
  });
});

test.describe('Canvas noise bounds', () => {
  test('noise max delta <= 3 per channel', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#808080'; // 128,128,128
      ctx.fillRect(0, 0, c.width, c.height);

      const id = ctx.getImageData(0, 0, c.width, c.height);
      let maxDelta = 0;
      for (let i = 0; i < id.data.length; i += 4) {
        for (let ch = 0; ch < 3; ch++) {
          const delta = Math.abs(id.data[i + ch] - 128);
          if (delta > maxDelta) maxDelta = delta;
        }
      }
      return maxDelta;
    });
    expect(result).toBeGreaterThan(0); // noise is applied
    expect(result).toBeLessThanOrEqual(3); // bounded to ±3
  });

  test('alpha channel preserved under noise', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      // Fill with known alpha = 255
      ctx.fillStyle = 'rgba(128, 128, 128, 1.0)';
      ctx.fillRect(0, 0, c.width, c.height);

      const id = ctx.getImageData(0, 0, c.width, c.height);
      let allAlpha255 = true;
      for (let i = 3; i < id.data.length; i += 4) {
        if (id.data[i] !== 255) { allAlpha255 = false; break; }
      }
      return allAlpha255;
    });
    expect(result).toBe(true);
  });
});
