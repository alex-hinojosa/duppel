import { test, expect } from '../fixtures/extension';

test.describe('WebGL parameter normalization', () => {
  test('MAX_TEXTURE_SIZE returns 16384', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      return gl.getParameter(0x0D33); // MAX_TEXTURE_SIZE
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val).toBe(16384);
  });

  test('MAX_VIEWPORT_DIMS returns [32767, 32767]', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const dims = gl.getParameter(0x0D3D); // MAX_VIEWPORT_DIMS
      return [dims[0], dims[1]];
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val).toEqual([32767, 32767]);
  });

  test('ALIASED_LINE_WIDTH_RANGE returns [1, 1]', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const range = gl.getParameter(0x846E); // ALIASED_LINE_WIDTH_RANGE
      return [range[0], range[1]];
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val).toEqual([1, 1]);
  });

  test('ALIASED_POINT_SIZE_RANGE returns [1, 1024]', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const range = gl.getParameter(0x8460); // ALIASED_POINT_SIZE_RANGE
      return [range[0], range[1]];
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val).toEqual([1, 1024]);
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

  test('getShaderPrecisionFormat returns normalized values', async ({ extensionPage }) => {
    const val = await extensionPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const fmt = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (!fmt) return null;
      return { rangeMin: fmt.rangeMin, rangeMax: fmt.rangeMax, precision: fmt.precision };
    });
    if (val === null) { test.skip(true, 'WebGL not available'); return; }
    expect(val).toEqual({ rangeMin: 127, rangeMax: 127, precision: 23 });
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
  });
});
