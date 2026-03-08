import { DEFAULT_SETTINGS, STORAGE_KEYS, THRESHOLD_LIMITS, normalizeUrlInput } from "./constants";
import type { SessionState, ShortSite, UserSettings } from "./messaging";

export const createEmptySession = (): SessionState => ({
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

export const normalizeSettings = (partial?: Partial<UserSettings>): UserSettings => {
  const merged: UserSettings = {
    ...DEFAULT_SETTINGS,
    ...(partial ?? {})
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

function normalizeShortSite(shortSite: UserSettings["shortSite"]): ShortSite {
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

export async function getUserSettings(): Promise<UserSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return normalizeSettings(stored[STORAGE_KEYS.settings] as Partial<UserSettings> | undefined);
}

export async function setUserSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: normalizeSettings(settings)
  });
}

export async function ensureDefaultSettings(): Promise<UserSettings> {
  const settings = await getUserSettings();
  await setUserSettings(settings);
  return settings;
}

export async function getSessionState(): Promise<SessionState> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.session);
  return {
    ...createEmptySession(),
    ...(stored[STORAGE_KEYS.session] as Partial<SessionState> | undefined)
  };
}

export async function setSessionState(session: SessionState): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.session]: {
      ...createEmptySession(),
      ...session
    }
  });
}

export async function clearSessionState(): Promise<void> {
  await setSessionState(createEmptySession());
}
