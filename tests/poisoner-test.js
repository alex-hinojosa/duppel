/**
 * PhantomGrid — Poisoner Invariant Tests
 *
 * Non-network harness that stubs fetch and validates:
 * - Batch sizes per chaos level (stealth=1, balanced=1-3, chaos=5-15)
 * - Session identifier stability across multiple payloads
 * - GA4 cid stability (rowan pass finding)
 * - Host/path coherence (URLs must be from the same site entry)
 * - selectPersona() changes persona state after rotation
 * - Disabled state does not fire beacons
 *
 * Load tests/poisoner-test.html with the extension active
 * (or run standalone — poisoner.js is imported via script tag).
 */

(function() {
  "use strict";

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

  // Stub fetch to capture calls without network
  const fetchCalls = [];
  const origFetch = window.fetch;
  function stubFetch() {
    fetchCalls.length = 0;
    window.fetch = function(url, opts) {
      fetchCalls.push({ url, opts });
      return Promise.resolve(new Response("", { status: 204 }));
    };
  }
  function restoreFetch() {
    window.fetch = origFetch;
  }

  // ================================================================
  // PERSONA INITIALIZATION
  // ================================================================

  function testPersonaInit() {
    suite("Persona initialization");

    POISONER.selectPersona();

    assert(POISONER._activeClusters !== null && POISONER._activeClusters.length >= 2,
      "selectPersona() picks 2-3 clusters: " + (POISONER._activeClusters || []).length,
      "selectPersona() did not initialize _activeClusters");

    assert(POISONER._activeClusters.length <= 3,
      "Cluster count <= 3: " + POISONER._activeClusters.length,
      "Cluster count > 3: " + POISONER._activeClusters.length);

    assert(typeof POISONER._personaScreen === "string" && POISONER._personaScreen.includes("x"),
      "Screen locked: " + POISONER._personaScreen,
      "Screen not set: " + POISONER._personaScreen);

    assert(typeof POISONER._personaClientId === "string" && POISONER._personaClientId.includes("."),
      "GA client ID locked: " + POISONER._personaClientId,
      "GA client ID not set");

    assert(typeof POISONER._personaGa4Cid === "string" && POISONER._personaGa4Cid.includes("-"),
      "GA4 client ID locked: " + POISONER._personaGa4Cid,
      "GA4 client ID not set");

    assert(typeof POISONER._personaTids === "object" &&
      POISONER._personaTids.ga.startsWith("UA-") &&
      POISONER._personaTids.ga4.startsWith("G-"),
      "Property IDs locked: " + POISONER._personaTids.ga + " / " + POISONER._personaTids.ga4,
      "Property IDs not set");

    assert(typeof POISONER._personaMetaId === "string" && POISONER._personaMetaId.length > 5,
      "Meta pixel ID locked: " + POISONER._personaMetaId,
      "Meta pixel ID not set");
  }

  // ================================================================
  // IDENTIFIER STABILITY ACROSS PAYLOADS
  // ================================================================

  function testIdentifierStability() {
    suite("Identifier stability across payloads");

    POISONER.selectPersona();

    // Collect multiple GA payloads and verify cid/tid are stable
    const gaPayloads = [];
    for (let i = 0; i < 10; i++) {
      gaPayloads.push(new URLSearchParams(POISONER.buildGAPayload()));
    }

    const gaCids = new Set(gaPayloads.map(p => p.get("cid")));
    assert(gaCids.size === 1,
      "GA cid stable across 10 payloads: " + [...gaCids][0],
      "GA cid varied across payloads: " + [...gaCids].join(", "));

    const gaTids = new Set(gaPayloads.map(p => p.get("tid")));
    assert(gaTids.size === 1,
      "GA tid stable across 10 payloads: " + [...gaTids][0],
      "GA tid varied across payloads");

    // Collect GA4 payloads and verify cid/tid stability
    const ga4Payloads = [];
    for (let i = 0; i < 10; i++) {
      ga4Payloads.push(new URLSearchParams(POISONER.buildGA4Payload()));
    }

    const ga4Cids = new Set(ga4Payloads.map(p => p.get("cid")));
    assert(ga4Cids.size === 1,
      "GA4 cid stable across 10 payloads: " + [...ga4Cids][0],
      "GA4 cid varied across payloads: " + [...ga4Cids].join(", "));

    const ga4Tids = new Set(ga4Payloads.map(p => p.get("tid")));
    assert(ga4Tids.size === 1,
      "GA4 tid stable across 10 payloads: " + [...ga4Tids][0],
      "GA4 tid varied across payloads");

    // Collect Meta payloads and verify pixel ID stability
    const metaPayloads = [];
    for (let i = 0; i < 10; i++) {
      metaPayloads.push(new URLSearchParams(POISONER.buildMetaPayload()));
    }

    const metaIds = new Set(metaPayloads.map(p => p.get("id")));
    assert(metaIds.size === 1,
      "Meta pixel ID stable across 10 payloads: " + [...metaIds][0],
      "Meta pixel ID varied across payloads: " + [...metaIds].join(", "));

    // Screen resolution stable
    const gaScreens = new Set(gaPayloads.map(p => p.get("sr")));
    assert(gaScreens.size === 1,
      "Screen resolution stable across GA payloads: " + [...gaScreens][0],
      "Screen resolution varied across payloads");
  }

  // ================================================================
  // HOST/PATH COHERENCE
  // ================================================================

  function testHostPathCoherence() {
    suite("Host/path coherence");

    POISONER.selectPersona();

    // Build a lookup of valid host -> paths from all clusters
    const validPaths = {};
    for (const cluster of POISONER.clusters) {
      for (const site of cluster.sites) {
        if (!validPaths[site.host]) validPaths[site.host] = new Set();
        for (const p of site.paths) {
          validPaths[site.host].add(p);
        }
      }
    }

    // Pick 50 site/page combos and verify each path belongs to its host
    let coherent = 0;
    let incoherent = 0;
    const badExamples = [];
    for (let i = 0; i < 50; i++) {
      const { host, page } = POISONER._pickSitePage();
      if (validPaths[host] && validPaths[host].has(page)) {
        coherent++;
      } else {
        incoherent++;
        if (badExamples.length < 3) {
          badExamples.push(`${host}${page}`);
        }
      }
    }

    assert(incoherent === 0,
      "All 50 host/path combos are site-coherent",
      incoherent + "/50 combos incoherent: " + badExamples.join(", "));

    // Verify URLs stay within active clusters
    const activeHosts = new Set();
    for (const cluster of POISONER._activeClusters) {
      for (const site of cluster.sites) {
        activeHosts.add(site.host);
      }
    }

    let outOfCluster = 0;
    for (let i = 0; i < 50; i++) {
      const { host } = POISONER._pickSitePage();
      if (!activeHosts.has(host)) outOfCluster++;
    }

    assert(outOfCluster === 0,
      "All 50 picks draw from active persona clusters only",
      outOfCluster + "/50 picks came from inactive clusters");
  }

  // ================================================================
  // PERSONA ROTATION CHANGES STATE
  // ================================================================

  function testPersonaRotation() {
    suite("Persona rotation changes state");

    POISONER.selectPersona();
    const before = {
      clientId: POISONER._personaClientId,
      ga4Cid: POISONER._personaGa4Cid,
      metaId: POISONER._personaMetaId,
      gaTid: POISONER._personaTids.ga,
      ga4Tid: POISONER._personaTids.ga4,
      screen: POISONER._personaScreen,
      clusters: POISONER._activeClusters.map(c => c.name).sort().join(","),
    };

    // Rotate multiple times and check that at least some identifiers change
    let anyChanged = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      POISONER.selectPersona();
      const after = {
        clientId: POISONER._personaClientId,
        ga4Cid: POISONER._personaGa4Cid,
        metaId: POISONER._personaMetaId,
        gaTid: POISONER._personaTids.ga,
        ga4Tid: POISONER._personaTids.ga4,
        screen: POISONER._personaScreen,
        clusters: POISONER._activeClusters.map(c => c.name).sort().join(","),
      };

      const diffs = [];
      for (const key of Object.keys(before)) {
        if (before[key] !== after[key]) diffs.push(key);
      }
      if (diffs.length > 0) {
        anyChanged = true;
        log("info", "Rotation changed: " + diffs.join(", "));
        break;
      }
    }

    assert(anyChanged,
      "selectPersona() produces different identifiers after rotation",
      "selectPersona() produced identical state across 5 rotations (extremely unlikely)");
  }

  // ================================================================
  // BATCH SIZES PER CHAOS LEVEL
  // ================================================================

  async function testBatchSizes() {
    suite("Batch sizes per chaos level");

    POISONER.selectPersona();

    // Stealth: always 1
    stubFetch();
    const stealthFired = await POISONER.fireBatch("stealth");
    assert(stealthFired === 1,
      "Stealth fires exactly 1 beacon",
      "Stealth fired " + stealthFired + " beacons (expected 1)");
    restoreFetch();

    // Balanced: 1-3
    stubFetch();
    const balancedFired = await POISONER.fireBatch("balanced");
    assert(balancedFired >= 1 && balancedFired <= 3,
      "Balanced fires 1-3 beacons: " + balancedFired,
      "Balanced fired " + balancedFired + " beacons (expected 1-3)");
    restoreFetch();

    // Chaos: 5-15
    stubFetch();
    const chaosFired = await POISONER.fireBatch("chaos");
    assert(chaosFired >= 5 && chaosFired <= 15,
      "Chaos fires 5-15 beacons: " + chaosFired,
      "Chaos fired " + chaosFired + " beacons (expected 5-15)");
    restoreFetch();
  }

  // ================================================================
  // TIMING MODEL
  // ================================================================

  function testTimingModel() {
    suite("Timing model intervals");

    // Stealth: 8-20 min
    for (let i = 0; i < 20; i++) {
      const interval = POISONER.getNextInterval("stealth");
      if (interval < 8 || interval > 20) {
        assert(false, "", "Stealth interval out of range: " + interval.toFixed(2));
        return;
      }
    }
    assert(true, "Stealth intervals all within 8-20 min (20 samples)", "");

    // Balanced: 3-8 min
    for (let i = 0; i < 20; i++) {
      const interval = POISONER.getNextInterval("balanced");
      if (interval < 3 || interval > 8) {
        assert(false, "", "Balanced interval out of range: " + interval.toFixed(2));
        return;
      }
    }
    assert(true, "Balanced intervals all within 3-8 min (20 samples)", "");

    // Chaos: 1-3 min
    for (let i = 0; i < 20; i++) {
      const interval = POISONER.getNextInterval("chaos");
      if (interval < 1 || interval > 3) {
        assert(false, "", "Chaos interval out of range: " + interval.toFixed(2));
        return;
      }
    }
    assert(true, "Chaos intervals all within 1-3 min (20 samples)", "");
  }

  // ================================================================
  // BEACON CONFIG GENERATION (v2 item 4)
  // ================================================================

  function testBeaconConfigGeneration() {
    suite("Beacon config generation (v2 item 4)");

    POISONER.selectPersona();

    // buildBeaconConfig() returns { url, body }
    const cfg = POISONER.buildBeaconConfig();
    assert(typeof cfg === "object" && cfg !== null,
      "buildBeaconConfig() returns an object",
      "buildBeaconConfig() returned: " + typeof cfg);

    assert(typeof cfg.url === "string" && cfg.url.startsWith("https://"),
      "Config url is an HTTPS string: " + (cfg.url || "").substring(0, 60) + "...",
      "Config url invalid: " + cfg.url);

    // URL should contain tracker endpoint
    const isGA = cfg.url.includes("google-analytics.com");
    const isMeta = cfg.url.includes("facebook.com/tr");
    assert(isGA || isMeta,
      "Config url targets a known tracker endpoint",
      "Config url targets unknown endpoint: " + cfg.url.substring(0, 60));

    // URL should contain query parameters (payload)
    assert(cfg.url.includes("?"),
      "Config url contains query parameters",
      "Config url has no query parameters");

    // body should be null (payload is in query string)
    assert(cfg.body === null,
      "Config body is null (payload in query string)",
      "Config body is not null: " + cfg.body);

    // Stability: cid/tid in generated configs should match persona
    const params = new URLSearchParams(cfg.url.split("?")[1]);
    if (isGA && cfg.url.includes("/g/collect")) {
      // GA4
      assert(params.get("cid") === POISONER._personaGa4Cid,
        "GA4 config cid matches persona: " + params.get("cid"),
        "GA4 config cid mismatch: " + params.get("cid") + " vs " + POISONER._personaGa4Cid);
    } else if (isGA) {
      // GA Universal
      assert(params.get("cid") === POISONER._personaClientId,
        "GA config cid matches persona: " + params.get("cid"),
        "GA config cid mismatch: " + params.get("cid") + " vs " + POISONER._personaClientId);
    } else if (isMeta) {
      assert(params.get("id") === POISONER._personaMetaId,
        "Meta config id matches persona: " + params.get("id"),
        "Meta config id mismatch: " + params.get("id") + " vs " + POISONER._personaMetaId);
    }
  }

  // ================================================================
  // BATCH CONFIG SIZES (v2 item 4)
  // ================================================================

  function testBatchConfigSizes() {
    suite("Batch config sizes per chaos level (v2 item 4)");

    POISONER.selectPersona();

    // Stealth: always 1
    const stealthConfigs = POISONER.buildBatchConfigs("stealth");
    assert(Array.isArray(stealthConfigs) && stealthConfigs.length === 1,
      "Stealth buildBatchConfigs returns 1 config",
      "Stealth returned " + (stealthConfigs || []).length + " configs (expected 1)");

    // Balanced: 1-3 (sample multiple times)
    let balancedOk = true;
    for (let i = 0; i < 10; i++) {
      const configs = POISONER.buildBatchConfigs("balanced");
      if (!Array.isArray(configs) || configs.length < 1 || configs.length > 3) {
        balancedOk = false;
        assert(false, "",
          "Balanced returned " + (configs || []).length + " configs (expected 1-3)");
        break;
      }
    }
    if (balancedOk) {
      assert(true, "Balanced buildBatchConfigs returns 1-3 configs (10 samples)", "");
    }

    // Chaos: 5-15
    let chaosOk = true;
    for (let i = 0; i < 5; i++) {
      const configs = POISONER.buildBatchConfigs("chaos");
      if (!Array.isArray(configs) || configs.length < 5 || configs.length > 15) {
        chaosOk = false;
        assert(false, "",
          "Chaos returned " + (configs || []).length + " configs (expected 5-15)");
        break;
      }
    }
    if (chaosOk) {
      assert(true, "Chaos buildBatchConfigs returns 5-15 configs (5 samples)", "");
    }

    // Every config in a batch should have url and body fields
    const batch = POISONER.buildBatchConfigs("balanced");
    let allValid = true;
    for (const c of batch) {
      if (typeof c.url !== "string" || !c.url.startsWith("https://")) {
        allValid = false;
        break;
      }
    }
    assert(allValid,
      "All configs in batch have valid HTTPS urls",
      "Some configs in batch have invalid urls");
  }

  // ================================================================
  // fireFakeBeacon USES buildBeaconConfig INTERNALLY (v2 item 4)
  // ================================================================

  async function testFireUsesConfig() {
    suite("fireFakeBeacon uses buildBeaconConfig internally (v2 item 4)");

    POISONER.selectPersona();

    // Stub fetch and fire — should hit a known tracker endpoint
    stubFetch();
    const result = await POISONER.fireFakeBeacon();
    assert(result === true,
      "fireFakeBeacon returns true with stub",
      "fireFakeBeacon returned " + result);

    assert(fetchCalls.length === 1,
      "fireFakeBeacon made exactly 1 fetch call",
      "fireFakeBeacon made " + fetchCalls.length + " fetch calls");

    if (fetchCalls.length > 0) {
      const call = fetchCalls[0];
      const isTracker = call.url.includes("google-analytics.com") ||
                        call.url.includes("facebook.com/tr");
      assert(isTracker,
        "Fetched URL is a known tracker: " + call.url.substring(0, 60) + "...",
        "Fetched URL is not a tracker: " + call.url.substring(0, 60));

      assert(call.opts && call.opts.credentials === "omit",
        "SW-context fetch uses credentials: omit",
        "SW-context fetch credentials: " + (call.opts && call.opts.credentials));
    }
    restoreFetch();
  }

  // ================================================================
  // DNR / CHAFF TRANSPORT COMPATIBILITY (v2 item 4)
  // Validates that chaff beacon URLs target endpoints that are in the
  // DNR blocklist, confirming that fetch (xmlhttprequest) would be
  // blocked while sendBeacon (ping) bypasses the block.
  // ================================================================

  function testDNRChaffCompatibility() {
    suite("DNR / chaff transport compatibility (v2 item 4)");

    // The chaff endpoints that are also in rules/tracking.json:
    // Rule 103: ||google-analytics.com (block script/image/xmlhttprequest)
    // Rule 104: ||facebook.net (block script/image/xmlhttprequest/sub_frame)
    // Rule 105: ||connect.facebook.com (block script/image/xmlhttprequest/sub_frame)
    // facebook.com/tr/ is NOT blocked (facebook.com is not in the rules).
    //
    // sendBeacon uses Chrome's "ping" resource type, which is NOT listed
    // in any of these rules' resourceTypes arrays. Therefore sendBeacon
    // bypasses the DNR block. fetch (no-cors POST) uses "xmlhttprequest"
    // which IS blocked.
    //
    // Rule 1 strips Referer for third-party xmlhttprequest/image/script/sub_frame.
    // "ping" is not in this list either, so sendBeacon preserves Referer.

    // Verify all chaff endpoints are known
    const gaEndpoints = POISONER.gaEndpoints;
    const metaEndpoints = POISONER.metaEndpoints;

    assert(gaEndpoints.length > 0,
      "GA endpoints defined: " + gaEndpoints.length,
      "No GA endpoints defined");
    assert(metaEndpoints.length > 0,
      "Meta endpoints defined: " + metaEndpoints.length,
      "No Meta endpoints defined");

    // GA endpoints hit google-analytics.com — blocked for xmlhttprequest
    for (const ep of gaEndpoints) {
      assert(ep.includes("google-analytics.com"),
        "GA endpoint targets google-analytics.com (DNR rule 103 blocks xmlhttprequest, not ping): " +
          ep.substring(0, 50),
        "GA endpoint does NOT target google-analytics.com: " + ep);
    }

    // Meta endpoints hit facebook.com/tr/ — NOT in DNR blocklist
    // (facebook.net and connect.facebook.com are blocked, not facebook.com)
    for (const ep of metaEndpoints) {
      assert(ep.includes("facebook.com/tr"),
        "Meta endpoint targets facebook.com/tr (not in DNR blocklist): " +
          ep.substring(0, 50),
        "Meta endpoint does NOT target facebook.com/tr: " + ep);
      // Verify it does NOT hit the blocked domains
      assert(!ep.includes("facebook.net") && !ep.includes("connect.facebook.com"),
        "Meta endpoint avoids blocked facebook.net/connect.facebook.com",
        "Meta endpoint hits a blocked domain: " + ep);
    }

    // Verify beacon configs only generate URLs for the defined endpoints
    POISONER.selectPersona();
    let allEndpointsValid = true;
    for (let i = 0; i < 30; i++) {
      const cfg = POISONER.buildBeaconConfig();
      const isGA = cfg.url.includes("google-analytics.com");
      const isMeta = cfg.url.includes("facebook.com/tr");
      if (!isGA && !isMeta) {
        allEndpointsValid = false;
        assert(false, "",
          "Config URL targets unknown endpoint: " + cfg.url.substring(0, 60));
        break;
      }
    }
    if (allEndpointsValid) {
      assert(true,
        "All 30 beacon configs target known chaff endpoints (GA or Meta)",
        "");
    }

    // DNR resource type analysis (informational)
    log("info", "INFO: DNR rules block google-analytics.com for: script, image, xmlhttprequest");
    log("info", "INFO: sendBeacon uses 'ping' resource type — NOT in any DNR block rule");
    log("info", "INFO: fetch (no-cors POST) uses 'xmlhttprequest' — BLOCKED by DNR rule 103");
    log("info", "INFO: Rule 1 strips Referer for: xmlhttprequest, image, script, sub_frame (NOT ping)");
    log("info", "INFO: Conclusion: sendBeacon-only transport in bridge.js bypasses DNR self-interference");
  }

  // ================================================================
  // sendBeacon AVAILABILITY + RETURN VALUE (v2 item 4)
  // ================================================================

  function testChaffSendBeaconAvailability() {
    suite("sendBeacon availability and return value (v2 item 4)");

    // sendBeacon must exist in the browser
    assert(typeof navigator.sendBeacon === "function",
      "navigator.sendBeacon is available",
      "navigator.sendBeacon NOT available — chaff page-context path would fail");

    // sendBeacon with a valid HTTPS URL and no body should return true
    // (unless the page is unloading or queue is full).
    // We test with a data: URI to avoid actual network requests.
    // Note: data: URIs may fail sendBeacon in some browsers — this is
    // informational, not a hard assertion.
    try {
      const result = navigator.sendBeacon("https://localhost:1/__pg_test__");
      log("info", "INFO: sendBeacon('https://localhost:1/__pg_test__') returned " + result +
        " (connection will fail, but beacon was queued)");
    } catch(e) {
      log("info", "INFO: sendBeacon test threw: " + e.message);
    }

    // Verify sendBeacon.toString() is native (not monkey-patched in this context)
    const sbStr = navigator.sendBeacon.toString();
    const isNative = sbStr.includes("[native code]") || sbStr.includes("native code");
    assert(isNative,
      "sendBeacon appears native (not monkey-patched): " + sbStr.substring(0, 40),
      "sendBeacon may be monkey-patched: " + sbStr.substring(0, 60));
  }

  // ================================================================
  // DOM CHAFF CONFIG GENERATION (v2 item 4)
  // ================================================================

  function testDOMChaffPayloadGeneration() {
    suite("DOM chaff payload generation (v2 item 4 corrective)");

    // AD_CONTAINER_SELECTORS defined and non-empty
    assert(Array.isArray(POISONER.AD_CONTAINER_SELECTORS) && POISONER.AD_CONTAINER_SELECTORS.length > 0,
      "AD_CONTAINER_SELECTORS is a non-empty array: " + POISONER.AD_CONTAINER_SELECTORS.length + " selectors",
      "AD_CONTAINER_SELECTORS missing or empty");

    // All selectors are strings
    let allStrings = true;
    for (const s of POISONER.AD_CONTAINER_SELECTORS) {
      if (typeof s !== "string") { allStrings = false; break; }
    }
    assert(allStrings,
      "All AD_CONTAINER_SELECTORS are strings",
      "Some selectors are not strings");

    // PIXEL_GIF is a valid data URI
    assert(typeof POISONER.PIXEL_GIF === "string" && POISONER.PIXEL_GIF.startsWith("data:image/gif;base64,"),
      "PIXEL_GIF is a valid data:image/gif URI",
      "PIXEL_GIF invalid: " + (POISONER.PIXEL_GIF || "").substring(0, 40));

    POISONER.selectPersona();

    // Payload shape validation
    const payload = POISONER.buildDOMChaffPayload("balanced");
    assert(typeof payload === "object" && payload !== null,
      "buildDOMChaffPayload returns an object",
      "buildDOMChaffPayload returned: " + typeof payload);

    // Sends ALL selectors (bridge.js does DOM querying)
    assert(Array.isArray(payload.selectors) && payload.selectors.length === POISONER.AD_CONTAINER_SELECTORS.length,
      "Payload includes all " + POISONER.AD_CONTAINER_SELECTORS.length + " selectors",
      "Payload selectors count: " + (payload.selectors || []).length);

    // maxTargets by chaos level
    const stealth = POISONER.buildDOMChaffPayload("stealth");
    assert(stealth.maxTargets === 1,
      "Stealth maxTargets is 1",
      "Stealth maxTargets: " + stealth.maxTargets);

    const balanced = POISONER.buildDOMChaffPayload("balanced");
    assert(balanced.maxTargets === 2,
      "Balanced maxTargets is 2",
      "Balanced maxTargets: " + balanced.maxTargets);

    const chaos = POISONER.buildDOMChaffPayload("chaos");
    assert(chaos.maxTargets === 5,
      "Chaos maxTargets is 5",
      "Chaos maxTargets: " + chaos.maxTargets);

    // attributeSets has maxTargets entries
    assert(Array.isArray(payload.attributeSets) && payload.attributeSets.length === payload.maxTargets,
      "attributeSets has " + payload.maxTargets + " entries (one per target)",
      "attributeSets count: " + (payload.attributeSets || []).length);

    // Each attribute set has 2-3 entries with data-* keys
    let attrValid = true;
    for (const attrSet of payload.attributeSets) {
      if (!Array.isArray(attrSet) || attrSet.length < 2 || attrSet.length > 3) {
        attrValid = false;
        break;
      }
      for (const attr of attrSet) {
        if (typeof attr.key !== "string" || typeof attr.value !== "string" || !attr.key.startsWith("data-")) {
          attrValid = false;
          break;
        }
      }
    }
    assert(attrValid,
      "All attribute sets have 2-3 entries with data-* keys",
      "Some attribute sets have invalid shape");

    // pixelChance and pixelSrc present
    assert(typeof payload.pixelChance === "number" && payload.pixelChance > 0 && payload.pixelChance < 1,
      "pixelChance is a probability: " + payload.pixelChance,
      "pixelChance invalid: " + payload.pixelChance);

    assert(typeof payload.pixelSrc === "string" && payload.pixelSrc.startsWith("data:"),
      "pixelSrc is a data URI",
      "pixelSrc invalid: " + (payload.pixelSrc || "").substring(0, 30));
  }

  // ================================================================
  // RUN ALL
  // ================================================================

  async function _runAll() {
    resultsEl.innerHTML = "";
    passed = 0;
    failed = 0;

    testPersonaInit();
    testIdentifierStability();
    testHostPathCoherence();
    testPersonaRotation();
    await testBatchSizes();
    testTimingModel();
    testBeaconConfigGeneration();
    testBatchConfigSizes();
    await testFireUsesConfig();
    testDNRChaffCompatibility();
    testChaffSendBeaconAvailability();
    testDOMChaffPayloadGeneration();

    updateSummary();
  }

  window.runPoisonerTests = _runAll;
})();
