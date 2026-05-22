import { test, expect } from '../fixtures/extension';

test.describe('measureText noise', () => {
  test('same text+font stable across 20 calls', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      ctx.font = '16px Arial';
      const widths: number[] = [];
      for (let i = 0; i < 20; i++) {
        widths.push(ctx.measureText('Hello, world!').width);
      }
      return widths.every(w => w === widths[0]);
    });
    expect(result).toBe(true);
  });

  test('different text produces different width', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      ctx.font = '16px Arial';
      const w1 = ctx.measureText('Hello').width;
      const w2 = ctx.measureText('Goodbye').width;
      return w1 !== w2;
    });
    expect(result).toBe(true);
  });

  test('different font produces different width', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      ctx.font = '16px Arial';
      const wa = ctx.measureText('Test string for font comparison').width;
      ctx.font = '16px Courier New';
      const wb = ctx.measureText('Test string for font comparison').width;
      return wa !== wb;
    });
    expect(result).toBe(true);
  });

  test('multiple strings all stable across 5 calls each', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      ctx.font = '14px Arial';

      const testStrings = [
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'abcdefghijklmnopqrstuvwxyz',
        '0123456789',
        'The quick brown fox jumps over the lazy dog',
        'Duppel fingerprint defense',
      ];

      for (const str of testStrings) {
        const first = ctx.measureText(str).width;
        for (let i = 0; i < 5; i++) {
          if (ctx.measureText(str).width !== first) return false;
        }
      }
      return true;
    });
    expect(result).toBe(true);
  });

  test('measureText returns object with width property', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      ctx.font = '16px Arial';
      const metrics = ctx.measureText('Test');
      return {
        hasWidth: 'width' in metrics,
        widthIsNumber: typeof metrics.width === 'number',
        widthIsFinite: Number.isFinite(metrics.width),
        widthPositive: metrics.width > 0,
      };
    });
    expect(result.hasWidth).toBe(true);
    expect(result.widthIsNumber).toBe(true);
    expect(result.widthIsFinite).toBe(true);
    expect(result.widthPositive).toBe(true);
  });

  test('measureText result has correct prototype', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      ctx.font = '16px Arial';
      const metrics = ctx.measureText('Test');
      return {
        isTextMetrics: metrics instanceof TextMetrics,
        protoIsTextMetrics: Object.getPrototypeOf(metrics) === TextMetrics.prototype,
      };
    });
    expect(result.isTextMetrics).toBe(true);
    expect(result.protoIsTextMetrics).toBe(true);
  });

  test('measureText result has no unexpected own properties', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      ctx.font = '16px Arial';
      const metrics = ctx.measureText('Test');
      const ownKeys = Object.getOwnPropertyNames(metrics);
      // Standard TextMetrics properties (all on prototype, none own)
      // Chrome puts no own properties on TextMetrics instances.
      return { ownKeys };
    });
    // TextMetrics instances should have no own properties — all accessors live on the prototype
    expect(result.ownKeys).toEqual([]);
  });
});
