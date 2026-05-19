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

import { test, expect, getTestPageUrl } from '../fixtures/extension';
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

  test('descriptor camouflage: contentDocument getter', async ({ context }) => {
    test.slow();

    const page = await context.newPage();
    await page.goto('https://browserleaks.com/', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(1000);

    const results = await page.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(
        HTMLIFrameElement.prototype,
        'contentDocument'
      );

      if (!desc || !desc.get) {
        return { skip: true, reason: 'no descriptor or getter found' };
      }

      const getter = desc.get;

      // Descriptor shape checks
      const hasGetter = typeof getter === 'function';
      const hasSetter = 'set' in desc;
      const isConfigurable = desc.configurable;
      const isEnumerable = desc.enumerable;

      // toString checks
      const toStringResult = getter.toString();
      const looksNative = toStringResult.includes('native code');

      // Function.prototype.toString.call check
      const fptResult = Function.prototype.toString.call(getter);
      const fptLooksNative = fptResult.includes('native code');

      // No own toString
      const hasOwnToString = getter.hasOwnProperty('toString');

      // getter.name
      const getterName = getter.name;

      // Cross-check: getOwnPropertyDescriptors consistency
      const allDescs = Object.getOwnPropertyDescriptors(HTMLIFrameElement.prototype);
      const cdFromAll = allDescs['contentDocument'];
      const consistentWithAll = cdFromAll && cdFromAll.get === getter;

      // Reflect consistency
      let reflectConsistent = false;
      try {
        const reflectDesc = Reflect.getOwnPropertyDescriptor(
          HTMLIFrameElement.prototype,
          'contentDocument'
        );
        reflectConsistent = !!(reflectDesc && reflectDesc.get === getter);
      } catch (e) {
        reflectConsistent = false;
      }

      return {
        skip: false,
        hasGetter,
        hasSetter,
        isConfigurable,
        isEnumerable,
        toStringResult,
        looksNative,
        fptResult,
        fptLooksNative,
        hasOwnToString,
        getterName,
        consistentWithAll,
        reflectConsistent,
      };
    });

    console.log('=== contentDocument Descriptor Camouflage ===');
    if (!(results as any).skip) {
      const r = results as any;
      console.log(`getter exists: ${r.hasGetter}`);
      console.log(`configurable: ${r.isConfigurable}`);
      console.log(`enumerable: ${r.isEnumerable}`);
      console.log(`toString: ${r.toStringResult}`);
      console.log(`looks native: ${r.looksNative}`);
      console.log(`FPT.call: ${r.fptResult}`);
      console.log(`FPT looks native: ${r.fptLooksNative}`);
      console.log(`has own toString: ${r.hasOwnToString}`);
      console.log(`getter.name: ${r.getterName}`);
      console.log(`GOPDs consistent: ${r.consistentWithAll}`);
      console.log(`Reflect consistent: ${r.reflectConsistent}`);
    }

    await page.close();

    writeBenchmarkResult('descriptor-camouflage-contentDocument', {
      service: 'Descriptor Camouflage: contentDocument',
      timestamp: new Date().toISOString(),
      ...results,
    });

    if (!(results as any).skip) {
      const r = results as any;
      expect(r.hasGetter, 'contentDocument must have a getter').toBe(true);
      expect(r.isConfigurable, 'contentDocument must be configurable').toBe(true);
      expect(r.looksNative, 'contentDocument getter toString must look native').toBe(true);
      expect(r.fptLooksNative, 'FPT.call on contentDocument getter must look native').toBe(true);
      expect(r.hasOwnToString, 'contentDocument getter must not have own toString').toBe(false);
      expect(r.consistentWithAll, 'GOPDs must return same getter').toBe(true);
      expect(r.reflectConsistent, 'Reflect.GOPD must return same getter').toBe(true);
    }
  });

  test('descriptor camouflage: contentWindow getter', async ({ context }) => {
    test.slow();

    const page = await context.newPage();
    await page.goto('https://browserleaks.com/', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(1000);

    const results = await page.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(
        HTMLIFrameElement.prototype,
        'contentWindow'
      );

      if (!desc || !desc.get) {
        return { skip: true, reason: 'no descriptor or getter found' };
      }

      const getter = desc.get;

      const hasGetter = typeof getter === 'function';
      const hasSetter = 'set' in desc;
      const isConfigurable = desc.configurable;
      const isEnumerable = desc.enumerable;

      const toStringResult = getter.toString();
      const looksNative = toStringResult.includes('native code');

      const fptResult = Function.prototype.toString.call(getter);
      const fptLooksNative = fptResult.includes('native code');

      const hasOwnToString = getter.hasOwnProperty('toString');
      const getterName = getter.name;

      const allDescs = Object.getOwnPropertyDescriptors(HTMLIFrameElement.prototype);
      const cwFromAll = allDescs['contentWindow'];
      const consistentWithAll = cwFromAll && cwFromAll.get === getter;

      let reflectConsistent = false;
      try {
        const reflectDesc = Reflect.getOwnPropertyDescriptor(
          HTMLIFrameElement.prototype,
          'contentWindow'
        );
        reflectConsistent = !!(reflectDesc && reflectDesc.get === getter);
      } catch (e) {
        reflectConsistent = false;
      }

      return {
        skip: false,
        hasGetter,
        hasSetter,
        isConfigurable,
        isEnumerable,
        toStringResult,
        looksNative,
        fptResult,
        fptLooksNative,
        hasOwnToString,
        getterName,
        consistentWithAll,
        reflectConsistent,
      };
    });

    console.log('=== contentWindow Descriptor Camouflage ===');
    if (!(results as any).skip) {
      const r = results as any;
      console.log(`getter exists: ${r.hasGetter}`);
      console.log(`configurable: ${r.isConfigurable}`);
      console.log(`enumerable: ${r.isEnumerable}`);
      console.log(`toString: ${r.toStringResult}`);
      console.log(`looks native: ${r.looksNative}`);
      console.log(`FPT.call: ${r.fptResult}`);
      console.log(`FPT looks native: ${r.fptLooksNative}`);
      console.log(`has own toString: ${r.hasOwnToString}`);
      console.log(`getter.name: ${r.getterName}`);
      console.log(`GOPDs consistent: ${r.consistentWithAll}`);
      console.log(`Reflect consistent: ${r.reflectConsistent}`);
    }

    await page.close();

    writeBenchmarkResult('descriptor-camouflage-contentWindow', {
      service: 'Descriptor Camouflage: contentWindow',
      timestamp: new Date().toISOString(),
      ...results,
    });

    if (!(results as any).skip) {
      const r = results as any;
      expect(r.hasGetter, 'contentWindow must have a getter').toBe(true);
      expect(r.isConfigurable, 'contentWindow must be configurable').toBe(true);
      expect(r.looksNative, 'contentWindow getter toString must look native').toBe(true);
      expect(r.fptLooksNative, 'FPT.call on contentWindow getter must look native').toBe(true);
      expect(r.hasOwnToString, 'contentWindow getter must not have own toString').toBe(false);
      expect(r.consistentWithAll, 'GOPDs must return same getter').toBe(true);
      expect(r.reflectConsistent, 'Reflect.GOPD must return same getter').toBe(true);
    }
  });

  test('first-nav seed-noise alignment (no reload)', async ({ context }) => {
    test.slow();

    // SEED CONVERGENCE PROOF (rowan dispatch: seed-convergence race fix).
    // Proves that on first navigation to a real origin, the active
    // canvasSeed matches the sessionStorage seed WITHOUT a reload.
    //
    // Before the convergence fix, the content script could win the race
    // against background pre-injection, generate a random seed, compute
    // profile from it, and then bridge.js would correct sessionStorage
    // to the session seed — leaving sessionStorage correct but the live
    // profile.canvasSeed derived from the wrong seed.
    //
    // After the fix, background.js pre-injection calls __pg_converge__
    // to update the live profile in place when a seed mismatch is detected.

    const testUrl = getTestPageUrl();
    const tab = await context.newPage();
    await tab.goto(testUrl, { waitUntil: 'domcontentloaded' });
    // Wait for bridge.js correction + convergence to complete.
    // NO RELOAD — this is the critical difference from bb57f4a.
    await tab.waitForTimeout(2000);

    const result = await tab.evaluate(() => {
      const seedStr = sessionStorage.getItem('__pg_seed__');
      if (!seedStr) return { error: 'no seed', allMatch: false };
      const seed = parseInt(seedStr, 10);

      // Replicate mulberry32 from core.js
      function mulberry32(s: number) {
        return function() {
          s |= 0; s = s + 0x6D2B79F5 | 0;
          let t = Math.imul(s ^ s >>> 15, 1 | s);
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
      }

      // 9 pickFrom calls + canvasSeed = 10th rng() call
      function deriveCanvasSeed(sessionSeed: number) {
        const rng = mulberry32(sessionSeed);
        for (let i = 0; i < 9; i++) rng();
        return (rng() * 0xFFFFFFFF) >>> 0;
      }

      // pixelNoise from canvas.js
      function pixelNoise(pnSeed: number, i: number, val: number) {
        let h = pnSeed ^ (i * 2654435761);
        h = (h ^ (val * 2246822519)) >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
        h = (h ^ (h >>> 16)) >>> 0;
        const magnitude = (h >>> 1) & 3;
        return (h & 1) ? magnitude : -magnitude;
      }

      const expectedCanvasSeed = deriveCanvasSeed(seed);

      // Create canvas with known pixels via putImageData
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      const ctx = c.getContext('2d')!;
      const id = ctx.createImageData(1, 1);
      id.data[0] = 128; id.data[1] = 128; id.data[2] = 128; id.data[3] = 255;
      ctx.putImageData(id, 0, 0);

      // Read via patched getImageData
      const result = ctx.getImageData(0, 0, 1, 1);

      // Expected noise from session seed
      const expectedR = Math.max(0, Math.min(255, 128 + pixelNoise(expectedCanvasSeed, 0, 128)));
      const expectedG = Math.max(0, Math.min(255, 128 + pixelNoise(expectedCanvasSeed, 1, 128)));
      const expectedB = Math.max(0, Math.min(255, 128 + pixelNoise(expectedCanvasSeed, 2, 128)));

      return {
        sessionSeed: seed,
        expectedCanvasSeed,
        actualR: result.data[0],
        actualG: result.data[1],
        actualB: result.data[2],
        expectedR,
        expectedG,
        expectedB,
        allMatch: result.data[0] === expectedR && result.data[1] === expectedG && result.data[2] === expectedB,
      };
    }) as any;

    await tab.close();

    console.log(`Seed-noise alignment: seed=${result.sessionSeed} expectedCS=${result.expectedCanvasSeed}`);
    console.log(`  expected RGB: [${result.expectedR}, ${result.expectedG}, ${result.expectedB}]`);
    console.log(`  actual   RGB: [${result.actualR}, ${result.actualG}, ${result.actualB}]`);
    console.log(`  match: ${result.allMatch}`);

    expect(result.allMatch, 'Active canvasSeed must match sessionStorage seed on first navigation (no reload)').toBe(true);
  });

  test('cross-tab geometric canvas identity (contract assertion)', async ({ context }) => {
    test.slow();

    // CANVAS IDENTITY CONTRACT (rowan UID 405):
    //   PhantomGrid canvas noise is deterministic for (seed, pixel_index, pixel_value).
    //   Cross-tab equality holds when:
    //     (a) both tabs have the same canvasSeed (derived from sessionSeed), AND
    //     (b) the pre-noise pixel buffer is bit-exact across tabs.
    //
    //   This test satisfies both conditions:
    //     (a) Seed convergence via __pg_converge__ — background.js pre-injection
    //         calls the convergence function when it detects the content script
    //         used a different seed. No reload needed.
    //     (b) putImageData — sets exact known pixel values, bypassing the GPU
    //         rendering pipeline entirely. No fillRect/arc/gradient/text variance.
    //
    //   Validity requirements (rowan review of 81ef83a):
    //   - Runs on a real injected origin (local test server, not about:blank)
    //   - Proves PhantomGrid is active (gray-fill noise detection)
    //   - Proves same seed across tabs (sessionStorage match)
    //   - Asserts HARD equality on noised toDataURL output

    // Probe function: checks PhantomGrid is active, extracts seed, draws
    // geometric content, returns toDataURL for cross-tab comparison.
    // Uses putImageData to set exact known pixel values — bypasses GPU
    // rendering pipeline entirely, so any difference must come from noise.
    const probeAndDraw = `(() => {
      // 1. PhantomGrid activity probe: gray-fill noise detection
      const gc = document.createElement('canvas');
      gc.width = 50; gc.height = 10;
      const gctx = gc.getContext('2d');
      gctx.fillStyle = '#808080';
      gctx.fillRect(0, 0, 50, 10);
      const gData = gctx.getImageData(0, 0, 50, 10);
      let noised = false;
      for (let i = 0; i < gData.data.length; i += 4) {
        if (gData.data[i] !== 128 || gData.data[i+1] !== 128 || gData.data[i+2] !== 128) {
          noised = true; break;
        }
      }

      // 2. Seed extraction
      const seed = sessionStorage.getItem('__pg_seed__') ?? null;

      // 3. Canvas via putImageData (exact known pixels, no rendering variance)
      const c = document.createElement('canvas');
      c.width = 200; c.height = 100;
      const ctx = c.getContext('2d');
      const inputData = ctx.createImageData(200, 100);
      // Fill with a gradient-like pattern of known exact values
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < 200; x++) {
          const idx = (y * 200 + x) * 4;
          inputData.data[idx]     = (x + 50) & 255;  // R
          inputData.data[idx + 1] = (y + 30) & 255;  // G
          inputData.data[idx + 2] = ((x * y) >> 2) & 255; // B
          inputData.data[idx + 3] = 255;              // A
        }
      }
      ctx.putImageData(inputData, 0, 0);
      const tdu = c.toDataURL('image/png');

      return { noised, seed, tdu };
    })()`;

    // Use the local test server — a clean HTTP page where the extension
    // content script injects (matches <all_urls>). Avoids BrowserLeaks'
    // own JavaScript which may modify canvas rendering state.
    const testUrl = getTestPageUrl();

    // Wait for STATE.sessionSeed to be ready. On fresh install, restoreState()
    // and onInstalled both call createIdentity() asynchronously. If we open
    // tabs before sessionSeed is set, pre-injection skips (STATE.sessionSeed=0)
    // and seedObserved can't correct (guard: && STATE.sessionSeed). Poll via
    // the service worker to ensure initialization has completed.
    const sw = context.serviceWorkers()[0];
    expect(sw, 'service worker must be available').toBeTruthy();
    let sessionSeed: number | null = null;
    for (let i = 0; i < 30; i++) {
      sessionSeed = await sw.evaluate(async () => {
        const data = await chrome.storage.session.get(['sessionSeed']);
        return data.sessionSeed || null;
      });
      if (sessionSeed) break;
      await new Promise(r => setTimeout(r, 150));
    }
    expect(sessionSeed, 'sessionSeed must be set before opening tabs').toBeTruthy();

    // First-load canvas identity: no reload needed. The seed convergence
    // mechanism (__pg_converge__) ensures the active canvasSeed matches
    // the session seed before page scripts can observe it.
    const tab1 = await context.newPage();
    await tab1.goto(testUrl, { waitUntil: 'domcontentloaded' });
    await tab1.waitForTimeout(1000); // let convergence complete

    const tab2 = await context.newPage();
    await tab2.goto(testUrl, { waitUntil: 'domcontentloaded' });
    await tab2.waitForTimeout(1000);

    const result1 = await tab1.evaluate(probeAndDraw) as any;
    const result2 = await tab2.evaluate(probeAndDraw) as any;

    await tab1.close();
    await tab2.close();

    // Diagnostic output BEFORE assertions
    console.log(`Geometric cross-tab: tab1 noised=${result1.noised} seed=${result1.seed}`);
    console.log(`Geometric cross-tab: tab2 noised=${result2.noised} seed=${result2.seed}`);
    console.log(`Geometric cross-tab: seeds match=${result1.seed === result2.seed}`);
    console.log(`Geometric cross-tab: TDU IDENTICAL=${result1.tdu === result2.tdu}`);

    // Step 1: Assert PhantomGrid is ACTIVE on both tabs (gray-fill noise detected)
    expect(result1.noised, 'PhantomGrid must be active on tab 1 (gray-fill noise detected)').toBe(true);
    expect(result2.noised, 'PhantomGrid must be active on tab 2 (gray-fill noise detected)').toBe(true);

    // Step 2: Assert same seed/profile across tabs
    expect(result1.seed, 'seed must be present on tab 1').not.toBeNull();
    expect(result2.seed, 'seed must be present on tab 2').not.toBeNull();
    expect(result1.seed).toBe(result2.seed);

    // Step 3: HARD ASSERTION — geometric noised output must be identical
    expect(result1.tdu, 'geometric canvas toDataURL must not be empty on tab 1').toBeTruthy();
    expect(result2.tdu, 'geometric canvas toDataURL must not be empty on tab 2').toBeTruthy();
    expect(result1.tdu).toBe(result2.tdu);

    writeBenchmarkResult('geometric-cross-tab-identity', {
      service: 'Geometric Canvas Cross-Tab Identity (contract assertion)',
      timestamp: new Date().toISOString(),
      status: 'pass',
      preRotation: {
        tab1_noised: String(result1.noised),
        tab1_seed: result1.seed,
        tab1_tdu_prefix: result1.tdu.substring(0, 80),
        tab2_noised: String(result2.noised),
        tab2_seed: result2.seed,
        tab2_tdu_prefix: result2.tdu.substring(0, 80),
      },
      postRotation: null,
      sessionStable: result1.tdu === result2.tdu,
      rotationChanged: false,
    });
  });

  test('manifest compatibility: no load warnings with match_about_blank', async ({ context }) => {
    test.slow();

    // Verify the extension loaded and is functional despite match_about_blank
    // and match_origin_as_fallback flags in manifest.json
    const page = await context.newPage();
    await page.goto('https://browserleaks.com/', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(1000);

    const results = await page.evaluate(() => {
      // Main canvas noise still works
      const c = document.createElement('canvas');
      c.width = 50; c.height = 10;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 50, 10);
      const id = ctx.getImageData(0, 0, 50, 10);
      let mainNoised = false;
      for (let i = 0; i < id.data.length; i += 4) {
        if (id.data[i] !== 128 || id.data[i+1] !== 128 || id.data[i+2] !== 128) {
          mainNoised = true; break;
        }
      }

      // Navigator spoofing still works
      const ua = navigator.userAgent;
      const platform = navigator.platform;
      const spoofedUA = !ua.includes('Snapdragon') && ua.includes('Mozilla/5.0');

      // iframe getter interception still works
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
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
      iframe.remove();

      return { mainNoised, spoofedUA, platform, iframeNoised };
    });

    console.log('=== Manifest Compatibility Check ===');
    console.log(`Main canvas noised: ${results.mainNoised}`);
    console.log(`UA spoofed: ${results.spoofedUA}`);
    console.log(`Platform: ${results.platform}`);
    console.log(`Iframe noised: ${results.iframeNoised}`);

    await page.close();

    writeBenchmarkResult('manifest-compatibility', {
      service: 'Manifest Compatibility (match_about_blank)',
      timestamp: new Date().toISOString(),
      ...results,
    });

    expect(results.mainNoised, 'main canvas must be noised').toBe(true);
    expect(results.spoofedUA, 'UA must be spoofed').toBe(true);
    expect(results.iframeNoised, 'iframe canvas must be noised').toBe(true);
  });

  test('convergence hook detection profile (post-init cleanup)', async ({ context }) => {
    test.slow();

    // ROWAN GATE 2: Prove that window.__pg_converge__ is not an
    // unacceptable fingerprinting surface.
    //
    // The hook is defined at document_start (content script) and
    // deleted via setTimeout(0) after install*() calls complete.
    // By the time page scripts run, it should be gone.
    //
    // This test captures the detection profile at two points:
    // (a) document_start via addInitScript — catches the hook while alive
    // (b) after page load via evaluate — verifies cleanup completed

    const testUrl = getTestPageUrl();

    // Capture detection profile at document_start timing
    const page = await context.newPage();
    await page.addInitScript(() => {
      // Run at document_start — same timing as content script.
      // Capture the hook's detection profile before cleanup.
      (window as any).__pg_init_detection__ = {
        inWindow: '__pg_converge__' in window,
        inKeys: Object.keys(window).includes('__pg_converge__'),
        typeof: typeof (window as any).__pg_converge__,
        enumerable: window.propertyIsEnumerable('__pg_converge__'),
      };
    });

    await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
    // Wait for setTimeout(0) cleanup to fire
    await page.waitForTimeout(200);

    const result = await page.evaluate(() => {
      // Post-init detection profile — hook should be cleaned up
      const initDetection = (window as any).__pg_init_detection__ || null;

      // Post-cleanup: try every detection vector
      const postInWindow = '__pg_converge__' in window;
      const postInKeys = Object.keys(window).includes('__pg_converge__');
      const postInGOPN = Object.getOwnPropertyNames(window).includes('__pg_converge__');
      const postTypeof = typeof (window as any).__pg_converge__;
      const postDescriptor = Object.getOwnPropertyDescriptor(window, '__pg_converge__');
      const postEnumerable = window.propertyIsEnumerable('__pg_converge__');

      // Scan for PhantomGrid-specific globals (exclude test's own __pg_init_detection__)
      const suspiciousGlobals = Object.getOwnPropertyNames(window)
        .filter(n => n !== '__pg_init_detection__')
        .filter(n => n.includes('__pg') || n.includes('phantom') || n.includes('converge'));

      // Check canvas noise is still working (hook cleanup didn't break anything)
      const c = document.createElement('canvas');
      c.width = 50; c.height = 10;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 50, 10);
      const id = ctx.getImageData(0, 0, 50, 10);
      let noised = false;
      for (let i = 0; i < id.data.length; i += 4) {
        if (id.data[i] !== 128 || id.data[i+1] !== 128 || id.data[i+2] !== 128) {
          noised = true; break;
        }
      }

      return {
        initDetection,
        postInWindow,
        postInKeys,
        postInGOPN,
        postTypeof,
        postDescriptor: postDescriptor ? JSON.stringify(postDescriptor) : null,
        postEnumerable,
        suspiciousGlobals,
        canvasStillNoised: noised,
      };
    }) as any;

    await page.close();

    console.log('=== Convergence Hook Detection Profile ===');
    console.log('--- At document_start (addInitScript) ---');
    console.log(`  in window: ${result.initDetection?.inWindow}`);
    console.log(`  in Object.keys: ${result.initDetection?.inKeys}`);
    console.log(`  typeof: ${result.initDetection?.typeof}`);
    console.log(`  enumerable: ${result.initDetection?.enumerable}`);
    console.log('--- After page load (post-cleanup) ---');
    console.log(`  in window: ${result.postInWindow}`);
    console.log(`  in Object.keys: ${result.postInKeys}`);
    console.log(`  in GOPN: ${result.postInGOPN}`);
    console.log(`  typeof: ${result.postTypeof}`);
    console.log(`  descriptor: ${result.postDescriptor}`);
    console.log(`  enumerable: ${result.postEnumerable}`);
    console.log(`  suspicious globals: ${JSON.stringify(result.suspiciousGlobals)}`);
    console.log(`  canvas still noised: ${result.canvasStillNoised}`);

    // Post-cleanup: hook must not be detectable
    expect(result.postInWindow, '__pg_converge__ must not be in window after cleanup').toBe(false);
    expect(result.postInKeys, '__pg_converge__ must not be in Object.keys after cleanup').toBe(false);
    expect(result.postInGOPN, '__pg_converge__ must not be in GOPN after cleanup').toBe(false);
    expect(result.postTypeof, '__pg_converge__ must be undefined after cleanup').toBe('undefined');
    expect(result.postDescriptor, 'no descriptor after cleanup').toBeNull();
    expect(result.postEnumerable, 'not enumerable after cleanup').toBe(false);
    expect(result.suspiciousGlobals.length, 'no __pg* globals visible').toBe(0);

    // Canvas noise must still work after hook cleanup
    expect(result.canvasStillNoised, 'canvas noise must survive hook cleanup').toBe(true);
  });
});
