/**
 * V3 Canvas Extraction Investigation
 *
 * Identifies which canvas extraction methods are affected by PhantomGrid's
 * noise and which produce stable (un-noised) output. This is the first
 * concrete test for the BrowserLeaks canvas hash gap.
 *
 * Tests 5 extraction methods:
 *   1. toDataURL()
 *   2. getImageData()
 *   3. toBlob()
 *   4. OffscreenCanvas.convertToBlob()
 *   5. WebGL readPixels()
 *
 * Each method is tested pre/post rotation on the local test page.
 * Then the BrowserLeaks canvas page is tested to identify their specific
 * extraction path and compare against our local findings.
 */

import { test, expect, getTestPageUrl } from '../fixtures/extension';
import {
  triggerRotation,
  writeBenchmarkResult,
} from '../helpers/benchmark-utils';

/**
 * Draw the same content BrowserLeaks uses for its canvas fingerprint.
 * This isolates whether the issue is content-specific or method-specific.
 */
const BROWSERLEAKS_DRAW = `
  const c = document.createElement('canvas');
  c.width = 220; c.height = 30;
  const ctx = c.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.font = "14px 'Arial'";
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f60';
  ctx.fillRect(125, 1, 62, 20);
  ctx.fillStyle = '#069';
  ctx.fillText('BrowserLeaks,com <canvas> 1.0', 2, 15);
  ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
  ctx.fillText('BrowserLeaks,com <canvas> 1.0', 4, 17);
`;

/** Simple hash for comparing pixel data arrays */
const HASH_FN = `
  function simpleHash(data) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      hash ^= data[i];
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
`;

