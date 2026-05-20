/* eslint-disable no-undef */
const B = typeof browser !== "undefined" ? browser : chrome;

/**
 * Duppel — Popup UI Controller
 */

const chaosDescriptions = {
  stealth: "Low-volume coherent chaff, long intervals (8-20 min).",
  balanced: "Moderate chaff with persona clusters (3-8 min).",
  chaos: "High-volume broad chaff, short intervals (1-3 min). Lab only.",
};

// DOM references
const enableToggle = document.getElementById("enableToggle");
const rotateBtn = document.getElementById("rotateBtn");
const rotateAllTabs = document.getElementById("rotateAllTabs");
const cleanCookiesBtn = document.getElementById("cleanCookiesBtn");
const fireBeaconsBtn = document.getElementById("fireBeaconsBtn");
const chaosDesc = document.getElementById("chaosDesc");
const siteEnabled = document.getElementById("siteEnabled");
const currentSite = document.getElementById("currentSite");
const chaosBtns = document.querySelectorAll(".chaos-btn");
const perTabMode = document.getElementById("perTabMode");

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

  // Identity mode
  if (state.identityMode) {
    perTabMode.checked = state.identityMode === "per-tab";
    rotateAllTabs.parentElement.style.display = state.identityMode === "session" ? "none" : "";
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
    const [tab] = await B.tabs.query({ active: true, currentWindow: true });
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
  B.runtime.sendMessage({ type: "getState" }, (state) => {
    if (state) updateUI(state);
  });

  // Check site override
  B.storage.session.get(["siteOverrides"], (data) => {
    const overrides = data.siteOverrides || {};
    siteEnabled.checked = overrides[hostname] !== false;
  });
}

// Event listeners
enableToggle.addEventListener("change", () => {
  B.runtime.sendMessage({
    type: "toggleEnabled",
    enabled: enableToggle.checked,
  });
});

// Restore "all tabs" preference
B.storage.local.get(["rotateAllTabs"], (data) => {
  rotateAllTabs.checked = !!data.rotateAllTabs;
});
rotateAllTabs.addEventListener("change", () => {
  B.storage.local.set({ rotateAllTabs: rotateAllTabs.checked });
});

rotateBtn.addEventListener("click", () => {
  rotateBtn.textContent = "Rotating...";
  rotateBtn.disabled = true;
  B.runtime.sendMessage({
    type: "rotateNow",
    allTabs: rotateAllTabs.checked,
  }, (resp) => {
    if (resp && resp.rotated) {
      rotateBtn.textContent = "Done — reloading";
      // Profile is already written by background before this response arrives.
      // Short delay just so user sees the "Done" feedback before UI resets.
      setTimeout(() => {
        B.runtime.sendMessage({ type: "getState" }, (state) => {
          if (state) updateUI(state);
        });
        rotateBtn.textContent = "Rotate Identity";
        rotateBtn.disabled = false;
      }, 500);
    } else {
      rotateBtn.textContent = "Rotate Identity";
      rotateBtn.disabled = false;
    }
  });
});

chaosBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const level = btn.dataset.level;
    B.runtime.sendMessage({ type: "setChaosLevel", level: level });
    chaosBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    chaosDesc.textContent = chaosDescriptions[level];
  });
});

cleanCookiesBtn.addEventListener("click", () => {
  cleanCookiesBtn.textContent = "Cleaning...";
  B.runtime.sendMessage({ type: "cleanCookiesNow" }, (resp) => {
    cleanCookiesBtn.textContent = `Cleaned ${resp?.cleaned || 0}`;
    setTimeout(() => { cleanCookiesBtn.textContent = "Clean Cookies Now"; }, 2000);
    // Refresh stats
    B.runtime.sendMessage({ type: "getState" }, (state) => {
      if (state) updateUI(state);
    });
  });
});

fireBeaconsBtn.addEventListener("click", () => {
  fireBeaconsBtn.textContent = "Firing...";
  B.runtime.sendMessage({ type: "fireBeaconsNow" }, (resp) => {
    fireBeaconsBtn.textContent = `Fired ${resp?.fired || 0}`;
    setTimeout(() => { fireBeaconsBtn.textContent = "Fire Beacons Now"; }, 2000);
    B.runtime.sendMessage({ type: "getState" }, (state) => {
      if (state) updateUI(state);
    });
  });
});

// Per-tab mode: show warning dialog before enabling (v2 item 1).
// Switching back to session mode needs no confirmation.
const perTabWarning = document.getElementById("perTabWarning");
const perTabCancel = document.getElementById("perTabCancel");
const perTabConfirm = document.getElementById("perTabConfirm");

perTabMode.addEventListener("change", () => {
  if (perTabMode.checked) {
    perTabWarning.showModal();
  } else {
    B.runtime.sendMessage({ type: "setIdentityMode", mode: "session" }, () => {
      B.runtime.sendMessage({ type: "getState" }, (state) => {
        if (state) updateUI(state);
      });
    });
  }
});

perTabConfirm.addEventListener("click", () => {
  perTabWarning.close();
  B.runtime.sendMessage({ type: "setIdentityMode", mode: "per-tab" }, () => {
    B.runtime.sendMessage({ type: "getState" }, (state) => {
      if (state) updateUI(state);
    });
  });
});

perTabCancel.addEventListener("click", () => {
  perTabWarning.close();
  perTabMode.checked = false;
});

siteEnabled.addEventListener("change", async () => {
  const hostname = await getCurrentHostname();
  B.runtime.sendMessage({
    type: "setSiteOverride",
    hostname: hostname,
    enabled: siteEnabled.checked,
  });
});

init();

// Live refresh — side panel stays open, so poll every 2 seconds
// Includes full state (profile + stats) so display stays current after rotation
setInterval(() => {
  B.runtime.sendMessage({ type: "getState" }, (state) => {
    if (state) updateUI(state);
  });
}, 2000);
