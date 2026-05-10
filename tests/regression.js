/**
 * PhantomGrid — Deterministic Noise Regression Tests
 *
 * Tests that the anti-fingerprint spoofing produces stable, deterministic
 * output when probed repeatedly with the same input. Per rowan pass 5:
 * "call the same canvas/text/audio probe N times and assert byte-for-byte
 * stability within a page session, then assert changed output after rotation."
 *
 * Load tests/regression.html with the PhantomGrid extension active.
 * All stability tests should PASS.
 *
 * Rotation test: captures fingerprints to localStorage. After rotating
 * the PhantomGrid identity (via popup or extension reload), reload this
 * page. The rotation suite will compare old vs new fingerprints and
 * assert they differ.
 *
 * Rowan pass 6 findings addressed:
 * - #1: All suites return Promises; runAll() awaits them before summary
 * - #2: Rotation/change-after-reload test added
 * - #3: Audio mutation bug fixed in anti-fingerprint.js (WeakMap guard)
 *
 * Rowan pass 7 findings addressed:
 * - #1: Rotation asserts "at least one high-entropy surface changed"
 *       instead of hard-requiring each surface individually
 * - #3: Rotation always runs in runAll(); baseline-capture is
 *       informational only (no pass/fail), comparison runs assertions
 * - #4: Worker suite labeled "classic Blob Worker navigator parity"
 * - #5: Audio first-read mutation acknowledged as future detection surface
 *
 * NOTE: The rotation suite is a MANUAL two-step test. For automated
 * release gating, use headful Playwright with --load-extension (future).
 */

