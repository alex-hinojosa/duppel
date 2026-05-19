/**
 * V3 BrowserLeaks Canvas Bypass — Mechanism Proof
 *
 * Instruments the three candidate bypass vectors to identify which one
 * BrowserLeaks uses to extract an un-noised canvas hash despite
 * PhantomGrid's MAIN-world prototype patches:
 *
 *   1. Worker / SharedWorker / ServiceWorker (canvas patches don't propagate)
 *   2. Saved native reference race (inline script captures toDataURL before
 *      content script document_start)
 *   3. iframe prototype theft (steal clean canvas from cross-origin iframe)
 *
 * Also intercepts BrowserLeaks' JavaScript to identify the extraction code
 * path directly.
 *
 * Rowan dispatch (UID 397): prove mechanism before any runtime fix.
 */

import { test, expect } from '../fixtures/extension';
import { writeBenchmarkResult } from '../helpers/benchmark-utils';

test.describe('BrowserLeaks Canvas Bypass Proof @external', () => {
  test.describe.configure({ retries: 0 }); // Exact results, no retry noise

  test('vector 1: Worker/SharedWorker/ServiceWorker detection', async ({ context }) => {
    test.slow();

    const page = await context.newPage();

    // Instrument Worker constructors BEFORE navigating to BrowserLeaks.
    // addInitScript runs before content scripts AND page scripts.
    await page.addInitScript(() => {
      (window as any).__pg_bypass_log = [];
      const log = (window as any).__pg_bypass_log;

      // Proxy Worker constructor
      if (typeof Worker !== 'undefined') {
        const OrigWorker = Worker;
        (window as any).__OrigWorker = OrigWorker;
        const handler: ProxyHandler<typeof Worker> = {
          construct(target, args) {
            log.push({
              type: 'Worker',
              url: String(args[0]),
              opts: args[1] ? JSON.stringify(args[1]) : null,
              stack: new Error().stack?.split('\n').slice(1, 4).join(' | ') ?? '',
              time: performance.now(),
            });
            return new target(...args);
          },
          apply(target, thisArg, args) {
            log.push({
              type: 'Worker(call)',
              url: String(args[0]),
              time: performance.now(),
            });
            return target.apply(thisArg, args);
          },
        };
        (window as any).Worker = new Proxy(OrigWorker, handler);
        // Preserve prototype chain
        (window as any).Worker.prototype = OrigWorker.prototype;
      }

      // Proxy SharedWorker constructor
      if (typeof SharedWorker !== 'undefined') {
        const OrigSharedWorker = SharedWorker;
        const handler: ProxyHandler<typeof SharedWorker> = {
          construct(target, args) {
            log.push({
              type: 'SharedWorker',
              url: String(args[0]),
              opts: args[1] ? JSON.stringify(args[1]) : null,
              stack: new Error().stack?.split('\n').slice(1, 4).join(' | ') ?? '',
              time: performance.now(),
            });
            return new target(...args);
          },
        };
        (window as any).SharedWorker = new Proxy(OrigSharedWorker, handler);
        (window as any).SharedWorker.prototype = OrigSharedWorker.prototype;
      }

      // Monitor ServiceWorker registration
      if (navigator.serviceWorker) {
        const origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
        navigator.serviceWorker.register = function(...args: any[]) {
          log.push({
            type: 'ServiceWorker',
            url: String(args[0]),
            opts: args[1] ? JSON.stringify(args[1]) : null,
            stack: new Error().stack?.split('\n').slice(1, 4).join(' | ') ?? '',
            time: performance.now(),
          });
          return origRegister(...args);
        } as any;
      }
    });

    await page.goto('https://browserleaks.com/canvas', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
    // Wait for BrowserLeaks to finish computing
    await page.waitForTimeout(5000);

    const workerLog = await page.evaluate(() => (window as any).__pg_bypass_log ?? []);

    console.log('=== Worker/SW Detection Results ===');
    console.log(`Total intercepted: ${workerLog.length}`);
    for (const entry of workerLog) {
      console.log(`  ${entry.type}: url=${entry.url} | stack=${entry.stack ?? ''}`);
    }

    const hasWorker = workerLog.some((e: any) => e.type === 'Worker');
    const hasSharedWorker = workerLog.some((e: any) => e.type === 'SharedWorker');
    const hasServiceWorker = workerLog.some((e: any) => e.type === 'ServiceWorker');

    await page.close();

    writeBenchmarkResult('bypass-proof-workers', {
      service: 'BrowserLeaks Bypass Proof (Workers)',
      timestamp: new Date().toISOString(),
      workerCount: workerLog.filter((e: any) => e.type === 'Worker').length,
      sharedWorkerCount: workerLog.filter((e: any) => e.type === 'SharedWorker').length,
      serviceWorkerCount: workerLog.filter((e: any) => e.type === 'ServiceWorker').length,
      entries: workerLog,
      verdict: hasWorker || hasSharedWorker || hasServiceWorker
        ? 'WORKERS_DETECTED'
        : 'NO_WORKERS',
    });
  });

  test('vector 2: saved native reference race', async ({ context }) => {
    test.slow();

    const page = await context.newPage();

    // Inject BEFORE everything — even before content scripts.
    // addInitScript runs at document creation time, before any other scripts.
    // If BrowserLeaks' inline script captures toDataURL before PhantomGrid's
    // content script patches it, we'd see the captured reference match the
    // original (un-patched) version.
    await page.addInitScript(() => {
      // Snapshot the current toDataURL reference
      (window as any).__pg_ref_check = {
        earlyRef: HTMLCanvasElement.prototype.toDataURL,
        earlyRefStr: HTMLCanvasElement.prototype.toDataURL.toString(),
        capturedAt: 'addInitScript (before content scripts)',
      };

      // Monitor for anyone saving prototype references
      const origGetOwnPropDesc = Object.getOwnPropertyDescriptor;
      const accessLog: Array<{ prop: string; on: string; time: number; stack: string }> = [];
      (window as any).__pg_prop_access_log = accessLog;

      // Can't easily proxy prototype access without breaking everything,
      // but we CAN detect if someone reads the raw function off the prototype
      // by watching for specific property descriptors
    });

    await page.goto('https://browserleaks.com/canvas', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
    await page.waitForTimeout(5000);

    const refCheck = await page.evaluate(() => {
      const check = (window as any).__pg_ref_check;
      const currentRef = HTMLCanvasElement.prototype.toDataURL;
      const currentStr = HTMLCanvasElement.prototype.toDataURL.toString();

      return {
        earlyRefStr: check.earlyRefStr,
        currentStr: currentStr,
        refsMatch: check.earlyRef === currentRef,
        strsMatch: check.earlyRefStr === currentStr,
        earlyLooksNative: check.earlyRefStr.includes('native code'),
        currentLooksNative: currentStr.includes('native code'),
        // If earlyRef !== currentRef, PhantomGrid patched AFTER addInitScript
        // which means content script DID run after our init script.
        // This is expected: addInitScript < content_script < page_script
        patchedAfterInit: check.earlyRef !== currentRef,
      };
    });

    console.log('=== Native Reference Race Results ===');
    console.log(`Early ref (addInitScript): ${refCheck.earlyRefStr}`);
    console.log(`Current ref (after load): ${refCheck.currentStr}`);
    console.log(`Refs match: ${refCheck.refsMatch}`);
    console.log(`Early looks native: ${refCheck.earlyLooksNative}`);
    console.log(`Current looks native: ${refCheck.currentLooksNative}`);
    console.log(`Patched after init: ${refCheck.patchedAfterInit}`);

    // Now test: if an inline script at the TOP of BrowserLeaks' HTML saves
    // toDataURL before content script patches, it would see the real native.
    // But document_start should beat inline scripts.
    // Key question: does addInitScript run before or after content_scripts?
    // Per Playwright docs: addInitScript runs "in the page context" before
    // any page script. Content scripts at document_start also run before
    // page scripts. The ordering is:
    //   addInitScript → content_script(document_start) → page scripts
    // So if patchedAfterInit is TRUE, the early ref IS the un-patched native.
    // BrowserLeaks inline scripts would see the PATCHED version though,
    // since they run AFTER content_scripts.

    await page.close();

    writeBenchmarkResult('bypass-proof-native-ref', {
      service: 'BrowserLeaks Bypass Proof (Native Reference Race)',
      timestamp: new Date().toISOString(),
      ...refCheck,
      verdict: refCheck.patchedAfterInit
        ? 'CONTENT_SCRIPT_PATCHES_AFTER_INIT'
        : 'NO_PATCHING_DETECTED',
    });
  });

  test('vector 3: iframe prototype theft and DOM analysis', async ({ context }) => {
    test.slow();

    const page = await context.newPage();

    // Monitor iframe creation
    await page.addInitScript(() => {
      (window as any).__pg_iframe_log = [];
      const log = (window as any).__pg_iframe_log;

      const origCreateElement = document.createElement.bind(document);
      document.createElement = function(tagName: string, options?: any) {
        const el = origCreateElement(tagName, options);
        if (tagName.toLowerCase() === 'iframe') {
          log.push({
            time: performance.now(),
            stack: new Error().stack?.split('\n').slice(1, 4).join(' | ') ?? '',
          });
        }
        return el;
      } as any;
    });

    await page.goto('https://browserleaks.com/canvas', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
    await page.waitForTimeout(5000);

    const iframeResults = await page.evaluate(() => {
      const log = (window as any).__pg_iframe_log ?? [];
      const iframes = document.querySelectorAll('iframe');
      const iframeInfo = Array.from(iframes).map((iframe, i) => {
        let canvasAccess = 'unknown';
        try {
          const win = iframe.contentWindow;
          if (win) {
            const td = win.HTMLCanvasElement?.prototype?.toDataURL;
            canvasAccess = td ? 'accessible' : 'no_toDataURL';
          } else {
            canvasAccess = 'no_contentWindow';
          }
        } catch (e) {
          canvasAccess = `blocked: ${(e as Error).message}`;
        }
        return {
          index: i,
          src: iframe.src || '(empty)',
          sandbox: iframe.sandbox?.value || '(none)',
          canvasAccess,
        };
      });

      return {
        createdCount: log.length,
        domCount: iframes.length,
        iframes: iframeInfo,
        createLog: log,
      };
    });

    console.log('=== iframe Prototype Theft Results ===');
    console.log(`iframes created via createElement: ${iframeResults.createdCount}`);
    console.log(`iframes in DOM: ${iframeResults.domCount}`);
    for (const info of iframeResults.iframes) {
      console.log(`  iframe[${info.index}]: src=${info.src} sandbox=${info.sandbox} canvas=${info.canvasAccess}`);
    }

    await page.close();

    writeBenchmarkResult('bypass-proof-iframes', {
      service: 'BrowserLeaks Bypass Proof (iframe Theft)',
      timestamp: new Date().toISOString(),
      ...iframeResults,
      verdict: iframeResults.iframes.some((f: any) => f.canvasAccess === 'accessible')
        ? 'IFRAME_CANVAS_ACCESSIBLE'
        : 'NO_IFRAME_CANVAS_ACCESS',
    });
  });

  test('vector 4: JavaScript source analysis', async ({ context }) => {
    test.slow();

    const page = await context.newPage();

    // Intercept all JavaScript files loaded by BrowserLeaks
    const jsFiles: Array<{ url: string; size: number; patterns: string[] }> = [];

    await page.route('**/*.js', async (route) => {
      const response = await route.fetch();
      const body = await response.text();

      // Search for canvas fingerprinting patterns
      const patterns: string[] = [];
      if (/toDataURL/i.test(body)) patterns.push('toDataURL');
      if (/getImageData/i.test(body)) patterns.push('getImageData');
      if (/toBlob/i.test(body)) patterns.push('toBlob');
      if (/OffscreenCanvas/i.test(body)) patterns.push('OffscreenCanvas');
      if (/readPixels/i.test(body)) patterns.push('readPixels');
      if (/new\s+Worker/i.test(body)) patterns.push('new Worker');
      if (/SharedWorker/i.test(body)) patterns.push('SharedWorker');
      if (/serviceWorker/i.test(body)) patterns.push('serviceWorker');
      if (/convertToBlob/i.test(body)) patterns.push('convertToBlob');
      if (/createElement.*canvas/i.test(body)) patterns.push('createElement_canvas');
      if (/getContext.*2d/i.test(body)) patterns.push('getContext_2d');
      if (/getContext.*webgl/i.test(body)) patterns.push('getContext_webgl');
      if (/fillText/i.test(body)) patterns.push('fillText');
      if (/IDAT/i.test(body)) patterns.push('IDAT');
      if (/CRC32/i.test(body) || /crc32/i.test(body)) patterns.push('CRC32');
      if (/prototype\s*\.\s*toDataURL/i.test(body)) patterns.push('prototype.toDataURL');

      if (patterns.length > 0) {
        jsFiles.push({
          url: route.request().url(),
          size: body.length,
          patterns,
        });
      }

      await route.fulfill({ response });
    });

    // Also intercept inline scripts via CDP
    const client = await page.context().newCDPSession(page);
    const inlineScripts: Array<{ url: string; length: number; patterns: string[] }> = [];

    await client.send('Debugger.enable');
    client.on('Debugger.scriptParsed', async (params) => {
      // Only interested in inline scripts (no URL or BrowserLeaks origin)
      if (!params.url || params.url.startsWith('https://browserleaks.com')) {
        try {
          const { scriptSource } = await client.send('Debugger.getScriptSource', {
            scriptId: params.scriptId,
          });
          const patterns: string[] = [];
          if (/toDataURL/i.test(scriptSource)) patterns.push('toDataURL');
          if (/getImageData/i.test(scriptSource)) patterns.push('getImageData');
          if (/OffscreenCanvas/i.test(scriptSource)) patterns.push('OffscreenCanvas');
          if (/new\s+Worker/i.test(scriptSource)) patterns.push('new Worker');
          if (/fillText/i.test(scriptSource)) patterns.push('fillText');
          if (/IDAT/i.test(scriptSource)) patterns.push('IDAT');
          if (/CRC32/i.test(scriptSource) || /crc32/i.test(scriptSource)) patterns.push('CRC32');
          if (/prototype\s*\.\s*toDataURL/i.test(scriptSource)) patterns.push('prototype.toDataURL');
          if (/canvas/i.test(scriptSource) && /hash/i.test(scriptSource)) patterns.push('canvas+hash');

          if (patterns.length > 0) {
            inlineScripts.push({
              url: params.url || '(inline)',
              length: scriptSource.length,
              patterns,
            });
          }
        } catch {
          // Script may have been garbage collected
        }
      }
    });

    await page.goto('https://browserleaks.com/canvas', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
    await page.waitForTimeout(5000);

    await client.send('Debugger.disable');

    console.log('=== JavaScript Source Analysis ===');
    console.log(`External JS files with canvas patterns: ${jsFiles.length}`);
    for (const f of jsFiles) {
      console.log(`  ${f.url} (${f.size} bytes): [${f.patterns.join(', ')}]`);
    }
    console.log(`Inline/same-origin scripts with canvas patterns: ${inlineScripts.length}`);
    for (const s of inlineScripts) {
      console.log(`  ${s.url} (${s.length} chars): [${s.patterns.join(', ')}]`);
    }

    await page.close();

    writeBenchmarkResult('bypass-proof-js-analysis', {
      service: 'BrowserLeaks Bypass Proof (JS Source Analysis)',
      timestamp: new Date().toISOString(),
      externalJsFiles: jsFiles,
      inlineScripts,
      verdict: jsFiles.some((f) => f.patterns.includes('new Worker'))
        || inlineScripts.some((s) => s.patterns.includes('new Worker'))
        ? 'WORKER_IN_SOURCE'
        : jsFiles.some((f) => f.patterns.includes('prototype.toDataURL'))
          || inlineScripts.some((s) => s.patterns.includes('prototype.toDataURL'))
          ? 'PROTOTYPE_ACCESS_IN_SOURCE'
          : 'STANDARD_CANVAS_API',
    });
  });

  test('vector 5: OffscreenCanvas in Worker proof-of-concept', async ({ context }) => {
    test.slow();

    // This test proves whether OffscreenCanvas in a Worker bypasses
    // PhantomGrid's canvas noise. If it does, this is the mechanism
    // BrowserLeaks (or any fingerprinter) can use.
    const page = await context.newPage();
    await page.goto('about:blank');
    await page.waitForTimeout(500);

    const results = await page.evaluate(`(async () => {
      // Draw the same content in MAIN world
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

      const mainDataURL = c.toDataURL('image/png');
      const mainImageData = ctx.getImageData(0, 0, c.width, c.height);
      const mainPixelSample = Array.from(mainImageData.data.slice(0, 20));

      // Now do the SAME thing inside a Worker using OffscreenCanvas
      const workerCode = \`
        self.onmessage = async function() {
          try {
            const oc = new OffscreenCanvas(220, 30);
            const ctx = oc.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = "14px 'Arial'";
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('BrowserLeaks,com <canvas> 1.0', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('BrowserLeaks,com <canvas> 1.0', 4, 17);

            const imgData = ctx.getImageData(0, 0, 220, 30);
            const pixelSample = Array.from(imgData.data.slice(0, 20));

            // Also try convertToBlob for data URL comparison
            const blob = await oc.convertToBlob({ type: 'image/png' });
            const reader = new FileReaderSync();
            const dataURL = reader.readAsDataURL(blob);

            self.postMessage({
              success: true,
              workerDataURL: dataURL,
              workerPixelSample: pixelSample,
              hasOffscreenCanvas: true,
              toDataURLAvailable: false, // OffscreenCanvas has no toDataURL
            });
          } catch(e) {
            self.postMessage({
              success: false,
              error: e.message,
              hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
            });
          }
        };
      \`;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);

      const workerResult = await new Promise((resolve) => {
        const w = new Worker(workerUrl);
        const timeout = setTimeout(() => {
          w.terminate();
          resolve({ success: false, error: 'timeout' });
        }, 10000);
        w.onmessage = (e) => {
          clearTimeout(timeout);
          w.terminate();
          resolve(e.data);
        };
        w.onerror = (e) => {
          clearTimeout(timeout);
          w.terminate();
          resolve({ success: false, error: e.message });
        };
        w.postMessage('go');
      });

      URL.revokeObjectURL(workerUrl);

      // Compare main-world vs worker pixels
      let pixelsMatch = null;
      if (workerResult.success && workerResult.workerPixelSample) {
        pixelsMatch = JSON.stringify(mainPixelSample) === JSON.stringify(workerResult.workerPixelSample);
      }

      // Check if main-world pixels show noise (gray fill should be exact)
      // The BrowserLeaks drawing has text + rectangles, so noise detection
      // is done by comparing pixel samples between contexts
      let mainNoised = false;
      // Fill a simple gray canvas in main world for noise detection
      const gc = document.createElement('canvas');
      gc.width = 50; gc.height = 10;
      const gctx = gc.getContext('2d');
      gctx.fillStyle = '#808080';
      gctx.fillRect(0, 0, 50, 10);
      const grayData = gctx.getImageData(0, 0, 50, 10);
      for (let i = 0; i < grayData.data.length; i += 4) {
        if (grayData.data[i] !== 128 || grayData.data[i+1] !== 128 || grayData.data[i+2] !== 128) {
          mainNoised = true;
          break;
        }
      }

      return {
        mainDataURL: mainDataURL.substring(0, 100) + '...',
        mainPixelSample,
        mainNoised,
        workerResult,
        pixelsMatch,
        dataURLsMatch: workerResult.success
          ? mainDataURL === workerResult.workerDataURL
          : null,
      };
    })()`);

    console.log('=== OffscreenCanvas Worker PoC Results ===');
    console.log(`Main world noised: ${(results as any).mainNoised}`);
    console.log(`Worker success: ${(results as any).workerResult?.success}`);
    console.log(`Pixels match (main vs worker): ${(results as any).pixelsMatch}`);
    console.log(`DataURLs match (main vs worker): ${(results as any).dataURLsMatch}`);
    console.log(`Main pixels: [${(results as any).mainPixelSample?.join(',')}]`);
    console.log(`Worker pixels: [${(results as any).workerResult?.workerPixelSample?.join(',') ?? 'N/A'}]`);

    if ((results as any).workerResult?.error) {
      console.log(`Worker error: ${(results as any).workerResult.error}`);
    }

    await page.close();

    const r = results as any;
    const isWorkerBypass = r.mainNoised && r.workerResult?.success && !r.pixelsMatch;

    writeBenchmarkResult('bypass-proof-worker-poc', {
      service: 'BrowserLeaks Bypass Proof (Worker OffscreenCanvas PoC)',
      timestamp: new Date().toISOString(),
      mainNoised: r.mainNoised,
      workerSuccess: r.workerResult?.success ?? false,
      pixelsMatch: r.pixelsMatch,
      dataURLsMatch: r.dataURLsMatch,
      mainPixelSample: r.mainPixelSample,
      workerPixelSample: r.workerResult?.workerPixelSample ?? null,
      workerError: r.workerResult?.error ?? null,
      verdict: isWorkerBypass
        ? 'CONFIRMED_WORKER_BYPASS'
        : r.pixelsMatch
          ? 'WORKER_ALSO_NOISED'
          : 'INCONCLUSIVE',
    });

    // This is the key assertion: if main is noised but worker is NOT,
    // we've proven the Worker bypass mechanism
    if (r.mainNoised && r.workerResult?.success) {
      console.log(r.pixelsMatch
        ? 'FINDING: Worker pixels MATCH main — Worker IS being noised (PhantomGrid wraps Worker constructor)'
        : 'FINDING: Worker pixels DIFFER from main — Worker canvas IS NOT noised (bypass confirmed)');
    }
  });

  test('vector 6: iframe contentDocument canvas bypass (BrowserLeaks confirmed path)', async ({ context }) => {
    test.slow();

    // BrowserLeaks source reveals:
    //   var i = _el("#canvas-iframe").contentDocument.createElement("canvas");
    // This creates a canvas through an iframe's document, using the iframe's
    // prototype chain. If PhantomGrid doesn't inject into the iframe
    // (about:blank doesn't match <all_urls>), the iframe's toDataURL is
    // the real un-patched native.

    const page = await context.newPage();
    await page.goto('https://browserleaks.com/canvas', {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
    await page.waitForTimeout(3000);

    const results = await page.evaluate(() => {
      // Check for BrowserLeaks' #canvas-iframe
      const canvasIframe = document.querySelector('#canvas-iframe') as HTMLIFrameElement | null;
      const allIframes = document.querySelectorAll('iframe');
      const iframeList = Array.from(allIframes).map((f, i) => ({
        index: i,
        id: f.id || '(none)',
        src: f.src || '(empty)',
        width: f.width,
        height: f.height,
      }));

      if (!canvasIframe) {
        return {
          found: false,
          iframeList,
          error: 'No #canvas-iframe found in DOM',
        };
      }

      const iframeDoc = canvasIframe.contentDocument;
      if (!iframeDoc) {
        return {
          found: true,
          accessible: false,
          iframeList,
          error: 'contentDocument is null (cross-origin block)',
        };
      }

      // === KEY TEST: Is the iframe's toDataURL patched by PhantomGrid? ===

      // Main world toDataURL
      const mainTDU = HTMLCanvasElement.prototype.toDataURL;
      const mainTDUStr = mainTDU.toString();

      // iframe's toDataURL
      const iframeWin = canvasIframe.contentWindow as any;
      const iframeTDU = iframeWin.HTMLCanvasElement.prototype.toDataURL;
      const iframeTDUStr = iframeTDU.toString();

      // Are they the same function reference?
      const sameRef = mainTDU === iframeTDU;

      // Draw the SAME BrowserLeaks content via MAIN world canvas
      const mainCanvas = document.createElement('canvas');
      mainCanvas.width = 220; mainCanvas.height = 30;
      const mainCtx = mainCanvas.getContext('2d')!;
      mainCtx.textBaseline = 'top';
      mainCtx.font = "14px 'Arial'";
      mainCtx.textBaseline = 'alphabetic';
      mainCtx.fillStyle = '#f60';
      mainCtx.fillRect(125, 1, 62, 20);
      mainCtx.fillStyle = '#069';
      mainCtx.fillText('BrowserLeaks,com <canvas> 1.0', 2, 15);
      mainCtx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      mainCtx.fillText('BrowserLeaks,com <canvas> 1.0', 4, 17);

      // Draw the SAME content via IFRAME document canvas
      const iframeCanvas = iframeDoc.createElement('canvas');
      iframeCanvas.width = 220; iframeCanvas.height = 30;
      const iframeCtx = iframeCanvas.getContext('2d')!;
      iframeCtx.textBaseline = 'top';
      iframeCtx.font = "14px 'Arial'";
      iframeCtx.textBaseline = 'alphabetic';
      iframeCtx.fillStyle = '#f60';
      iframeCtx.fillRect(125, 1, 62, 20);
      iframeCtx.fillStyle = '#069';
      iframeCtx.fillText('BrowserLeaks,com <canvas> 1.0', 2, 15);
      iframeCtx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      iframeCtx.fillText('BrowserLeaks,com <canvas> 1.0', 4, 17);

      // Extract via MAIN world toDataURL (should be noised by PhantomGrid)
      const mainDataURL = mainCanvas.toDataURL('image/png');

      // Extract via IFRAME toDataURL (may be un-patched)
      const iframeDataURL = iframeCanvas.toDataURL('image/png');

      // Also: call iframe's toDataURL on the MAIN canvas
      // This is what BrowserLeaks effectively does
      const crossDataURL = iframeTDU.call(mainCanvas, 'image/png');

      // And: call main toDataURL on iframe's canvas
      const reverseCrossDataURL = mainTDU.call(iframeCanvas, 'image/png');

      // Compare pixel data
      const mainPixels = mainCtx.getImageData(0, 0, 220, 30).data;
      const iframePixels = iframeCtx.getImageData(0, 0, 220, 30).data;

      let pixelDiffs = 0;
      for (let i = 0; i < mainPixels.length; i++) {
        if (mainPixels[i] !== iframePixels[i]) pixelDiffs++;
      }

      // Check noise on a simple gray fill
      const grayMain = document.createElement('canvas');
      grayMain.width = 50; grayMain.height = 10;
      const gmCtx = grayMain.getContext('2d')!;
      gmCtx.fillStyle = '#808080';
      gmCtx.fillRect(0, 0, 50, 10);
      const gmData = gmCtx.getImageData(0, 0, 50, 10);
      let mainNoised = false;
      for (let i = 0; i < gmData.data.length; i += 4) {
        if (gmData.data[i] !== 128 || gmData.data[i+1] !== 128 || gmData.data[i+2] !== 128) {
          mainNoised = true; break;
        }
      }

      const grayIframe = iframeDoc.createElement('canvas');
      grayIframe.width = 50; grayIframe.height = 10;
      const giCtx = grayIframe.getContext('2d')!;
      giCtx.fillStyle = '#808080';
      giCtx.fillRect(0, 0, 50, 10);
      const giData = giCtx.getImageData(0, 0, 50, 10);
      let iframeNoised = false;
      for (let i = 0; i < giData.data.length; i += 4) {
        if (giData.data[i] !== 128 || giData.data[i+1] !== 128 || giData.data[i+2] !== 128) {
          iframeNoised = true; break;
        }
      }

      return {
        found: true,
        accessible: true,
        iframeList,
        iframeSrc: canvasIframe.src || '(empty)',
        iframeId: canvasIframe.id,
        // Reference comparison
        sameRef,
        mainTDUStr,
        iframeTDUStr,
        mainLooksNative: mainTDUStr.includes('native code'),
        iframeLooksNative: iframeTDUStr.includes('native code'),
        // Data URL comparison
        mainDataURL: mainDataURL.substring(0, 80) + '...',
        iframeDataURL: iframeDataURL.substring(0, 80) + '...',
        crossDataURL: crossDataURL.substring(0, 80) + '...',
        reverseCrossDataURL: reverseCrossDataURL.substring(0, 80) + '...',
        dataURLsMatch: mainDataURL === iframeDataURL,
        crossMatchesMain: crossDataURL === mainDataURL,
        crossMatchesIframe: crossDataURL === iframeDataURL,
        // Pixel comparison
        pixelDiffs,
        totalPixels: mainPixels.length,
        // Noise detection
        mainNoised,
        iframeNoised,
      };
    });

    const r = results as any;
    console.log('=== iframe contentDocument Bypass Results ===');
    console.log(`#canvas-iframe found: ${r.found}`);
    console.log(`contentDocument accessible: ${r.accessible}`);
    console.log(`iframe src: ${r.iframeSrc}`);
    console.log(`All iframes: ${JSON.stringify(r.iframeList)}`);
    if (r.accessible) {
      console.log(`--- Reference comparison ---`);
      console.log(`Same toDataURL ref: ${r.sameRef}`);
      console.log(`Main toDataURL.toString(): ${r.mainTDUStr}`);
      console.log(`iframe toDataURL.toString(): ${r.iframeTDUStr}`);
      console.log(`--- Data URL comparison ---`);
      console.log(`Main dataURL: ${r.mainDataURL}`);
      console.log(`iframe dataURL: ${r.iframeDataURL}`);
      console.log(`Cross (iframe TDU on main canvas): ${r.crossDataURL}`);
      console.log(`Reverse cross (main TDU on iframe canvas): ${r.reverseCrossDataURL}`);
      console.log(`DataURLs match: ${r.dataURLsMatch}`);
      console.log(`Cross matches main: ${r.crossMatchesMain}`);
      console.log(`Cross matches iframe: ${r.crossMatchesIframe}`);
      console.log(`--- Pixel diff ---`);
      console.log(`Pixel diffs: ${r.pixelDiffs}/${r.totalPixels}`);
      console.log(`--- Noise detection ---`);
      console.log(`Main world canvas noised: ${r.mainNoised}`);
      console.log(`iframe canvas noised: ${r.iframeNoised}`);
    }

    await page.close();

    const fixed = r.accessible && r.mainNoised && r.iframeNoised;

    writeBenchmarkResult('bypass-proof-iframe-confirmed', {
      service: 'BrowserLeaks Bypass Proof (iframe contentDocument)',
      timestamp: new Date().toISOString(),
      ...r,
      verdict: fixed
        ? 'IFRAME_PATCHED'
        : r.accessible && r.mainNoised && !r.iframeNoised
          ? 'IFRAME_BYPASS_STILL_OPEN'
          : 'INCONCLUSIVE',
    });

    // After the iframe getter interception fix, both main and iframe must be noised
    if (r.accessible) {
      expect(r.mainNoised, 'main world canvas must be noised').toBe(true);
      expect(r.iframeNoised, 'iframe canvas must be noised (getter interception fix)').toBe(true);
      expect(r.dataURLsMatch, 'main and iframe dataURLs must match (same seed)').toBe(true);
    }
  });

  test('regression: dynamic about:blank iframe with synchronous access', async ({ context }) => {
    test.slow();

    // Simulates the BrowserLeaks pattern: create iframe, append, immediately
    // access contentDocument.createElement('canvas') in the same JS turn.
    const page = await context.newPage();
    await page.goto('https://browserleaks.com/', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(1000);

    const results = await page.evaluate(() => {
      // Main world gray noise check
      const mc = document.createElement('canvas');
      mc.width = 50; mc.height = 10;
      const mctx = mc.getContext('2d')!;
      mctx.fillStyle = '#808080';
      mctx.fillRect(0, 0, 50, 10);
      const mData = mctx.getImageData(0, 0, 50, 10);
      let mainNoised = false;
      for (let i = 0; i < mData.data.length; i += 4) {
        if (mData.data[i] !== 128 || mData.data[i+1] !== 128 || mData.data[i+2] !== 128) {
          mainNoised = true; break;
        }
      }

      // Create iframe dynamically and access IMMEDIATELY (same JS turn)
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      // Synchronous access — no await, no setTimeout
      const iDoc = iframe.contentDocument!;
      const ic = iDoc.createElement('canvas');
      ic.width = 50; ic.height = 10;
      const ictx = ic.getContext('2d')!;
      ictx.fillStyle = '#808080';
      ictx.fillRect(0, 0, 50, 10);
      const iData = ictx.getImageData(0, 0, 50, 10);
      let iframeNoised = false;
      for (let i = 0; i < iData.data.length; i += 4) {
        if (iData.data[i] !== 128 || iData.data[i+1] !== 128 || iData.data[i+2] !== 128) {
          iframeNoised = true; break;
        }
      }

      // Also test via contentWindow path
      const iframe2 = document.createElement('iframe');
      document.body.appendChild(iframe2);
      const iWin = iframe2.contentWindow as any;
      const ic2 = iWin.document.createElement('canvas');
      ic2.width = 50; ic2.height = 10;
      const ictx2 = ic2.getContext('2d');
      ictx2.fillStyle = '#808080';
      ictx2.fillRect(0, 0, 50, 10);
      const iData2 = ictx2.getImageData(0, 0, 50, 10);
      let iframe2Noised = false;
      for (let i = 0; i < iData2.data.length; i += 4) {
        if (iData2.data[i] !== 128 || iData2.data[i+1] !== 128 || iData2.data[i+2] !== 128) {
          iframe2Noised = true; break;
        }
      }

      // Clean up
      iframe.remove();
      iframe2.remove();

      return { mainNoised, iframeNoised, iframe2Noised };
    });

    console.log('=== Dynamic iframe Regression Results ===');
    console.log(`Main noised: ${results.mainNoised}`);
    console.log(`Dynamic iframe (contentDocument): ${results.iframeNoised}`);
    console.log(`Dynamic iframe (contentWindow): ${results.iframe2Noised}`);

    await page.close();

    writeBenchmarkResult('regression-dynamic-iframe', {
      service: 'Regression: Dynamic about:blank iframe',
      timestamp: new Date().toISOString(),
      ...results,
    });

    expect(results.mainNoised, 'main world must be noised').toBe(true);
    expect(results.iframeNoised, 'dynamic iframe via contentDocument must be noised').toBe(true);
    expect(results.iframe2Noised, 'dynamic iframe via contentWindow must be noised').toBe(true);
  });

  test('regression: cross-origin iframe preserves native behavior', async ({ context }) => {
    test.slow();

    const page = await context.newPage();
    await page.goto('https://browserleaks.com/', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(1000);

    // Create cross-origin iframe and wait for it to load
    const iframeHandle = await page.evaluateHandle(() => {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://example.com';
      document.body.appendChild(iframe);
      return iframe;
    });

    // Wait for the iframe to navigate to the cross-origin URL
    await page.waitForTimeout(3000);

    const results = await page.evaluate((iframe) => {
      // contentWindow should return a WindowProxy (not null)
      const hasContentWindow = iframe.contentWindow !== null;

      // After cross-origin load, contentDocument should be null or throw
      let contentDocResult: string;
      try {
        const doc = iframe.contentDocument;
        contentDocResult = doc === null ? 'null' : 'accessible';
      } catch (e) {
        contentDocResult = `threw: ${(e as Error).name}`;
      }

      // patchIframeRealm should NOT have crashed — verify main canvas works
      const mainCanvasWorks = (() => {
        try {
          const c = document.createElement('canvas');
          c.width = 10; c.height = 10;
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = '#ff0000';
          ctx.fillRect(0, 0, 10, 10);
          const url = c.toDataURL();
          return url.startsWith('data:image/png');
        } catch {
          return false;
        }
      })();

      iframe.remove();

      return { hasContentWindow, contentDocResult, mainCanvasWorks };
    }, iframeHandle);

    console.log('=== Cross-Origin iframe Compatibility Results ===');
    console.log(`contentWindow exists: ${results.hasContentWindow}`);
    console.log(`contentDocument result: ${results.contentDocResult}`);
    console.log(`Main canvas still works: ${results.mainCanvasWorks}`);

    await page.close();

    writeBenchmarkResult('regression-cross-origin-iframe', {
      service: 'Regression: Cross-origin iframe compatibility',
      timestamp: new Date().toISOString(),
      ...results,
    });

    // Cross-origin contentDocument should be null (not throw, not crash)
    expect(results.contentDocResult, 'cross-origin contentDocument must be null or throw').toMatch(/null|threw/);
    expect(results.hasContentWindow, 'cross-origin contentWindow must exist').toBe(true);
    expect(results.mainCanvasWorks, 'main canvas must still work after cross-origin iframe access').toBe(true);
  });
});
