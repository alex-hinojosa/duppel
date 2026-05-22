import { test, expect } from '../fixtures/extension';

test.describe('Worker WebGL parity', () => {
  test('Classic Worker WebGL vendor/renderer matches main thread', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      return new Promise<{ match: boolean; mainVendor: string; mainRenderer: string; workerVendor: string; workerRenderer: string }>((resolve) => {
        // Get main-thread WebGL vendor/renderer
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        let mainVendor = 'no-webgl';
        let mainRenderer = 'no-webgl';
        if (gl) {
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          if (ext) {
            mainVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
            mainRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
          }
        }

        const code = `
          self.onmessage = function() {
            try {
              var oc = new OffscreenCanvas(1, 1);
              var gl = oc.getContext('webgl');
              var vendor = 'no-webgl';
              var renderer = 'no-webgl';
              if (gl) {
                var ext = gl.getExtension('WEBGL_debug_renderer_info');
                if (ext) {
                  vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
                  renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
                }
              }
              self.postMessage({ vendor: vendor, renderer: renderer });
            } catch(e) {
              self.postMessage({ vendor: 'error: ' + e.message, renderer: 'error' });
            }
          };
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));

        const timeout = setTimeout(() => {
          worker.terminate();
          resolve({ match: false, mainVendor, mainRenderer, workerVendor: 'timeout', workerRenderer: 'timeout' });
        }, 5000);

        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({
            match: e.data.vendor === mainVendor && e.data.renderer === mainRenderer,
            mainVendor,
            mainRenderer,
            workerVendor: e.data.vendor,
            workerRenderer: e.data.renderer,
          });
        };

        worker.onerror = (err) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({ match: false, mainVendor, mainRenderer, workerVendor: 'error', workerRenderer: (err as any).message || 'unknown' });
        };

        worker.postMessage('go');
      });
    });
    console.log('Worker WebGL parity:', JSON.stringify(result));
    expect(result.match, `Main: ${result.mainVendor} / ${result.mainRenderer} — Worker: ${result.workerVendor} / ${result.workerRenderer}`).toBe(true);
  });
});

test.describe('Worker navigator parity', () => {
  test('Classic Worker navigator matches window', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      return new Promise<{ match: boolean; details: string }>((resolve) => {
        const code = `
          self.onmessage = function() {
            self.postMessage({
              userAgent: self.navigator.userAgent,
              platform: self.navigator.platform,
              hardwareConcurrency: self.navigator.hardwareConcurrency,
              deviceMemory: self.navigator.deviceMemory,
              language: self.navigator.language,
            });
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
          const wd = e.data;
          const mismatches: string[] = [];
          if (wd.userAgent !== navigator.userAgent) mismatches.push('userAgent');
          if (wd.platform !== navigator.platform) mismatches.push('platform');
          if (wd.hardwareConcurrency !== navigator.hardwareConcurrency) mismatches.push('hardwareConcurrency');
          if (wd.deviceMemory !== (navigator as any).deviceMemory) mismatches.push('deviceMemory');
          if (wd.language !== navigator.language) mismatches.push('language');
          worker.terminate();
          resolve({
            match: mismatches.length === 0,
            details: mismatches.length ? 'Mismatched: ' + mismatches.join(', ') : 'All match',
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
    expect(result.match, result.details).toBe(true);
  });

  test('Module Worker navigator matches window (Blob URL)', async ({ extensionPage }) => {
    // Module workers from Blob URLs are not universally supported in Chromium.
    // Probe support first; skip if unsupported (not a Duppel bug).
    const supported = await extensionPage.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        try {
          // Probe must test the same onmessage pattern used in the real test
          const code = 'self.onmessage = function() { self.postMessage("ok"); };';
          const blob = new Blob([code], { type: 'application/javascript' });
          const w = new Worker(URL.createObjectURL(blob), { type: 'module' });
          const t = setTimeout(() => { w.terminate(); resolve(false); }, 3000);
          w.onmessage = () => { clearTimeout(t); w.terminate(); resolve(true); };
          w.onerror = () => { clearTimeout(t); w.terminate(); resolve(false); };
          w.postMessage('probe');
        } catch { resolve(false); }
      });
    });

    test.skip(!supported, 'Blob URL module workers not supported in this Chromium build');

    const result = await extensionPage.evaluate(() => {
      return new Promise<{ match: boolean; details: string }>((resolve) => {
        const code = `
          self.onmessage = function() {
            self.postMessage({
              userAgent: self.navigator.userAgent,
              platform: self.navigator.platform,
              hardwareConcurrency: self.navigator.hardwareConcurrency,
              deviceMemory: self.navigator.deviceMemory,
            });
          };
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob), { type: 'module' });

        const timeout = setTimeout(() => {
          worker.terminate();
          resolve({ match: false, details: 'Module Worker timeout (5s)' });
        }, 5000);

        worker.onmessage = (e) => {
          clearTimeout(timeout);
          const wd = e.data;
          const mismatches: string[] = [];
          if (wd.userAgent !== navigator.userAgent) mismatches.push('userAgent');
          if (wd.platform !== navigator.platform) mismatches.push('platform');
          if (wd.hardwareConcurrency !== navigator.hardwareConcurrency) mismatches.push('hardwareConcurrency');
          if (wd.deviceMemory !== (navigator as any).deviceMemory) mismatches.push('deviceMemory');
          worker.terminate();
          resolve({
            match: mismatches.length === 0,
            details: mismatches.length ? 'Mismatched: ' + mismatches.join(', ') : 'All match',
          });
        };

        worker.onerror = (err) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({ match: false, details: 'Module Worker error: ' + (err.message || 'unknown') });
        };

        worker.postMessage('go');
      });
    });
    expect(result.match, result.details).toBe(true);
  });

  test('SharedWorker navigator matches window', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      if (typeof SharedWorker === 'undefined') return { match: true, details: 'SharedWorker not available (skip)' };

      return new Promise<{ match: boolean; details: string }>((resolve) => {
        const code = `
          self.onconnect = function(e) {
            const port = e.ports[0];
            port.onmessage = function() {
              port.postMessage({
                userAgent: self.navigator.userAgent,
                platform: self.navigator.platform,
                hardwareConcurrency: self.navigator.hardwareConcurrency,
                deviceMemory: self.navigator.deviceMemory,
              });
            };
          };
        `;
        const blob = new Blob([code], { type: 'application/javascript' });
        const worker = new SharedWorker(URL.createObjectURL(blob));

        const timeout = setTimeout(() => {
          resolve({ match: false, details: 'SharedWorker timeout (5s)' });
        }, 5000);

        worker.port.onmessage = (e) => {
          clearTimeout(timeout);
          const wd = e.data;
          const mismatches: string[] = [];
          if (wd.userAgent !== navigator.userAgent) mismatches.push('userAgent');
          if (wd.platform !== navigator.platform) mismatches.push('platform');
          if (wd.hardwareConcurrency !== navigator.hardwareConcurrency) mismatches.push('hardwareConcurrency');
          if (wd.deviceMemory !== (navigator as any).deviceMemory) mismatches.push('deviceMemory');
          resolve({
            match: mismatches.length === 0,
            details: mismatches.length ? 'Mismatched: ' + mismatches.join(', ') : 'All match',
          });
        };

        worker.onerror = (err) => {
          clearTimeout(timeout);
          resolve({ match: false, details: 'SharedWorker error: ' + (err.message || 'unknown') });
        };

        worker.port.start();
        worker.port.postMessage('go');
      });
    });
    expect(result.match, result.details).toBe(true);
  });
});
