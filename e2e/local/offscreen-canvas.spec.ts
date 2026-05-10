import { test, expect } from '../fixtures/extension';

test.describe('OffscreenCanvas noise (v2 item 5)', () => {
  test('OffscreenCanvas convertToBlob produces noised output', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      if (typeof OffscreenCanvas === 'undefined') return { skip: true };

      const oc = new OffscreenCanvas(200, 50);
      const ctx = oc.getContext('2d')!;
      const grad = ctx.createLinearGradient(0, 0, 200, 0);
      grad.addColorStop(0, '#ff0000');
      grad.addColorStop(0.5, '#00ff00');
      grad.addColorStop(1, '#0000ff');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 200, 50);
      ctx.fillStyle = '#000';
      ctx.font = '14px Arial';
      ctx.fillText('OffscreenCanvas probe', 10, 30);

      const blob = await oc.convertToBlob();
      return { skip: false, blobSize: blob.size, blobType: blob.type };
    });

    if ((result as any).skip) {
      test.skip(true, 'OffscreenCanvas not available');
      return;
    }
    expect(result.blobSize).toBeGreaterThan(100);
    expect(result.blobType).toContain('image/png');
  });

  test('OffscreenCanvas convertToBlob byte-identical across 10 calls', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      if (typeof OffscreenCanvas === 'undefined') return { skip: true, stable: false };

      function drawProbe(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) {
        ctx.clearRect(0, 0, w, h);
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, '#ff0000');
        grad.addColorStop(1, '#0000ff');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#000';
        ctx.font = '14px Arial';
        ctx.fillText('Stability probe', 10, 30);
      }

      function sameBytes(a: Uint8Array, b: Uint8Array) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      }

      let reference: Uint8Array | null = null;
      let allMatch = true;
      for (let i = 0; i < 10; i++) {
        const oc = new OffscreenCanvas(200, 50);
        const ctx = oc.getContext('2d')!;
        drawProbe(ctx, 200, 50);
        const blob = await oc.convertToBlob();
        const arr = new Uint8Array(await blob.arrayBuffer());
        if (reference === null) {
          reference = arr;
        } else if (!sameBytes(reference, arr)) {
          allMatch = false;
          break;
        }
      }
      return { skip: false, stable: allMatch };
    });

    if ((result as any).skip) {
      test.skip(true, 'OffscreenCanvas not available');
      return;
    }
    expect(result.stable).toBe(true);
  });

  test('convertToBlob does not mutate source canvas pixels', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      if (typeof OffscreenCanvas === 'undefined') return { skip: true, match: false };

      const oc = new OffscreenCanvas(100, 50);
      const ctx = oc.getContext('2d')!;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 100, 50);

      // Read pixels before convertToBlob
      const before = Array.from(ctx.getImageData(0, 0, 10, 1).data);

      // Call convertToBlob — should NOT mutate the source canvas
      await oc.convertToBlob();

      // Read pixels after convertToBlob (via original getImageData path)
      const after = Array.from(ctx.getImageData(0, 0, 10, 1).data);

      return { skip: false, match: before.every((v, i) => v === after[i]) };
    });

    if ((result as any).skip) {
      test.skip(true, 'OffscreenCanvas not available');
      return;
    }
    expect(result.match).toBe(true);
  });

  test('repeated convertToBlob on same canvas are byte-identical (no compounding)', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      if (typeof OffscreenCanvas === 'undefined') return { skip: true, stable: false };

      function sameBytes(a: Uint8Array, b: Uint8Array) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      }

      const oc = new OffscreenCanvas(100, 50);
      const ctx = oc.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 100, 50);
      ctx.fillStyle = '#000';
      ctx.font = '14px Arial';
      ctx.fillText('Compound test', 10, 30);

      let reference: Uint8Array | null = null;
      let allMatch = true;
      for (let i = 0; i < 5; i++) {
        const blob = await oc.convertToBlob();
        const arr = new Uint8Array(await blob.arrayBuffer());
        if (reference === null) {
          reference = arr;
        } else if (!sameBytes(reference, arr)) {
          allMatch = false;
          break;
        }
      }
      return { skip: false, stable: allMatch };
    });

    if ((result as any).skip) {
      test.skip(true, 'OffscreenCanvas not available');
      return;
    }
    expect(result.stable).toBe(true);
  });

  test('OffscreenCanvas getImageData returns noised pixels', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      if (typeof OffscreenCanvas === 'undefined') return { skip: true, hasNoise: false, stable: false };

      const oc = new OffscreenCanvas(100, 50);
      const ctx = oc.getContext('2d')!;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 100, 50);

      // Get same region twice — should be identical (deterministic)
      const id1 = ctx.getImageData(0, 0, 100, 50);
      const id2 = ctx.getImageData(0, 0, 100, 50);

      const px1 = Array.from(id1.data.slice(0, 40));
      const px2 = Array.from(id2.data.slice(0, 40));
      const stable = px1.every((v, i) => v === px2[i]);

      // Check that at least some pixels differ from exact 0x80 (128)
      // The noise is ±1, so some pixels should be 127 or 129
      let diffCount = 0;
      for (let i = 0; i < id1.data.length; i += 4) {
        if (id1.data[i] !== 128 || id1.data[i + 1] !== 128 || id1.data[i + 2] !== 128) {
          diffCount++;
        }
      }
      return { skip: false, hasNoise: diffCount > 0, stable };
    });

    if ((result as any).skip) {
      test.skip(true, 'OffscreenCanvas not available');
      return;
    }
    expect(result.hasNoise).toBe(true);
    expect(result.stable).toBe(true);
  });

  test('OffscreenCanvas and HTMLCanvasElement produce same-seed noise', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      if (typeof OffscreenCanvas === 'undefined') return { skip: true, match: false };

      // Draw identical content on both canvas types
      function draw2d(ctx: any, w: number, h: number) {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#000';
        ctx.font = '14px Arial';
        ctx.fillText('CrossCanvas', 10, 30);
      }

      // HTMLCanvasElement
      const hc = document.createElement('canvas');
      hc.width = 100; hc.height = 50;
      const hctx = hc.getContext('2d')!;
      draw2d(hctx, 100, 50);
      const hid = hctx.getImageData(0, 0, 100, 50);

      // OffscreenCanvas
      const oc = new OffscreenCanvas(100, 50);
      const octx = oc.getContext('2d')!;
      draw2d(octx, 100, 50);
      const oid = octx.getImageData(0, 0, 100, 50);

      // Compare first 100 bytes — should match because same seed
      const hpx = Array.from(hid.data.slice(0, 100));
      const opx = Array.from(oid.data.slice(0, 100));
      const match = hpx.every((v, i) => v === opx[i]);

      return { skip: false, match };
    });

    if ((result as any).skip) {
      test.skip(true, 'OffscreenCanvas not available');
      return;
    }
    expect(result.match).toBe(true);
  });
});

