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
});
