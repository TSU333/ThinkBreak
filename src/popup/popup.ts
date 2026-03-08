import { PLATFORM_LABELS, STATE_LABELS, isValidCustomUrl } from "../common/constants";
import { getUserSettings, normalizeSettings, setUserSettings } from "../common/storage";
import type { BackgroundToPopupResponse, PopupToBackgroundMessage, UserSettings } from "../common/messaging";

const form = document.querySelector<HTMLFormElement>("#settings-form");
const savedMessage = document.querySelector<HTMLElement>("#saved-message");
const platformValue = document.querySelector<HTMLElement>("#platform-value");
const stateValue = document.querySelector<HTMLElement>("#state-value");
const aiTabValue = document.querySelector<HTMLElement>("#ai-tab-value");
const shortTabValue = document.querySelector<HTMLElement>("#short-tab-value");
const targetUrlValue = document.querySelector<HTMLElement>("#target-url-value");
const customUrlField = document.querySelector<HTMLElement>("#custom-url-field");

async function notifyBackground(settings: UserSettings): Promise<void> {
  const message: PopupToBackgroundMessage = {
    type: "SETTINGS_UPDATED",
    settings
  };

  await chrome.runtime.sendMessage(message);
}

function fillForm(settings: UserSettings): void {
  if (!form) {
    return;
  }

  (form.elements.namedItem("enabled") as HTMLInputElement).checked = settings.enabled;
  (form.elements.namedItem("thresholdSeconds") as HTMLInputElement).value = String(settings.thresholdSeconds);
  (form.elements.namedItem("shortSite") as HTMLSelectElement).value = settings.shortSite;
  (form.elements.namedItem("customShortUrl") as HTMLInputElement).value = settings.customShortUrl;
  (form.elements.namedItem("debug") as HTMLInputElement).checked = settings.debug;
  updateCustomUrlVisibility(settings.shortSite);
}

async function refreshRuntimeStatus(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: "GET_RUNTIME_STATE"
  } satisfies PopupToBackgroundMessage)) as BackgroundToPopupResponse;

  if (!response.ok) {
    platformValue!.textContent = "Error";
    stateValue!.textContent = response.error;
    return;
  }

  platformValue!.textContent = response.trackedPlatform ? PLATFORM_LABELS[response.trackedPlatform] : "-";
  stateValue!.textContent = response.trackedState ? STATE_LABELS[response.trackedState] : "-";
  aiTabValue!.textContent = response.session.aiTabId !== null ? `#${response.session.aiTabId}` : "-";
  shortTabValue!.textContent = response.session.shortTabId !== null ? `#${response.session.shortTabId}` : "-";
  targetUrlValue!.textContent = response.targetUrl ?? "Invalid custom URL";
}

function updateCustomUrlVisibility(shortSite: UserSettings["shortSite"]): void {
  customUrlField?.classList.toggle("hidden", shortSite !== "custom");
}

function setSavedMessage(message: string, variant: "default" | "error" = "default"): void {
  if (!savedMessage) {
    return;
  }

  savedMessage.textContent = message;
  savedMessage.dataset.variant = variant;
}

async function handleFormChange(): Promise<void> {
  if (!form) {
    return;
  }

  const shortSite = (form.elements.namedItem("shortSite") as HTMLSelectElement).value as UserSettings["shortSite"];
  updateCustomUrlVisibility(shortSite);

  const settings = normalizeSettings({
    enabled: (form.elements.namedItem("enabled") as HTMLInputElement).checked,
    thresholdSeconds: Number((form.elements.namedItem("thresholdSeconds") as HTMLInputElement).value),
    shortSite,
    customShortUrl: (form.elements.namedItem("customShortUrl") as HTMLInputElement).value,
    debug: (form.elements.namedItem("debug") as HTMLInputElement).checked
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

async function init(): Promise<void> {
  const settings = await getUserSettings();
  fillForm(settings);
  await refreshRuntimeStatus();

  form?.addEventListener("change", () => {
    void handleFormChange();
  });
  form?.addEventListener("input", () => {
    updateCustomUrlVisibility((form.elements.namedItem("shortSite") as HTMLSelectElement).value as UserSettings["shortSite"]);
  });
}

void init();