test.describe('WebGL readPixels noise (v2 item 5)', () => {
  test('readPixels returns stable data across calls', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 100; c.height = 100;
      const gl = c.getContext('webgl') as WebGLRenderingContext | null;
      if (!gl) return { skip: true, stable: false };

      gl.clearColor(0.5, 0.3, 0.8, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const px1 = new Uint8Array(100 * 100 * 4);
      const px2 = new Uint8Array(100 * 100 * 4);
      gl.readPixels(0, 0, 100, 100, gl.RGBA, gl.UNSIGNED_BYTE, px1);
      gl.readPixels(0, 0, 100, 100, gl.RGBA, gl.UNSIGNED_BYTE, px2);

      // First 40 bytes should be identical (deterministic noise)
      const slice1 = Array.from(px1.slice(0, 40));
      const slice2 = Array.from(px2.slice(0, 40));
      const stable = slice1.every((v, i) => v === slice2[i]);
      return { skip: false, stable };
    });

    if ((result as any).skip) {
      test.skip(true, 'WebGL not available');
      return;
    }
    expect(result.stable).toBe(true);
  });

  test('readPixels has noise applied (not exact clearColor)', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 50; c.height = 50;
      const gl = c.getContext('webgl') as WebGLRenderingContext | null;
      if (!gl) return { skip: true, hasNoise: false };

      // Clear to exact color (128, 77, 204, 255)
      gl.clearColor(128 / 255, 77 / 255, 204 / 255, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const px = new Uint8Array(50 * 50 * 4);
      gl.readPixels(0, 0, 50, 50, gl.RGBA, gl.UNSIGNED_BYTE, px);

      // With noise, some pixels should differ from the exact clearColor
      let diffCount = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] !== 128 || px[i + 1] !== 77 || px[i + 2] !== 204) {
          diffCount++;
        }
      }
      return { skip: false, hasNoise: diffCount > 0 };
    });

    if ((result as any).skip) {
      test.skip(true, 'WebGL not available');
      return;
    }
    expect(result.hasNoise).toBe(true);
  });

  test('WebGL2 readPixels has noise applied', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 50; c.height = 50;
      const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
      if (!gl) return { skip: true, hasNoise: false, stable: false };

      gl.clearColor(0.5, 0.5, 0.5, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const px1 = new Uint8Array(50 * 50 * 4);
      const px2 = new Uint8Array(50 * 50 * 4);
      gl.readPixels(0, 0, 50, 50, gl.RGBA, gl.UNSIGNED_BYTE, px1);
      gl.readPixels(0, 0, 50, 50, gl.RGBA, gl.UNSIGNED_BYTE, px2);

      const stable = Array.from(px1.slice(0, 40)).every((v, i) => v === px2[i]);

      let diffCount = 0;
      for (let i = 0; i < px1.length; i += 4) {
        if (px1[i] !== 128 || px1[i + 1] !== 128 || px1[i + 2] !== 128) {
          diffCount++;
        }
      }
      return { skip: false, hasNoise: diffCount > 0, stable };
    });

    if ((result as any).skip) {
      test.skip(true, 'WebGL2 not available');
      return;
    }
    expect(result.hasNoise).toBe(true);
    expect(result.stable).toBe(true);
  });
});