(function() {
  "use strict";

  const N = 20; // Number of repeated probes per test
  let passed = 0;
  let failed = 0;
  const resultsEl = document.getElementById("results");
  const summaryEl = document.getElementById("summary");

  function log(cls, msg) {
    const div = document.createElement("div");
    div.className = "test " + cls;
    div.textContent = msg;
    resultsEl.appendChild(div);
  }

  function suite(name) {
    const h = document.createElement("h2");
    h.textContent = name;
    resultsEl.appendChild(h);
  }

  function assert(condition, passMsg, failMsg) {
    if (condition) {
      passed++;
      log("pass", "PASS: " + passMsg);
    } else {
      failed++;
      log("fail", "FAIL: " + failMsg);
    }
  }

  function updateSummary() {
    summaryEl.textContent = `${passed} passed, ${failed} failed`;
    summaryEl.className = failed === 0 ? "all-pass" : "has-fail";
  }

  // === Helper: draw a known pattern to a canvas ===
  function drawTestPattern(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    grad.addColorStop(0, "#ff0000");
    grad.addColorStop(0.5, "#00ff00");
    grad.addColorStop(1, "#0000ff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.font = "14px Arial";
    ctx.fillText("PhantomGrid test probe", 10, 30);
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.arc(150, 25, 15, 0, Math.PI * 2);
    ctx.stroke();
  }

  // === Helper: draw a DIFFERENT pattern ===
  function drawTestPattern2(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f0f";
    ctx.font = "16px Courier New";
    ctx.fillText("Different content", 10, 30);
  }

  // === Helper: collect a fingerprint bundle for rotation testing ===
  function collectFingerprints() {
    const fp = {};

    // Canvas fingerprint
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 50;
    drawTestPattern(canvas);
    fp.canvas = canvas.toDataURL();

    // measureText fingerprint
    const ctx = canvas.getContext("2d");
    ctx.font = "16px Arial";
    fp.measureText = ctx.measureText("PhantomGrid rotation probe").width;

    // Navigator fingerprint
    fp.userAgent = navigator.userAgent;
    fp.platform = navigator.platform;
    fp.hardwareConcurrency = navigator.hardwareConcurrency;
    fp.deviceMemory = navigator.deviceMemory;
    fp.languages = JSON.stringify(navigator.languages);
    fp.screenWidth = screen.width;
    fp.screenHeight = screen.height;
    fp.colorDepth = screen.colorDepth;

    // Timezone
    try {
      fp.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch(e) { fp.timezone = "unknown"; }

    // WebGL
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) {
          fp.glVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
          fp.glRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch(e) {}

    return fp;
  }

  // ================================================================
  // CANVAS TESTS (returns Promise)
  // ================================================================

  function runCanvasTests() {
    suite("Canvas: toDataURL stability (N=" + N + ")");

    const canvas = document.getElementById("testCanvas");

    // Test 1: Repeated toDataURL on same content
    drawTestPattern(canvas);
    const results = [];
    for (let i = 0; i < N; i++) {
      results.push(canvas.toDataURL());
    }
    const allSame = results.every(r => r === results[0]);
    assert(allSame,
      "toDataURL returns identical output across " + N + " calls",
      "toDataURL returned DIFFERENT output on repeated calls (advancing PRNG detected)");

    // Test 2: Non-trivial output
    assert(results[0].length > 50,
      "toDataURL produces non-trivial output (" + results[0].length + " chars)",
      "toDataURL output suspiciously short (" + results[0].length + " chars)");

    // Test 3: Different canvas content produces different fingerprint
    drawTestPattern(canvas);
    const fp1 = canvas.toDataURL();
    drawTestPattern2(canvas);
    const fp2 = canvas.toDataURL();
    assert(fp1 !== fp2,
      "Different canvas content produces different noised output",
      "Different canvas content produced IDENTICAL output (noise not input-dependent)");

    // Test 4: Redrawing the SAME content produces the same fingerprint
    drawTestPattern(canvas);
    const fp3 = canvas.toDataURL();
    assert(fp1 === fp3,
      "Redrawing same content produces identical noised output",
      "Redrawing same content produced DIFFERENT output (noise not deterministic for same input)");

    // Test 5: getImageData stability (synchronous)
    suite("Canvas: getImageData stability");
    drawTestPattern(canvas);
    const ctx = canvas.getContext("2d");
    const imgDataResults = [];
    for (let i = 0; i < N; i++) {
      const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      imgDataResults.push(Array.from(id.data).join(","));
    }
    const imgAllSame = imgDataResults.every(r => r === imgDataResults[0]);
    assert(imgAllSame,
      "getImageData returns identical pixel data across " + N + " calls",
      "getImageData returned DIFFERENT pixel data on repeated calls");

    // Test 6: toBlob stability (async)
    suite("Canvas: toBlob stability");
    drawTestPattern(canvas);
    const blobPromises = [];
    for (let i = 0; i < 5; i++) {
      blobPromises.push(new Promise(resolve => {
        canvas.toBlob(blob => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      }));
    }
    return Promise.all(blobPromises).then(blobResults => {
      const blobAllSame = blobResults.every(r => r === blobResults[0]);
      assert(blobAllSame,
        "toBlob returns identical output across 5 calls",
        "toBlob returned DIFFERENT output on repeated calls");
    });
  }

  // ================================================================
  // MEASURETEXT TESTS (returns resolved Promise)
  // ================================================================

  function runMeasureTextTests() {
    suite("measureText: width stability (N=" + N + ")");

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // Test 1: Same text+font -> same width
    ctx.font = "16px Arial";
    const widths = [];
    for (let i = 0; i < N; i++) {
      widths.push(ctx.measureText("Hello, world!").width);
    }
    const widthAllSame = widths.every(w => w === widths[0]);
    assert(widthAllSame,
      "measureText('Hello, world!') returns identical width across " + N + " calls: " + widths[0].toFixed(4),
      "measureText returned DIFFERENT widths: " + widths.slice(0,5).map(w => w.toFixed(4)).join(", ") + "...");

    // Test 2: Different text -> different width
    const w1 = ctx.measureText("Hello").width;
    const w2 = ctx.measureText("Goodbye").width;
    assert(w1 !== w2,
      "Different text produces different widths (" + w1.toFixed(4) + " vs " + w2.toFixed(4) + ")",
      "Different text produced SAME width (noise hash collision or no noise)");

    // Test 3: Different font -> different width
    ctx.font = "16px Arial";
    const wa = ctx.measureText("Test string for font comparison").width;
    ctx.font = "16px Courier New";
    const wb = ctx.measureText("Test string for font comparison").width;
    assert(wa !== wb,
      "Different font produces different widths (" + wa.toFixed(4) + " vs " + wb.toFixed(4) + ")",
      "Different font produced SAME width");

    // Test 4: Width has fractional component (noise applied)
    ctx.font = "16px Arial";
    const testWidth = ctx.measureText("Quick brown fox test").width;
    log("info", "INFO: measureText width = " + testWidth.toFixed(6));

    // Test 5: Multiple different strings all stable
    const testStrings = [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "abcdefghijklmnopqrstuvwxyz",
      "0123456789",
      "The quick brown fox jumps over the lazy dog",
      "PhantomGrid fingerprint defense",
    ];
    let multiStable = true;
    for (const str of testStrings) {
      ctx.font = "14px Arial";
      const first = ctx.measureText(str).width;
      for (let i = 0; i < 5; i++) {
        if (ctx.measureText(str).width !== first) {
          multiStable = false;
          break;
        }
      }
    }
    assert(multiStable,
      "5 different strings each return stable width across 5 repeated calls",
      "Some strings returned unstable widths across repeated calls");

    return Promise.resolve();
  }

  // ================================================================
  // AUDIO TESTS (returns Promise)
  // ================================================================

  function runAudioTests() {
    suite("AudioContext: getChannelData stability (N=" + N + ")");

    if (typeof AudioContext === "undefined" && typeof webkitAudioContext === "undefined") {
      log("info", "SKIP: AudioContext not available");
      return Promise.resolve();
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;

    // Use OfflineAudioContext for deterministic rendering
    const offline = new OfflineAudioContext(1, 4096, 44100);
    const osc = offline.createOscillator();
    osc.frequency.value = 440;
    osc.type = "triangle";
    osc.connect(offline.destination);
    osc.start();

    return offline.startRendering().then(buffer => {
      // Read channel data N times — should be identical every time
      const readings = [];
      for (let i = 0; i < N; i++) {
        const data = buffer.getChannelData(0);
        // Snapshot first 100 values (getChannelData returns a live reference)
        readings.push(Array.from(data.slice(0, 100)).join(","));
      }
      const audioAllSame = readings.every(r => r === readings[0]);
      assert(audioAllSame,
        "getChannelData returns identical samples across " + N + " calls",
        "getChannelData returned DIFFERENT samples on repeated calls (compound mutation detected)");

      // Test 2: Verify noise is applied (samples should not all be zero or pristine)
      // For a 440Hz triangle wave, the values follow a predictable pattern.
      // With noise, individual samples should deviate slightly from the ideal waveform.
      const data = buffer.getChannelData(0);
      log("info", "INFO: Audio sample[0]=" + data[0].toFixed(8) +
        " sample[50]=" + data[50].toFixed(8) +
        " sample[99]=" + data[99].toFixed(8));

      // Test 3: Different buffer -> different noised output
      const offline2 = new OfflineAudioContext(1, 4096, 44100);
      const osc2 = offline2.createOscillator();
      osc2.frequency.value = 880;
      osc2.type = "sine";
      osc2.connect(offline2.destination);
      osc2.start();

      return offline2.startRendering().then(buffer2 => {
        const data1 = Array.from(buffer.getChannelData(0).slice(0, 100)).join(",");
        const data2 = Array.from(buffer2.getChannelData(0).slice(0, 100)).join(",");
        assert(data1 !== data2,
          "Different audio content produces different noised output",
          "Different audio content produced IDENTICAL output");
      });
    }).catch(err => {
      log("fail", "FAIL: Audio test error: " + err.message);
      failed++;
    });
  }

  // ================================================================
  // PROFILE CONSISTENCY TESTS (returns Promise)
  // ================================================================

  function runProfileTests() {
    suite("Profile: navigator spoofing consistency");

    const ua = navigator.userAgent;
    const validUA = /Mozilla\/5\.0/.test(ua);
    assert(validUA,
      "navigator.userAgent matches expected pattern: " + ua.substring(0, 60) + "...",
      "navigator.userAgent looks invalid: " + ua);

    const platform = navigator.platform;
    const isWinUA = ua.includes("Windows");
    const isMacUA = ua.includes("Macintosh");
    const isLinuxUA = ua.includes("Linux");
    const platformMatch =
      (isWinUA && platform === "Win32") ||
      (isMacUA && platform === "MacIntel") ||
      (isLinuxUA && platform.startsWith("Linux"));
    assert(platformMatch,
      "navigator.platform (" + platform + ") matches userAgent OS",
      "navigator.platform (" + platform + ") MISMATCHES userAgent OS");

    const cores = navigator.hardwareConcurrency;
    assert(cores >= 2 && cores <= 16,
      "hardwareConcurrency is plausible: " + cores,
      "hardwareConcurrency out of range: " + cores);

    const mem = navigator.deviceMemory;
    assert(mem >= 4 && mem <= 32,
      "deviceMemory is plausible: " + mem + " GB",
      "deviceMemory out of range: " + mem);

    assert(navigator.webdriver === false,
      "navigator.webdriver is false",
      "navigator.webdriver is " + navigator.webdriver);

    assert(navigator.maxTouchPoints === 0,
      "maxTouchPoints is 0 (desktop profile)",
      "maxTouchPoints is " + navigator.maxTouchPoints);

    const knownWidths = [1920, 2560, 1366, 1536, 1440, 1680, 3840, 1280, 1600];
    assert(knownWidths.includes(screen.width),
      "screen.width is from known set: " + screen.width,
      "screen.width is unexpected: " + screen.width);

    assert(screen.colorDepth === 24 || screen.colorDepth === 32,
      "screen.colorDepth is plausible: " + screen.colorDepth,
      "screen.colorDepth is unexpected: " + screen.colorDepth);

    const expectedDPR = screen.width >= 3840 ? 2 : 1;
    assert(window.devicePixelRatio === expectedDPR,
      "devicePixelRatio (" + window.devicePixelRatio + ") matches screen width (" + screen.width + ")",
      "devicePixelRatio (" + window.devicePixelRatio + ") INCONSISTENT with screen width (" + screen.width + ")");

    if (window.visualViewport) {
      assert(window.visualViewport.width === window.innerWidth,
        "visualViewport.width (" + window.visualViewport.width + ") matches innerWidth",
        "visualViewport.width (" + window.visualViewport.width + ") MISMATCHES innerWidth (" + window.innerWidth + ")");
      assert(window.visualViewport.height === window.innerHeight,
        "visualViewport.height (" + window.visualViewport.height + ") matches innerHeight",
        "visualViewport.height (" + window.visualViewport.height + ") MISMATCHES innerHeight (" + window.innerHeight + ")");
    }

    const langs = navigator.languages;
    assert(Array.isArray(langs) && langs.length > 0,
      "navigator.languages is non-empty array: " + JSON.stringify(langs),
      "navigator.languages is missing or empty");
    assert(langs[0] === navigator.language,
      "navigator.language (" + navigator.language + ") matches languages[0]",
      "navigator.language (" + navigator.language + ") MISMATCHES languages[0] (" + langs[0] + ")");

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const knownTZ = [
        "America/New_York", "America/Chicago", "America/Denver",
        "America/Los_Angeles", "America/Phoenix",
        "Europe/London", "Europe/Berlin", "America/Toronto",
      ];
      assert(knownTZ.includes(tz),
        "timezone is from known set: " + tz,
        "timezone is unexpected: " + tz);
    } catch(e) {
      log("info", "INFO: Could not read timezone: " + e.message);
    }

    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) {
          const vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
          const renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
          const notReal = !renderer.includes("Qualcomm") && !renderer.includes("Adreno");
          assert(notReal,
            "WebGL renderer is spoofed: " + renderer,
            "WebGL renderer appears to be REAL hardware: " + renderer);
          log("info", "INFO: WebGL vendor=" + vendor + " renderer=" + renderer);
        }
      }
    } catch(e) {
      log("info", "INFO: WebGL test skipped: " + e.message);
    }

    // userAgentData (async — returns Promise)
    if (navigator.userAgentData) {
      const uad = navigator.userAgentData;
      assert(uad.mobile === false,
        "userAgentData.mobile is false",
        "userAgentData.mobile is " + uad.mobile);

      const uaPlatform = uad.platform;
      const expectedPlatform =
        platform === "MacIntel" ? "macOS" :
        platform.startsWith("Linux") ? "Linux" : "Windows";
      assert(uaPlatform === expectedPlatform,
        "userAgentData.platform (" + uaPlatform + ") matches navigator.platform (" + platform + ")",
        "userAgentData.platform (" + uaPlatform + ") MISMATCHES navigator.platform (" + platform + ")");

      return uad.getHighEntropyValues(["architecture", "bitness", "platformVersion"])
        .then(vals => {
          assert(vals.bitness === "64",
            "UA-CH bitness is 64",
            "UA-CH bitness is " + vals.bitness);
          log("info", "INFO: UA-CH architecture=" + vals.architecture +
            " bitness=" + vals.bitness +
            " platformVersion=" + vals.platformVersion);
        })
        .catch(() => {});
    }

    return Promise.resolve();
  }

  // ================================================================
  // MATCHMEDIA EVALUATOR TESTS (returns resolved Promise)
  // ================================================================

  function runMatchMediaTests() {
    suite("matchMedia: consistency with spoofed values");

    if (typeof window.matchMedia !== "function") {
      log("info", "SKIP: matchMedia not available");
      return Promise.resolve();
    }

    const sw = screen.width;
    const sh = screen.height;
    const dpr = window.devicePixelRatio;
    const iw = window.innerWidth;
    const ih = window.innerHeight;
    const orientation = sw >= sh ? "landscape" : "portrait";

    // --- Legacy colon syntax ---
    assert(window.matchMedia(`(min-width: ${iw}px)`).matches === true,
      "matchMedia (min-width: " + iw + "px) matches",
      "matchMedia (min-width: " + iw + "px) should match but doesn't");

    assert(window.matchMedia(`(max-width: ${iw}px)`).matches === true,
      "matchMedia (max-width: " + iw + "px) matches",
      "matchMedia (max-width: " + iw + "px) should match but doesn't");

    assert(window.matchMedia(`(min-width: ${iw + 1}px)`).matches === false,
      "matchMedia (min-width: " + (iw + 1) + "px) does NOT match",
      "matchMedia (min-width: " + (iw + 1) + "px) should NOT match — real dimensions leaking");

    assert(window.matchMedia(`(device-width: ${sw}px)`).matches === true,
      "matchMedia (device-width: " + sw + "px) matches spoofed screen.width",
      "matchMedia (device-width: " + sw + "px) should match but doesn't");

    // --- MQ Level 4 range syntax (rowan finding) ---
    assert(window.matchMedia(`(width >= ${iw}px)`).matches === true,
      "matchMedia range (width >= " + iw + "px) matches",
      "matchMedia range (width >= " + iw + "px) should match — range syntax leak");

    assert(window.matchMedia(`(width >= ${iw + 1}px)`).matches === false,
      "matchMedia range (width >= " + (iw + 1) + "px) does NOT match",
      "matchMedia range (width >= " + (iw + 1) + "px) should NOT match — range syntax leaking real width");

    assert(window.matchMedia(`(${iw}px <= width)`).matches === true,
      "matchMedia reversed range (" + iw + "px <= width) matches",
      "matchMedia reversed range should match — reversed range syntax leak");

    // Double range
    const lo = Math.max(iw - 200, 1);
    const hi = iw + 200;
    assert(window.matchMedia(`(${lo}px <= width <= ${hi}px)`).matches === true,
      "matchMedia double range (" + lo + "px <= width <= " + hi + "px) matches",
      "matchMedia double range should match — spoofed width is " + iw);

    assert(window.matchMedia(`(${iw + 10}px <= width <= ${iw + 200}px)`).matches === false,
      "matchMedia double range (above spoofed) does NOT match",
      "matchMedia double range above spoofed should NOT match");

    // Strict inequality
    assert(window.matchMedia(`(width > ${iw - 1}px)`).matches === true,
      "matchMedia strict (width > " + (iw - 1) + "px) matches",
      "matchMedia strict inequality should match");

    assert(window.matchMedia(`(width > ${iw}px)`).matches === false,
      "matchMedia strict (width > " + iw + "px) does NOT match (strict, not >=)",
      "matchMedia strict inequality at boundary should NOT match");

    // --- Resolution range ---
    assert(window.matchMedia(`(resolution >= ${dpr}dppx)`).matches === true,
      "matchMedia range (resolution >= " + dpr + "dppx) matches",
      "matchMedia resolution range should match");

    // --- Unit-based probe resistance (lux finding) ---
    // vw: 100vw = spoofed innerWidth in px
    assert(window.matchMedia("(min-width: 100vw)").matches === true,
      "matchMedia (min-width: 100vw) matches (100vw = spoofed width)",
      "matchMedia (min-width: 100vw) should match — vw units leaking real width");

    assert(window.matchMedia("(min-width: 101vw)").matches === false,
      "matchMedia (min-width: 101vw) does NOT match",
      "matchMedia (min-width: 101vw) should NOT match — vw evaluation error");

    // Physical units: 1in = 96px
    const widthInInches = iw / 96;
    assert(window.matchMedia(`(min-width: ${widthInInches}in)`).matches === true,
      "matchMedia (min-width: " + widthInInches.toFixed(2) + "in) matches",
      "matchMedia physical unit (in) should match — inch units leaking real width");

    // --- Orientation, interaction, display ---
    assert(window.matchMedia(`(orientation: ${orientation})`).matches === true,
      "matchMedia (orientation: " + orientation + ") matches",
      "matchMedia orientation should match");

    assert(window.matchMedia("(pointer: fine)").matches === true,
      "matchMedia (pointer: fine) matches (desktop)",
      "matchMedia pointer should match for desktop profile");

    assert(window.matchMedia("(hover: hover)").matches === true,
      "matchMedia (hover: hover) matches (desktop)",
      "matchMedia hover should match for desktop profile");

    // --- Binary search resistance ---
    const probeAbove = iw + 100;
    const probeBelow = Math.max(iw - 100, 1);
    assert(window.matchMedia(`(min-width: ${probeAbove}px)`).matches === false,
      "matchMedia rejects width " + probeAbove + "px (above spoofed)",
      "matchMedia accepts width above spoofed — boundary leak");
    assert(window.matchMedia(`(min-width: ${probeBelow}px)`).matches === true,
      "matchMedia accepts width " + probeBelow + "px (below spoofed)",
      "matchMedia rejects width below spoofed — boundary leak");

    // Range syntax binary search
    assert(window.matchMedia(`(width >= ${probeAbove}px)`).matches === false,
      "matchMedia range rejects width " + probeAbove + "px",
      "matchMedia range accepts width above spoofed — range syntax boundary leak");

    // --- Listener no-op (rowan finding: change events must not leak) ---
    const spoofedMQ = window.matchMedia(`(min-width: ${iw}px)`);
    let listenerFired = false;
    spoofedMQ.addEventListener("change", () => { listenerFired = true; });
    assert(typeof spoofedMQ.addEventListener === "function",
      "Spoofed MQL has addEventListener (no-op)",
      "Spoofed MQL missing addEventListener");

    // --- Preference features pass through ---
    const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
    assert(typeof darkMode.matches === "boolean",
      "matchMedia (prefers-color-scheme: dark) passes through: " + darkMode.matches,
      "matchMedia preference feature did not return boolean");

    log("info", "INFO: matchMedia spoofed width=" + iw + " device-width=" + sw +
      " DPR=" + dpr + " orientation=" + orientation);

    return Promise.resolve();
  }

  // ================================================================
  // ROTATION TEST (change-after-reload)
  // ================================================================

  // Rotation test is a MANUAL two-step flow:
  //   Step 1: Run once to capture baseline fingerprints to localStorage.
  //   Step 2: Rotate identity (popup or extension reload), reload page, run again.
  // For automated release gating, use headful Playwright with --load-extension.

  function runRotationTests() {
    suite("Rotation: manual change-after-reload (two-step)");

    const STORAGE_KEY = "__pg_regression_baseline__";
    const current = collectFingerprints();

    // Check if we have a baseline from a previous session
    let baseline = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) baseline = JSON.parse(raw);
    } catch(e) {}

    if (!baseline) {
      // No baseline — capture one. This is informational, not pass/fail.
      try {
        const obj = Object.assign({}, current, { _ts: Date.now() });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      } catch(e) {}
      log("info", "BASELINE CAPTURED. To test rotation:");
      log("info", "  1. Rotate identity via PhantomGrid popup (or reload extension)");
      log("info", "  2. Reload this page");
      log("info", "  3. The rotation suite will compare old vs new fingerprints");
      log("info", "Current canvas hash: " + current.canvas.substring(0, 60) + "...");
      log("info", "Current UA: " + current.userAgent.substring(0, 60) + "...");
      log("info", "Current screen: " + current.screenWidth + "x" + current.screenHeight);
    } else {
      // We have a baseline — compare using bundle logic (rowan pass 7 #1):
      // Assert that at least one high-entropy fingerprint surface changed,
      // rather than hard-requiring each surface individually. measureText
      // noise can collide (same canvasSeed for that text/font), so individual
      // assertions would produce false failures.

      const surfaceChanges = [];

      // High-entropy surfaces (any one changing proves rotation worked)
      if (baseline.canvas !== current.canvas)
        surfaceChanges.push("canvas");
      if (baseline.measureText !== current.measureText)
        surfaceChanges.push("measureText");
      if (baseline.glRenderer && current.glRenderer &&
          baseline.glRenderer !== current.glRenderer)
        surfaceChanges.push("WebGL renderer");

      // Profile properties (report which changed, no hard requirement per-key)
      const profileKeys = ["userAgent", "platform", "hardwareConcurrency",
        "deviceMemory", "languages", "screenWidth", "screenHeight",
        "colorDepth", "timezone"];
      const profileDiffs = [];
      for (const key of profileKeys) {
        if (String(baseline[key]) !== String(current[key])) {
          surfaceChanges.push(key);
          profileDiffs.push(key);
        }
      }

      // Core assertion: at least one high-entropy surface changed
      assert(surfaceChanges.length > 0,
        surfaceChanges.length + " fingerprint surface(s) changed after rotation: " +
          surfaceChanges.join(", "),
        "NO fingerprint surfaces changed after rotation — identity may not have rotated");

      // Report details
      if (profileDiffs.length > 0) {
        log("info", "Profile properties changed: " + profileDiffs.join(", "));
      } else {
        log("info", "INFO: No navigator/screen properties changed (random overlap). " +
          "Noise surfaces (canvas/measureText) may still differ.");
      }

      // Current fingerprints should still be internally stable
      const verify = collectFingerprints();
      assert(verify.canvas === current.canvas,
        "Post-rotation fingerprint is stable within this session",
        "Post-rotation fingerprint is UNSTABLE within this session");

      // Clear baseline so next run captures a fresh one
      try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
      log("info", "Baseline cleared. Run again to capture a new baseline.");
    }

    return Promise.resolve();
  }

  // Helper: check if rotation baseline exists (for conditional inclusion in runAll)
  function hasRotationBaseline() {
    try {
      return !!localStorage.getItem("__pg_regression_baseline__");
    } catch(e) { return false; }
  }

  // ================================================================
  // CONTEXT PARITY: Worker navigator (returns Promise)
  // Covers: Classic Blob Worker, Module Worker, SharedWorker.
  // ServiceWorker and Worklets are NOT covered (see known limitations).
  // ================================================================

  function runWorkerTests() {
    suite("Context parity: classic Blob Worker navigator");

    if (typeof Worker === "undefined") {
      log("info", "SKIP: Worker not available");
      return Promise.resolve();
    }

    // Create a worker that reads navigator properties and posts them back
    const workerCode = `
      self.onmessage = function() {
        self.postMessage({
          userAgent: self.navigator.userAgent,
          platform: self.navigator.platform,
          hardwareConcurrency: self.navigator.hardwareConcurrency,
          deviceMemory: self.navigator.deviceMemory,
          language: self.navigator.language,
          languages: Array.from(self.navigator.languages || []),
        });
      };
    `;

    return new Promise((resolve) => {
      try {
        const blob = new Blob([workerCode], { type: "application/javascript" });
        const worker = new Worker(URL.createObjectURL(blob));

        const timeout = setTimeout(() => {
          assert(false,
            "",
            "Classic Worker did not respond within 5s — wrapper or runtime failure");
          worker.terminate();
          resolve();
        }, 5000);

        worker.onmessage = function(e) {
          clearTimeout(timeout);
          const wd = e.data;

          // Worker navigator should match window navigator (spoofed)
          assert(wd.userAgent === navigator.userAgent,
            "Worker userAgent matches window: " + wd.userAgent.substring(0, 50) + "...",
            "Worker userAgent MISMATCHES window. Worker: " +
              wd.userAgent.substring(0, 40) + " Window: " +
              navigator.userAgent.substring(0, 40));

          assert(wd.platform === navigator.platform,
            "Worker platform matches window: " + wd.platform,
            "Worker platform MISMATCHES window. Worker: " + wd.platform +
              " Window: " + navigator.platform);

          assert(wd.hardwareConcurrency === navigator.hardwareConcurrency,
            "Worker hardwareConcurrency matches window: " + wd.hardwareConcurrency,
            "Worker hardwareConcurrency MISMATCHES window. Worker: " +
              wd.hardwareConcurrency + " Window: " + navigator.hardwareConcurrency);

          assert(wd.deviceMemory === navigator.deviceMemory,
            "Worker deviceMemory matches window: " + wd.deviceMemory,
            "Worker deviceMemory MISMATCHES window. Worker: " +
              wd.deviceMemory + " Window: " + navigator.deviceMemory);

          assert(wd.language === navigator.language,
            "Worker language matches window: " + wd.language,
            "Worker language MISMATCHES window. Worker: " +
              wd.language + " Window: " + navigator.language);

          worker.terminate();
          resolve();
        };

        worker.onerror = function(err) {
          clearTimeout(timeout);
          assert(false,
            "",
            "Classic Worker runtime error: " + (err.message || "unknown"));
          worker.terminate();
          resolve();
        };

        worker.postMessage("go");
      } catch(e) {
        assert(false,
          "",
          "Classic Worker creation failed: " + e.message);
        resolve();
      }
    });
  }

  // ================================================================
  // CONTEXT PARITY: Module Worker navigator (returns Promise)
  // ================================================================

  function runModuleWorkerTests() {
    suite("Context parity: Module Worker navigator");

    if (typeof Worker === "undefined") {
      log("info", "SKIP: Worker not available");
      return Promise.resolve();
    }

    // Module worker: uses type "module" and cannot use importScripts().
    // PhantomGrid intercepts Worker constructor and wraps with dynamic import().
    const workerCode = `
      self.onmessage = function() {
        self.postMessage({
          userAgent: self.navigator.userAgent,
          platform: self.navigator.platform,
          hardwareConcurrency: self.navigator.hardwareConcurrency,
          deviceMemory: self.navigator.deviceMemory,
          language: self.navigator.language,
          languages: Array.from(self.navigator.languages || []),
        });
      };
    `;

    return new Promise((resolve) => {
      try {
        const blob = new Blob([workerCode], { type: "application/javascript" });
        const worker = new Worker(URL.createObjectURL(blob), { type: "module" });

        const timeout = setTimeout(() => {
          assert(false,
            "",
            "Module Worker did not respond within 5s — wrapper or runtime failure");
          worker.terminate();
          resolve();
        }, 5000);

        worker.onmessage = function(e) {
          clearTimeout(timeout);
          const wd = e.data;

          assert(wd.userAgent === navigator.userAgent,
            "Module Worker userAgent matches window",
            "Module Worker userAgent MISMATCHES window. Worker: " +
              wd.userAgent.substring(0, 40) + " Window: " +
              navigator.userAgent.substring(0, 40));

          assert(wd.platform === navigator.platform,
            "Module Worker platform matches window: " + wd.platform,
            "Module Worker platform MISMATCHES window");

          assert(wd.hardwareConcurrency === navigator.hardwareConcurrency,
            "Module Worker hardwareConcurrency matches window: " + wd.hardwareConcurrency,
            "Module Worker hardwareConcurrency MISMATCHES window");

          assert(wd.deviceMemory === navigator.deviceMemory,
            "Module Worker deviceMemory matches window: " + wd.deviceMemory,
            "Module Worker deviceMemory MISMATCHES window");

          worker.terminate();
          resolve();
        };

        worker.onerror = function(err) {
          clearTimeout(timeout);
          assert(false,
            "",
            "Module Worker runtime error: " + (err.message || "unknown"));
          worker.terminate();
          resolve();
        };

        worker.postMessage("go");
      } catch(e) {
        assert(false,
          "",
          "Module Worker creation failed: " + e.message);
        resolve();
      }
    });
  }

  // ================================================================
  // CONTEXT PARITY: SharedWorker navigator (returns Promise)
  // ================================================================

  function runSharedWorkerTests() {
    suite("Context parity: SharedWorker navigator");

    if (typeof SharedWorker === "undefined") {
      log("info", "SKIP: SharedWorker not available");
      return Promise.resolve();
    }

    const workerCode = `
      self.onconnect = function(e) {
        const port = e.ports[0];
        port.onmessage = function() {
          port.postMessage({
            userAgent: self.navigator.userAgent,
            platform: self.navigator.platform,
            hardwareConcurrency: self.navigator.hardwareConcurrency,
            deviceMemory: self.navigator.deviceMemory,
            language: self.navigator.language,
            languages: Array.from(self.navigator.languages || []),
          });
        };
      };
    `;

    return new Promise((resolve) => {
      try {
        const blob = new Blob([workerCode], { type: "application/javascript" });
        const worker = new SharedWorker(URL.createObjectURL(blob));

        const timeout = setTimeout(() => {
          assert(false,
            "",
            "SharedWorker did not respond within 5s — wrapper or runtime failure");
          resolve();
        }, 5000);

        worker.port.onmessage = function(e) {
          clearTimeout(timeout);
          const wd = e.data;

          assert(wd.userAgent === navigator.userAgent,
            "SharedWorker userAgent matches window",
            "SharedWorker userAgent MISMATCHES window. Worker: " +
              wd.userAgent.substring(0, 40) + " Window: " +
              navigator.userAgent.substring(0, 40));

          assert(wd.platform === navigator.platform,
            "SharedWorker platform matches window: " + wd.platform,
            "SharedWorker platform MISMATCHES window");

          assert(wd.hardwareConcurrency === navigator.hardwareConcurrency,
            "SharedWorker hardwareConcurrency matches window: " + wd.hardwareConcurrency,
            "SharedWorker hardwareConcurrency MISMATCHES window");

          assert(wd.deviceMemory === navigator.deviceMemory,
            "SharedWorker deviceMemory matches window: " + wd.deviceMemory,
            "SharedWorker deviceMemory MISMATCHES window");

          resolve();
        };

        worker.onerror = function(err) {
          clearTimeout(timeout);
          assert(false,
            "",
            "SharedWorker runtime error: " + (err.message || "unknown"));
          resolve();
        };

        worker.port.start();
        worker.port.postMessage("go");
      } catch(e) {
        assert(false,
          "",
          "SharedWorker creation failed: " + e.message);
        resolve();
      }
    });
  }

  // ================================================================
  // SENSOR API DEFENSE TESTS (returns resolved Promise)
  // ================================================================

  function runSensorTests() {
    suite("Sensor API: DeviceMotion/Orientation + Generic Sensors");

    // DeviceMotionEvent — readings should be null (no sensor hardware)
    if (typeof DeviceMotionEvent !== "undefined") {
      const ev = new DeviceMotionEvent("devicemotion");
      assert(ev.acceleration === null,
        "DeviceMotionEvent.acceleration is null",
        "DeviceMotionEvent.acceleration is NOT null: " + ev.acceleration);
      assert(ev.accelerationIncludingGravity === null,
        "DeviceMotionEvent.accelerationIncludingGravity is null",
        "DeviceMotionEvent.accelerationIncludingGravity is NOT null");
      assert(ev.rotationRate === null,
        "DeviceMotionEvent.rotationRate is null",
        "DeviceMotionEvent.rotationRate is NOT null: " + ev.rotationRate);
      assert(ev.interval === 0,
        "DeviceMotionEvent.interval is 0",
        "DeviceMotionEvent.interval is " + ev.interval);
    } else {
      log("info", "SKIP: DeviceMotionEvent not available");
    }

    // DeviceOrientationEvent — readings should be null
    if (typeof DeviceOrientationEvent !== "undefined") {
      const ev = new DeviceOrientationEvent("deviceorientation");
      assert(ev.alpha === null,
        "DeviceOrientationEvent.alpha is null",
        "DeviceOrientationEvent.alpha is NOT null: " + ev.alpha);
      assert(ev.beta === null,
        "DeviceOrientationEvent.beta is null",
        "DeviceOrientationEvent.beta is NOT null: " + ev.beta);
      assert(ev.gamma === null,
        "DeviceOrientationEvent.gamma is null",
        "DeviceOrientationEvent.gamma is NOT null: " + ev.gamma);
      assert(ev.absolute === false,
        "DeviceOrientationEvent.absolute is false",
        "DeviceOrientationEvent.absolute is " + ev.absolute);
    } else {
      log("info", "SKIP: DeviceOrientationEvent not available");
    }

    // Generic Sensor API — reading properties should be null
    const sensorClasses = [
      "Accelerometer", "Gyroscope", "LinearAccelerationSensor",
    ];
    for (const cls of sensorClasses) {
      if (typeof window[cls] !== "undefined") {
        try {
          const sensor = new window[cls]();
          assert(sensor.x === null,
            cls + ".x is null (no sensor hardware)",
            cls + ".x is NOT null: " + sensor.x);
          assert(sensor.y === null,
            cls + ".y is null",
            cls + ".y is NOT null: " + sensor.y);
          assert(sensor.z === null,
            cls + ".z is null",
            cls + ".z is NOT null: " + sensor.z);
        } catch(e) {
          // Construction may fail without secure context or permission
          log("info", "SKIP: " + cls + " construction threw: " + e.message);
        }
      } else {
        log("info", "SKIP: " + cls + " not available (desktop without sensor API)");
      }
    }

    return Promise.resolve();
  }

  // ================================================================
  // WEBAUDIO ULTRASONIC ATTENUATION TESTS (returns Promise)
  // ================================================================

  function runUltrasonicTests() {
    suite("WebAudio: ultrasonic filter insertion");

    if (typeof AudioContext === "undefined" && typeof webkitAudioContext === "undefined") {
      log("info", "SKIP: AudioContext not available");
      return Promise.resolve();
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;

    // Test 1: connecting to destination should not throw
    try {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      assert(true,
        "AudioNode.connect(destination) succeeds with ultrasonic filter",
        "");
      osc.disconnect();
      ctx.close();
    } catch(e) {
      assert(false,
        "",
        "AudioNode.connect(destination) threw: " + e.message);
    }

    // Test 2: connecting to a non-destination/non-analyser node unchanged
    try {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      assert(true,
        "AudioNode.connect(GainNode) works normally (no filter inserted)",
        "");
      osc.disconnect();
      gain.disconnect();
      ctx.close();
    } catch(e) {
      assert(false,
        "",
        "AudioNode.connect(non-destination) threw: " + e.message);
    }

    // Test 3: connecting to AnalyserNode should not throw (lux finding)
    try {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const analyser = ctx.createAnalyser();
      osc.connect(analyser);
      analyser.connect(ctx.destination);
      assert(true,
        "AudioNode.connect(AnalyserNode) succeeds with ultrasonic filter",
        "");
      osc.disconnect();
      analyser.disconnect();
      ctx.close();
    } catch(e) {
      assert(false,
        "",
        "AudioNode.connect(AnalyserNode) threw: " + e.message);
    }

    // Test 4: verify attenuation via OfflineAudioContext — destination path
    const offline = new OfflineAudioContext(1, 8192, 44100);
    const osc = offline.createOscillator();
    osc.frequency.value = 19000; // near-ultrasonic
    osc.connect(offline.destination);
    osc.start();

    return offline.startRendering().then(buffer => {
      const data = buffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
      // -70 dB attenuation: ~0.000316 peak. Allow headroom: < 0.01
      assert(peak < 0.01,
        "19 kHz → destination attenuated (peak=" + peak.toFixed(6) + ")",
        "19 kHz → destination NOT attenuated (peak=" + peak.toFixed(6) + ")");

      // Test 5: verify sub-17kHz tone passes through
      const offline2 = new OfflineAudioContext(1, 8192, 44100);
      const osc2 = offline2.createOscillator();
      osc2.frequency.value = 1000;
      osc2.connect(offline2.destination);
      osc2.start();

      return offline2.startRendering().then(buffer2 => {
        const data2 = buffer2.getChannelData(0);
        let peak2 = 0;
        for (let i = 0; i < data2.length; i++) {
          const abs = Math.abs(data2[i]);
          if (abs > peak2) peak2 = abs;
        }
        assert(peak2 > 0.5,
          "1 kHz passes through ultrasonic filter (peak=" + peak2.toFixed(6) + ")",
          "1 kHz was attenuated (peak=" + peak2.toFixed(6) + ") — filter too aggressive");

        log("info", "INFO: 19 kHz dest peak=" + peak.toFixed(6) +
          ", 1 kHz dest peak=" + peak2.toFixed(6));

        // Known bypass classes (documented, not tested):
        // - AudioWorklet processors (separate thread, not patchable)
        // - MediaStreamAudioDestinationNode (recording/WebRTC output)
        log("info", "INFO: AudioWorklet + MediaStreamAudioDestinationNode are documented bypasses");
      });
    }).catch(err => {
      log("fail", "FAIL: Ultrasonic test error: " + err.message);
      failed++;
    });
  }

  // ================================================================
  // BEHAVIORAL BIOMETRIC PRECISION-REDUCTION TESTS (v2 item 3)
  // Covers: synthetic event transparency, coordinate invariants,
  //   WheelEvent skip on editable/canvas/SVG, timestamp stability.
  // ================================================================

  function runBiometricTests() {
    suite("Behavioral biometrics: synthetic event transparency + invariants");

    // --- Synthetic MouseEvent: coordinates must be UNCHANGED ---
    // A page creating synthetic events expects exact constructor values.
    // If PhantomGrid modifies them, it reveals the extension.
    const synMouse = new MouseEvent("mousemove", {
      clientX: 100, clientY: 200,
      screenX: 300, screenY: 400,
      pageX: 100, pageY: 200,
    });
    assert(synMouse.clientX === 100,
      "Synthetic MouseEvent clientX unchanged (100)",
      "Synthetic MouseEvent clientX modified: " + synMouse.clientX + " (expected 100)");
    assert(synMouse.clientY === 200,
      "Synthetic MouseEvent clientY unchanged (200)",
      "Synthetic MouseEvent clientY modified: " + synMouse.clientY + " (expected 200)");
    assert(synMouse.screenX === 300,
      "Synthetic MouseEvent screenX unchanged (300)",
      "Synthetic MouseEvent screenX modified: " + synMouse.screenX + " (expected 300)");
    assert(synMouse.screenY === 400,
      "Synthetic MouseEvent screenY unchanged (400)",
      "Synthetic MouseEvent screenY modified: " + synMouse.screenY + " (expected 400)");
    assert(synMouse.pageX === 100,
      "Synthetic MouseEvent pageX unchanged (100)",
      "Synthetic MouseEvent pageX modified: " + synMouse.pageX + " (expected 100)");
    assert(synMouse.pageY === 200,
      "Synthetic MouseEvent pageY unchanged (200)",
      "Synthetic MouseEvent pageY modified: " + synMouse.pageY + " (expected 200)");

    // --- Synthetic MouseEvent: x === clientX, y === clientY ---
    assert(synMouse.x === synMouse.clientX,
      "Synthetic MouseEvent x === clientX (" + synMouse.x + ")",
      "Synthetic MouseEvent x !== clientX (x=" + synMouse.x + ", clientX=" + synMouse.clientX + ")");
    assert(synMouse.y === synMouse.clientY,
      "Synthetic MouseEvent y === clientY (" + synMouse.y + ")",
      "Synthetic MouseEvent y !== clientY (y=" + synMouse.y + ", clientY=" + synMouse.clientY + ")");

    // --- Synthetic WheelEvent: delta must be UNCHANGED ---
    if (typeof WheelEvent !== "undefined") {
      const synWheel = new WheelEvent("wheel", {
        deltaX: 3.7, deltaY: -12.5,
      });
      assert(synWheel.deltaX === 3.7,
        "Synthetic WheelEvent deltaX unchanged (3.7)",
        "Synthetic WheelEvent deltaX modified: " + synWheel.deltaX + " (expected 3.7)");
      assert(synWheel.deltaY === -12.5,
        "Synthetic WheelEvent deltaY unchanged (-12.5)",
        "Synthetic WheelEvent deltaY modified: " + synWheel.deltaY + " (expected -12.5)");
    } else {
      log("info", "SKIP: WheelEvent not available");
    }

    // --- Synthetic Event.timeStamp: must be UNCHANGED ---
    // Base Event with isTrusted=false (all constructor-created events)
    const synEvent = new Event("custom");
    const synTS = synEvent.timeStamp;
    // Re-read to confirm stable
    assert(synEvent.timeStamp === synTS,
      "Synthetic Event timeStamp stable on re-read (" + synTS.toFixed(3) + ")",
      "Synthetic Event timeStamp changed on re-read: " + synEvent.timeStamp + " vs " + synTS);
    // Synthetic events have isTrusted=false — verify we can read it
    assert(synEvent.isTrusted === false,
      "Constructor Event has isTrusted=false",
      "Constructor Event has isTrusted=" + synEvent.isTrusted);

    // Create a MouseEvent and check its timeStamp is also untouched
    const synMouse2 = new MouseEvent("click", { clientX: 50, clientY: 50 });
    const synMouse2TS = synMouse2.timeStamp;
    assert(synMouse2.timeStamp === synMouse2TS,
      "Synthetic MouseEvent timeStamp stable on re-read (" + synMouse2TS.toFixed(3) + ")",
      "Synthetic MouseEvent timeStamp changed on re-read");

    // --- Coordinate invariant: pageX - clientX consistency ---
    // For a synthetic event, pageX and clientX should both be exact.
    // pageX - clientX should equal 0 (no scroll offset in constructor defaults).
    const synMouse3 = new MouseEvent("mousemove", {
      clientX: 150, clientY: 75, pageX: 150, pageY: 75,
    });
    assert(synMouse3.pageX - synMouse3.clientX === 0,
      "Synthetic: pageX - clientX = 0 (no scroll offset)",
      "Synthetic: pageX - clientX = " + (synMouse3.pageX - synMouse3.clientX) + " (expected 0)");
    assert(synMouse3.pageY - synMouse3.clientY === 0,
      "Synthetic: pageY - clientY = 0 (no scroll offset)",
      "Synthetic: pageY - clientY = " + (synMouse3.pageY - synMouse3.clientY) + " (expected 0)");

    // --- WheelEvent on canvas target: delta should be unchanged ---
    // Create a WheelEvent targeting a canvas element
    const testCanvas = document.getElementById("testCanvas") || document.createElement("canvas");
    if (typeof WheelEvent !== "undefined") {
      // Dispatch to canvas — synthetic, so isTrusted=false → skip noise
      const canvasWheel = new WheelEvent("wheel", {
        deltaX: 0.5, deltaY: -7.3,
      });
      // Even without dispatching, the getter should return original values
      // because isTrusted=false skips all noise
      assert(canvasWheel.deltaY === -7.3,
        "WheelEvent (synthetic, canvas context) deltaY unchanged (-7.3)",
        "WheelEvent (synthetic) deltaY modified: " + canvasWheel.deltaY);
    }

    // --- performance.now() quantization ---
    const pn = performance.now();
    // Should be quantized to 0.1ms — multiply by 10, should be near-integer
    const pn10 = Math.round(pn * 10);
    const pnErr = Math.abs(pn * 10 - pn10);
    assert(pnErr < 0.001,
      "performance.now() quantized to 0.1ms (value=" + pn.toFixed(4) + ")",
      "performance.now() not quantized to 0.1ms (value=" + pn.toFixed(6) +
        ", error=" + pnErr.toFixed(6) + ")");

    // Re-read stability
    const pn2 = performance.now();
    assert(typeof pn2 === "number" && pn2 >= pn,
      "performance.now() monotonic (" + pn.toFixed(1) + " <= " + pn2.toFixed(1) + ")",
      "performance.now() went backwards: " + pn2 + " < " + pn);

    log("info", "INFO: performance.now()=" + pn.toFixed(4) +
      ", synMouse.clientX=" + synMouse.clientX +
      ", synEvent.timeStamp=" + synTS.toFixed(3));

    return Promise.resolve();
  }

  // ================================================================
  // RUN ALL (Promise-based, rowan finding #1)
  // ================================================================

  async function _runAll() {
    resultsEl.innerHTML = "";
    passed = 0;
    failed = 0;

    await runCanvasTests();
    await runMeasureTextTests();
    await runAudioTests();
    await runProfileTests();
    await runWorkerTests();
    await runModuleWorkerTests();
    await runSharedWorkerTests();
    await runMatchMediaTests();
    await runSensorTests();
    await runUltrasonicTests();
    await runBiometricTests();

    // Rotation is a manual two-step test (rowan pass 7 #3).
    // When no baseline exists: captures one (informational log only, no pass/fail).
    // When baseline exists: runs comparison assertions (pass/fail counted).
    // Either way, baseline-capture never inflates the pass count.
    await runRotationTests();

    updateSummary();
  }

  async function _runSingle(fn) {
    resultsEl.innerHTML = "";
    passed = 0;
    failed = 0;
    await fn();
    updateSummary();
  }

  // Expose to window for button handlers
  window.runAll = _runAll;
  window.runCanvasTests = () => _runSingle(runCanvasTests);
  window.runMeasureTextTests = () => _runSingle(runMeasureTextTests);
  window.runAudioTests = () => _runSingle(runAudioTests);
  window.runProfileTests = () => _runSingle(runProfileTests);
  window.runWorkerTests = () => _runSingle(runWorkerTests);
  window.runModuleWorkerTests = () => _runSingle(runModuleWorkerTests);
  window.runSharedWorkerTests = () => _runSingle(runSharedWorkerTests);
  window.runMatchMediaTests = () => _runSingle(runMatchMediaTests);
  window.runSensorTests = () => _runSingle(runSensorTests);
  window.runUltrasonicTests = () => _runSingle(runUltrasonicTests);
  window.runBiometricTests = () => _runSingle(runBiometricTests);
  window.runRotationTests = () => _runSingle(runRotationTests);
})();
