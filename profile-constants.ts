/**
 * Known-good value sets mirrored from profiles.js and anti-fingerprint.js.
 * Used by spec files to validate that spoofed values are plausible.
 */

export const KNOWN_SCREENS = [
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

export const KNOWN_WIDTHS = KNOWN_SCREENS.map(s => s.width);

export const KNOWN_CORES = [2, 4, 6, 8, 10, 12, 16];

export const KNOWN_MEMORY = [4, 8, 16, 32];

export const KNOWN_COLOR_DEPTHS = [24, 32];

export const KNOWN_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/Phoenix",
  "Europe/London", "Europe/Berlin", "America/Toronto",
];

/** All known GPU renderers across all UA_GROUPS */
export const KNOWN_RENDERERS = [
  "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)",
  "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB, OpenGL 4.5)",
  "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)",
  "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, OpenGL 4.5)",
  "ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)",
  "ANGLE (AMD, AMD Radeon RX 6700 XT, OpenGL 4.5)",
  "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.5)",
  "ANGLE (Intel, Intel(R) HD Graphics 620, OpenGL 4.5)",
  "ANGLE (Apple, Apple M1, OpenGL 4.1)",
  "ANGLE (Apple, Apple M2, OpenGL 4.1)",
  "ANGLE (Intel, Intel(R) Iris(R) Plus Graphics, OpenGL 4.1)",
  "Intel(R) UHD Graphics 630",
  "NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2",
  "NVIDIA GeForce RTX 3060/PCIe/SSE2",
  "ATI Technologies Inc.",
  "AMD Radeon RX 580",
  "Intel(R) Iris(R) Xe Graphics",
  "Apple M1",
  "Apple M2",
  "Intel(R) Iris(R) Plus Graphics",
];

/** Platforms from UA_GROUPS */
export const KNOWN_PLATFORMS = ["Win32", "MacIntel", "Linux x86_64"];
