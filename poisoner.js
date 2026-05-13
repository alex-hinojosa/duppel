/**
 * PhantomGrid — Behavioral Poisoning Module (v2)
 *
 * Fires fake tracking beacons to pollute ad-tech profiles.
 * Imported by background.js.
 *
 * v1.1 redesign (paper + rowan + lux review, 2026-05-08):
 * - Session personas: coherent interest clusters per identity session.
 *   Chaff within a session draws from 2-3 related clusters, making
 *   poisoned data look like a real person with plausible interests.
 * - Credible timing: variable intervals that mimic human browsing
 *   rhythm instead of fixed alarm cadence.
 * - Volume by mode: stealth = 1 beacon every 8-20 min (auto-fire ON),
 *   balanced = 1-3 beacons every 3-8 min (auto-fire ON),
 *   chaos = 5-15 beacons every 1-3 min (auto-fire ON, lab-only gate).
 * - 1% bypass zone principle (IDPI paper): fewer, more plausible
 *   data points are harder for downstream AI to filter than high-volume
 *   contradictory noise.
 *
 * v2 item 4 (interaction-coupled chaff):
 * - buildBeaconConfig(): returns {url, body} without firing.
 * - buildBatchConfigs(chaosLevel): returns array of configs for a batch.
 * - background.js sends configs to bridge.js (ISOLATED world) via
 *   chrome.tabs.sendMessage; bridge fires sendBeacon on user interaction.
 * - ISOLATED world beacons carry real Referer + real cookie jar.
 * - No SW fallback — chaff skips and reschedules if no active http tab.
 * - fireBatch()/fireFakeBeacon() retained for test harness only.
 */