test.describe('Canvas Extraction Investigation @external', () => {
  test.describe.configure({ retries: 0 }); // No retries — we need exact results

  test('extraction method comparison pre/post rotation', async ({ context, extensionId }) => {
    test.slow();

    /** Extract canvas data via all 5 methods */
    async function extractAll(page: import('@playwright/test').Page) {
      return page.evaluate(`(async () => {
        ${BROWSERLEAKS_DRAW}
        ${HASH_FN}

        const results = {};

        // Method 1: toDataURL
        results.toDataURL = c.toDataURL('image/png');

        // Method 2: getImageData
        const imgData = ctx.getImageData(0, 0, c.width, c.height);
        results.getImageData = simpleHash(imgData.data);
        results.getImageDataSample = Array.from(imgData.data.slice(0, 40)).join(',');

        // Method 3: toBlob
        results.toBlob = await new Promise(resolve => {
          c.toBlob(blob => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          }, 'image/png');
        });

        // Method 4: OffscreenCanvas
        try {
          const oc = new OffscreenCanvas(220, 30);
          const octx = oc.getContext('2d');
          octx.drawImage(c, 0, 0);
          const ocBlob = await oc.convertToBlob({ type: 'image/png' });
          const ocReader = new FileReader();
          results.offscreenCanvas = await new Promise(resolve => {
            ocReader.onload = () => resolve(ocReader.result);
            ocReader.readAsDataURL(ocBlob);
          });
        } catch (e) {
          results.offscreenCanvas = 'UNSUPPORTED: ' + e.message;
        }

        // Method 5: WebGL readPixels
        try {
          const glCanvas = document.createElement('canvas');
          glCanvas.width = 220; glCanvas.height = 30;
          const gl = glCanvas.getContext('webgl');
          if (gl) {
            // Draw a simple colored quad to have some content
            gl.clearColor(1.0, 0.5, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            const pixels = new Uint8Array(220 * 30 * 4);
            gl.readPixels(0, 0, 220, 30, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            results.webglReadPixels = simpleHash(pixels);
            results.webglSample = Array.from(pixels.slice(0, 40)).join(',');
          } else {
            results.webglReadPixels = 'NO_WEBGL';
          }
        } catch (e) {
          results.webglReadPixels = 'ERROR: ' + e.message;
        }

        return results;
      })()`);
    }

    // Pre-rotation
    const prePage = await context.newPage();
    await prePage.goto(getTestPageUrl());
    await prePage.waitForTimeout(500);
    const preResults = await extractAll(prePage) as any;
    await prePage.close();

    // Rotate
    await triggerRotation(context, extensionId);

    // Post-rotation
    const postPage = await context.newPage();
    await postPage.goto(getTestPageUrl());
    await postPage.waitForTimeout(500);
    const postResults = await extractAll(postPage) as any;
    await postPage.close();

    // Compare each method
    const comparison: Record<string, { changed: boolean; pre: string; post: string }> = {};

    comparison.toDataURL = {
      changed: preResults.toDataURL !== postResults.toDataURL,
      pre: preResults.toDataURL.substring(0, 80) + '...',
      post: postResults.toDataURL.substring(0, 80) + '...',
    };

    comparison.getImageData = {
      changed: preResults.getImageData !== postResults.getImageData,
      pre: preResults.getImageData,
      post: postResults.getImageData,
    };

    comparison.toBlob = {
      changed: preResults.toBlob !== postResults.toBlob,
      pre: (preResults.toBlob as string).substring(0, 80) + '...',
      post: (postResults.toBlob as string).substring(0, 80) + '...',
    };

    comparison.offscreenCanvas = {
      changed: preResults.offscreenCanvas !== postResults.offscreenCanvas,
      pre: typeof preResults.offscreenCanvas === 'string'
        ? preResults.offscreenCanvas.substring(0, 80) + '...'
        : String(preResults.offscreenCanvas),
      post: typeof postResults.offscreenCanvas === 'string'
        ? postResults.offscreenCanvas.substring(0, 80) + '...'
        : String(postResults.offscreenCanvas),
    };

    comparison.webglReadPixels = {
      changed: preResults.webglReadPixels !== postResults.webglReadPixels,
      pre: preResults.webglReadPixels,
      post: postResults.webglReadPixels,
    };

    // Log findings
    for (const [method, result] of Object.entries(comparison)) {
      console.log(`${method}: ${result.changed ? 'CHANGED' : 'STABLE'} | pre=${result.pre} | post=${result.post}`);
    }

    // Write structured results
    const flatResults: Record<string, string | boolean> = {};
    for (const [method, result] of Object.entries(comparison)) {
      flatResults[`${method}_changed`] = result.changed;
      flatResults[`${method}_pre`] = result.pre;
      flatResults[`${method}_post`] = result.post;
    }

    writeBenchmarkResult('canvas-investigation-methods', {
      service: 'Canvas Extraction Investigation (local)',
      timestamp: new Date().toISOString(),
      status: 'pass',
      preRotation: Object.fromEntries(
        Object.entries(preResults).filter(([k]) => !k.includes('Sample'))
          .map(([k, v]) => [k, typeof v === 'string' && v.length > 100 ? v.substring(0, 80) + '...' : v as string])
      ),
      postRotation: Object.fromEntries(
        Object.entries(postResults).filter(([k]) => !k.includes('Sample'))
          .map(([k, v]) => [k, typeof v === 'string' && v.length > 100 ? v.substring(0, 80) + '...' : v as string])
      ),
      sessionStable: true,
      rotationChanged: Object.values(comparison).some(c => c.changed),
    });

    // At least toDataURL and getImageData should change on rotation
    // (these are confirmed by local canvas.spec.ts and rotation.spec.ts)
    expect(comparison.toDataURL.changed, 'toDataURL should change on rotation').toBe(true);
    expect(comparison.getImageData.changed, 'getImageData should change on rotation').toBe(true);
  });

  test('BrowserLeaks canvas hash vs local toDataURL', async ({ context, extensionId }) => {
    test.slow();

    // Navigate to BrowserLeaks canvas page
    const page = await context.newPage();
    await page.goto('https://browserleaks.com/canvas', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
    await page.waitForTimeout(3000);

    // Extract: (a) what BrowserLeaks computed, (b) what toDataURL returns NOW
    const preResults = await page.evaluate(`(() => {
      ${HASH_FN}

      // Extract BrowserLeaks' computed hash from the DOM
      let blHash = null;
      const rows = document.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const label = cells[0].textContent?.trim().toLowerCase() ?? '';
          if (label.includes('hash') || label.includes('signature')) {
            blHash = cells[1].textContent?.trim() ?? null;
          }
        }
      }

      // Now draw the same content and call toDataURL ourselves
      ${BROWSERLEAKS_DRAW}
      const ourDataURL = c.toDataURL('image/png');
      const ourImageData = ctx.getImageData(0, 0, c.width, c.height);
      const ourPixelHash = simpleHash(ourImageData.data);

      // Also check if we can detect BrowserLeaks' canvas element on the page
      const pageCanvases = document.querySelectorAll('canvas');
      const canvasInfo = Array.from(pageCanvases).map((cv, i) => ({
        index: i,
        width: cv.width,
        height: cv.height,
        id: cv.id || '(none)',
      }));

      return {
        browserLeaksHash: blHash,
        ourDataURL: ourDataURL.substring(0, 100) + '...',
        ourPixelHash: ourPixelHash,
        pageCanvasCount: pageCanvases.length,
        canvasInfo: JSON.stringify(canvasInfo),
      };
    })()`);

    await page.screenshot({ path: 'test-results/canvas-investigation-bl.png' });
    await page.close();

    // Rotate and test again
    await triggerRotation(context, extensionId);

    const page2 = await context.newPage();
    await page2.goto('https://browserleaks.com/canvas', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
    await page2.waitForTimeout(3000);

    const postResults = await page2.evaluate(`(() => {
      ${HASH_FN}

      let blHash = null;
      const rows = document.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const label = cells[0].textContent?.trim().toLowerCase() ?? '';
          if (label.includes('hash') || label.includes('signature')) {
            blHash = cells[1].textContent?.trim() ?? null;
          }
        }
      }

      ${BROWSERLEAKS_DRAW}
      const ourDataURL = c.toDataURL('image/png');
      const ourImageData = ctx.getImageData(0, 0, c.width, c.height);
      const ourPixelHash = simpleHash(ourImageData.data);

      return {
        browserLeaksHash: blHash,
        ourDataURL: ourDataURL.substring(0, 100) + '...',
        ourPixelHash: ourPixelHash,
      };
    })()`);

    await page2.screenshot({ path: 'test-results/canvas-investigation-bl-post.png' });
    await page2.close();

    console.log('=== BrowserLeaks Canvas Investigation ===');
    console.log(`BL hash PRE:  ${(preResults as any).browserLeaksHash}`);
    console.log(`BL hash POST: ${(postResults as any).browserLeaksHash}`);
    console.log(`BL hash changed: ${(preResults as any).browserLeaksHash !== (postResults as any).browserLeaksHash}`);
    console.log(`Our toDataURL PRE:  ${(preResults as any).ourDataURL}`);
    console.log(`Our toDataURL POST: ${(postResults as any).ourDataURL}`);
    console.log(`Our toDataURL changed: ${(preResults as any).ourDataURL !== (postResults as any).ourDataURL}`);
    console.log(`Our pixel hash PRE:  ${(preResults as any).ourPixelHash}`);
    console.log(`Our pixel hash POST: ${(postResults as any).ourPixelHash}`);
    console.log(`Our pixel hash changed: ${(preResults as any).ourPixelHash !== (postResults as any).ourPixelHash}`);
    console.log(`Page canvases: ${(preResults as any).canvasInfo}`);

    // Required metrics
    expect((preResults as any).browserLeaksHash, 'BrowserLeaks hash must be extractable pre-rotation').not.toBeNull();
    expect((postResults as any).browserLeaksHash, 'BrowserLeaks hash must be extractable post-rotation').not.toBeNull();

    const blChanged = (preResults as any).browserLeaksHash !== (postResults as any).browserLeaksHash;
    const ourChanged = (preResults as any).ourDataURL !== (postResults as any).ourDataURL;
    const pixelChanged = (preResults as any).ourPixelHash !== (postResults as any).ourPixelHash;

    writeBenchmarkResult('canvas-investigation-browserleaks', {
      service: 'Canvas Investigation (BrowserLeaks)',
      timestamp: new Date().toISOString(),
      status: blChanged ? 'pass' : (ourChanged ? 'inconclusive' : 'fail'),
      preRotation: preResults as any,
      postRotation: postResults as any,
      sessionStable: true,
      rotationChanged: blChanged,
    });

    // Key diagnostic: if OUR toDataURL changes but BrowserLeaks' hash doesn't,
    // it means BrowserLeaks is using a different extraction path or capturing
    // the original toDataURL before PhantomGrid patches it.
    if (ourChanged && !blChanged) {
      console.warn('FINDING: Our toDataURL changes on rotation but BrowserLeaks hash does not.');
      console.warn('This indicates BrowserLeaks captures the original toDataURL before PhantomGrid patches,');
      console.warn('or BrowserLeaks uses an extraction method not covered by PhantomGrid.');
    }
    if (!ourChanged && !blChanged) {
      console.warn('FINDING: Neither our toDataURL nor BrowserLeaks hash changes on rotation.');
      console.warn('This indicates PhantomGrid noise is not being applied on the BrowserLeaks origin.');
    }
  });

  test('injection timing: does page JS see patched or original toDataURL', async ({ context }) => {
    test.slow();

    // Navigate to BrowserLeaks and test if toDataURL is patched
    const page = await context.newPage();
    await page.goto('https://browserleaks.com/canvas', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
    await page.waitForTimeout(2000);

    const timingResults = await page.evaluate(() => {
      // Check if toDataURL has been patched by PhantomGrid
      const toDataURLStr = HTMLCanvasElement.prototype.toDataURL.toString();
      const getImageDataStr = CanvasRenderingContext2D.prototype.getImageData.toString();

      // Draw test content and extract via toDataURL
      const c = document.createElement('canvas');
      c.width = 50; c.height = 10;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 50, 10);

      // Get pixel data via getImageData — should be noised
      const id = ctx.getImageData(0, 0, 50, 10);
      const firstPixels = Array.from(id.data.slice(0, 12)); // First 3 pixels (RGB)

      // Check if noise was applied (solid gray #808080 = [128,128,128])
      const expectedGray = 128;
      let noisedPixelCount = 0;
      for (let i = 0; i < id.data.length; i += 4) {
        for (let ch = 0; ch < 3; ch++) {
          if (id.data[i + ch] !== expectedGray) noisedPixelCount++;
        }
      }

      return {
        toDataURL_toString: toDataURLStr,
        getImageData_toString: getImageDataStr,
        toDataURL_looksNative: toDataURLStr.includes('native code'),
        getImageData_looksNative: getImageDataStr.includes('native code'),
        firstPixels,
        noisedPixelCount,
        totalPixels: (50 * 10 * 3),
        noiseDetected: noisedPixelCount > 0,
      };
    });

    console.log('=== Injection Timing Results ===');
    console.log(`toDataURL.toString(): ${timingResults.toDataURL_toString}`);
    console.log(`toDataURL looks native: ${timingResults.toDataURL_looksNative}`);
    console.log(`getImageData looks native: ${timingResults.getImageData_looksNative}`);
    console.log(`First pixels (gray canvas): ${timingResults.firstPixels}`);
    console.log(`Noised pixels: ${timingResults.noisedPixelCount}/${timingResults.totalPixels}`);
    console.log(`Noise detected: ${timingResults.noiseDetected}`);

    await page.close();

    writeBenchmarkResult('canvas-investigation-timing', {
      service: 'Canvas Investigation (Injection Timing)',
      timestamp: new Date().toISOString(),
      status: timingResults.noiseDetected ? 'pass' : 'fail',
      preRotation: {
        toDataURL_looksNative: String(timingResults.toDataURL_looksNative),
        getImageData_looksNative: String(timingResults.getImageData_looksNative),
        noisedPixelCount: String(timingResults.noisedPixelCount),
        totalPixels: String(timingResults.totalPixels),
        noiseDetected: String(timingResults.noiseDetected),
      },
      postRotation: null,
      sessionStable: true,
      rotationChanged: false,
    });

    // Noise MUST be detected on BrowserLeaks domain
    expect(timingResults.noiseDetected, 'PhantomGrid noise must be active on BrowserLeaks domain').toBe(true);
  });
});
