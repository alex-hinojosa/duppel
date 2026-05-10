import { test, expect } from '../fixtures/extension';

test.describe('matchMedia evaluator', () => {
  test('legacy colon syntax: min-width/max-width', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const iw = window.innerWidth;
      return {
        minWidthExact: window.matchMedia(`(min-width: ${iw}px)`).matches,
        maxWidthExact: window.matchMedia(`(max-width: ${iw}px)`).matches,
        minWidthAbove: window.matchMedia(`(min-width: ${iw + 1}px)`).matches,
      };
    });
    expect(result.minWidthExact).toBe(true);
    expect(result.maxWidthExact).toBe(true);
    expect(result.minWidthAbove).toBe(false);
  });

  test('legacy colon syntax: device-width', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const sw = screen.width;
      return window.matchMedia(`(device-width: ${sw}px)`).matches;
    });
    expect(result).toBe(true);
  });

  test('MQ Level 4 range: width >= / width >', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const iw = window.innerWidth;
      return {
        geExact: window.matchMedia(`(width >= ${iw}px)`).matches,
        geAbove: window.matchMedia(`(width >= ${iw + 1}px)`).matches,
        gtBelow: window.matchMedia(`(width > ${iw - 1}px)`).matches,
        gtExact: window.matchMedia(`(width > ${iw}px)`).matches,
      };
    });
    expect(result.geExact).toBe(true);
    expect(result.geAbove).toBe(false);
    expect(result.gtBelow).toBe(true);
    expect(result.gtExact).toBe(false);
  });

  test('reversed range: Npx <= width', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const iw = window.innerWidth;
      return window.matchMedia(`(${iw}px <= width)`).matches;
    });
    expect(result).toBe(true);
  });

  test('double range: Npx <= width <= Mpx', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const iw = window.innerWidth;
      const lo = Math.max(iw - 200, 1);
      const hi = iw + 200;
      return {
        inRange: window.matchMedia(`(${lo}px <= width <= ${hi}px)`).matches,
        outOfRange: window.matchMedia(`(${iw + 10}px <= width <= ${iw + 200}px)`).matches,
      };
    });
    expect(result.inRange).toBe(true);
    expect(result.outOfRange).toBe(false);
  });

  test('resolution range', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const dpr = window.devicePixelRatio;
      return window.matchMedia(`(resolution >= ${dpr}dppx)`).matches;
    });
    expect(result).toBe(true);
  });

  test('vw unit probe resistance', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => ({
      vw100: window.matchMedia('(min-width: 100vw)').matches,
      vw101: window.matchMedia('(min-width: 101vw)').matches,
    }));
    expect(result.vw100).toBe(true);
    expect(result.vw101).toBe(false);
  });

  test('physical unit (in) probe resistance', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const iw = window.innerWidth;
      const inches = iw / 96;
      return window.matchMedia(`(min-width: ${inches}in)`).matches;
    });
    expect(result).toBe(true);
  });

  test('orientation, pointer, hover', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const sw = screen.width;
      const sh = screen.height;
      const orientation = sw >= sh ? 'landscape' : 'portrait';
      return {
        orientation: window.matchMedia(`(orientation: ${orientation})`).matches,
        pointer: window.matchMedia('(pointer: fine)').matches,
        hover: window.matchMedia('(hover: hover)').matches,
      };
    });
    expect(result.orientation).toBe(true);
    expect(result.pointer).toBe(true);
    expect(result.hover).toBe(true);
  });

  test('binary search resistance', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const iw = window.innerWidth;
      return {
        above: window.matchMedia(`(min-width: ${iw + 100}px)`).matches,
        below: window.matchMedia(`(min-width: ${Math.max(iw - 100, 1)}px)`).matches,
        rangeAbove: window.matchMedia(`(width >= ${iw + 100}px)`).matches,
      };
    });
    expect(result.above).toBe(false);
    expect(result.below).toBe(true);
    expect(result.rangeAbove).toBe(false);
  });

  test('listener is no-op (no change events leak)', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const iw = window.innerWidth;
      const mql = window.matchMedia(`(min-width: ${iw}px)`);
      return typeof mql.addEventListener === 'function';
    });
    expect(result).toBe(true);
  });

  test('preference features pass through', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const dark = window.matchMedia('(prefers-color-scheme: dark)');
      return typeof dark.matches === 'boolean';
    });
    expect(result).toBe(true);
  });

  test('WebKit DPR aliases do not leak real value', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const dpr = window.devicePixelRatio;
      return {
        // Legacy colon syntax: exact match against spoofed DPR
        exactMatch: window.matchMedia(`(-webkit-device-pixel-ratio: ${dpr})`).matches,
        wrongValue: window.matchMedia('(-webkit-device-pixel-ratio: 99)').matches,
        // min/max variants
        minExact: window.matchMedia(`(-webkit-min-device-pixel-ratio: ${dpr})`).matches,
        minAbove: window.matchMedia(`(-webkit-min-device-pixel-ratio: ${dpr + 1})`).matches,
        maxExact: window.matchMedia(`(-webkit-max-device-pixel-ratio: ${dpr})`).matches,
        maxBelow: window.matchMedia(`(-webkit-max-device-pixel-ratio: ${Math.max(dpr - 1, 0)})`).matches,
      };
    });
    expect(result.exactMatch).toBe(true);
    expect(result.wrongValue).toBe(false);
    expect(result.minExact).toBe(true);
    expect(result.minAbove).toBe(false);
    expect(result.maxExact).toBe(true);
    expect(result.maxBelow).toBe(false);
  });
});
