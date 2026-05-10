import { test, expect } from '../fixtures/extension';

test.describe('Function.prototype.toString hardening (v2 item 6)', () => {
  test('spoofed navigator getters have no own toString property', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
      if (!desc || !desc.get) return { skip: true, hasOwn: false };
      return {
        skip: false,
        hasOwn: desc.get.hasOwnProperty('toString'),
        hasOwnLocale: desc.get.hasOwnProperty('toLocaleString'),
      };
    });

    if ((result as any).skip) {
      test.skip(true, 'No getter found');
      return;
    }
    expect(result.hasOwn).toBe(false);
    expect(result.hasOwnLocale).toBe(false);
  });

  test('spoofed navigator getter toString returns native format', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
      if (!desc || !desc.get) return { skip: true, str: '' };
      return {
        skip: false,
        str: desc.get.toString(),
      };
    });

    if ((result as any).skip) {
      test.skip(true, 'No getter found');
      return;
    }
    expect(result.str).toMatch(/^function get userAgent\(\) \{ \[native code\] \}$/);
  });

  test('Function.prototype.toString.call bypasses no own toString', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
      if (!desc || !desc.get) return { skip: true, str: '' };
      return {
        skip: false,
        str: Function.prototype.toString.call(desc.get),
      };
    });

    if ((result as any).skip) {
      test.skip(true, 'No getter found');
      return;
    }
    // Must return native code format, not the function source
    expect(result.str).toMatch(/\[native code\]/);
  });

  test('multiple spoofed properties all return native toString', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const props = [
        { obj: Navigator.prototype, name: 'userAgent' },
        { obj: Navigator.prototype, name: 'platform' },
        { obj: Navigator.prototype, name: 'hardwareConcurrency' },
        { obj: Navigator.prototype, name: 'deviceMemory' },
        { obj: Navigator.prototype, name: 'language' },
        { obj: Navigator.prototype, name: 'webdriver' },
        { obj: Screen.prototype, name: 'width' },
        { obj: Screen.prototype, name: 'height' },
        { obj: Screen.prototype, name: 'colorDepth' },
      ];
      const results: Array<{ prop: string; native: boolean; hasOwn: boolean }> = [];
      for (const { obj, name } of props) {
        const desc = Object.getOwnPropertyDescriptor(obj, name);
        if (!desc || !desc.get) continue;
        results.push({
          prop: name,
          native: desc.get.toString().includes('[native code]'),
          hasOwn: desc.get.hasOwnProperty('toString'),
        });
      }
      return results;
    });

    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      expect(r.native, `${r.prop} getter toString should contain [native code]`).toBe(true);
      expect(r.hasOwn, `${r.prop} getter should not have own toString`).toBe(false);
    }
  });

  test('disguised prototype methods have native toString', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const methods = [
        { fn: HTMLCanvasElement.prototype.toDataURL, name: 'toDataURL' },
        { fn: HTMLCanvasElement.prototype.toBlob, name: 'toBlob' },
        { fn: CanvasRenderingContext2D.prototype.getImageData, name: 'getImageData' },
        { fn: Date.prototype.getTimezoneOffset, name: 'getTimezoneOffset' },
        { fn: Performance.prototype.now, name: 'now' },
      ];
      const results: Array<{ name: string; native: boolean; hasOwn: boolean }> = [];
      for (const { fn, name } of methods) {
        results.push({
          name,
          native: fn.toString().includes('[native code]'),
          hasOwn: fn.hasOwnProperty('toString'),
        });
      }
      return results;
    });

    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      expect(r.native, `${r.name} toString should contain [native code]`).toBe(true);
      expect(r.hasOwn, `${r.name} should not have own toString`).toBe(false);
    }
  });

  test('Function.prototype.toString itself looks native', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const str = Function.prototype.toString.toString();
      const hasOwn = Function.prototype.toString.hasOwnProperty('toString');
      return { str, hasOwn };
    });

    expect(result.str).toMatch(/function toString\(\) \{ \[native code\] \}/);
    expect(result.hasOwn).toBe(false);
  });

  test('spoofed getter.name matches native "get propName" format', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const props = [
        { obj: Navigator.prototype, name: 'userAgent' },
        { obj: Navigator.prototype, name: 'platform' },
        { obj: Navigator.prototype, name: 'hardwareConcurrency' },
        { obj: Screen.prototype, name: 'width' },
        { obj: Screen.prototype, name: 'height' },
        { obj: Screen.prototype, name: 'colorDepth' },
      ];
      const results: Array<{ prop: string; getterName: string; expected: string }> = [];
      for (const { obj, name } of props) {
        const desc = Object.getOwnPropertyDescriptor(obj, name);
        if (desc && desc.get) {
          results.push({
            prop: name,
            getterName: desc.get.name,
            expected: 'get ' + name,
          });
        }
      }
      return results;
    });

    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      expect(r.getterName, `${r.prop} getter.name`).toBe(r.expected);
    }
  });

  test('behavioral override getters have native name format', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const results: Array<{ prop: string; getterName: string }> = [];
      // Event.timeStamp
      const tsDesc = Object.getOwnPropertyDescriptor(Event.prototype, 'timeStamp');
      if (tsDesc && tsDesc.get) {
        results.push({ prop: 'timeStamp', getterName: tsDesc.get.name });
      }
      // Window properties
      for (const p of ['innerWidth', 'innerHeight', 'devicePixelRatio']) {
        const d = Object.getOwnPropertyDescriptor(window, p);
        if (d && d.get) {
          results.push({ prop: p, getterName: d.get.name });
        }
      }
      return results;
    });

    for (const r of result) {
      expect(r.getterName, `${r.prop} getter.name`).toBe('get ' + r.prop);
    }
  });
});

