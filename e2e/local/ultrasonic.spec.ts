import { test, expect } from '../fixtures/extension';

test.describe('WebAudio ultrasonic attenuation', () => {
  test('connect to destination does not throw', async ({ extensionPage }) => {
    const ok = await extensionPage.evaluate(() => {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        osc.frequency.value = 440;
        osc.connect(ctx.destination);
        osc.disconnect();
        ctx.close();
        return true;
      } catch { return false; }
    });
    expect(ok).toBe(true);
  });

  test('connect to GainNode works normally', async ({ extensionPage }) => {
    const ok = await extensionPage.evaluate(() => {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.disconnect();
        gain.disconnect();
        ctx.close();
        return true;
      } catch { return false; }
    });
    expect(ok).toBe(true);
  });

  test('connect to AnalyserNode does not throw', async ({ extensionPage }) => {
    const ok = await extensionPage.evaluate(() => {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const analyser = ctx.createAnalyser();
        osc.connect(analyser);
        analyser.connect(ctx.destination);
        osc.disconnect();
        analyser.disconnect();
        ctx.close();
        return true;
      } catch { return false; }
    });
    expect(ok).toBe(true);
  });

  test('19 kHz attenuated below 0.05 peak', async ({ extensionPage }) => {
    const peak = await extensionPage.evaluate(async () => {
      const offline = new OfflineAudioContext(1, 44100, 44100);
      const osc = offline.createOscillator();
      osc.frequency.value = 19000;
      osc.connect(offline.destination);
      osc.start();
      const buffer = await offline.startRendering();
      const data = buffer.getChannelData(0);
      let peak = 0;
      // Skip initial transient — measure steady state from sample 4096 onward
      for (let i = 4096; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
      return peak;
    });
    expect(peak).toBeLessThan(0.05);
  });

  test('1 kHz passes through above 0.5 peak', async ({ extensionPage }) => {
    const peak = await extensionPage.evaluate(async () => {
      const offline = new OfflineAudioContext(1, 8192, 44100);
      const osc = offline.createOscillator();
      osc.frequency.value = 1000;
      osc.connect(offline.destination);
      osc.start();
      const buffer = await offline.startRendering();
      const data = buffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
      return peak;
    });
    expect(peak).toBeGreaterThan(0.5);
  });
});
