/**
 * PhantomGrid — Profile generation (shared algorithm).
 * Used by background.js (via importScripts) for popup display.
 *
 * MUST stay in sync with anti-fingerprint.js UA_GROUPS and generateProfile.
 * Both files use the same seed → same PRNG → same profile. If you change
 * the UA_GROUPS, screens, cores, etc. here, mirror the change there.
 */

// === Correlated UA/GPU groups (matches anti-fingerprint.js exactly) ===
const UA_GROUPS = [
  {
    // Chrome on Windows
    uas: [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    ],
    platform: "Win32",
    gpus: [
      { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)" },
      { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB, OpenGL 4.5)" },
      { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)" },
      { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, OpenGL 4.5)" },
      { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)" },
      { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 6700 XT, OpenGL 4.5)" },
      { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.5)" },
      { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) HD Graphics 620, OpenGL 4.5)" },
    ],
  },
  {
    // Chrome on macOS
    uas: [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    ],
    platform: "MacIntel",
    gpus: [
      { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M1, OpenGL 4.1)" },
      { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M2, OpenGL 4.1)" },
      { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Plus Graphics, OpenGL 4.1)" },
    ],
  },
  {
    // Firefox on Windows
    uas: [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
    ],
    platform: "Win32",
    gpus: [
      { vendor: "Intel", renderer: "Intel(R) UHD Graphics 630" },
      { vendor: "NVIDIA Corporation", renderer: "NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2" },
      { vendor: "NVIDIA Corporation", renderer: "NVIDIA GeForce RTX 3060/PCIe/SSE2" },
      { vendor: "ATI Technologies Inc.", renderer: "AMD Radeon RX 580" },
      { vendor: "Intel", renderer: "Intel(R) Iris(R) Xe Graphics" },
    ],
  },
  {
    // Firefox on macOS
    uas: [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0",
    ],
    platform: "MacIntel",
    gpus: [
      { vendor: "Apple", renderer: "Apple M1" },
      { vendor: "Apple", renderer: "Apple M2" },
      { vendor: "Intel Inc.", renderer: "Intel(R) Iris(R) Plus Graphics" },
    ],
  },
  {
    // Edge on Windows
    uas: [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
    ],
    platform: "Win32",
    gpus: [
      { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)" },
      { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)" },
      { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, OpenGL 4.5)" },
      { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.5)" },
    ],
  },
  {
    // Chrome on Linux
    uas: [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    ],
    platform: "Linux x86_64",
    gpus: [
      { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)" },
      { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB, OpenGL 4.5)" },
      { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)" },
    ],
  },
];

const SCREENS = [
  { width: 1920, height: 1080, avail: 1040 },
  { width: 2560, height: 1440, avail: 1400 },
  { width: 1366, height: 768,  avail: 728  },
  { width: 1536, height: 864,  avail: 824  },
  { width: 1440, height: 900,  avail: 860  },
  { width: 1680, height: 1050, avail: 1010 },
  { width: 3840, height: 2160, avail: 2120 },
  { width: 1280, height: 720,  avail: 680  },
  { width: 1600, height: 900,  avail: 860  },
];
const CORES = [2, 4, 6, 8, 10, 12, 16];
const MEMORY = [4, 8, 8, 8, 16, 16, 32];
const COLOR_DEPTHS = [24, 24, 24, 32];
const LANGUAGES = [
  ["en-US", "en"], ["en-US", "en", "es"], ["en-GB", "en"],
  ["en-US"], ["en-US", "en", "fr"], ["en-US", "en", "de"],
];
const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/Phoenix",
  "Europe/London", "Europe/Berlin", "America/Toronto",
];

// Seeded PRNG (mulberry32) — identical to anti-fingerprint.js
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateSessionSeed() {
  return Date.now() ^ (Math.random() * 0xFFFFFFFF >>> 0);
}

function pickFrom(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// generateProfile — MUST match anti-fingerprint.js exactly.
// Same seed → same PRNG sequence → same picks → same profile.
function generateProfile(seed) {
  const rng = mulberry32(seed);
  const group = pickFrom(UA_GROUPS, rng);
  const ua = pickFrom(group.uas, rng);
  const gpu = pickFrom(group.gpus, rng);
  return {
    userAgent: ua,
    platform: group.platform,
    hardwareConcurrency: pickFrom(CORES, rng),
    deviceMemory: pickFrom(MEMORY, rng),
    screen: pickFrom(SCREENS, rng),
    colorDepth: pickFrom(COLOR_DEPTHS, rng),
    gpu: gpu,
    languages: pickFrom(LANGUAGES, rng),
    timezone: pickFrom(TIMEZONES, rng),
    canvasSeed: (rng() * 0xFFFFFFFF) >>> 0,
    audioSeed: (rng() * 0xFFFFFFFF) >>> 0,
  };
}