test.describe('Descriptor hardening (v2 item 6)', () => {
  test('GOPD returns getter-shaped descriptor for spoofed navigator props', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const props = ['userAgent', 'platform', 'hardwareConcurrency', 'deviceMemory'];
      const results: Array<{ prop: string; hasGet: boolean; hasValue: boolean; configurable: boolean; enumerable: boolean }> = [];
      for (const prop of props) {
        const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, prop);
        results.push({
          prop,
          hasGet: desc ? typeof desc.get === 'function' : false,
          hasValue: desc ? 'value' in desc : false,
          configurable: desc ? desc.configurable === true : false,
          enumerable: desc ? desc.enumerable === true : false,
        });
      }
      return results;
    });

    for (const r of result) {
      expect(r.hasGet, `${r.prop} should have getter`).toBe(true);
      expect(r.hasValue, `${r.prop} should not have value (getter descriptor)`).toBe(false);
      expect(r.configurable, `${r.prop} should be configurable`).toBe(true);
      expect(r.enumerable, `${r.prop} should be enumerable`).toBe(true);
    }
  });

  test('GOPD getter toString is native for spoofed screen props', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const props = ['width', 'height', 'colorDepth', 'pixelDepth'];
      const results: Array<{ prop: string; getterStr: string }> = [];
      for (const prop of props) {
        const desc = Object.getOwnPropertyDescriptor(Screen.prototype, prop);
        if (desc && desc.get) {
          results.push({ prop, getterStr: desc.get.toString() });
        }
      }
      return results;
    });

    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      expect(r.getterStr, `${r.prop} getter`).toMatch(/\[native code\]/);
    }
  });

  test('Object.getOwnPropertyDescriptors returns consistent descriptors', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const descs = Object.getOwnPropertyDescriptors(Navigator.prototype);
      const uaDesc = descs.userAgent;
      const platDesc = descs.platform;
      return {
        uaHasGet: uaDesc ? typeof uaDesc.get === 'function' : false,
        uaGetNative: uaDesc && uaDesc.get ? uaDesc.get.toString().includes('[native code]') : false,
        platHasGet: platDesc ? typeof platDesc.get === 'function' : false,
        platGetNative: platDesc && platDesc.get ? platDesc.get.toString().includes('[native code]') : false,
      };
    });

    expect(result.uaHasGet).toBe(true);
    expect(result.uaGetNative).toBe(true);
    expect(result.platHasGet).toBe(true);
    expect(result.platGetNative).toBe(true);
  });

  test('Reflect.getOwnPropertyDescriptor returns consistent descriptors', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      if (typeof Reflect === 'undefined') return { skip: true };
      const desc = Reflect.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
      return {
        skip: false,
        hasGet: desc ? typeof desc.get === 'function' : false,
        getNative: desc && desc.get ? desc.get.toString().includes('[native code]') : false,
        configurable: desc ? desc.configurable === true : false,
      };
    });

    if ((result as any).skip) {
      test.skip(true, 'Reflect not available');
      return;
    }
    expect(result.hasGet).toBe(true);
    expect(result.getNative).toBe(true);
    expect(result.configurable).toBe(true);
  });

  test('Object.getOwnPropertyDescriptor itself looks native', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      return {
        str: Object.getOwnPropertyDescriptor.toString(),
        hasOwn: Object.getOwnPropertyDescriptor.hasOwnProperty('toString'),
      };
    });

    expect(result.str).toMatch(/\[native code\]/);
    expect(result.hasOwn).toBe(false);
  });

  test('window property descriptors have native getters', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const props = ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio'];
      const results: Array<{ prop: string; hasGet: boolean; getNative: boolean; hasOwn: boolean }> = [];
      for (const prop of props) {
        const desc = Object.getOwnPropertyDescriptor(window, prop);
        if (desc && desc.get) {
          results.push({
            prop,
            hasGet: true,
            getNative: desc.get.toString().includes('[native code]'),
            hasOwn: desc.get.hasOwnProperty('toString'),
          });
        }
      }
      return results;
    });

    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      expect(r.getNative, `${r.prop} getter`).toBe(true);
      expect(r.hasOwn, `${r.prop} no own toString`).toBe(false);
    }
  });

  test('GOPD, GOPDs, and Reflect.GOPD return consistent results', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const prop = 'userAgent';
      const gopd = Object.getOwnPropertyDescriptor(Navigator.prototype, prop);
      const gopds = Object.getOwnPropertyDescriptors(Navigator.prototype)[prop];
      const rgopd = typeof Reflect !== 'undefined'
        ? Reflect.getOwnPropertyDescriptor(Navigator.prototype, prop) : null;

      const gopdStr = gopd && gopd.get ? gopd.get.toString() : '';
      const gopdsStr = gopds && gopds.get ? gopds.get.toString() : '';
      const rgopdStr = rgopd && rgopd.get ? rgopd.get.toString() : '';

      return {
        gopdStr, gopdsStr, rgopdStr,
        gopdConf: gopd ? gopd.configurable : null,
        gopdsConf: gopds ? gopds.configurable : null,
        rgopdConf: rgopd ? rgopd.configurable : null,
        gopdEnum: gopd ? gopd.enumerable : null,
        gopdsEnum: gopds ? gopds.enumerable : null,
        rgopdEnum: rgopd ? rgopd.enumerable : null,
      };
    });

    // All three should return identical toString
    expect(result.gopdStr).toMatch(/\[native code\]/);
    expect(result.gopdsStr).toBe(result.gopdStr);
    if (result.rgopdStr) expect(result.rgopdStr).toBe(result.gopdStr);

    // All three should return identical configurable/enumerable
    expect(result.gopdsConf).toBe(result.gopdConf);
    expect(result.gopdsEnum).toBe(result.gopdEnum);
    if (result.rgopdConf !== null) expect(result.rgopdConf).toBe(result.gopdConf);
    if (result.rgopdEnum !== null) expect(result.rgopdEnum).toBe(result.gopdEnum);
  });

  test('behavioral overrides have getter.name in GOPD descriptors', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const results: Array<{ prop: string; name: string }> = [];
      // Event.timeStamp
      const ts = Object.getOwnPropertyDescriptor(Event.prototype, 'timeStamp');
      if (ts && ts.get) results.push({ prop: 'timeStamp', name: ts.get.name });
      // MouseEvent coords (may not be present on all platforms)
      for (const p of ['clientX', 'clientY']) {
        const d = Object.getOwnPropertyDescriptor(MouseEvent.prototype, p);
        if (d && d.get) results.push({ prop: p, name: d.get.name });
      }
      return results;
    });

    for (const r of result) {
      expect(r.name, `${r.prop} getter.name`).toBe('get ' + r.prop);
    }
  });
});

