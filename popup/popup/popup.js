/**
 * PhantomGrid — Popup UI Controller
 */

const chaosDescriptions = {
  stealth: "Subtle noise, real-looking profiles, minimal poisoning.",
  balanced: "Moderate spoofing, periodic data poisoning.",
  chaos: "Fully random profiles, aggressive data poisoning.",
};

// DOM references
const enableToggle = document.getElementById("enableToggle");
const rotateBtn = document.getElementById("rotateBtn");
const cleanCookiesBtn = document.getElementById("cleanCookiesBtn");
const fireBeaconsBtn = document.getElementById("fireBeaconsBtn");
const chaosDesc = document.getElementById("chaosDesc");
const siteEnabled = document.getElementById("siteEnabled");
const currentSite = document.getElementById("currentSite");
const chaosBtns = document.querySelectorAll(".chaos-btn");

// Update UI with current state
function updateUI(state) {
  enableToggle.checked = state.enabled;

  if (state.profile) {
    const p = state.profile;
    document.getElementById("currentUA").textContent = p.userAgent.substring(0, 80) + (p.userAgent.length > 80 ? "..." : "");
    document.getElementById("currentPlatform").textContent = p.platform;
    document.getElementById("currentScreen").textContent = `${p.screen.width}x${p.screen.height}`;
    document.getElementById("currentGPU").textContent = p.gpu.renderer.substring(0, 60);
    document.getElementById("currentTZ").textContent = p.timezone;
    document.getElementById("currentCores").textContent = p.hardwareConcurrency;
    document.getElementById("currentRAM").textContent = `${p.deviceMemory} GB`;
  }

  if (state.stats) {
    document.getElementById("statTrackers").textContent = formatNumber(state.stats.trackersBlocked);
    document.getElementById("statCookies").textContent = formatNumber(state.stats.cookiesCleaned);
    document.getElementById("statBeacons").textContent = formatNumber(state.stats.fakeBeaconsFired);
    document.getElementById("statRotations").textContent = formatNumber(state.stats.identityRotations);
  }

  // Update chaos level buttons
  chaosBtns.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.level === state.chaosLevel);
  });
  chaosDesc.textContent = chaosDescriptions[state.chaosLevel] || chaosDescriptions.balanced;
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

// Get current tab hostname
async function getCurrentHostname() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      return new URL(tab.url).hostname;
    }
  } catch(e) {}
  return "unknown";
}

// Initialize
async function init() {
  const hostname = await getCurrentHostname();
  currentSite.textContent = hostname;

  // Get state from background
  chrome.runtime.sendMessage({ type: "getState" }, (state) => {
    if (state) updateUI(state);
  });

  // Check site override
  chrome.storage.session.get(["siteOverrides"], (data) => {
    const overrides = data.siteOverrides || {};
    siteEnabled.checked = overrides[hostname] !== false;
  });
}

// Event listeners
enableToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    type: "toggleEnabled",
    enabled: enableToggle.checked,
  });
});

rotateBtn.addEventListener("click", () => {
  rotateBtn.textContent = "Rotating...";
  rotateBtn.disabled = true;
  chrome.runtime.sendMessage({ type: "rotateNow" }, (resp) => {
    rotateBtn.textContent = "Rotate Identity";
    rotateBtn.disabled = false;
    if (resp && resp.profile) {
      chrome.runtime.sendMessage({ type: "getState" }, (state) => {
        if (state) updateUI(state);
      });
    }
  });
});

chaosBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const level = btn.dataset.level;
    chrome.runtime.sendMessage({ type: "setChaosLevel", level: level });
    chaosBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    chaosDesc.textContent = chaosDescriptions[level];
  });
});

cleanCookiesBtn.addEventListener("click", () => {
  cleanCookiesBtn.textContent = "Cleaning...";
  chrome.runtime.sendMessage({ type: "cleanCookiesNow" }, (resp) => {
    cleanCookiesBtn.textContent = `Cleaned ${resp?.cleaned || 0}`;
    setTimeout(() => { cleanCookiesBtn.textContent = "Clean Cookies Now"; }, 2000);
    // Refresh stats
    chrome.runtime.sendMessage({ type: "getState" }, (state) => {
      if (state) updateUI(state);
    });
  });
});

fireBeaconsBtn.addEventListener("click", () => {
  fireBeaconsBtn.textContent = "Firing...";
  chrome.runtime.sendMessage({ type: "fireBeaconsNow" }, (resp) => {
    fireBeaconsBtn.textContent = `Fired ${resp?.fired || 0}`;
    setTimeout(() => { fireBeaconsBtn.textContent = "Fire Beacons Now"; }, 2000);
    chrome.runtime.sendMessage({ type: "getState" }, (state) => {
      if (state) updateUI(state);
    });
  });
});

siteEnabled.addEventListener("change", async () => {
  const hostname = await getCurrentHostname();
  chrome.runtime.sendMessage({
    type: "setSiteOverride",
    hostname: hostname,
    enabled: siteEnabled.checked,
  });
});

init();
