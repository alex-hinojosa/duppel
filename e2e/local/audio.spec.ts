import { test, expect } from '../fixtures/extension';

test.describe('AudioContext noise', () => {
  test('getChannelData stable across 20 reads', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      const offline = new OfflineAudioContext(1, 4096, 44100);
      const osc = offline.createOscillator();
      osc.frequency.value = 440;
      osc.type = 'triangle';
      osc.connect(offline.destination);
      osc.start();

      const buffer = await offline.startRendering();
      const readings: string[] = [];
      for (let i = 0; i < 20; i++) {
        const data = buffer.getChannelData(0);
        readings.push(Array.from(data.slice(0, 100)).join(','));
      }
      return readings.every(r => r === readings[0]);
    });
    expect(result).toBe(true);
  });

  test('different audio content produces different noised output', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      // Buffer 1: 440Hz triangle
      const off1 = new OfflineAudioContext(1, 4096, 44100);
      const osc1 = off1.createOscillator();
      osc1.frequency.value = 440;
      osc1.type = 'triangle';
      osc1.connect(off1.destination);
      osc1.start();
      const buf1 = await off1.startRendering();

      // Buffer 2: 880Hz sine
      const off2 = new OfflineAudioContext(1, 4096, 44100);
      const osc2 = off2.createOscillator();
      osc2.frequency.value = 880;
      osc2.type = 'sine';
      osc2.connect(off2.destination);
      osc2.start();
      const buf2 = await off2.startRendering();

      const data1 = Array.from(buf1.getChannelData(0).slice(0, 100)).join(',');
      const data2 = Array.from(buf2.getChannelData(0).slice(0, 100)).join(',');
      return data1 !== data2;
    });
    expect(result).toBe(true);
  });
});
