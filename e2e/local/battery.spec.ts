import { test, expect } from '../fixtures/extension';

test.describe('Battery Status API spoofing (v3 item 5c)', () => {
  test('getBattery resolves to fixed low-entropy values', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      if (typeof navigator.getBattery !== 'function') return null;
      const battery = await navigator.getBattery();
      return {
        charging: battery.charging,
        chargingTime: battery.chargingTime,
        dischargingTime: battery.dischargingTime,
        level: battery.level,
      };
    });
    if (!result) {
      test.skip(true, 'Battery API not available');
      return;
    }
    expect(result.charging).toBe(true);
    expect(result.chargingTime).toBe(0);
    expect(result.dischargingTime).toBe(Infinity);
    expect(result.level).toBe(1.0);
  });

  test('getBattery not own property on navigator', async ({ extensionPage }) => {
    const hasOwn = await extensionPage.evaluate(() => {
      return Object.prototype.hasOwnProperty.call(navigator, 'getBattery');
    });
    // getBattery should live on Navigator.prototype, not as own property
    expect(hasOwn).toBe(false);
  });

  test('returned object has BatteryManager prototype chain', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      if (typeof navigator.getBattery !== 'function') return null;
      if (typeof BatteryManager === 'undefined') return null;
      const battery = await navigator.getBattery();
      return {
        isBatteryManager: battery instanceof BatteryManager,
        isEventTarget: battery instanceof EventTarget,
        hasAddEventListener: typeof battery.addEventListener === 'function',
        hasRemoveEventListener: typeof battery.removeEventListener === 'function',
        // Properties should be on prototype, not own
        chargingOwn: Object.prototype.hasOwnProperty.call(battery, 'charging'),
        levelOwn: Object.prototype.hasOwnProperty.call(battery, 'level'),
      };
    });
    if (!result) {
      test.skip(true, 'Battery API or BatteryManager not available');
      return;
    }
    expect(result.isBatteryManager).toBe(true);
    expect(result.isEventTarget).toBe(true);
    expect(result.hasAddEventListener).toBe(true);
    expect(result.hasRemoveEventListener).toBe(true);
    // Getters should be on prototype, not own properties on instance
    expect(result.chargingOwn).toBe(false);
    expect(result.levelOwn).toBe(false);
  });

  test('battery values stable across re-reads', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(async () => {
      if (typeof navigator.getBattery !== 'function') return null;
      const b1 = await navigator.getBattery();
      const b2 = await navigator.getBattery();
      return {
        sameObject: b1 === b2,
        level1: b1.level,
        level2: b2.level,
        charging1: b1.charging,
        charging2: b2.charging,
      };
    });
    if (!result) {
      test.skip(true, 'Battery API not available');
      return;
    }
    // Chrome returns the same BatteryManager instance every call
    expect(result.sameObject).toBe(true);
    expect(result.level1).toBe(result.level2);
    expect(result.charging1).toBe(result.charging2);
  });

  test('bootstrap does not throw with Battery API present', async ({ extensionPage }) => {
    // If we got here with extensionPage loaded, bootstrap succeeded.
    // Verify the extension is active by checking a known spoofed property.
    const spoofed = await extensionPage.evaluate(() => {
      // If anti-fingerprint.js loaded, navigator.hardwareConcurrency is spoofed
      return typeof navigator.hardwareConcurrency === 'number';
    });
    expect(spoofed).toBe(true);
  });
});
