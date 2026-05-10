/**
 * Reusable page.evaluate() bundles for collecting fingerprint data.
 * Each function runs in the MAIN world (sees spoofed values).
 */

import type { Page } from '@playwright/test';

export interface NavigatorFP {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  languages: string[];
  language: string;
  webdriver: boolean;
  maxTouchPoints: number;
  vendor: string;
  appVersion: string;
  connection: unknown;
}

export async function collectNavigator(page: Page): Promise<NavigatorFP> {
  return page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as any).deviceMemory,
    languages: [...navigator.languages],
    language: navigator.language,
    webdriver: navigator.webdriver,
    maxTouchPoints: navigator.maxTouchPoints,
    vendor: navigator.vendor,
    appVersion: navigator.appVersion,
    connection: (navigator as any).connection,
  }));
}

export interface ScreenFP {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelDepth: number;
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  devicePixelRatio: number;
  visualViewportWidth: number | undefined;
  visualViewportHeight: number | undefined;
  visualViewportScale: number | undefined;
}

export async function collectScreen(page: Page): Promise<ScreenFP> {
  return page.evaluate(() => ({
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelDepth: screen.pixelDepth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    devicePixelRatio: window.devicePixelRatio,
    visualViewportWidth: window.visualViewport?.width,
    visualViewportHeight: window.visualViewport?.height,
    visualViewportScale: window.visualViewport?.scale,
  }));
}

export interface WebGLFP {
  vendor: string | null;
  renderer: string | null;
}

export async function collectWebGL(page: Page): Promise<WebGLFP> {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl') as WebGLRenderingContext | null;
    if (!gl) return { vendor: null, renderer: null };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (!dbg) return { vendor: null, renderer: null };
    return {
      vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL),
      renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL),
    };
  });
}

export interface TimezoneFP {
  timezone: string;
  offset: number;
}

export async function collectTimezone(page: Page): Promise<TimezoneFP> {
  return page.evaluate(() => ({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: new Date().getTimezoneOffset(),
  }));
}

export interface ClientHintsFP {
  available: boolean;
  mobile: boolean | undefined;
  platform: string | undefined;
  brands: Array<{ brand: string; version: string }> | undefined;
  bitness: string | undefined;
  architecture: string | undefined;
}

export async function collectClientHints(page: Page): Promise<ClientHintsFP> {
  return page.evaluate(async () => {
    const uad = (navigator as any).userAgentData;
    if (!uad) return { available: false, mobile: undefined, platform: undefined, brands: undefined, bitness: undefined, architecture: undefined };
    let bitness: string | undefined;
    let architecture: string | undefined;
    try {
      const vals = await uad.getHighEntropyValues(['architecture', 'bitness']);
      bitness = vals.bitness;
      architecture = vals.architecture;
    } catch {}
    return {
      available: true,
      mobile: uad.mobile,
      platform: uad.platform,
      brands: uad.brands?.map((b: any) => ({ brand: b.brand, version: b.version })),
      bitness,
      architecture,
    };
  });
}

/** Collect a full bundle for rotation comparison. */
export interface FullFP {
  canvas: string;
  measureText: number;
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  languages: string;
  screenWidth: number;
  screenHeight: number;
  colorDepth: number;
  timezone: string;
  glVendor: string | null;
  glRenderer: string | null;
}

export async function collectFull(page: Page): Promise<FullFP> {
  return page.evaluate(() => {
    // Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    grad.addColorStop(0, '#ff0000');
    grad.addColorStop(0.5, '#00ff00');
    grad.addColorStop(1, '#0000ff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.font = '14px Arial';
    ctx.fillText('PhantomGrid test probe', 10, 30);
    const canvasFP = canvas.toDataURL();

    // measureText
    ctx.font = '16px Arial';
    const mt = ctx.measureText('PhantomGrid rotation probe').width;

    // WebGL
    let glVendor: string | null = null;
    let glRenderer: string | null = null;
    try {
      const c2 = document.createElement('canvas');
      const gl = c2.getContext('webgl') as WebGLRenderingContext | null;
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          glVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
          glRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch {}

    return {
      canvas: canvasFP,
      measureText: mt,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as any).deviceMemory,
      languages: JSON.stringify(navigator.languages),
      screenWidth: screen.width,
      screenHeight: screen.height,
      colorDepth: screen.colorDepth,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      glVendor,
      glRenderer,
    };
  });
}
