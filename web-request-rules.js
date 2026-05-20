/**
 * Duppel — Firefox webRequest rules.
 * Replaces Chrome's declarativeNetRequest (rules/tracking.json + dynamic UA rule).
 * Loaded via manifest.firefox.json background.scripts before background.firefox.js.
 */

// === UA header spoofing (replaces DNR rule 9999) ===
var _currentUA = null;

function setUA(ua) {
  _currentUA = ua;
}

// === Tracker domain blocklist (replaces DNR rules 100–141) ===
const TRACKER_DOMAINS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googletagmanager.com",
  "google-analytics.com",
  "facebook.net",
  "connect.facebook.com",
  "analytics.tiktok.com",
  "ads.linkedin.com",
  "snap.licdn.com",
  "bat.bing.com",
  "scorecardresearch.com",
  "quantserve.com",
  "adnxs.com",
  "criteo.com",
  "criteo.net",
  "taboola.com",
  "outbrain.com",
  "hotjar.com",
  "mouseflow.com",
  "fullstory.com",
  "demdex.net",
  "omtrdc.net",
  "pubmatic.com",
  "rubiconproject.com",
  "openx.net",
  "casalemedia.com",
  "sharethis.com",
  "addthis.com",
  "adsrvr.org",
  "amazon-adsystem.com",
  "moatads.com",
  "krxd.net",
  "bluekai.com",
  "exelator.com",
  "bounceexchange.com",
  "mathtag.com",
  "nr-data.net",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "clarity.ms",
];

// Blockable resource types — matches DNR rules (script, image, xmlhttprequest, sub_frame where applicable)
const BLOCK_TYPES_WITH_SUBFRAME = new Set([
  "doubleclick.net", "googlesyndication.com", "googletagmanager.com",
  "facebook.net", "connect.facebook.com", "adnxs.com",
  "taboola.com", "outbrain.com",
]);

// === Tracking query params to strip (replaces DNR rule 4) ===
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign",
  "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "dclid",
  "msclkid", "yclid", "twclid",
  "mc_eid", "_ga", "_gl",
  "wbraid", "gbraid",
]);

// === Headers to remove (replaces DNR rule 2) ===
const REMOVE_HEADERS = new Set([
  "x-client-data",
  "x-chrome-uma-enabled",
  "x-chrome-variations",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-ch-ua-platform-version",
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-arch",
  "sec-ch-ua-bitness",
  "sec-ch-ua-model",
  "sec-ch-ua-wow64",
]);

// === Helpers ===

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
}

function isThirdParty(details) {
  if (!details.documentUrl) return false;
  const reqHost = getHostname(details.url);
  const docHost = getHostname(details.documentUrl);
  if (!reqHost || !docHost) return false;
  // Compare eTLD+1 (simplified: compare last two domain parts)
  const reqParts = reqHost.split(".");
  const docParts = docHost.split(".");
  const reqDomain = reqParts.slice(-2).join(".");
  const docDomain = docParts.slice(-2).join(".");
  return reqDomain !== docDomain;
}

function matchesTrackerDomain(url) {
  const hostname = getHostname(url);
  if (!hostname) return null;
  for (const domain of TRACKER_DOMAINS) {
    if (hostname === domain || hostname.endsWith("." + domain)) {
      return domain;
    }
  }
  return null;
}

function stripTrackingParams(url) {
  try {
    const u = new URL(url);
    let changed = false;
    for (const param of TRACKING_PARAMS) {
      if (u.searchParams.has(param)) {
        u.searchParams.delete(param);
        changed = true;
      }
    }
    return changed ? u.toString() : null;
  } catch (e) {
    return null;
  }
}

// === Listener 1: Request header modification ===
// Handles: UA spoofing (rule 9999), Referer removal (rule 1),
//          Client Hints removal (rule 2), Sec-GPC insertion (rule 3)
browser.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    let headers = details.requestHeaders || [];
    const lowerMap = {};
    headers.forEach(h => { lowerMap[h.name.toLowerCase()] = h; });

    // Rule 9999: Set User-Agent
    if (_currentUA) {
      const uaH = lowerMap["user-agent"];
      if (uaH) {
        uaH.value = _currentUA;
      } else {
        headers.push({ name: "User-Agent", value: _currentUA });
      }
    }

    // Rule 1: Remove Referer on third-party sub-resources
    const isSubResource = details.type !== "main_frame";
    if (isSubResource && isThirdParty(details) && lowerMap["referer"]) {
      headers = headers.filter(h => h.name.toLowerCase() !== "referer");
    }

    // Rule 2: Remove Client Hints and Chrome telemetry headers
    headers = headers.filter(h => !REMOVE_HEADERS.has(h.name.toLowerCase()));

    // Rule 3: Add Sec-GPC: 1
    // Remove any existing Sec-GPC first, then add
    headers = headers.filter(h => h.name.toLowerCase() !== "sec-gpc");
    headers.push({ name: "Sec-GPC", value: "1" });

    return { requestHeaders: headers };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestHeaders"]
);

// === Listener 2: Response header modification ===
// Handles: Referrer-Policy override (rule 5)
browser.webRequest.onHeadersReceived.addListener(
  function(details) {
    const headers = details.responseHeaders || [];
    // Remove existing Referrer-Policy, then set our own
    const filtered = headers.filter(h => h.name.toLowerCase() !== "referrer-policy");
    filtered.push({ name: "Referrer-Policy", value: "origin-when-cross-origin" });
    return { responseHeaders: filtered };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "responseHeaders"]
);

// === Listener 3: Request blocking and query stripping ===
// Handles: Tracker blocking (rules 100–141), query param stripping (rule 4)
browser.webRequest.onBeforeRequest.addListener(
  function(details) {
    // Tracker blocking — only block matching resource types
    const trackerDomain = matchesTrackerDomain(details.url);
    if (trackerDomain) {
      const blockableTypes = ["script", "image", "xmlhttprequest"];
      if (BLOCK_TYPES_WITH_SUBFRAME.has(trackerDomain)) {
        blockableTypes.push("sub_frame");
      }
      if (blockableTypes.includes(details.type)) {
        return { cancel: true };
      }
    }

    // Query param stripping — only on navigation frames (rule 4)
    if (details.type === "main_frame" || details.type === "sub_frame") {
      const stripped = stripTrackingParams(details.url);
      if (stripped) {
        return { redirectUrl: stripped };
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);
