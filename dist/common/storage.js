import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  THRESHOLD_LIMITS,
  normalizeUrlInput
} from "./constants.js";

export const createEmptySession = () => ({
  platform: null,
  aiTabId: null,
  aiWindowId: null,
  shortTabId: null,
  shortWindowId: null,
  hasRedirected: false,
  startedAt: null,
  finishedAt: null,
  lastKnownState: null,
  lastStateAt: null,
  lastGeneratingHeartbeatAt: null,
  redirectDueAt: null
});

export const normalizeSettings = (partial = {}) => {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...partial
  };

  merged.thresholdSeconds = Math.min(
    THRESHOLD_LIMITS.max,
    Math.max(THRESHOLD_LIMITS.min, Math.round(merged.thresholdSeconds))
  );
  merged.shortSite = normalizeShortSite(merged.shortSite);
  merged.enabled = merged.enabled !== false;
  merged.debug = merged.debug === true;
  merged.customShortUrl = normalizeUrlInput(merged.customShortUrl);

  return merged;
};

function normalizeShortSite(shortSite) {
  if (
    shortSite === "youtube-shorts" ||
    shortSite === "douyin" ||
    shortSite === "xiaohongshu" ||
    shortSite === "custom"
  ) {
    return shortSite;
  }

  return "tiktok";
}

export async function getUserSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return normalizeSettings(stored[STORAGE_KEYS.settings]);
}

export async function setUserSettings(settings) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: normalizeSettings(settings)
  });
}

export async function ensureDefaultSettings() {
  const settings = await getUserSettings();
  await setUserSettings(settings);
  return settings;
}

export async function getSessionState() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.session);
  return {
    ...createEmptySession(),
    ...(stored[STORAGE_KEYS.session] || {})
  };
}

export async function setSessionState(session) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.session]: {
      ...createEmptySession(),
      ...session
    }
  });
}
