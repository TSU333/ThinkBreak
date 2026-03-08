import {
  PLATFORM_LABELS,
  STATE_LABELS,
  isValidCustomUrl
} from "../common/constants.js";
import {
  getUserSettings,
  normalizeSettings,
  setUserSettings
} from "../common/storage.js";

const form = document.querySelector("#settings-form");
const savedMessage = document.querySelector("#saved-message");
const platformValue = document.querySelector("#platform-value");
const stateValue = document.querySelector("#state-value");
const aiTabValue = document.querySelector("#ai-tab-value");
const shortTabValue = document.querySelector("#short-tab-value");
const targetUrlValue = document.querySelector("#target-url-value");
const customUrlField = document.querySelector("#custom-url-field");

async function notifyBackground(settings) {
  await chrome.runtime.sendMessage({
    type: "SETTINGS_UPDATED",
    settings
  });
}

function fillForm(settings) {
  if (!form) {
    return;
  }

  form.elements.namedItem("enabled").checked = settings.enabled;
  form.elements.namedItem("thresholdSeconds").value = String(settings.thresholdSeconds);
  form.elements.namedItem("shortSite").value = settings.shortSite;
  form.elements.namedItem("customShortUrl").value = settings.customShortUrl;
  form.elements.namedItem("debug").checked = settings.debug;
  updateCustomUrlVisibility(settings.shortSite);
}

async function refreshRuntimeStatus() {
  const response = await chrome.runtime.sendMessage({
    type: "GET_RUNTIME_STATE"
  });

  if (!response.ok) {
    platformValue.textContent = "Error";
    stateValue.textContent = response.error;
    return;
  }

  platformValue.textContent = response.trackedPlatform ? PLATFORM_LABELS[response.trackedPlatform] : "-";
  stateValue.textContent = response.trackedState ? STATE_LABELS[response.trackedState] : "-";
  aiTabValue.textContent = response.session.aiTabId !== null ? `#${response.session.aiTabId}` : "-";
  shortTabValue.textContent = response.session.shortTabId !== null ? `#${response.session.shortTabId}` : "-";
  targetUrlValue.textContent = response.targetUrl || "Invalid custom URL";
}

function updateCustomUrlVisibility(shortSite) {
  if (customUrlField) {
    customUrlField.classList.toggle("hidden", shortSite !== "custom");
  }
}

function setSavedMessage(message, variant = "default") {
  if (!savedMessage) {
    return;
  }

  savedMessage.textContent = message;
  savedMessage.dataset.variant = variant;
}

async function handleFormChange() {
  if (!form) {
    return;
  }

  const shortSite = form.elements.namedItem("shortSite").value;
  updateCustomUrlVisibility(shortSite);

  const settings = normalizeSettings({
    enabled: form.elements.namedItem("enabled").checked,
    thresholdSeconds: Number(form.elements.namedItem("thresholdSeconds").value),
    shortSite,
    customShortUrl: form.elements.namedItem("customShortUrl").value,
    debug: form.elements.namedItem("debug").checked
  });

  if (settings.shortSite === "custom" && !isValidCustomUrl(settings.customShortUrl)) {
    setSavedMessage("Enter a valid http(s) URL before saving.", "error");
    return;
  }

  await setUserSettings(settings);
  await notifyBackground(settings);
  await refreshRuntimeStatus();
  setSavedMessage(`Saved at ${new Date().toLocaleTimeString()}`);
}

async function init() {
  const settings = await getUserSettings();
  fillForm(settings);
  await refreshRuntimeStatus();

  if (form) {
    form.addEventListener("change", () => {
      void handleFormChange();
    });
    form.addEventListener("input", () => {
      updateCustomUrlVisibility(form.elements.namedItem("shortSite").value);
    });
  }
}

void init();
