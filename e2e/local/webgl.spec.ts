import { test, expect } from '../fixtures/extension';
import { collectWebGL } from '../helpers/fingerprint-collector';
import { KNOWN_RENDERERS } from '../helpers/profile-constants';

test.describe('WebGL spoofing', () => {
  test('vendor is spoofed (not real hardware)', async ({ extensionPage }) => {
    const gl = await collectWebGL(extensionPage);
    if (!gl.vendor) {
      test.skip(true, 'WebGL not available');
      return;
    }
    // Real hardware on Snapdragon X Elite would be "Qualcomm" or "Adreno"
    expect(gl.vendor).not.toMatch(/Qualcomm|Adreno/i);
  });

  test('renderer is spoofed (not real GPU)', async ({ extensionPage }) => {
    const gl = await collectWebGL(extensionPage);
    if (!gl.renderer) {
      test.skip(true, 'WebGL not available');
      return;
    }
    expect(gl.renderer).not.toMatch(/Qualcomm|Adreno/i);
  });

  test('renderer is from known set', async ({ extensionPage }) => {
    const gl = await collectWebGL(extensionPage);
    if (!gl.renderer) {
      test.skip(true, 'WebGL not available');
      return;
    }
    expect(KNOWN_RENDERERS).toContain(gl.renderer);
  });
});
