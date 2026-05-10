import { test, expect } from '../fixtures/extension';

test.describe('Canvas noise', () => {
  test('toDataURL stable across 20 calls', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const grad = ctx.createLinearGradient(0, 0, c.width, 0);
      grad.addColorStop(0, '#ff0000');
      grad.addColorStop(0.5, '#00ff00');
      grad.addColorStop(1, '#0000ff');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#000';
      ctx.font = '14px Arial';
      ctx.fillText('PhantomGrid test probe', 10, 30);

      const results: string[] = [];
      for (let i = 0; i < 20; i++) results.push(c.toDataURL());
      return {
        allIdentical: results.every(r => r === results[0]),
        length: results[0].length,
      };
    });
    expect(result.allIdentical).toBe(true);
    expect(result.length).toBeGreaterThan(50);
  });

  test('different content produces different fingerprint', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;

      // Pattern 1
      const grad = ctx.createLinearGradient(0, 0, c.width, 0);
      grad.addColorStop(0, '#ff0000');
      grad.addColorStop(1, '#0000ff');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, c.width, c.height);
      const fp1 = c.toDataURL();

      // Pattern 2
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#222';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#f0f';
      ctx.font = '16px Courier New';
      ctx.fillText('Different content', 10, 30);
      const fp2 = c.toDataURL();

      return fp1 !== fp2;
    });
    expect(result).toBe(true);
  });

  test('redrawing same content produces identical fingerprint', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;

      function draw() {
        ctx.clearRect(0, 0, c.width, c.height);
        const grad = ctx.createLinearGradient(0, 0, c.width, 0);
        grad.addColorStop(0, '#ff0000');
        grad.addColorStop(0.5, '#00ff00');
        grad.addColorStop(1, '#0000ff');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#000';
        ctx.font = '14px Arial';
        ctx.fillText('PhantomGrid test probe', 10, 30);
      }

      draw();
      const fp1 = c.toDataURL();
      draw();
      const fp2 = c.toDataURL();
      return fp1 === fp2;
    });
    expect(result).toBe(true);
  });

  test('getImageData stable across 20 calls', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const grad = ctx.createLinearGradient(0, 0, c.width, 0);
      grad.addColorStop(0, '#ff0000');
      grad.addColorStop(1, '#0000ff');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, c.width, c.height);

      const results: string[] = [];
      for (let i = 0; i < 20; i++) {
        const id = ctx.getImageData(0, 0, c.width, c.height);
        results.push(Array.from(id.data.slice(0, 100)).join(','));
      }
      return results.every(r => r === results[0]);
    });
    expect(result).toBe(true);
  });

  test('toBlob stable across 5 calls', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, c.width, c.height);

      const promises: Promise<string>[] = [];
      for (let i = 0; i < 5; i++) {
        promises.push(new Promise<string>(resolve => {
          c.toBlob(blob => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob!);
          });
        }));
      }
      const results = await Promise.all(promises);
      return results.every(r => r === results[0]);
    });
    expect(result).toBe(true);
  });
});