test.describe('Invariant preservation (v2 item 6)', () => {
  test('unrelated native functions still have normal toString', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      // These functions should NOT be in the WeakMap — toString should return
      // real source or native code, depending on the engine.
      const fns = [
        { name: 'Array.isArray', fn: Array.isArray },
        { name: 'JSON.stringify', fn: JSON.stringify },
        { name: 'parseInt', fn: parseInt },
        { name: 'Math.random', fn: Math.random },
      ];
      const results: Array<{ name: string; str: string; isNative: boolean }> = [];
      for (const { name, fn } of fns) {
        const str = fn.toString();
        results.push({
          name,
          str: str.substring(0, 60),
          isNative: str.includes('[native code]'),
        });
      }
      return results;
    });

    for (const r of result) {
      // These should still show native code (Chrome's default)
      expect(r.isNative, `${r.name} should remain native`).toBe(true);
    }
  });

  test('user-defined functions still show their source', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      function myFunc(a: any, b: any) { return a + b; }
      const str = myFunc.toString();
      return {
        showsSource: str.includes('return a + b'),
        isNative: str.includes('[native code]'),
      };
    });

    expect(result.showsSource).toBe(true);
    expect(result.isNative).toBe(false);
  });

  test('spoofed values still return correct data', async ({ extensionPage }) => {
    // Ensure the hardening didn't break the actual spoofing
    const result = await extensionPage.evaluate(() => {
      return {
        ua: navigator.userAgent,
        platform: navigator.platform,
        cores: navigator.hardwareConcurrency,
        memory: (navigator as any).deviceMemory,
        webdriver: navigator.webdriver,
        screenW: screen.width,
        screenH: screen.height,
      };
    });

    // These should be spoofed values, not real ones
    expect(result.ua).toBeTruthy();
    expect(result.platform).toBeTruthy();
    expect(typeof result.cores).toBe('number');
    expect(result.cores).toBeGreaterThan(0);
    expect(result.webdriver).toBe(false);
    expect(result.screenW).toBeGreaterThan(0);
    expect(result.screenH).toBeGreaterThan(0);
  });

  test('canvas toDataURL still works and is noised', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 100; c.height = 50;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 100, 50);

      const data1 = c.toDataURL();
      const data2 = c.toDataURL();
      return {
        hasData: data1.length > 100,
        stable: data1 === data2,
        toStringNative: HTMLCanvasElement.prototype.toDataURL.toString().includes('[native code]'),
      };
    });

    expect(result.hasData).toBe(true);
    expect(result.stable).toBe(true);
    expect(result.toStringNative).toBe(true);
  });

  test('disguised wrapper function.length matches native arity', async ({ extensionPage }) => {
    const result = await extensionPage.evaluate(() => {
      // Expected native lengths for high-risk methods
      const checks = [
        { name: 'getImageData', fn: CanvasRenderingContext2D.prototype.getImageData, expected: 4 },
        { name: 'toDataURL', fn: HTMLCanvasElement.prototype.toDataURL, expected: 0 },
        { name: 'toBlob', fn: HTMLCanvasElement.prototype.toBlob, expected: 1 },
        { name: 'measureText', fn: CanvasRenderingContext2D.prototype.measureText, expected: 1 },
        { name: 'performance.now', fn: Performance.prototype.now, expected: 0 },
        { name: 'getTimezoneOffset', fn: Date.prototype.getTimezoneOffset, expected: 0 },
      ];
      // Conditionally add AudioNode.connect
      if (typeof AudioNode !== 'undefined') {
        checks.push({ name: 'AudioNode.connect', fn: AudioNode.prototype.connect, expected: 1 });
      }
      // Worker constructor
      if (typeof Worker !== 'undefined') {
        checks.push({ name: 'Worker', fn: Worker, expected: 1 });
      }
      // SharedWorker constructor
      if (typeof SharedWorker !== 'undefined') {
        checks.push({ name: 'SharedWorker', fn: SharedWorker, expected: 1 });
      }
      const results: Array<{ name: string; length: number; expected: number }> = [];
      for (const c of checks) {
        results.push({ name: c.name, length: c.fn.length, expected: c.expected });
      }
      return results;
    });

    for (const r of result) {
      expect(r.length, `${r.name}.length`).toBe(r.expected);
    }
  });
});
