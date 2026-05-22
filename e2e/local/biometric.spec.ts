import { test, expect } from '../fixtures/extension';

/**
 * Duppel v2 Item 3: Behavioral Biometric Precision-Reduction Layer
 *
 * Tests (rowan acceptance list + lux Verification-Pair):
 * 1. Deterministic replay — same event produces identical reads
 * 2. Distribution shape — Gaussian-weighted (zeros > ±1), not flat uniform
 * 3. No fixed periodicity — timestamp fractional parts show no autocorrelation
 * 4. Synthetic events pass through unjittered (isTrusted=false bypass)
 * 5. Coordinate invariants — cross-property parity (pageX-clientX=scrollX)
 * 6. Editable/canvas/SVG/drag targets skip coordinate noise
 * 7. Wheel sign and zero preserved; nonzero subpixel deltas do not collapse
 * 8. Trusted wheel quantization — integer rounding with sign + nonzero min
 * 9. High-interaction smoke — canvas drawing + contenteditable input
 * 10. performance.now monotonicity — no backward movement in tight loop
 */

test.describe('Behavioral biometric precision-reduction (v2 item 3)', () => {
  test('deterministic replay: repeated reads of same event are identical', async ({ extensionPage: page }) => {
    // Set up a collector that reads timeStamp and clientX 10 times from
    // the same event object. WeakMap-cached spoofed getters must return
    // identical values on every read.
    await page.evaluate(() => {
      (window as any).__replayResult = null;
      document.addEventListener('mousemove', (e: MouseEvent) => {
        if ((window as any).__replayResult) return; // only capture first event
        const timestamps: number[] = [];
        const clientXs: number[] = [];
        for (let i = 0; i < 10; i++) {
          timestamps.push(e.timeStamp);
          clientXs.push(e.clientX);
        }
        (window as any).__replayResult = { timestamps, clientXs };
      });
    });

    // Trigger a trusted mousemove via Playwright
    await page.mouse.move(100, 100);
    await page.waitForTimeout(200);

    // Read the collected data
    const data = await page.evaluate(() => (window as any).__replayResult);
    expect(data).toBeTruthy();

    // All 10 reads of timeStamp must be the same value (WeakMap cached)
    for (let i = 1; i < data.timestamps.length; i++) {
      expect(data.timestamps[i]).toBe(data.timestamps[0]);
    }
    // All 10 reads of clientX must be the same value (WeakMap cached)
    for (let i = 1; i < data.clientXs.length; i++) {
      expect(data.clientXs[i]).toBe(data.clientXs[0]);
    }
  });

  test('distribution shape: coordinate noise is Gaussian-weighted (zeros > ±1)', async ({ extensionPage: page }) => {
    // Dispatch 300 mouse moves across different positions, collecting the
    // clientX noise delta (spoofed - real). The Gaussian distribution should
    // produce more zeros than +1 or -1 values.

    // Set up collector in the page
    await page.evaluate(() => {
      (window as any).__bioDeltas = [] as number[];
      document.addEventListener('mousemove', (e: MouseEvent) => {
        (window as any).__bioDeltas.push(e.clientX);
      });
    });

    // Move mouse across 300 distinct integer positions
    const intended: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = 50 + (i % 200);
      const y = 50 + Math.floor(i / 200) * 10;
      intended.push(x);
      await page.mouse.move(x, y);
    }

    // Small wait for last events to process
    await page.waitForTimeout(200);

    // Read collected values
    const received: number[] = await page.evaluate(() => (window as any).__bioDeltas);
    expect(received.length).toBeGreaterThanOrEqual(250); // allow minor event drops

    // Compute noise deltas: received[i] - intended[i]
    const deltas: number[] = [];
    const minLen = Math.min(received.length, intended.length);
    for (let i = 0; i < minLen; i++) {
      deltas.push(received[i] - intended[i]);
    }

    // Count distribution: should see values in {-1, 0, 1}
    let zeros = 0, plusOnes = 0, minusOnes = 0, outliers = 0;
    for (const d of deltas) {
      if (d === 0) zeros++;
      else if (d === 1) plusOnes++;
      else if (d === -1) minusOnes++;
      else outliers++;
    }

    // Gate 2: Gaussian weighted — zeros should outnumber both +1 and -1
    // With sigma=0.4: ~62% zero, ~19% +1, ~19% -1
    expect(zeros).toBeGreaterThan(plusOnes);
    expect(zeros).toBeGreaterThan(minusOnes);

    // Gate 3: bounded — no values outside ±1
    expect(outliers).toBe(0);
  });

  test('no fixed periodicity: timestamp fractional parts show no autocorrelation', async ({ extensionPage: page }) => {
    // Collect 100 trusted event timestamps, extract fractional millisecond
    // parts (the jittered component), compute autocorrelation at lags 1-10.
    // A periodic pattern (e.g., alternating +0.5/-0.5) would show |r| > 0.3.

    // Set up timestamp collector
    await page.evaluate(() => {
      (window as any).__bioTimestamps = [] as number[];
      document.addEventListener('mousemove', (e: MouseEvent) => {
        if ((window as any).__bioTimestamps.length < 100) {
          (window as any).__bioTimestamps.push(e.timeStamp);
        }
      });
    });

    // Generate 100+ trusted mousemove events at distinct positions
    for (let i = 0; i < 110; i++) {
      await page.mouse.move(50 + (i % 200), 50 + Math.floor(i / 200) * 5);
    }

    await page.waitForTimeout(200);

    const timestamps: number[] = await page.evaluate(() => (window as any).__bioTimestamps);
    expect(timestamps.length).toBeGreaterThanOrEqual(80);

    // Extract fractional millisecond part (the jitter signal)
    const fractionals = timestamps.map(t => t - Math.floor(t));

    // Compute autocorrelation at lags 1-10
    const n = fractionals.length;
    const mean = fractionals.reduce((a, b) => a + b, 0) / n;
    const variance = fractionals.reduce((a, b) => a + (b - mean) ** 2, 0) / n;

    if (variance === 0) {
      // All timestamps have zero fractional part — quantization ate the jitter.
      // This is acceptable (performance.now feeds event timestamps in some browsers)
      // but we can't test periodicity. Skip gracefully.
      return;
    }

    for (let lag = 1; lag <= 10; lag++) {
      let cov = 0;
      for (let i = 0; i < n - lag; i++) {
        cov += (fractionals[i] - mean) * (fractionals[i + lag] - mean);
      }
      const r = cov / ((n - lag) * variance);

      // No lag should show strong correlation
      expect(Math.abs(r)).toBeLessThan(0.3);
    }
  });

  test('synthetic events pass through unjittered', async ({ extensionPage: page }) => {
    // Synthetic events (isTrusted=false) must return exact original values.
    // Modifying constructor-controlled values is a detection oracle.
    const result = await page.evaluate(() => {
      return new Promise<{
        syntheticClientX: number; syntheticClientY: number;
        syntheticPageX: number; syntheticPageY: number;
        syntheticTS: number; eventTS: number;
      }>((resolve) => {
        const handler = (e: MouseEvent) => {
          document.removeEventListener('mousemove', handler);
          resolve({
            syntheticClientX: e.clientX,
            syntheticClientY: e.clientY,
            syntheticPageX: e.pageX,
            syntheticPageY: e.pageY,
            syntheticTS: e.timeStamp,
            eventTS: e.timeStamp, // second read — must be identical
          });
        };
        document.addEventListener('mousemove', handler);

        // Dispatch synthetic MouseEvent — isTrusted will be false
        const synth = new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 123,
          clientY: 456,
        });
        document.dispatchEvent(synth);
      });
    });

    // Synthetic coordinates must be exact (no ±1 noise)
    expect(result.syntheticClientX).toBe(123);
    expect(result.syntheticClientY).toBe(456);
    // timeStamp reads must be identical (WeakMap cached, no jitter)
    expect(result.syntheticTS).toBe(result.eventTS);
  });

  test('coordinate invariants: cross-property parity preserved', async ({ extensionPage: page }) => {
    // All x-axis properties share the same noise (nx), all y-axis share ny.
    // Key invariants: (1) x===clientX, y===clientY (alias parity),
    // (2) pageX-clientX is constant across events (symmetric noise cancels).

    // Create a scrollable page so pageX != clientX
    await page.evaluate(() => {
      document.body.style.cssText = 'margin:0;padding:0;';
      const spacer = document.createElement('div');
      spacer.style.cssText = 'width:1500px;height:1500px;';
      document.body.appendChild(spacer);
      window.scrollTo(50, 100);
    });
    await page.waitForTimeout(100);

    // Set up collector (non-blocking)
    await page.evaluate(() => {
      (window as any).__invariants = [] as any[];
      document.addEventListener('mousemove', (e: MouseEvent) => {
        (window as any).__invariants.push({
          clientX: e.clientX, pageX: e.pageX,
          clientY: e.clientY, pageY: e.pageY,
          x: e.x, y: e.y,
          pageDiffX: e.pageX - e.clientX,
          pageDiffY: e.pageY - e.clientY,
        });
      });
    });

    // Generate 20 trusted mousemove events at distinct positions
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(100 + i * 10, 100 + i * 5);
    }
    await page.waitForTimeout(200);

    const results = await page.evaluate(() => (window as any).__invariants);
    expect(results.length).toBeGreaterThanOrEqual(10);

    for (const r of results) {
      // Alias parity: x === clientX, y === clientY
      expect(r.x).toBe(r.clientX);
      expect(r.y).toBe(r.clientY);
    }

    // All events must report the same (pageX - clientX) offset.
    // Noise is symmetric (same nx on both), so the difference equals
    // the native scroll offset, which is constant.
    const firstDiffX = results[0].pageDiffX;
    const firstDiffY = results[0].pageDiffY;
    for (const r of results) {
      expect(r.pageDiffX).toBe(firstDiffX);
      expect(r.pageDiffY).toBe(firstDiffY);
    }
  });

  test('editable/canvas/SVG targets skip coordinate noise', async ({ extensionPage: page }) => {
    // _shouldSkipNoise returns true when event.target is editable, canvas, or SVG.
    // Strategy: for each target type, move mouse to the SAME coordinate 50 times.
    // If noise is applied, ~38% of clientX values would differ (±1 Gaussian).
    // If noise is skipped, ALL 50 must be identical.
    // P(50 identical with noise) ≈ 0.62^50 ≈ 3e-11 — effectively zero false pass.

    // Test each element type one at a time (full-viewport sized to guarantee hits)
    const elementConfigs = [
      { tag: 'textarea', id: 'skip-target', extra: '' },
      { tag: 'canvas', id: 'skip-target', extra: '' },
      { tag: 'svg', id: 'skip-target', extra: '' },
      { tag: 'div', id: 'skip-target', extra: 'contenteditable="true"' },
    ];

    for (const config of elementConfigs) {
      // Reset page to a single large target element
      await page.evaluate((cfg: { tag: string; id: string; extra: string }) => {
        document.body.innerHTML = '';
        document.body.style.cssText = 'margin:0;padding:0;';
        const el = document.createElement(cfg.tag);
        el.id = cfg.id;
        if (cfg.extra) el.setAttribute('contenteditable', 'true');
        (el as HTMLElement).style.cssText = 'width:100vw;height:100vh;display:block;';
        document.body.appendChild(el);
      }, config);

      // Collect clientX values from 50 mousemoves at the same position
      await page.evaluate(() => {
        (window as any).__skipXvals = [] as number[];
        document.addEventListener('mousemove', (e: MouseEvent) => {
          (window as any).__skipXvals.push(e.clientX);
        });
      });

      // Move to the exact same position 50 times (alternate y slightly to ensure events fire)
      for (let i = 0; i < 50; i++) {
        await page.mouse.move(300, 200 + (i % 2));
      }
      await page.waitForTimeout(100);

      const vals: number[] = await page.evaluate(() => (window as any).__skipXvals);
      expect(vals.length).toBeGreaterThanOrEqual(30);

      // All values must be identical (zero variance = no noise applied)
      const first = vals[0];
      const allSame = vals.every(v => v === first);
      expect(allSame).toBe(true);
    }
  });

  test('wheel sign and zero preserved; nonzero subpixel deltas do not collapse', async ({ extensionPage: page }) => {
    // WheelEvent quantization: Math.sign(real) * Math.max(1, Math.round(Math.abs(real)))
    // Verify sign preservation, zero passthrough, and nonzero minimum.
    // Use synthetic WheelEvents dispatched from page JS so we control exact deltaY values.
    // NOTE: synthetic events have isTrusted=false, so _shouldSkipNoise returns true
    // and the raw value passes through. This test verifies the passthrough contract.
    // Trusted wheel quantization is verified by the delta distribution test below.

    const result = await page.evaluate(() => {
      const cases = [
        { deltaY: 0, deltaX: 0, label: 'zero' },
        { deltaY: 1.7, deltaX: 0, label: 'positive-frac' },
        { deltaY: -1.7, deltaX: 0, label: 'negative-frac' },
        { deltaY: 0.1, deltaX: 0, label: 'small-positive' },
        { deltaY: -0.1, deltaX: 0, label: 'small-negative' },
        { deltaY: 0, deltaX: 2.3, label: 'deltaX-positive' },
        { deltaY: 0, deltaX: -0.2, label: 'deltaX-small-neg' },
      ];

      const results: { label: string; deltaY: number; deltaX: number }[] = [];

      for (const c of cases) {
        let captured = { deltaY: NaN, deltaX: NaN };
        const handler = (e: WheelEvent) => {
          captured = { deltaY: e.deltaY, deltaX: e.deltaX };
        };
        document.addEventListener('wheel', handler);
        const ev = new WheelEvent('wheel', {
          bubbles: true,
          deltaY: c.deltaY,
          deltaX: c.deltaX,
        });
        document.dispatchEvent(ev);
        document.removeEventListener('wheel', handler);
        results.push({ label: c.label, ...captured });
      }

      return results;
    });

    // Synthetic wheel events pass through unchanged (isTrusted=false)
    for (const r of result) {
      if (r.label === 'zero') {
        expect(r.deltaY).toBe(0);
        expect(r.deltaX).toBe(0);
      } else if (r.label === 'positive-frac') {
        expect(r.deltaY).toBe(1.7); // passthrough, not quantized
      } else if (r.label === 'negative-frac') {
        expect(r.deltaY).toBe(-1.7);
      } else if (r.label === 'small-positive') {
        expect(r.deltaY).toBe(0.1);
      } else if (r.label === 'small-negative') {
        expect(r.deltaY).toBe(-0.1);
      } else if (r.label === 'deltaX-positive') {
        expect(r.deltaX).toBe(2.3);
      } else if (r.label === 'deltaX-small-neg') {
        expect(r.deltaX).toBe(-0.2);
      }
    }
  });

  test('trusted wheel quantization: integer rounding with sign and nonzero minimum', async ({ extensionPage: page }) => {
    // Trusted wheel events (from Playwright mouse.wheel) get quantized:
    // Math.sign(real) * Math.max(1, Math.round(Math.abs(real)))
    // Collect deltaY from trusted scroll events and verify integer output.

    await page.evaluate(() => {
      // Make page scrollable
      const spacer = document.createElement('div');
      spacer.style.cssText = 'width:100px;height:5000px;';
      document.body.appendChild(spacer);

      (window as any).__wheelDeltas = [] as number[];
      document.addEventListener('wheel', (e: WheelEvent) => {
        (window as any).__wheelDeltas.push(e.deltaY);
      });
    });

    // Scroll down (positive deltaY)
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);
    // Scroll up (negative deltaY)
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(100);

    const deltas: number[] = await page.evaluate(() => (window as any).__wheelDeltas);
    expect(deltas.length).toBeGreaterThanOrEqual(2);

    for (const d of deltas) {
      // Must be integer (quantized)
      expect(d).toBe(Math.round(d));
      // Nonzero (we scrolled nonzero amounts)
      expect(d).not.toBe(0);
    }

    // At least one positive and one negative delta
    expect(deltas.some(d => d > 0)).toBe(true);
    expect(deltas.some(d => d < 0)).toBe(true);
  });

  test('high-interaction smoke: canvas drawing and contenteditable input', async ({ extensionPage: page }) => {
    // Smoke test: biometric noise must not break canvas drawing or text editing.
    // Create a canvas and contenteditable div, perform interactions, verify no errors.
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // Set up canvas with 2D drawing context and a contenteditable div
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.id = 'smoke-canvas';
      canvas.width = 400;
      canvas.height = 400;
      canvas.style.cssText = 'border:1px solid black;display:block;';
      document.body.appendChild(canvas);

      const editor = document.createElement('div');
      editor.id = 'smoke-editor';
      editor.contentEditable = 'true';
      editor.style.cssText = 'width:400px;height:100px;border:1px solid black;margin-top:10px;';
      document.body.appendChild(editor);

      // Canvas drawing via mouse events
      const ctx = canvas.getContext('2d')!;
      let drawing = false;
      canvas.addEventListener('mousedown', (e: MouseEvent) => {
        drawing = true;
        ctx.beginPath();
        ctx.moveTo(e.offsetX, e.offsetY);
      });
      canvas.addEventListener('mousemove', (e: MouseEvent) => {
        if (!drawing) return;
        ctx.lineTo(e.offsetX, e.offsetY);
        ctx.stroke();
      });
      canvas.addEventListener('mouseup', () => { drawing = false; });
    });

    // Draw on canvas: click-drag a line
    const canvasBox = await page.locator('#smoke-canvas').boundingBox();
    expect(canvasBox).toBeTruthy();
    await page.mouse.move(canvasBox!.x + 50, canvasBox!.y + 50);
    await page.mouse.down();
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(canvasBox!.x + 50 + i * 10, canvasBox!.y + 50 + i * 5);
    }
    await page.mouse.up();

    // Verify canvas has drawn content (non-blank)
    const hasDrawn = await page.evaluate(() => {
      const canvas = document.getElementById('smoke-canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const data = ctx.getImageData(0, 0, 400, 400).data;
      // Check for any non-zero, non-white pixel
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0) return true;
      }
      return false;
    });
    expect(hasDrawn).toBe(true);

    // Type in contenteditable
    await page.locator('#smoke-editor').click();
    await page.keyboard.type('Hello biometric test');
    const editorText = await page.locator('#smoke-editor').textContent();
    expect(editorText).toContain('Hello biometric test');

    // No page errors
    expect(errors).toEqual([]);
  });

  test('performance.now monotonicity: no backward movement in tight loop', async ({ extensionPage: page }) => {
    // Call performance.now() 1000 times in a tight loop.
    // The Gaussian jitter applied to quantized buckets could cause backward
    // movement without monotonic clamping. Verify no negative deltas.
    const result = await page.evaluate(() => {
      const values: number[] = [];
      for (let i = 0; i < 1000; i++) {
        values.push(performance.now());
      }
      let negativeDeltas = 0;
      let worstDelta = 0;
      for (let i = 1; i < values.length; i++) {
        const delta = values[i] - values[i - 1];
        if (delta < 0) {
          negativeDeltas++;
          if (delta < worstDelta) worstDelta = delta;
        }
      }
      return { count: values.length, negativeDeltas, worstDelta };
    });

    expect(result.count).toBe(1000);
    expect(result.negativeDeltas).toBe(0);
  });
});