const POISONER = {
  // === Interest clusters ===
  // Each cluster groups sites, pages, and categories that a real person
  // would plausibly browse together. The session persona picks 2-3 clusters
  // and all chaff draws from them for coherence.
  clusters: [
    {
      name: "tech",
      sites: [
        { host: "www.bestbuy.com", paths: ["/site/computers/abcat0502000", "/site/laptops/pcmcat138500050001", "/site/gaming-laptops/pcmcat287600050003"] },
        { host: "www.amazon.com", paths: ["/dp/B0CDJ4HKBZ", "/s?k=gaming+laptop", "/gp/bestsellers/electronics"] },
        { host: "www.newegg.com", paths: ["/p/pl?N=100167732", "/GPUs-Video-Graphics-Cards/SubCategory/ID-48", "/p/pl?d=mechanical+keyboard"] },
        { host: "www.microcenter.com", paths: ["/category/4294967292/Laptops", "/category/4294966737/Desktop-Computers", "/category/4294966739/Computer-Parts"] },
      ],
      categories: ["technology", "gaming", "electronics"],
      referrers: [
        "https://www.google.com/search?q=best+laptop+2025",
        "https://www.reddit.com/r/buildapc/",
        "https://news.ycombinator.com/",
        "https://www.youtube.com/results?search_query=tech+reviews",
      ],
    },
    {
      name: "home",
      sites: [
        { host: "www.homedepot.com", paths: ["/b/Appliances/N-5yc1vZbv09", "/b/Bath/N-5yc1vZbzb3", "/b/Tools/N-5yc1vZc1xy"] },
        { host: "www.lowes.com", paths: ["/pl/Tools/4294857975", "/pl/Appliances/4294966702", "/pl/Flooring/4294822463"] },
        { host: "www.wayfair.com", paths: ["/furniture/sb0/sofas-c413892.html", "/kitchen-tabletop/sb0/kitchen-islands-c413783.html", "/bed-bath/sb0/bedding-c215330.html"] },
        { host: "www.ikea.com", paths: ["/us/en/cat/sofas-fu003/", "/us/en/cat/desks-fu004/", "/us/en/cat/beds-bm003/"] },
      ],
      categories: ["home_improvement", "gardening", "real_estate"],
      referrers: [
        "https://www.google.com/search?q=bathroom+renovation+ideas",
        "https://www.pinterest.com/ideas/home-decor/",
        "https://www.reddit.com/r/HomeImprovement/",
        "https://www.youtube.com/results?search_query=diy+home",
      ],
    },
    {
      name: "fashion",
      sites: [
        { host: "www.nordstrom.com", paths: ["/browse/sale/women", "/browse/shoes/women", "/browse/handbags"] },
        { host: "www.macys.com", paths: ["/shop/womens-clothing", "/shop/shoes", "/shop/jewelry-watches"] },
        { host: "www.sephora.com", paths: ["/shop/skincare", "/shop/makeup", "/shop/fragrance"] },
        { host: "www.zara.com", paths: ["/us/en/woman-new-in-l1180.html", "/us/en/woman-dresses-l1066.html", "/us/en/woman-shoes-l1251.html"] },
      ],
      categories: ["fashion", "luxury_goods", "beauty"],
      referrers: [
        "https://www.google.com/search?q=spring+fashion+trends",
        "https://www.pinterest.com/ideas/fashion/",
        "https://www.instagram.com/explore/tags/ootd/",
        "https://www.youtube.com/results?search_query=styling+tips",
      ],
    },
    {
      name: "fitness",
      sites: [
        { host: "www.rei.com", paths: ["/c/camping-gear", "/c/hiking-gear", "/c/running-shoes"] },
        { host: "www.nike.com", paths: ["/w/new-releases-3n82y", "/w/running-shoes-37v7jznik1", "/w/mens-training-shoes-58jtoznik1"] },
        { host: "www.adidas.com", paths: ["/us/running-shoes", "/us/training-shoes", "/us/outdoor-shoes"] },
        { host: "www.backcountry.com", paths: ["/outdoor-gear", "/trail-running-shoes", "/hiking-boots"] },
      ],
      categories: ["fitness", "sports", "travel", "healthcare"],
      referrers: [
        "https://www.google.com/search?q=marathon+training+plan",
        "https://www.reddit.com/r/running/",
        "https://www.strava.com/dashboard",
        "https://www.youtube.com/results?search_query=workout",
      ],
    },
    {
      name: "family",
      sites: [
        { host: "www.target.com", paths: ["/c/baby/-/N-5xtly", "/c/toys/-/N-5xt5z", "/c/grocery/-/N-5xsz7"] },
        { host: "www.costco.com", paths: ["/grocery.html", "/baby-kids.html", "/home-garden.html"] },
        { host: "www.chewy.com", paths: ["/b/dog-food-332", "/b/cat-food-387", "/b/pet-supplies-502"] },
        { host: "www.petco.com", paths: ["/shop/en/petcostore/category/dog/dog-food", "/shop/en/petcostore/category/cat/cat-food", "/shop/en/petcostore/category/dog/dog-treats"] },
      ],
      categories: ["parenting", "pets", "cooking", "education"],
      referrers: [
        "https://www.google.com/search?q=best+dog+food+brands",
        "https://www.reddit.com/r/Parenting/",
        "https://www.pinterest.com/ideas/recipes/",
        "https://www.youtube.com/results?search_query=meal+prep",
      ],
    },
    {
      name: "finance",
      sites: [
        { host: "www.zillow.com", paths: ["/homes/for_sale/", "/homes/recently_sold/", "/mortgage-rates/"] },
        { host: "www.autotrader.com", paths: ["/cars-for-sale/all-cars", "/car-reviews/", "/car-comparisons/"] },
        { host: "www.nerdwallet.com", paths: ["/mortgages/", "/investing/", "/credit-cards/"] },
        { host: "www.bankrate.com", paths: ["/investing/", "/mortgages/", "/banking/savings-accounts/"] },
      ],
      categories: ["finance", "real_estate", "automotive"],
      referrers: [
        "https://www.google.com/search?q=mortgage+rates+2025",
        "https://www.reddit.com/r/personalfinance/",
        "https://www.bing.com/search?q=best+suv+2025",
        "https://www.youtube.com/results?search_query=investing",
      ],
    },
  ],

  // === Tracker endpoints ===
  gaEndpoints: [
    "https://www.google-analytics.com/collect",
    "https://www.google-analytics.com/g/collect",
  ],
  metaEndpoints: [
    "https://www.facebook.com/tr/",
  ],

  // Screen resolutions for payloads
  fakeScreens: [
    "1920x1080", "2560x1440", "1366x768", "1536x864",
    "1440x900", "1680x1050", "3840x2160", "1280x720",
  ],

  // Meta pixel SDK versions
  metaVersions: [
    "2.9.136", "2.9.142", "2.9.148", "2.9.155", "2.9.159",
  ],

  // === Session persona state ===
  // Set by selectPersona() on identity rotation. All chaff draws from
  // these clusters until the next rotation.
  _activeClusters: null,
  _personaScreen: null,
  _personaClientId: null,  // GA Universal cid (format: integer.integer)
  _personaGa4Cid: null,    // GA4 cid (format: UUID-like)
  _personaTids: null,
  _personaMetaId: null,

  // === Select a persona for this session ===
  // Picks 2-3 clusters. Called by background.js on rotation.
  selectPersona() {
    const count = 2 + Math.floor(Math.random() * 2); // 2 or 3
    const shuffled = [...this.clusters].sort(() => Math.random() - 0.5);
    this._activeClusters = shuffled.slice(0, count);

    // Lock a screen resolution for the session (real users don't change monitors)
    this._personaScreen = this.fakeScreens[Math.floor(Math.random() * this.fakeScreens.length)];

    // Lock a GA client ID for the session (real users have persistent cids)
    const a = Math.floor(Math.random() * 2147483647);
    const b = Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 86400 * 30);
    this._personaClientId = `${a}.${b}`;

    // Lock a GA4 client ID (UUID-like, stable per session)
    this._personaGa4Cid = `${this._randomHex(8)}-${this._randomHex(4)}-4${this._randomHex(3)}-${this._randomHex(4)}-${this._randomHex(12)}`;

    // Lock GA property IDs (real sites have consistent TIDs)
    this._personaTids = {
      ga: `UA-${Math.floor(Math.random() * 99999999)}-1`,
      ga4: `G-${this._randomHex(10).toUpperCase()}`,
    };

    // Lock a Meta pixel ID
    this._personaMetaId = String(Math.floor(Math.random() * 9999999999999));
  },

  // === Helpers ===
  _randomHex(len) {
    const chars = "0123456789abcdef";
    let result = "";
    for (let i = 0; i < len; i++) {
      result += chars[Math.floor(Math.random() * 16)];
    }
    return result;
  },

  _pickFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  },

  // Pick a host + path from the active persona clusters.
  // Each site entry carries its own plausible paths, so the combination
  // always produces a URL that could exist on that host.
  _pickSitePage() {
    const cluster = this._pickFrom(this._activeClusters);
    const site = this._pickFrom(cluster.sites);
    const page = this._pickFrom(site.paths);
    const referrer = this._pickFrom(cluster.referrers);
    return { host: site.host, page, referrer, cluster };
  },

  // === Payload builders ===

  buildGAPayload() {
    const { host, page, referrer } = this._pickSitePage();
    const [sw, sh] = this._personaScreen.split("x");

    return new URLSearchParams({
      v: "1",
      tid: this._personaTids.ga,
      cid: this._personaClientId,
      t: "pageview",
      dp: page,
      dh: host,
      dr: referrer,
      dt: page.split("/").pop().replace(/-/g, " "),
      ul: "en-us",
      sr: this._personaScreen,
      vp: `${sw}x${parseInt(sh) - Math.floor(Math.random() * 60 + 80)}`,
      je: "0",
      fl: "",
      z: String(Math.floor(Math.random() * 2147483647)),
    }).toString();
  },

  buildGA4Payload() {
    const { host, page } = this._pickSitePage();
    const sid = this._randomHex(32);

    return new URLSearchParams({
      v: "2",
      tid: this._personaTids.ga4,
      cid: this._personaGa4Cid,
      sid: sid,
      en: "page_view",
      dl: `https://${host}${page}`,
      dt: page.split("/").pop().replace(/-/g, " "),
      sr: this._personaScreen,
      ul: "en-us",
      _p: String(Math.floor(Math.random() * 2147483647)),
    }).toString();
  },

  buildMetaPayload() {
    const { host, page, referrer } = this._pickSitePage();
    const [sw, sh] = this._personaScreen.split("x");
    const ver = this._pickFrom(this.metaVersions);

    return new URLSearchParams({
      id: this._personaMetaId,
      ev: "PageView",
      dl: `https://${host}${page}`,
      rl: referrer,
      ts: String(Date.now()),
      sw: sw,
      sh: sh,
      v: ver,
      r: "stable",
      ec: "0",
      o: String(Math.floor(Math.random() * 60)),
      it: String(Date.now() - Math.floor(Math.random() * 5000)),
    }).toString();
  },

  // === Build a single beacon config (url + body, no firing) ===
  // Returns { url, body } for injection into page context.
  buildBeaconConfig() {
    if (!this._activeClusters) this.selectPersona();

    const roll = Math.random();
    let url, payload;

    if (roll < 0.4) {
      url = this.gaEndpoints[0];
      payload = this.buildGAPayload();
    } else if (roll < 0.7) {
      url = this.gaEndpoints[1];
      payload = this.buildGA4Payload();
    } else {
      url = this.metaEndpoints[0];
      payload = this.buildMetaPayload();
    }

    return { url: `${url}?${payload}`, body: null };
  },

  // === Build a batch of beacon configs ===
  // Returns array of { url, body } configs, count determined by chaosLevel.
  buildBatchConfigs(chaosLevel) {
    if (!this._activeClusters) this.selectPersona();

    let count;
    if (chaosLevel === "stealth") {
      count = 1;
    } else if (chaosLevel === "chaos") {
      count = 5 + Math.floor(Math.random() * 11); // 5-15
    } else {
      count = 1 + Math.floor(Math.random() * 3); // 1-3
    }

    const configs = [];
    for (let i = 0; i < count; i++) {
      configs.push(this.buildBeaconConfig());
    }
    return configs;
  },

  // === DOM Chaff — ad container attribute injection (v2 item 4) ===
  // Selectors for plausible ad/tracker container elements.
  // Bounded to real ad-infrastructure patterns (rowan gate: no generic DOM noise).
  AD_CONTAINER_SELECTORS: [
    '[id*="google_ads"]', '[id*="gpt-ad"]', '[class*="adsbygoogle"]',
    '[id*="ad-slot"]', '[id*="ad_slot"]', '[class*="ad-container"]',
    '[class*="ad-wrapper"]', '[data-ad-slot]', '[data-ad-client]',
    'ins.adsbygoogle', '[id*="dfp-ad"]', '[class*="sponsored"]',
  ],

  // 1x1 transparent GIF as data: URI. No network request, no DNR conflict.
  PIXEL_GIF: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",

  // Attribute families that real ad infrastructure sets.
  _adAttributes() {
    return [
      { key: "data-ad-slot",      value: String(Math.floor(Math.random() * 9999999999)) },
      { key: "data-ad-client",    value: "ca-pub-" + String(Math.floor(Math.random() * 9999999999999999)) },
      { key: "data-ad-format",    value: this._pickFrom(["auto", "fluid", "rectangle", "horizontal"]) },
      { key: "data-analytics-id", value: this._personaTids ? this._personaTids.ga4 : "G-" + this._randomHex(10).toUpperCase() },
      { key: "data-fb-pixel",     value: this._personaMetaId || String(Math.floor(Math.random() * 9999999999999)) },
    ];
  },

  // Build DOM chaff configs for injection into page ad containers.
  // Returns array of { selector, attributes: [{key, value}], injectPixel: bool }
  buildDOMChaffConfigs(chaosLevel) {
    if (!this._activeClusters) this.selectPersona();

    let maxTargets;
    if (chaosLevel === "stealth") maxTargets = 1;
    else if (chaosLevel === "chaos") maxTargets = 5;
    else maxTargets = 2; // balanced

    const configs = [];
    const shuffled = [...this.AD_CONTAINER_SELECTORS].sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(maxTargets, shuffled.length); i++) {
      const allAttrs = this._adAttributes();
      const attrCount = 2 + Math.floor(Math.random() * 2); // 2-3
      const shuffledAttrs = allAttrs.sort(() => Math.random() - 0.5).slice(0, attrCount);
      configs.push({
        selector: shuffled[i],
        attributes: shuffledAttrs,
        injectPixel: Math.random() < 0.3,
      });
    }
    return configs;
  },

  // === Fire a single beacon (SW-context fallback) ===
  async fireFakeBeacon() {
    try {
      const cfg = this.buildBeaconConfig();
      await fetch(cfg.url, {
        method: "POST",
        mode: "no-cors",
        credentials: "omit",
        keepalive: true,
        body: null,
      });
      return true;
    } catch(e) {
      return false;
    }
  },

  // === Fire a batch ===
  // Stealth: 1 beacon. Balanced: 1-3. Chaos: 5-15.
  async fireBatch(chaosLevel) {
    // Ensure persona is initialized
    if (!this._activeClusters) this.selectPersona();

    let actual;
    if (chaosLevel === "stealth") {
      actual = 1;
    } else if (chaosLevel === "chaos") {
      actual = 5 + Math.floor(Math.random() * 11); // 5-15
    } else {
      actual = 1 + Math.floor(Math.random() * 3); // 1-3
    }

    let fired = 0;
    for (let i = 0; i < actual; i++) {
      // Stagger: stealth uses longer delays (looks like real page dwell)
      const baseDelay = chaosLevel === "stealth" ? 4000 :
                        chaosLevel === "balanced" ? 1500 : 500;
      const jitter = Math.floor(Math.random() * baseDelay);
      await new Promise(r => setTimeout(r, baseDelay + jitter));
      if (await this.fireFakeBeacon()) fired++;
    }
    return fired;
  },

  // === Timing model ===
  // Returns the next fire interval in minutes for the alarm scheduler.
  // Stealth: 8-20 min. Balanced: 3-8 min. Chaos: 1-3 min.
  getNextInterval(chaosLevel) {
    const ranges = {
      stealth:  { min: 8,  max: 20 },
      balanced: { min: 3,  max: 8  },
      chaos:    { min: 1,  max: 3  },
    };
    const range = ranges[chaosLevel] || ranges.balanced;
    return range.min + Math.random() * (range.max - range.min);
  },
};
