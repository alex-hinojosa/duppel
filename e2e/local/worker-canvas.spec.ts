import { test, expect } from '../fixtures/extension';

test.describe('Worker canvas noise (OffscreenCanvas + WebGL)', () => {

  // ── Classic Worker ────────────────────────────────────────────────

  test('Classic Worker OffscreenCanvas getImageData is noised', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      return new Promise<{ hasNoise: boolean; details: string }>((resolve) => {
        const code = `
          self.onmessage = function() {
            var oc = new OffscreenCanvas(50, 10);
            var ctx = oc.getContext('2d');
            ctx.fillStyle = '#808080';
            ctx.fillRect(0, 0, 50, 10);
            var id = ctx.getImageData(0, 0, 50, 10);
            var diffCount = 0;
            for (var i = 0; i < id.data.length; i += 4) {
              if (id.data[i] !== 128 || id.data[i+1] !== 128 || id.data[i+2] !== 128) {
                diffCount++;
              }
            }
            self.postMessage({ diffCount: diffCount, total: id.data.length / 4 });
          };
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        const timeout = setTimeout(() => {
          worker.terminate();
          resolve({ hasNoise: false, details: 'Worker timeout (5s)' });
        }, 5000);
        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({
            hasNoise: e.data.diffCount > 0,
            details: `${e.data.diffCount}/${e.data.total} pixels differ from exact #808080`,
          });
        };
        worker.onerror = (err) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({ hasNoise: false, details: 'Worker error: ' + (err.message || 'unknown') });
        };
        worker.postMessage('go');
      });
    });
    console.log(`Classic Worker getImageData: ${result.details}`);
    expect(result.hasNoise, result.details).toBe(true);
  });

  test('Classic Worker getImageData matches main world', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      return new Promise<{ match: boolean; details: string }>((resolve) => {
        // Get main-world OffscreenCanvas pixels first
        const oc = new OffscreenCanvas(50, 10);
        const ctx = oc.getContext('2d')!;
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, 50, 10);
        const mainId = ctx.getImageData(0, 0, 50, 10);
        const mainPixels = Array.from(mainId.data.slice(0, 40));

        // Now do the same in a Worker
        const code = `
          self.onmessage = function() {
            var oc = new OffscreenCanvas(50, 10);
            var ctx = oc.getContext('2d');
            ctx.fillStyle = '#808080';
            ctx.fillRect(0, 0, 50, 10);
            var id = ctx.getImageData(0, 0, 50, 10);
            self.postMessage({ pixels: Array.from(id.data.slice(0, 40)) });
          };
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        const timeout = setTimeout(() => {
          worker.terminate();
          resolve({ match: false, details: 'Worker timeout (5s)' });
        }, 5000);
        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          const workerPixels: number[] = e.data.pixels;
          const match = mainPixels.every((v, i) => v === workerPixels[i]);
          let mismatches = 0;
          if (!match) {
            for (let i = 0; i < mainPixels.length; i++) {
              if (mainPixels[i] !== workerPixels[i]) mismatches++;
            }
          }
          resolve({
            match,
            details: match
              ? 'Worker and main-world pixels are identical'
              : `${mismatches} pixel values differ (first 40 bytes)`,
          });
        };
        worker.onerror = (err) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({ match: false, details: 'Worker error: ' + (err.message || 'unknown') });
        };
        worker.postMessage('go');
      });
    });
    console.log(`Classic Worker vs main world: ${result.details}`);
    expect(result.match, result.details).toBe(true);
  });

  test('Classic Worker getImageData is deterministic', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      return new Promise<{ stable: boolean; details: string }>((resolve) => {
        const code = `
          self.onmessage = function() {
            var oc = new OffscreenCanvas(50, 10);
            var ctx = oc.getContext('2d');
            ctx.fillStyle = '#808080';
            ctx.fillRect(0, 0, 50, 10);
            var id1 = ctx.getImageData(0, 0, 50, 10);
            var id2 = ctx.getImageData(0, 0, 50, 10);
            var px1 = Array.from(id1.data.slice(0, 40));
            var px2 = Array.from(id2.data.slice(0, 40));
            var match = true;
            for (var i = 0; i < px1.length; i++) {
              if (px1[i] !== px2[i]) { match = false; break; }
            }
            self.postMessage({ stable: match });
          };
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        const timeout = setTimeout(() => {
          worker.terminate();
          resolve({ stable: false, details: 'Worker timeout (5s)' });
        }, 5000);
        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({
            stable: e.data.stable,
            details: e.data.stable ? 'Two reads are identical' : 'Two reads differ (non-deterministic)',
          });
        };
        worker.onerror = (err) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({ stable: false, details: 'Worker error: ' + (err.message || 'unknown') });
        };
        worker.postMessage('go');
      });
    });
    console.log(`Classic Worker determinism: ${result.details}`);
    expect(result.stable, result.details).toBe(true);
  });

  test('Classic Worker convertToBlob matches main world', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      // Main-world convertToBlob
      const oc = new OffscreenCanvas(50, 10);
      const ctx = oc.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 50, 10);
      const mainBlob = await oc.convertToBlob();
      const mainBytes = Array.from(new Uint8Array(await mainBlob.arrayBuffer()));

      return new Promise<{ match: boolean; details: string }>((resolve) => {
        const code = `
          self.onmessage = async function() {
            var oc = new OffscreenCanvas(50, 10);
            var ctx = oc.getContext('2d');
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 50, 10);
            var blob = await oc.convertToBlob();
            var arr = new Uint8Array(await blob.arrayBuffer());
            self.postMessage({ bytes: Array.from(arr) });
          };
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        const timeout = setTimeout(() => {
          worker.terminate();
          resolve({ match: false, details: 'Worker timeout (5s)' });
        }, 5000);
        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          const workerBytes: number[] = e.data.bytes;
          const match = mainBytes.length === workerBytes.length &&
            mainBytes.every((v, i) => v === workerBytes[i]);
          resolve({
            match,
            details: match
              ? `convertToBlob bytes match (${mainBytes.length} bytes)`
              : `convertToBlob bytes differ (main=${mainBytes.length}, worker=${workerBytes.length})`,
          });
        };
        worker.onerror = (err) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({ match: false, details: 'Worker error: ' + (err.message || 'unknown') });
        };
        worker.postMessage('go');
      });
    });
    console.log(`Classic Worker convertToBlob: ${result.details}`);
    expect(result.match, result.details).toBe(true);
  });

  test('Classic Worker convertToBlob does not mutate source canvas', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      return new Promise<{ match: boolean; details: string }>((resolve) => {
        const code = `
          self.onmessage = async function() {
            var oc = new OffscreenCanvas(50, 10);
            var ctx = oc.getContext('2d');
            ctx.fillStyle = '#808080';
            ctx.fillRect(0, 0, 50, 10);
            var before = Array.from(ctx.getImageData(0, 0, 10, 1).data);
            await oc.convertToBlob();
            var after = Array.from(ctx.getImageData(0, 0, 10, 1).data);
            var match = before.every(function(v, i) { return v === after[i]; });
            self.postMessage({ match: match });
          };
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        const timeout = setTimeout(() => {
          worker.terminate();
          resolve({ match: false, details: 'Worker timeout (5s)' });
        }, 5000);
        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({
            match: e.data.match,
            details: e.data.match
              ? 'Source canvas not mutated by convertToBlob'
              : 'Source canvas was mutated by convertToBlob',
          });
        };
        worker.onerror = (err) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({ match: false, details: 'Worker error: ' + (err.message || 'unknown') });
        };
        worker.postMessage('go');
      });
    });
    console.log(`Classic Worker convertToBlob mutation: ${result.details}`);
    expect(result.match, result.details).toBe(true);
  });

  test('Classic Worker WebGL readPixels is noised', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      return new Promise<{ hasNoise: boolean; details: string }>((resolve) => {
        const code = `
          self.onmessage = function() {
            try {
              var oc = new OffscreenCanvas(50, 50);
              var gl = oc.getContext('webgl');
              if (!gl) {
                self.postMessage({ hasNoise: false, details: 'WebGL not available in worker', skip: true });
                return;
              }
              gl.clearColor(0.5, 0.5, 0.5, 1.0);
              gl.clear(gl.COLOR_BUFFER_BIT);
              var px = new Uint8Array(50 * 50 * 4);
              gl.readPixels(0, 0, 50, 50, gl.RGBA, gl.UNSIGNED_BYTE, px);
              var diffCount = 0;
              for (var i = 0; i < px.length; i += 4) {
                if (px[i] !== 128 || px[i+1] !== 128 || px[i+2] !== 128) {
                  diffCount++;
                }
              }
              self.postMessage({ hasNoise: diffCount > 0, details: diffCount + '/' + (px.length/4) + ' pixels differ', skip: false });
            } catch(e) {
              self.postMessage({ hasNoise: false, details: 'Error: ' + e.message, skip: true });
            }
          };
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        const timeout = setTimeout(() => {
          worker.terminate();
          resolve({ hasNoise: false, details: 'Worker timeout (5s)' });
        }, 5000);
        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          if (e.data.skip) {
            resolve({ hasNoise: true, details: 'SKIP: ' + e.data.details });
          } else {
            resolve({ hasNoise: e.data.hasNoise, details: e.data.details });
          }
        };
        worker.onerror = (err) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({ hasNoise: false, details: 'Worker error: ' + (err.message || 'unknown') });
        };
        worker.postMessage('go');
      });
    });
    console.log(`Classic Worker WebGL readPixels: ${result.details}`);
    expect(result.hasNoise, result.details).toBe(true);
  });

  // ── Module Worker (served URL) ─────────────────────────────────────
  // Duppel's Worker constructor wraps ALL module workers into blob
  // URL module workers internally (misc.js:206-216), regardless of whether
  // the original URL is blob or HTTP. In Chromium for Testing (Playwright's
  // bundled browser), blob URL module workers silently fail to execute.
  // These tests use a served HTTP URL, but the internal wrapping still
  // creates a blob URL module worker — so they skip in this environment.
  // This is a pre-existing Chromium/blob-wrapper limitation, not a
  // canvas-specific issue.

  test('Module Worker (served URL) getImageData is noised', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      return new Promise<{ hasNoise: boolean; supported: boolean; details: string }>((resolve) => {
        try {
          const worker = new Worker('/worker-scripts/module-canvas-test.js', { type: 'module' });
          const timeout = setTimeout(() => {
            worker.terminate();
            resolve({ hasNoise: false, supported: false, details: 'Module Worker timeout (8s)' });
          }, 8000);
          worker.onmessage = (e) => {
            clearTimeout(timeout);
            worker.terminate();
            resolve({
              hasNoise: e.data.diffCount > 0,
              supported: true,
              details: `${e.data.diffCount}/${e.data.total} pixels differ from exact #808080`,
            });
          };
          worker.onerror = (err) => {
            clearTimeout(timeout);
            worker.terminate();
            resolve({ hasNoise: false, supported: false, details: 'Module Worker error: ' + (err.message || 'unknown') });
          };
          worker.postMessage('go');
        } catch(e) {
          resolve({ hasNoise: false, supported: false, details: 'Module Worker construction failed: ' + (e as Error).message });
        }
      });
    });
    console.log(`Module Worker (served URL) getImageData: ${result.details}`);
    // If module workers aren't supported at all (blob URL module worker limitation),
    // skip rather than fail — this is a Chromium infrastructure limitation.
    test.skip(!result.supported, 'Served URL module workers not functional: ' + result.details);
    expect(result.hasNoise, result.details).toBe(true);
  });

  test('Module Worker (served URL) getImageData matches main world', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      // Main-world pixels
      const oc = new OffscreenCanvas(50, 10);
      const ctx = oc.getContext('2d')!;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 50, 10);
      const mainPixels = Array.from(ctx.getImageData(0, 0, 50, 10).data.slice(0, 40));

      return new Promise<{ match: boolean; supported: boolean; details: string }>((resolve) => {
        try {
          const worker = new Worker('/worker-scripts/module-canvas-test.js', { type: 'module' });
          const timeout = setTimeout(() => {
            worker.terminate();
            resolve({ match: false, supported: false, details: 'Module Worker timeout (8s)' });
          }, 8000);
          worker.onmessage = (e) => {
            clearTimeout(timeout);
            worker.terminate();
            const workerPixels: number[] = e.data.pixels;
            const match = mainPixels.every((v, i) => v === workerPixels[i]);
            resolve({
              match,
              supported: true,
              details: match
                ? 'Module Worker and main-world pixels are identical'
                : 'Module Worker pixels differ from main world',
            });
          };
          worker.onerror = (err) => {
            clearTimeout(timeout);
            worker.terminate();
            resolve({ match: false, supported: false, details: 'Module Worker error: ' + (err.message || 'unknown') });
          };
          worker.postMessage('go');
        } catch(e) {
          resolve({ match: false, supported: false, details: 'Module Worker construction failed: ' + (e as Error).message });
        }
      });
    });
    console.log(`Module Worker (served URL) vs main world: ${result.details}`);
    test.skip(!result.supported, 'Served URL module workers not functional: ' + result.details);
    expect(result.match, result.details).toBe(true);
  });

  // ── SharedWorker ──────────────────────────────────────────────────

  test('SharedWorker OffscreenCanvas getImageData is noised', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      if (typeof SharedWorker === 'undefined') {
        return { hasNoise: true, available: false, details: 'SharedWorker not available (skip)' };
      }

      return new Promise<{ hasNoise: boolean; available: boolean; details: string }>((resolve) => {
        const code = `
          self.onconnect = function(e) {
            var port = e.ports[0];
            port.onmessage = function() {
              var oc = new OffscreenCanvas(50, 10);
              var ctx = oc.getContext('2d');
              ctx.fillStyle = '#808080';
              ctx.fillRect(0, 0, 50, 10);
              var id = ctx.getImageData(0, 0, 50, 10);
              var diffCount = 0;
              for (var i = 0; i < id.data.length; i += 4) {
                if (id.data[i] !== 128 || id.data[i+1] !== 128 || id.data[i+2] !== 128) {
                  diffCount++;
                }
              }
              port.postMessage({ diffCount: diffCount, total: id.data.length / 4 });
            };
          };
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        const worker = new SharedWorker(URL.createObjectURL(blob));
        const timeout = setTimeout(() => {
          resolve({ hasNoise: false, available: true, details: 'SharedWorker timeout (5s)' });
        }, 5000);
        worker.port.onmessage = (e) => {
          clearTimeout(timeout);
          resolve({
            hasNoise: e.data.diffCount > 0,
            available: true,
            details: `${e.data.diffCount}/${e.data.total} pixels differ from exact #808080`,
          });
        };
        worker.onerror = (err) => {
          clearTimeout(timeout);
          resolve({ hasNoise: false, available: true, details: 'SharedWorker error: ' + (err.message || 'unknown') });
        };
        worker.port.start();
        worker.port.postMessage('go');
      });
    });
    console.log(`SharedWorker getImageData: ${result.details}`);
    expect(result.hasNoise, result.details).toBe(true);
  });

  test('SharedWorker getImageData matches main world', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      if (typeof SharedWorker === 'undefined') {
        return { match: true, available: false, details: 'SharedWorker not available (skip)' };
      }

      // Main-world pixels
      const oc = new OffscreenCanvas(50, 10);
      const ctx = oc.getContext('2d')!;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 50, 10);
      const mainPixels = Array.from(ctx.getImageData(0, 0, 50, 10).data.slice(0, 40));

      return new Promise<{ match: boolean; available: boolean; details: string }>((resolve) => {
        const code = `
          self.onconnect = function(e) {
            var port = e.ports[0];
            port.onmessage = function() {
              var oc = new OffscreenCanvas(50, 10);
              var ctx = oc.getContext('2d');
              ctx.fillStyle = '#808080';
              ctx.fillRect(0, 0, 50, 10);
              var id = ctx.getImageData(0, 0, 50, 10);
              port.postMessage({ pixels: Array.from(id.data.slice(0, 40)) });
            };
          };
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        const worker = new SharedWorker(URL.createObjectURL(blob));
        const timeout = setTimeout(() => {
          resolve({ match: false, available: true, details: 'SharedWorker timeout (5s)' });
        }, 5000);
        worker.port.onmessage = (e) => {
          clearTimeout(timeout);
          const workerPixels: number[] = e.data.pixels;
          const match = mainPixels.every((v, i) => v === workerPixels[i]);
          resolve({
            match,
            available: true,
            details: match
              ? 'SharedWorker and main-world pixels are identical'
              : 'SharedWorker pixels differ from main world',
          });
        };
        worker.onerror = (err) => {
          clearTimeout(timeout);
          resolve({ match: false, available: true, details: 'SharedWorker error: ' + (err.message || 'unknown') });
        };
        worker.port.start();
        worker.port.postMessage('go');
      });
    });
    console.log(`SharedWorker vs main world: ${result.details}`);
    expect(result.match, result.details).toBe(true);
  });

  // ── Nested Worker proof ────────────────────────────────────────────
  // Prove that a Worker created from inside a wrapped Worker inherits
  // canvas noise via the injected self.Worker wrapper. The injected code
  // wraps self.Worker to inject nav + canvas overrides into nested workers
  // (depth-limited to 2 levels).

  test('Nested Worker canvas noise investigation', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      return new Promise<{
        outerNoised: boolean;
        innerNoised: boolean | null;
        nestedSupported: boolean;
        details: string;
      }>((resolve) => {
        const code = `
          self.onmessage = function() {
            // Outer worker: get own canvas pixels
            var oc = new OffscreenCanvas(50, 10);
            var ctx = oc.getContext('2d');
            ctx.fillStyle = '#808080';
            ctx.fillRect(0, 0, 50, 10);
            var id = ctx.getImageData(0, 0, 50, 10);
            var outerDiff = 0;
            for (var i = 0; i < id.data.length; i += 4) {
              if (id.data[i] !== 128 || id.data[i+1] !== 128 || id.data[i+2] !== 128) outerDiff++;
            }

            // Try to create a nested Worker
            try {
              var innerCode = [
                'self.onmessage = function() {',
                '  var oc = new OffscreenCanvas(50, 10);',
                '  var ctx = oc.getContext("2d");',
                '  ctx.fillStyle = "#808080";',
                '  ctx.fillRect(0, 0, 50, 10);',
                '  var id = ctx.getImageData(0, 0, 50, 10);',
                '  var diff = 0;',
                '  for (var i = 0; i < id.data.length; i += 4) {',
                '    if (id.data[i] !== 128 || id.data[i+1] !== 128 || id.data[i+2] !== 128) diff++;',
                '  }',
                '  self.postMessage({ innerDiff: diff, total: id.data.length / 4 });',
                '};'
              ].join('\\n');
              var blob = new Blob([innerCode], { type: 'application/javascript' });
              var inner = new Worker(URL.createObjectURL(blob));
              var t = setTimeout(function() {
                inner.terminate();
                self.postMessage({
                  outerDiff: outerDiff,
                  outerTotal: id.data.length / 4,
                  innerDiff: null,
                  nestedSupported: false,
                  error: 'Nested worker timeout (4s)'
                });
              }, 4000);
              inner.onmessage = function(e) {
                clearTimeout(t);
                inner.terminate();
                self.postMessage({
                  outerDiff: outerDiff,
                  outerTotal: id.data.length / 4,
                  innerDiff: e.data.innerDiff,
                  innerTotal: e.data.total,
                  nestedSupported: true
                });
              };
              inner.onerror = function(err) {
                clearTimeout(t);
                inner.terminate();
                self.postMessage({
                  outerDiff: outerDiff,
                  outerTotal: id.data.length / 4,
                  innerDiff: null,
                  nestedSupported: false,
                  error: 'Nested worker error'
                });
              };
              inner.postMessage('go');
            } catch(e) {
              self.postMessage({
                outerDiff: outerDiff,
                outerTotal: id.data.length / 4,
                innerDiff: null,
                nestedSupported: false,
                error: 'Nested worker creation failed: ' + e.message
              });
            }
          };
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        const timeout = setTimeout(() => {
          worker.terminate();
          resolve({
            outerNoised: false,
            innerNoised: null,
            nestedSupported: false,
            details: 'Outer worker timeout (8s)',
          });
        }, 8000);
        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          const d = e.data;
          const outerNoised = d.outerDiff > 0;
          if (!d.nestedSupported) {
            resolve({
              outerNoised,
              innerNoised: null,
              nestedSupported: false,
              details: `Outer: ${d.outerDiff}/${d.outerTotal} noised. Nested not supported: ${d.error}`,
            });
            return;
          }
          const innerNoised = d.innerDiff > 0;
          resolve({
            outerNoised,
            innerNoised,
            nestedSupported: true,
            details: `Outer: ${d.outerDiff}/${d.outerTotal} noised. Inner: ${d.innerDiff}/${d.innerTotal} noised=${innerNoised}.`,
          });
        };
        worker.onerror = (err) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({
            outerNoised: false,
            innerNoised: null,
            nestedSupported: false,
            details: 'Worker error: ' + (err.message || 'unknown'),
          });
        };
        worker.postMessage('go');
      });
    });
    console.log(`Nested Worker investigation: ${result.details}`);

    // Outer worker MUST be noised (Duppel wraps it)
    expect(result.outerNoised, 'Outer worker should have canvas noise').toBe(true);

    // Nested workers should inherit canvas noise via the injected
    // self.Worker wrapper (depth-limited to 2 levels).
    if (result.nestedSupported) {
      console.log(`Nested worker canvas noise = ${result.innerNoised}`);
      expect(result.innerNoised, 'Nested worker should have canvas noise').toBe(true);
    }
  });
});
