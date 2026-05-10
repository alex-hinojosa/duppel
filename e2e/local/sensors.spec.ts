import { test, expect } from '../fixtures/extension';

test.describe('Sensor API defense', () => {
  test('DeviceMotionEvent returns null readings', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      if (typeof DeviceMotionEvent === 'undefined') return null;
      const ev = new DeviceMotionEvent('devicemotion');
      return {
        acceleration: ev.acceleration,
        accelerationIncludingGravity: ev.accelerationIncludingGravity,
        rotationRate: ev.rotationRate,
        interval: ev.interval,
      };
    });
    if (!result) {
      test.skip(true, 'DeviceMotionEvent not available');
      return;
    }
    expect(result.acceleration).toBeNull();
    expect(result.accelerationIncludingGravity).toBeNull();
    expect(result.rotationRate).toBeNull();
    expect(result.interval).toBe(0);
  });

  test('DeviceOrientationEvent returns null readings', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      if (typeof DeviceOrientationEvent === 'undefined') return null;
      const ev = new DeviceOrientationEvent('deviceorientation');
      return {
        alpha: ev.alpha,
        beta: ev.beta,
        gamma: ev.gamma,
        absolute: ev.absolute,
      };
    });
    if (!result) {
      test.skip(true, 'DeviceOrientationEvent not available');
      return;
    }
    expect(result.alpha).toBeNull();
    expect(result.beta).toBeNull();
    expect(result.gamma).toBeNull();
    expect(result.absolute).toBe(false);
  });

  test('Generic Sensor API returns null x/y/z', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const classes = ['Accelerometer', 'Gyroscope', 'LinearAccelerationSensor'];
      const results: Record<string, { x: any; y: any; z: any } | string> = {};
      for (const cls of classes) {
        if (typeof (window as any)[cls] === 'undefined') {
          results[cls] = 'unavailable';
          continue;
        }
        try {
          const sensor = new (window as any)[cls]();
          results[cls] = { x: sensor.x, y: sensor.y, z: sensor.z };
        } catch (e: any) {
          results[cls] = 'error: ' + e.message;
        }
      }
      return results;
    });

    for (const [cls, val] of Object.entries(result)) {
      if (val === 'unavailable' || (typeof val === 'string' && val.startsWith('error'))) {
        continue; // Skip unavailable/errored sensors
      }
      const sensor = val as { x: any; y: any; z: any };
      expect(sensor.x, `${cls}.x`).toBeNull();
      expect(sensor.y, `${cls}.y`).toBeNull();
      expect(sensor.z, `${cls}.z`).toBeNull();
    }
  });
});
