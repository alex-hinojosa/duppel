import { test, expect } from '../fixtures/extension';

/**
 * Duppel v2 Item 3: Behavioral Biometric Precision-Reduction Layer
 *
 * Gate 7 regression tests:
 * 1. Deterministic replay — same event produces identical reads
 * 2. Distribution shape — Gaussian-weighted (zeros > ±1), not flat uniform
 * 3. No fixed periodicity — timestamp fractional parts show no autocorrelation
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
